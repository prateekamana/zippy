import pg from 'pg';
import http from 'http';

const db = new pg.Pool({database: 'zippy'})

http.createServer(async (req, res) => {
    if(req.url === '/api/tasks') {
        const result = await db.query('SELECT * FROM tasks');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result.rows));
    }
}).listen(3001, () => console.log('server running on 3001'))