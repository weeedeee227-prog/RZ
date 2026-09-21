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

// Vytvoření tabulky pro vozidla
db.run(`CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spz TEXT UNIQUE NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Stránka pro zákazníka (index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Skrytá stránka pro mechaniky (admin.html)
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// 1. ZÁKAZNÍK: Vyhledání stavu podle SPZ
app.get('/api/status/:spz', (req, res) => {
    const spz = req.params.spz.replace(/\s+/g, '').toUpperCase();

    db.get(`SELECT * FROM vehicles WHERE REPLACE(spz, ' ', '') = ?`, [spz], (err, row) => {
        if (err) return res.status(500).json({ error: 'Chyba databáze' });
        if (!row) return res.status(404).json({ error: 'Vozidlo s touto SPZ nebylo nalezeno.' });
        res.json(row);
    });
});

// 2. SERVIS: Získání všech vozidel
app.get('/api/admin/vehicles', (req, res) => {
    db.all(`SELECT * FROM vehicles ORDER BY updated_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Chyba databáze' });
        res.json(rows);
    });
});

// 3. SERVIS: Přidání nebo aktualizace vozidla
app.post('/api/admin/vehicles', (req, res) => {
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

// 4. SERVIS: Smazání vozidla
app.delete('/api/admin/vehicles/:id', (req, res) => {
    db.run(`DELETE FROM vehicles WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: 'Chyba při mazání' });
        res.json({ message: 'Smazáno' });
    });
});

app.listen(3000, () => console.log('Servisní systém běží na http://localhost:3000'));