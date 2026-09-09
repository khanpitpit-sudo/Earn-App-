const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'earn_app_super_secret_key_change_me';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ============ DATABASE (sql.js - pure JS/WASM, no native build) ============
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    total_earned REAL NOT NULL DEFAULT 0,
    ads_watched INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS withdraw_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    method TEXT NOT NULL,
    mobile TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());

// Serve admin panel
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Earn App backend is healthy', time: new Date().toISOString() });
});

// ============ AUTH HELPERS ============
function authUser(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'user') return res.status(401).json({ error: 'Invalid token' });
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function authAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(401).json({ error: 'Not admin' });
    req.adminId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ============ USER AUTH ============
// Register
app.post('/api/register', (req, res) => {
  const { name, phone, password } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'name, phone, password required' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (exists) return res.status(400).json({ error: 'Phone already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name, phone, password) VALUES (?, ?, ?)')
    .run(name, phone, hash);
  const user = db.prepare('SELECT id, name, phone, balance, total_earned, ads_watched FROM users WHERE id = ?')
    .get(info.lastInsertRowid);
  const token = jwt.sign({ id: user.id, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user });
});

// Login
app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'phone, password required' });
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid phone or password' });
  }
  const token = jwt.sign({ id: user.id, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    token,
    user: {
      id: user.id, name: user.name, phone: user.phone,
      balance: user.balance, total_earned: user.total_earned, ads_watched: user.ads_watched
    }
  });
});

// Get profile / balance
app.get('/api/me', authUser, (req, res) => {
  const user = db.prepare('SELECT id, name, phone, balance, total_earned, ads_watched FROM users WHERE id = ?')
    .get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// ============ REWARD ============
// Add reward after watching ad (server-side credit)
app.post('/api/reward', authUser, (req, res) => {
  const { amount } = req.body;
  const reward = Number(amount);
  if (!reward || reward <= 0 || reward > 100) {
    return res.status(400).json({ error: 'Invalid reward amount' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newBalance = user.balance + reward;
  const newTotal = user.total_earned + reward;
  db.prepare('UPDATE users SET balance = ?, total_earned = ?, ads_watched = ads_watched + 1 WHERE id = ?')
    .run(newBalance, newTotal, req.userId);
  db.prepare('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)')
    .run(req.userId, 'earn', reward, 'Ad reward');

  res.json({
    balance: newBalance,
    total_earned: newTotal,
    ads_watched: user.ads_watched + 1
  });
});

// Get transactions
app.get('/api/transactions', authUser, (req, res) => {
  const rows = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100')
    .all(req.userId);
  res.json(rows);
});

// ============ WITHDRAW ============
// Submit withdraw request
app.post('/api/withdraw', authUser, (req, res) => {
  const { amount, method, mobile } = req.body;
  const amt = Number(amount);
  const MIN_WITHDRAW = 50;

  if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
  if (amt < MIN_WITHDRAW) return res.status(400).json({ error: `Minimum withdraw is ${MIN_WITHDRAW} taka` });
  if (!method || !['bkash', 'nagad', 'rocket'].includes(method)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }
  if (!mobile || !/^01[3-9]\d{8}$/.test(mobile)) {
    return res.status(400).json({ error: 'Invalid mobile number (must be 01XXXXXXXXX)' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.balance < amt) return res.status(400).json({ error: 'Insufficient balance' });

  // Deduct balance and create request
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amt, req.userId);
  const info = db.prepare(
    'INSERT INTO withdraw_requests (user_id, amount, method, mobile) VALUES (?, ?, ?, ?)'
  ).run(req.userId, amt, method, mobile);
  db.prepare('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)')
    .run(req.userId, 'withdraw', amt, `Withdraw via ${method}`);

  res.json({
    id: info.lastInsertRowid,
    amount: amt,
    method,
    mobile,
    status: 'pending',
    balance: user.balance - amt
  });
});

// My withdraw requests
app.get('/api/withdraws', authUser, (req, res) => {
  const rows = db.prepare('SELECT * FROM withdraw_requests WHERE user_id = ? ORDER BY id DESC')
    .all(req.userId);
  res.json(rows);
});

// ============ ADMIN ============
// Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ id: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid admin credentials' });
});

// Admin: all withdraw requests
app.get('/api/admin/withdraws', authAdmin, (req, res) => {
  const status = req.query.status;
  let rows;
  if (status) {
    rows = db.prepare(`
      SELECT w.*, u.name, u.phone AS user_phone
      FROM withdraw_requests w JOIN users u ON u.id = w.user_id
      WHERE w.status = ? ORDER BY w.id DESC
    `).all(status);
  } else {
    rows = db.prepare(`
      SELECT w.*, u.name, u.phone AS user_phone
      FROM withdraw_requests w JOIN users u ON u.id = w.user_id
      ORDER BY w.id DESC
    `).all();
  }
  res.json(rows);
});

// Approve withdraw
app.post('/api/admin/withdraws/:id/approve', authAdmin, (req, res) => {
  const reqRow = db.prepare('SELECT * FROM withdraw_requests WHERE id = ?').get(req.params.id);
  if (!reqRow) return res.status(404).json({ error: 'Request not found' });
  if (reqRow.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  db.prepare("UPDATE withdraw_requests SET status = ?, processed_at = datetime('now') WHERE id = ?")
    .run('approved', req.params.id);
  res.json({ success: true, status: 'approved' });
});

// Reject withdraw (refund balance)
app.post('/api/admin/withdraws/:id/reject', authAdmin, (req, res) => {
  const reqRow = db.prepare('SELECT * FROM withdraw_requests WHERE id = ?').get(req.params.id);
  if (!reqRow) return res.status(404).json({ error: 'Request not found' });
  if (reqRow.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  db.prepare("UPDATE withdraw_requests SET status = ?, processed_at = datetime('now') WHERE id = ?")
    .run('rejected', req.params.id);
  // Refund balance
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(reqRow.amount, reqRow.user_id);
  res.json({ success: true, status: 'rejected' });
});

// Admin: list users
app.get('/api/admin/users', authAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, name, phone, balance, total_earned, ads_watched, created_at FROM users ORDER BY id DESC').all();
  res.json(rows);
});

// Admin: stats
app.get('/api/admin/stats', authAdmin, (req, res) => {
  const users = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM withdraw_requests WHERE status = 'pending'").get().c;
  const approved = db.prepare("SELECT COUNT(*) c FROM withdraw_requests WHERE status = 'approved'").get().c;
  const totalPaid = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM withdraw_requests WHERE status = 'approved'").get().s;
  res.json({ users, pending, approved, totalPaid });
});

db.ready.then(() => {
  app.listen(PORT, () => {
    console.log(`Earn App backend running on http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
    console.log(`Admin login: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});