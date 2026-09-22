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
    // Tabulka vozidel
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

    // Tabulka uživatelů pro mechaniky
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`);

    // Vynucení vytvoření výchozích uživatelů
    db.run("INSERT OR IGNORE INTO users (username, password) VALUES ('StSi', 'Stsi3103*')");
    db.run("INSERT OR IGNORE INTO users (username, password) VALUES ('DeLi', 'Deli3103*')");
});

// --- API ENDPOINTY ---

// Přihlášení pro mechaniky
app.post('/api/login', (req, res) => {
    let { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Zadejte uživatelské jméno a heslo.' });
    }

    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username.trim(), password], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) {
            return res.status(401).json({ error: 'Nesprávné jméno nebo heslo.' });
        }
        res.json({ message: 'Přihlášení úspěšné', username: row.username });
    });
});

// Získání všech vozidel
app.get('/api/vehicles', (req, res) => {
    db.all("SELECT * FROM vehicles ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Přidání nebo úprava vozidla (Upsert)
app.post('/api/vehicles', (req, res) => {
    let { spz, model, status, note, phone, user } = req.body;
    
    if (!spz || !model || !status || !phone) {
        return res.status(400).json({ error: 'Vyplňte všechna povinná pole včetně telefonu.' });
    }

    spz = spz.trim().toUpperCase();
    phone = phone.trim();
    const shortUser = user ? user.trim() : 'mechanik';
    const cleanNote = note || '';

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
});

// Smazání vozidla
app.delete('/api/vehicles/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM vehicles WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Vozidlo smazáno' });
    });
});

// --- PWA MANIFEST (S IKONOU PRO INSTALACI) ---
app.get('/manifest.json', (req, res) => {
    res.json({
        name: "Autoservis - Registr Vozidel",
        short_name: "Autoservis",
        start_url: "/",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#2563eb",
        icons: [
            {
                src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%232563eb'%3E%3Cpath d='M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.22.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3zM19 17H5v-4.66l.12-.34h13.76l.12.34V17z'/%3E%3C/svg%3E",
                sizes: "192x192 512x512",
                type: "image/svg+xml",
                purpose: "any maskable"
            }
        ]
    });
});

// --- SERVICE WORKER ---
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
        self.addEventListener('install', (e) => { self.skipWaiting(); });
        self.addEventListener('activate', (e) => { e.waitUntil(clients.claim()); });
        self.addEventListener('fetch', (e) => { e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); });
    `);
});

// --- FRONTEND: KLIENTSKÉ ROZHRANÍ ( / ) ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Autoservis - Stav vozidla</title>
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
        .actions a { display: inline-block; padding: 10px 16px; margin-top: 10px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; text-align: center; }
        .btn-call { background: #16a34a; color: white; }
        .badge { display: inline-block; padding: 6px 12px; border-radius: 6px; font-size: 14px; font-weight: bold; background: #334155; margin-top: 10px; }
        .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        .admin-link { color: #38bdf8; text-decoration: none; font-size: 14px; }
        .info-text { color: #94a3b8; font-size: 14px; margin-bottom: 15px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="top-bar">
            <h2>🚗 Zjištění stavu vozidla</h2>
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
                            <a href="tel:+420601551770" class="btn-call">📞 Zavolat do servisu</a>
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

// --- FRONTEND: MECHANICKÉ ROZHRANÍ ( /admin.html ) ---
app.get('/admin.html', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Autoservis - Administrace</title>
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#2563eb">
    <script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');</script>
    <style>
        :root { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 0; }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; }
        .card { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 15px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); border: 1px solid #334155; }
        input, select, textarea, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #fff; box-sizing: border-box; font-size: 16px; }
        button { background: #2563eb; color: white; border: none; font-weight: bold; cursor: pointer; transition: background 0.2s; }
        button:hover { background: #1d4ed8; }
        button.danger { background: #dc2626; }
        button.danger:hover { background: #b91c1c; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .actions a { display: inline-block; padding: 8px 12px; margin: 4px 4px 0 0; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; text-align: center; }
        .btn-call { background: #16a34a; color: white; }
        .btn-sms { background: #ca8a04; color: white; }
        .hidden { display: none !important; }
        .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background: #334155; }
        .error-msg { color: #f87171; font-size: 14px; margin-top: 5px; }
        .back-link { color: #38bdf8; text-decoration: none; font-size: 14px; display: inline-block; margin-bottom: 15px; }
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Zpět na zjištění stavu (klient)</a>

        <!-- PŘIHLAŠOVACÍ FORMULÁŘ -->
        <div id="login-screen" class="card">
            <h2>Přihlášení pro mechaniky</h2>
            <p style="color: #94a3b8; font-size: 14px;">Zadejte své přihlašovací údaje (StSi / DeLi):</p>
            <form id="login-form">
                <input type="text" id="login-user" placeholder="Uživatelské jméno" required autocomplete="off">
                <input type="password" id="login-pass" placeholder="Heslo" required>
                <button type="submit">Vstoupit do administrace</button>
                <div id="login-error" class="error-msg"></div>
            </form>
        </div>

        <!-- HLAVNÍ ADMIN APLIKACE -->
        <div id="app-screen" class="hidden">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2>Administrace vozidel (<span id="user-display" style="color: #38bdf8;"></span>)</h2>
                <button onclick="logout()" style="width: auto; padding: 6px 12px; background: #475569;">Odhlásit</button>
            </div>

            <div class="card">
                <h3>Přidat / Upravit vozidlo</h3>
                <form id="vehicle-form">
                    <div class="grid">
                        <input type="text" id="spz" placeholder="SPZ (např. 1AB2345)" required style="text-transform: uppercase;">
                        <input type="text" id="model" placeholder="Model vozidla" required>
                    </div>
                    <div class="grid">
                        <select id="status" required>
                            <option value="Příjem">Příjem vozidla</option>
                            <option value="Na dílně">Na dílně / Oprava</option>
                            <option value="Čeká na díly">Čeká na díly</option>
                            <option value="Hotovo">Hotovo k vyzvednutí</option>
                        </select>
                        <input type="tel" id="phone" placeholder="Telefon zákazníka (povinné)" required>
                    </div>
                    <textarea id="note" placeholder="Poznámka k servisu..."></textarea>
                    <button type="submit">Uložit vozidlo</button>
                </form>
            </div>

            <h3>Registr vozidel</h3>
            <div id="vehicles-list">Načítání...</div>
        </div>
    </div>

    <script>
        let currentUser = null;

        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const userInput = document.getElementById('login-user').value.trim();
            const passInput = document.getElementById('login-pass').value;
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
                document.getElementById('user-display').innerText = currentUser;
                document.getElementById('login-screen').classList.add('hidden');
                document.getElementById('app-screen').classList.remove('hidden');
                loadVehicles();
            } catch (err) {
                errorEl.innerText = 'Chyba připojení k serveru.';
            }
        });

        function logout() {
            currentUser = null;
            document.getElementById('login-user').value = '';
            document.getElementById('login-pass').value = '';
            document.getElementById('login-error').innerText = '';
            document.getElementById('app-screen').classList.add('hidden');
            document.getElementById('login-screen').classList.remove('hidden');
        }

        document.getElementById('vehicle-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                spz: document.getElementById('spz').value,
                model: document.getElementById('model').value,
                status: document.getElementById('status').value,
                phone: document.getElementById('phone').value,
                note: document.getElementById('note').value,
                user: currentUser
            };
            const res = await fetch('/api/vehicles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (res.ok) {
                document.getElementById('vehicle-form').reset();
                loadVehicles();
                showNotification('Změna v registru', 'Vozidlo bylo úspěšně uloženo.');
            } else {
                const err = await res.json();
                alert('Chyba: ' + err.error);
            }
        });

        async function loadVehicles() {
            const res = await fetch('/api/vehicles');
            const vehicles = await res.json();
            const listEl = document.getElementById('vehicles-list');
            if (vehicles.length === 0) {
                listEl.innerHTML = '<p style="color: #94a3b8;">Žádná vozidla v databázi.</p>';
                return;
            }
            listEl.innerHTML = vehicles.map(v => \`
                <div class="card">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div>
                            <h3 style="margin: 0 0 5px 0;">\${v.spz} - \${v.model}</h3>
                            <span class="badge">\${v.status}</span>
                        </div>
                        <span style="font-size: 12px; color: #94a3b8;">Zapsal: \${v.created_by || 'neznámý'}</span>
                    </div>
                    <p style="margin: 10px 0; color: #cbd5e1;">\${v.note || 'Bez poznámky'}</p>
                    <div class="actions">
                        <a href="tel:\${v.phone}" class="btn-call">📞 Volat: \${v.phone}</a>
                        <a href="sms:\${v.phone}?body=Dobrý den, ohledně vašeho vozidla \${v.spz}..." class="btn-sms">💬 SMS</a>
                        <button onclick="deleteVehicle(\${v.id})" class="danger" style="width: auto; padding: 6px 12px; margin-top: 4px; float: right;">Smazat</button>
                    </div>
                </div>
            \`).join('');
        }

        async function deleteVehicle(id) {
            if (!confirm('Opravdu chcete toto vozidlo smazat?')) return;
            const res = await fetch('/api/vehicles/' + id, { method: 'DELETE' });
            if (res.ok) {
                loadVehicles();
                showNotification('Vozidlo smazáno', 'Záznam byl odstraněn.');
            }
        }

        function showNotification(title, body) {
            if (!('Notification' in window)) return;
            if (Notification.permission === 'granted') {
                new Notification(title, { body: body });
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') new Notification(title, { body: body });
                });
            }
        }
    </script>
</body>
</html>`);
});

app.listen(PORT, () => {
    console.log(`Server běží na portu ${PORT}`);
});