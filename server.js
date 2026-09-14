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

// Demo / test account — auto-seeded on every startup so the login screen always
// has a working account even after a cold start / redeploy.
const DEMO_PHONE = process.env.DEMO_PHONE || '01712345678';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || '123456';
const DEMO_NAME = process.env.DEMO_NAME || 'Test User';
const SEED_DEMO = (process.env.SEED_DEMO || 'true') !== 'false';

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());

// Serve admin panel.
// express.static already redirects /admin -> /admin/ on its own (and serves
// admin/index.html), so no manual redirect route is needed here.
app.use('/admin', express.static(path.join(__dirname, 'admin')));

/** Wrap an async route so a rejected promise becomes a 500 instead of a hang */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============ HEALTH / INFO ============
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Earn App backend',
    version: '2.0.0',
    database: db.engine,
    persistent: db.isPersistent,
    health: '/api/health',
    dbStatus: '/api/db-status',
    admin: '/admin/',
    time: new Date().toISOString(),
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Earn App backend is healthy',
    database: db.engine,
    persistent: db.isPersistent,
    time: new Date().toISOString(),
  });
});

// Tells you at a glance whether the data really is persistent + who exists.
app.get('/api/db-status', ah(async (req, res) => {
  const users = await db.get('SELECT COUNT(*) AS c FROM users');
  const withdrawals = await db.get('SELECT COUNT(*) AS c FROM withdraw_requests');
  const demo = await db.get('SELECT id, name, phone FROM users WHERE phone = ?', [DEMO_PHONE]);
  res.json({
    engine: db.engine,
    persistent: db.isPersistent,
    note: db.isPersistent
      ? 'Managed PostgreSQL — data survives restarts and redeploys.'
      : 'Local SQLite file — EPHEMERAL on Render free tier, data can be wiped on restart.',
    users: Number(users ? users.c : 0),
    withdrawals: Number(withdrawals ? withdrawals.c : 0),
    demoAccount: demo ? { id: demo.id, name: demo.name, phone: demo.phone } : null,
    time: new Date().toISOString(),
  });
}));

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
app.post('/api/register', ah(async (req, res) => {
  const { name, phone, password } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'name, phone, password required' });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const exists = await db.get('SELECT id FROM users WHERE phone = ?', [phone]);
  if (exists) return res.status(400).json({ error: 'Phone already registered' });

  const hash = bcrypt.hashSync(String(password), 10);
  const info = await db.run('INSERT INTO users (name, phone, password) VALUES (?, ?, ?)', [name, phone, hash]);
  const user = await db.get(
    'SELECT id, name, phone, balance, total_earned, ads_watched FROM users WHERE id = ?',
    [info.lastInsertRowid]
  );
  const token = jwt.sign({ id: user.id, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user });
}));

// Login
app.post('/api/login', ah(async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'phone, password required' });

  const user = await db.get('SELECT * FROM users WHERE phone = ?', [phone]);
  if (!user || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ error: 'Invalid phone or password' });
  }
  const token = jwt.sign({ id: user.id, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    token,
    user: {
      id: user.id, name: user.name, phone: user.phone,
      balance: Number(user.balance), total_earned: Number(user.total_earned),
      ads_watched: Number(user.ads_watched),
    },
  });
}));

// Get profile / balance
app.get('/api/me', authUser, ah(async (req, res) => {
  const user = await db.get(
    'SELECT id, name, phone, balance, total_earned, ads_watched FROM users WHERE id = ?',
    [req.userId]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
}));

// ============ REWARD ============
app.post('/api/reward', authUser, ah(async (req, res) => {
  const { amount } = req.body;
  const reward = Number(amount);
  if (!reward || reward <= 0 || reward > 100) {
    return res.status(400).json({ error: 'Invalid reward amount' });
  }
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newBalance = Number(user.balance) + reward;
  const newTotal = Number(user.total_earned) + reward;
  await db.run(
    'UPDATE users SET balance = ?, total_earned = ?, ads_watched = ads_watched + 1 WHERE id = ?',
    [newBalance, newTotal, req.userId]
  );
  await db.run('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)', [
    req.userId, 'earn', reward, 'Ad reward',
  ]);

  res.json({ balance: newBalance, total_earned: newTotal, ads_watched: Number(user.ads_watched) + 1 });
}));

// Get transactions
app.get('/api/transactions', authUser, ah(async (req, res) => {
  const rows = await db.all('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100', [req.userId]);
  res.json(rows);
}));

// ============ WITHDRAW ============
const MIN_WITHDRAW = 50;

function validateWithdraw(amount, mobile) {
  const amt = Number(amount);
  if (!amt || amt <= 0) return { error: 'Invalid amount' };
  if (amt < MIN_WITHDRAW) return { error: `Minimum withdraw is ${MIN_WITHDRAW} taka` };
  if (!mobile || !/^01[3-9]\d{8}$/.test(mobile)) {
    return { error: 'Invalid mobile number (must be 01XXXXXXXXX)' };
  }
  return { amt };
}

app.post('/api/withdraw', authUser, ah(async (req, res) => {
  const { amount, method, mobile } = req.body;
  const v = validateWithdraw(amount, mobile);
  if (v.error) return res.status(400).json({ error: v.error });
  if (!method || !['bkash', 'nagad', 'rocket'].includes(method)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (Number(user.balance) < v.amt) return res.status(400).json({ error: 'Insufficient balance' });

  await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [v.amt, req.userId]);
  const info = await db.run(
    'INSERT INTO withdraw_requests (user_id, amount, method, mobile) VALUES (?, ?, ?, ?)',
    [req.userId, v.amt, method, mobile]
  );
  await db.run('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)', [
    req.userId, 'withdraw', v.amt, `Withdraw via ${method}`,
  ]);

  res.json({
    id: info.lastInsertRowid, amount: v.amt, method, mobile,
    status: 'pending', balance: Number(user.balance) - v.amt,
  });
}));

// My withdraw requests
app.get('/api/withdraws', authUser, ah(async (req, res) => {
  const rows = await db.all('SELECT * FROM withdraw_requests WHERE user_id = ? ORDER BY id DESC', [req.userId]);
  res.json(rows);
}));

// ============ BKASH CASH-OUT ============
app.post('/api/withdraw/bkash', authUser, ah(async (req, res) => {
  const { amount, mobile } = req.body;
  const v = validateWithdraw(amount, mobile);
  if (v.error) return res.status(400).json({ error: v.error });

  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (Number(user.balance) < v.amt) return res.status(400).json({ error: 'Insufficient balance' });

  await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [v.amt, req.userId]);
  const info = await db.run(
    'INSERT INTO withdraw_requests (user_id, amount, method, mobile) VALUES (?, ?, ?, ?)',
    [req.userId, v.amt, 'bkash', mobile]
  );
  await db.run('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)', [
    req.userId, 'withdraw', v.amt, `bKash cash-out to ${mobile}`,
  ]);

  res.json({
    id: info.lastInsertRowid, amount: v.amt, method: 'bkash', mobile,
    status: 'pending', balance: Number(user.balance) - v.amt,
  });
}));

// ============ ADMIN ============
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ id: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid admin credentials' });
});

const ADMIN_WITHDRAW_SQL = `
  SELECT w.*, u.name, u.phone AS user_phone
  FROM withdraw_requests w JOIN users u ON u.id = w.user_id
  WHERE w.status = ? ORDER BY w.id DESC
`;

app.get('/api/admin/withdraws', authAdmin, ah(async (req, res) => {
  const status = req.query.status;
  const rows = status
    ? await db.all(ADMIN_WITHDRAW_SQL, [status])
    : await db.all(ADMIN_WITHDRAW_SQL.replace('WHERE w.status = ? ', ''));
  res.json(rows);
}));

// Alias kept for older clients
app.get('/api/admin/withdrawals', authAdmin, ah(async (req, res) => {
  const status = req.query.status;
  const rows = status
    ? await db.all(ADMIN_WITHDRAW_SQL, [status])
    : await db.all(ADMIN_WITHDRAW_SQL.replace('WHERE w.status = ? ', ''));
  res.json(rows);
}));

async function processWithdraw(id, action) {
  const row = await db.get('SELECT * FROM withdraw_requests WHERE id = ?', [id]);
  if (!row) return { code: 404, body: { error: 'Request not found' } };
  if (row.status !== 'pending') return { code: 400, body: { error: 'Already processed' } };

  await db.run('UPDATE withdraw_requests SET status = ?, processed_at = NOW() WHERE id = ?', [action, id]);
  if (action === 'rejected') {
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [Number(row.amount), row.user_id]);
  }
  return { code: 200, body: { success: true, status: action } };
}

app.post('/api/admin/withdraws/:id/approve', authAdmin, ah(async (req, res) => {
  const r = await processWithdraw(req.params.id, 'approved');
  res.status(r.code).json(r.body);
}));
app.post('/api/admin/withdrawals/:id/approve', authAdmin, ah(async (req, res) => {
  const r = await processWithdraw(req.params.id, 'approved');
  res.status(r.code).json(r.body);
}));
app.post('/api/admin/withdraws/:id/reject', authAdmin, ah(async (req, res) => {
  const r = await processWithdraw(req.params.id, 'rejected');
  res.status(r.code).json(r.body);
}));
app.post('/api/admin/withdrawals/:id/reject', authAdmin, ah(async (req, res) => {
  const r = await processWithdraw(req.params.id, 'rejected');
  res.status(r.code).json(r.body);
}));

app.get('/api/admin/users', authAdmin, ah(async (req, res) => {
  const rows = await db.all(
    'SELECT id, name, phone, balance, total_earned, ads_watched, created_at FROM users ORDER BY id DESC'
  );
  res.json(rows);
}));

app.get('/api/admin/stats', authAdmin, ah(async (req, res) => {
  const users = await db.get('SELECT COUNT(*) AS c FROM users');
  const pending = await db.get("SELECT COUNT(*) AS c FROM withdraw_requests WHERE status = 'pending'");
  const approved = await db.get("SELECT COUNT(*) AS c FROM withdraw_requests WHERE status = 'approved'");
  const totalPaid = await db.get("SELECT COALESCE(SUM(amount), 0) AS s FROM withdraw_requests WHERE status = 'approved'");
  res.json({
    users: Number(users.c),
    pending: Number(pending.c),
    approved: Number(approved.c),
    totalPaid: Number(totalPaid.s),
    database: db.engine,
    persistent: db.isPersistent,
  });
}));

// ============ ERROR HANDLER ============
app.use((err, req, res, next) => {
  console.error('[api] error on', req.method, req.originalUrl, '-', err.message);
  res.status(500).json({ error: 'Server error', detail: err.message });
});

// ============ STARTUP ============
(async () => {
  try {
    await db.init();
    console.log(`Database engine: ${db.engine} (persistent: ${db.isPersistent})`);

    if (SEED_DEMO) {
      try {
        const existing = await db.get('SELECT id FROM users WHERE phone = ?', [DEMO_PHONE]);
        if (existing) {
          console.log(`Demo account already present: ${DEMO_PHONE}`);
        } else {
          const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
          await db.run('INSERT INTO users (name, phone, password) VALUES (?, ?, ?)', [DEMO_NAME, DEMO_PHONE, hash]);
          console.log(`Demo account created: ${DEMO_PHONE} / ${DEMO_PASSWORD}`);
        }
      } catch (e) {
        console.error('Demo account seeding failed:', e.message);
      }
    }

    app.listen(PORT, () => {
      console.log(`Earn App backend running on http://localhost:${PORT}`);
      console.log(`Admin panel: http://localhost:${PORT}/admin/`);
      console.log(`Admin login: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
    });
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
})();
