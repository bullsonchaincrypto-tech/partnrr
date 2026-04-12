import pg from 'pg';

const { Pool } = pg;

let pool;

// Helper: convert ? placeholders to $1, $2, $3... for PostgreSQL
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Helper: convert SQLite syntax to PostgreSQL
function convertSql(sql) {
  // Convert INSERT OR REPLACE → INSERT ... ON CONFLICT DO NOTHING (safe for caches)
  sql = sql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO');
  // We'll add ON CONFLICT below after placeholders

  // Convert datetime('now') and datetime("now") to NOW()
  sql = sql.replace(/datetime\(['"]now['"]\)/g, "NOW()");
  // Convert datetime('now', '+30 days') to NOW() + INTERVAL '30 days'
  sql = sql.replace(/datetime\(['"]now['"],\s*'([^']*)'\)/g, (match, interval) => {
    return `(NOW() + INTERVAL '${interval}')`;
  });
  // Convert julianday differences to PostgreSQL EXTRACT
  sql = sql.replace(/julianday\('now'\)\s*-\s*julianday\(([^)]+)\)/g,
    'EXTRACT(EPOCH FROM (NOW() - ($1)::timestamp)) / 86400');
  sql = sql.replace(/julianday\(([^)]+)\)\s*-\s*julianday\('now'\)/g,
    'EXTRACT(EPOCH FROM (($1)::timestamp - NOW())) / 86400');
  sql = sql.replace(/julianday\(([^)]+)\)\s*-\s*julianday\(([^)]+)\)/g,
    'EXTRACT(EPOCH FROM (($1)::timestamp - ($2)::timestamp)) / 86400');

  // Convert empty double-quoted strings "" to '' (SQLite treats "" as empty string, PG treats as identifier)
  sql = sql.replace(/!= ""/g, "!= ''");
  sql = sql.replace(/= ""/g, "= ''");

  // Convert ROUND(expr, N) to ROUND((expr)::numeric, N) for PostgreSQL
  sql = sql.replace(/ROUND\(([^,)]+),\s*(\d+)\)/gi, 'ROUND(($1)::numeric, $2)');

  // Convert placeholders ? → $1, $2, $3...
  sql = convertPlaceholders(sql);

  // For INSERT OR REPLACE conversions: add ON CONFLICT DO NOTHING
  // Check if this was originally an INSERT OR REPLACE by looking for cache/config tables
  if (sql.match(/INSERT INTO\s+(influencer_search_cache|enrichment_cache|agent_config|gmail_watch_state)/i)) {
    // Add ON CONFLICT DO NOTHING before RETURNING (if present)
    if (sql.includes('RETURNING')) {
      sql = sql.replace(/\s*RETURNING/, ' ON CONFLICT DO NOTHING RETURNING');
    } else {
      sql = sql.trimEnd() + ' ON CONFLICT DO NOTHING';
    }
  }

  return sql;
}

export async function initDb() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  // Test connection
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('[DB] Connected to PostgreSQL:', result.rows[0]);
  } catch (err) {
    console.error('[DB] Failed to connect to PostgreSQL:', err.message);
    throw err;
  }

  // Create all tables
  const tables = [
    `
    CREATE TABLE IF NOT EXISTS foretag (
      id SERIAL PRIMARY KEY,
      namn TEXT NOT NULL,
      epost TEXT NOT NULL,
      kontaktperson TEXT,
      bransch TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      hemsida TEXT,
      company_profile TEXT,
      syfte TEXT,
      erbjudande_typ TEXT,
      beskrivning TEXT,
      logo_url TEXT,
      org_nummer TEXT
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS influencers (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS outreach_meddelanden (
      id SERIAL PRIMARY KEY,
      influencer_id INTEGER NOT NULL,
      foretag_id INTEGER NOT NULL,
      meddelande TEXT NOT NULL,
      amne TEXT,
      typ TEXT DEFAULT 'initial',
      status TEXT DEFAULT 'utkast',
      kontrakt_bifogat INTEGER DEFAULT 0,
      skickat_datum TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      kampanj_id INTEGER,
      ab_test_id INTEGER,
      ab_variant TEXT,
      followup_step INTEGER DEFAULT 0,
      followup_paused INTEGER DEFAULT 0,
      last_followup_at TEXT,
      dismissed_followup INTEGER DEFAULT 0,
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS kontrakt (
      id SERIAL PRIMARY KEY,
      influencer_id INTEGER NOT NULL,
      foretag_id INTEGER NOT NULL,
      outreach_id INTEGER,
      kontaktperson TEXT NOT NULL,
      villkor_text TEXT,
      pdf_path TEXT,
      status TEXT DEFAULT 'genererat',
      signed_at TEXT,
      activated_at TEXT,
      expires_at TEXT,
      expired_notified INTEGER DEFAULT 0,
      expiry_reminder_sent INTEGER DEFAULT 0,
      sign_method TEXT DEFAULT 'email_reply',
      sign_token TEXT,
      videos_required INTEGER DEFAULT 5,
      videos_delivered INTEGER DEFAULT 0,
      total_signups INTEGER DEFAULT 0,
      total_payout_sek INTEGER DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      sign_audit TEXT,
      source_type TEXT DEFAULT 'influencer',
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id),
      FOREIGN KEY (outreach_id) REFERENCES outreach_meddelanden(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS uppfoljningar (
      id SERIAL PRIMARY KEY,
      outreach_id INTEGER NOT NULL,
      influencer_id INTEGER NOT NULL,
      meddelande TEXT,
      skickat_datum TEXT,
      status TEXT DEFAULT 'vaentar',
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (outreach_id) REFERENCES outreach_meddelanden(id),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS gmail_tokens (
      id SERIAL PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      expiry_date TEXT,
      email TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS email_config (
      id SERIAL PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'gmail',
      email TEXT,
      smtp_host TEXT,
      smtp_port INTEGER DEFAULT 587,
      smtp_user TEXT,
      smtp_pass TEXT,
      smtp_secure INTEGER DEFAULT 0,
      display_name TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS microsoft_tokens (
      id SERIAL PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      expiry_date TEXT,
      email TEXT,
      display_name TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS sponsor_prospects (
      id SERIAL PRIMARY KEY,
      foretag_id INTEGER NOT NULL,
      namn TEXT NOT NULL,
      kontaktperson TEXT,
      epost TEXT,
      bransch TEXT,
      instagram_handle TEXT,
      hemsida TEXT,
      telefon TEXT,
      betyg TEXT,
      kalla TEXT DEFAULT 'ai',
      vald INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS sponsor_outreach (
      id SERIAL PRIMARY KEY,
      prospect_id INTEGER NOT NULL,
      foretag_id INTEGER NOT NULL,
      meddelande TEXT NOT NULL,
      amne TEXT,
      kanal TEXT DEFAULT 'email',
      status TEXT DEFAULT 'utkast',
      skickat_datum TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (prospect_id) REFERENCES sponsor_prospects(id),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS email_tracking (
      id SERIAL PRIMARY KEY,
      outreach_id INTEGER,
      sponsor_outreach_id INTEGER,
      tracking_id TEXT NOT NULL UNIQUE,
      oppnad INTEGER DEFAULT 0,
      oppnad_datum TEXT,
      oppnad_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS email_cache (
      id SERIAL PRIMARY KEY,
      kanalnamn TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      method TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS influencer_signups (
      id SERIAL PRIMARY KEY,
      influencer_id INTEGER NOT NULL,
      referral_kod TEXT,
      antal_signups INTEGER DEFAULT 0,
      senast_uppdaterad TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS inbox_messages (
      id SERIAL PRIMARY KEY,
      gmail_message_id TEXT UNIQUE,
      gmail_thread_id TEXT,
      from_email TEXT NOT NULL,
      from_name TEXT,
      subject TEXT,
      snippet TEXT,
      body_preview TEXT,
      received_at TEXT NOT NULL,
      outreach_id INTEGER,
      sponsor_outreach_id INTEGER,
      influencer_id INTEGER,
      prospect_id INTEGER,
      match_type TEXT,
      is_reply INTEGER DEFAULT 0,
      is_read INTEGER DEFAULT 0,
      ai_summary TEXT,
      ai_sentiment TEXT,
      ai_suggested_action TEXT,
      processed_at TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (outreach_id) REFERENCES outreach_meddelanden(id),
      FOREIGN KEY (sponsor_outreach_id) REFERENCES sponsor_outreach(id),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (prospect_id) REFERENCES sponsor_prospects(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS followup_log (
      id SERIAL PRIMARY KEY,
      outreach_id INTEGER,
      sponsor_outreach_id INTEGER,
      influencer_id INTEGER,
      prospect_id INTEGER,
      followup_nr INTEGER DEFAULT 1,
      trigger_reason TEXT,
      meddelande TEXT,
      status TEXT DEFAULT 'pending',
      scheduled_at TEXT,
      sent_at TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (outreach_id) REFERENCES outreach_meddelanden(id),
      FOREIGN KEY (sponsor_outreach_id) REFERENCES sponsor_outreach(id),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (prospect_id) REFERENCES sponsor_prospects(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS content_tracking (
      id SERIAL PRIMARY KEY,
      influencer_id INTEGER NOT NULL,
      foretag_id INTEGER,
      kontrakt_id INTEGER,
      youtube_video_id TEXT UNIQUE,
      video_title TEXT,
      video_url TEXT,
      video_description TEXT,
      published_at TEXT,
      view_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      has_company_mention INTEGER DEFAULT 0,
      has_cta INTEGER DEFAULT 0,
      has_referral_link INTEGER DEFAULT 0,
      referral_kod_found TEXT,
      cta_quality TEXT DEFAULT 'ej_analyserad',
      ai_analysis TEXT,
      ai_analyzed_at TEXT,
      status TEXT DEFAULT 'detected',
      last_checked_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id),
      FOREIGN KEY (kontrakt_id) REFERENCES kontrakt(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS content_scan_log (
      id SERIAL PRIMARY KEY,
      influencer_id INTEGER NOT NULL UNIQUE,
      channel_id TEXT,
      last_scanned_at TIMESTAMP DEFAULT NOW(),
      videos_found INTEGER DEFAULT 0,
      next_scan_after TEXT,
      FOREIGN KEY (influencer_id) REFERENCES influencers(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS automation_log (
      id SERIAL PRIMARY KEY,
      job_type TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      details TEXT,
      items_processed INTEGER DEFAULT 0,
      items_found INTEGER DEFAULT 0,
      error TEXT,
      started_at TIMESTAMP DEFAULT NOW(),
      completed_at TEXT
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS fakturor (
      id SERIAL PRIMARY KEY,
      faktura_nr TEXT NOT NULL UNIQUE,
      kontrakt_id INTEGER NOT NULL,
      influencer_id INTEGER NOT NULL,
      foretag_id INTEGER NOT NULL,
      period_from TEXT,
      period_to TEXT,
      videos_count INTEGER DEFAULT 0,
      video_amount_sek INTEGER DEFAULT 0,
      signups_count INTEGER DEFAULT 0,
      signup_amount_sek INTEGER DEFAULT 0,
      total_amount_sek INTEGER DEFAULT 0,
      notes TEXT,
      status TEXT DEFAULT 'utkast',
      pdf_path TEXT,
      sent_at TEXT,
      due_date TEXT,
      paid_at TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (kontrakt_id) REFERENCES kontrakt(id),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS intakter (
      id SERIAL PRIMARY KEY,
      foretag_id INTEGER,
      sponsor_prospect_id INTEGER,
      sponsor_outreach_id INTEGER,
      kampanj_namn TEXT,
      sponsor_namn TEXT NOT NULL,
      kontaktperson TEXT,
      beskrivning TEXT,
      belopp_sek INTEGER NOT NULL DEFAULT 0,
      typ TEXT DEFAULT 'sponsoravtal',
      status TEXT DEFAULT 'avtalat',
      fakturerad INTEGER DEFAULT 0,
      betald INTEGER DEFAULT 0,
      avtalsdatum TEXT,
      forfallodag TEXT,
      betald_datum TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id),
      FOREIGN KEY (sponsor_prospect_id) REFERENCES sponsor_prospects(id),
      FOREIGN KEY (sponsor_outreach_id) REFERENCES sponsor_outreach(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS followup_sequence_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled INTEGER DEFAULT 0,
      step1_days INTEGER DEFAULT 3,
      step2_days INTEGER DEFAULT 7,
      step3_days INTEGER DEFAULT 14,
      max_steps INTEGER DEFAULT 3,
      auto_send INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS content_submissions (
      id SERIAL PRIMARY KEY,
      influencer_id INTEGER NOT NULL,
      kontrakt_id INTEGER,
      foretag_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      content_url TEXT,
      content_type TEXT DEFAULT 'video',
      thumbnail_url TEXT,
      notes_from_influencer TEXT,
      status TEXT DEFAULT 'submitted',
      review_notes TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      revision_count INTEGER DEFAULT 0,
      deadline TEXT,
      submitted_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (kontrakt_id) REFERENCES kontrakt(id),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS kampanjer (
      id SERIAL PRIMARY KEY,
      foretag_id INTEGER NOT NULL,
      namn TEXT NOT NULL,
      beskrivning TEXT,
      nisch TEXT,
      budget_sek INTEGER,
      status TEXT DEFAULT 'draft',
      total_influencers INTEGER DEFAULT 0,
      total_sent INTEGER DEFAULT 0,
      total_replied INTEGER DEFAULT 0,
      total_contracts INTEGER DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS ab_tests (
      id SERIAL PRIMARY KEY,
      foretag_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      total_sent_a INTEGER DEFAULT 0,
      total_sent_b INTEGER DEFAULT 0,
      total_replied_a INTEGER DEFAULT 0,
      total_replied_b INTEGER DEFAULT 0,
      winner TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      completed_at TEXT,
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS influencer_search_cache (
      cache_key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS enrichment_cache (
      id SERIAL PRIMARY KEY,
      domain TEXT UNIQUE NOT NULL,
      data TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours')
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS influencer_blacklist (
      id SERIAL PRIMARY KEY,
      namn TEXT,
      kanalnamn TEXT,
      plattform TEXT,
      kontakt_epost TEXT,
      anledning TEXT DEFAULT 'manuell',
      blacklisted_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS saved_searches (
      id SERIAL PRIMARY KEY,
      namn TEXT NOT NULL,
      foretag_id INTEGER,
      sok_parametrar TEXT NOT NULL,
      resultat_count INTEGER DEFAULT 0,
      senast_kord TEXT,
      notify_new INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS influencer_favorites (
      id SERIAL PRIMARY KEY,
      influencer_id INTEGER,
      namn TEXT NOT NULL,
      kanalnamn TEXT,
      plattform TEXT,
      foljare TEXT,
      nisch TEXT,
      kontakt_epost TEXT,
      notering TEXT,
      foretag_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS gmail_watch_state (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      history_id TEXT,
      last_checked_at TIMESTAMP DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS conversation_threads (
      id SERIAL PRIMARY KEY,
      influencer_id INTEGER,
      prospect_id INTEGER,
      contact_email TEXT NOT NULL,
      contact_name TEXT,
      plattform TEXT,
      kanalnamn TEXT,
      gmail_thread_id TEXT,
      ai_summary TEXT,
      ai_sentiment TEXT,
      ai_next_action TEXT,
      deal_stage TEXT DEFAULT 'outreach',
      last_message_at TEXT,
      message_count INTEGER DEFAULT 0,
      unread_count INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (prospect_id) REFERENCES sponsor_prospects(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS api_costs (
      id SERIAL PRIMARY KEY,
      service TEXT NOT NULL,
      endpoint TEXT,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_sek REAL DEFAULT 0,
      model TEXT,
      details TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS team_members (
      id SERIAL PRIMARY KEY,
      namn TEXT NOT NULL,
      epost TEXT NOT NULL UNIQUE,
      roll TEXT DEFAULT 'viewer',
      avatar_url TEXT,
      invite_token TEXT,
      invite_status TEXT DEFAULT 'active',
      last_active_at TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      user_name TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (user_id) REFERENCES team_members(id)
    )
    `,
  ];

  for (const sql of tables) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error('[DB] Error creating table:', err.message);
    }
  }

  // Add columns using ALTER TABLE IF NOT EXISTS syntax
  const alterQueries = [
    "ALTER TABLE outreach_meddelanden ADD COLUMN IF NOT EXISTS kampanj_id INTEGER",
    "ALTER TABLE outreach_meddelanden ADD COLUMN IF NOT EXISTS ab_test_id INTEGER",
    "ALTER TABLE outreach_meddelanden ADD COLUMN IF NOT EXISTS ab_variant TEXT",
    "ALTER TABLE outreach_meddelanden ADD COLUMN IF NOT EXISTS followup_step INTEGER DEFAULT 0",
    "ALTER TABLE outreach_meddelanden ADD COLUMN IF NOT EXISTS followup_paused INTEGER DEFAULT 0",
    "ALTER TABLE outreach_meddelanden ADD COLUMN IF NOT EXISTS last_followup_at TEXT",
    "ALTER TABLE outreach_meddelanden ADD COLUMN IF NOT EXISTS dismissed_followup INTEGER DEFAULT 0",
    "ALTER TABLE foretag ADD COLUMN IF NOT EXISTS hemsida TEXT",
    "ALTER TABLE foretag ADD COLUMN IF NOT EXISTS company_profile TEXT",
    "ALTER TABLE foretag ADD COLUMN IF NOT EXISTS syfte TEXT",
    "ALTER TABLE foretag ADD COLUMN IF NOT EXISTS erbjudande_typ TEXT",
    "ALTER TABLE foretag ADD COLUMN IF NOT EXISTS beskrivning TEXT",
    "ALTER TABLE foretag ADD COLUMN IF NOT EXISTS logo_url TEXT",
    "ALTER TABLE foretag ADD COLUMN IF NOT EXISTS org_nummer TEXT",
    "ALTER TABLE kontrakt ADD COLUMN IF NOT EXISTS sign_audit TEXT",
    "ALTER TABLE kontrakt ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'influencer'",
    "ALTER TABLE sponsor_prospects ADD COLUMN IF NOT EXISTS telefon TEXT",
    "ALTER TABLE sponsor_prospects ADD COLUMN IF NOT EXISTS betyg TEXT",
    "ALTER TABLE sponsor_prospects ADD COLUMN IF NOT EXISTS kalla TEXT DEFAULT 'ai'",
  ];

  for (const sql of alterQueries) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error('[DB] Error altering table:', err.message);
    }
  }

  // Insert default followup_sequence_settings if not exists
  try {
    await pool.query(
      `INSERT INTO followup_sequence_settings (id, enabled, step1_days, step2_days, step3_days, max_steps, auto_send)
       VALUES (1, 0, 3, 7, 14, 3, 0)
       ON CONFLICT (id) DO NOTHING`
    );
  } catch (err) {
    console.error('[DB] Error inserting default followup settings:', err.message);
  }

  // Insert default gmail_watch_state if not exists
  try {
    await pool.query(
      `INSERT INTO gmail_watch_state (id) VALUES (1)
       ON CONFLICT (id) DO NOTHING`
    );
  } catch (err) {
    console.error('[DB] Error inserting default gmail_watch_state:', err.message);
  }

  console.log('[DB] All tables initialized successfully');
  return pool;
}

export function getDb() {
  if (!pool) throw new Error('Database not initialized. Call initDb() first.');
  return pool;
}

// Helper: run query and return rows as objects
export async function queryAll(sql, params = []) {
  const convertedSql = convertSql(sql);
  try {
    const result = await pool.query(convertedSql, params);
    return result.rows;
  } catch (err) {
    console.error('[DB] queryAll error:', err.message, 'SQL:', convertedSql);
    throw err;
  }
}

export async function queryOne(sql, params = []) {
  const convertedSql = convertSql(sql);
  try {
    const result = await pool.query(convertedSql, params);
    return result.rows[0] || null;
  } catch (err) {
    console.error('[DB] queryOne error:', err.message, 'SQL:', convertedSql);
    throw err;
  }
}

export async function runSql(sql, params = []) {
  try {
    let convertedSql = convertSql(sql);

    // For INSERT statements, append RETURNING id (but not for ON CONFLICT DO NOTHING — those tables may lack id)
    if (convertedSql.trim().toUpperCase().startsWith('INSERT')) {
      convertedSql = convertedSql.trimEnd();
      if (!convertedSql.toUpperCase().includes('RETURNING') && !convertedSql.toUpperCase().includes('ON CONFLICT DO NOTHING')) {
        convertedSql += ' RETURNING id';
      }
    }

    const result = await pool.query(convertedSql, params);

    // Return lastId for INSERT statements
    const lastId = result.rows.length > 0 && result.rows[0].id ? result.rows[0].id : null;
    return { lastId };
  } catch (err) {
    console.error('[DB] runSql error:', err.message, 'SQL:', sql);
    throw err;
  }
}

// No-op for PostgreSQL (data is persisted automatically)
export function saveDb() {
  // PostgreSQL persists automatically, no action needed
}

export default getDb;
