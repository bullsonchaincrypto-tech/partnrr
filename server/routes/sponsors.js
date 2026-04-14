import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { findSponsorProspects, generateSponsorPitch } from '../services/anthropic.js';
import { findSponsorsViaGoogleMaps, searchGoogleMaps, generateSponsorSearchTerms } from '../services/ai-search.js';
import { discoverInstagramViaSearch, discoverTikTokViaSearch, isApifyConfigured } from '../services/apify-discovery.js';
import { sendEmail } from '../services/email-service.js';

const router = Router();

// Get prospects for a företag
router.get('/prospects/:foretagId', async (req, res) => {
  const rows = await queryAll('SELECT * FROM sponsor_prospects WHERE foretag_id = ? ORDER BY created_at DESC', [Number(req.params.foretagId)]);
  res.json(rows);
});

// AI: Find sponsor prospects
router.post('/prospects/find', async (req, res) => {
  try {
    const { foretagId } = req.body;
    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
    if (!foretag) return res.status(404).json({ error: 'Foretag hittades inte' });

    // Steg 1: Generera sponsor-söktermer för IG + TT (Claude, en anrop)
    let sponsorSearchTerms = [];
    if (isApifyConfigured()) {
      try {
        sponsorSearchTerms = await generateSponsorSearchTerms(
          foretag.beskrivning || foretag.namn,
          foretag.namn
        );
      } catch (err) {
        console.warn(`[Sponsors] generateSponsorSearchTerms misslyckades: ${err.message}`);
      }
    }

    // Steg 2: Kör Google Maps + IG-search + TT-search parallellt
    console.log(`[Sponsors] Parallell discovery: Google Maps + IG search + TT search`);
    const [googleMapsResults, igResults, ttResults] = await Promise.all([
      findSponsorsViaGoogleMaps(foretag.namn, foretag.beskrivning).catch(err => {
        console.warn(`[Sponsors] Google Maps misslyckades: ${err.message}`);
        return [];
      }),
      (isApifyConfigured() && sponsorSearchTerms.length > 0)
        ? discoverInstagramViaSearch(sponsorSearchTerms, 120, { includeBusinesses: true }).catch(err => {
            console.warn(`[Sponsors] IG search misslyckades: ${err.message}`);
            return [];
          })
        : Promise.resolve([]),
      (isApifyConfigured() && sponsorSearchTerms.length > 0)
        ? discoverTikTokViaSearch(sponsorSearchTerms, 120, { includeBusinesses: true }).catch(err => {
            console.warn(`[Sponsors] TT search misslyckades: ${err.message}`);
            return [];
          })
        : Promise.resolve([]),
    ]);

    console.log(`[Sponsors] Hittade: ${googleMapsResults.length} Google Maps + ${igResults.length} IG + ${ttResults.length} TT`);

    const socialProfiles = { instagram: igResults, tiktok: ttResults };

    // Steg 3: Claude rankar och filtrerar från alla källor
    const prospects = await findSponsorProspects(
      foretag.namn,
      foretag.bransch,
      foretag.beskrivning,
      googleMapsResults,
      socialProfiles
    );

    await runSql('DELETE FROM sponsor_prospects WHERE foretag_id = ?', [foretagId]);

    // Filtrera bort prospects utan namn (krävs av NOT NULL constraint)
    const validProspects = prospects.filter(p => p.namn && p.namn.trim());
    console.log(`[Sponsors] ${validProspects.length}/${prospects.length} prospects har giltigt namn`);

    for (const p of validProspects) {
      await runSql(
        `INSERT INTO sponsor_prospects (foretag_id, namn, kontaktperson, epost, bransch, instagram_handle, hemsida, telefon, betyg, kalla)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [foretagId, p.namn.trim(), p.kontaktperson || null, p.epost || null, p.bransch || null, p.instagram_handle || null, p.hemsida || null, p.telefon || null, p.betyg || null, p.kalla || 'ai']
      );
    }

    const saved = await queryAll('SELECT * FROM sponsor_prospects WHERE foretag_id = ?', [foretagId]);
    res.json(saved);
  } catch (error) {
    console.error('Find sponsors error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Toggle selection
router.put('/prospects/:id/toggle', async (req, res) => {
  const p = await queryOne('SELECT * FROM sponsor_prospects WHERE id = ?', [Number(req.params.id)]);
  if (!p) return res.status(404).json({ error: 'Prospect hittades inte' });
  await runSql('UPDATE sponsor_prospects SET vald = ? WHERE id = ?', [p.vald ? 0 : 1, Number(req.params.id)]);
  const updated = await queryOne('SELECT * FROM sponsor_prospects WHERE id = ?', [Number(req.params.id)]);
  res.json(updated);
});

router.put('/prospects/:foretagId/select-all', async (req, res) => {
  const { selected } = req.body;
  await runSql('UPDATE sponsor_prospects SET vald = ? WHERE foretag_id = ?', [selected ? 1 : 0, Number(req.params.foretagId)]);
  const rows = await queryAll('SELECT * FROM sponsor_prospects WHERE foretag_id = ?', [Number(req.params.foretagId)]);
  res.json(rows);
});

// Generate sponsor pitches
router.post('/outreach/generate', async (req, res) => {
  try {
    const { foretagId, kanal, sponsorQuestions } = req.body;
    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
    if (!foretag) return res.status(404).json({ error: 'Foretag hittades inte' });

    // Hämta brief från company_profile om den finns
    let brief = null;
    try {
      if (foretag.company_profile) {
        const profile = JSON.parse(foretag.company_profile);
        brief = profile.brief_answers || profile.outreach_brief || null;
      }
    } catch {}

    const selected = await queryAll('SELECT * FROM sponsor_prospects WHERE foretag_id = ? AND vald = 1', [foretagId]);
    if (selected.length === 0) return res.status(400).json({ error: 'Inga prospects valda' });

    const messages = [];
    for (const prospect of selected) {
      const raw = await generateSponsorPitch(prospect, foretag, kanal || 'email', brief, sponsorQuestions);

      let amne = `Sponsorsamarbete - ${foretag.namn} x ${prospect.namn}`;
      let meddelande = raw;

      const parts = raw.split('---');
      if (parts.length >= 2) {
        const amneLine = parts[0].trim();
        amne = amneLine.replace(/^ÄMNE:\s*/i, '').trim();
        meddelande = parts.slice(1).join('---').trim();
      }

      const { lastId } = await runSql(`
        INSERT INTO sponsor_outreach (prospect_id, foretag_id, meddelande, amne, kanal, status)
        VALUES (?, ?, ?, ?, ?, 'utkast')
      `, [prospect.id, foretagId, meddelande, amne, kanal || 'email']);

      const msg = await queryOne(`
        SELECT so.*, sp.namn as prospect_namn, sp.epost as prospect_epost, sp.bransch as prospect_bransch, sp.instagram_handle
        FROM sponsor_outreach so
        JOIN sponsor_prospects sp ON so.prospect_id = sp.id
        WHERE so.id = ?
      `, [lastId]);

      messages.push(msg);
    }

    res.json(messages);
  } catch (error) {
    console.error('Generate sponsor pitch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all sponsor outreach
router.get('/outreach/:foretagId', async (req, res) => {
  const rows = await queryAll(`
    SELECT so.*, sp.namn as prospect_namn, sp.epost as prospect_epost, sp.bransch as prospect_bransch, sp.instagram_handle
    FROM sponsor_outreach so
    JOIN sponsor_prospects sp ON so.prospect_id = sp.id
    WHERE so.foretag_id = ?
    ORDER BY so.created_at DESC
  `, [Number(req.params.foretagId)]);
  res.json(rows);
});

// Update sponsor outreach message
router.put('/outreach/:id', async (req, res) => {
  const { meddelande, amne, status } = req.body;
  const sets = [];
  const vals = [];
  if (meddelande !== undefined) { sets.push('meddelande = ?'); vals.push(meddelande); }
  if (amne !== undefined) { sets.push('amne = ?'); vals.push(amne); }
  if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
  if (sets.length === 0) return res.status(400).json({ error: 'Inget att uppdatera' });

  vals.push(Number(req.params.id));
  await runSql(`UPDATE sponsor_outreach SET ${sets.join(', ')} WHERE id = ?`, vals);

  const msg = await queryOne(`
    SELECT so.*, sp.namn as prospect_namn, sp.epost as prospect_epost, sp.bransch as prospect_bransch, sp.instagram_handle
    FROM sponsor_outreach so
    JOIN sponsor_prospects sp ON so.prospect_id = sp.id
    WHERE so.id = ?
  `, [Number(req.params.id)]);
  res.json(msg);
});

// Send sponsor outreach
router.post('/outreach/send', async (req, res) => {
  try {
    const { messageIds, attachContracts, kontaktperson: incomingKontaktperson } = req.body;
    const results = [];

    for (const msgId of messageIds) {
      const msg = await queryOne(`
        SELECT so.*, sp.namn as prospect_namn, sp.epost as prospect_epost, sp.bransch as prospect_bransch,
               sp.hemsida as prospect_hemsida, sp.telefon as prospect_telefon
        FROM sponsor_outreach so
        JOIN sponsor_prospects sp ON so.prospect_id = sp.id
        WHERE so.id = ?
      `, [msgId]);

      if (!msg || !msg.prospect_epost) {
        results.push({ id: msgId, status: 'misslyckat', error: 'Ingen e-post' });
        await runSql("UPDATE sponsor_outreach SET status = 'misslyckat' WHERE id = ?", [msgId]);
        continue;
      }

      try {
        const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [msg.foretag_id]);
        const kontaktperson = incomingKontaktperson || foretag?.kontaktperson || '';

        // Generera kontrakt-PDF om bifogning aktiverad
        let attachmentBuffer = null;
        let attachmentName = null;
        if (attachContracts && foretag) {
          try {
            const { generateContractPdf } = await import('../services/contract-pdf.js');
            attachmentBuffer = await generateContractPdf({
              foretagNamn: foretag.namn,
              kontaktperson,
              epost: foretag.epost,
              influencerNamn: msg.prospect_namn,
              kanalnamn: msg.prospect_bransch || '',
              plattform: 'Sponsor',
              datum: new Date().toISOString().split('T')[0],
            });
            attachmentName = `Avtal_${foretag.namn}_${msg.prospect_namn}.pdf`.replace(/\s+/g, '_');
            console.log(`[Sponsor] Kontrakt-PDF genererad för ${msg.prospect_namn} (${attachmentBuffer.length} bytes)`);
          } catch (pdfErr) {
            console.warn(`[Sponsor] Kunde inte generera kontrakt-PDF: ${pdfErr.message}`);
          }
        }

        // Skicka e-post
        await sendEmail({
          to: msg.prospect_epost,
          subject: msg.amne,
          body: msg.meddelande,
          attachmentBuffer,
          attachmentName,
        });

        // Uppdatera status
        await runSql("UPDATE sponsor_outreach SET status = 'skickat', skickat_datum = datetime('now') WHERE id = ?", [msgId]);

        // Skapa kontrakt-post om bifogat
        if (attachContracts && foretag) {
          try {
            // Använd prospect_id som influencer_id-proxy för sponsor-kontrakt
            await runSql(`INSERT INTO kontrakt (influencer_id, foretag_id, kontaktperson, status, notes, source_type)
              VALUES (?, ?, ?, 'skickat', ?, 'sponsor')`,
              [msg.prospect_id, msg.foretag_id, kontaktperson, `Sponsor: ${msg.prospect_namn}`]);
            console.log(`[Sponsor] Kontrakt skapat för ${msg.prospect_namn}`);
          } catch (dbErr) {
            console.warn(`[Sponsor] Kontrakt-sparning misslyckades: ${dbErr.message}`);
          }
        }

        // Skapa/uppdatera konversationstråd — EN per prospect (dedupe på contact_email)
        try {
          const email = msg.prospect_epost.toLowerCase();
          const existingThread = await queryOne(
            'SELECT id FROM conversation_threads WHERE contact_email = ? AND prospect_id = ?',
            [email, msg.prospect_id]
          );
          if (existingThread) {
            await runSql(`
              UPDATE conversation_threads SET
                message_count = message_count + 1,
                last_message_at = datetime('now'),
                updated_at = datetime('now')
              WHERE id = ?
            `, [existingThread.id]);
          } else {
            // Dubbelkolla att ingen annan tråd skapats under tiden (race condition)
            const doubleCheck = await queryOne('SELECT id FROM conversation_threads WHERE contact_email = ? AND prospect_id = ?', [email, msg.prospect_id]);
            if (!doubleCheck) {
              await runSql(`
                INSERT INTO conversation_threads (
                  prospect_id, contact_email, contact_name,
                  plattform, deal_stage,
                  last_message_at, message_count, unread_count
                ) VALUES (?, ?, ?, 'Sponsor', 'outreach', datetime('now'), 1, 0)
              `, [
                msg.prospect_id,
                email,
                msg.prospect_namn || '',
              ]);
            }
          }
        } catch (threadErr) {
          console.error('[Sponsor] Thread create error:', threadErr.message);
        }

        results.push({ id: msgId, status: 'skickat', prospect_namn: msg.prospect_namn, prospect_epost: msg.prospect_epost });
        console.log(`[Sponsor] ✓ Utskick skickat till ${msg.prospect_namn} (${msg.prospect_epost})`);

      } catch (sendErr) {
        console.error(`[Sponsor] ✗ Misslyckades för ${msg.prospect_namn}: ${sendErr.message}`);
        await runSql("UPDATE sponsor_outreach SET status = 'misslyckat' WHERE id = ?", [msgId]);
        results.push({ id: msgId, status: 'misslyckat', error: sendErr.message });
      }
    }

    res.json(results);
  } catch (error) {
    console.error('[Sponsor] Send error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DIREKT-SÖK: Sök företag/sponsor direkt
// ============================================================
router.post('/search-direct', async (req, res) => {
  try {
    const { query, foretagId } = req.body;
    if (!query || !foretagId) return res.status(400).json({ error: 'query och foretagId krävs' });

    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
    if (!foretag) return res.status(404).json({ error: 'Företag hittades inte' });

    console.log(`[Sponsor Search] Direkt-sök: "${query}" för ${foretag.namn}`);
    const results = [];

    // 1. Sök via Google Maps (Apify primär, SerpAPI fallback)
    try {
      const mapsResults = await searchGoogleMaps(query + ' Sverige');
      for (const place of mapsResults.slice(0, 10)) {
        results.push({
          id: `gm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          namn: place.namn || '',
          kontaktperson: '',
          epost: '',
          bransch: place.typ || '',
          hemsida: place.hemsida || '',
          telefon: place.telefon || '',
          betyg: place.betyg ? String(place.betyg) : null,
          kalla: 'google_maps',
          vald: 0,
        });
      }
      console.log(`[Sponsor Search] Google Maps: ${mapsResults.length} resultat`);
    } catch (gmErr) {
      console.warn(`[Sponsor Search] Google Maps misslyckades: ${gmErr.message}`);
    }

    // 2. Om inga Google Maps-resultat, använd AI
    if (results.length === 0) {
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
          const client = new Anthropic({ apiKey });
          const aiResp = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: `Sök efter svenska företag som matchar: "${query}"
Kontext: Jag söker potentiella sponsorer/partners åt ${foretag.namn} (${foretag.bransch || ''}).
Returnera en JSON-array med max 10 företag du är SÄKER finns.
Format: [{"namn": "...", "bransch": "...", "hemsida": "...", "epost": "info@...", "beskrivning": "kort"}]
Returnera BARA JSON-arrayen, inget annat.`
            }]
          });
          const text = aiResp.content[0]?.text || '[]';
          const match = text.match(/\[[\s\S]*\]/);
          if (match) {
            const aiCompanies = JSON.parse(match[0]);
            for (const c of aiCompanies) {
              results.push({
                id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                namn: c.namn,
                kontaktperson: c.kontaktperson || '',
                epost: c.epost || '',
                bransch: c.bransch || '',
                hemsida: c.hemsida || '',
                telefon: '',
                betyg: null,
                kalla: 'ai',
                vald: 0,
              });
            }
            console.log(`[Sponsor Search] AI: ${aiCompanies.length} resultat`);
          }
        }
      } catch (aiErr) {
        console.warn(`[Sponsor Search] AI-sökning misslyckades: ${aiErr.message}`);
      }
    }

    // 3. Spara i sponsor_prospects
    const saved = [];
    for (const r of results) {
      // Hoppa över resultat utan namn
      if (!r.namn || !r.namn.trim()) {
        console.warn('[Sponsor Search] Hoppar över resultat utan namn');
        continue;
      }
      try {
        // Kolla om redan finns
        const existing = await queryOne(
          'SELECT id FROM sponsor_prospects WHERE foretag_id = ? AND LOWER(namn) = ?',
          [foretagId, r.namn.toLowerCase().trim()]
        );
        if (existing) {
          saved.push({ ...r, id: existing.id });
          continue;
        }
        const { lastId } = await runSql(
          `INSERT INTO sponsor_prospects (foretag_id, namn, kontaktperson, epost, bransch, hemsida, telefon, betyg, kalla, vald)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [foretagId, r.namn, r.kontaktperson, r.epost, r.bransch, r.hemsida, r.telefon, r.betyg, r.kalla]
        );
        saved.push({ ...r, id: lastId });
      } catch (dbErr) {
        console.warn(`[Sponsor Search] Spara misslyckades för ${r.namn}: ${dbErr.message}`);
        saved.push(r);
      }
    }

    console.log(`[Sponsor Search] Totalt: ${saved.length} resultat sparade för "${query}"`);
    res.json(saved);
  } catch (error) {
    console.error('[Sponsor Search] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
