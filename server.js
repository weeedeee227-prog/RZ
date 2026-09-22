const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = 'servis.db';
const BACKUP_FILE = 'servis_backup.db';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

// Inicializace SQLite databáze
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('Chyba při otevírání databáze:', err.message);
    } else {
        console.log('Připojeno k SQLite databázi.');
        initDb();
    }
});

// Vytvoření tabulky vozidel (s novým sloupcem phone)
function initDb() {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            spz TEXT UNIQUE NOT NULL,
            model TEXT NOT NULL,
            status TEXT NOT NULL,
            note TEXT,
            phone TEXT,
            created_by TEXT,
            updated_by TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;
    db.run(createTableQuery, (err) => {
        if (err) console.error('Chyba při vytváření tabulky:', err.message);
    });
}

// Funkce pro zkrácení jména na 2 + 2 písmena
function formatUser(fullName) {
    if (!fullName) return '-';
    if (fullName === 'StepanSigmund') return 'StSi';
    if (fullName === 'DenisLiulic') return 'DeLi';
    return fullName.substring(0, 4);
}

// Automatické zálohování databáze
setInterval(() => {
    if (fs.existsSync(DB_FILE)) {
        fs.copyFile(DB_FILE, BACKUP_FILE, (err) => {
            if (err) console.error('Chyba při zálohování:', err);
        });
    }
}, 3600000);

// --- AUTENTIZACE ---
const USERS = {
    'StepanSigmund': 'heslo123',
    'DenisLiulic': 'heslo456'
};

function checkAuth(req, res, next) {
    const user = req.cookies.logged_user;
    if (user && USERS[user]) {
        req.user = user;
        next();
    } else {
        res.redirect('/login.html');
    }
}

app.get('/login.html', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="cs">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Pofel Garage - Přihlášení</title>
            <style>
                body { font-family: sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .login-box { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 300px; }
                h2 { text-align: center; color: #1a1a1a; }
                .form-group { margin-bottom: 15px; }
                label { display: block; margin-bottom: 5px; font-weight: bold; }
                input, select { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
                button { background: #0066cc; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold; cursor: pointer; }
            </style>
        </head>
        <body>
            <div class="login-box">
                <h2>Pofel Garage</h2>
                ${req.query.error ? '<div style="color:red;text-align:center;margin-bottom:10px;">Nesprávné jméno nebo heslo!</div>' : ''}
                <form action="/login" method="POST">
                    <div class="form-group">
                        <label>Uživatel:</label>
                        <select name="username">
                            <option value="StepanSigmund">Štěpán Sigmund</option>
                            <option value="DenisLiulic">Denis Liulič</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Heslo:</label>
                        <input type="password" name="password" required>
                    </div>
                    <button type="submit">Přihlásit se</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (USERS[username] && USERS[username] === password) {
        res.cookie('logged_user', username, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
        res.redirect('/admin.html');
    } else {
        res.redirect('/login.html?error=1');
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin.html', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// --- API ENDPOINTY ---
app.get('/api/vehicles', (req, res) => {
    const spz = req.query.spz;
    let query = "SELECT spz, model, status, note, updated_at FROM vehicles";
    let params = [];
    if (spz) { query += " WHERE spz LIKE ?"; params.push(`%${spz.trim().toUpperCase()}%`); }
    db.all(query, params, (err, rows) => {
        if (err) res.status(500).json({ error: err.message }); else res.json(rows);
    });
});

app.get('/api/admin/vehicles', checkAuth, (req, res) => {
    db.all("SELECT * FROM vehicles ORDER BY id DESC", [], (err, rows) => {
        if (err) res.status(500).json({ error: err.message }); else res.json(rows);
    });
});

app.post('/api/admin/vehicles', checkAuth, (req, res) => {
    let { spz, model, status, note, phone } = req.body;
    if (!spz || !model || !status) return res.status(400).json({ error: 'Chybí povinná pole.' });

    spz = spz.trim().toUpperCase();
    const currentUser = formatUser(req.user);

    db.get("SELECT * FROM vehicles WHERE spz = ?", [spz], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (row) {
            const updateQuery = `UPDATE vehicles SET model = ?, status = ?, note = ?, phone = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE spz = ?`;
            db.run(updateQuery, [model, status, note, phone, currentUser, spz], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Aktualizováno' });
            });
        } else {
            const insertQuery = `INSERT INTO vehicles (spz, model, status, note, phone, created_by, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
            db.run(insertQuery, [spz, model, status, note, phone, currentUser, currentUser], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Přidáno' });
            });
        }
    });
});

app.delete('/api/admin/vehicles/:id', checkAuth, (req, res) => {
    db.run("DELETE FROM vehicles WHERE id = ?", [req.params.id], function(err) {
        if (err) res.status(500).json({ error: err.message }); else res.json({ message: 'Smazáno' });
    });
});

app.listen(PORT, () => console.log(`Server běží na portu ${PORT}`));