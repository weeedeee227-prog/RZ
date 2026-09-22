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

    // Tabulka povolených uživatelů včetně hesel
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`, () => {
        // Vložení výchozích uživatelů StSi a DeLi, pokud je tabulka prázdná
        db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
            if (row && row.count === 0) {
                db.run("INSERT INTO users (username, password) VALUES ('StSi', 'Stsi3103*')");
                db.run("INSERT INTO users (username, password) VALUES ('DeLi', 'Deli3103*')");
                console.log('Vytvořeni výchozí uživatelé: StSi, DeLi');
            }
        });
    });
});

// --- API ENDPOINTY ---

// Ověření a přihlášení uživatele (jméno + heslo)
app.post('/api/login', (req, res) => {
    let { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Zadejte uživatelské jméno a heslo.' });
    }

    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username.trim(), password], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) {
            return res.status(401).json({ error: 'Nesprávné uživatelské jméno nebo heslo.' });
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
    const shortUser = user ? user.trim() : 'admin';
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

// --- PWA MANIFEST A SERVICE WORKER PRO ANDROID ---
app.get('/manifest.json', (req, res) => {
    res.json({
        name: "Autoservis Registr Vozidel",
        short_name: "Autoservis",
        start_url: "/",
        display: "standalone",
        background_color: "#1e293b",
        theme_color: "#2563eb",
        icons: []
    });
});

app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
        self.addEventListener('install', (e) => {
            self.skipWaiting();
        });
        self.addEventListener('activate', (e) => {
            e.waitUntil(clients.claim());
        });
        self.addEventListener('fetch', (e) => {
            e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
        });
    `);
});

// --- FRONTEND (HTML / CSS / JS) ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Autoservis - Registr Vozidel</title>
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#2563eb">
    <script>
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js');
        }
    </script>
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
    </style>
</head>
<body>
    <div class="container">
        <!-- PŘIHLAŠOVACÍ FORMULÁŘ -->
        <div id="login-screen" class="card">
            <h2>Přihlášení do systému</h2>
            <p style="color: #94a3b8; font-size: 14px;">Zadejte své přihlašovací údaje:</p>
            <form id="login-form">
                <input type="text" id="login-user" placeholder="Uživatelské jméno (např. StSi)" required autocomplete="off">
                <input type="password" id="login-pass" placeholder="Heslo" required>
                <button type="submit">Vstoupit do aplikace</button>
                <div id="login-error" class="error-msg"></div>
            </form>
        </div>

        <!-- HLAVNÍ APLIKACE -->
        <div id="app-screen" class="hidden">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2>Registr vozidel (<span id="user-display" style="color: #38bdf8;"></span>)</h2>
                <button onclick="logout()" style="width: auto; padding: 6px 12px; background: #475569;">Odhlásit</button>
            </div>

            <!-- FORMULÁŘ PRO SPRÁVU VOZIDEL -->
            <div id="vehicle-form-section" class="card">
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

            <!-- SEZNAM KARET VOZIDEL -->
            <h3>Aktuální vozidla v databance</h3>
            <div id="vehicles-list">Načítání...</div>
        </div>
    </div>

    <script>
        let currentUser = null;

        // Kontrola přihlášení přes backend API (jméno + heslo)
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

        // Odeslání formuláře vozidla
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
                showNotification('Změna v registru', 'Vozidlo bylo úspěšně přidáno nebo upraveno.');
            } else {
                const err = await res.json();
                alert('Chyba: ' + err.error);
            }
        });

        // Načtení vozidel do karet
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
                showNotification('Vozidlo smazáno', 'Záznam byl odstraněn z registru.');
            }
        }

        // Lokální notifikace
        function showNotification(title, body) {
            if (!('Notification' in window)) return;
            if (Notification.permission === 'granted') {
                new Notification(title, { body: body });
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        new Notification(title, { body: body });
                    }
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