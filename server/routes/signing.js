import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';

const router = Router();

// ============================================================
// PUBLIK E-SIGNERING (ingen autentisering krävs)
// Influencern klickar på en länk i sitt mail och kan signera
// direkt i webbläsaren. Ingen inloggning behövs.
// ============================================================

// GET /api/sign/:token — hämta kontraktsinfo för signering
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token || token.length < 10) {
      return res.status(400).json({ error: 'Ogiltig signeringslänk' });
    }

    const k = await queryOne(`
      SELECT k.id, k.status, k.sign_token, k.sign_method, k.signed_at,
             k.videos_required, k.kontaktperson, k.created_at, k.expires_at,
             i.namn as influencer_namn, i.kanalnamn, i.plattform,
             f.namn as foretag_namn
      FROM kontrakt k
      JOIN influencers i ON k.influencer_id = i.id
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.sign_token = ?
    `, [token]);

    if (!k) {
      return res.status(404).json({ error: 'Kontraktet hittades inte. Länken kan vara ogiltig eller utgången.' });
    }

    // Returnera kontraktsdata (utan känslig info)
    res.json({
      id: k.id,
      status: k.status,
      already_signed: k.status === 'signerat' || k.status === 'aktivt',
      signed_at: k.signed_at,
      foretag_namn: k.foretag_namn,
      influencer_namn: k.influencer_namn,
      kanalnamn: k.kanalnamn,
      plattform: k.plattform || 'YouTube',
      kontaktperson: k.kontaktperson,
      videos_required: k.videos_required || 5,
      created_at: k.created_at,
      villkor: {
        per_video_sek: 300,
        per_signup_sek: 10,
        max_videos: k.videos_required || 5,
        avtalstid_dagar: 30,
        krav: [
          'Varje video måste innehålla en tydlig call-to-action som uppmanar tittarna att registrera sig via referral-länk/kod',
          'Influencern delar statistik (visningar, klick) inom 7 dagar efter publicering',
          'Innehållet ska vara i linje med RankLeagues varumärke och värderingar',
        ],
      },
    });
  } catch (error) {
    console.error('[Signing] GET error:', error);
    res.status(500).json({ error: 'Något gick fel. Försök igen.' });
  }
});


// POST /api/sign/:token — signera kontraktet digitalt
router.post('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { namn, accepterar } = req.body;

    if (!token || token.length < 10) {
      return res.status(400).json({ error: 'Ogiltig signeringslänk' });
    }

    if (!accepterar) {
      return res.status(400).json({ error: 'Du måste acceptera avtalsvillkoren' });
    }

    const k = await queryOne(`
      SELECT k.id, k.status, k.sign_token, k.outreach_id,
             i.namn as influencer_namn
      FROM kontrakt k
      JOIN influencers i ON k.influencer_id = i.id
      WHERE k.sign_token = ?
    `, [token]);

    if (!k) {
      return res.status(404).json({ error: 'Kontraktet hittades inte' });
    }

    if (k.status === 'signerat' || k.status === 'aktivt') {
      return res.json({ already_signed: true, message: 'Avtalet är redan signerat!' });
    }

    if (k.status !== 'skickat') {
      return res.status(400).json({ error: `Kontraktet kan inte signeras i status "${k.status}"` });
    }

    // Samla audit-data
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const signedNamn = namn || k.influencer_namn;

    // Signera kontraktet
    await runSql(`
      UPDATE kontrakt SET
        status = 'signerat',
        signed_at = datetime('now'),
        sign_method = 'web_signature',
        sign_audit = ?
      WHERE id = ?
    `, [
      JSON.stringify({
        signed_by: signedNamn,
        ip_address: ip,
        user_agent: userAgent,
        timestamp: new Date().toISOString(),
        method: 'web_signature',
      }),
      k.id,
    ]);

    // Aktivera direkt + sätt utgångsdatum
    await runSql(`
      UPDATE kontrakt SET
        status = 'aktivt',
        activated_at = datetime('now'),
        expires_at = datetime('now', '+30 days')
      WHERE id = ?
    `, [k.id]);

    // Uppdatera outreach-status
    if (k.outreach_id) {
      await runSql("UPDATE outreach_meddelanden SET status = 'avtal_signerat' WHERE id = ?", [k.outreach_id]);
    }

    res.json({
      signed: true,
      message: 'Avtalet är nu signerat och aktiverat! Tack!',
      contract_id: k.id,
    });
  } catch (error) {
    console.error('[Signing] POST error:', error);
    res.status(500).json({ error: 'Något gick fel vid signeringen. Försök igen.' });
  }
});


// GET /api/sign/:token/pdf — ladda ner kontrakts-PDF (publikt)
router.get('/:token/pdf', async (req, res) => {
  try {
    const { token } = req.params;

    const k = await queryOne(`
      SELECT k.*, i.namn as influencer_namn, i.kanalnamn, i.kontakt_epost, i.referral_kod, i.plattform,
             f.namn as foretag_namn, f.epost as foretag_epost, f.kontaktperson as foretag_kontaktperson
      FROM kontrakt k
      JOIN influencers i ON k.influencer_id = i.id
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.sign_token = ?
    `, [token]);

    if (!k) return res.status(404).json({ error: 'Kontrakt hittades inte' });

    const { generateContractPdf } = await import('../services/generate-contract-pdf.js');
    const path = await import('path');
    const fs = await import('fs');
    const { fileURLToPath } = await import('url');

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const tmpDir = path.join(__dirname, '..', 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const filename = `kontrakt-${k.id}-${k.influencer_namn.replace(/\s+/g, '-').toLowerCase()}.pdf`;
    const outputPath = path.join(tmpDir, filename);

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

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    const pdfBuffer = fs.readFileSync(outputPath);
    res.send(pdfBuffer);

    setTimeout(() => { try { fs.unlinkSync(outputPath); } catch (e) {} }, 5000);
  } catch (error) {
    console.error('[Signing] PDF error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
