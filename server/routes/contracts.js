import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { generateContractPdf } from '../services/generate-contract-pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

// ============================================================
// KONTRAKT-ÖVERSIKT
// ============================================================

// GET /api/contracts/overview — samlad avtals-statistik
router.get('/overview', async (req, res) => {
  try {
    const total = (await queryOne('SELECT COUNT(*) as count FROM kontrakt'))?.count || 0;
    const byStatus = await queryAll(`
      SELECT status, COUNT(*) as count FROM kontrakt GROUP BY status
    `);

    const statusMap = byStatus.reduce((acc, r) => { acc[r.status] = r.count; return acc; }, {});

    // Avtal som löper ut inom 7 dagar
    const now = new Date().toISOString();
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const expiringSoon = await queryAll(`
      SELECT k.*,
        COALESCE(i.namn, sp.namn) as influencer_namn,
        COALESCE(i.kanalnamn, '') as kanalnamn,
        f.namn as foretag_namn
      FROM kontrakt k
      LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
      LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.status = 'aktivt'
        AND k.expires_at IS NOT NULL
        AND k.expires_at <= ?
        AND k.expires_at > ?
        AND (i.id IS NOT NULL OR sp.id IS NOT NULL)
    `, [sevenDaysFromNow, now]);

    // Redan utgångna
    const expired = await queryAll(`
      SELECT k.*,
        COALESCE(i.namn, sp.namn) as influencer_namn,
        COALESCE(i.kanalnamn, '') as kanalnamn,
        f.namn as foretag_namn
      FROM kontrakt k
      LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
      LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.status = 'aktivt'
        AND k.expires_at IS NOT NULL
        AND k.expires_at <= ?
        AND (i.id IS NOT NULL OR sp.id IS NOT NULL)
    `, [now]);

    // Total ekonomi
    const ekonomi = await queryOne(`
      SELECT
        SUM(videos_delivered * 300) as video_kostnad,
        SUM(total_signups * 10) as signup_kostnad,
        SUM(total_payout_sek) as total_utbetalt,
        SUM(videos_delivered) as total_videos,
        SUM(total_signups) as total_signups
      FROM kontrakt WHERE status IN ('aktivt', 'signerat', 'utgånget')
    `);

    res.json({
      total,
      by_status: statusMap,
      expiring_soon: expiringSoon,
      expired_contracts: expired,
      ekonomi: {
        video_kostnad: ekonomi?.video_kostnad || 0,
        signup_kostnad: ekonomi?.signup_kostnad || 0,
        total_utbetalt: ekonomi?.total_utbetalt || 0,
        total_videos: ekonomi?.total_videos || 0,
        total_signups: ekonomi?.total_signups || 0,
        total_kostnad: (ekonomi?.video_kostnad || 0) + (ekonomi?.signup_kostnad || 0),
      }
    });
  } catch (error) {
    console.error('[Contracts] Overview error:', error);
    res.status(500).json({ error: error.message });
  }
});


// GET /api/contracts — lista alla kontrakt (influencer + sponsor)
router.get('/', async (req, res) => {
  try {
    const { status, foretag_id, influencer_id } = req.query;
    let sql = `
      SELECT k.*,
        COALESCE(i.namn, sp.namn) as influencer_namn,
        COALESCE(i.kanalnamn, '') as kanalnamn,
        COALESCE(i.kontakt_epost, sp.epost) as kontakt_epost,
        COALESCE(i.referral_kod, '') as referral_kod,
        CASE WHEN sp.id IS NOT NULL THEN 'sponsor' ELSE 'influencer' END as contract_type,
        f.namn as foretag_namn, f.epost as foretag_epost
      FROM kontrakt k
      LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
      LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
      JOIN foretag f ON k.foretag_id = f.id
      WHERE (i.id IS NOT NULL OR sp.id IS NOT NULL)
    `;
    const params = [];

    if (status) {
      sql += ' AND k.status = ?';
      params.push(status);
    }
    if (foretag_id) {
      sql += ' AND k.foretag_id = ?';
      params.push(Number(foretag_id));
    }
    if (influencer_id) {
      sql += ' AND k.influencer_id = ?';
      params.push(Number(influencer_id));
    }

    sql += ' ORDER BY k.created_at DESC';
    res.json(await queryAll(sql, params));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// GET /api/contracts/:id — ett specifikt kontrakt (influencer + sponsor)
router.get('/:id', async (req, res) => {
  try {
    const k = await queryOne(`
      SELECT k.*,
        COALESCE(i.namn, sp.namn) as influencer_namn,
        COALESCE(i.kanalnamn, '') as kanalnamn,
        COALESCE(i.kontakt_epost, sp.epost) as kontakt_epost,
        COALESCE(i.referral_kod, '') as referral_kod,
        CASE WHEN sp.id IS NOT NULL THEN 'sponsor' ELSE 'influencer' END as contract_type,
        f.namn as foretag_namn, f.epost as foretag_epost, f.kontaktperson as foretag_kontaktperson
      FROM kontrakt k
      LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
      LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.id = ? AND (i.id IS NOT NULL OR sp.id IS NOT NULL)
    `, [Number(req.params.id)]);

    if (!k) return res.status(404).json({ error: 'Kontrakt hittades inte' });
    res.json(k);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// GET /api/contracts/:id/pdf — generera och ladda ner kontrakt-PDF (influencer + sponsor)
router.get('/:id/pdf', async (req, res) => {
  try {
    const k = await queryOne(`
      SELECT k.*,
        COALESCE(i.namn, sp.namn) as influencer_namn,
        COALESCE(i.kanalnamn, '') as kanalnamn,
        COALESCE(i.kontakt_epost, sp.epost) as kontakt_epost,
        COALESCE(i.referral_kod, '') as referral_kod,
        COALESCE(i.plattform, 'Sponsor') as plattform,
        f.namn as foretag_namn, f.epost as foretag_epost, f.kontaktperson as foretag_kontaktperson
      FROM kontrakt k
      LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
      LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.id = ? AND (i.id IS NOT NULL OR sp.id IS NOT NULL)
    `, [Number(req.params.id)]);

    if (!k) return res.status(404).json({ error: 'Kontrakt hittades inte' });

    // Skapa temp-katalog för PDF
    const tmpDir = path.join(__dirname, '..', 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const filename = `kontrakt-${k.id}-${k.influencer_namn.replace(/\s+/g, '-').toLowerCase()}.pdf`;
    const outputPath = path.join(tmpDir, filename);

    // Generera PDF med Node.js (inget Python behövs)
    await generateContractPdf({
      foretag_namn: k.foretag_namn,
      kontaktperson: k.foretag_kontaktperson || k.kontaktperson,
      foretag_epost: k.foretag_epost,
      influencer_namn: k.influencer_namn,
      influencer_epost: k.kontakt_epost || '',
      kanalnamn: k.kanalnamn,
      plattform: k.plattform || 'YouTube',
      referral_kod: k.referral_kod || '',
      per_video_sek: 300,
      per_signup_sek: 10,
      videos_required: k.videos_required || 5,
      avtalstid_dagar: 30,
      datum: k.signed_at ? k.signed_at.split('T')[0] : new Date().toISOString().split('T')[0],
      expires_at: k.expires_at || null,
    }, outputPath);

    // Skicka PDF som nedladdning
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const pdfBuffer = fs.readFileSync(outputPath);
    res.send(pdfBuffer);

    // Rensa temp-fil
    setTimeout(() => {
      try { fs.unlinkSync(outputPath); } catch (e) {}
    }, 5000);

  } catch (error) {
    console.error('[Contracts] PDF generation error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// STATUS-UPPDATERINGAR (livscykel)
// ============================================================

// PUT /api/contracts/:id/status — ändra status
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['genererat', 'skickat', 'signerat', 'aktivt', 'utgånget', 'avslutat', 'avböjt'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Ogiltig status. Giltiga: ${validStatuses.join(', ')}` });
    }

    const k = await queryOne('SELECT * FROM kontrakt WHERE id = ?', [Number(req.params.id)]);
    if (!k) return res.status(404).json({ error: 'Kontrakt hittades inte' });

    const updates = ['status = ?'];
    const params = [status];

    // Auto-fyll datum baserat på status
    if (status === 'signerat' && !k.signed_at) {
      updates.push("signed_at = datetime('now')");
    }
    if (status === 'aktivt' && !k.activated_at) {
      updates.push("activated_at = datetime('now')");
      // Sätt utgångsdatum till 30 dagar från nu om inte redan satt
      if (!k.expires_at) {
        updates.push("expires_at = datetime('now', '+30 days')");
      }
    }

    params.push(Number(req.params.id));
    await runSql(`UPDATE kontrakt SET ${updates.join(', ')} WHERE id = ?`, params);

    // Uppdatera outreach-status
    if (k.outreach_id && (status === 'signerat' || status === 'aktivt')) {
      await runSql("UPDATE outreach_meddelanden SET status = 'avtal_signerat' WHERE id = ?", [k.outreach_id]);
    }

    res.json({ status: 'ok', new_status: status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// PUT /api/contracts/:id/economics — uppdatera ekonomi
router.put('/:id/economics', async (req, res) => {
  try {
    const { videos_delivered, total_signups, total_payout_sek, notes } = req.body;
    const updates = [];
    const params = [];

    if (videos_delivered !== undefined) { updates.push('videos_delivered = ?'); params.push(videos_delivered); }
    if (total_signups !== undefined) { updates.push('total_signups = ?'); params.push(total_signups); }
    if (total_payout_sek !== undefined) { updates.push('total_payout_sek = ?'); params.push(total_payout_sek); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

    if (updates.length === 0) return res.status(400).json({ error: 'Inga fält att uppdatera' });

    params.push(Number(req.params.id));
    await runSql(`UPDATE kontrakt SET ${updates.join(', ')} WHERE id = ?`, params);

    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// DELETE /api/contracts/:id — ta bort kontrakt (bara om status = genererat)
router.delete('/:id', async (req, res) => {
  try {
    const k = await queryOne('SELECT * FROM kontrakt WHERE id = ?', [Number(req.params.id)]);
    if (!k) return res.status(404).json({ error: 'Kontrakt hittades inte' });
    if (k.status !== 'genererat') {
      return res.status(400).json({ error: 'Kan bara ta bort kontrakt med status "genererat". Nuvarande status: ' + k.status });
    }
    await runSql('DELETE FROM kontrakt WHERE id = ?', [Number(req.params.id)]);
    // Återställ kontrakt_bifogat på outreach-meddelandet
    if (k.outreach_id) {
      await runSql('UPDATE outreach_meddelanden SET kontrakt_bifogat = 0 WHERE id = ?', [k.outreach_id]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// PUT /api/contracts/:id/expires — sätt/ändra utgångsdatum
router.put('/:id/expires', async (req, res) => {
  try {
    const { expires_at, days_from_now } = req.body;

    let expiryDate;
    if (expires_at) {
      expiryDate = expires_at;
    } else if (days_from_now) {
      expiryDate = new Date(Date.now() + days_from_now * 24 * 60 * 60 * 1000).toISOString();
    } else {
      return res.status(400).json({ error: 'Ange expires_at eller days_from_now' });
    }

    await runSql('UPDATE kontrakt SET expires_at = ? WHERE id = ?', [expiryDate, Number(req.params.id)]);
    res.json({ status: 'ok', expires_at: expiryDate });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// E-SIGNERING
// ============================================================

// POST /api/contracts/:id/send-for-signing — skicka kontrakt för signering (influencer + sponsor)
router.post('/:id/send-for-signing', async (req, res) => {
  try {
    const k = await queryOne(`
      SELECT k.*,
        COALESCE(i.namn, sp.namn) as influencer_namn,
        COALESCE(i.kontakt_epost, sp.epost) as kontakt_epost,
        COALESCE(i.kanalnamn, '') as kanalnamn,
        f.namn as foretag_namn, f.kontaktperson as foretag_kontaktperson
      FROM kontrakt k
      LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
      LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.id = ? AND (i.id IS NOT NULL OR sp.id IS NOT NULL)
    `, [Number(req.params.id)]);

    if (!k) return res.status(404).json({ error: 'Kontrakt hittades inte' });
    if (!k.kontakt_epost) return res.status(400).json({ error: 'Influencern har ingen e-postadress' });

    // Generera unik sign-token
    const signToken = crypto.randomBytes(16).toString('hex');

    // Uppdatera kontrakt
    await runSql(
      "UPDATE kontrakt SET status = 'skickat', sign_token = ?, sign_method = 'email_reply' WHERE id = ?",
      [signToken, k.id]
    );

    // Skicka signerings-e-post
    const { sendEmail } = await import('../services/email-service.js');

    const subject = `Samarbetsavtal — ${k.foretag_namn} x ${k.influencer_namn}`;
    const body = `Hej ${k.influencer_namn}!

Tack för att du vill samarbeta med ${k.foretag_namn} via RankLeague!

Bifogat hittar du ditt samarbetsavtal med följande villkor:
• Ersättning: 300 SEK per publicerad video
• Max antal videos: 5 st
• Provision: 10 SEK per signup via din unika referral-kod
• Varje video måste innehålla en tydlig call-to-action
• Avtalstid: 30 dagar från signering

FÖR ATT SIGNERA (välj ett alternativ):

1. Klicka på denna länk för att signera digitalt:
   ${process.env.CLIENT_URL || 'http://localhost:5173'}/signera/${signToken}

2. Eller svara på detta mail med texten "JAG ACCEPTERAR"

Din unika signeringskod: ${signToken.slice(0, 8).toUpperCase()}

Om du har frågor, svara gärna på detta mail.

Med vänliga hälsningar,
${k.foretag_kontaktperson || k.foretag_namn}`;

    await sendEmail({
      to: k.kontakt_epost,
      subject,
      body,
    });

    res.json({ status: 'sent', to: k.kontakt_epost, sign_token: signToken.slice(0, 8) });
  } catch (error) {
    console.error('[Contracts] Send for signing error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// PÅMINNELSER & AUTO-HANTERING (för OpenClaw)
// ============================================================

// GET /api/contracts/reminders/due — kontrakt som behöver påminnelse (influencer + sponsor)
router.get('/reminders/due', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Kontrakt som löper ut inom 7 dagar — inte redan påminda
    const expiringSoon = await queryAll(`
      SELECT k.*,
        COALESCE(i.namn, sp.namn) as influencer_namn,
        COALESCE(i.kontakt_epost, sp.epost) as kontakt_epost,
        COALESCE(i.kanalnamn, '') as kanalnamn,
        f.namn as foretag_namn, f.kontaktperson as foretag_kontaktperson
      FROM kontrakt k
      LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
      LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.status = 'aktivt'
        AND k.expires_at IS NOT NULL
        AND k.expires_at <= ?
        AND k.expires_at > ?
        AND k.expiry_reminder_sent = 0
        AND (i.id IS NOT NULL OR sp.id IS NOT NULL)
    `, [sevenDaysFromNow, now]);

    // Kontrakt som redan utgått — inte redan notifierade
    const expired = await queryAll(`
      SELECT k.*,
        COALESCE(i.namn, sp.namn) as influencer_namn,
        COALESCE(i.kontakt_epost, sp.epost) as kontakt_epost,
        COALESCE(i.kanalnamn, '') as kanalnamn,
        f.namn as foretag_namn, f.kontaktperson as foretag_kontaktperson
      FROM kontrakt k
      LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
      LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.status = 'aktivt'
        AND k.expires_at IS NOT NULL
        AND k.expires_at <= ?
        AND k.expired_notified = 0
        AND (i.id IS NOT NULL OR sp.id IS NOT NULL)
    `, [now]);

    // Kontrakt skickade för signering men ej svarade efter 5 dagar
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const unsignedStale = await queryAll(`
      SELECT k.*,
        COALESCE(i.namn, sp.namn) as influencer_namn,
        COALESCE(i.kontakt_epost, sp.epost) as kontakt_epost,
        COALESCE(i.kanalnamn, '') as kanalnamn,
        f.namn as foretag_namn
      FROM kontrakt k
      LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
      LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.status = 'skickat'
        AND k.created_at <= ?
        AND (i.id IS NOT NULL OR sp.id IS NOT NULL)
    `, [fiveDaysAgo]);

    res.json({
      expiring_soon: expiringSoon,
      expired: expired,
      unsigned_stale: unsignedStale,
      total_actions: expiringSoon.length + expired.length + unsignedStale.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/contracts/:id/send-reminder — skicka påminnelse (influencer + sponsor)
router.post('/:id/send-reminder', async (req, res) => {
  try {
    const { type } = req.body; // 'expiry' | 'sign' | 'expired'

    const k = await queryOne(`
      SELECT k.*,
        COALESCE(i.namn, sp.namn) as influencer_namn,
        COALESCE(i.kontakt_epost, sp.epost) as kontakt_epost,
        f.namn as foretag_namn, f.kontaktperson as foretag_kontaktperson
      FROM kontrakt k
      LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
      LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.id = ? AND (i.id IS NOT NULL OR sp.id IS NOT NULL)
    `, [Number(req.params.id)]);

    if (!k || !k.kontakt_epost) {
      return res.status(400).json({ error: 'Kontrakt eller e-post saknas' });
    }

    const { sendEmail } = await import('../services/email-service.js');
    let subject, body;

    if (type === 'expiry') {
      const daysLeft = Math.ceil((new Date(k.expires_at) - Date.now()) / (1000 * 60 * 60 * 24));
      subject = `Påminnelse: Ditt avtal löper ut om ${daysLeft} dagar`;
      body = `Hej ${k.influencer_namn}!\n\nDitt samarbetsavtal med ${k.foretag_namn} löper ut om ${daysLeft} dagar.\n\nOm du vill förlänga samarbetet, svara på detta mail så ordnar vi ett nytt avtal.\n\nStatus hittills:\n• Videos levererade: ${k.videos_delivered || 0} / ${k.videos_required || 5}\n• Signups: ${k.total_signups || 0}\n\nMed vänliga hälsningar,\n${k.foretag_kontaktperson || k.foretag_namn}`;

      await runSql('UPDATE kontrakt SET expiry_reminder_sent = 1 WHERE id = ?', [k.id]);
    } else if (type === 'sign') {
      subject = `Påminnelse: Samarbetsavtal väntar på signering`;
      body = `Hej ${k.influencer_namn}!\n\nVi skickade ett samarbetsavtal för signering men har inte fått svar ännu.\n\nFör att signera, svara på detta mail med texten "JAG ACCEPTERAR".\n\nOm du har frågor eller inte är intresserad längre, svara gärna ändå så vet vi.\n\nMed vänliga hälsningar,\n${k.foretag_kontaktperson || k.foretag_namn}`;
    } else if (type === 'expired') {
      subject = `Avtal utgånget — ${k.foretag_namn}`;
      body = `Hej ${k.influencer_namn}!\n\nDitt samarbetsavtal med ${k.foretag_namn} har nu löpt ut.\n\nSlutresultat:\n• Videos levererade: ${k.videos_delivered || 0} / ${k.videos_required || 5}\n• Signups: ${k.total_signups || 0}\n\nTack för samarbetet! Om du vill fortsätta, svara på detta mail.\n\nMed vänliga hälsningar,\n${k.foretag_kontaktperson || k.foretag_namn}`;

      await runSql("UPDATE kontrakt SET expired_notified = 1, status = 'utgånget' WHERE id = ?", [k.id]);
    }

    await sendEmail({ to: k.kontakt_epost, subject, body });

    res.json({ status: 'sent', type, to: k.kontakt_epost });
  } catch (error) {
    console.error('[Contracts] Send reminder error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// E-SIGNERING VERIFIERING (anropas av inbox-monitor)
// ============================================================

// POST /api/contracts/verify-signature — kolla om ett inbox-meddelande är en signering
router.post('/verify-signature', async (req, res) => {
  try {
    const { from_email, body_text, subject } = req.body;

    if (!from_email || !body_text) {
      return res.status(400).json({ error: 'from_email och body_text krävs' });
    }

    const text = body_text.toUpperCase();
    const isAcceptance = text.includes('JAG ACCEPTERAR') || text.includes('ACCEPTERAR') || text.includes('JA, JAG GODKÄNNER');

    if (!isAcceptance) {
      return res.json({ is_signature: false });
    }

    // Hitta kontrakt som väntar på signering från denna e-post (influencer eller sponsor)
    const k = await queryOne(`
      SELECT k.id, k.sign_token
      FROM kontrakt k
      LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
      LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
      WHERE k.status = 'skickat'
        AND (
          (LOWER(i.kontakt_epost) = ? AND i.id IS NOT NULL) OR
          (LOWER(sp.epost) = ? AND sp.id IS NOT NULL)
        )
      ORDER BY k.created_at DESC LIMIT 1
    `, [from_email.toLowerCase(), from_email.toLowerCase()]);

    if (!k) {
      return res.json({ is_signature: true, matched_contract: false });
    }

    // Signera kontraktet!
    await runSql(
      "UPDATE kontrakt SET status = 'signerat', signed_at = datetime('now') WHERE id = ?",
      [k.id]
    );

    // Aktivera direkt + sätt utgångsdatum
    await runSql(
      "UPDATE kontrakt SET status = 'aktivt', activated_at = datetime('now'), expires_at = datetime('now', '+30 days') WHERE id = ?",
      [k.id]
    );

    // Uppdatera outreach-status
    const kontrakt = await queryOne('SELECT outreach_id FROM kontrakt WHERE id = ?', [k.id]);
    if (kontrakt?.outreach_id) {
      await runSql("UPDATE outreach_meddelanden SET status = 'avtal_signerat' WHERE id = ?", [kontrakt.outreach_id]);
    }

    res.json({ is_signature: true, matched_contract: true, contract_id: k.id, new_status: 'aktivt' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
