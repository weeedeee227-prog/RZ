const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Připojení k SQLite databázi
const db = new sqlite3.Database('./servis.db', (err) => {
    if (err) console.error('Chyba při otevírání databáze:', err.message);
    else console.log('Připojeno k SQLite databázi.');
});

// Vytvoření tabulek a bezpečné přidání sloupců pro logování
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spz TEXT UNIQUE NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Bezpečné přidání nových sloupců do existující tabulky
    db.run(`ALTER TABLE vehicles ADD COLUMN created_by TEXT`, (err) => {});
    db.run(`ALTER TABLE vehicles ADD COLUMN updated_by TEXT`, (err) => {});

    db.run(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL
    )`, () => {
        const defaultUsers = [
            ['StepanSigmund', '62612Alfa'],
            ['DenisLiulic', 'pofelsibro3103']
        ];
        
        const stmt = db.prepare(`INSERT OR REPLACE INTO users (username, password) VALUES (?, ?)`);
        defaultUsers.forEach(user => stmt.run(user));
        stmt.finalize();
    });
});

// Middleware pro kontrolu přihlášení
function requireLogin(req, res, next) {
    const user = req.cookies.logged_user;
    if (!user) {
        return res.send(`
            <!DOCTYPE html>
            <html lang="cs">
            <head>
                <meta charset="UTF-8">
                <title>Přihlášení do servisu</title>
                <style>
                    body { font-family: sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .login-card { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 300px; }
                    h2 { margin-top: 0; color: #333; text-align: center; }
                    input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
                    button { width: 100%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
                    button:hover { background: #0056b3; }
                </style>
            </head>
            <body>
                <div class="login-card">
                    <h2>Pofel Garage</h2>
                    <form method="POST" action="/api/login">
                        <input type="text" name="username" placeholder="Uživatelské jméno" required>
                        <input type="password" name="password" placeholder="Heslo" required>
                        <button type="submit">Přihlásit se</button>
                    </form>
                </div>
            </body>
            </html>
        `);
    }
    next();
}

// Zpracování přihlášení
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
        if (err || !row) {
            return res.send(`<script>alert('Nesprávné jméno nebo heslo!'); window.location='/admin.html';</script>`);
        }
        res.cookie('logged_user', row.username, { httpOnly: true, maxAge: 86400000 });
        res.redirect('/admin.html');
    });
});

// ==========================================
// ZABEZPEČENÉ ADMIN ROUTY
// ==========================================
app.get('/admin.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/admin/vehicles', requireLogin, (req, res) => {
    db.all(`SELECT * FROM vehicles ORDER BY updated_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Chyba databáze' });
        res.json(rows);
    });
});

app.post('/api/admin/vehicles', requireLogin, (req, res) => {
    const { spz, model, status, note } = req.body;
    const currentUser = req.cookies.logged_user;

    if (!spz || !model || !status) {
        return res.status(400).json({ error: 'Vyplňte SPZ, model a stav.' });
    }

    const cleanSpz = spz.trim().toUpperCase();

    db.get(`SELECT created_by FROM vehicles WHERE spz = ?`, [cleanSpz], (err, existingRow) => {
        if (err) return res.status(500).json({ error: 'Chyba databáze' });

        const creator = existingRow ? existingRow.created_by : currentUser;

        const sql = `INSERT INTO vehicles (spz, model, status, note, created_by, updated_by, updated_at) 
                     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                     ON CONFLICT(spz) DO UPDATE SET 
                        model = excluded.model,
                        status = excluded.status,
                        note = excluded.note,
                        updated_by = excluded.updated_by,
                        updated_at = CURRENT_TIMESTAMP`;

        db.run(sql, [cleanSpz, model, status, note || '', creator, currentUser], function(err) {
            if (err) return res.status(500).json({ error: 'Chyba při ukládání: ' + err.message });
            res.json({ message: 'Uloženo úspěšně' });
        });
    });
});

app.delete('/api/admin/vehicles/:id', requireLogin, (req, res) => {
    db.run(`DELETE FROM vehicles WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: 'Chyba při mazání' });
        res.json({ message: 'Smazáno' });
    });
});

// ==========================================
// VEŘEJNÉ SOUBORY A WEBY
// ==========================================
app.use(express.static('.'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/status/:spz', (req, res) => {
    const spz = req.params.spz.replace(/\s+/g, '').toUpperCase();

    db.get(`SELECT * FROM vehicles WHERE REPLACE(spz, ' ', '') = ?`, [spz], (err, row) => {
        if (err) return res.status(500).json({ error: 'Chyba databáze' });
        if (!row) return res.status(404).json({ error: 'Vozidlo s touto SPZ nebylo nalezeno.' });
        res.json(row);
    });
});

app.listen(3000, () => console.log('Servisní systém běží na http://localhost:3000'));