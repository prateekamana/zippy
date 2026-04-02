import pg from 'pg';
import http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = new pg.Pool({database: 'zippy'})

http.createServer(async (req, res) => {
    if(req.url === '/api/tasks') {
        const result = await db.query('SELECT * FROM tasks');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result.rows));
    } else if(req.url === '/api/projects') {
        const result = await db.query('SELECT id, name, gid FROM projects ORDER BY name');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result.rows));
    } else if(req.url === '/api/refresh' && req.method === 'POST') {
        const dbScript = path.join(__dirname, 'db.rb');
        const totalStart = Date.now();
        for (const project of ['CWP', 'AQUA', 'FIRE']) {
            const start = Date.now();
            process.stdout.write(`[refresh] ${project}...`);
            await execAsync(`ruby ${dbScript} ${project}`);
            console.log(` done (${((Date.now() - start) / 1000).toFixed(1)}s)`);
        }
        console.log(`[refresh] all done in ${((Date.now() - totalStart) / 1000).toFixed(1)}s`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
    }
}).listen(3001, () => console.log('server running on 3001'))