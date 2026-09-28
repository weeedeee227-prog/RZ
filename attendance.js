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

    // Routa pro /nfc – když zařízení není autorizované, zobrazí se tato stránka s tokenem
router.get('/nfc', async (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="cs">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>P&R MONT - NFC Docházka</title>
        </head>
        <body style="background: #0f172a; color: #f8fafc; font-family: system-ui; text-align: center; padding-top: 20vh; margin: 0; padding-left: 20px; padding-right: 20px;">
            <h1 style="color:#ef4444; font-size: 32px;">⛔ Přístup odepřen</h1>
            <p style="color:#94a3b8; font-size: 16px;">Toto zařízení není v systému autorizované.</p>
            <p style="color:#94a3b8; font-size: 14px;">Vaše zařízení má tento token pro schválení v administraci:</p>
            
            <div id="token-box" style="background: #1e293b; color: #38bdf8; font-family: monospace; font-size: 20px; padding: 12px; border-radius: 8px; display: inline-block; margin: 15px 0; border: 1px solid #334155; user-select: all;">
                Načítání tokenu...
            </div>

            <script>
                // Zjistíme, jestli už token v prohlížeči existuje
                let token = localStorage.getItem('deviceToken');
                
                // Pokud neexistuje, vygenerujeme nový
                if (!token) {
                    token = 'dev_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                    localStorage.setItem('deviceToken', token);
                }
                
                // Vypíšeme ho na obrazovku
                document.getElementById('token-box').innerText = token;
            </script>
        </body>
        </html>
    `);
});// Ověření, zda je zařízení administrátorské (pro admin.html)
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
// Získání seznamu schválených zařízení (pro admin.html)
    router.get('/devices', (req, res) => {
        db.all("SELECT * FROM devices", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // Smazání / odebrání NFC zařízení
    router.delete('/devices/:token', (req, res) => {
        db.run("DELETE FROM devices WHERE device_token = ?", [req.params.token], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Zařízení odebráno' });
        });
    });
    return router;
};