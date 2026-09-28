const express = require('express');

module.exports = function(db) {
    const router = express.Router();

    // Vytvoření tabulek
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            type TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS devices (
            device_token TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0
        )`);
    });

    // Ověření, zda je zařízení administrátorské (pro admin.html)
    router.post('/verify-admin', (req, res) => {
        const { deviceToken } = req.body;
        if (!deviceToken) return res.json({ isAdmin: false });

        db.get("SELECT is_admin FROM devices WHERE device_token = ?", [deviceToken], (err, row) => {
            if (err || !row || row.is_admin !== 1) {
                return res.json({ isAdmin: false });
            }
            res.json({ isAdmin: true });
        });
    });

    // Automatický zápis přes NFC (pouze pro předem schválená zařízení)
    router.post('/nfc-tap', (req, res) => {
        const { deviceToken, type } = req.body;
        if (!deviceToken) return res.status(400).json({ error: 'Chybí token zařízení.' });

        db.get("SELECT username FROM devices WHERE device_token = ?", [deviceToken], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // Pokud zařízení není v databázi, okamžitě přístup odmítneme
            if (!row) {
                return res.status(403).json({ error: 'Neznámé zařízení. Přístup odepřen.' });
            }

            const username = row.username;

            // Zjistíme poslední záznam pro automatické střídání Příchod / Odchod, pokud typ není zadán
            db.get("SELECT type FROM attendance WHERE username = ? ORDER BY id DESC LIMIT 1", [username], (err, lastRow) => {
                let actionType = type;
                if (!actionType) {
                    actionType = (!lastRow || lastRow.type === 'Odchod') ? 'Příchod' : 'Odchod';
                }

                db.run(
                    "INSERT INTO attendance (username, type, timestamp) VALUES (?, ?, datetime('now', 'localtime'))",
                    [username, actionType],
                    function(err) {
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ 
                            success: true, 
                            username: username, 
                            type: actionType, 
                            time: new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) 
                        });
                    }
                );
            });
        });
    });

    // Registrace zařízení (pro správu adminem)
    router.post('/register-device', (req, res) => {
        const { deviceToken, username, isAdmin } = req.body;
        if (!deviceToken || !username) return res.status(400).json({ error: 'Chybí údaje.' });

        const adminStatus = isAdmin ? 1 : 0;
        db.run(
            "INSERT OR REPLACE INTO devices (device_token, username, is_admin) VALUES (?, ?, ?)",
            [deviceToken, username, adminStatus],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, username: username, isAdmin: adminStatus });
            }
        );
    });

    // Získání historie docházky (pro admina)
    router.get('/', (req, res) => {
        db.all("SELECT * FROM attendance ORDER BY id DESC LIMIT 100", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // Smazání záznamu v docházce
    router.delete('/:id', (req, res) => {
        db.run("DELETE FROM attendance WHERE id = ?", [req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Záznam smazán' });
        });
    });

    return router;
};