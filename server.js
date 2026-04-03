import pg from 'pg';
import http from 'http';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = new pg.Pool({database: 'zippy'})

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

http.createServer(async (req, res) => {
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
            const dbScript = path.join(__dirname, 'db.rb');
            const totalStart = Date.now();
            for (const project of ['CWP', 'AQUA', 'FIRE']) {
                const projectStart = Date.now();
                process.stdout.write(`[refresh] ${project}...`);
                await execAsync(`ruby ${dbScript} ${project}`);
                console.log(` done (${((Date.now() - projectStart) / 1000).toFixed(1)}s)`);
            }
            console.log(`[refresh] all done in ${((Date.now() - totalStart) / 1000).toFixed(1)}s`);
            await db.query(`
                UPDATE tasks t
                SET assignee_id = u.id
                FROM users u
                WHERE LOWER(TRIM(t.assignee)) = LOWER(u.first_name)
            `);
            console.log('[refresh] assignee_id matched');
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
                } else {
                    status = 401;
                    res.writeHead(401, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ error: 'invalid credentials' }));
                }
            }

        } else {
            status = 404;
            res.writeHead(404, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({ error: 'not found' }));
        }
    } catch (err) {
        status = 500;
        console.error(err);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: 'internal server error' }));
    }

    logTiming(req.method, req.url, status, start);
}).listen(3001, () => console.log('server running on 3001'))

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
