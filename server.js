const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('.'));

// Připojení k SQLite databázi
const db = new sqlite3.Database('./servis.db', (err) => {
    if (err) console.error('Chyba při otevírání databáze:', err.message);
    else console.log('Připojeno k SQLite databázi.');
});

// Vytvoření tabulek pro vozidla a uživatele
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spz TEXT UNIQUE NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL
    )`, () => {
        // Vložení nebo aktualizace obou uživatelů při startu
        const defaultUsers = [
            ['StepanSigmund', '62612Alfa'],
            ['DenisLiulic', 'pofelsibro3103']
        ];
        
        const stmt = db.prepare(`INSERT OR REPLACE INTO users (username, password) VALUES (?, ?)`);
        defaultUsers.forEach(user => stmt.run(user));
        stmt.finalize();
    });
});

// Middleware pro ověření uživatele podle databáze
function checkAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Zabezpečená administrace servisu"');
        return res.status(401).json({ error: 'Neautorizovaný přístup' });
    }

    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const username = auth[0];
    const password = auth[1];

    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
        if (err || !row) {
            res.setHeader('WWW-Authenticate', 'Basic realm="Zabezpečená administrace servisu"');
            return res.status(401).json({ error: 'Nesprávné jméno nebo heslo' });
        }
        next();
    });
}

// Stránka pro zákazníka (index.html) - veřejná
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Zákaznické API pro vyhledávání stavu podle SPZ - veřejné
app.get('/api/status/:spz', (req, res) => {
    const spz = req.params.spz.replace(/\s+/g, '').toUpperCase();

    db.get(`SELECT * FROM vehicles WHERE REPLACE(spz, ' ', '') = ?`, [spz], (err, row) => {
        if (err) return res.status(500).json({ error: 'Chyba databáze' });
        if (!row) return res.status(404).json({ error: 'Vozidlo s touto SPZ nebylo nalezeno.' });
        res.json(row);
    });
});

// ==========================================
// ZABEZPEČENÉ ADMIN ROUTY (Vyžadují přihlášení)
// ==========================================

app.get('/admin.html', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/admin/vehicles', checkAuth, (req, res) => {
    db.all(`SELECT * FROM vehicles ORDER BY updated_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Chyba databáze' });
        res.json(rows);
    });
});

app.post('/api/admin/vehicles', checkAuth, (req, res) => {
    const { spz, model, status, note } = req.body;
    if (!spz || !model || !status) {
        return res.status(400).json({ error: 'Vyplňte SPZ, model a stav.' });
    }

    const cleanSpz = spz.trim().toUpperCase();

    const sql = `INSERT INTO vehicles (spz, model, status, note, updated_at) 
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(spz) DO UPDATE SET 
                    model = excluded.model,
                    status = excluded.status,
                    note = excluded.note,
                    updated_at = CURRENT_TIMESTAMP`;

    db.run(sql, [cleanSpz, model, status, note || ''], function(err) {
        if (err) return res.status(500).json({ error: 'Chyba při ukládání' });
        res.json({ message: 'Uloženo úspěšně' });
    });
});

app.delete('/api/admin/vehicles/:id', checkAuth, (req, res) => {
    db.run(`DELETE FROM vehicles WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: 'Chyba při mazání' });
        res.json({ message: 'Smazáno' });
    });
});

app.listen(3000, () => console.log('Servisní systém běží na http://localhost:3000'));