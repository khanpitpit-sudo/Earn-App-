// db.js — dual-engine database adapter for the Earn App backend
//
// The engine is chosen AUTOMATICALLY at startup:
//
//   • PostgreSQL  — used when DATABASE_URL (or POSTGRES_URL / PG* env vars) is
//                   set. This is the PERSISTENT option: a managed Postgres
//                   (e.g. Render Postgres) keeps its data across restarts,
//                   redeploys and cold starts.
//   • SQLite      — sql.js (pure JS/WASM) fallback when no DATABASE_URL exists,
//                   so the app still runs locally / on a plain container with
//                   no native compilation (no "gyp ERR! not ok").
//
// WHY THIS FILE WAS REWRITTEN
// The previous version stored everything in a local `earnapp.db` file. On a
// Render *free web service* the filesystem is EPHEMERAL: the disk is wiped on
// every spin-down (15 min idle) and every redeploy. Saving on every write and
// on SIGTERM helped only for a graceful in-place restart — the file was still
// destroyed whenever the container itself was replaced. That is why the test
// account kept disappearing and the app reported "Login hosse na".
// With DATABASE_URL pointing at a managed Postgres, the data survives.
//
// Public API (all async):
//   await db.init()                 // connect + create schema
//   await db.get(sql, params)       // one row, or undefined
//   await db.all(sql, params)       // array of rows
//   await db.run(sql, params)       // { changes, lastInsertRowid }
//   await db.exec(sqlText)          // multi-statement DDL (no params)
//   db.dialect                      // 'postgres' | 'sqlite'
//
// SQL is always written with '?' placeholders; they are translated to $1,$2,…
// for Postgres, so the query code in server.js stays engine-agnostic.

const fs = require('fs');
const path = require('path');

const PG_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRESQL_URL ||
  process.env.PG_URL ||
  '';

const USE_PG = !!PG_URL;
const dialect = USE_PG ? 'postgres' : 'sqlite';

const DB_FILE = process.env.SQLITE_FILE || path.join(__dirname, 'earnapp.db');

/* ------------------------------------------------------------------ *
 *  Schema — one per dialect (SERIAL vs AUTOINCREMENT, NOW() vs datetime)
 * ------------------------------------------------------------------ */
const PG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    phone         TEXT UNIQUE NOT NULL,
    password      TEXT NOT NULL,
    balance       DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_earned  DOUBLE PRECISION NOT NULL DEFAULT 0,
    ads_watched   INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    type        TEXT NOT NULL,
    amount      DOUBLE PRECISION NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS withdraw_requests (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    amount       DOUBLE PRECISION NOT NULL,
    method       TEXT NOT NULL,
    mobile       TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
  );
`;

const SQLITE_SCHEMA = `
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
`;

/* ------------------------------------------------------------------ *
 *  Shared helpers
 * ------------------------------------------------------------------ */
/** '?' → '$1','$2',… (Postgres only) */
function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** pg returns null for "no row"; normalise to undefined like sqlite does. */
function firstOrUndefined(rows) {
  return rows && rows.length ? rows[0] : undefined;
}

/* ------------------------------------------------------------------ *
 *  PostgreSQL backend
 * ------------------------------------------------------------------ */
let pool = null;

async function initPostgres() {
  const { Pool } = require('pg');

  const isLocal = /(localhost|127\.0\.0\.1|::1)/.test(PG_URL);
  const sslDisabled = process.env.PGSSL === 'disable' || isLocal;

  pool = new Pool({
    connectionString: PG_URL,
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });

  pool.on('error', (err) => console.error('[pg] idle client error:', err.message));

  await pool.query('SELECT 1');            // fail fast if unreachable
  await pool.query(PG_SCHEMA);             // multi-statement DDL (no params)
  console.log('[db] PostgreSQL connected — data is PERSISTENT');
}

const pg = {
  async get(sql, params = []) {
    const r = await pool.query(toPgPlaceholders(sql), params);
    return firstOrUndefined(r.rows);
  },
  async all(sql, params = []) {
    const r = await pool.query(toPgPlaceholders(sql), params);
    return r.rows;
  },
  async run(sql, params = []) {
    let q = toPgPlaceholders(sql);
    const isInsert = /^\s*insert\s/i.test(sql);
    // Ask Postgres for the new id — replaces sqlite's last_insert_rowid()
    if (isInsert && !/returning\s/i.test(q)) q += ' RETURNING id';
    const r = await pool.query(q, params);
    return {
      changes: r.rowCount,
      lastInsertRowid: isInsert && r.rows.length ? r.rows[0].id : undefined,
    };
  },
  async exec(sqlText) {
    await pool.query(sqlText);
  },
};

/* ------------------------------------------------------------------ *
 *  SQLite (sql.js, pure JS/WASM) fallback backend
 * ------------------------------------------------------------------ */
let sqlite = null;
let persistTimer = null;
let persistPending = false;

function persistNow() {
  if (!sqlite) return;
  try {
    fs.writeFileSync(DB_FILE, Buffer.from(sqlite.export()));
    persistPending = false;
  } catch (e) {
    console.error('[db] persist failed:', e.message);
  }
}

function schedulePersist() {
  persistPending = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistPending) persistNow();
  }, 800);
}

function flushAndExit(signal) {
  try {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistNow();
    console.log(`[db] saved on ${signal}`);
  } catch (e) {
    console.error('[db] save on shutdown failed:', e.message);
  }
  if (signal !== 'exit' && signal !== 'beforeExit') process.exit(0);
}

async function initSqlite() {
  const initSqlJs = require('sql.js');
  const S = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    sqlite = new S.Database(fs.readFileSync(DB_FILE));
    console.log('[db] SQLite loaded from disk:', DB_FILE);
  } else {
    sqlite = new S.Database();
    console.log('[db] new SQLite file created:', DB_FILE);
  }

  sqlite.exec(SQLITE_SCHEMA);
  persistNow();

  ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP'].forEach((sig) =>
    process.on(sig, () => flushAndExit(sig))
  );
  process.on('beforeExit', () => persistNow());
  process.on('exit', () => persistNow());
  process.on('uncaughtException', (err) => {
    console.error('[db] uncaught exception:', err);
    flushAndExit('uncaughtException');
  });

  console.log('[db] SQLite (sql.js) ready — NOTE: file storage is ephemeral on Render free tier');
}

function sqliteRun(sql, params = []) {
  const stmt = sqlite.prepare(sql);
  try {
    stmt.bind(params);
    stmt.step();
    const changes = sqlite.getRowsModified();
    const idRes = sqlite.exec('SELECT last_insert_rowid() AS id');
    const lastInsertRowid = idRes.length ? idRes[0].values[0][0] : 0;
    schedulePersist();
    return { changes, lastInsertRowid };
  } finally {
    stmt.reset();
    if (stmt.free) stmt.free();
  }
}

function sqliteAll(sql, params = []) {
  const stmt = sqlite.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.reset();
    if (stmt.free) stmt.free();
  }
}

const sq = {
  async get(sql, params = []) {
    const stmt = sqlite.prepare(sql);
    try {
      stmt.bind(params);
      return stmt.step() ? stmt.getAsObject() : undefined;
    } finally {
      stmt.reset();
      if (stmt.free) stmt.free();
    }
  },
  async all(sql, params = []) {
    return sqliteAll(sql, params);
  },
  async run(sql, params = []) {
    return sqliteRun(sql, params);
  },
  async exec(sqlText) {
    sqlite.exec(sqlText);
    schedulePersist();
  },
};

/* ------------------------------------------------------------------ *
 *  Public adapter
 * ------------------------------------------------------------------ */
const backend = USE_PG ? pg : sq;

const db = {
  dialect,
  engine: USE_PG ? 'postgres' : 'sqlite',
  isPersistent: USE_PG,

  async init() {
    if (USE_PG) await initPostgres();
    else await initSqlite();
    return db;
  },

  get: (sql, params) => backend.get(sql, params),
  all: (sql, params) => backend.all(sql, params),
  run: (sql, params) => backend.run(sql, params),
  exec: (sqlText) => backend.exec(sqlText),

  /** multi-statement + params isn't possible on pg; keep the helper honest */
  async execMany(sqlText) {
    return backend.exec(sqlText);
  },

  /** sqlite only — kept so existing callers still work */
  persist() {
    if (!USE_PG) persistNow();
  },

  async close() {
    if (USE_PG && pool) await pool.end();
    else persistNow();
  },
};

module.exports = db;
