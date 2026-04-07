import 'dotenv/config';
import http from 'http';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { db, syncProject, runInitialSetup } from './db.js';
import { PostHog } from 'posthog-node';

const posthog = new PostHog(process.env.POSTHOG_PROJECT_TOKEN, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
});
process.on('exit', () => posthog.shutdown());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sessions = new Set();

function parseCookies(req) {
    const cookies = {};
    (req.headers.cookie || '').split(';').forEach(part => {
        const [k, ...v] = part.trim().split('=');
        if (k) cookies[k.trim()] = v.join('=').trim();
    });
    return cookies;
}

function isAuthenticated(req) {
    const { session } = parseCookies(req);
    return session && sessions.has(session);
}

function requireAuth(req, res) {
    if (!isAuthenticated(req)) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return false;
    }
    return true;
}

const server = http.createServer(async (req, res) => {
    const start = Date.now();
    let status = 200;

    try {
        if (req.url === '/api/session' && req.method === 'GET') {
            if (!isAuthenticated(req)) {
                status = 401;
                res.writeHead(401, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ error: 'unauthorized' }));
            } else {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
            }

        } else if (req.url === '/api/tasks' && req.method === 'GET') {
            if (!requireAuth(req, res)) { status = 401; return; }
            const result = await db.query(`
                SELECT t.*, c.name AS company_name
                FROM tasks t
                LEFT JOIN users u ON t.assignee_id = u.id
                LEFT JOIN companies c ON u.company_id = c.id
            `);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result.rows));

        } else if (req.url === '/api/projects' && req.method === 'GET') {
            if (!requireAuth(req, res)) { status = 401; return; }
            const result = await db.query('SELECT id, name, gid FROM projects ORDER BY name');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result.rows));

        } else if (req.url === '/api/refresh' && req.method === 'POST') {
            if (!requireAuth(req, res)) { status = 401; return; }
            const totalStart = Date.now();
            for (const project of ['CWP - 3rd Party', 'CWP - Aqua', 'NAFISC']) {
                await syncProject(project);
            }
            const syncDurationMs = Date.now() - totalStart;
            console.log(`[refresh] all done in ${(syncDurationMs / 1000).toFixed(1)}s`);
            await db.query(`
                UPDATE tasks
                SET assignee_id = (
                    SELECT u.id FROM users u
                    WHERE LOWER(TRIM(tasks.assignee)) = LOWER(u.first_name)
                    LIMIT 1
                )
                WHERE EXISTS (
                    SELECT 1 FROM users u
                    WHERE LOWER(TRIM(tasks.assignee)) = LOWER(u.first_name)
                )
            `);
            console.log('[refresh] assignee_id matched');
            const { session: sessionToken } = parseCookies(req);
            const syncUser = sessionToken || 'server';
            posthog.capture({
                distinctId: syncUser,
                event: 'tasks_synced',
                properties: { duration_ms: syncDurationMs, project_count: 3 },
            });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));

        } else if (req.url === '/api/login' && req.method === 'POST') {
            const body = await readBody(req);
            const { username, password } = JSON.parse(body);

            if (!username || !password) {
                status = 400;
                res.writeHead(400, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ error: 'username and password required' }));
            } else {
                const result = await db.query(
                    'SELECT password_digest FROM users WHERE username = $1',
                    [username]
                );
                const user = result.rows[0];
                if (user && user.password_digest && await bcrypt.compare(password, user.password_digest)) {
                    const token = crypto.randomUUID();
                    sessions.add(token);
                    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/`);
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ ok: true }));
                    posthog.capture({ distinctId: username, event: 'user_logged_in' });
                } else {
                    status = 401;
                    res.writeHead(401, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ error: 'invalid credentials' }));
                    posthog.capture({ distinctId: username || 'anonymous', event: 'login_failed' });
                }
            }

        } else {
            // Serve static files from dist/ (used by Electron)
            const distDir = path.join(__dirname, 'dist');
            const rawUrl = req.url.split('?')[0];
            const filePath = path.resolve(path.join(distDir, rawUrl));
            if (!filePath.startsWith(distDir)) {
                status = 403;
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            try {
                const content = await readFile(filePath);
                const ext = path.extname(filePath);
                const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
                res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
                res.end(content);
            } catch {
                // SPA fallback — serve index.html for unknown routes
                try {
                    const html = await readFile(path.join(distDir, 'index.html'));
                    res.setHeader('Content-Type', 'text/html');
                    res.end(html);
                } catch {
                    status = 404;
                    res.writeHead(404);
                    res.end('Not found');
                }
            }
        }
    } catch (err) {
        status = 500;
        console.error(err);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: 'internal server error' }));
    }

    logTiming(req.method, req.url, status, start);
});

async function main() {
    try {
        await runInitialSetup();
    } catch (err) {
        console.error('[setup] Error during setup:', err.message);
        console.error('[setup] SQLite database initialization failed.');
    }
    server.listen(3001, () => console.log('server running on 3001'));
}
main();

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function logTiming(method, url, status, startMs) {
    const elapsed = Date.now() - startMs;
    console.log(`[${method}] ${url} ${status} - ${elapsed}ms`);
}
