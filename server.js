const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Složka pro nahrávání fotek
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

app.use('/uploads', express.static(uploadDir));
// Servíruje všechny soubory (index.html, admin.html, JS, CSS atd.) přímo z kořenové složky
app.use(express.static(__dirname));

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

// --- API: UŽIVATELÉ ---
app.get('/api/users', (req, res) => {
    db.all("SELECT id, username FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/users', (req, res) => {
    let { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Zadejte jméno a heslo.' });
    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username.trim(), password], function(err) {
        if (err) return res.status(400).json({ error: 'Uživatel již existuje.' });
        res.json({ message: 'Uživatel vytvořen' });
    });
});

app.delete('/api/users/:id', (req, res) => {
    db.get("SELECT username FROM users WHERE id = ?", [req.params.id], (err, row) => {
        if (row && row.username.toLowerCase() === 'stsi') return res.status(400).json({ error: 'StSi nelze smazat!' });
        db.run("DELETE FROM users WHERE id = ?", [req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Uživatel smazán' });
        });
    });
});

// --- API: DOCHÁZKA & NFC ---
app.get('/api/attendance/devices', (req, res) => {
    db.all("SELECT * FROM devices", [], (err, rows) => res.json(rows));
});

app.post('/api/attendance/register-device', (req, res) => {
    const { deviceToken, username } = req.body;
    db.run("INSERT OR REPLACE INTO devices (device_token, username) VALUES (?, ?)", [deviceToken.trim(), username.trim()], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Zařízení registrováno' });
    });
});

app.delete('/api/attendance/devices/:token', (req, res) => {
    db.run("DELETE FROM devices WHERE device_token = ?", [req.params.token], (err) => res.json({ message: 'Odebráno' }));
});

app.get('/api/attendance/latest', (req, res) => {
    const query = `
        SELECT a.* FROM attendance a
        JOIN (SELECT username, MAX(id) as max_id FROM attendance GROUP BY username) latest 
        ON a.id = latest.max_id
    `;
    db.all(query, [], (err, rows) => res.json(rows));
});

app.post('/api/attendance/nfc-tap', (req, res) => {
    const { deviceToken } = req.body;
    db.get("SELECT * FROM devices WHERE device_token = ?", [deviceToken], (err, device) => {
        if (!device) return res.json({ needsRegistration: true });
        
        db.get("SELECT type FROM attendance WHERE username = ? ORDER BY id DESC LIMIT 1", [device.username], (err, lastLog) => {
            const nextType = (lastLog && lastLog.type === 'Příchod') ? 'Odchod' : 'Příchod';
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
            const parts = formatter.formatToParts(now);
            const getPart = (type) => parts.find(p => p.type === type)?.value || '';
            const dateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
            const timeStr = `${getPart('hour')}:${getPart('minute')}`;

            db.run("INSERT INTO attendance (username, device_token, type, time, date) VALUES (?, ?, ?, ?, ?)", 
                [device.username, deviceToken, nextType, timeStr, dateStr], () => {
                res.json({ username: device.username, type: nextType, time: timeStr });
            });
        });
    });
});

app.get('/calendar.ics', (req, res) => {
    db.all("SELECT * FROM attendance ORDER BY id DESC", [], (err, rows) => {
        let ics = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//PofelGarage//CS\n";
        rows.forEach(r => {
            const d = r.date.replace(/-/g, '');
            const t = r.time.replace(':', '') + '00';
            ics += "BEGIN:VEVENT\nUID:att-" + r.id + "@pofel\nDTSTAMP:" + d + "T" + t + "Z\nDTSTART:" + d + "T" + t + "Z\nSUMMARY:" + r.type + " - " + r.username + "\nEND:VEVENT\n";
        });
        ics += "END:VCALENDAR";
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.send(ics);
    });
});

// --- API: VOZIDLA & FOTKY ---
app.get('/api/vehicles', (req, res) => db.all("SELECT * FROM vehicles ORDER BY id DESC", [], (err, rows) => res.json(rows)));
app.get('/api/completed-jobs', (req, res) => db.all("SELECT * FROM completed_jobs ORDER BY id DESC", [], (err, rows) => res.json(rows)));

app.put('/api/completed-jobs/:id', (req, res) => {
    let { work_done, cost_expenses, final_price, completed_by } = req.body;
    const netProfit = (parseFloat(final_price) || 0) - (parseFloat(cost_expenses) || 0);
    db.run(`UPDATE completed_jobs SET work_done = ?, cost_expenses = ?, final_price = ?, net_profit = ?, completed_by = ? WHERE id = ?`,
        [work_done.trim(), cost_expenses, final_price, netProfit, completed_by, req.params.id], () => {
        res.json({ message: 'Aktualizováno', netProfit });
    });
});

app.delete('/api/completed-jobs/:id', (req, res) => {
    db.run("DELETE FROM completed_jobs WHERE id = ?", [req.params.id], () => res.json({ message: 'Smazáno' }));
});

app.post('/api/vehicles', (req, res) => {
    let { spz, model, status, note, phone, user, mechanic, workDone, costExpenses, finalPrice } = req.body;
    spz = spz.trim().toUpperCase();
    const assignedMechanic = mechanic ? mechanic.trim() : (user || 'mechanik');

    if (status === 'Opraveno - připraveno k vyzvednutí') {
        const netProfit = (parseFloat(finalPrice) || 0) - (parseFloat(costExpenses) || 0);
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        const parts = formatter.formatToParts(now);
        const getPart = (type) => parts.find(p => p.type === type)?.value || '';
        const completedAt = `${getPart('year')}-${getPart('month')}-${getPart('day')} ${getPart('hour')}:${getPart('minute')}`;

        db.run(`INSERT INTO completed_jobs (spz, model, phone, work_done, cost_expenses, final_price, net_profit, completed_by, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [spz, model, phone, workDone, costExpenses, finalPrice, netProfit, assignedMechanic, completedAt], () => {
            db.run("DELETE FROM vehicles WHERE spz = ?", [spz], () => res.json({ message: 'Dokončeno', netProfit }));
        });
    } else {
        db.run(`INSERT INTO vehicles (spz, model, status, note, phone, created_by, updated_by, mechanic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(spz) DO UPDATE SET model=excluded.model, status=excluded.status, note=excluded.note, phone=excluded.phone, updated_by=excluded.updated_by, mechanic=excluded.mechanic`,
            [spz, model, status, note || '', phone, user, user, assignedMechanic], () => {
            res.json({ message: 'Uloženo' });
        });
    }
});

app.delete('/api/vehicles/:id', (req, res) => {
    db.all("SELECT photo_path FROM vehicle_photos WHERE vehicle_id = ?", [req.params.id], (err, rows) => {
        if (rows) rows.forEach(r => { if (fs.existsSync('.' + r.photo_path)) fs.unlinkSync('.' + r.photo_path); });
        db.run("DELETE FROM vehicle_photos WHERE vehicle_id = ?", [req.params.id], () => {
            db.run("DELETE FROM vehicles WHERE id = ?", [req.params.id], () => res.json({ message: 'Smazáno' }));
        });
    });
});

app.get('/api/vehicles/:id/photos', (req, res) => db.all("SELECT * FROM vehicle_photos WHERE vehicle_id = ?", [req.params.id], (err, rows) => res.json(rows)));

app.post('/api/vehicles/:id/photos', (req, res) => {
    const matches = req.body.imageBase64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
    const filename = 'car_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7) + '.' + (matches[1] === 'jpeg' ? 'jpg' : matches[1]);
    const filePath = path.join(uploadDir, filename);

    fs.writeFile(filePath, matches[2], 'base64', () => {
        const dbPath = '/uploads/' + filename;
        db.run("INSERT INTO vehicle_photos (vehicle_id, photo_path) VALUES (?, ?)", [req.params.id, dbPath], function() {
            res.json({ id: this.lastID, photo_path: dbPath });
        });
    });
});

app.delete('/api/photos/:id', (req, res) => {
    db.get("SELECT * FROM vehicle_photos WHERE id = ?", [req.params.id], (err, row) => {
        if (row && fs.existsSync('.' + row.photo_path)) fs.unlinkSync('.' + row.photo_path);
        db.run("DELETE FROM vehicle_photos WHERE id = ?", [req.params.id], () => res.json({ message: 'Smazáno' }));
    });
});

app.post('/api/login', (req, res) => {
    db.get("SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND password = ?", [req.body.username.trim(), req.body.password], (err, row) => {
        if (!row) return res.status(401).json({ error: 'Chybné jméno nebo heslo.' });
        res.json({ message: 'OK', username: row.username });
    });
});

// PWA manifest & sw
app.get('/manifest.json', (req, res) => {
    res.json({ name: "PofelGarage", short_name: "PofelGarage", start_url: "/", display: "standalone", background_color: "#0f172a", theme_color: "#2563eb" });
});
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`self.addEventListener('fetch', (e) => {});`);
});

app.listen(PORT, () => console.log(`Server běží na portu ${PORT}`));
