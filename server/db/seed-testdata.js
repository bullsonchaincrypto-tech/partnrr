/**
 * seed-testdata.js — Rensar gammal data och skapar realistiskt testdata
 *
 * Kör: node server/db/seed-testdata.js
 *
 * Skapar:
 * - 2 företag (RankLeague + ett externt)
 * - 12 influencers (mix av YouTube, Instagram, TikTok — svenska creators)
 * - 4 sponsor-prospects (svenska företag)
 * - Outreach-meddelanden med olika statusar
 * - 3 kontrakt (aktiva/signerade/skickade)
 * - Conversation threads med meddelanden
 */

import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'rankleague.db');

async function seed() {
  const SQL = await initSqlJs();
  let db;

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    console.error('❌ Databas hittades inte. Kör servern först för att skapa schema.');
    process.exit(1);
  }

  console.log('🧹 Rensar gammal testdata...');

  // Rensa i rätt ordning (foreign keys)
  const tables = [
    'inbox_messages',
    'conversation_threads',
    'followup_log',
    'email_tracking',
    'email_cache',
    'uppfoljningar',
    'kontrakt',
    'outreach_meddelanden',
    'sponsor_outreach',
    'sponsor_prospects',
    'influencers',
    'foretag',
    'automation_log',
    'gmail_watch_state',
  ];

  for (const t of tables) {
    try {
      db.run(`DELETE FROM ${t}`);
      console.log(`  ✓ ${t} rensat`);
    } catch (e) {
      console.log(`  ⚠ ${t}: ${e.message}`);
    }
  }

  // Reset auto-increment
  try { db.run("DELETE FROM sqlite_sequence"); } catch { /* OK */ }

  console.log('\n📦 Skapar nytt testdata...\n');

  // ───────────────────────────────────────────────
  // FÖRETAG
  // ───────────────────────────────────────────────
  db.run(`INSERT INTO foretag (id, namn, epost, kontaktperson, bransch) VALUES
    (1, 'RankLeague', 'jimmy@rankleague.com', 'Jimmy Munther', 'gaming, esports, fantasy sports'),
    (2, 'NordicPlay AB', 'kontakt@nordicplay.se', 'Erik Lindqvist', 'gaming, underhållning')
  `);
  console.log('✅ 2 företag skapade');

  // ───────────────────────────────────────────────
  // INFLUENCERS — Realistiska svenska profiler
  // ───────────────────────────────────────────────
  const influencers = [
    // YouTube — verifierade
    [1, 'Pontus Rasmusson', 'PontusRasmusson', 'YouTube', '285000', 'gaming, underhållning', 'pontus@example.com', null, 'PONTUSRASM'],
    [1, 'iamJakeeee', 'iamJakeeee', 'YouTube', '520000', 'gaming, esports', null, null, 'IAMJAKEEEE'],
    [1, 'Hampus Hedström', 'HampusHedstrom', 'YouTube', '180000', 'gaming, tech', 'hampus.hed@example.com', null, 'HAMPUSHED'],
    [1, 'Phizze', 'Phizzegansen', 'YouTube', '340000', 'gaming, underhållning', 'phizze@example.com', null, 'PHIZZEGAN'],
    // Instagram — mix
    [1, 'Lina Forsberg', 'linaforsberg', 'Instagram', '95000', 'livsstil, gaming', 'lina.f@example.com', null, 'LINAFORSB'],
    [1, 'Oscar Ekman', 'oscarekman', 'Instagram', '42000', 'esports, fitness', 'oscar.ekman@outlook.com', null, 'OSCAREKMA'],
    [1, 'Fanny Nilsson', 'fannynilsson', 'Instagram', '68000', 'gaming, underhållning', 'fanny@protonmail.com', null, 'FANNYNILS'],
    // TikTok — uppskattade
    [1, 'Ludwig Bergström', 'ludwigberg', 'TikTok', '150000', 'gaming, fantasy sports', 'ludwig.b@hotmail.com', null, 'LUDWIGBER'],
    [1, 'Ella Johansson', 'ellajohansson', 'TikTok', '210000', 'gaming, livsstil', null, null, 'ELLAJOH'],
    [1, 'Marcus Holm', 'marcusholm', 'TikTok', '78000', 'esports, gaming', 'marcus.holm@foretag.se', null, 'MARCUSHOT'],
    // YouTube — för NordicPlay
    [2, 'André Pops', 'AndrePoPS', 'YouTube', '410000', 'gaming, underhållning', 'andre@example.com', null, 'ANDREPOPS'],
    [2, 'Sara Larsson', 'SaraLarsson', 'YouTube', '120000', 'gaming, vlogg', 'sara.l@yahoo.com', null, 'SARALARSS'],
  ];

  for (const inf of influencers) {
    db.run(
      `INSERT INTO influencers (foretag_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, kontakt_info, referral_kod) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      inf
    );
  }
  console.log(`✅ ${influencers.length} influencers skapade`);

  // ───────────────────────────────────────────────
  // SPONSOR PROSPECTS
  // ───────────────────────────────────────────────
  const sponsors = [
    [1, 'NOCCO', 'Anna Berg', 'anna.berg@nocco.com', 'Energidrycker, fitness', '@nocco', 'nocco.com'],
    [1, 'Elgiganten', 'David Svensson', 'david.s@elgiganten.se', 'Elektronik, gaming', '@elgiganten', 'elgiganten.se'],
    [1, 'MaxGaming', 'Lisa Olofsson', 'lisa@maxgaming.se', 'Gaming-tillbehör, esports', '@maxgaming.se', 'maxgaming.se'],
    [1, 'SteelSeries Nordic', 'Johan Karlsson', 'johan.k@steelseries.com', 'Gaming-headsets, perifera', '@steelseries_nordic', 'steelseries.com'],
  ];

  for (const sp of sponsors) {
    db.run(
      `INSERT INTO sponsor_prospects (foretag_id, namn, kontaktperson, epost, bransch, instagram_handle, hemsida) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sp
    );
  }
  console.log(`✅ ${sponsors.length} sponsor-prospects skapade`);

  // ───────────────────────────────────────────────
  // OUTREACH-MEDDELANDEN — olika statusar
  // ───────────────────────────────────────────────
  const now = new Date();
  const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

  const outreach = [
    // Pontus — skickat, väntar svar
    [1, 1, 'Hej Pontus! Vi på RankLeague bygger en gaming-plattform och tror att dina tittare skulle älska det. Vad säger du om ett samarbete? 300 kr/video + 10 kr per signup via din unika kod.', 'Samarbete med RankLeague 🎮', 'initial', 'skickat', 0, daysAgo(6)],
    // iamJakeeee — skickat, fått svar (avtal signerat)
    [2, 1, 'Hej Jake! RankLeague söker gaming-influencers som dig. 300 kr per video + provisionsmodell. Intresserad?', 'RankLeague x iamJakeeee — samarbete', 'initial', 'avtal_signerat', 1, daysAgo(14)],
    // Hampus — skickat nyligen
    [3, 1, 'Hej Hampus! Jag heter Jimmy från RankLeague. Vi har en tävlingsplattform för gamers och tror att ditt community passar perfekt. Vill du veta mer?', 'Spännande samarbete — RankLeague', 'initial', 'skickat', 0, daysAgo(2)],
    // Phizze — svarat positivt, förhandling
    [4, 1, 'Hej Phizze! Vi älskar ditt content och tror att RankLeague kan vara något för dina tittare. 300 kr/video + en unik referral-kod.', 'Samarbete med RankLeague', 'initial', 'svarat', 0, daysAgo(8)],
    // Lina — skickat via Instagram
    [5, 1, 'Hej Lina! Vi bygger RankLeague — en tävlingsplattform för gamers. Tror dina följare på Instagram skulle uppskatta det. Intresserad av ett samarbete?', 'RankLeague x Lina Forsberg', 'initial', 'skickat', 0, daysAgo(4)],
    // Ludwig — manuell import (redan pågående)
    [8, 1, 'Manuellt importerat samarbete — Ludwig Bergström via TikTok.', 'Befintligt samarbete', 'manuell_import', 'avtal_signerat', 1, daysAgo(20)],
    // Oscar — avböjt
    [6, 1, 'Hej Oscar! RankLeague söker svenska esports-influencers. Vad säger du?', 'Samarbete — RankLeague', 'initial', 'avböjt', 0, daysAgo(10)],
    // Sponsor: NOCCO — skickat
    [null, 1, 'Vi på RankLeague når 50K+ gamers i Sverige. Intresserade av att bli kampanjsponsor?', 'Sponsorskap — RankLeague x NOCCO', 'sponsor', 'skickat', 0, daysAgo(3)],
  ];

  for (const om of outreach) {
    if (om[0] === null) continue; // sponsor-outreach hanteras separat
    db.run(
      `INSERT INTO outreach_meddelanden (influencer_id, foretag_id, meddelande, amne, typ, status, kontrakt_bifogat, skickat_datum) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      om
    );
  }
  console.log('✅ Outreach-meddelanden skapade');

  // Sponsor outreach
  db.run(
    `INSERT INTO sponsor_outreach (prospect_id, foretag_id, meddelande, amne, kanal, status, skickat_datum) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [1, 1, 'Hej NOCCO! Vi på RankLeague når 50K+ gamers i Sverige varje månad. Intresserade av att nå denna målgrupp?', 'Sponsorskap — RankLeague x NOCCO', 'email', 'skickat', daysAgo(3)]
  );
  db.run(
    `INSERT INTO sponsor_outreach (prospect_id, foretag_id, meddelande, amne, kanal, status, skickat_datum) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [3, 1, 'Hej MaxGaming! Vi bygger Sveriges största gaming-tävlingsplattform. Ni är perfekta som partner. Kan vi boka ett samtal?', 'Samarbete — RankLeague + MaxGaming', 'email', 'svarat', daysAgo(7)]
  );
  console.log('✅ Sponsor-outreach skapade');

  // ───────────────────────────────────────────────
  // KONTRAKT — olika stages
  // ───────────────────────────────────────────────
  // iamJakeeee — aktivt, löper ut snart
  db.run(
    `INSERT INTO kontrakt (influencer_id, foretag_id, outreach_id, kontaktperson, villkor_text, status, signed_at, activated_at, expires_at, videos_required, videos_delivered, total_signups, total_payout_sek, notes)
     VALUES (2, 1, 2, 'Jimmy Munther', 'Standard RankLeague-avtal: 300 SEK/video, max 5 videos, 10 SEK/signup', 'aktivt', ?, ?, ?, 5, 3, 47, 1370, 'Bra CTA i video 2 och 3, sämre i video 1')`,
    [daysAgo(14), daysAgo(13), daysAgo(-3)] // expires in 3 days
  );

  // Ludwig — aktivt, långt kvar
  db.run(
    `INSERT INTO kontrakt (influencer_id, foretag_id, outreach_id, kontaktperson, villkor_text, status, signed_at, activated_at, expires_at, videos_required, videos_delivered, total_signups, total_payout_sek, notes)
     VALUES (8, 1, 6, 'Jimmy Munther', 'Manuellt avtal — TikTok-kampanj', 'aktivt', ?, ?, ?, 5, 1, 12, 420, 'Första videon publicerad, bra engagemang')`,
    [daysAgo(20), daysAgo(19), daysAgo(-25)] // expires in 25 days
  );

  // Phizze — skickat, ej signerat (stale)
  db.run(
    `INSERT INTO kontrakt (influencer_id, foretag_id, outreach_id, kontaktperson, villkor_text, status, signed_at, expires_at, videos_required)
     VALUES (4, 1, 4, 'Jimmy Munther', 'Standard RankLeague-avtal: 300 SEK/video, max 5 videos, 10 SEK/signup', 'skickat', NULL, NULL, 5)`,
  );

  console.log('✅ 3 kontrakt skapade (1 löper ut snart, 1 aktivt, 1 osignerat)');

  // ───────────────────────────────────────────────
  // CONVERSATION THREADS
  // ───────────────────────────────────────────────
  // iamJakeeee — aktiv konversation
  db.run(
    `INSERT INTO conversation_threads (influencer_id, contact_email, contact_name, plattform, kanalnamn, deal_stage, last_message_at, message_count, unread_count, ai_summary, ai_sentiment)
     VALUES (2, 'jake@example.com', 'iamJakeeee', 'YouTube', 'iamJakeeee', 'active', ?, 4, 0, 'Jake har signerat avtal och publicerat 3 videos.', 'positive')`,
    [daysAgo(1)]
  );

  // Phizze — förhandling
  db.run(
    `INSERT INTO conversation_threads (influencer_id, contact_email, contact_name, plattform, kanalnamn, deal_stage, last_message_at, message_count, unread_count, ai_summary, ai_sentiment, ai_next_action)
     VALUES (4, 'phizze@example.com', 'Phizze', 'YouTube', 'Phizzegansen', 'negotiating', ?, 3, 1, 'Phizze är intresserad men vill diskutera villkoren.', 'positive', 'boka_mote')`,
    [daysAgo(2)]
  );

  // Ludwig — aktiv
  db.run(
    `INSERT INTO conversation_threads (influencer_id, contact_email, contact_name, plattform, kanalnamn, deal_stage, last_message_at, message_count, unread_count)
     VALUES (8, 'ludwig.b@hotmail.com', 'Ludwig Bergström', 'TikTok', 'ludwigberg', 'active', ?, 2, 0)`,
    [daysAgo(5)]
  );

  // MaxGaming (sponsor) — svarat
  db.run(
    `INSERT INTO conversation_threads (prospect_id, contact_email, contact_name, plattform, kanalnamn, deal_stage, last_message_at, message_count, unread_count, ai_summary, ai_sentiment)
     VALUES (3, 'lisa@maxgaming.se', 'MaxGaming (Lisa)', 'Företag', 'maxgaming.se', 'replied', ?, 2, 1, 'MaxGaming vill veta mer om räckvidd och demografi.', 'neutral')`,
    [daysAgo(1)]
  );

  console.log('✅ 4 konversationstrådar skapade');

  // ───────────────────────────────────────────────
  // INBOX MESSAGES — simulerade mail
  // ───────────────────────────────────────────────
  // Jake's conversation
  db.run(`INSERT INTO inbox_messages (gmail_message_id, from_email, from_name, subject, body_preview, received_at, influencer_id, match_type, is_reply, is_read, ai_summary, ai_sentiment) VALUES
    ('msg_jake_1', 'jake@example.com', 'iamJakeeee', 'Re: RankLeague x iamJakeeee — samarbete', 'Tjena! Låter spännande. Jag kollade in RankLeague och det ser nice ut. Jag är intresserad, skicka gärna avtalet!', ?, 2, 'influencer', 1, 1, 'Jake visar starkt intresse och vill se avtalet.', 'positive')`,
    [daysAgo(12)]
  );
  db.run(`INSERT INTO inbox_messages (gmail_message_id, from_email, from_name, subject, body_preview, received_at, influencer_id, match_type, is_reply, is_read) VALUES
    ('msg_jake_2', 'jake@example.com', 'iamJakeeee', 'Re: RankLeague x iamJakeeee — samarbete', 'Avtal signerat! Publicerar första videon på fredag.', ?, 2, 'influencer', 1, 1)`,
    [daysAgo(10)]
  );

  // Phizze's conversation
  db.run(`INSERT INTO inbox_messages (gmail_message_id, from_email, from_name, subject, body_preview, received_at, influencer_id, match_type, is_reply, is_read, ai_summary, ai_sentiment, ai_suggested_action) VALUES
    ('msg_phizze_1', 'phizze@example.com', 'Phizze', 'Re: Samarbete med RankLeague', 'Tja! Intressant koncept. Jag gör mest YouTube-videos just nu och har en del sponsrade redan. Vad är det exakta upplägget? 300 kr per video verkar lite lågt tbh, har ni möjlighet att förhandla?', ?, 4, 'influencer', 1, 1, 'Phizze är intresserad men vill förhandla priset — tycker 300 kr/video är för lågt.', 'positive', 'svara_intresse')`,
    [daysAgo(5)]
  );
  db.run(`INSERT INTO inbox_messages (gmail_message_id, from_email, from_name, subject, body_preview, received_at, influencer_id, match_type, is_reply, is_read, ai_sentiment) VALUES
    ('msg_phizze_2', 'phizze@example.com', 'Phizze', 'Re: Samarbete med RankLeague', 'Ok 500 kr/video + provision låter bättre. Kan vi köra ett snabbt möte så vi pratar igenom detaljerna?', ?, 4, 'influencer', 1, 0, 'positive')`,
    [daysAgo(2)]
  );

  // MaxGaming
  db.run(`INSERT INTO inbox_messages (gmail_message_id, from_email, from_name, subject, body_preview, received_at, prospect_id, match_type, is_reply, is_read, ai_summary, ai_sentiment) VALUES
    ('msg_maxg_1', 'lisa@maxgaming.se', 'Lisa Olofsson', 'Re: Samarbete — RankLeague + MaxGaming', 'Hej! Tack för ert intresse. Vi på MaxGaming är alltid intresserade av att nå gaming-communityn. Kan ni skicka över lite mer data om er räckvidd och demografin bland era användare?', ?, 3, 'sponsor', 1, 0, 'MaxGaming vill se räckvidddata och demografi innan de går vidare.', 'neutral')`,
    [daysAgo(1)]
  );

  console.log('✅ Inbox-meddelanden skapade');

  // ───────────────────────────────────────────────
  // GMAIL WATCH STATE
  // ───────────────────────────────────────────────
  try {
    db.run(`INSERT OR REPLACE INTO gmail_watch_state (id, history_id, last_checked_at) VALUES (1, NULL, NULL)`);
  } catch { /* OK */ }

  // ───────────────────────────────────────────────
  // SPARA
  // ───────────────────────────────────────────────
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);

  console.log('\n🎉 Testdata seedad! Starta om servern för att ladda den nya databasen.');
  console.log('\nSammanfattning:');
  console.log('  📊 2 företag (RankLeague + NordicPlay)');
  console.log('  👤 12 influencers (4 YouTube, 3 Instagram, 3 TikTok + 2 för NordicPlay)');
  console.log('  🏢 4 sponsor-prospects (NOCCO, Elgiganten, MaxGaming, SteelSeries)');
  console.log('  ✉️  7 influencer-outreach + 2 sponsor-outreach');
  console.log('  📋 3 kontrakt (1 löper ut om 3 dagar, 1 aktivt, 1 osignerat/stale)');
  console.log('  💬 4 konversationer (2 influencer, 1 sponsor, 1 förhandling)');
  console.log('  📨 5 inbox-meddelanden (svar från Jake, Phizze, MaxGaming)');
  console.log('\n  E-postdomäner som testas:');
  console.log('    - @example.com (generisk)');
  console.log('    - @hotmail.com (Ludwig)');
  console.log('    - @outlook.com (Oscar)');
  console.log('    - @protonmail.com (Fanny)');
  console.log('    - @foretag.se (Marcus)');
  console.log('    - @yahoo.com (Sara)');
  console.log('    - @maxgaming.se (sponsor)');
  console.log('    - @nocco.com (sponsor)');
  console.log('    - @steelseries.com (sponsor)');
  console.log('    - @elgiganten.se (sponsor)');
}

seed().catch(err => {
  console.error('❌ Seed misslyckades:', err);
  process.exit(1);
});
