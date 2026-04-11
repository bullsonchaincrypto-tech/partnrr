import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { generateOutreachMessage, generateFollowUp } from '../services/anthropic.js';
import { generateKontraktPdf } from '../services/pdf.js';
import { sendEmail } from '../services/gmail.js';

const router = Router();

router.get('/foretag/:foretagId', (req, res) => {
  const rows = queryAll(`
    SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    WHERE om.foretag_id = ?
    ORDER BY om.created_at DESC
  `, [Number(req.params.foretagId)]);
  res.json(rows);
});

router.get('/', (req, res) => {
  const rows = queryAll(`
    SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost,
           f.namn as foretag_namn
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    JOIN foretag f ON om.foretag_id = f.id
    ORDER BY om.created_at DESC
  `);
  res.json(rows);
});

router.post('/generate', async (req, res) => {
  try {
    const { foretagId } = req.body;
    const foretag = queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
    if (!foretag) return res.status(404).json({ error: 'Företag hittades inte' });

    const selected = queryAll('SELECT * FROM influencers WHERE foretag_id = ? AND vald = 1', [foretagId]);
    if (selected.length === 0) return res.status(400).json({ error: 'Inga influencers valda' });

    const messages = [];
    for (const inf of selected) {
      const raw = await generateOutreachMessage(inf, foretag);

      let amne = 'Samarbete med RankLeague';
      let meddelande = raw;

      const parts = raw.split('---');
      if (parts.length >= 2) {
        const amneLine = parts[0].trim();
        amne = amneLine.replace(/^ÄMNE:\s*/i, '').trim();
        meddelande = parts.slice(1).join('---').trim();
      }

      const { lastId } = runSql(`
        INSERT INTO outreach_meddelanden (influencer_id, foretag_id, meddelande, amne, typ, status)
        VALUES (?, ?, ?, ?, 'initial', 'utkast')
      `, [inf.id, foretagId, meddelande, amne]);

      const msg = queryOne(`
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

router.put('/:id', (req, res) => {
  const { meddelande, amne, status } = req.body;
  const sets = [];
  const vals = [];
  if (meddelande !== undefined) { sets.push('meddelande = ?'); vals.push(meddelande); }
  if (amne !== undefined) { sets.push('amne = ?'); vals.push(amne); }
  if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
  if (sets.length === 0) return res.status(400).json({ error: 'Inget att uppdatera' });

  vals.push(Number(req.params.id));
  runSql(`UPDATE outreach_meddelanden SET ${sets.join(', ')} WHERE id = ?`, vals);

  const msg = queryOne(`
    SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    WHERE om.id = ?
  `, [Number(req.params.id)]);
  res.json(msg);
});

router.delete('/:id', (req, res) => {
  runSql('DELETE FROM outreach_meddelanden WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

router.post('/:id/kontrakt', async (req, res) => {
  try {
    const { kontaktperson } = req.body;
    const msg = queryOne(`
      SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.referral_kod, i.kontakt_epost
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE om.id = ?
    `, [Number(req.params.id)]);

    if (!msg) return res.status(404).json({ error: 'Meddelande hittades inte' });
    const foretag = queryOne('SELECT * FROM foretag WHERE id = ?', [msg.foretag_id]);

    const pdfBuffer = await generateKontraktPdf({
      foretag,
      influencer: { namn: msg.influencer_namn, kanalnamn: msg.kanalnamn, plattform: msg.plattform, referral_kod: msg.referral_kod, kontakt_epost: msg.kontakt_epost },
      kontaktperson: kontaktperson || foretag.kontaktperson,
      datum: new Date().toISOString().split('T')[0],
    });

    runSql(`INSERT INTO kontrakt (influencer_id, foretag_id, outreach_id, kontaktperson, status) VALUES (?, ?, ?, ?, 'genererat')`,
      [msg.influencer_id, msg.foretag_id, msg.id, kontaktperson || foretag.kontaktperson]);
    runSql('UPDATE outreach_meddelanden SET kontrakt_bifogat = 1 WHERE id = ?', [Number(req.params.id)]);

    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Generate contract error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/send', async (req, res) => {
  try {
    const { messageIds, attachContracts, kontaktperson } = req.body;
    const results = [];

    for (const msgId of messageIds) {
      const msg = queryOne(`
        SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost, i.referral_kod
        FROM outreach_meddelanden om
        JOIN influencers i ON om.influencer_id = i.id
        WHERE om.id = ?
      `, [msgId]);

      if (!msg || !msg.kontakt_epost) {
        results.push({ id: msgId, status: 'misslyckat', error: 'Ingen e-post tillgänglig' });
        runSql("UPDATE outreach_meddelanden SET status = 'misslyckat' WHERE id = ?", [msgId]);
        continue;
      }

      try {
        let attachmentBuffer = null;
        let attachmentName = null;

        if (attachContracts) {
          const foretag = queryOne('SELECT * FROM foretag WHERE id = ?', [msg.foretag_id]);
          attachmentBuffer = await generateKontraktPdf({
            foretag,
            influencer: { namn: msg.influencer_namn, kanalnamn: msg.kanalnamn, plattform: msg.plattform, referral_kod: msg.referral_kod, kontakt_epost: msg.kontakt_epost },
            kontaktperson: kontaktperson || foretag.kontaktperson,
            datum: new Date().toISOString().split('T')[0],
          });
          attachmentName = `kontrakt_${msg.influencer_namn.replace(/\s/g, '_')}.pdf`;
          runSql('UPDATE outreach_meddelanden SET kontrakt_bifogat = 1 WHERE id = ?', [msgId]);
        }

        await sendEmail({ to: msg.kontakt_epost, subject: msg.amne, body: msg.meddelande, attachmentBuffer, attachmentName });
        runSql("UPDATE outreach_meddelanden SET status = 'skickat', skickat_datum = datetime('now') WHERE id = ?", [msgId]);
        results.push({ id: msgId, status: 'skickat' });
      } catch (sendErr) {
        console.error(`Send error for ${msgId}:`, sendErr);
        runSql("UPDATE outreach_meddelanden SET status = 'misslyckat' WHERE id = ?", [msgId]);
        results.push({ id: msgId, status: 'misslyckat', error: sendErr.message });
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
    const msg = queryOne(`
      SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE om.id = ?
    `, [Number(req.params.id)]);

    if (!msg) return res.status(404).json({ error: 'Meddelande hittades inte' });

    const followUpText = await generateFollowUp(
      { namn: msg.influencer_namn, kanalnamn: msg.kanalnamn, plattform: msg.plattform },
      msg.meddelande
    );

    const { lastId } = runSql(`
      INSERT INTO uppfoljningar (outreach_id, influencer_id, meddelande, status)
      VALUES (?, ?, ?, 'vaentar')
    `, [msg.id, msg.influencer_id, followUpText]);

    const followUp = queryOne('SELECT * FROM uppfoljningar WHERE id = ?', [lastId]);
    res.json({ ...followUp, influencer_namn: msg.influencer_namn });
  } catch (error) {
    console.error('Follow-up error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
