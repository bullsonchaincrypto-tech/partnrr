import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'rankleague.db');

let db;

export async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS foretag (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      namn TEXT NOT NULL,
      epost TEXT NOT NULL,
      kontaktperson TEXT,
      bransch TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS influencers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      foretag_id INTEGER,
      namn TEXT NOT NULL,
      kanalnamn TEXT NOT NULL,
      plattform TEXT NOT NULL,
      foljare TEXT,
      nisch TEXT,
      kontakt_epost TEXT,
      kontakt_info TEXT,
      referral_kod TEXT,
      vald INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS outreach_meddelanden (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      influencer_id INTEGER NOT NULL,
      foretag_id INTEGER NOT NULL,
      meddelande TEXT NOT NULL,
      amne TEXT,
      typ TEXT DEFAULT 'initial',
      status TEXT DEFAULT 'utkast',
      kontrakt_bifogat INTEGER DEFAULT 0,
      skickat_datum TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS kontrakt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      influencer_id INTEGER NOT NULL,
      foretag_id INTEGER NOT NULL,
      outreach_id INTEGER,
      kontaktperson TEXT NOT NULL,
      villkor_text TEXT,
      pdf_path TEXT,
      status TEXT DEFAULT 'genererat',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id),
      FOREIGN KEY (outreach_id) REFERENCES outreach_meddelanden(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS uppfoljningar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outreach_id INTEGER NOT NULL,
      influencer_id INTEGER NOT NULL,
      meddelande TEXT,
      skickat_datum TEXT,
      status TEXT DEFAULT 'vaentar',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (outreach_id) REFERENCES outreach_meddelanden(id),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gmail_tokens (
      id INTEGER PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      expiry_date TEXT,
      email TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // B2B Sponsor prospects
  db.run(`
    CREATE TABLE IF NOT EXISTS sponsor_prospects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      foretag_id INTEGER NOT NULL,
      namn TEXT NOT NULL,
      kontaktperson TEXT,
      epost TEXT,
      bransch TEXT,
      instagram_handle TEXT,
      hemsida TEXT,
      vald INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sponsor_outreach (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prospect_id INTEGER NOT NULL,
      foretag_id INTEGER NOT NULL,
      meddelande TEXT NOT NULL,
      amne TEXT,
      kanal TEXT DEFAULT 'email',
      status TEXT DEFAULT 'utkast',
      skickat_datum TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (prospect_id) REFERENCES sponsor_prospects(id),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
  `);

  // Email tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS email_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outreach_id INTEGER,
      sponsor_outreach_id INTEGER,
      tracking_id TEXT NOT NULL UNIQUE,
      oppnad INTEGER DEFAULT 0,
      oppnad_datum TEXT,
      oppnad_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Influencer performance / signups
  db.run(`
    CREATE TABLE IF NOT EXISTS influencer_signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      influencer_id INTEGER NOT NULL,
      referral_kod TEXT,
      antal_signups INTEGER DEFAULT 0,
      senast_uppdaterad TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id)
    )
  `);

  saveDb();
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Helper: run query and return rows as objects
export function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

export function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

export function runSql(sql, params = []) {
  db.run(sql, params);
  saveDb();
  return { lastId: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] };
}

export default getDb;
