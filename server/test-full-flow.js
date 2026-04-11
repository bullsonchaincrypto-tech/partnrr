/**
 * Test script: Skapar testdata för BÅDA rutterna (influencer + sponsor)
 * och verifierar att allt sparas korrekt i databasen.
 *
 * Kör: cd server && node test-full-flow.js
 */

import { initDb, queryAll, queryOne, runSql, getDb } from './db/schema.js';

async function run() {
  console.log('=== INITIERAR DATABAS ===\n');
  await initDb();

  // ============================================
  // 1. Skapa företag
  // ============================================
  console.log('--- Steg 1: Skapar testföretag ---');
  const { lastId: foretagId } = runSql(
    `INSERT INTO foretag (namn, epost, kontaktperson, bransch, beskrivning)
     VALUES (?, ?, ?, ?, ?)`,
    ['TestFöretag AB', 'test@testforetag.se', 'Anna Testsson', 'Gaming', 'Vi driver en tävlingsplattform för gamers']
  );
  console.log(`✓ Företag skapat med id: ${foretagId}\n`);

  // ============================================
  // 2. INFLUENCER-FLÖDET
  // ============================================
  console.log('=== INFLUENCER-FLÖDET ===\n');

  // 2a. Skapa influencers
  console.log('--- Steg 2: Skapar influencers ---');
  const inf1 = runSql(
    `INSERT INTO influencers (foretag_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, referral_kod, vald)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [foretagId, 'GamerSven', 'SvenSpelar', 'YouTube', '50000', 'Gaming', 'gamersven@test.se', 'SVEN50', ]
  );
  const inf2 = runSql(
    `INSERT INTO influencers (foretag_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, referral_kod, vald)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [foretagId, 'PixelLisa', 'LisaPixlar', 'TikTok', '120000', 'Gaming/Lifestyle', 'pixellisa@test.se', 'LISA120']
  );
  console.log(`✓ Influencer 1 (GamerSven) id: ${inf1.lastId}`);
  console.log(`✓ Influencer 2 (PixelLisa) id: ${inf2.lastId}\n`);

  // 2b. Skapa outreach-meddelanden
  console.log('--- Steg 3: Skapar outreach-meddelanden ---');
  const om1 = runSql(
    `INSERT INTO outreach_meddelanden (influencer_id, foretag_id, meddelande, amne, typ, status)
     VALUES (?, ?, ?, ?, 'initial', 'utkast')`,
    [inf1.lastId, foretagId, 'Hej GamerSven! Vi vill samarbeta med dig...', 'Samarbete med TestFöretag AB']
  );
  const om2 = runSql(
    `INSERT INTO outreach_meddelanden (influencer_id, foretag_id, meddelande, amne, typ, status)
     VALUES (?, ?, ?, ?, 'initial', 'utkast')`,
    [inf2.lastId, foretagId, 'Hej PixelLisa! Vi har ett spännande förslag...', 'Spännande samarbete - TestFöretag AB']
  );
  console.log(`✓ Outreach 1 id: ${om1.lastId}`);
  console.log(`✓ Outreach 2 id: ${om2.lastId}\n`);

  // 2c. Simulera "skicka" - uppdatera status, skapa kontrakt och konversationstrådar
  console.log('--- Steg 4: Simulerar skicka (influencer) ---');

  // Uppdatera outreach till "skickat"
  runSql("UPDATE outreach_meddelanden SET status = 'skickat', skickat_datum = datetime('now') WHERE id = ?", [om1.lastId]);
  runSql("UPDATE outreach_meddelanden SET status = 'skickat', skickat_datum = datetime('now') WHERE id = ?", [om2.lastId]);

  // Skapa kontrakt (som om bifogat)
  const k1 = runSql(
    `INSERT INTO kontrakt (influencer_id, foretag_id, outreach_id, kontaktperson, status, source_type)
     VALUES (?, ?, ?, ?, 'skickat', 'influencer')`,
    [inf1.lastId, foretagId, om1.lastId, 'Anna Testsson']
  );
  const k2 = runSql(
    `INSERT INTO kontrakt (influencer_id, foretag_id, outreach_id, kontaktperson, status, source_type)
     VALUES (?, ?, ?, ?, 'skickat', 'influencer')`,
    [inf2.lastId, foretagId, om2.lastId, 'Anna Testsson']
  );
  console.log(`✓ Kontrakt 1 (influencer) id: ${k1.lastId}, source_type: 'influencer'`);
  console.log(`✓ Kontrakt 2 (influencer) id: ${k2.lastId}, source_type: 'influencer'`);

  // Skapa konversationstrådar
  runSql(
    `INSERT INTO conversation_threads (influencer_id, contact_email, contact_name, plattform, kanalnamn, deal_stage, last_message_at, message_count, unread_count)
     VALUES (?, ?, ?, ?, ?, 'outreach', datetime('now'), 1, 0)`,
    [inf1.lastId, 'gamersven@test.se', 'GamerSven', 'YouTube', 'SvenSpelar']
  );
  runSql(
    `INSERT INTO conversation_threads (influencer_id, contact_email, contact_name, plattform, kanalnamn, deal_stage, last_message_at, message_count, unread_count)
     VALUES (?, ?, ?, ?, ?, 'outreach', datetime('now'), 1, 0)`,
    [inf2.lastId, 'pixellisa@test.se', 'PixelLisa', 'TikTok', 'LisaPixlar']
  );
  console.log(`✓ 2 konversationstrådar skapade (influencer)\n`);

  // ============================================
  // 3. SPONSOR-FLÖDET
  // ============================================
  console.log('=== SPONSOR-FLÖDET ===\n');

  // 3a. Skapa sponsor-prospects
  console.log('--- Steg 2: Skapar sponsor-prospects ---');
  const sp1 = runSql(
    `INSERT INTO sponsor_prospects (foretag_id, namn, kontaktperson, epost, bransch, hemsida, vald)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [foretagId, 'GameStore AB', 'Erik Johansson', 'erik@gamestore.se', 'Gaming retail', 'https://gamestore.se']
  );
  const sp2 = runSql(
    `INSERT INTO sponsor_prospects (foretag_id, namn, kontaktperson, epost, bransch, hemsida, vald)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [foretagId, 'EnergyDrink Sverige', 'Maria Nilsson', 'maria@energydrink.se', 'Energidryck', 'https://energydrink.se']
  );
  console.log(`✓ Prospect 1 (GameStore AB) id: ${sp1.lastId}`);
  console.log(`✓ Prospect 2 (EnergyDrink Sverige) id: ${sp2.lastId}\n`);

  // 3b. Skapa sponsor-outreach
  console.log('--- Steg 3: Skapar sponsor-outreach ---');
  const so1 = runSql(
    `INSERT INTO sponsor_outreach (prospect_id, foretag_id, meddelande, amne, kanal, status)
     VALUES (?, ?, ?, ?, 'email', 'utkast')`,
    [sp1.lastId, foretagId, 'Hej GameStore! Vi söker sponsorer för vår plattform...', 'Sponsormöjlighet - TestFöretag AB']
  );
  const so2 = runSql(
    `INSERT INTO sponsor_outreach (prospect_id, foretag_id, meddelande, amne, kanal, status)
     VALUES (?, ?, ?, ?, 'email', 'utkast')`,
    [sp2.lastId, foretagId, 'Hej EnergyDrink! Vill ni nå 50 000 gamers?...', 'Partnership - TestFöretag AB x EnergyDrink']
  );
  console.log(`✓ Sponsor outreach 1 id: ${so1.lastId}`);
  console.log(`✓ Sponsor outreach 2 id: ${so2.lastId}\n`);

  // 3c. Simulera "skicka" - uppdatera status, skapa kontrakt och konversationstrådar
  console.log('--- Steg 4: Simulerar skicka (sponsor) ---');

  runSql("UPDATE sponsor_outreach SET status = 'skickat', skickat_datum = datetime('now') WHERE id = ?", [so1.lastId]);
  runSql("UPDATE sponsor_outreach SET status = 'skickat', skickat_datum = datetime('now') WHERE id = ?", [so2.lastId]);

  // Skapa kontrakt med source_type = 'sponsor'
  const k3 = runSql(
    `INSERT INTO kontrakt (influencer_id, foretag_id, kontaktperson, status, notes, source_type)
     VALUES (?, ?, ?, 'skickat', ?, 'sponsor')`,
    [sp1.lastId, foretagId, 'Anna Testsson', `Sponsor: GameStore AB`]
  );
  const k4 = runSql(
    `INSERT INTO kontrakt (influencer_id, foretag_id, kontaktperson, status, notes, source_type)
     VALUES (?, ?, ?, 'skickat', ?, 'sponsor')`,
    [sp2.lastId, foretagId, 'Anna Testsson', `Sponsor: EnergyDrink Sverige`]
  );
  console.log(`✓ Kontrakt 3 (sponsor) id: ${k3.lastId}, source_type: 'sponsor'`);
  console.log(`✓ Kontrakt 4 (sponsor) id: ${k4.lastId}, source_type: 'sponsor'`);

  // Skapa konversationstrådar för sponsors
  runSql(
    `INSERT INTO conversation_threads (prospect_id, contact_email, contact_name, plattform, deal_stage, last_message_at, message_count, unread_count)
     VALUES (?, ?, ?, 'Sponsor', 'outreach', datetime('now'), 1, 0)`,
    [sp1.lastId, 'erik@gamestore.se', 'GameStore AB']
  );
  runSql(
    `INSERT INTO conversation_threads (prospect_id, contact_email, contact_name, plattform, deal_stage, last_message_at, message_count, unread_count)
     VALUES (?, ?, ?, 'Sponsor', 'outreach', datetime('now'), 1, 0)`,
    [sp2.lastId, 'maria@energydrink.se', 'EnergyDrink Sverige']
  );
  console.log(`✓ 2 konversationstrådar skapade (sponsor)\n`);

  // ============================================
  // 4. VERIFIERING
  // ============================================
  console.log('=== VERIFIERING ===\n');

  // 4a. Företag
  const foretag = queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
  console.log(`Företag: ${foretag.namn} (id: ${foretag.id}) ✓`);

  // 4b. Influencers
  const influencers = queryAll('SELECT id, namn, plattform, kontakt_epost FROM influencers WHERE foretag_id = ?', [foretagId]);
  console.log(`\nInfluencers (${influencers.length}):`);
  influencers.forEach(i => console.log(`  - ${i.namn} (${i.plattform}) ${i.kontakt_epost}`));

  // 4c. Sponsor prospects
  const prospects = queryAll('SELECT id, namn, epost, bransch FROM sponsor_prospects WHERE foretag_id = ?', [foretagId]);
  console.log(`\nSponsor prospects (${prospects.length}):`);
  prospects.forEach(p => console.log(`  - ${p.namn} (${p.bransch}) ${p.epost}`));

  // 4d. Outreach meddelanden
  const outreach = queryAll('SELECT id, influencer_id, status, amne FROM outreach_meddelanden WHERE foretag_id = ?', [foretagId]);
  console.log(`\nOutreach (influencer) (${outreach.length}):`);
  outreach.forEach(o => console.log(`  - id:${o.id} status:${o.status} "${o.amne}"`));

  // 4e. Sponsor outreach
  const sponsorOut = queryAll('SELECT id, prospect_id, status, amne FROM sponsor_outreach WHERE foretag_id = ?', [foretagId]);
  console.log(`\nSponsor outreach (${sponsorOut.length}):`);
  sponsorOut.forEach(s => console.log(`  - id:${s.id} prospect_id:${s.prospect_id} status:${s.status} "${s.amne}"`));

  // 4f. Kontrakt — KRITISKT: kontrollera att ALLA 4 kontrakt syns
  console.log(`\n--- KONTRAKT (det viktiga testet) ---`);
  const allKontrakt = queryAll('SELECT * FROM kontrakt WHERE foretag_id = ?', [foretagId]);
  console.log(`Total kontrakt i DB: ${allKontrakt.length}`);
  allKontrakt.forEach(k => console.log(`  - id:${k.id} influencer_id:${k.influencer_id} source_type:${k.source_type || 'NULL'} status:${k.status} notes:${k.notes || '-'}`));

  // 4g. Testa contracts.js JOIN-logik — simulera /api/contracts
  console.log(`\n--- CONTRACTS API QUERY TEST ---`);
  const contractsApiQuery = queryAll(`
    SELECT k.*,
      COALESCE(i.namn, sp.namn) as influencer_namn,
      COALESCE(i.kanalnamn, '') as kanalnamn,
      COALESCE(i.kontakt_epost, sp.epost) as kontakt_epost,
      CASE WHEN sp.id IS NOT NULL THEN 'sponsor' ELSE 'influencer' END as contract_type,
      f.namn as foretag_namn
    FROM kontrakt k
    LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
    LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
    JOIN foretag f ON k.foretag_id = f.id
    WHERE (i.id IS NOT NULL OR sp.id IS NOT NULL)
    ORDER BY k.created_at DESC
  `);
  console.log(`Kontrakt synliga via API: ${contractsApiQuery.length}`);
  contractsApiQuery.forEach(k => {
    console.log(`  - id:${k.id} "${k.influencer_namn}" type:${k.contract_type} status:${k.status}`);
  });

  if (contractsApiQuery.length === 4) {
    console.log('✅ ALLA 4 KONTRAKT SYNLIGA — JOIN-logik fungerar korrekt!');
  } else {
    console.log(`❌ FEL: Förväntade 4 kontrakt, fick ${contractsApiQuery.length}`);
  }

  // 4h. Konversationstrådar
  console.log(`\n--- KONVERSATIONER ---`);
  const threads = queryAll(`
    SELECT ct.*,
      COALESCE(i.namn, sp.namn) as person_namn,
      COALESCE(i.plattform, 'Sponsor') as plattform_typ
    FROM conversation_threads ct
    LEFT JOIN influencers i ON ct.influencer_id = i.id
    LEFT JOIN sponsor_prospects sp ON ct.prospect_id = sp.id
    ORDER BY ct.last_message_at DESC
  `);
  console.log(`Total konversationer: ${threads.length}`);
  threads.forEach(t => {
    console.log(`  - id:${t.id} "${t.person_namn || t.contact_name}" (${t.plattform_typ}) email:${t.contact_email} messages:${t.message_count}`);
  });

  if (threads.length === 4) {
    console.log('✅ ALLA 4 KONVERSATIONER SYNLIGA!');
  } else {
    console.log(`❌ FEL: Förväntade 4 konversationer, fick ${threads.length}`);
  }

  // 4i. Kontrakt overview stats
  console.log(`\n--- KONTRAKT OVERVIEW ---`);
  const total = queryOne('SELECT COUNT(*) as count FROM kontrakt')?.count || 0;
  const byStatus = queryAll('SELECT status, COUNT(*) as count FROM kontrakt GROUP BY status');
  console.log(`Total: ${total}`);
  byStatus.forEach(s => console.log(`  ${s.status}: ${s.count}`));

  console.log('\n=== TEST KLART ===');
}

run().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
