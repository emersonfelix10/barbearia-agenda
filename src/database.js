const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

function createDatabaseApi(database, filePath) {
  let inTransaction = false;

  function persist() {
    if (inTransaction) return;
    const tempPath = `${filePath}.tmp`;
    const bytes = Buffer.from(database.export());
    fs.writeFileSync(tempPath, bytes, { mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  }

  function rows(sql, params = []) {
    const statement = database.prepare(sql);
    try {
      statement.bind(params);
      const result = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally {
      statement.free();
    }
  }

  function get(sql, params = []) {
    return rows(sql, params)[0] || null;
  }

  function rawRun(sql, params = []) {
    database.run(sql, params);
    return {
      changes: database.getRowsModified(),
      lastInsertId: Number(get('SELECT last_insert_rowid() AS id')?.id || 0)
    };
  }

  function run(sql, params = []) {
    const result = rawRun(sql, params);
    if (!inTransaction) persist();
    return result;
  }

  function transaction(fn) {
    database.run('BEGIN IMMEDIATE');
    inTransaction = true;
    try {
      const tx = {
        run: rawRun,
        get,
        all: rows
      };
      const result = fn(tx);
      database.run('COMMIT');
      inTransaction = false;
      persist();
      return result;
    } catch (error) {
      try { database.run('ROLLBACK'); } catch (_) {}
      inTransaction = false;
      throw error;
    }
  }

  return {
    filePath,
    all: rows,
    get,
    run,
    transaction,
    persist,
    close() {
      persist();
      database.close();
    }
  };
}

async function openDatabase(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data'));
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dataDir, 'barbearia.sqlite');
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  const database = fs.existsSync(filePath)
    ? new SQL.Database(new Uint8Array(fs.readFileSync(filePath)))
    : new SQL.Database();

  database.run('PRAGMA foreign_keys = ON');
  database.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      client_phone TEXT NOT NULL,
      whatsapp_consent INTEGER NOT NULL DEFAULT 0,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      barber_id TEXT NOT NULL,
      barber_name TEXT NOT NULL,
      date_local TEXT NOT NULL,
      time_local TEXT NOT NULL,
      starts_at_utc TEXT NOT NULL,
      ends_at_utc TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','confirmed','cancelled','attended','missed')),
      confirm_token TEXT NOT NULL,
      cancel_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      missed_at TEXT,
      no_show_notified_at TEXT
    );
    CREATE INDEX IF NOT EXISTS appointments_date_barber_idx ON appointments(date_local, barber_id, status);
    CREATE INDEX IF NOT EXISTS appointments_start_idx ON appointments(starts_at_utc, status);
    CREATE TABLE IF NOT EXISTS whatsapp_outbox (
      id TEXT PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      template_key TEXT NOT NULL,
      send_after_utc TEXT NOT NULL,
      expires_at_utc TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','cancelled','expired','dead')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_utc TEXT,
      last_error_code TEXT,
      provider_message_id TEXT,
      sent_at_utc TEXT,
      created_at_utc TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS outbox_due_idx ON whatsapp_outbox(status, send_after_utc, next_attempt_utc);
    PRAGMA user_version = 1;
  `);

  const api = createDatabaseApi(database, filePath);
  api.persist();
  return api;
}

module.exports = { openDatabase };
