import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { generateOutreachMessage, generateFollowUp } from '../services/anthropic.js';
import { generateKontraktPdf, generateSponsorKontraktPdf } from '../services/pdf.js';
import { sendEmail } from '../services/email-service.js';

const router = Router();

router.get('/foretag/:foretagId', async (req, res) => {
  const fid = Number(req.params.foretagId);
  const influencerRows = await queryAll(`
    SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost, 'influencer' as outreach_typ
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    WHERE om.foretag_id = ?
  `, [fid]);
  const sponsorRows = await queryAll(`
    SELECT so.id, so.foretag_id, so.meddelande, so.amne, so.status, so.skickat_datum, so.created_at,
           sp.namn as influencer_namn, sp.hemsida as kanalnamn, 'Företag' as plattform, sp.epost as kontakt_epost, 'sponsor' as outreach_typ
    FROM sponsor_outreach so
    JOIN sponsor_prospects sp ON so.prospect_id = sp.id
    WHERE so.foretag_id = ?
  `, [fid]);
  const all = [...influencerRows, ...sponsorRows].sort((a, b) =>
    new Date(b.created_at) - new Date(a.created_at)
  );
  res.json(all);
});

router.get('/', async (req, res) => {
  try {
    const influencerRows = await queryAll(`
      SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost,
             f.namn as foretag_namn, 'influencer' as outreach_typ
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      JOIN foretag f ON om.foretag_id = f.id
    `);
    const sponsorRows = await queryAll(`
      SELECT so.id, so.foretag_id, so.meddelande, so.amne, so.status, so.skickat_datum, so.created_at,
             sp.namn as influencer_namn, sp.hemsida as kanalnamn, 'Företag' as plattform, sp.epost as kontakt_epost,
             f.namn as foretag_namn, 'sponsor' as outreach_typ
      FROM sponsor_outreach so
      JOIN sponsor_prospects sp ON so.prospect_id = sp.id
      JOIN foretag f ON so.foretag_id = f.id
    `);
    const all = [...influencerRows, ...sponsorRows].sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );
    res.json(all);
  } catch (error) {
    console.error('Outreach GET / error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { foretagId, ab_test_id, ab_variant } = req.body;
    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
    if (!foretag) return res.status(404).json({ error: 'Företag hittades inte' });

    const selected = await queryAll('SELECT * FROM influencers WHERE foretag_id = ? AND vald = 1', [foretagId]);
    if (selected.length === 0) return res.status(400).json({ error: 'Inga influencers valda' });

    const messages = [];
    for (const inf of selected) {
      const raw = await generateOutreachMessage(inf, foretag);

      let amne = `Samarbete med ${foretag.namn}`;
      let meddelande = raw;

      const parts = raw.split('---');
      if (parts.length >= 2) {
        const amneLine = parts[0].trim();
        amne = amneLine.replace(/^ÄMNE:\s*/i, '').trim();
        meddelande = parts.slice(1).join('---').trim();
      }

      const { lastId } = await runSql(`
        INSERT INTO outreach_meddelanden (influencer_id, foretag_id, meddelande, amne, typ, status, ab_test_id, ab_variant)
        VALUES (?, ?, ?, ?, 'initial', 'utkast', ?, ?)
      `, [inf.id, foretagId, meddelande, amne, ab_test_id || null, ab_variant || null]);

      const msg = await queryOne(`
        SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost
        FROM outreach_meddelanden om
        JOIN influencers i ON om.influencer_id = i.id
        WHERE om.id = ?
      `, [lastId]);

      messages.push(msg);
    }

    res.json(messages);
  } catch (error) {
    console.error('Generate outreach error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  const { meddelande, amne, status } = req.body;
  const sets = [];
  const vals = [];
  if (meddelande !== undefined) { sets.push('meddelande = ?'); vals.push(meddelande); }
  if (amne !== undefined) { sets.push('amne = ?'); vals.push(amne); }
  if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
  if (sets.length === 0) return res.status(400).json({ error: 'Inget att uppdatera' });

  vals.push(Number(req.params.id));
  await runSql(`UPDATE outreach_meddelanden SET ${sets.join(', ')} WHERE id = ?`, vals);

  const msg = await queryOne(`
    SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    WHERE om.id = ?
  `, [Number(req.params.id)]);
  res.json(msg);
});

router.delete('/:id', async (req, res) => {
  await runSql('DELETE FROM outreach_meddelanden WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// Generera kontrakt-PDF — accepterar data direkt ELLER via DB-lookup
router.post('/generate-kontrakt', async (req, res) => {
  try {
    const { kontaktperson, influencer, foretag: foretagData, kontraktVillkor } = req.body;
    const isSponsor = kontraktVillkor?.typ === 'sponsor';
    console.log(`[Kontrakt] Genererar ${isSponsor ? 'sponsoravtal' : 'kontrakt'} för ${influencer?.namn}, kontaktperson: ${kontaktperson}`);

    if (!influencer?.namn || !foretagData?.namn) {
      return res.status(400).json({ error: 'influencer/sponsor och foretag krävs' });
    }

    // Hämta inloggad e-post (Gmail/Microsoft) — används i kontraktet istället för manuellt angiven
    try {
      const { getActiveProvider } = await import('../services/email-service.js');
      const activeProvider = await getActiveProvider();
      if (activeProvider?.email) {
        foretagData.epost = activeProvider.email;
      }
    } catch (authErr) {
      console.log('[Kontrakt] Kunde inte hämta auth-email:', authErr.message);
    }

    let pdfBuffer;
    if (isSponsor) {
      pdfBuffer = await generateSponsorKontraktPdf({
        foretag: foretagData,
        sponsor: {
          namn: influencer.namn || 'Okänd',
          bransch: influencer.bransch || null,
          kontakt_epost: influencer.kontakt_epost || null,
          hemsida: influencer.hemsida || influencer.kanalnamn || null,
          telefon: influencer.telefon || null,
        },
        kontaktperson: kontaktperson || foretagData.kontaktperson || foretagData.namn,
        datum: new Date().toISOString().split('T')[0],
        kontraktVillkor: kontraktVillkor || null,
      });
    } else {
      pdfBuffer = await generateKontraktPdf({
        foretag: foretagData,
        influencer: {
          namn: influencer.namn || 'Okänd',
          kanalnamn: influencer.kanalnamn || 'Okänd',
          plattform: influencer.plattform || 'youtube',
          referral_kod: influencer.referral_kod || null,
          kontakt_epost: influencer.kontakt_epost || null,
        },
        kontaktperson: kontaktperson || foretagData.kontaktperson || foretagData.namn,
        datum: new Date().toISOString().split('T')[0],
        kontraktVillkor: kontraktVillkor || null,
      });
    }

    console.log(`[Kontrakt] PDF genererad, storlek: ${pdfBuffer.length} bytes`);

    // Försök spara till DB om vi har IDs (men krascha inte om det misslyckas)
    try {
      if (influencer.id && foretagData.id) {
        await runSql(`INSERT INTO kontrakt (influencer_id, foretag_id, kontaktperson, status) VALUES (?, ?, ?, 'genererat')`,
          [influencer.id, foretagData.id, kontaktperson || foretagData.kontaktperson]);
      }
    } catch (dbErr) {
      console.log('[Kontrakt] DB-sparning misslyckades (ej kritiskt):', dbErr.message);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('[Kontrakt] ERROR:', error.message);
    console.error('[Kontrakt] Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

// Legacy: Generera kontrakt via meddelande-ID (DB-lookup)
router.post('/:id/kontrakt', async (req, res) => {
  try {
    const { kontaktperson } = req.body;
    console.log(`[Kontrakt] Genererar kontrakt för meddelande ${req.params.id}, kontaktperson: ${kontaktperson}`);
    const msg = await queryOne(`
      SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.referral_kod, i.kontakt_epost
      FROM outreach_meddelanden om
      LEFT JOIN influencers i ON om.influencer_id = i.id
      WHERE om.id = ?
    `, [Number(req.params.id)]);

    if (!msg) {
      console.error(`[Kontrakt] Meddelande ${req.params.id} hittades inte i DB`);
      return res.status(404).json({ error: 'Meddelande hittades inte' });
    }
    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [msg.foretag_id]);

    let kontraktVillkor = null;
    try {
      if (foretag?.company_profile) {
        const profile = JSON.parse(foretag.company_profile);
        kontraktVillkor = profile.kontrakt_brief || profile.kontraktBrief || null;
      }
    } catch {}

    const pdfBuffer = await generateKontraktPdf({
      foretag: foretag || { namn: 'Okänt', epost: '' },
      influencer: { namn: msg.influencer_namn || 'Okänd', kanalnamn: msg.kanalnamn || 'Okänd', plattform: msg.plattform || 'youtube', referral_kod: msg.referral_kod, kontakt_epost: msg.kontakt_epost },
      kontaktperson: kontaktperson || foretag?.kontaktperson || foretag?.namn,
      datum: new Date().toISOString().split('T')[0],
      kontraktVillkor,
    });

    console.log(`[Kontrakt] PDF genererad, storlek: ${pdfBuffer.length} bytes`);
    try {
      await runSql(`INSERT INTO kontrakt (influencer_id, foretag_id, outreach_id, kontaktperson, status) VALUES (?, ?, ?, ?, 'genererat')`,
        [msg.influencer_id, msg.foretag_id, msg.id, kontaktperson || foretag?.kontaktperson]);
      await runSql('UPDATE outreach_meddelanden SET kontrakt_bifogat = 1 WHERE id = ?', [Number(req.params.id)]);
    } catch (dbErr) {
      console.log('[Kontrakt] DB-uppdatering misslyckades:', dbErr.message);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('[Kontrakt] ERROR:', error.message);
    console.error('[Kontrakt] Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

// Diagnostik — lista alla meddelanden
router.get('/debug-messages', async (req, res) => {
  const msgs = await queryAll('SELECT om.id, om.influencer_id, om.foretag_id, om.amne, om.status FROM outreach_meddelanden om ORDER BY om.id DESC LIMIT 20');
  const influencers = await queryAll('SELECT id, namn, kanalnamn, foretag_id FROM influencers ORDER BY id DESC LIMIT 20');
  res.json({ messages: msgs, influencers });
});

// Diagnostik-endpoint — testa kontraktgenerering
router.get('/test-kontrakt/:id', async (req, res) => {
  const steps = [];
  try {
    steps.push('1. Start');
    const msg = await queryOne(`
      SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform
      FROM outreach_meddelanden om
      LEFT JOIN influencers i ON om.influencer_id = i.id
      WHERE om.id = ?
    `, [Number(req.params.id)]);
    steps.push(msg ? `2. Meddelande hittat: ${msg.influencer_namn}` : '2. FAIL: Meddelande hittades inte');
    if (!msg) return res.json({ steps });

    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [msg.foretag_id]);
    steps.push(foretag ? `3. Företag hittat: ${foretag.namn}` : '3. FAIL: Företag hittades inte');

    steps.push('4. Testar PDF-import...');
    const { generateKontraktPdf } = await import('../services/pdf.js');
    steps.push('5. PDF-import OK');

    const buf = await generateKontraktPdf({
      foretag: foretag || { namn: 'Test', epost: 'test@test.se' },
      influencer: { namn: msg.influencer_namn || 'Test', kanalnamn: msg.kanalnamn || '@test', plattform: msg.plattform || 'youtube' },
      kontaktperson: 'Test',
      datum: '2026-04-09',
      kontraktVillkor: { ersattning_per_video: 1000, max_videos: 1 },
    });
    steps.push(`6. PDF genererad OK: ${buf.length} bytes`);
    res.json({ success: true, steps });
  } catch (e) {
    steps.push(`ERROR: ${e.message}`);
    steps.push(`Stack: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`);
    res.json({ success: false, steps });
  }
});

router.post('/send', async (req, res) => {
  try {
    const { messageIds, messages: incomingMessages, attachContracts, kontaktperson, kontraktVillkor: incomingKontraktVillkor, foretag: incomingForetag } = req.body;
    const results = [];

    // Bygg en lista med meddelanden att skicka
    let toSend = [];

    if (incomingMessages && incomingMessages.length > 0) {
      // Frontend skickar fullständiga meddelande-objekt
      for (const m of incomingMessages) {
        // Kolla om meddelandet redan finns i DB (har riktigt numeriskt id)
        if (m.id && typeof m.id === 'number') {
          const existing = await queryOne(`
            SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost, i.referral_kod
            FROM outreach_meddelanden om
            JOIN influencers i ON om.influencer_id = i.id
            WHERE om.id = ?
          `, [m.id]);
          if (existing) {
            // Använd frontend-eposten om den ändrats
            if (m.kontakt_epost && m.kontakt_epost !== existing.kontakt_epost) {
              existing.kontakt_epost = m.kontakt_epost;
              existing._overridden_email = true;
            }
            toSend.push(existing);
            continue;
          }
        }

        // Nytt meddelande — spara i DB
        let influencerId = m.influencer_id;
        if (typeof influencerId === 'string' && influencerId.startsWith('ai-')) {
          const existing = await queryOne('SELECT id FROM influencers WHERE kanalnamn = ? AND plattform = ?', [m.kanalnamn, m.plattform]);
          if (existing) {
            influencerId = existing.id;
          } else {
            const { lastId } = await runSql(
              `INSERT INTO influencers (namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, referral_kod, datakalla)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'ai_web_search')`,
              [m.influencer_namn, m.kanalnamn, m.plattform, m.foljare || 0, m.nisch || '', m.kontakt_epost || null, m.referral_kod || null]
            );
            influencerId = lastId;
          }
        }

        let foretagId = m.foretag_id;
        if (!foretagId && incomingForetag?.id) foretagId = incomingForetag.id;

        const { lastId: msgId } = await runSql(
          `INSERT INTO outreach_meddelanden (influencer_id, foretag_id, meddelande, amne, typ, status)
           VALUES (?, ?, ?, ?, 'initial', 'utkast')`,
          [influencerId, foretagId, m.meddelande || m.message, m.amne || m.subject || 'Samarbetsförfrågan']
        );

        const msg = await queryOne(`
          SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost, i.referral_kod
          FROM outreach_meddelanden om
          JOIN influencers i ON om.influencer_id = i.id
          WHERE om.id = ?
        `, [msgId]);

        // Använd frontend-eposten
        if (msg && m.kontakt_epost) {
          msg.kontakt_epost = m.kontakt_epost;
          msg._overridden_email = true;
        }

        if (msg) toSend.push(msg);
      }
    } else if (messageIds && messageIds.length > 0) {
      // Klassiskt flöde — hämta meddelanden från DB via ID
      for (const msgId of messageIds) {
        const msg = await queryOne(`
          SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost, i.referral_kod
          FROM outreach_meddelanden om
          JOIN influencers i ON om.influencer_id = i.id
          WHERE om.id = ?
        `, [msgId]);
        if (msg) toSend.push(msg);
      }
    }

    for (const msg of toSend) {
      if (!msg.kontakt_epost) {
        results.push({ id: msg.id, status: 'misslyckat', error: 'Ingen e-post tillgänglig' });
        await runSql("UPDATE outreach_meddelanden SET status = 'misslyckat' WHERE id = ?", [msg.id]);
        continue;
      }

      try {
        let attachmentBuffer = null;
        let attachmentName = null;

        if (attachContracts) {
          const foretag = incomingForetag || await queryOne('SELECT * FROM foretag WHERE id = ?', [msg.foretag_id]);

          // Hämta kontraktvillkor
          let kontraktVillkor = incomingKontraktVillkor || null;
          if (!kontraktVillkor) {
            try {
              if (foretag.company_profile) {
                const profile = JSON.parse(foretag.company_profile);
                kontraktVillkor = profile.kontrakt_brief || profile.kontraktBrief || null;
              }
            } catch {}
          }

          attachmentBuffer = await generateKontraktPdf({
            foretag,
            influencer: { namn: msg.influencer_namn, kanalnamn: msg.kanalnamn, plattform: msg.plattform, referral_kod: msg.referral_kod, kontakt_epost: msg.kontakt_epost },
            kontaktperson: kontaktperson || foretag.kontaktperson,
            datum: new Date().toISOString().split('T')[0],
            kontraktVillkor,
          });
          attachmentName = `kontrakt_${msg.influencer_namn.replace(/\s/g, '_')}.pdf`;
          await runSql('UPDATE outreach_meddelanden SET kontrakt_bifogat = 1 WHERE id = ?', [msg.id]);
        }

        await sendEmail({ to: msg.kontakt_epost, subject: msg.amne, body: msg.meddelande, attachmentBuffer, attachmentName });
        await runSql("UPDATE outreach_meddelanden SET status = 'skickat', skickat_datum = datetime('now') WHERE id = ?", [msg.id]);

        // Om kontrakt bifogades, uppdatera/skapa kontrakt-post
        if (attachContracts) {
          // Försök uppdatera befintligt kontrakt (kan ha skapats utan outreach_id vid PDF-preview)
          await runSql("UPDATE kontrakt SET status = 'skickat', outreach_id = ? WHERE influencer_id = ? AND foretag_id = ? AND status = 'genererat'",
            [msg.id, msg.influencer_id, msg.foretag_id]);
          // Kolla om det nu finns ett kontrakt kopplat till detta utskick
          const existing = await queryOne('SELECT id FROM kontrakt WHERE influencer_id = ? AND foretag_id = ?', [msg.influencer_id, msg.foretag_id]);
          if (!existing) {
            await runSql(`INSERT INTO kontrakt (influencer_id, foretag_id, outreach_id, kontaktperson, status)
              VALUES (?, ?, ?, ?, 'skickat')`,
              [msg.influencer_id, msg.foretag_id, msg.id, kontaktperson || '']);
          }
        }

        results.push({ id: msg.id, status: 'skickat', influencer_namn: msg.influencer_namn, kontakt_epost: msg.kontakt_epost });
        console.log(`[Outreach] ✓ Utskick skickat till ${msg.influencer_namn} (${msg.kontakt_epost})`);

        // Skapa/uppdatera konversationstråd — EN per influencer (dedupe på contact_email)
        try {
          const email = msg.kontakt_epost.toLowerCase();
          const existingThread = await queryOne(
            'SELECT id FROM conversation_threads WHERE contact_email = ?',
            [email]
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
            const doubleCheck = await queryOne('SELECT id FROM conversation_threads WHERE contact_email = ?', [email]);
            if (!doubleCheck) {
              await runSql(`
                INSERT INTO conversation_threads (
                  influencer_id, contact_email, contact_name,
                  plattform, kanalnamn, deal_stage,
                  last_message_at, message_count, unread_count
                ) VALUES (?, ?, ?, ?, ?, 'outreach', datetime('now'), 1, 0)
              `, [
                msg.influencer_id,
                email,
                msg.influencer_namn || '',
                msg.plattform || null,
                msg.kanalnamn || null,
              ]);
            }
          }
        } catch (threadErr) {
          console.error('[Outreach] Thread create error:', threadErr.message);
        }

      } catch (sendErr) {
        console.error(`Send error for ${msg.id}:`, sendErr);
        await runSql("UPDATE outreach_meddelanden SET status = 'misslyckat' WHERE id = ?", [msg.id]);
        results.push({ id: msg.id, status: 'misslyckat', error: sendErr.message });
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Send outreach error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/followup', async (req, res) => {
  try {
    const msg = await queryOne(`
      SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE om.id = ?
    `, [Number(req.params.id)]);

    if (!msg) return res.status(404).json({ error: 'Meddelande hittades inte' });

    // Bestäm vilket steg vi är på
    const currentStep = msg.followup_step || 0;
    const nextStep = currentStep + 1;

    const followUpText = await generateFollowUp(
      { namn: msg.influencer_namn, kanalnamn: msg.kanalnamn, plattform: msg.plattform },
      msg.meddelande,
      Math.min(nextStep, 3)
    );

    const { lastId } = await runSql(`
      INSERT INTO uppfoljningar (outreach_id, influencer_id, meddelande, status)
      VALUES (?, ?, ?, 'vaentar')
    `, [msg.id, msg.influencer_id, followUpText]);

    // Uppdatera steg-tracking
    await runSql('UPDATE outreach_meddelanden SET followup_step = ?, last_followup_at = datetime(\'now\') WHERE id = ?', [nextStep, msg.id]);

    const followUp = await queryOne('SELECT * FROM uppfoljningar WHERE id = ?', [lastId]);
    res.json({ ...followUp, influencer_namn: msg.influencer_namn, step: nextStep });
  } catch (error) {
    console.error('Follow-up error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
