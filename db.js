// SQLite via sql.js (pure JS/WASM) - no native compilation needed.
// This avoids the "gyp ERR! not ok" error on Render when building native
// modules like better-sqlite3. Provides a better-sqlite3-like API:
//   db.prepare(sql).get(...) / .all(...) / .run(...)  and  db.exec(sql)
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'earnapp.db');

let SQL = null;      // sql.js namespace
let sqlite = null;   // sql.js Database instance
const pendingExec = []; // SQL queued before the DB is ready

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
    } else {
      pendingExec.push(sql);
    }
  },
  ready: initSqlJs().then((S) => {
    SQL = S;
    if (fs.existsSync(DB_FILE)) {
      sqlite = new S.Database(fs.readFileSync(DB_FILE));
    } else {
      sqlite = new S.Database();
    }
    // Run any SQL that was queued before the DB was ready (e.g. schema).
    pendingExec.forEach((s) => sqlite.exec(s));
    pendingExec.length = 0;
    // Persist the database to disk when the process exits.
    process.on('exit', () => {
      try {
        const data = sqlite.export();
        fs.writeFileSync(DB_FILE, Buffer.from(data));
      } catch (e) {
        console.error('Failed to persist DB:', e);
      }
    });
  })
};

module.exports = database;