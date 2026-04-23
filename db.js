import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

const NAWSC_SHEET_ID = '1SHSRxATYjYQTuf5zdbBP2Q0KZvQl7kLo6WhSBNTwyFQ';

// Keys match the names used in Postgres projects table
const PROJECTS = {
    'CWP - 3rd Party': { id: 'd6e47b1d-509e-4401-9f62-dd042c4602fe', gid: '0' },
    'CWP - Aqua':      { id: '28bdccd2-f9c7-4c1f-bf9a-15777d4cc010', gid: '1752677248' },
    'NAFISC':          { id: '4bf4a22e-2531-4279-9e8c-4dae672284f3', gid: '1340353512' },
};

const DB_PATH = process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'zippy.db')
    : './zippy.db';

const _sqlite = new Database(DB_PATH);
_sqlite.pragma('journal_mode = WAL');
_sqlite.pragma('foreign_keys = ON');

// pg-compatible async wrapper — all callers keep `await db.query(sql, params)`
export const db = {
    query(sql, params = []) {
        return new Promise((resolve, reject) => {
            try {
                const sqlFixed = sql.replace(/\$\d+/g, '?');
                const isSelect = /^\s*SELECT/i.test(sqlFixed.trim());
                if (isSelect) {
                    const rows = _sqlite.prepare(sqlFixed).all(...params);
                    resolve({ rows });
                } else {
                    const info = _sqlite.prepare(sqlFixed).run(...params);
                    resolve({ rows: [], rowCount: info.changes });
                }
            } catch (err) {
                reject(err);
            }
        });
    }
};

// Minimal RFC 4180 CSV parser
function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"' && text[i + 1] === '"') {
                field += '"';
                i += 2;
            } else if (c === '"') {
                inQuotes = false;
                i++;
            } else {
                field += c;
                i++;
            }
        } else {
            if (c === '"') {
                inQuotes = true;
                i++;
            } else if (c === ',') {
                row.push(field.length ? field : null);
                field = '';
                i++;
            } else if (c === '\r' && text[i + 1] === '\n') {
                row.push(field.length ? field : null);
                rows.push(row);
                row = [];
                field = '';
                i += 2;
            } else if (c === '\n') {
                row.push(field.length ? field : null);
                rows.push(row);
                row = [];
                field = '';
                i++;
            } else {
                field += c;
                i++;
            }
        }
    }

    if (row.length > 0 || field.length > 0) {
        row.push(field.length ? field : null);
        rows.push(row);
    }

    return rows;
}

// MM/DD/YYYY or MM/DD/YY → YYYY-MM-DD, with guards for bad data
// Also handles trailing time component (e.g. "4/21/2026 20:00:00")
function parseDate(str) {
    if (!str || !str.trim()) return null;
    const dateOnly = str.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '');
    const parts = dateOnly.split('/');
    if (parts.length !== 3) return null;
    let [m, d, y] = parts;
    m = m.trim(); d = d.trim(); y = y.trim();
    if (!/^\d+$/.test(m) || !/^\d+$/.test(d) || !/^\d+$/.test(y)) return null;
    if (y.length === 2) y = '20' + y;
    // If month > 12 it's actually DD/MM — swap
    if (parseInt(m) > 12) [m, d] = [d, m];
    if (parseInt(m) < 1 || parseInt(m) > 12) return null;
    if (parseInt(d) < 1 || parseInt(d) > 31) return null;
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    const dt = new Date(iso);
    if (isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
    return iso;
}

// Fetches a project's sheet and upserts into tasks table
export async function syncProject(projectName) {
    const project = PROJECTS[projectName];
    if (!project) throw new Error(`Unknown project: ${projectName}`);

    const url = `https://docs.google.com/spreadsheets/d/${NAWSC_SHEET_ID}/export?format=csv&gid=${project.gid}`;
    console.log(`[sync] Fetching ${projectName}...`);

    const response = await fetch(url);
    const csvText = await response.text();

    const allRows = parseCSV(csvText);
    // allRows[0] = header row (sheet row 1)
    // allRows[1] = first data row (sheet row 2) — skipped to match original logic
    // allRows[2+] = actual data starting at sheet row 3
    const dataRows = allRows.slice(2);

    const rows = [];
    let skipped = 0;

    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const sheetRow = i + 3;

        if (row.every(v => v == null)) { skipped++; continue; }
        if (!row[0] || !row[0].trim()) { skipped++; continue; }

        const taskId = crypto.createHash('sha256').update(String(row[0])).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5');
        const vals = row.slice(0, 12);
        if ((vals[2]?.length ?? 0) > 255) vals[2] = 'Invalid value';
        if ((vals[3]?.length ?? 0) > 255) vals[3] = 'Invalid value';
        if ((vals[8]?.length ?? 0) > 255) vals[8] = 'Invalid value';
        vals[1]  = parseDate(vals[1]);   // created_at
        vals[5]  = parseDate(vals[5]);   // due_date
        vals[10] = null;                 // completed_at — managed by sync logic, never from sheet
        vals[11] = project.id;           // project_id
        vals.push(sheetRow);             // sheet_row

        rows.push([taskId, ...vals]);    // [id, sheet_id, created_at, ..., sheet_row]
    }

    if (rows.length === 0) {
        console.log(`[sync] ${projectName}: nothing to upsert (${skipped} skipped)`);
        return;
    }

    // Batch to avoid hitting SQLite's variable limit (~32766)
    const BATCH = 500;
    const FIELDS = 14; // added task id
    for (let b = 0; b < rows.length; b += BATCH) {
        const batch = rows.slice(b, b + BATCH);
        const placeholders = batch.map(() =>
            `(${Array.from({ length: FIELDS }, () => '?').join(',')})`
        ).join(',');

        await db.query(`
            INSERT INTO tasks (
                id, sheet_id, created_at, reporter, component, description,
                due_date, priority, status, assignee, notes,
                completed_at, project_id, sheet_row
            ) VALUES ${placeholders}
            ON CONFLICT (sheet_id) DO UPDATE SET
                id           = EXCLUDED.id,
                created_at   = EXCLUDED.created_at,
                reporter     = EXCLUDED.reporter,
                component    = EXCLUDED.component,
                description  = EXCLUDED.description,
                due_date     = EXCLUDED.due_date,
                priority     = EXCLUDED.priority,
                status       = EXCLUDED.status,
                assignee     = EXCLUDED.assignee,
                notes        = EXCLUDED.notes,
                completed_at = CASE
                    WHEN EXCLUDED.status IN ('Ready for Testing', 'Resolved')
                         AND (tasks.status NOT IN ('Ready for Testing', 'Resolved') OR tasks.status IS NULL)
                        THEN date('now')
                    WHEN EXCLUDED.status NOT IN ('Ready for Testing', 'Resolved')
                        THEN NULL
                    ELSE tasks.completed_at
                END,
                project_id   = EXCLUDED.project_id,
                sheet_row    = EXCLUDED.sheet_row
        `, batch.flat());
    }

    console.log(`[sync] ${projectName}: ${rows.length} rows upserted, ${skipped} skipped`);
}

async function createSchema() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS companies (
            id   TEXT PRIMARY KEY,
            name TEXT NOT NULL
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS users (
            id              TEXT PRIMARY KEY,
            first_name      TEXT,
            last_name       TEXT NOT NULL DEFAULT '',
            email           TEXT NOT NULL DEFAULT '',
            company_id      TEXT REFERENCES companies(id),
            username        TEXT UNIQUE,
            password_digest TEXT
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS projects (
            id   TEXT PRIMARY KEY,
            name TEXT,
            gid  INTEGER
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS sprints (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date   TEXT NOT NULL
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS tasks (
            id           TEXT PRIMARY KEY,
            sheet_id     TEXT UNIQUE,
            created_at   TEXT,
            reporter     TEXT,
            component    TEXT,
            description  TEXT,
            due_date     TEXT,
            priority     TEXT,
            status       TEXT,
            assignee     TEXT,
            assignee_id  TEXT REFERENCES users(id),
            notes        TEXT,
            completed_at TEXT,
            project_id   TEXT REFERENCES projects(id),
            ticket_num   INTEGER,
            sheet_row    INTEGER,
            sprint_id    TEXT REFERENCES sprints(id)
        )
    `);
}

const SEED_DATA = {
    companies: [
        { id: '60350706-1716-4672-8a8e-9a973f9c5aff', name: 'NAWSC' },
        { id: 'c3e913cf-a099-4a1f-bf04-5f0f6ad787b7', name: 'CloudMentor' },
    ],
    users: [
        {
            id: '30d22cfc-991d-427a-bbcd-2770d06beb58',
            first_name: 'Aman',
            last_name: 'Baheti',
            email: 'aman.b@cmentor.com',
            company_id: 'c3e913cf-a099-4a1f-bf04-5f0f6ad787b7',
            username: 'aman.b',
            password_digest: '$2a$12$XEw41yadTCXqkfsTYrzEy.FMq5Nr2U4c1WgwEL0.RMLuSuFUkkczG',
        },
        {
            id: '3c7b21f0-59e0-4151-975a-26b8de2f2a07',
            first_name: 'Gena',
            last_name: 'Carlton',
            email: 'gena@nawsc.net',
            company_id: '60350706-1716-4672-8a8e-9a973f9c5aff',
            username: 'gena',
            password_digest: '$2a$12$XEw41yadTCXqkfsTYrzEy.FMq5Nr2U4c1WgwEL0.RMLuSuFUkkczG',
        },
        {
            id: '65952781-7412-4865-9664-a337fdf91f43',
            first_name: 'Bhuvnesh',
            last_name: 'Ghasoliya',
            email: 'bhuvnesh@cmentor.com',
            company_id: 'c3e913cf-a099-4a1f-bf04-5f0f6ad787b7',
            username: 'bhuvnesh',
            password_digest: '$2a$12$XEw41yadTCXqkfsTYrzEy.FMq5Nr2U4c1WgwEL0.RMLuSuFUkkczG',
        },
        {
            id: '9296c035-814a-4b70-802d-e75490b613d8',
            first_name: 'Prateek',
            last_name: 'Gurjar',
            email: 'prateek.g@cmentor.com',
            company_id: 'c3e913cf-a099-4a1f-bf04-5f0f6ad787b7',
            username: 'prateek.g',
            password_digest: '$2a$12$XEw41yadTCXqkfsTYrzEy.FMq5Nr2U4c1WgwEL0.RMLuSuFUkkczG',
        },
        {
            id: 'a4360cf7-d198-48f1-bdb0-521f8c954c7a',
            first_name: 'Kevin',
            last_name: 'Adams',
            email: 'kadams@computervisionaries.com',
            company_id: '60350706-1716-4672-8a8e-9a973f9c5aff',
            username: 'kevin',
            password_digest: '$2a$12$XEw41yadTCXqkfsTYrzEy.FMq5Nr2U4c1WgwEL0.RMLuSuFUkkczG',
        },
        {
            id: 'd29b523e-a566-4e7b-a25b-82f297860fe5',
            first_name: 'Hardik',
            last_name: 'Patel',
            email: 'hpatel@nafisc.com',
            company_id: '60350706-1716-4672-8a8e-9a973f9c5aff',
            username: 'hpatel',
            password_digest: '$2a$12$XEw41yadTCXqkfsTYrzEy.FMq5Nr2U4c1WgwEL0.RMLuSuFUkkczG',
        },
    ],
    projects: [
        { id: 'd6e47b1d-509e-4401-9f62-dd042c4602fe', name: 'CWP - 3rd Party', gid: 0 },
        { id: '28bdccd2-f9c7-4c1f-bf9a-15777d4cc010', name: 'CWP - Aqua', gid: 1752677248 },
        { id: '4bf4a22e-2531-4279-9e8c-4dae672284f3', name: 'NAFISC', gid: 1340353512 },
    ],
};

async function seedAuthData() {
    for (const company of SEED_DATA.companies) {
        await db.query(
            'INSERT INTO companies (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING',
            [company.id, company.name]
        );
    }
    for (const user of SEED_DATA.users) {
        await db.query(
            'INSERT INTO users (id, first_name, last_name, email, company_id, username, password_digest) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
            [user.id, user.first_name, user.last_name, user.email, user.company_id, user.username, user.password_digest]
        );
    }
    for (const project of SEED_DATA.projects) {
        await db.query(
            'INSERT INTO projects (id, name, gid) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING',
            [project.id, project.name, project.gid]
        );
    }
}

// Called on server startup — creates schema, seeds auth data, syncs tasks on first run
export async function runInitialSetup() {
    await createSchema();
    await seedAuthData();

    const { rows } = await db.query('SELECT COUNT(*) AS count FROM tasks');
    if (parseInt(rows[0].count) === 0) {
        console.log('[setup] First run detected — syncing all projects...');
        for (const project of Object.keys(PROJECTS)) {
            await syncProject(project);
        }
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
        console.log('[setup] Initial setup complete');
    }
}
