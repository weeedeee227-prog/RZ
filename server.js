const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// --- API ENDPOINTY: VOZIDLA A ARCHIV ---
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
                    res.json({ message: 'Zakázka úspěšně dokončena a uložena do trvalého archivu!', netProfit });
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
    db.run("DELETE FROM vehicles WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Vozidlo smazáno' });
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

// --- ADMINISTRACE S MENU V LEVÉM HORNÍM ROHU ( /admin.html ) ---
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
        .container { max-width: 600px; margin: auto; background: #1e293b; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 1px solid #334155; }
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
        .top-nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; font-size: 13px; border-bottom: 1px solid #334155; padding-bottom: 8px; }
        .error-msg { color: #f87171; font-size: 14px; margin-top: 5px; }
        .calendar-box { background: #0f172a; padding: 10px; border-radius: 6px; border: 1px solid #334155; font-family: monospace; font-size: 13px; color: #38bdf8; word-break: break-all; margin-top: 5px; user-select: all; }
        
        /* Styly pro hamburger menu v levém horním rohu */
        .menu-dropdown { position: relative; display: inline-block; }
        .menu-btn { background: #334155; color: white; padding: 8px 12px; border-radius: 6px; font-size: 14px; border: none; cursor: pointer; font-weight: bold; }
        .menu-content { display: none; position: absolute; left: 0; top: 100%; background: #1e293b; min-width: 260px; box-shadow: 0px 8px 16px rgba(0,0,0,0.5); border: 1px solid #475569; border-radius: 6px; z-index: 10; margin-top: 5px; padding: 8px; }
        .menu-content.show { display: block; }
        .menu-section { background: #0f172a; margin-bottom: 8px; border-radius: 6px; border: 1px solid #334155; overflow: hidden; }
        
        /* Styly pro vizuální grafy */
        .progress-bar-container { background: #334155; border-radius: 4px; overflow: hidden; height: 12px; margin: 8px 0; display: flex; }
        .progress-fill-profit { background: #16a34a; height: 100%; }
        .progress-fill-cost { background: #dc2626; height: 100%; }
    </style>
</head>
<body>

<div class="container">
    <!-- PŘIHLÁŠENÍ MECHANIKA -->
    <div id="loginView">
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
            <!-- HAMBURGER MENU V LEVÉM HORNÍM ROHU -->
            <div class="menu-dropdown">
                <button onclick="toggleMenu()" class="menu-btn">☰ Menu ▾</button>
                <div id="appMenu" class="menu-content">
                    
                    <!-- Správa uživatelů (Pouze StSi) -->
                    <div id="menuUserManagement" class="menu-section hidden" style="border-color: #38bdf8; padding: 10px;">
                        <details>
                            <summary style="font-size: 14px; font-weight: bold; color: #38bdf8; cursor: pointer;">👥 Správa uživatelů</summary>
                            <div style="margin-top: 8px;">
                                <form id="new-user-form">
                                    <div class="form-group" style="margin-bottom:6px;">
                                        <input type="text" id="new-username-input" placeholder="Jméno mechanika" required style="font-size:13px; padding:6px;">
                                    </div>
                                    <div class="form-group" style="margin-bottom:6px;">
                                        <input type="password" id="new-password-input" placeholder="Heslo" required style="font-size:13px; padding:6px;">
                                    </div>
                                    <button type="submit" class="btn" style="background: #2563eb; font-size:13px; padding:8px;">Vytvořit</button>
                                </form>
                                <div id="users-list-admin" style="margin-top: 8px; font-size: 12px;">Načítám...</div>
                            </div>
                        </details>
                    </div>

                    <!-- NFC a docházka (Pouze StSi) -->
                    <div id="menuNfcManagement" class="menu-section hidden" style="border-color: #16a34a; padding: 10px;">
                        <details>
                            <summary style="font-size: 14px; font-weight: bold; color: #16a34a; cursor: pointer;">📱 NFC & Docházka</summary>
                            <div style="margin-top: 8px; font-size: 12px;">
                                <p style="color: #94a3b8; margin: 0 0 5px 0;">Kalendář:</p>
                                <div id="calendar-link-box" class="calendar-box" style="font-size: 11px; padding: 6px;">Načítám...</div>
                                <form id="new-device-form" style="margin-top: 8px;">
                                    <div class="form-group" style="margin-bottom:6px;">
                                        <input type="text" id="device-token-input" placeholder="Token dev_..." required style="font-size:13px; padding:6px;">
                                    </div>
                                    <div class="form-group" style="margin-bottom:6px;">
                                        <input type="text" id="device-username" placeholder="Jméno / Umístění" required style="font-size:13px; padding:6px;">
                                    </div>
                                    <button type="submit" class="btn" style="background: #16a34a; font-size:13px; padding:8px;">Schválit NFC</button>
                                </form>
                                <div style="margin-top: 8px; font-weight: bold; color: #38bdf8;">Živá docházka (1s):</div>
                                <div id="attendance-latest-list" style="margin-top: 3px;">Načítám...</div>
                                <div style="margin-top: 8px; font-weight: bold;">Schválená zařízení:</div>
                                <div id="nfc-devices-list" style="margin-top: 3px;">Načítání...</div>
                            </div>
                        </details>
                    </div>

                    <!-- Výkon a finance mechaniků -->
                    <div class="menu-section" style="padding: 10px;">
                        <details>
                            <summary style="font-size: 14px; font-weight: bold; color: #38bdf8; cursor: pointer;">📊 Výkon a finance</summary>
                            <div id="mechanicsStatsContainer" style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px;"></div>
                        </details>
                    </div>

                    <!-- Trvalý archiv zakázek -->
                    <div class="menu-section" style="padding: 10px;">
                        <details>
                            <summary style="font-size: 14px; font-weight: bold; color: #16a34a; cursor: pointer;">📂 Archiv zakázek</summary>
                            <div style="margin-top: 8px;">
                                <input type="text" id="archiveSearch" placeholder="🔍 Hledat SPZ v archivu..." oninput="renderCompletedArchive()" style="font-size:12px; padding:6px; text-transform: uppercase; margin-bottom: 6px;">
                                <div id="completedArchiveList" style="max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;"></div>
                            </div>
                        </details>
                    </div>

                </div>
            </div>

            <div>Mechanik: <strong id="loggedUserDisplay"></strong> | <a href="#" onclick="logout()" style="color: #f87171; font-weight: bold; text-decoration: none;">Odhlásit</a></div>
        </div>

        <h1>Správa zakázek</h1>

        <!-- POUZE SPRÁVA ZAKÁZEK NA HLAVNÍ STRÁNCE -->
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
</div>

<script>
    let currentUser = '';
    let allVehicles = [];
    let completedJobs = [];
    let allUsers = [];
    let attendanceInterval = null;

    document.getElementById('calendar-link-box').innerText = window.location.origin + '/calendar.ics';

    function toggleMenu() {
        document.getElementById('appMenu').classList.toggle('show');
    }

    // Zavřít menu při kliknutí mimo něj
    window.onclick = function(event) {
        if (!event.target.matches('.menu-btn') && !event.target.closest('.menu-content')) {
            const dropdowns = document.getElementsByClassName("menu-content");
            for (let i = 0; i < dropdowns.length; i++) {
                const openDropdown = dropdowns[i];
                if (openDropdown.classList.contains('show')) {
                    openDropdown.classList.remove('show');
                }
            }
        }
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
            document.getElementById('loggedUserDisplay').innerText = currentUser;
            document.getElementById('loginView').classList.add('hidden');
            document.getElementById('mechanicView').classList.remove('hidden');

            if (currentUser.toLowerCase() === 'stsi') {
                document.getElementById('menuNfcManagement').classList.remove('hidden');
                document.getElementById('menuUserManagement').classList.remove('hidden');
                loadNfcDevices();
                loadAttendanceSummary();
                loadAdminUsersList();

                if (attendanceInterval) clearInterval(attendanceInterval);
                attendanceInterval = setInterval(loadAttendanceSummary, 1000);
            } else {
                document.getElementById('menuNfcManagement').classList.add('hidden');
                document.getElementById('menuUserManagement').classList.add('hidden');
                if (attendanceInterval) clearInterval(attendanceInterval);
            }

            loadUsersAndData();
        } catch (err) {
            errorEl.innerText = 'Chyba připojení k serveru.';
        }
    });

    function logout() {
        if (attendanceInterval) clearInterval(attendanceInterval);
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
                </div>
            \`;
        });
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
                jobsHtml = '<p style="color: #94a3b8; font-size: 12px;">Žádné dokončené zakázky.</p>';
            } else {
                jobsHtml = mechJobs.map(j => \`
                    <div style="background: #1e293b; padding: 6px; margin-bottom: 4px; border-radius: 4px; border: 1px solid #334155; font-size: 12px;">
                        <div><strong>\${j.spz}</strong> - <span style="color: #16a34a;">Zisk: \${j.net_profit} Kč</span></div>
                        <div style="color: #94a3b8;">Práce: \${j.work_done} | Náklady: \${j.cost_expenses} Kč | Cena: \${j.final_price} Kč</div>
                    </div>
                \`).join('');
            }

            statsContainer.innerHTML += \`
                <details style="background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px; cursor: pointer;">
                    <summary style="font-weight: bold; color: #38bdf8; outline: none; display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
                        <span>👤 \${mechName}</span>
                        <span style="color: #16a34a;">Zisk: \${totalProfit} Kč</span>
                    </summary>
                    <div style="margin-top: 8px; cursor: default; border-top: 1px solid #334155; pt: 8px;" onclick="event.stopPropagation()">
                        <div style="font-size: 12px; margin-bottom: 6px; color: #cbd5e1;">
                            <div>📦 Dokončeno: <strong>\${mechJobs.length}</strong> | 🚗 Aktivních: <strong>\${mechActive.length}</strong></div>
                            <div>💸 Náklady: <strong style="color: #f87171;">\${totalExpenses} Kč</strong> | 💵 Tržby: <strong style="color: #38bdf8;">\${totalRevenue} Kč</strong></div>
                        </div>
                        <div class="progress-bar-container">
                            <div class="progress-fill-profit" style="width: \${profitPercent}%;"></div>
                            <div class="progress-fill-cost" style="width: \${costPercent}%;"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-bottom: 8px;">
                            <span style="color: #16a34a;">■ Zisk (\${totalProfit} Kč)</span>
                            <span style="color: #dc2626;">■ Náklady (\${totalExpenses} Kč)</span>
                        </div>
                        <div style="max-height: 150px; overflow-y: auto;">\${jobsHtml}</div>
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
            container.innerHTML = '<p style="text-align:center; color:#94a3b8; font-size:12px;">Žádné zakázky.</p>';
            return;
        }

        container.innerHTML = '';
        filteredJobs.forEach(job => {
            const smsText = encodeURIComponent('Dobrý den, vaše vozidlo (' + job.spz + ') - archiv. Děkuji.');
            const safeWorkDone = (job.work_done || '').replace(/'/g, "\\\\'");

            container.innerHTML += \`
                <div class="car-card" style="border-color: #16a34a; padding: 10px; font-size: 12px;">
                    <div class="car-header" style="font-size: 13px;">
                        <span>\${job.spz} (\${job.model})</span>
                        <span style="color: #16a34a;">Zisk: \${job.net_profit} Kč</span>
                    </div>
                    <div class="car-row"><strong>Práce:</strong> \${job.work_done}</div>
                    <div class="car-row"><strong>Náklady:</strong> \${job.cost_expenses} Kč | <strong>Cena:</strong> \${job.final_price} Kč</div>
                    <div class="car-row"><strong>Mechanik:</strong> <span style="color: #38bdf8;">\${job.completed_by}</span></div>
                    <div class="card-actions-row" style="margin-top: 6px;">
                        <button class="btn-edit" onclick="editCompletedJob(\small ID \${job.id}, '\${safeWorkDone}', \${job.cost_expenses}, \${job.final_price}, '\${job.completed_by}')" style="padding:4px 8px; font-size:11px;">Upravit</button>
                        <button class="btn-delete" onclick="deleteCompletedJob(\${job.id})" style="padding:4px 8px; font-size:11px;">Smazat</button>
                    </div>
                </div>
            \`;
        });
    }

    function editCompletedJob(id, currentWork, currentCost, currentPrice, currentMech) {
        const newWork = prompt('Upravit práci:', currentWork);
        if (newWork === null) return;
        const newCost = prompt('Upravit náklady (Kč):', currentCost);
        if (newCost === null) return;
        const newPrice = prompt('Upravit cenu pro zákazníka (Kč):', currentPrice);
        if (newPrice === null) return;
        const newMech = prompt('Upravit mechanika:', currentMech);
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
            if (res.error) { alert(res.error); return; }
            alert('Aktualizováno! Nový zisk: ' + res.netProfit + ' Kč');
            loadUsersAndData();
        });
    }

    function deleteCompletedJob(id) {
        if (!confirm('Opravdu smazat z archivu?')) return;
        fetch('/api/completed-jobs/' + id, { method: 'DELETE' })
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
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function deleteCar(id) {
        if (!confirm('Opravdu smazat aktivní vozidlo?')) return;
        fetch('/api/vehicles/' + id, { method: 'DELETE' }).then(() => loadUsersAndData());
    }

    async function loadAttendanceSummary() {
        try {
            const res = await fetch('/api/attendance/latest');
            const list = await res.json();
            const el = document.getElementById('attendance-latest-list');
            if (!el) return;
            if (list.length === 0) { el.innerHTML = 'Žádné záznamy.'; return; }
            el.innerHTML = list.map(item => \`<div>👤 <strong>\${item.username}</strong>: <span style="color:\${item.type==='Příchod'?'#16a34a':'#ca8a04'}">\${item.type}</span> v \${item.time}</div>\`).join('');
        } catch (e) {}
    }

    async function loadNfcDevices() {
        try {
            const res = await fetch('/api/attendance/devices');
            const devices = await res.json();
            const listEl = document.getElementById('nfc-devices-list');
            if (devices.length === 0) { listEl.innerHTML = 'Žádná zařízení.'; return; }
            listEl.innerHTML = devices.map(d => \`<div>📱 \${d.username} <button onclick="deleteNfcDevice('\${d.device_token}')" style="background:#dc2626; color:white; border:none; padding:2px 6px; font-size:10px; border-radius:3px;">X</button></div>\`).join('');
        } catch (e) {}
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
            if (res.ok) { document.getElementById('new-device-form').reset(); loadNfcDevices(); alert('NFC schváleno!'); }
        });
    }

    async function deleteNfcDevice(token) {
        if (!confirm('Odebrat NFC?')) return;
        await fetch('/api/attendance/devices/' + encodeURIComponent(token), { method: 'DELETE' });
        loadNfcDevices();
    }

    async function loadAdminUsersList() {
        try {
            const res = await fetch('/api/users');
            const users = await res.json();
            const listEl = document.getElementById('users-list-admin');
            if (!listEl) return;
            listEl.innerHTML = users.map(u => \`
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span>👤 \${u.username}</span>
                    \${u.username.toLowerCase() !== 'stsi' ? \`<button onclick="deleteUser(\${u.id})" style="background: #dc2626; color: white; border: none; padding: 2px 6px; border-radius: 3px; font-size: 10px;">X</button>\` : ''}
                </div>
cat << 'EOF' > server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// --- API ENDPOINTY: VOZIDLA A ARCHIV ---
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
                    res.json({ message: 'Zakázka úspěšně dokončena a uložena do trvalého archivu!', netProfit });
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
    db.run("DELETE FROM vehicles WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Vozidlo smazáno' });
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

// --- ADMINISTRACE S MENU V LEVÉM HORNÍM ROHU ( /admin.html ) ---
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
        .container { max-width: 600px; margin: auto; background: #1e293b; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 1px solid #334155; }
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
        .top-nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; font-size: 13px; border-bottom: 1px solid #334155; padding-bottom: 8px; }
        .error-msg { color: #f87171; font-size: 14px; margin-top: 5px; }
        .calendar-box { background: #0f172a; padding: 10px; border-radius: 6px; border: 1px solid #334155; font-family: monospace; font-size: 13px; color: #38bdf8; word-break: break-all; margin-top: 5px; user-select: all; }
        
        /* Styly pro hamburger menu v levém horním rohu */
        .menu-dropdown { position: relative; display: inline-block; }
        .menu-btn { background: #334155; color: white; padding: 8px 12px; border-radius: 6px; font-size: 14px; border: none; cursor: pointer; font-weight: bold; }
        .menu-content { display: none; position: absolute; left: 0; top: 100%; background: #1e293b; min-width: 260px; box-shadow: 0px 8px 16px rgba(0,0,0,0.5); border: 1px solid #475569; border-radius: 6px; z-index: 10; margin-top: 5px; padding: 8px; }
        .menu-content.show { display: block; }
        .menu-section { background: #0f172a; margin-bottom: 8px; border-radius: 6px; border: 1px solid #334155; overflow: hidden; }
        
        /* Styly pro vizuální grafy */
        .progress-bar-container { background: #334155; border-radius: 4px; overflow: hidden; height: 12px; margin: 8px 0; display: flex; }
        .progress-fill-profit { background: #16a34a; height: 100%; }
        .progress-fill-cost { background: #dc2626; height: 100%; }
    </style>
</head>
<body>

<div class="container">
    <!-- PŘIHLÁŠENÍ MECHANIKA -->
    <div id="loginView">
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
            <!-- HAMBURGER MENU V LEVÉM HORNÍM ROHU -->
            <div class="menu-dropdown">
                <button onclick="toggleMenu()" class="menu-btn">☰ Menu ▾</button>
                <div id="appMenu" class="menu-content">
                    
                    <!-- Správa uživatelů (Pouze StSi) -->
                    <div id="menuUserManagement" class="menu-section hidden" style="border-color: #38bdf8; padding: 10px;">
                        <details>
                            <summary style="font-size: 14px; font-weight: bold; color: #38bdf8; cursor: pointer;">👥 Správa uživatelů</summary>
                            <div style="margin-top: 8px;">
                                <form id="new-user-form">
                                    <div class="form-group" style="margin-bottom:6px;">
                                        <input type="text" id="new-username-input" placeholder="Jméno mechanika" required style="font-size:13px; padding:6px;">
                                    </div>
                                    <div class="form-group" style="margin-bottom:6px;">
                                        <input type="password" id="new-password-input" placeholder="Heslo" required style="font-size:13px; padding:6px;">
                                    </div>
                                    <button type="submit" class="btn" style="background: #2563eb; font-size:13px; padding:8px;">Vytvořit</button>
                                </form>
                                <div id="users-list-admin" style="margin-top: 8px; font-size: 12px;">Načítám...</div>
                            </div>
                        </details>
                    </div>

                    <!-- NFC a docházka (Pouze StSi) -->
                    <div id="menuNfcManagement" class="menu-section hidden" style="border-color: #16a34a; padding: 10px;">
                        <details>
                            <summary style="font-size: 14px; font-weight: bold; color: #16a34a; cursor: pointer;">📱 NFC & Docházka</summary>
                            <div style="margin-top: 8px; font-size: 12px;">
                                <p style="color: #94a3b8; margin: 0 0 5px 0;">Kalendář:</p>
                                <div id="calendar-link-box" class="calendar-box" style="font-size: 11px; padding: 6px;">Načítám...</div>
                                <form id="new-device-form" style="margin-top: 8px;">
                                    <div class="form-group" style="margin-bottom:6px;">
                                        <input type="text" id="device-token-input" placeholder="Token dev_..." required style="font-size:13px; padding:6px;">
                                    </div>
                                    <div class="form-group" style="margin-bottom:6px;">
                                        <input type="text" id="device-username" placeholder="Jméno / Umístění" required style="font-size:13px; padding:6px;">
                                    </div>
                                    <button type="submit" class="btn" style="background: #16a34a; font-size:13px; padding:8px;">Schválit NFC</button>
                                </form>
                                <div style="margin-top: 8px; font-weight: bold; color: #38bdf8;">Živá docházka (1s):</div>
                                <div id="attendance-latest-list" style="margin-top: 3px;">Načítám...</div>
                                <div style="margin-top: 8px; font-weight: bold;">Schválená zařízení:</div>
                                <div id="nfc-devices-list" style="margin-top: 3px;">Načítání...</div>
                            </div>
                        </details>
                    </div>

                    <!-- Výkon a finance mechaniků -->
                    <div class="menu-section" style="padding: 10px;">
                        <details>
                            <summary style="font-size: 14px; font-weight: bold; color: #38bdf8; cursor: pointer;">📊 Výkon a finance</summary>
                            <div id="mechanicsStatsContainer" style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px;"></div>
                        </details>
                    </div>

                    <!-- Trvalý archiv zakázek -->
                    <div class="menu-section" style="padding: 10px;">
                        <details>
                            <summary style="font-size: 14px; font-weight: bold; color: #16a34a; cursor: pointer;">📂 Archiv zakázek</summary>
                            <div style="margin-top: 8px;">
                                <input type="text" id="archiveSearch" placeholder="🔍 Hledat SPZ v archivu..." oninput="renderCompletedArchive()" style="font-size:12px; padding:6px; text-transform: uppercase; margin-bottom: 6px;">
                                <div id="completedArchiveList" style="max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;"></div>
                            </div>
                        </details>
                    </div>

                </div>
            </div>

            <div>Mechanik: <strong id="loggedUserDisplay"></strong> | <a href="#" onclick="logout()" style="color: #f87171; font-weight: bold; text-decoration: none;">Odhlásit</a></div>
        </div>

        <h1>Správa zakázek</h1>

        <!-- POUZE SPRÁVA ZAKÁZEK NA HLAVNÍ STRÁNCE -->
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
</div>

<script>
    let currentUser = '';
    let allVehicles = [];
    let completedJobs = [];
    let allUsers = [];
    let attendanceInterval = null;

    document.getElementById('calendar-link-box').innerText = window.location.origin + '/calendar.ics';

    function toggleMenu() {
        document.getElementById('appMenu').classList.toggle('show');
    }

    // Zavřít menu při kliknutí mimo něj
    window.onclick = function(event) {
        if (!event.target.matches('.menu-btn') && !event.target.closest('.menu-content')) {
            const dropdowns = document.getElementsByClassName("menu-content");
            for (let i = 0; i < dropdowns.length; i++) {
                const openDropdown = dropdowns[i];
                if (openDropdown.classList.contains('show')) {
                    openDropdown.classList.remove('show');
                }
            }
        }
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
            document.getElementById('loggedUserDisplay').innerText = currentUser;
            document.getElementById('loginView').classList.add('hidden');
            document.getElementById('mechanicView').classList.remove('hidden');

            if (currentUser.toLowerCase() === 'stsi') {
                document.getElementById('menuNfcManagement').classList.remove('hidden');
                document.getElementById('menuUserManagement').classList.remove('hidden');
                loadNfcDevices();
                loadAttendanceSummary();
                loadAdminUsersList();

                if (attendanceInterval) clearInterval(attendanceInterval);
                attendanceInterval = setInterval(loadAttendanceSummary, 1000);
            } else {
                document.getElementById('menuNfcManagement').classList.add('hidden');
                document.getElementById('menuUserManagement').classList.add('hidden');
                if (attendanceInterval) clearInterval(attendanceInterval);
            }

            loadUsersAndData();
        } catch (err) {
            errorEl.innerText = 'Chyba připojení k serveru.';
        }
    });

    function logout() {
        if (attendanceInterval) clearInterval(attendanceInterval);
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
                </div>
            \`;
        });
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
                jobsHtml = '<p style="color: #94a3b8; font-size: 12px;">Žádné dokončené zakázky.</p>';
            } else {
                jobsHtml = mechJobs.map(j => \`
                    <div style="background: #1e293b; padding: 6px; margin-bottom: 4px; border-radius: 4px; border: 1px solid #334155; font-size: 12px;">
                        <div><strong>\${j.spz}</strong> - <span style="color: #16a34a;">Zisk: \${j.net_profit} Kč</span></div>
                        <div style="color: #94a3b8;">Práce: \${j.work_done} | Náklady: \${j.cost_expenses} Kč | Cena: \${j.final_price} Kč</div>
                    </div>
                \`).join('');
            }

            statsContainer.innerHTML += \`
                <details style="background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px; cursor: pointer;">
                    <summary style="font-weight: bold; color: #38bdf8; outline: none; display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
                        <span>👤 \${mechName}</span>
                        <span style="color: #16a34a;">Zisk: \${totalProfit} Kč</span>
                    </summary>
                    <div style="margin-top: 8px; cursor: default; border-top: 1px solid #334155; pt: 8px;" onclick="event.stopPropagation()">
                        <div style="font-size: 12px; margin-bottom: 6px; color: #cbd5e1;">
                            <div>📦 Dokončeno: <strong>\${mechJobs.length}</strong> | 🚗 Aktivních: <strong>\${mechActive.length}</strong></div>
                            <div>💸 Náklady: <strong style="color: #f87171;">\${totalExpenses} Kč</strong> | 💵 Tržby: <strong style="color: #38bdf8;">\${totalRevenue} Kč</strong></div>
                        </div>
                        <div class="progress-bar-container">
                            <div class="progress-fill-profit" style="width: \${profitPercent}%;"></div>
                            <div class="progress-fill-cost" style="width: \${costPercent}%;"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-bottom: 8px;">
                            <span style="color: #16a34a;">■ Zisk (\${totalProfit} Kč)</span>
                            <span style="color: #dc2626;">■ Náklady (\${totalExpenses} Kč)</span>
                        </div>
                        <div style="max-height: 150px; overflow-y: auto;">\${jobsHtml}</div>
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
            container.innerHTML = '<p style="text-align:center; color:#94a3b8; font-size:12px;">Žádné zakázky.</p>';
            return;
        }

        container.innerHTML = '';
        filteredJobs.forEach(job => {
            const smsText = encodeURIComponent('Dobrý den, vaše vozidlo (' + job.spz + ') - archiv. Děkuji.');
            const safeWorkDone = (job.work_done || '').replace(/'/g, "\\\\'");

            container.innerHTML += \`
                <div class="car-card" style="border-color: #16a34a; padding: 10px; font-size: 12px;">
                    <div class="car-header" style="font-size: 13px;">
                        <span>\${job.spz} (\${job.model})</span>
                        <span style="color: #16a34a;">Zisk: \${job.net_profit} Kč</span>
                    </div>
                    <div class="car-row"><strong>Práce:</strong> \${job.work_done}</div>
                    <div class="car-row"><strong>Náklady:</strong> \${job.cost_expenses} Kč | <strong>Cena:</strong> \${job.final_price} Kč</div>
                    <div class="car-row"><strong>Mechanik:</strong> <span style="color: #38bdf8;">\${job.completed_by}</span></div>
                    <div class="card-actions-row" style="margin-top: 6px;">
                        <button class="btn-edit" onclick="editCompletedJob(\small ID \${job.id}, '\${safeWorkDone}', \${job.cost_expenses}, \${job.final_price}, '\${job.completed_by}')" style="padding:4px 8px; font-size:11px;">Upravit</button>
                        <button class="btn-delete" onclick="deleteCompletedJob(\${job.id})" style="padding:4px 8px; font-size:11px;">Smazat</button>
                    </div>
                </div>
            \`;
        });
    }

    function editCompletedJob(id, currentWork, currentCost, currentPrice, currentMech) {
        const newWork = prompt('Upravit práci:', currentWork);
        if (newWork === null) return;
        const newCost = prompt('Upravit náklady (Kč):', currentCost);
        if (newCost === null) return;
        const newPrice = prompt('Upravit cenu pro zákazníka (Kč):', currentPrice);
        if (newPrice === null) return;
        const newMech = prompt('Upravit mechanika:', currentMech);
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
            if (res.error) { alert(res.error); return; }
            alert('Aktualizováno! Nový zisk: ' + res.netProfit + ' Kč');
            loadUsersAndData();
        });
    }

    function deleteCompletedJob(id) {
        if (!confirm('Opravdu smazat z archivu?')) return;
        fetch('/api/completed-jobs/' + id, { method: 'DELETE' })
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
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function deleteCar(id) {
        if (!confirm('Opravdu smazat aktivní vozidlo?')) return;
        fetch('/api/vehicles/' + id, { method: 'DELETE' }).then(() => loadUsersAndData());
    }

    async function loadAttendanceSummary() {
        try {
            const res = await fetch('/api/attendance/latest');
            const list = await res.json();
            const el = document.getElementById('attendance-latest-list');
            if (!el) return;
            if (list.length === 0) { el.innerHTML = 'Žádné záznamy.'; return; }
            el.innerHTML = list.map(item => \`<div>👤 <strong>\${item.username}</strong>: <span style="color:\${item.type==='Příchod'?'#16a34a':'#ca8a04'}">\${item.type}</span> v \${item.time}</div>\`).join('');
        } catch (e) {}
    }

    async function loadNfcDevices() {
        try {
            const res = await fetch('/api/attendance/devices');
            const devices = await res.json();
            const listEl = document.getElementById('nfc-devices-list');
            if (devices.length === 0) { listEl.innerHTML = 'Žádná zařízení.'; return; }
            listEl.innerHTML = devices.map(d => \`<div>📱 \${d.username} <button onclick="deleteNfcDevice('\${d.device_token}')" style="background:#dc2626; color:white; border:none; padding:2px 6px; font-size:10px; border-radius:3px;">X</button></div>\`).join('');
        } catch (e) {}
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
            if (res.ok) { document.getElementById('new-device-form').reset(); loadNfcDevices(); alert('NFC schváleno!'); }
        });
    }

    async function deleteNfcDevice(token) {
        if (!confirm('Odebrat NFC?')) return;
        await fetch('/api/attendance/devices/' + encodeURIComponent(token), { method: 'DELETE' });
        loadNfcDevices();
    }

    async function loadAdminUsersList() {
        try {
            const res = await fetch('/api/users');
            const users = await res.json();
            const listEl = document.getElementById('users-list-admin');
            if (!listEl) return;
            listEl.innerHTML = users.map(u => \`
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span>👤 \${u.username}</span>
                    \${u.username.toLowerCase() !== 'stsi' ? \`<button onclick="deleteUser(\${u.id})" style="background: #dc2626; color: white; border: none; padding: 2px 6px; border-radius: 3px; font-size: 10px;">X</button>\` : ''}
                </div>
            \`).join('');
        } catch (e) {}
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
                alert('Uživatel vytvořen!');
            } else {
                const err = await res.json();
                alert('Chyba: ' + (err.error || 'Neznámá'));
            }
        });
    }

    async function deleteUser(id) {
        if (!confirm('Smazat uživatele?')) return;
        await fetch('/api/users/' + id, { method: 'DELETE' });
        loadAdminUsersList();
        loadUsersAndData();
    }
</script>
</body>
</html>`);
});

app.listen(PORT, () => {
    console.log(`Server PofelGarage běží na portu ${PORT}`);
});
