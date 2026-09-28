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
    // Tabulka aktivních vozidel v servisu
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

    // Trvalá, nesmazatelná databáze (archiv) dokončených zakázek a financí
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

    // Tabulka uživatelů pro mechaniky
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`);

    // Tabulka pro schválená NFC zařízení
    db.run(`CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_token TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL
    )`);

    // Tabulka pro záznamy docházky (příchody/odchody)
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        device_token TEXT NOT NULL,
        type TEXT NOT NULL,
        time TEXT NOT NULL,
        date TEXT NOT NULL
    )`);

    // Vynucení vytvoření výchozích uživatelů
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

// Získání trvalého archivu hotových zakázek
app.get('/api/completed-jobs', (req, res) => {
    db.all("SELECT * FROM completed_jobs ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/vehicles', (req, res) => {
    let { spz, model, status, note, phone, user, workDone, costExpenses, finalPrice } = req.body;
    if (!spz || !model || !status || !phone) {
        return res.status(400).json({ error: 'Vyplňte všechna povinná pole včetně telefonu.' });
    }

    spz = spz.trim().toUpperCase();
    phone = phone.trim();
    const shortUser = user ? user.trim() : 'mechanik';
    const cleanNote = note || '';

    // Pokud je stav "Opraveno - připraveno k vyzvednutí", přesuneme/uložíme auto do pevného archivu hotových zakázek
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

        // 1. Vložit do nesmazatelného archivu
        db.run(
            `INSERT INTO completed_jobs (spz, model, phone, work_done, cost_expenses, final_price, net_profit, completed_by, completed_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [spz, model, phone, workDone.trim(), expenses, price, netProfit, shortUser, completedAt],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });

                // 2. Smazat z aktivních vozidel v servisu (pokud tam bylo)
                db.run("DELETE FROM vehicles WHERE spz = ?", [spz], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Zakázka úspěšně dokončena a uložena do trvalého archivu!', netProfit });
                });
            }
        );
    } else {
        // Běžné uložení / aktualizace aktivního vozidla v servisu
        const query = `
            INSERT INTO vehicles (spz, model, status, note, phone, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(spz) DO UPDATE SET
                model = excluded.model,
                status = excluded.status,
                note = excluded.note,
                phone = excluded.phone,
                updated_by = excluded.updated_by
        `;

        db.run(query, [spz, model, status, cleanNote, phone, shortUser, shortUser], function(err) {
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

// --- ADMINISTRACE S ARCHIVEM A FINANCOVÁNÍM ( /admin.html ) ---
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
            <span>Mechanik: <strong id="loggedUserDisplay"></strong></span>
            <div><a href="#" onclick="logout()" style="color: #f87171; font-weight: bold; text-decoration: none;">Odhlásit</a></div>
        </div>
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
                    <label>Stav opravy:</label>
                    <select id="status" required onchange="toggleFinanceFields()">
                        <option value="Přijato do servisu">Přijato do servisu</option>
                        <option value="Probíhá oprava">Probíhá oprava</option>
                        <option value="Čeká se na díly">Čeká se na díly</option>
                        <option value="Opraveno - připraveno k vyzvednutí">Opraveno - připraveno k vyzvednutí (Dokončit)</option>
                        <option value="Vozidlo se nenachází v servise">Vozidlo se nenachází v servise</option>
                    </select>
                </div>

                <!-- DOKONČOVACÍ FINANČNÍ SEKCE (Zobrazí se automaticky při výběru hotovo) -->
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

        <!-- SBAZOVACÍ SEKCE NFC A KALENDÁŘE (Pouze pro StSi) -->
        <div id="nfcManagementContainer" class="hidden" style="margin-bottom: 20px;">
            <details style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #16a34a; cursor: pointer;">
                <summary style="font-size: 15px; font-weight: bold; color: #16a34a; outline: none; user-select: none;">
                    📱 Správa NFC zařízení a Docházka <span style="font-size: 12px; color: #94a3b8; font-weight: normal;">(kliknutím rozbalíte/sbalíte)</span>
                </summary>
                
                <div style="margin-top: 12px; cursor: default;" onclick="event.stopPropagation()">
                    <h3 style="margin-top:0; font-size:15px; color: #16a34a;">📅 Odkaz na kalendář docházky</h3>
                    <div id="calendar-link-box" class="calendar-box">Načítám odkaz...</div>

                    <h3 style="margin-top:15px; font-size:15px; color: #16a34a;">📱 Správa NFC zařízení</h3>
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

                    <h3 style="color: #f8fafc; font-size: 14px; margin-top: 15px;">Poslední stavy uživatelů (Živě 1s):</h3>
                    <div id="attendance-latest-list" style="margin-top: 5px; font-size: 13px; color: #cbd5e1;">Načítám docházku...</div>

                    <h3 style="color: #f8fafc; font-size: 14px; margin-top: 15px;">Seznam schválených zařízení:</h3>
                    <div id="nfc-devices-list" style="margin-top: 5px;">Načítání zařízení...</div>
                </div>
            </details>
        </div>

        <h3>Seznam vozidel v kartách</h3>
        <div id="mechanicCardList" class="card-list"></div>

        <!-- TRVALÝ ARCHIV DOKONČENÝCH ZAKÁZEK A ZISKŮ -->
        <h3 style="margin-top: 30px; color: #16a34a;">📂 Trvalý archiv dokončených zakázek</h3>
        <div id="completedArchiveList" class="card-list"></div>
    </div>
</div>

<script>
    let currentUser = '';
    let allVehicles = [];
    let completedJobs = [];
    let attendanceInterval = null;

    document.getElementById('calendar-link-box').innerText = window.location.origin + '/calendar.ics';

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
                document.getElementById('nfcManagementContainer').classList.remove('hidden');
                loadNfcDevices();
                loadAttendanceSummary();

                if (attendanceInterval) clearInterval(attendanceInterval);
                attendanceInterval = setInterval(loadAttendanceSummary, 1000);
            } else {
                document.getElementById('nfcManagementContainer').classList.add('hidden');
                if (attendanceInterval) clearInterval(attendanceInterval);
            }

            loadData();
        } catch (err) {
            errorEl.innerText = 'Chyba připojení k serveru.';
        }
    });

    function logout() {
        if (attendanceInterval) clearInterval(attendanceInterval);
        location.reload();
    }

    function loadData() {
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
            });
    }

    function saveVehicle(e) {
        e.preventDefault();
        const statusVal = document.getElementById('status').value;
        
        const payload = {
            spz: document.getElementById('spz').value.trim(),
            model: document.getElementById('model').value.trim(),
            phone: document.getElementById('phone').value.trim(),
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
                alert('Zakázka dokončena! Čistý zisk: ' + res.netProfit + ' Kč. Uloženo do trvalého archivu.');
            }
            document.getElementById('vehicleForm').reset();
            document.getElementById('financeFields').classList.add('hidden');
            loadData();
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
            
            container.innerHTML += \`
                <div class="car-card">
                    <div class="car-header">
                        <span>\${car.spz}</span>
                        <span style="font-size: 13px; color: #94a3b8; font-weight: normal;">\${car.model}</span>
                    </div>
                    <div class="car-row"><strong>Stav:</strong> <span style="color:#38bdf8;">\${car.status}</span></div>
                    <div class="car-row"><strong>Telefon:</strong> <a href="tel:\${car.phone}" style="color: #38bdf8;">\${car.phone}</a></div>
                    <div class="car-row"><strong>Poznámka:</strong> \${car.note || '-'}</div>
                    <div class="car-row" style="font-size: 11px; color: #94a3b8; margin-top: 4px;">Uložil/Upravil: \${car.updated_by || '-'}</div>
                    
                    <div class="card-actions-row">
                        <a href="tel:\${car.phone}" class="btn-call">📞 Zavolat</a>
                        <a href="sms:\${car.phone}?body=\${smsText}" class="btn-sms">💬 SMS</a>
                        <button class="btn-edit" onclick="editCar('\${car.spz}', '\${safeModel}', '\${car.status}', '\${safeNote}', '\${car.phone}')">Upravit</button>
                        <button class="btn-delete" onclick="deleteCar(\${car.id})">Smazat</button>
                    </div>
                </div>
            \`;
        });
    }

    function renderCompletedArchive() {
        const container = document.getElementById('completedArchiveList');
        if (completedJobs.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:#94a3b8;">Zatím žádné uzavřené zakázky v archivu.</p>';
            return;
        }

        container.innerHTML = '';
        completedJobs.forEach(job => {
            container.innerHTML += \`
                <div class="car-card" style="border-color: #16a34a;">
                    <div class="car-header">
                        <span>\${job.spz} (\${job.model})</span>
                        <span style="font-size: 12px; color: #16a34a; font-weight: bold;">Zisk: \${job.net_profit} Kč</span>
                    </div>
                    <div class="car-row"><strong>Provedená práce:</strong> \${job.work_done}</div>
                    <div class="car-row"><strong>Náklady:</strong> \${job.cost_expenses} Kč | <strong>Cena pro zákazníka:</strong> \${job.final_price} Kč</div>
                    <div class="car-row"><strong>Telefon:</strong> <a href="tel:\${job.phone}" style="color: #38bdf8;">\${job.phone}</a></div>
                    <div class="car-row" style="font-size: 11px; color: #94a3b8; margin-top: 4px;">Uzavřel: \${job.completed_by} | Datum: \${job.completed_at}</div>
                </div>
            \`;
        });
    }

    function editCar(spz, model, status, note, phone) {
        document.getElementById('spz').value = spz;
        document.getElementById('model').value = model;
        document.getElementById('status').value = status;
        document.getElementById('note').value = note === '-' ? '' : note;
        document.getElementById('phone').value = phone;
        toggleFinanceFields();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function deleteCar(id) {
        if (!confirm('Opravdu smazat aktivní vozidlo ze servisu?')) return;
        fetch('/api/vehicles/' + id, { method: 'DELETE' }).then(() => loadData());
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
                document.getElementById('new-device-form().reset();
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
</script>
</body>
</html>`);
});

app.listen(PORT, () => {
    console.log(`Server PofelGarage běží na portu ${PORT}`);
});
