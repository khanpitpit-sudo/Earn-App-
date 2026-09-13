// SQLite via sql.js (pure JS/WASM) - no native compilation needed.
// This avoids the "gyp ERR! not ok" error on Render when building native
// modules like better-sqlite3. Provides a better-sqlite3-like API:
//   db.prepare(sql).get(...) / .all(...) / .run(...)  and  db.exec(sql)
//
// ============ PERSISTENCE FIX ============
// আগে DB ফাইল disk-এ লেখা হত শুধু process.on('exit') হ্যান্ডলারে।
// কিন্তু Render-এর মতো PaaS সার্ভিস থামানোর সময় process-কে SIGTERM পাঠায়,
// আর SIGTERM-এ Node-এর 'exit' ইভেন্ট চলে না। ফলে DB ফাইল কখনোই লেখা হত না।
// Render-এর ফাইলসিস্টেম ephemeral হওয়ায় প্রতিটি restart/ deploy-এ
// খালি ডেটাবেস দিয়ে শুরু হত — সব ইউজার অ্যাকাউন্ট মুছে যেত এবং
// পুরনো অ্যাকাউন্ট দিয়ে লগইন করা যেত না।
//
// এখন:
//   ১. প্রতিটি write-এর পর পরই ডেটা ফাইলে সেভ হয় (800ms debounce)।
//   ২. SIGTERM / SIGINT / beforeExit / exit / uncaughtException —
//      যেকোনো পথে বন্ধ হলেও সর্বশেষ ডেটা সেভ হয়ে যায়।
// NOTE: Render-এর ডিস্ক এখনো ephemeral, তাই সত্যিই স্থায়ী ডেটার জন্য
// একটি Managed PostgreSQL (Render Postgres) ব্যবহার করা উচিত।
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'earnapp.db');

let SQL = null;      // sql.js namespace
let sqlite = null;   // sql.js Database instance
const pendingExec = []; // SQL queued before the DB is ready

let persistTimer = null;
let persistPending = false;

/** ডেটাবেস এখনই ফাইলে সেভ করা (synchronous — exit হ্যান্ডলারেও কাজ করে) */
function persistNow() {
  if (!sqlite) return;
  try {
    const data = sqlite.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data));
    persistPending = false;
  } catch (e) {
    console.error('Failed to persist DB:', e);
  }
}

/** write-এর পর সেভ শিডিউল করা — বারবার write হলেও ডিস্ক I/O কম রাখতে debounce */
function schedulePersist() {
  persistPending = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistPending) persistNow();
  }, 800);
}

/** যেকোনো উপায়ে বন্ধ হওয়ার আগে শেষবার ডেটা সেভ */
function flushAndExit(signal) {
  try {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistNow();
    console.log(`DB saved on ${signal}`);
  } catch (e) {
    console.error('Failed to save DB on shutdown:', e);
  }
  if (signal !== 'exit' && signal !== 'beforeExit') {
    process.exit(0);
  }
}

function prepare(sql) {
  const stmt = sqlite.prepare(sql);
  return {
    get(...params) {
      try {
        stmt.bind(params);
        if (stmt.step()) return stmt.getAsObject();
        return undefined;
      } finally {
        stmt.reset();
      }
    },
    all(...params) {
      try {
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally {
        stmt.reset();
      }
    },
    run(...params) {
      try {
        stmt.bind(params);
        stmt.step();
        const changes = sqlite.getRowsModified();
        const idRes = sqlite.exec('SELECT last_insert_rowid() AS id');
        const lastInsertRowid = idRes.length ? idRes[0].values[0][0] : 0;
        // ✅ প্রতিটি write-এর পর ডেটা ফাইলে সেভ — restart হলেও ডেটা থাকে
        schedulePersist();
        return { changes, lastInsertRowid };
      } finally {
        stmt.reset();
      }
    }
  };
}

const database = {
  prepare,
  exec(sql) {
    if (sqlite) {
      sqlite.exec(sql);
      schedulePersist();
    } else {
      pendingExec.push(sql);
    }
  },
  persist: persistNow,
  ready: initSqlJs().then((S) => {
    SQL = S;
    if (fs.existsSync(DB_FILE)) {
      sqlite = new S.Database(fs.readFileSync(DB_FILE));
      console.log('DB loaded from disk:', DB_FILE);
    } else {
      sqlite = new S.Database();
      console.log('New DB created:', DB_FILE);
    }
    // Run any SQL that was queued before the DB was ready (e.g. schema).
    pendingExec.forEach((s) => sqlite.exec(s));
    pendingExec.length = 0;
    // স্কিমা তৈরি হওয়ার পর প্রথমবার সেভ
    persistNow();

    // ✅ shutdown-এর সব পথেই ডেটা সেভ (SIGTERM = Render-এর স্ট্যান্ডার্ড সিগন্যাল)
    ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP'].forEach((sig) => {
      process.on(sig, () => flushAndExit(sig));
    });
    process.on('beforeExit', () => persistNow());
    process.on('exit', () => persistNow());
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err);
      flushAndExit('uncaughtException');
    });
  })
};

module.exports = database;
