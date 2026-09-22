const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Chyba DB:', err.message);
    else console.log('Připojeno k SQLite.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spz TEXT UNIQUE NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        phone TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT
    )`);
});

// API: Získání všech vozidel
app.get('/api/vehicles', (req, res) => {
    db.all("SELECT * FROM vehicles ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: Přidání nebo úprava vozidla (vyžaduje povinný telefon)
app.post('/api/vehicles', (req, res) => {
    let { spz, model, status, note, phone, user } = req.body;
    
    if (!spz || !model || !status || !phone) {
        return res.status(400).json({ error: 'Vyplňte všechna povinná pole včetně telefonu.' });
    }

    spz = spz.trim().toUpperCase();
    phone = phone.trim();
    const shortUser = user ? user.trim().toLowerCase() : 'admin';

    db.get("SELECT * FROM vehicles WHERE spz = ?", [spz], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        if (row) {
            db.run(
                "UPDATE vehicles SET model = ?, status = ?, note = ?, phone = ?, updated_by = ? WHERE spz = ?",
                [model, status, note || '', phone, shortUser, spz],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Vozidlo aktualizováno', id: row.id, action: 'update' });
                }
            );
        } else {
            db.run(
                "INSERT INTO vehicles (spz, model, status, note, phone, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [spz, model, status, note || '', phone, shortUser, shortUser],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Vozidlo přidáno', id: this.lastID, action: 'create' });
                }
            );
        }
    });
});

// API: Smazání vozidla
app.delete('/api/vehicles/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM vehicles WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Vozidlo smazáno' });
    });
});

app.listen(PORT, () => {
    console.log(`Server běží na portu ${PORT}`);
});