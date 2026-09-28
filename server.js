const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Vytvoření složky pro nahrávání fotek, pokud neexistuje
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(uploadDir));

// --- DATABÁZE ---
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
        updated_by TEXT,
        mechanic TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS completed_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spz TEXT NOT NULL,
        model TEXT NOT NULL,
        phone TEXT NOT NULL,
        work_done TEXT NOT NULL,
        cost_expenses REAL NOT NULL,
        final_price REAL NOT NULL,
        net_profit REAL NOT NULL,
        completed_by TEXT NOT NULL,
        completed_at TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_token TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        device_token TEXT NOT NULL,
        type TEXT NOT NULL,
        time TEXT NOT NULL,
        date TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS vehicle_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        photo_path TEXT NOT NULL
    )`);

    db.run("INSERT OR IGNORE INTO users (username, password) VALUES ('StSi', 'Stsi3103*')");
    db.run("INSERT OR IGNORE INTO users (username, password) VALUES ('DeLi', 'Deli3103*')");
});

// --- API ENDPOINTY: UŽIVATELÉ ---
app.get('/api/users', (req, res) => {
    db.all("SELECT id, username FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/users', (req, res) => {
    let { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Zadejte uživatelské jméno a heslo.' });
    }
    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username.trim(), password], function(err) {
        if (err) return res.status(400).json({ error: 'Uživatel již existuje nebo došlo k chybě.' });
        res.json({ message: 'Uživatel úspěšně vytvořen' });
    });
});

app.delete('/api/users/:id', (req, res) => {
    const { id } = req.params;
    db.get("SELECT username FROM users WHERE id = ?", [id], (err, row) => {
        if (row && row.username.toLowerCase() === 'stsi') {
            return res.status(400).json({ error: 'Hlavního administrátora StSi nelze smazat!' });
        }
        db.run("DELETE FROM users WHERE id = ?", [id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Uživatel smazán' });
        });
    });
});

// --- API ENDPOINTY: DOCHÁZKA A NFC ---
app.get('/api/attendance/devices', (req, res) => {
    db.all("SELECT * FROM devices", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/attendance/register-device', (req, res) => {
    const { deviceToken, username } = req.body;
    if (!deviceToken || !username) {
        return res.status(400).json({ error: 'Chybí token nebo jméno.' });
    }
    db.run("INSERT OR REPLACE INTO devices (device_token, username) VALUES (?, ?)", [deviceToken.trim(), username.trim()], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Zařízení úspěšně registrováno' });
    });
});

app.delete('/api/attendance/devices/:token', (req, res) => {
    const { token } = req.params;
    db.run("DELETE FROM devices WHERE device_token = ?", [token], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Zařízení odebráno' });
    });
});

app.get('/api/attendance/latest', (req, res) => {
    const query = `
        SELECT a.* FROM attendance a
        JOIN (
            SELECT username, MAX(id) as max_id
            FROM attendance
            GROUP BY username
        ) latest ON a.id = latest.max_id
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/attendance/nfc-tap', (req, res) => {
    const { deviceToken } = req.body;
    if (!deviceToken) return res.status(400).json({ error: 'Chybí token zařízení.' });

    db.get("SELECT * FROM devices WHERE device_token = ?", [deviceToken], (err, device) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!device) {
            return res.json({ needsRegistration: true });
        }

        const username = device.username;

        db.get("SELECT type FROM attendance WHERE username = ? ORDER BY id DESC LIMIT 1", [username], (err, lastLog) => {
            if (err) return res.status(500).json({ error: err.message });

            const nextType = (lastLog && lastLog.type === 'Příchod') ? 'Odchod' : 'Příchod';
            
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Europe/Prague',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            const parts = formatter.formatToParts(now);
            const getPart = (type) => parts.find(p => p.type === type)?.value || '';

            const dateString = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
            const timeString = `${getPart('hour')}:${getPart('minute')}`;

            db.run(
                "INSERT INTO attendance (username, device_token, type, time, date) VALUES (?, ?, ?, ?, ?)",
                [username, deviceToken, nextType, timeString, dateString],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({
                        username: username,
                        type: nextType,
                        time: timeString
                    });
                }
            );
        });
    });
});

// --- GENERÁTOR ICS KALENDÁŘE ---
app.get('/calendar.ics', (req, res) => {
    db.all("SELECT * FROM attendance ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).send('Chyba databáze');

        let ics = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//PofelGarage//Dochazka//CS\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\n";

        rows.forEach(row => {
            const cleanDate = row.date.replace(/-/g, '');
            const cleanTime = row.time.replace(':', '') + '00';

            ics += "BEGIN:VEVENT\n";
            ics += `UID:attendance-${row.id}@pofelgarage\n`;
            ics += `DTSTAMP:${cleanDate}T${cleanTime}Z\n`;
            ics += `DTSTART:${cleanDate}T${cleanTime}Z\n`;
            ics += `DTEND:${cleanDate}T${cleanTime}Z\n`;
            ics += `SUMMARY:${row.type} - ${row.username}\n`;
            ics += `DESCRIPTION:Zaznamenáno přes NFC v ${row.time} (${row.username})\n`;
            ics += "END:VEVENT\n";
        });

        ics += "END:VCALENDAR";

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline; filename="dochazka.ics"');
        res.send(ics);
    });
});

// --- API ENDPOINTY: VOZIDLA A FOTKY ---
app.get('/api/vehicles', (req, res) => {
    db.all("SELECT * FROM vehicles ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/completed-jobs', (req, res) => {
    db.all("SELECT * FROM completed_jobs ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.put('/api/completed-jobs/:id', (req, res) => {
    let { work_done, cost_expenses, final_price, completed_by } = req.body;
    if (!work_done || cost_expenses === undefined || final_price === undefined) {
        return res.status(400).json({ error: 'Vyplňte všechna finanční a pracovní pole.' });
    }
    const expenses = parseFloat(cost_expenses) || 0;
    const price = parseFloat(final_price) || 0;
    const netProfit = price - expenses;

    db.run(
        `UPDATE completed_jobs SET work_done = ?, cost_expenses = ?, final_price = ?, net_profit = ?, completed_by = ? WHERE id = ?`,
        [work_done.trim(), expenses, price, netProfit, completed_by ? completed_by.trim() : 'Neznámý', req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Zakázka v archivu aktualizována', netProfit });
        }
    );
});

app.delete('/api/completed-jobs/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM completed_jobs WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Zakázka smazána z archivu' });
    });
});

app.post('/api/vehicles', (req, res) => {
    let { spz, model, status, note, phone, user, mechanic, workDone, costExpenses, finalPrice } = req.body;
    if (!spz || !model || !status || !phone) {
        return res.status(400).json({ error: 'Vyplňte všechna povinná pole včetně telefonu.' });
    }

    spz = spz.trim().toUpperCase();
    phone = phone.trim();
    const shortUser = user ? user.trim() : 'mechanik';
    const assignedMechanic = mechanic ? mechanic.trim() : shortUser;
    const cleanNote = note || '';

    if (status === 'Opraveno - připraveno k vyzvednutí') {
        if (!workDone || costExpenses === undefined || finalPrice === undefined) {
            return res.status(400).json({ error: 'Pro dokončení zakázky je nutné vyplnit provedenou práci, náklady a konečnou cenu pro zákazníka!' });
        }

        const expenses = parseFloat(costExpenses) || 0;
        const price = parseFloat(finalPrice) || 0;
        const netProfit = price - expenses;

        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Europe/Prague',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(now);
        const getPart = (type) => parts.find(p => p.type === type)?.value || '';
        const completedAt = `${getPart('year')}-${getPart('month')}-${getPart('day')} ${getPart('hour')}:${getPart('minute')}`;

        db.run(
            `INSERT INTO completed_jobs (spz, model, phone, work_done, cost_expenses, final_price, net_profit, completed_by, completed_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [spz, model, phone, workDone.trim(), expenses, price, netProfit, assignedMechanic, completedAt],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });

                db.run("DELETE FROM vehicles WHERE spz = ?", [spz], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Zakázka úspěšně dokončena a uložena do archivu!', netProfit });
                });
            }
        );
    } else {
        const query = `
            INSERT INTO vehicles (spz, model, status, note, phone, created_by, updated_by, mechanic)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(spz) DO UPDATE SET
                model = excluded.model,
                status = excluded.status,
                note = excluded.note,
                phone = excluded.phone,
                updated_by = excluded.updated_by,
                mechanic = excluded.mechanic
        `;

        db.run(query, [spz, model, status, cleanNote, phone, shortUser, shortUser, assignedMechanic], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Vozidlo úspěšně uloženo', action: 'saved' });
        });
    }
});

app.delete('/api/vehicles/:id', (req, res) => {
    const { id } = req.params;
    db.all("SELECT photo_path FROM vehicle_photos WHERE vehicle_id = ?", [id], (err, rows) => {
        if (rows) {
            rows.forEach(r => {
                const fullPath = path.join(__dirname, r.photo_path);
                if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            });
        }
        db.run("DELETE FROM vehicle_photos WHERE vehicle_id = ?", [id], () => {
            db.run("DELETE FROM vehicles WHERE id = ?", [id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Vozidlo smazáno' });
            });
        });
    });
});

// --- API PRO FOTKY ---
app.get('/api/vehicles/:id/photos', (req, res) => {
    db.all("SELECT * FROM vehicle_photos WHERE vehicle_id = ?", [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/vehicles/:id/photos', (req, res) => {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Chybí obrazová data.' });

    const matches = imageBase64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        return res.status(400).json({ error: 'Neplatný formát obrázku.' });
    }

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const base64Data = matches[2];
    const uniqueFilename = 'car_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7) + '.' + ext;
    const filePath = path.join(uploadDir, uniqueFilename);

    fs.writeFile(filePath, base64Data, 'base64', (err) => {
        if (err) return res.status(500).json({ error: 'Chyba při ukládání souboru.' });

        const dbPath = '/uploads/' + uniqueFilename;
        db.run("INSERT INTO vehicle_photos (vehicle_id, photo_path) VALUES (?, ?)", [req.params.id, dbPath], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Fotka úspěšně nahrána', id: this.lastID, photo_path: dbPath });
        });
    });
});

app.delete('/api/photos/:id', (req, res) => {
    db.get("SELECT * FROM vehicle_photos WHERE id = ?", [req.params.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Fotka nenalezena.' });

        const fullPath = path.join(__dirname, row.photo_path);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }

        db.run("DELETE FROM vehicle_photos WHERE id = ?", [req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Fotka smazána' });
        });
    });
});

// --- ROUTA PRO NFC STRÁNKU ---
app.get('/nfc', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Docházka - PofelGarage</title>
    <style>
        :root { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 0; }
        .container { max-width: 400px; margin: 5vh auto; padding: 20px; text-align: center; }
        .card { background: #1e293b; border-radius: 16px; padding: 25px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); border: 1px solid #334155; }
        .badge { display: inline-block; padding: 8px 16px; border-radius: 8px; font-size: 20px; font-weight: bold; margin: 15px 0; background: #334155; }
        .token-box { background: #0f172a; color: #38bdf8; font-family: monospace; font-size: 15px; padding: 10px; border-radius: 8px; margin: 8px 0; border: 1px solid #334155; user-select: all; word-break: break-all; }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h2>⏱️ PofelGarage Docházka</h2>
            <div style="margin: 15px 0; text-align: left;">
                <label style="font-size: 12px; color: #94a3b8; font-weight: bold;">Token tohoto zařízení:</label>
                <div id="token-box" class="token-box">Načítání...</div>
            </div>
            <div id="status-msg" style="margin-top: 15px; color: #94a3b8; font-size: 15px;">Zpracovávám docházku...</div>
            <div id="result-section" style="display: none;">
                <h1 id="res-username" style="color: #38bdf8; margin: 10px 0;"></h1>
                <div><span id="res-type" class="badge"></span></div>
                <p style="color: #cbd5e1; font-size: 14px; margin-top: 10px;">Čas: <strong id="res-time"></strong></p>
            </div>
        </div>
    </div>
    <script>
        let deviceToken = localStorage.getItem('deviceToken');
        if (!deviceToken) {
            deviceToken = 'dev_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
            localStorage.setItem('deviceToken', deviceToken);
        }
        document.getElementById('token-box').innerText = deviceToken;

        async function tapNfc() {
            try {
                const res = await fetch('/api/attendance/nfc-tap', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deviceToken })
                });
                const data = await res.json();
                const statusMsg = document.getElementById('status-msg');

                if (data.needsRegistration) {
                    statusMsg.innerHTML = '<span style="color: #f87171;">⛔ Zařízení není v databázi autorizováno.<br>Zkopírujte token výše a schvalte ho v administraci.</span>';
                    return;
                }

                if (res.ok) {
                    statusMsg.style.display = 'none';
                    document.getElementById('res-username').innerText = data.username;
                    const typeEl = document.getElementById('res-type');
                    typeEl.innerText = data.type + ' (' + data.time + ')';
                    typeEl.style.background = data.type === 'Příchod' ? '#16a34a' : '#ca8a04';
                    document.getElementById('res-time').innerText = data.time + ' (' + data.type + ')';
                    document.getElementById('result-section').style.display = 'block';
                } else {
                    statusMsg.innerHTML = '<span style="color: #f87171;">Chyba: ' + (data.error || 'Neznámá chyba') + '</span>';
                }
            } catch (err) {
                statusMsg.innerHTML = '<span style="color: #f87171;">Chyba připojení k serveru.</span>';
            }
        }
        tapNfc();
    </script>
</body>
</html>`);
});

// Přihlášení pro mechaniky
app.post('/api/login', (req, res) => {
    let { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Zadejte uživatelské jméno a heslo.' });
    }

    db.get("SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND password = ?", [username.trim(), password], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) {
            return res.status(401).json({ error: 'Nesprávné jméno nebo heslo.' });
        }
        res.json({ message: 'Přihlášení úspěšné', username: row.username });
    });
});

// --- PWA MANIFEST & SERVICE WORKER ---
app.get('/manifest.json', (req, res) => {
    res.json({
        name: "PofelGarage - Registr Vozidel",
        short_name: "PofelGarage",
        start_url: "/",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#2563eb",
        icons: [{
            src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%232563eb'%3E%3Cpath d='M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.22.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3zM19 17H5v-4.66l.12-.34h13.76l.12.34V17z'/%3E%3C/svg%3E",
            sizes: "192x192 512x512",
            type: "image/svg+xml",
            purpose: "any maskable"
        }]
    });
});

app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
        self.addEventListener('install', (e) => { self.skipWaiting(); });
        self.addEventListener('activate', (e) => { e.waitUntil(clients.claim()); });
        self.addEventListener('fetch', (e) => { e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); });
    `);
});

// --- KLIENTSKÝ PORTÁL ( / ) ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PofelGarage - Stav vozidla</title>
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#2563eb">
    <script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');</script>
    <style>
        :root { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .card { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 15px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); border: 1px solid #334155; }
        input, button { width: 100%; padding: 14px; margin: 8px 0; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #fff; box-sizing: border-box; font-size: 16px; }
        button { background: #2563eb; color: white; border: none; font-weight: bold; cursor: pointer; transition: background 0.2s; }
        button:hover { background: #1d4ed8; }
        .badge { display: inline-block; padding: 6px 12px; border-radius: 6px; font-size: 14px; font-weight: bold; background: #334155; margin-top: 10px; }
        .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        .admin-link { color: #38bdf8; text-decoration: none; font-size: 14px; }
        .info-text { color: #94a3b8; font-size: 14px; margin-bottom: 15px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="top-bar">
            <h2>🚗 PofelGarage - Stav vozidla</h2>
            <a href="/admin.html" class="admin-link">🔒 Mechanici</a>
        </div>
        <div class="card">
            <h3>Zadejte SPZ vašeho vozidla</h3>
            <p class="info-text">Zadejte registrační značku (např. 1AB2345) pro zobrazení aktuálního stavu opravy.</p>
            <form id="search-form">
                <input type="text" id="search-spz" placeholder="SPZ vozidla" required style="text-transform: uppercase;">
                <button type="submit">Zobrazit stav</button>
            </form>
        </div>
        <div id="result-container"></div>
    </div>
    <script>
        document.getElementById('search-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const querySpz = document.getElementById('search-spz').value.trim().toUpperCase();
            const resultEl = document.getElementById('result-container');
            resultEl.innerHTML = '<p style="color: #94a3b8; text-align: center;">Hledám vozidlo...</p>';

            try {
                const res = await fetch('/api/vehicles');
                const vehicles = await res.json();
                const vehicle = vehicles.find(v => v.spz.toUpperCase() === querySpz);

                if (!vehicle) {
                    resultEl.innerHTML = '<div class="card" style="border-color: #dc2626;"><p style="color: #f87171; margin: 0;">Vozidlo s SPZ <strong>' + querySpz + '</strong> nebylo v databázi servisu nalezeno.</p></div>';
                    return;
                }

                resultEl.innerHTML = \`
                    <div class="card" style="border-color: #2563eb;">
                        <h3 style="margin: 0 0 10px 0;">Vozidlo: \${vehicle.spz} (\${vehicle.model})</h3>
                        <p style="margin: 5px 0; color: #cbd5e1;">Aktuální stav:</p>
                        <div><span class="badge" style="background: #1e40af; color: #bfdbfe; font-size: 16px;">\${vehicle.status}</span></div>
                        \${vehicle.note ? \`<p style="margin: 15px 0 5px 0; color: #cbd5e1;"><strong>Poznámka servisu:</strong> \${vehicle.note}</p>\` : ''}
                        <div style="margin-top: 20px;">
                            <a href="tel:+420601551770" style="display:block; background: #16a34a; color:white; padding:12px; border-radius:8px; text-align:center; text-decoration:none; font-weight:bold;">📞 Zavolat do servisu</a>
                        </div>
                    </div>
                \`;
            } catch (err) {
                resultEl.innerHTML = '<div class="card"><p style="color: #f87171;">Chyba při komunikaci se serverem.</p></div>';
            }
        });
    </script>
</body>
</html>`);
});

// --- ADMINISTRACE S MODÁLNÍM OKNEM PRO FOTKY ( /admin.html ) ---
app.get('/admin.html', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>PofelGarage - Administrace mechaniků</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 16px; }
        .container { max-width: 600px; margin: auto; }
        h1, h2, h3 { color: #38bdf8; }
        .hidden { display: none !important; }
        .form-group { margin-bottom: 12px; }
        label { display: block; margin-bottom: 4px; font-weight: 600; font-size: 13px; color: #94a3b8; }
        input, select, textarea { width: 100%; padding: 10px; border: 1px solid #475569; background: #0f172a; color: white; border-radius: 6px; font-size: 15px; }
        .btn { background: #2563eb; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-size: 16px; width: 100%; font-weight: bold; text-align: center; display: inline-block; text-decoration: none; }
        .btn:hover { background: #1d4ed8; }
        .card-list { display: flex; flex-direction: column; gap: 12px; margin-top: 15px; }
        .car-card { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 14px; }
        .car-header { display: flex; justify-content: space-between; align-items: center; font-size: 16px; font-weight: bold; color: #38bdf8; margin-bottom: 8px; }
        .car-row { font-size: 13px; margin-bottom: 6px; color: #cbd5e1; }
        .card-actions-row { display: flex; gap: 6px; margin-top: 10px; }
        .btn-call { background: #16a34a; color: white; padding: 8px; border-radius: 6px; text-align: center; text-decoration: none; flex: 1; font-weight: bold; font-size: 12px; }
        .btn-sms { background: #0ea5e9; color: white; padding: 8px; border-radius: 6px; text-align: center; text-decoration: none; flex: 1; font-weight: bold; font-size: 12px; }
        .btn-edit { background: #eab308; color: #000; border: none; padding: 8px; border-radius: 6px; font-weight: bold; flex: 1; cursor: pointer; font-size: 12px; }
        .btn-delete { background: #dc2626; color: #fff; border: none; padding: 8px; border-radius: 6px; font-weight: bold; flex: 1; cursor: pointer; font-size: 12px; }
        
        .top-nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 13px; background: #1e293b; padding: 12px 16px; border-radius: 10px; border: 1px solid #334155; }
        
        .tabs-bar { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 20px; padding-bottom: 4px; }
        .tab-btn { background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 10px 14px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 13px; white-space: nowrap; transition: all 0.2s; }
        .tab-btn:hover { background: #334155; color: #fff; }
        .tab-btn.active { background: #2563eb; color: #fff; border-color: #3b82f6; }

        .error-msg { color: #f87171; font-size: 14px; margin-top: 5px; }
        .calendar-box { background: #0f172a; padding: 10px; border-radius: 6px; border: 1px solid #334155; font-family: monospace; font-size: 13px; color: #38bdf8; word-break: break-all; margin-top: 5px; user-select: all; }
        
        .section-box { background: #1e293b; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 1px solid #334155; margin-bottom: 20px; }
        
        .progress-bar-container { background: #334155; border-radius: 4px; overflow: hidden; height: 12px; margin: 8px 0; display: flex; }
        .progress-fill-profit { background: #16a34a; height: 100%; }
        .progress-fill-cost { background: #dc2626; height: 100%; }

        /* Styly pro modální okno (fotogalerii) */
        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
        .modal-content { background: #1e293b; border: 1px solid #334155; border-radius: 12px; width: 100%; max-width: 500px; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .modal-header { padding: 15px 20px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; background: #0f172a; }
        .modal-body { padding: 20px; overflow-y: auto; flex: 1; }
    </style>
</head>
<body>

<div class="container">
    <!-- PŘIHLÁŠENÍ MECHANIKA -->
    <div id="loginView" class="section-box">
        <h1 style="text-align: center;">PofelGarage - Mechanici</h1>
        <p style="text-align: center; font-size: 13px; color: #94a3b8;">Zadejte své přihlašovací údaje (např. <b>StSi</b>)</p>
        <form id="login-form">
            <div class="form-group">
                <label>Uživatelské jméno:</label>
                <input type="text" id="loginUser" placeholder="např. StSi" required autocomplete="off" style="text-align: center; font-weight: bold; font-size: 18px;">
            </div>
            <div class="form-group">
                <label>Heslo:</label>
                <input type="password" id="loginPass" placeholder="Zadejte heslo" required style="text-align: center; font-size: 18px;">
            </div>
            <button type="submit" class="btn">Přihlásit se do administrace</button>
            <div id="login-error" class="error-msg" style="text-align: center;"></div>
        </form>
        <a href="/" class="btn" style="background: #475569; margin-top: 10px; display: block;">← Zpět na zákaznický portál</a>
    </div>

    <!-- ADMINISTRACE (Po přihlášení) -->
    <div id="mechanicView" class="hidden">
        <div class="top-nav">
            <span>Mechanik: <strong id="loggedUserDisplay"></strong></span>
            <a href="#" onclick="logout()" style="color: #f87171; font-weight: bold; text-decoration: none;">Odhlásit</a>
        </div>

        <!-- HLAVNÍ NAVIGAČNÍ ZÁLOŽKY -->
        <div class="tabs-bar" id="mainTabsBar">
            <button class="tab-btn active" onclick="switchTab('zakazky', this)">🚗 Zakázky</button>
            <button class="tab-btn" onclick="switchTab('finance', this)">📊 Finance</button>
            <button class="tab-btn" onclick="switchTab('archiv', this)">📂 Archiv</button>
            <button class="tab-btn admin-only hidden" onclick="switchTab('uzivatele', this)">👥 Uživatelé</button>
            <button class="tab-btn admin-only hidden" onclick="switchTab('nfc', this)">📱 NFC & Docházka</button>
        </div>

        <!-- 1. SEKCE: SPRÁVA ZAKÁZEK -->
        <div id="tab-zakazky" class="section-box">
            <h1>Správa zakázek</h1>
            <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 20px;">
                <h3 id="formTitle" style="margin-top:0; font-size:15px;">Přidat vozidlo / Upravit</h3>
                <form id="vehicleForm" onsubmit="saveVehicle(event)">
                    <div class="form-group">
                        <label>SPZ:</label>
                        <input type="text" id="spz" required style="text-transform: uppercase;">
                    </div>
                    <div class="form-group">
                        <label>Model vozidla:</label>
                        <input type="text" id="model" required>
                    </div>
                    <div class="form-group">
                        <label>Telefon na zákazníka (povinné):</label>
                        <input type="tel" id="phone" required placeholder="+420 123 456 789">
                    </div>
                    <div class="form-group">
                        <label>Přiřadit mechanikovi:</label>
                        <select id="assignedMechanic" required></select>
                    </div>
                    <div class="form-group">
                        <label>Stav opravy:</label>
                        <select id="status" required onchange="toggleFinanceFields()">
                            <option value="Přijato do servisu">Přijato do servisu</option>
                            <option value="Probíhá oprava">Probíhá oprava</option>
                            <option value="Čeká se na díly">Čeká se na díly</option>
                            <option value="Opraveno - připraveno k vyzvednutí">Opraveno - připraveno k vyzvednutí (Dokončit)</option>
                            <option value="Vozidlo se nenachází v servise">Vozidlo se nenachází v servise</option>
                        </select>
                    </div>

                    <div id="financeFields" class="hidden" style="background: #1e293b; padding: 12px; border-radius: 6px; border: 1px solid #16a34a; margin-bottom: 12px;">
                        <h4 style="margin: 0 0 10px 0; color: #16a34a; font-size: 14px;">💰 Finanční uzávěrka zakázky</h4>
                        <div class="form-group">
                            <label>Popis provedené práce:</label>
                            <textarea id="workDone" rows="2" placeholder="Např. výměna brzdových destiček, olej..."></textarea>
                        </div>
                        <div class="form-group">
                            <label>Náklady (materiál / díly) v Kč:</label>
                            <input type="number" step="0.01" id="costExpenses" placeholder="0">
                        </div>
                        <div class="form-group">
                            <label>Konečná částka placená zákazníkem v Kč:</label>
                            <input type="number" step="0.01" id="finalPrice" placeholder="0">
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Poznámka:</label>
                        <textarea id="note" rows="2"></textarea>
                    </div>
                    <button type="submit" class="btn">Uložit do karet / Dokončit</button>
                </form>
            </div>

            <h3>Seznam aktivních vozidel v servisu</h3>
            <div id="mechanicCardList" class="card-list"></div>
        </div>

        <!-- 2. SEKCE: VÝKON A FINANCE -->
        <div id="tab-finance" class="section-box hidden">
            <h2 style="color: #38bdf8; margin-top: 0;">📊 Výkon a finance mechaniků</h2>
            <div id="mechanicsStatsContainer" style="display: flex; flex-direction: column; gap: 12px; margin-top: 10px;"></div>
        </div>

        <!-- 3. SEKCE: ARCHIV ZAKÁZEK -->
        <div id="tab-archiv" class="section-box hidden" style="border-color: #16a34a;">
            <h2 style="color: #16a34a; margin-top: 0;">📂 Trvalý archiv dokončených zakázek</h2>
            <div class="form-group" style="margin-top: 10px;">
                <input type="text" id="archiveSearch" placeholder="🔍 Vyhledat v archivu dle SPZ..." oninput="renderCompletedArchive()" style="text-transform: uppercase;">
            </div>
            <div id="completedArchiveList" class="card-list" style="max-height: 500px; overflow-y: auto;"></div>
        </div>

        <!-- 4. SEKCE: SPRÁVA UŽIVATELŮ (Pouze StSi) -->
        <div id="tab-uzivatele" class="section-box hidden" style="border-color: #38bdf8;">
            <h2 style="color: #38bdf8; margin-top: 0;">👥 Správa uživatelů</h2>
            <form id="new-user-form" style="margin-top: 10px;">
                <div class="form-group">
                    <label>Uživatelské jméno:</label>
                    <input type="text" id="new-username-input" placeholder="např. Frantisek" required autocomplete="off">
                </div>
                <div class="form-group">
                    <label>Heslo:</label>
                    <input type="password" id="new-password-input" placeholder="Zadejte heslo" required autocomplete="off">
                </div>
                <button type="submit" class="btn" style="background: #2563eb;">Vytvořit uživatele</button>
            </form>
            <h3 style="color: #f8fafc; font-size: 14px; margin-top: 20px;">Seznam registrovaných uživatelů:</h3>
            <div id="users-list-admin" style="margin-top: 5px;">Načítání uživatelů...</div>
        </div>

        <!-- 5. SEKCE: NFC & DOCHÁZKA (Pouze StSi) -->
        <div id="tab-nfc" class="section-box hidden" style="border-color: #16a34a;">
            <h2 style="color: #16a34a; margin-top: 0;">📱 NFC & Docházka</h2>
            <h3 style="margin-top:0; font-size:15px; color: #16a34a;">📅 Odkaz na kalendář docházky</h3>
            <div id="calendar-link-box" class="calendar-box">Načítám odkaz...</div>

            <h3 style="margin-top:20px; font-size:15px; color: #16a34a;">📱 Schválení nového NFC zařízení</h3>
            <form id="new-device-form" style="margin-top: 10px;">
                <div class="form-group">
                    <label>Token zařízení:</label>
                    <input type="text" id="device-token-input" placeholder="např. dev_..." required autocomplete="off">
                </div>
                <div class="form-group">
                    <label>Jméno uživatele / Umístění:</label>
                    <input type="text" id="device-username" placeholder="např. Pavel" required autocomplete="off">
                </div>
                <button type="submit" class="btn" style="background: #16a34a;">Schválit a přidat zařízení</button>
            </form>

            <h3 style="color: #f8fafc; font-size: 14px; margin-top: 20px;">Poslední stavy uživatelů (Živě 1s):</h3>
            <div id="attendance-latest-list" style="margin-top: 5px; font-size: 13px; color: #cbd5e1;">Načítám docházku...</div>

            <h3 style="color: #f8fafc; font-size: 14px; margin-top: 20px;">Seznam schválených zařízení:</h3>
            <div id="nfc-devices-list" style="margin-top: 5px;">Načítání zařízení...</div>
        </div>

    </div>
</div>

<!-- MODÁLNÍ OKNO PRO FOTODOKUMENTACI -->
<div id="photoModal" class="modal-overlay hidden">
    <div class="modal-content">
        <div class="modal-header">
            <h3 id="modalTitle" style="margin:0; font-size:16px; color:#38bdf8;">Fotodokumentace vozidla</h3>
            <button onclick="closePhotoModal()" style="background: #dc2626; color: white; border: none; border-radius: 4px; padding: 4px 10px; font-weight: bold; cursor: pointer; font-size: 12px;">Zavřít</button>
        </div>
        <div class="modal-body">
            <div style="margin-bottom: 12px;">
                <label style="background: #2563eb; color: white; padding: 10px; border-radius: 6px; text-align: center; display: block; font-weight: bold; cursor: pointer; font-size: 14px;">
                    📷 Vyfotit / Nahrát novou fotku <input type="file" accept="image/*" onchange="uploadModalPhoto(this)" style="display: none;">
                </label>
            </div>
            <div id="modalPhotoList" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">Načítám fotky...</div>
        </div>
    </div>
</div>

<script>
    let currentUser = localStorage.getItem('pofelGarageUser') || '';
    let allVehicles = [];
    let completedJobs = [];
    let allUsers = [];
    let attendanceInterval = null;
    let activeModalCarId = null;

    document.getElementById('calendar-link-box').innerText = window.location.origin + '/calendar.ics';

    window.addEventListener('DOMContentLoaded', () => {
        if (currentUser) {
            setupActiveSession(currentUser);
        }
    });

    function setupActiveSession(username) {
        currentUser = username;
        document.getElementById('loggedUserDisplay').innerText = currentUser;
        document.getElementById('loginView').classList.add('hidden');
        document.getElementById('mechanicView').classList.remove('hidden');

        const adminElements = document.querySelectorAll('.admin-only');
        if (currentUser.toLowerCase() === 'stsi') {
            adminElements.forEach(el => el.classList.remove('hidden'));
            loadNfcDevices();
            loadAttendanceSummary();
            loadAdminUsersList();

            if (attendanceInterval) clearInterval(attendanceInterval);
            attendanceInterval = setInterval(loadAttendanceSummary, 1000);
        } else {
            adminElements.forEach(el => el.classList.add('hidden'));
            if (attendanceInterval) clearInterval(attendanceInterval);
        }

        loadUsersAndData();
    }

    function switchTab(tabId, btnElement) {
        const sections = ['zakazky', 'finance', 'archiv', 'uzivatele', 'nfc'];
        sections.forEach(sec => {
            const el = document.getElementById('tab-' + sec);
            if (el) el.classList.add('hidden');
        });

        const target = document.getElementById('tab-' + tabId);
        if (target) target.classList.remove('hidden');

        const buttons = document.querySelectorAll('.tab-btn');
        buttons.forEach(b => b.classList.remove('active'));
        if (btnElement) btnElement.classList.add('active');

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function toggleFinanceFields() {
        const statusVal = document.getElementById('status').value;
        const financeBox = document.getElementById('financeFields');
        if (statusVal === 'Opraveno - připraveno k vyzvednutí') {
            financeBox.classList.remove('hidden');
            document.getElementById('workDone').required = true;
            document.getElementById('costExpenses').required = true;
            document.getElementById('finalPrice').required = true;
        } else {
            financeBox.classList.add('hidden');
            document.getElementById('workDone').required = false;
            document.getElementById('costExpenses').required = false;
            document.getElementById('finalPrice').required = false;
        }
    }

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const userInput = document.getElementById('loginUser').value.trim();
        const passInput = document.getElementById('loginPass').value;
        const errorEl = document.getElementById('login-error');
        errorEl.innerText = '';

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: userInput, password: passInput })
            });
            const data = await res.json();
            if (!res.ok) {
                errorEl.innerText = data.error || 'Přihlášení selhalo.';
                return;
            }

            currentUser = data.username;
            localStorage.setItem('pofelGarageUser', currentUser);
            setupActiveSession(currentUser);

        } catch (err) {
            errorEl.innerText = 'Chyba připojení k serveru.';
        }
    });

    function logout() {
        if (attendanceInterval) clearInterval(attendanceInterval);
        localStorage.removeItem('pofelGarageUser');
        location.reload();
    }

    async function loadUsersAndData() {
        try {
            const usersRes = await fetch('/api/users');
            allUsers = await usersRes.json();
            
            const mechSelect = document.getElementById('assignedMechanic');
            mechSelect.innerHTML = allUsers.map(u => \`<option value="\${u.username}">\${u.username}</option>\`).join('');
            mechSelect.value = currentUser;
        } catch (e) {
            console.error('Chyba při načítání uživatelů');
        }

        fetch('/api/vehicles')
            .then(res => res.json())
            .then(data => {
                allVehicles = data;
                renderMechanicCards();
            });

        fetch('/api/completed-jobs')
            .then(res => res.json())
            .then(data => {
                completedJobs = data;
                renderCompletedArchive();
                renderMechanicsStats();
            });
    }

    function saveVehicle(e) {
        e.preventDefault();
        const statusVal = document.getElementById('status').value;
        
        const payload = {
            spz: document.getElementById('spz').value.trim(),
            model: document.getElementById('model').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            mechanic: document.getElementById('assignedMechanic').value,
            status: statusVal,
            note: document.getElementById('note').value.trim(),
            user: currentUser,
            workDone: document.getElementById('workDone').value.trim(),
            costExpenses: document.getElementById('costExpenses').value,
            finalPrice: document.getElementById('finalPrice').value
        };

        fetch('/api/vehicles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(res => {
            if (res.error) {
                alert(res.error);
                return;
            }
            if (statusVal === 'Opraveno - připraveno k vyzvednutí') {
                alert('Zakázka dokončena! Čistý zisk: ' + res.netProfit + ' Kč. Uloženo do archivu.');
            }
            document.getElementById('vehicleForm').reset();
            document.getElementById('financeFields').classList.add('hidden');
            document.getElementById('assignedMechanic').value = currentUser;
            loadUsersAndData();
        });
    }

    function renderMechanicCards() {
        const container = document.getElementById('mechanicCardList');
        if (allVehicles.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:#94a3b8;">Žádná aktivní vozidla v servisu.</p>';
            return;
        }

        container.innerHTML = '';
        allVehicles.forEach(car => {
            const smsText = encodeURIComponent('Dobrý den, vaše vozidlo (' + car.spz + ') je v stavu: ' + car.status + '. Děkuji.');
            const safeModel = (car.model || '').replace(/'/g, "\\\\'");
            const safeNote = (car.note || '').replace(/'/g, "\\\\\\'").replace(/\\n/g, ' ');
            const assignedMech = car.mechanic || '-';
            
            container.innerHTML += \`
                <div class="car-card">
                    <div class="car-header">
                        <span>\${car.spz}</span>
                        <span style="font-size: 13px; color: #38bdf8; font-weight: normal;">\${car.model}</span>
                    </div>
                    <div class="car-row"><strong>Stav:</strong> <span style="color:#38bdf8;">\${car.status}</span></div>
                    <div class="car-row"><strong>Přiřazeno mechanikovi:</strong> <span style="color: #16a34a; font-weight: bold;">\${assignedMech}</span></div>
                    <div class="car-row"><strong>Telefon:</strong> <a href="tel:\${car.phone}" style="color: #38bdf8;">\${car.phone}</a></div>
                    <div class="car-row"><strong>Poznámka:</strong> \${car.note || '-'}</div>
                    <div class="car-row" style="font-size: 11px; color: #94a3b8; margin-top: 4px;">Založil/Upravil: \${car.updated_by || '-'}</div>
                    
                    <div class="card-actions-row">
                        <a href="tel:\${car.phone}" class="btn-call">📞 Zavolat</a>
                        <a href="sms:\${car.phone}?body=\${smsText}" class="btn-sms">💬 SMS</a>
                        <button class="btn-edit" onclick="editCar('\${car.spz}', '\${safeModel}', '\${car.status}', '\${safeNote}', '\${car.phone}', '\${assignedMech}')">Upravit</button>
                        <button class="btn-delete" onclick="deleteCar(\${car.id})">Smazat</button>
                    </div>

                    <button onclick="openPhotoModal(\${car.id}, '\${car.spz}')" style="background: #334155; color: #38bdf8; border: 1px solid #475569; padding: 8px; border-radius: 6px; width: 100%; margin-top: 8px; font-size: 13px; font-weight: bold; cursor: pointer;">📷 Fotodokumentace</button>
                </div>
            \`;
        });
    }

    // --- FUNKCE PRO MODÁLNÍ OKNO FOTEK ---
    async function openPhotoModal(carId, spz) {
        activeModalCarId = carId;
        document.getElementById('modalTitle').innerText = 'Fotodokumentace vozidla: ' + spz;
        document.getElementById('photoModal').classList.remove('hidden');
        loadModalPhotos(carId);
    }

    function closePhotoModal() {
        document.getElementById('photoModal').classList.add('hidden');
        activeModalCarId = null;
    }

    async function loadModalPhotos(carId) {
        const listEl = document.getElementById('modalPhotoList');
        listEl.innerHTML = '<span style="color:#94a3b8; font-size:13px;">Načítám fotky...</span>';
        try {
            const res = await fetch('/api/vehicles/' + carId + '/photos');
            const photos = await res.json();
            if (photos.length === 0) {
                listEl.innerHTML = '<span style="color: #94a3b8; font-size: 13px;">Zatím žádné fotky u tohoto vozidla.</span>';
                return;
            }
            listEl.innerHTML = photos.map(p => \`
                <div style="position: relative; display: inline-block;">
                    <a href="\${p.photo_path}" target="_blank">
                        <img src="\${p.photo_path}" style="width: 90px; height: 90px; object-fit: cover; border-radius: 6px; border: 1px solid #475569;">
                    </a>
                    <button onclick="deleteModalPhoto(\${p.id})" style="position: absolute; top: -6px; right: -6px; background: #dc2626; color: white; border: none; border-radius: 50%; width: 24px; height: 24px; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: bold;">×</button>
                </div>
            \`).join('');
        } catch(e) {
            listEl.innerHTML = '<span style="color:#f87171; font-size:13px;">Chyba při načítání fotek.</span>';
        }
    }

    function uploadModalPhoto(inputEl) {
        if (!activeModalCarId) return;
        const file = inputEl.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async function(e) {
            const base64 = e.target.result;
            const res = await fetch('/api/vehicles/' + activeModalCarId + '/photos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: base64 })
            });
            if (res.ok) {
                inputEl.value = '';
                loadModalPhotos(activeModalCarId);
            } else {
                alert('Chyba při nahrávání fotky.');
            }
        };
        reader.readAsDataURL(file);
    }

    async function deleteModalPhoto(photoId) {
        if (!confirm('Opravdu smazat tuto fotku?')) return;
        const res = await fetch('/api/photos/' + photoId, { method: 'DELETE' });
        if (res.ok) {
            loadModalPhotos(activeModalCarId);
        }
    }

    function renderMechanicsStats() {
        const statsContainer = document.getElementById('mechanicsStatsContainer');
        statsContainer.innerHTML = '';

        const isAdmin = currentUser.toLowerCase() === 'stsi';
        let targetUsers = isAdmin ? allUsers : allUsers.filter(u => u.username.toLowerCase() === currentUser.toLowerCase());

        if (targetUsers.length === 0) {
            targetUsers = [{ username: currentUser }];
        }

        targetUsers.forEach(userObj => {
            const mechName = userObj.username;
            const mechJobs = completedJobs.filter(j => j.completed_by && j.completed_by.toLowerCase() === mechName.toLowerCase());
            const mechActive = allVehicles.filter(v => v.mechanic && v.mechanic.toLowerCase() === mechName.toLowerCase());

            let totalExpenses = 0;
            let totalRevenue = 0;
            let totalProfit = 0;

            mechJobs.forEach(j => {
                totalExpenses += j.cost_expenses;
                totalRevenue += j.final_price;
                totalProfit += j.net_profit;
            });

            let profitPercent = totalRevenue > 0 ? Math.max(0, Math.min(100, (totalProfit / totalRevenue) * 100)) : 0;
            let costPercent = totalRevenue > 0 ? Math.max(0, Math.min(100, (totalExpenses / totalRevenue) * 100)) : 0;

            let jobsHtml = '';
            if (mechJobs.length === 0) {
                jobsHtml = '<p style="color: #94a3b8; font-size: 13px;">Žádné dokončené zakázky.</p>';
            } else {
                jobsHtml = mechJobs.map(j => \`
                    <div style="background: #0f172a; padding: 8px; margin-bottom: 6px; border-radius: 6px; border: 1px solid #334155; font-size: 13px;">
                        <div><strong>\${j.spz}</strong> (\${j.model}) - <span style="color: #16a34a;">Zisk: \${j.net_profit} Kč</span></div>
                        <div style="color: #94a3b8; font-size: 12px;">Práce: \${j.work_done} | Náklady: \${j.cost_expenses} Kč | Cena: \${j.final_price} Kč</div>
                    </div>
                \`).join('');
            }

            statsContainer.innerHTML += \`
                <details style="background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px; cursor: pointer;">
                    <summary style="font-weight: bold; color: #38bdf8; outline: none; display: flex; justify-content: space-between; align-items: center;">
                        <span>👤 Mechanik: \${mechName}</span>
                        <span style="font-size: 13px; color: #16a34a;">Celkový zisk: \${totalProfit} Kč</span>
                    </summary>
                    <div style="margin-top: 12px; cursor: default; border-top: 1px solid #334155; pt: 10px;" onclick="event.stopPropagation()">
                        <div style="display: flex; gap: 15px; font-size: 13px; margin-bottom: 10px; color: #cbd5e1;">
                            <div>📦 Dokončeno zakázek: <strong>\${mechJobs.length}</strong></div>
                            <div>🚗 Aktivních v servisu: <strong>\${mechActive.length}</strong></div>
                        </div>
                        <div style="font-size: 13px; margin-bottom: 8px;">
                            <div>💸 Celkové náklady: <strong style="color: #f87171;">\${totalExpenses} Kč</strong></div>
                            <div>💵 Celkové tržby: <strong style="color: #38bdf8;">\${totalRevenue} Kč</strong></div>
                        </div>

                        <div style="font-size: 12px; color: #94a3b8; margin-top: 6px;">Vizuální poměr (Náklady vs Čistý zisk z tržeb):</div>
                        <div class="progress-bar-container">
                            <div class="progress-fill-profit" style="width: \${profitPercent}%;" title="Čistý zisk \${profitPercent.toFixed(1)}%"></div>
                            <div class="progress-fill-cost" style="width: \${costPercent}%;" title="Náklady \${costPercent.toFixed(1)}%"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-bottom: 12px;">
                            <span style="color: #16a34a;">■ Zisk (\${totalProfit} Kč)</span>
                            <span style="color: #dc2626;">■ Náklady (\${totalExpenses} Kč)</span>
                        </div>

                        <h4 style="margin: 10px 0 5px 0; font-size: 13px; color: #38bdf8;">Seznam dokončených zakázek:</h4>
                        <div>\${jobsHtml}</div>
                    </div>
                </details>
            \`;
        });
    }

    function renderCompletedArchive() {
        const container = document.getElementById('completedArchiveList');
        const searchInput = document.getElementById('archiveSearch');
        const filterVal = searchInput ? searchInput.value.trim().toUpperCase() : '';

        const filteredJobs = completedJobs.filter(job => job.spz.toUpperCase().includes(filterVal));

        if (filteredJobs.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:#94a3b8;">Žádné odpovídající zakázky v archivu.</p>';
            return;
        }

        container.innerHTML = '';
        filteredJobs.forEach(job => {
            const smsText = encodeURIComponent('Dobrý den, vaše vozidlo (' + job.spz + ') - archiv. Děkuji.');
            const safeWorkDone = (job.work_done || '').replace(/'/g, "\\\\'");
            const safeMech = (job.completed_by || '').replace(/'/g, "\\\\'");

            container.innerHTML += \`
                <div class="car-card" style="border-color: #16a34a;">
                    <div class="car-header">
                        <span>\${job.spz} (\${job.model})</span>
                        <span style="font-size: 12px; color: #16a34a; font-weight: bold;">Zisk: \${job.net_profit} Kč</span>
                    </div>
                    <div class="car-row"><strong>Provedená práce:</strong> \${job.work_done}</div>
                    <div class="car-row"><strong>Náklady:</strong> \${job.cost_expenses} Kč | <strong>Cena pro zákazníka:</strong> \${job.final_price} Kč</div>
                    <div class="car-row"><strong>Mechanik:</strong> <span style="color: #38bdf8; font-weight: bold;">\${job.completed_by}</span></div>
                    <div class="car-row"><strong>Telefon:</strong> <a href="tel:\${job.phone}" style="color: #38bdf8;">\${job.phone}</a></div>
                    <div class="car-row" style="font-size: 11px; color: #94a3b8; margin-top: 4px;">Uzavřel: \${job.completed_by} | Datum: \${job.completed_at}</div>

                    <div class="card-actions-row" style="margin-top: 10px;">
                        <a href="tel:\${job.phone}" class="btn-call">📞 Zavolat</a>
                        <a href="sms:\${job.phone}?body=\${smsText}" class="btn-sms">💬 SMS</a>
                        <button class="btn-edit" onclick="editCompletedJob(\${job.id}, '\${safeWorkDone}', \${job.cost_expenses}, \${job.final_price}, '\${safeMech}')">Upravit</button>
                        <button class="btn-delete" onclick="deleteCompletedJob(\${job.id})">Smazat</button>
                    </div>
                </div>
            \`;
        });
    }

    function editCompletedJob(id, currentWork, currentCost, currentPrice, currentMech) {
        const newWork = prompt('Upravit provedenou práci:', currentWork);
        if (newWork === null) return;
        const newCost = prompt('Upravit náklady (Kč):', currentCost);
        if (newCost === null) return;
        const newPrice = prompt('Upravit konečnou cenu pro zákazníka (Kč):', currentPrice);
        if (newPrice === null) return;
        const newMech = prompt('Upravit jméno mechanika:', currentMech);
        if (newMech === null) return;

        fetch('/api/completed-jobs/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                work_done: newWork,
                cost_expenses: parseFloat(newCost) || 0,
                final_price: parseFloat(newPrice) || 0,
                completed_by: newMech
            })
        })
        .then(res => res.json())
        .then(res => {
            if (res.error) {
                alert(res.error);
                return;
            }
            alert('Zakázka v archivu upravena! Nový čistý zisk: ' + res.netProfit + ' Kč');
            loadUsersAndData();
        });
    }

    function deleteCompletedJob(id) {
        if (!confirm('Opravdu chcete smazat tuto zakázku z trvalého archivu?')) return;
        fetch('/api/completed-jobs/' + id, { method: 'DELETE' })
            .then(res => res.json())
            .then(() => loadUsersAndData());
    }

    function editCar(spz, model, status, note, phone, mechanic) {
        document.getElementById('spz').value = spz;
        document.getElementById('model').value = model;
        document.getElementById('status').value = status;
        document.getElementById('note').value = note === '-' ? '' : note;
        document.getElementById('phone').value = phone;
        document.getElementById('assignedMechanic').value = mechanic;
        toggleFinanceFields();
        switchTab('zakazky', document.querySelector('.tab-btn'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function deleteCar(id) {
        if (!confirm('Opravdu smazat aktivní vozidlo ze servisu?')) return;
        fetch('/api/vehicles/' + id, { method: 'DELETE' }).then(() => loadUsersAndData());
    }

    async function loadAttendanceSummary() {
        try {
            const res = await fetch('/api/attendance/latest');
            const list = await res.json();
            const el = document.getElementById('attendance-latest-list');
            if (!el) return;
            if (list.length === 0) {
                el.innerHTML = '<span style="color: #94a3b8;">Zatím žádné záznamy docházky.</span>';
                return;
            }
            el.innerHTML = list.map(item => \`
                <div style="background: #1e293b; padding: 6px 10px; margin-bottom: 4px; border-radius: 4px; border: 1px solid #334155; display: flex; justify-content: space-between;">
                    <span>👤 <strong>\${item.username}</strong></span>
                    <span><strong style="color: \${item.type === 'Příchod' ? '#16a34a' : '#ca8a04'};">\${item.type}</strong> v \${item.time} (\${item.date})</span>
                </div>
            \`).join('');
        } catch (err) {
            console.error('Chyba při načítání docházky');
        }
    }

    async function loadNfcDevices() {
        try {
            const res = await fetch('/api/attendance/devices');
            const devices = await res.json();
            const listEl = document.getElementById('nfc-devices-list');
            if (devices.length === 0) {
                listEl.innerHTML = '<p style="color: #94a3b8; font-size: 13px;">Žádná schválená zařízení.</p>';
                return;
            }
            listEl.innerHTML = devices.map(d => \`
                <div style="display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 8px 12px; margin-bottom: 6px; border-radius: 6px; border: 1px solid #334155;">
                    <div>
                        <span>📱 <strong>\${d.username}</strong></span><br>
                        <span style="font-size: 11px; color: #94a3b8; word-break: break-all;">Token: \${d.device_token}</span>
                    </div>
                    <button onclick="deleteNfcDevice('\${d.device_token}')" style="background: #dc2626; color: white; border: none; padding: 6px 10px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">Odebrat</button>
                </div>
            \`).join('');
        } catch (err) {
            console.error('Chyba při načítání zařízení');
        }
    }

    const newDeviceForm = document.getElementById('new-device-form');
    if (newDeviceForm) {
        newDeviceForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const deviceToken = document.getElementById('device-token-input').value.trim();
            const username = document.getElementById('device-username').value.trim();
            
            const res = await fetch('/api/attendance/register-device', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceToken, username })
            });
            
            if (res.ok) {
                document.getElementById('new-device-form').reset();
                loadNfcDevices();
                alert('Zařízení bylo úspěšně autorizováno!');
            } else {
                const err = await res.json();
                alert('Chyba: ' + (err.error || 'Neznámá chyba'));
            }
        });
    }

    async function deleteNfcDevice(token) {
        if (!confirm('Opravdu chcete odebrat přístup tomuto zařízení?')) return;
        const res = await fetch('/api/attendance/devices/' + encodeURIComponent(token), { method: 'DELETE' });
        if (res.ok) {
            loadNfcDevices();
        } else {
            alert('Chyba při mazání zařízení.');
        }
    }

    async function loadAdminUsersList() {
        try {
            const res = await fetch('/api/users');
            const users = await res.json();
            const listEl = document.getElementById('users-list-admin');
            if (!listEl) return;
            if (users.length === 0) {
                listEl.innerHTML = '<p style="color: #94a3b8; font-size: 13px;">Žádní uživatelé.</p>';
                return;
            }
            listEl.innerHTML = users.map(u => \`
                <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 8px 12px; margin-bottom: 6px; border-radius: 6px; border: 1px solid #334155;">
                    <span>👤 <strong>\${u.username}</strong></span>
                    \${u.username.toLowerCase() !== 'stsi' ? \`<button onclick="deleteUser(\${u.id})" style="background: #dc2626; color: white; border: none; padding: 6px 10px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">Smazat</button>\` : '<span style="font-size: 11px; color: #94a3b8;">Hlavní admin</span>'}
                </div>
            \`).join('');
        } catch (err) {
            console.error('Chyba při načítání uživatelů');
        }
    }

    const newUserForm = document.getElementById('new-user-form');
    if (newUserForm) {
        newUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('new-username-input').value.trim();
            const password = document.getElementById('new-password-input').value;

            const res = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (res.ok) {
                document.getElementById('new-user-form').reset();
                loadAdminUsersList();
                loadUsersAndData();
                alert('Uživatel úspěšně vytvořen!');
            } else {
                const err = await res.json();
                alert('Chyba: ' + (err.error || 'Neznámá chyba'));
            }
        });
    }

    async function deleteUser(id) {
        if (!confirm('Opravdu chcete smazat tohoto uživatele?')) return;
        const res = await fetch('/api/users/' + id, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
            loadAdminUsersList();
            loadUsersAndData();
        } else {
            alert('Chyba: ' + (data.error || 'Neznámá chyba'));
        }
    }
</script>
</body>
</html>`);
});

app.listen(PORT, () => {
    console.log(`Server PofelGarage běží na portu ${PORT}`);
});
