import { initDb, queryOne, queryAll, runSql } from './db/schema.js';

async function seed() {
  await initDb();
  console.log('🌱 Skapar testdata för Avtal & Signering...\n');

  // 0. Migrera kontrakt-tabellen — lägg till saknade kolumner
  const migrations = [
    'signed_at TEXT', 'activated_at TEXT', 'expires_at TEXT',
    'expired_notified INTEGER DEFAULT 0', 'expiry_reminder_sent INTEGER DEFAULT 0',
    'sign_method TEXT DEFAULT \'email_reply\'', 'sign_token TEXT',
    'videos_required INTEGER DEFAULT 5', 'videos_delivered INTEGER DEFAULT 0',
    'total_signups INTEGER DEFAULT 0', 'total_payout_sek INTEGER DEFAULT 0', 'notes TEXT'
  ];
  for (const col of migrations) {
    const colName = col.split(' ')[0];
    try {
      runSql(`ALTER TABLE kontrakt ADD COLUMN ${col}`);
      console.log(`✅ Kolumn tillagd: ${colName}`);
    } catch (e) {
      // Kolumnen finns redan — OK
    }
  }
  console.log('');

  // 1. Skapa testföretag (om det inte redan finns)
  let foretag = queryOne("SELECT id FROM foretag WHERE namn = 'RankLeague AB'");
  if (!foretag) {
    const { lastId } = runSql(
      "INSERT INTO foretag (namn, epost, kontaktperson, bransch) VALUES (?, ?, ?, ?)",
      ['RankLeague AB', 'jimmy@rankleague.com', 'Jimmy Munter', 'Gaming/Esports']
    );
    foretag = { id: lastId };
    console.log('✅ Företag skapat: RankLeague AB (id=' + lastId + ')');
  } else {
    console.log('ℹ️  Företag finns redan: RankLeague AB (id=' + foretag.id + ')');
  }

  // 2. Skapa test-influencers
  const influencers = [
    { namn: 'Erik Svensson', kanalnamn: 'ErikGaming', plattform: 'YouTube', foljare: '45 000', nisch: 'Gaming/FPS', epost: 'erik@test.com', kod: 'ERIKGAMING' },
    { namn: 'Lisa Karlsson', kanalnamn: 'LisaPlays', plattform: 'YouTube', foljare: '120 000', nisch: 'Gaming/Variety', epost: 'lisa@test.com', kod: 'LISAPLAYS' },
    { namn: 'Ahmed Hassan', kanalnamn: 'AhmedEsports', plattform: 'TikTok', foljare: '78 000', nisch: 'Esports/CS2', epost: 'ahmed@test.com', kod: 'AHMEDESPORTS' },
    { namn: 'Sara Lindberg', kanalnamn: 'SaraStreams', plattform: 'YouTube', foljare: '200 000', nisch: 'Streaming/Just Chatting', epost: 'sara@test.com', kod: 'SARASTREAMS' },
    { namn: 'Oscar Nilsson', kanalnamn: 'OscarGG', plattform: 'Instagram', foljare: '35 000', nisch: 'Gaming/Valorant', epost: 'oscar@test.com', kod: 'OSCARGG' },
  ];

  const infIds = [];
  for (const inf of influencers) {
    let existing = queryOne("SELECT id FROM influencers WHERE kanalnamn = ?", [inf.kanalnamn]);
    if (!existing) {
      const { lastId } = runSql(
        "INSERT INTO influencers (foretag_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, referral_kod, vald) VALUES (?,?,?,?,?,?,?,?,1)",
        [foretag.id, inf.namn, inf.kanalnamn, inf.plattform, inf.foljare, inf.nisch, inf.epost, inf.kod]
      );
      infIds.push(lastId);
      console.log(`✅ Influencer: ${inf.namn} (${inf.kanalnamn}) — id=${lastId}`);
    } else {
      infIds.push(existing.id);
      console.log(`ℹ️  Influencer finns redan: ${inf.namn} — id=${existing.id}`);
    }
  }

  // 3. Skapa outreach-meddelanden (med olika datum/status)
  const outreachData = [
    { infIdx: 0, status: 'avtal_signerat', datum: "2026-03-20", kontrakt: 1 },
    { infIdx: 1, status: 'avtal_signerat', datum: "2026-03-15", kontrakt: 1 },
    { infIdx: 2, status: 'avtal_signerat', datum: "2026-03-25", kontrakt: 1 },
    { infIdx: 3, status: 'skickat', datum: "2026-04-01", kontrakt: 1 },  // Skickat men inte svarat — borde flaggas
    { infIdx: 4, status: 'svarat', datum: "2026-04-05", kontrakt: 0 },   // Svarat men inget avtal ännu
  ];

  const outreachIds = [];
  for (const o of outreachData) {
    const { lastId } = runSql(
      "INSERT INTO outreach_meddelanden (influencer_id, foretag_id, meddelande, amne, typ, status, kontrakt_bifogat, skickat_datum) VALUES (?,?,?,?,?,?,?,?)",
      [infIds[o.infIdx], foretag.id, `Hej ${influencers[o.infIdx].namn}! Vi på RankLeague vill gärna samarbeta med dig...`, `Samarbete med RankLeague — ${influencers[o.infIdx].kanalnamn}`, 'initial', o.status, o.kontrakt, o.datum]
    );
    outreachIds.push(lastId);
    console.log(`✅ Outreach: ${influencers[o.infIdx].namn} — status: ${o.status}, datum: ${o.datum}`);
  }

  // 4. Skapa kontrakt i olika livscykelstadier
  const kontrakt = [
    {
      infIdx: 0, outIdx: 0,
      status: 'aktivt',
      signed_at: '2026-03-22T10:00:00',
      activated_at: '2026-03-22T10:00:00',
      expires_at: '2026-04-21T10:00:00',  // Löper ut om 13 dagar — borde ge påminnelse snart
      videos_delivered: 3, total_signups: 47, total_payout_sek: 1370,
      notes: 'Bra samarbete hittills. Stark CTA i alla videos.'
    },
    {
      infIdx: 1, outIdx: 1,
      status: 'aktivt',
      signed_at: '2026-03-17T14:00:00',
      activated_at: '2026-03-17T14:00:00',
      expires_at: '2026-04-10T14:00:00',  // Löper ut om 2 dagar! ⚠️
      videos_delivered: 5, total_signups: 156, total_payout_sek: 3060,
      notes: 'Alla 5 videos levererade. Toppresterare!'
    },
    {
      infIdx: 2, outIdx: 2,
      status: 'skickat',
      signed_at: null,
      activated_at: null,
      expires_at: null,
      videos_delivered: 0, total_signups: 0, total_payout_sek: 0,
      notes: 'Väntar på signering sedan 2026-03-26'
    },
    {
      infIdx: 3, outIdx: 3,
      status: 'genererat',
      signed_at: null,
      activated_at: null,
      expires_at: null,
      videos_delivered: 0, total_signups: 0, total_payout_sek: 0,
      notes: 'Kontrakt genererat men ej skickat ännu'
    },
  ];

  for (const k of kontrakt) {
    const sign_token = `SIGN-${influencers[k.infIdx].kod}-${Date.now()}`;
    runSql(
      `INSERT INTO kontrakt (influencer_id, foretag_id, outreach_id, kontaktperson, villkor_text, status, signed_at, activated_at, expires_at, sign_method, sign_token, videos_required, videos_delivered, total_signups, total_payout_sek, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        infIds[k.infIdx], foretag.id, outreachIds[k.outIdx], 'Jimmy Munter',
        `SAMARBETSAVTAL\n\nMellan RankLeague AB och ${influencers[k.infIdx].namn} (${influencers[k.infIdx].kanalnamn})\n\nVillkor:\n- 300 SEK per publicerad video\n- Max 5 videos\n- 10 SEK per signup via referral-kod ${influencers[k.infIdx].kod}\n- Varje video MÅSTE innehålla tydlig CTA\n- Rapportering inom 7 dagar\n- Avtalstid: 30 dagar`,
        k.status, k.signed_at, k.activated_at, k.expires_at,
        'email_reply', sign_token, 5, k.videos_delivered, k.total_signups, k.total_payout_sek, k.notes
      ]
    );
    console.log(`✅ Kontrakt: ${influencers[k.infIdx].namn} — status: ${k.status}${k.expires_at ? ', utgår: ' + k.expires_at.split('T')[0] : ''}`);
  }

  // 5. Skapa fakturor-tabell om den saknas
  try {
    runSql(`CREATE TABLE IF NOT EXISTS fakturor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (kontrakt_id) REFERENCES kontrakt(id),
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (foretag_id) REFERENCES foretag(id)
    )`);
  } catch (e) {}

  // 6. Skapa testfakturor
  // Hämta kontrakt-IDs som just skapades
  const kontraktList = queryAll("SELECT k.id, k.influencer_id, k.videos_delivered, k.total_signups, k.status FROM kontrakt k WHERE k.foretag_id = ? AND k.status IN ('aktivt','utgånget') ORDER BY k.id DESC LIMIT 2", [foretag.id]);

  const testFakturor = [
    {
      nr: 'RL-2026-001',
      kontraktIdx: 0,
      status: 'betald',
      sent_at: '2026-03-28T10:00:00',
      paid_at: '2026-04-05T14:30:00',
      due_date: '2026-04-27',
    },
    {
      nr: 'RL-2026-002',
      kontraktIdx: 1,
      status: 'skickad',
      sent_at: '2026-04-06T09:00:00',
      paid_at: null,
      due_date: '2026-05-06',
    },
  ];

  for (const tf of testFakturor) {
    if (tf.kontraktIdx >= kontraktList.length) continue;
    const k = kontraktList[tf.kontraktIdx];
    const existing = queryOne("SELECT id FROM fakturor WHERE faktura_nr = ?", [tf.nr]);
    if (existing) {
      console.log(`ℹ️  Faktura finns redan: ${tf.nr}`);
      continue;
    }

    const videosCount = k.videos_delivered || 0;
    const videoAmount = videosCount * 300;
    const signupsCount = k.total_signups || 0;
    const signupAmount = signupsCount * 10;
    const totalAmount = videoAmount + signupAmount;

    runSql(
      `INSERT INTO fakturor (faktura_nr, kontrakt_id, influencer_id, foretag_id, period_from, period_to, videos_count, video_amount_sek, signups_count, signup_amount_sek, total_amount_sek, status, sent_at, due_date, paid_at, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [tf.nr, k.id, k.influencer_id, foretag.id, '2026-03-15', '2026-04-08', videosCount, videoAmount, signupsCount, signupAmount, totalAmount, tf.status, tf.sent_at, tf.due_date, tf.paid_at, `Faktura för kontrakt #${k.id}`]
    );
    console.log(`✅ Faktura: ${tf.nr} — ${totalAmount} SEK (${tf.status})`);
  }

  console.log('\n🎉 Testdata skapat! Du borde nu se:');
  console.log('   - 2 aktiva kontrakt (Erik: utgår 21 apr, Lisa: utgår 10 apr)');
  console.log('   - 1 skickat kontrakt (Ahmed: väntar på signering)');
  console.log('   - 1 genererat kontrakt (Sara: ej skickat)');
  console.log('   - 2 testfakturor (1 betald, 1 skickad)');
  console.log('   - Fakturering-flik med full översikt');
  console.log('\n   Ladda om Dashboard för att se allt.');
}

seed().catch(err => { console.error('❌ Fel:', err); process.exit(1); });
