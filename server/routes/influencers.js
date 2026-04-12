import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { getLockedSearchQueries, NISCH_GROUPS, generateInfluencerSuggestions } from '../services/anthropic.js';
import { searchYouTubeChannels } from '../services/youtube.js';
import { findEmailForChannel, findEmailsForChannels } from '../services/email-finder.js';
import { enrichSingleProfile, isApifyConfigured } from '../services/social-enrichment.js';

const router = Router();

// Seed cache — anropas efter att DB initierats
export async function seedEmailCache() {
  try {
    const existing = await queryAll('SELECT kanalnamn, kontakt_epost FROM influencers WHERE kontakt_epost IS NOT NULL AND kontakt_epost != ""');
    let seeded = 0;
    for (const row of existing) {
      const handle = (row.kanalnamn || '').replace(/^@/, '');
      if (!handle || !row.kontakt_epost) continue;
      const cached = await queryOne('SELECT id FROM email_cache WHERE kanalnamn = ?', [handle]);
      if (!cached) {
        await runSql('INSERT INTO email_cache (kanalnamn, email, method) VALUES (?, ?, ?)', [handle, row.kontakt_epost, 'seeded']);
        seeded++;
      }
    }
    if (seeded > 0) console.log(`[E-post] ⚡ ${seeded} e-poster seedade till cache från befintlig data`);
  } catch (e) {
    console.log('[E-post] Cache seed skip:', e.message);
  }
}

// Skicka nischgrupper till frontend
router.get('/nischer', async (req, res) => {
  res.json(NISCH_GROUPS);
});

router.get('/foretag/:foretagId', async (req, res) => {
  const rows = await queryAll('SELECT * FROM influencers WHERE foretag_id = ? ORDER BY created_at DESC', [Number(req.params.foretagId)]);
  res.json(rows);
});

router.post('/find', async (req, res) => {
  try {
    const { foretagId } = req.body;
    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
    if (!foretag) return res.status(404).json({ error: 'Företag hittades inte' });

    // Steg 1: Hämta LÅSTA söktermer (inga AI-gissningar, alltid samma resultat)
    const searchQueries = getLockedSearchQueries(foretag.bransch);
    console.log(`[Partnrr] Steg 1: Låsta söktermer (${searchQueries.length} st):`, searchQueries);

    // Steg 2: YouTube Data API v3 hämtar RIKTIG, VERIFIERAD data
    console.log(`[Partnrr] Steg 2: Hämtar verifierad data från YouTube Data API v3...`);
    const allChannels = await searchYouTubeChannels(searchQueries, 10);

    // Filtrera bort kanaler under 1000 prenumeranter
    const filtered = allChannels.filter(ch => ch.foljare_exakt >= 1000);
    console.log(`[Partnrr] ${allChannels.length} kanaler hittade, ${filtered.length} har 1000+ prenumeranter`);

    // Sortera: nisch-relevans baserat på VALDA nischer, sedan följare
    // Bygg relevans-nyckelord från valda nisch-ID:n
    // Dynamiskt: bygg relevans-labels från NISCH_GROUPS
    // Varje nisch-id mappar till sin label + grupp-namn som relevansord
    const nischIdToRelevantLabels = {};
    for (const group of NISCH_GROUPS) {
      for (const nisch of group.nischer) {
        // Inkludera nischens label, gruppens namn, och enskilda ord från labeln
        const labels = [nisch.label, group.group];
        // Lägg till delord (t.ex. "FIFA / EA FC" → "FIFA", "EA FC")
        nisch.label.split(/[\/,&]+/).forEach(part => {
          const trimmed = part.trim();
          if (trimmed.length > 2) labels.push(trimmed);
        });
        nischIdToRelevantLabels[nisch.id] = labels;
      }
    }

    const valdaNischIds = (foretag.bransch || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const relevantLabels = new Set();
    for (const nId of valdaNischIds) {
      for (const label of (nischIdToRelevantLabels[nId] || [])) {
        relevantLabels.add(label);
      }
    }

    filtered.sort((a, b) => {
      const aNisch = [...relevantLabels].some(n => (a.nisch || '').includes(n)) ? 1 : 0;
      const bNisch = [...relevantLabels].some(n => (b.nisch || '').includes(n)) ? 1 : 0;
      if (bNisch !== aNisch) return bNisch - aNisch;
      return b.foljare_exakt - a.foljare_exakt;
    });

    const topChannels = filtered.slice(0, 10);
    console.log(`[Partnrr] Topp ${topChannels.length} kanaler (nisch-sorterade, 1000+ prenumeranter)`);

    // Steg 3: Sök e-postadresser automatiskt för alla kanaler
    console.log(`[Partnrr] Steg 3: Söker e-postadresser automatiskt (optimerad)...`);
    const emailResults = await findEmailsForChannels(
      topChannels.map(ch => ({
        kanalnamn: ch.kanalnamn,
        namn: ch.namn || '',
        beskrivning: ch.beskrivning || '',
        kontakt_info: ch.kontakt_info || '',
      })),
      8
    );

    // Slå ihop e-postresultat med kanaldata
    for (let i = 0; i < topChannels.length; i++) {
      const emailResult = emailResults[i];
      if (emailResult?.email && !topChannels[i].kontakt_epost) {
        topChannels[i].kontakt_epost = emailResult.email;
        topChannels[i].email_method = emailResult.method;
      }
    }

    const foundEmails = topChannels.filter(ch => ch.kontakt_epost).length;
    console.log(`[Partnrr] E-postsökning klar: ${foundEmails} av ${topChannels.length} e-postadresser hittade`);

    // Clear previous
    await runSql('DELETE FROM influencers WHERE foretag_id = ?', [foretagId]);

    for (const ch of topChannels) {
      const referralKod = (ch.kanalnamn || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      await runSql(
        `INSERT INTO influencers (foretag_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, kontakt_info, referral_kod)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [foretagId, ch.namn, ch.kanalnamn, ch.plattform, ch.foljare, ch.nisch,
         ch.kontakt_epost || null, ch.kontakt_info || null, referralKod]
      );
    }

    const saved = await queryAll('SELECT * FROM influencers WHERE foretag_id = ?', [foretagId]);

    // Returnera extra metadata + beräkna matchnings-score
    const enriched = saved.map((row, i) => {
      const ch = topChannels[i] || {};
      const foljare = ch.foljare_exakt || 0;
      const videoCount = ch.videoCount || 0;
      const viewCount = ch.viewCount || 0;
      const hasEmail = !!(ch.kontakt_epost || row.kontakt_epost);

      // Beräkna AI matchnings-score (0-100)
      let score = 0;

      // 1. Nisch-matchning (0-40 poäng)
      const nischStr = (ch.nisch || row.nisch || '').toLowerCase();
      const nischMatchCount = [...relevantLabels].filter(l => nischStr.includes(l.toLowerCase())).length;
      score += Math.min(nischMatchCount * 15, 40);

      // 2. Kanalstorlek — sweet spot 5K-500K (0-25 poäng)
      if (foljare >= 5000 && foljare <= 500000) {
        score += 25; // Sweet spot
      } else if (foljare > 500000) {
        score += 15; // Stor men svårare att nå
      } else if (foljare >= 1000) {
        score += 10; // Liten men aktiv
      }

      // 3. E-post tillgänglig (0-15 poäng)
      if (hasEmail) score += 15;

      // 4. Aktivitet — videos och visningar (0-20 poäng)
      if (videoCount > 50) score += 10;
      else if (videoCount > 20) score += 6;
      else if (videoCount > 5) score += 3;

      if (viewCount > 1000000) score += 10;
      else if (viewCount > 100000) score += 6;
      else if (viewCount > 10000) score += 3;

      const matchScore = Math.min(score, 100);

      return {
        ...row,
        datakalla: ch.datakalla || 'youtube_api',
        verifierad: ch.verifierad ?? true,
        thumbnail: ch.thumbnail || null,
        beskrivning: ch.beskrivning || null,
        foljare_exakt: foljare,
        videoCount: videoCount,
        viewCount: viewCount,
        email_method: ch.email_method || null,
        match_score: matchScore,
      };
    });

    // Sortera efter matchnings-score (högst först)
    enriched.sort((a, b) => b.match_score - a.match_score);

    res.json(enriched);
  } catch (error) {
    console.error('Find influencers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// MULTI-PLATTFORM SÖK — TikTok, Instagram, Twitch (AI-baserat)
// ============================================================
router.post('/find-multi', async (req, res) => {
  try {
    const { foretagId, plattform } = req.body;
    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
    if (!foretag) return res.status(404).json({ error: 'Företag hittades inte' });

    if (!plattform || plattform.toLowerCase() === 'youtube') {
      return res.status(400).json({ error: 'Använd /find för YouTube-sökning' });
    }

    // Hämta nisch-labels för AI-prompten
    const valdaNischIds = (foretag.bransch || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const nischLabels = [];
    for (const group of NISCH_GROUPS) {
      for (const nisch of group.nischer) {
        if (valdaNischIds.includes(nisch.id)) {
          nischLabels.push(nisch.label);
        }
      }
    }
    const nischStr = nischLabels.length > 0 ? nischLabels.join(', ') : 'gaming, esports';

    console.log(`[Partnrr] Multi-plattform: Söker ${plattform} influencers för nisch: ${nischStr}`);

    // AI-generera förslag
    const suggestions = await generateInfluencerSuggestions(plattform, nischStr, 10);

    if (suggestions.length === 0) {
      return res.json([]);
    }

    // Spara till DB (rensa gamla av samma plattform för detta företag)
    await runSql('DELETE FROM influencers WHERE foretag_id = ? AND LOWER(plattform) = ?', [foretagId, plattform.toLowerCase()]);

    for (const s of suggestions) {
      const referralKod = (s.kanalnamn || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      await runSql(
        `INSERT INTO influencers (foretag_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, kontakt_info, referral_kod)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [foretagId, s.namn, s.kanalnamn, plattform, s.foljare?.toString() || '0', s.nisch || nischStr,
         s.kontakt_epost || null, s.kontakt_info || null, referralKod]
      );
    }

    const saved = await queryAll('SELECT * FROM influencers WHERE foretag_id = ? AND LOWER(plattform) = ?', [foretagId, plattform.toLowerCase()]);

    // Enricha med metadata
    const enriched = saved.map((row, i) => {
      const s = suggestions[i] || {};
      const foljare = parseInt(String(s.foljare || '0').replace(/\D/g, '')) || 0;

      // Enklare match-score för AI-genererade
      let score = 40; // Bas-poäng (AI har redan filtrerat på nisch)
      if (foljare >= 5000 && foljare <= 500000) score += 25;
      else if (foljare > 500000) score += 15;
      else score += 10;
      if (s.kontakt_epost) score += 15;

      return {
        ...row,
        datakalla: 'ai_genererad',
        verifierad: false,
        thumbnail: null,
        beskrivning: s.beskrivning || null,
        foljare_exakt: foljare,
        videoCount: 0,
        viewCount: 0,
        email_method: null,
        match_score: Math.min(score, 100),
      };
    });

    enriched.sort((a, b) => b.match_score - a.match_score);

    console.log(`[Partnrr] ${enriched.length} ${plattform}-influencers genererade via AI`);
    res.json(enriched);
  } catch (error) {
    console.error('Find multi-platform error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/toggle', async (req, res) => {
  const inf = await queryOne('SELECT * FROM influencers WHERE id = ?', [Number(req.params.id)]);
  if (!inf) return res.status(404).json({ error: 'Influencer hittades inte' });
  await runSql('UPDATE influencers SET vald = ? WHERE id = ?', [inf.vald ? 0 : 1, Number(req.params.id)]);
  const updated = await queryOne('SELECT * FROM influencers WHERE id = ?', [Number(req.params.id)]);
  res.json(updated);
});

router.put('/foretag/:foretagId/select-all', async (req, res) => {
  const { selected } = req.body;
  await runSql('UPDATE influencers SET vald = ? WHERE foretag_id = ?', [selected ? 1 : 0, Number(req.params.foretagId)]);
  const rows = await queryAll('SELECT * FROM influencers WHERE foretag_id = ?', [Number(req.params.foretagId)]);
  res.json(rows);
});

// PUT /api/influencers/foretag/:foretagId/sync-selection — synka vald-status från frontend till DB
router.put('/foretag/:foretagId/sync-selection', async (req, res) => {
  try {
    const foretagId = Number(req.params.foretagId);
    const { selectedIds } = req.body;
    if (!foretagId) return res.status(400).json({ error: 'foretagId krävs' });

    await runSql('UPDATE influencers SET vald = 0 WHERE foretag_id = ?', [foretagId]);
    if (selectedIds?.length > 0) {
      const placeholders = selectedIds.map(() => '?').join(',');
      await runSql(
        `UPDATE influencers SET vald = 1 WHERE foretag_id = ? AND id IN (${placeholders})`,
        [foretagId, ...selectedIds.map(Number)]
      );
    }

    const rows = await queryAll('SELECT * FROM influencers WHERE foretag_id = ? ORDER BY id ASC', [foretagId]);
    console.log(`[Influencers] Sync selection: ${rows.filter(r => r.vald).length}/${rows.length} valda för företag ${foretagId}`);
    res.json(rows);
  } catch (error) {
    console.error('Influencer sync selection error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sök e-post automatiskt för en specifik influencer
router.post('/:id/find-email', async (req, res) => {
  try {
    const inf = await queryOne('SELECT * FROM influencers WHERE id = ?', [Number(req.params.id)]);
    if (!inf) return res.status(404).json({ error: 'Influencer hittades inte' });

    // Om vi redan har e-post, returnera den
    if (inf.kontakt_epost) {
      return res.json({ email: inf.kontakt_epost, method: 'already_known', updated: false });
    }

    console.log(`[E-post] Söker e-post för ${inf.namn} (@${inf.kanalnamn})...`);
    const result = await findEmailForChannel({
      kanalnamn: inf.kanalnamn,
      namn: inf.namn || '',
      beskrivning: req.body.beskrivning || '',
      kontakt_info: inf.kontakt_info,
    });

    if (result.email) {
      // Spara e-posten i databasen
      await runSql('UPDATE influencers SET kontakt_epost = ? WHERE id = ?', [result.email, inf.id]);
      return res.json({ email: result.email, method: result.method, updated: true });
    }

    res.json({ email: null, method: null, updated: false });
  } catch (error) {
    console.error('Find email error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sök e-post automatiskt för ALLA influencers utan e-post (bulk)
router.post('/foretag/:foretagId/find-emails', async (req, res) => {
  try {
    const influencers = await queryAll(
      'SELECT * FROM influencers WHERE foretag_id = ? AND (kontakt_epost IS NULL OR kontakt_epost = "")',
      [Number(req.params.foretagId)]
    );

    console.log(`[E-post] Söker e-post för ${influencers.length} influencers utan e-post...`);

    const results = [];
    for (const inf of influencers) {
      try {
        const result = await findEmailForChannel({
          kanalnamn: inf.kanalnamn,
          namn: inf.namn || '',
          beskrivning: '',
          kontakt_info: inf.kontakt_info,
        });

        if (result.email) {
          await runSql('UPDATE influencers SET kontakt_epost = ? WHERE id = ?', [result.email, inf.id]);
          results.push({ id: inf.id, namn: inf.namn, email: result.email, method: result.method });
        } else {
          results.push({ id: inf.id, namn: inf.namn, email: null, method: null });
        }
      } catch (err) {
        console.error(`[E-post] Error for ${inf.namn}:`, err.message);
        results.push({ id: inf.id, namn: inf.namn, email: null, error: err.message });
      }
    }

    const found = results.filter(r => r.email).length;
    console.log(`[E-post] Klart! Hittade ${found} av ${influencers.length} e-postadresser`);

    // Returnera uppdaterad lista
    const allInfluencers = await queryAll('SELECT * FROM influencers WHERE foretag_id = ?', [Number(req.params.foretagId)]);
    res.json({ results, influencers: allInfluencers, found, total: influencers.length });
  } catch (error) {
    console.error('Bulk find emails error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/influencers/bulk-save — spara AI-sökta influencers till DB
router.post('/bulk-save', async (req, res) => {
  try {
    const { foretag_id, influencers } = req.body;
    if (!foretag_id || !influencers?.length) {
      return res.status(400).json({ error: 'foretag_id och influencers krävs' });
    }

    // Ta bort gamla influencers för detta företag
    await runSql('DELETE FROM influencers WHERE foretag_id = ?', [foretag_id]);

    const saved = [];
    for (const inf of influencers) {
      const referralKod = ((inf.kanalnamn || inf.namn || 'UNKNOWN'))
        .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

      const { lastId } = await runSql(
        `INSERT INTO influencers (foretag_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, kontakt_info, referral_kod, vald)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          foretag_id,
          inf.namn || '',
          inf.kanalnamn || '',
          inf.plattform || 'youtube',
          (inf.foljare || '0').toString(),
          inf.nisch || '',
          inf.kontakt_epost || null,
          inf.kontakt_info || inf.beskrivning || null,
          referralKod,
          inf.vald ? 1 : 0,
        ]
      );

      saved.push({ ...inf, id: lastId, _oldId: inf.id });
    }

    // Hämta tillbaka med riktiga DB-ids
    const dbRows = await queryAll('SELECT * FROM influencers WHERE foretag_id = ? ORDER BY id ASC', [foretag_id]);

    console.log(`[Influencers] Sparade ${dbRows.length} AI-influencers till DB (${dbRows.filter(r => r.vald).length} valda)`);
    res.json(dbRows);
  } catch (error) {
    console.error('Bulk save error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// MANUELL IMPORT — Lägg till befintligt samarbete
// ============================================================
router.post('/manual-import', async (req, res) => {
  try {
    const {
      foretag_id,
      namn,
      kanalnamn,
      plattform,
      foljare,
      nisch,
      kontakt_epost,
      // Avtal-fält
      skapa_avtal,
      kontaktperson,
      avtal_status,
      videos_required,
      videos_delivered,
      total_signups,
      notes,
      // Extra
      skapa_konversation,
    } = req.body;

    if (!foretag_id || !namn || !kanalnamn || !plattform) {
      return res.status(400).json({ error: 'foretag_id, namn, kanalnamn och plattform krävs' });
    }

    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [Number(foretag_id)]);
    if (!foretag) return res.status(404).json({ error: 'Företag hittades inte' });

    // 1. Generera referral-kod
    const referral_kod = (kanalnamn || namn).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) + Math.random().toString(36).slice(2, 5).toUpperCase();

    // 2. Skapa influencer
    const { lastId: influencerId } = await runSql(
      `INSERT INTO influencers (foretag_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, referral_kod, vald)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [Number(foretag_id), namn, kanalnamn, plattform, foljare || '', nisch || '', kontakt_epost || '', referral_kod]
    );

    let kontraktId = null;
    let outreachId = null;

    // 3. Skapa ett placeholder outreach-meddelande (för att länka kontrakt + uppföljning)
    const { lastId: oId } = await runSql(
      `INSERT INTO outreach_meddelanden (influencer_id, foretag_id, meddelande, amne, typ, status, skickat_datum)
       VALUES (?, ?, ?, ?, 'manuell_import', 'skickat', datetime('now'))`,
      [influencerId, Number(foretag_id), `[Manuell import] Befintligt samarbete med ${namn}`, `Samarbete — ${foretag.namn} x ${namn}`]
    );
    outreachId = oId;

    // 4. Skapa avtal om begärt
    if (skapa_avtal) {
      const kperson = kontaktperson || foretag.kontaktperson || '';
      const status = avtal_status || 'aktivt';
      const vReq = videos_required || 5;
      const vDel = videos_delivered || 0;
      const tSignups = total_signups || 0;

      const { lastId: kId } = await runSql(
        `INSERT INTO kontrakt (influencer_id, foretag_id, outreach_id, kontaktperson, status, videos_required, videos_delivered, total_signups, notes, activated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+30 days'))`,
        [influencerId, Number(foretag_id), outreachId, kperson, status, vReq, vDel, tSignups, notes || '']
      );
      kontraktId = kId;

      // Uppdatera outreach-status
      if (status === 'aktivt' || status === 'signerat') {
        await runSql("UPDATE outreach_meddelanden SET status = 'avtal_signerat', kontrakt_bifogat = 1 WHERE id = ?", [outreachId]);
      }
    }

    // 5. Skapa konversationstråd om e-post finns
    if (kontakt_epost && skapa_konversation !== false) {
      const existingThread = await queryOne(
        'SELECT id FROM conversation_threads WHERE contact_email = ?',
        [kontakt_epost.toLowerCase()]
      );
      if (existingThread) {
        await runSql(
          `UPDATE conversation_threads SET influencer_id = ?, deal_stage = ?, updated_at = datetime('now') WHERE id = ?`,
          [influencerId, skapa_avtal ? 'avtal' : 'outreach', existingThread.id]
        );
      } else {
        await runSql(
          `INSERT INTO conversation_threads (influencer_id, contact_email, contact_name, plattform, kanalnamn, deal_stage, last_message_at, message_count, unread_count)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 1, 0)`,
          [influencerId, kontakt_epost.toLowerCase(), namn, plattform, kanalnamn, skapa_avtal ? 'avtal' : 'outreach']
        );
      }
    }

    // 6. E-post cache
    if (kontakt_epost) {
      const handle = (kanalnamn || '').replace(/^@/, '');
      if (handle) {
        const cached = await queryOne('SELECT id FROM email_cache WHERE kanalnamn = ?', [handle]);
        if (!cached) {
          await runSql('INSERT INTO email_cache (kanalnamn, email, method) VALUES (?, ?, ?)', [handle, kontakt_epost, 'manual_import']);
        }
      }
    }

    res.json({
      success: true,
      influencer_id: influencerId,
      kontrakt_id: kontraktId,
      outreach_id: outreachId,
      referral_kod,
    });
  } catch (error) {
    console.error('[Influencers] Manual import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DIREKT-SÖK: Sök influencer på ALLA plattformar samtidigt
// ============================================================
router.post('/search-direct', async (req, res) => {
  try {
    const { query, foretagId } = req.body;
    if (!query || !foretagId) return res.status(400).json({ error: 'query och foretagId krävs' });

    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
    if (!foretag) return res.status(404).json({ error: 'Företag hittades inte' });

    const cleanQuery = query.trim().replace(/^@/, '');
    console.log(`[Search] Direkt-sök: "${cleanQuery}" för ${foretag.namn}`);
    const results = [];

    // Kör ALLA sökningar parallellt: YouTube + Instagram + TikTok
    const searchPromises = [];

    // 1. Sök YouTube via Data API
    searchPromises.push(
      (async () => {
        try {
          const ytResults = await searchYouTubeChannels([cleanQuery], { maxPerQuery: 5 });
          if (ytResults?.length > 0) {
            for (const yt of ytResults) {
              const emailResult = await findEmailForChannel(yt.kanalnamn || yt.namn);
              results.push({
                id: `yt-${yt.channelId || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                namn: yt.namn || yt.kanalnamn,
                kanalnamn: (yt.kanalnamn || yt.namn || '').replace(/^@/, ''),
                plattform: 'YouTube',
                foljare: yt.foljare || '0',
                foljare_exakt: yt.foljare_exakt || parseInt(yt.foljare) || 0,
                nisch: yt.nisch || '',
                kontakt_epost: emailResult?.email || yt.kontakt_epost || '',
                thumbnail: yt.thumbnail || null,
                beskrivning: yt.beskrivning || '',
                datakalla: 'youtube_api',
                verifierad: true,
                videoCount: yt.videoCount || 0,
                viewCount: yt.viewCount || 0,
                match_score: null,
              });
            }
            console.log(`[Search] YouTube: ${ytResults.length} resultat`);
          }
        } catch (ytErr) {
          console.warn(`[Search] YouTube-sökning misslyckades: ${ytErr.message}`);
        }
      })()
    );

    // 2. Sök Instagram direkt via Apify (verifiera att profilen existerar)
    if (isApifyConfigured()) {
      searchPromises.push(
        (async () => {
          try {
            console.log(`[Search] Apify Instagram direkt-sökning: @${cleanQuery}`);
            const igProfile = await enrichSingleProfile(cleanQuery, 'instagram');
            if (igProfile && igProfile.username) {
              results.push({
                id: `ig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                namn: igProfile.full_name || igProfile.username,
                kanalnamn: igProfile.username,
                plattform: 'Instagram',
                foljare: formatFollowers(igProfile.followers || 0),
                foljare_exakt: igProfile.followers || 0,
                nisch: igProfile.category || '',
                kontakt_epost: '',
                thumbnail: igProfile.avatar_url || null,
                beskrivning: igProfile.bio || '',
                datakalla: 'apify_instagram',
                verifierad: true,
                videoCount: igProfile.posts_count || 0,
                viewCount: 0,
                match_score: null,
                profile_url: igProfile.profile_url || `https://www.instagram.com/${igProfile.username}/`,
                engagement_rate: igProfile.engagement_rate || null,
              });
              console.log(`[Search] Instagram Apify: ✅ @${igProfile.username} (${igProfile.followers} followers)`);
            } else {
              console.log(`[Search] Instagram Apify: profil @${cleanQuery} ej hittad`);
            }
          } catch (igErr) {
            console.warn(`[Search] Instagram Apify-sökning misslyckades: ${igErr.message}`);
          }
        })()
      );

      // 3. Sök TikTok direkt via Apify
      searchPromises.push(
        (async () => {
          try {
            console.log(`[Search] Apify TikTok direkt-sökning: @${cleanQuery}`);
            const ttProfile = await enrichSingleProfile(cleanQuery, 'tiktok');
            if (ttProfile && ttProfile.username) {
              results.push({
                id: `tt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                namn: ttProfile.full_name || ttProfile.username,
                kanalnamn: ttProfile.username,
                plattform: 'TikTok',
                foljare: formatFollowers(ttProfile.followers || 0),
                foljare_exakt: ttProfile.followers || 0,
                nisch: '',
                kontakt_epost: '',
                thumbnail: ttProfile.avatar_url || null,
                beskrivning: ttProfile.bio || '',
                datakalla: 'apify_tiktok',
                verifierad: true,
                videoCount: ttProfile.posts_count || 0,
                viewCount: 0,
                match_score: null,
                profile_url: ttProfile.profile_url || `https://www.tiktok.com/@${ttProfile.username}`,
                engagement_rate: ttProfile.engagement_rate || null,
              });
              console.log(`[Search] TikTok Apify: ✅ @${ttProfile.username} (${ttProfile.followers} followers)`);
            } else {
              console.log(`[Search] TikTok Apify: profil @${cleanQuery} ej hittad`);
            }
          } catch (ttErr) {
            console.warn(`[Search] TikTok Apify-sökning misslyckades: ${ttErr.message}`);
          }
        })()
      );
    } else {
      console.log(`[Search] APIFY_API_TOKEN saknas — Instagram/TikTok direkt-sökning ej tillgänglig`);
    }

    await Promise.all(searchPromises);

    console.log(`[Search] Totalt: ${results.length} resultat för "${cleanQuery}"`);
    res.json(results);
  } catch (error) {
    console.error('[Search] Direct search error:', error);
    res.status(500).json({ error: error.message });
  }
});

function formatFollowers(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export default router;
