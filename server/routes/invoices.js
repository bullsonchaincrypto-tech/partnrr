import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { generateInvoicePdf } from '../services/generate-invoice-pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();


// ============================================================
// ÖVERSIKT
// ============================================================

router.get('/overview', async (req, res) => {
  try {
    const total = (await queryOne('SELECT COUNT(*) as count FROM fakturor'))?.count || 0;
    const byStatus = await queryAll('SELECT status, COUNT(*) as count, SUM(total_amount_sek) as total FROM fakturor GROUP BY status');
    const statusMap = {};
    byStatus.forEach(r => { statusMap[r.status] = { count: r.count, total: r.total || 0 }; });

    const totalFakturerat = (await queryOne("SELECT SUM(total_amount_sek) as total FROM fakturor WHERE status != 'utkast'"))?.total || 0;
    const totalBetalt = (await queryOne("SELECT SUM(total_amount_sek) as total FROM fakturor WHERE status = 'betald'"))?.total || 0;
    const totalOBetalt = (await queryOne("SELECT SUM(total_amount_sek) as total FROM fakturor WHERE status IN ('skickad', 'forfallen')"))?.total || 0;

    // Förfallna fakturor
    const now = new Date().toISOString();
    const overdue = await queryAll(`
      SELECT f.*, i.namn as influencer_namn, i.kanalnamn,
             ft.namn as foretag_namn
      FROM fakturor f
      JOIN influencers i ON f.influencer_id = i.id
      JOIN foretag ft ON f.foretag_id = ft.id
      WHERE f.status = 'skickad'
        AND f.due_date IS NOT NULL
        AND f.due_date < ?
    `, [now]);

    // Auto-markera förfallna
    if (overdue.length > 0) {
      for (const inv of overdue) {
        await runSql("UPDATE fakturor SET status = 'forfallen' WHERE id = ?", [inv.id]);
      }
    }

    res.json({
      total,
      by_status: statusMap,
      total_fakturerat: totalFakturerat,
      total_betalt: totalBetalt,
      total_obetalt: totalOBetalt,
      overdue_count: overdue.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// LISTA & DETALJER
// ============================================================

router.get('/', async (req, res) => {
  try {
    const { status, influencer_id } = req.query;
    let sql = `
      SELECT f.*, i.namn as influencer_namn, i.kanalnamn, i.kontakt_epost,
             ft.namn as foretag_namn
      FROM fakturor f
      JOIN influencers i ON f.influencer_id = i.id
      JOIN foretag ft ON f.foretag_id = ft.id
      WHERE 1=1
    `;
    const params = [];

    if (status) { sql += ' AND f.status = ?'; params.push(status); }
    if (influencer_id) { sql += ' AND f.influencer_id = ?'; params.push(Number(influencer_id)); }

    sql += ' ORDER BY f.created_at DESC';
    res.json(await queryAll(sql, params));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const inv = await queryOne(`
      SELECT f.*, i.namn as influencer_namn, i.kanalnamn, i.kontakt_epost, i.referral_kod,
             ft.namn as foretag_namn, ft.epost as foretag_epost, ft.kontaktperson as foretag_kontaktperson
      FROM fakturor f
      JOIN influencers i ON f.influencer_id = i.id
      JOIN foretag ft ON f.foretag_id = ft.id
      WHERE f.id = ?
    `, [Number(req.params.id)]);

    if (!inv) return res.status(404).json({ error: 'Faktura hittades inte' });
    res.json(inv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// AUTO-GENERERA FAKTURA FRÅN KONTRAKT
// ============================================================

router.post('/generate', async (req, res) => {
  try {
    const { kontrakt_id } = req.body;
    if (!kontrakt_id) return res.status(400).json({ error: 'kontrakt_id krävs' });

    const k = await queryOne(`
      SELECT k.*, i.namn as influencer_namn, i.kanalnamn, i.kontakt_epost, i.referral_kod,
             f.namn as foretag_namn, f.epost as foretag_epost, f.kontaktperson as foretag_kontaktperson
      FROM kontrakt k
      JOIN influencers i ON k.influencer_id = i.id
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.id = ?
    `, [Number(kontrakt_id)]);

    if (!k) return res.status(404).json({ error: 'Kontrakt hittades inte' });

    // Beräkna belopp
    const videosCount = k.videos_delivered || 0;
    const videoAmount = videosCount * 300;
    const signupsCount = k.total_signups || 0;
    const signupAmount = signupsCount * 10;
    const totalAmount = videoAmount + signupAmount;

    // Generera fakturanummer: RL-ÅÅÅÅ-NNN
    const year = new Date().getFullYear();
    const existing = (await queryOne(
      "SELECT COUNT(*) as count FROM fakturor WHERE faktura_nr LIKE ?",
      [`RL-${year}-%`]
    ))?.count || 0;
    const fakturaNr = `RL-${year}-${String(existing + 1).padStart(3, '0')}`;

    // Förfallodatum: 30 dagar
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { lastId } = await runSql(
      `INSERT INTO fakturor (faktura_nr, kontrakt_id, influencer_id, foretag_id,
        period_from, period_to, videos_count, video_amount_sek,
        signups_count, signup_amount_sek, total_amount_sek,
        status, due_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'utkast', ?, ?)`,
      [
        fakturaNr, k.id, k.influencer_id, k.foretag_id,
        k.activated_at || k.created_at, new Date().toISOString(),
        videosCount, videoAmount,
        signupsCount, signupAmount, totalAmount,
        dueDate,
        `Auto-genererad från kontrakt #${k.id} — ${k.influencer_namn} (${k.kanalnamn})`
      ]
    );

    res.json({
      id: lastId,
      faktura_nr: fakturaNr,
      influencer: k.influencer_namn,
      videos: `${videosCount} videos = ${videoAmount} SEK`,
      signups: `${signupsCount} signups = ${signupAmount} SEK`,
      total: `${totalAmount} SEK`,
      due_date: dueDate,
    });
  } catch (error) {
    console.error('[Invoices] Generate error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// STATUSÄNDRINGAR
// ============================================================

router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['utkast', 'skickad', 'betald', 'forfallen', 'makulerad'];
    if (!valid.includes(status)) return res.status(400).json({ error: `Ogiltig status. Giltiga: ${valid.join(', ')}` });

    const inv = await queryOne('SELECT * FROM fakturor WHERE id = ?', [Number(req.params.id)]);
    if (!inv) return res.status(404).json({ error: 'Faktura hittades inte' });

    const updates = ['status = ?'];
    const params = [status];

    if (status === 'skickad' && !inv.sent_at) {
      updates.push("sent_at = datetime('now')");
    }
    if (status === 'betald' && !inv.paid_at) {
      updates.push("paid_at = datetime('now')");
      // Uppdatera kontraktets utbetalda belopp
      await runSql(
        'UPDATE kontrakt SET total_payout_sek = total_payout_sek + ? WHERE id = ?',
        [inv.total_amount_sek, inv.kontrakt_id]
      );
    }

    params.push(Number(req.params.id));
    await runSql(`UPDATE fakturor SET ${updates.join(', ')} WHERE id = ?`, params);

    res.json({ status: 'ok', new_status: status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// UPPDATERA FAKTURA (manuell redigering)
// ============================================================

router.put('/:id', async (req, res) => {
  try {
    const { videos_count, signups_count, notes, due_date } = req.body;
    const inv = await queryOne('SELECT * FROM fakturor WHERE id = ?', [Number(req.params.id)]);
    if (!inv) return res.status(404).json({ error: 'Faktura hittades inte' });
    if (inv.status !== 'utkast') return res.status(400).json({ error: 'Kan bara redigera utkast-fakturor' });

    const updates = [];
    const params = [];

    if (videos_count !== undefined) {
      const videoAmt = videos_count * 300;
      updates.push('videos_count = ?', 'video_amount_sek = ?');
      params.push(videos_count, videoAmt);
    }
    if (signups_count !== undefined) {
      const signupAmt = signups_count * 10;
      updates.push('signups_count = ?', 'signup_amount_sek = ?');
      params.push(signups_count, signupAmt);
    }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date); }

    if (updates.length > 0) {
      params.push(Number(req.params.id));
      await runSql(`UPDATE fakturor SET ${updates.join(', ')} WHERE id = ?`, params);

      // Räkna om totalen
      const updated = await queryOne('SELECT * FROM fakturor WHERE id = ?', [Number(req.params.id)]);
      const total = (updated.video_amount_sek || 0) + (updated.signup_amount_sek || 0);
      await runSql('UPDATE fakturor SET total_amount_sek = ? WHERE id = ?', [total, updated.id]);
    }

    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// PDF-GENERERING
// ============================================================

router.get('/:id/pdf', async (req, res) => {
  try {
    const inv = await queryOne(`
      SELECT f.*, i.namn as influencer_namn, i.kanalnamn, i.kontakt_epost, i.referral_kod,
             ft.namn as foretag_namn, ft.epost as foretag_epost, ft.kontaktperson as foretag_kontaktperson
      FROM fakturor f
      JOIN influencers i ON f.influencer_id = i.id
      JOIN foretag ft ON f.foretag_id = ft.id
      WHERE f.id = ?
    `, [Number(req.params.id)]);

    if (!inv) return res.status(404).json({ error: 'Faktura hittades inte' });

    const tmpDir = path.join(__dirname, '..', 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const filename = `faktura-${inv.faktura_nr}.pdf`;
    const outputPath = path.join(tmpDir, filename);

    await generateInvoicePdf(inv, outputPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(fs.readFileSync(outputPath));

    setTimeout(() => { try { fs.unlinkSync(outputPath); } catch (e) {} }, 5000);
  } catch (error) {
    console.error('[Invoices] PDF error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// SKICKA FAKTURA VIA E-POST
// ============================================================

router.post('/:id/send', async (req, res) => {
  try {
    const inv = await queryOne(`
      SELECT f.*, i.namn as influencer_namn, i.kanalnamn, i.kontakt_epost,
             ft.namn as foretag_namn, ft.kontaktperson as foretag_kontaktperson
      FROM fakturor f
      JOIN influencers i ON f.influencer_id = i.id
      JOIN foretag ft ON f.foretag_id = ft.id
      WHERE f.id = ?
    `, [Number(req.params.id)]);

    if (!inv) return res.status(404).json({ error: 'Faktura hittades inte' });
    if (!inv.kontakt_epost) return res.status(400).json({ error: 'Influencern saknar e-postadress' });

    // Generera PDF
    const tmpDir = path.join(__dirname, '..', 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const pdfPath = path.join(tmpDir, `faktura-${inv.faktura_nr}.pdf`);
    await generateInvoicePdf(inv, pdfPath);

    // Skicka e-post
    const { sendEmail } = await import('../services/email-service.js');

    const subject = `Faktura ${inv.faktura_nr} — ${inv.foretag_namn}`;
    const body = `Hej ${inv.influencer_namn}!

Här kommer faktura ${inv.faktura_nr} för ditt samarbete med ${inv.foretag_namn} via RankLeague.

Sammanfattning:
• Videos: ${inv.videos_count} st × 300 SEK = ${inv.video_amount_sek.toLocaleString()} SEK
• Signups: ${inv.signups_count} st × 10 SEK = ${inv.signup_amount_sek.toLocaleString()} SEK
• Totalt: ${inv.total_amount_sek.toLocaleString()} SEK

Förfallodatum: ${inv.due_date || 'Ej angivet'}

Tack för samarbetet!

Med vänliga hälsningar,
${inv.foretag_kontaktperson || inv.foretag_namn}`;

    await sendEmail({ to: inv.kontakt_epost, subject, body });

    // Uppdatera status
    await runSql("UPDATE fakturor SET status = 'skickad', sent_at = datetime('now') WHERE id = ?", [inv.id]);

    // Rensa PDF
    setTimeout(() => { try { fs.unlinkSync(pdfPath); } catch (e) {} }, 5000);

    res.json({ status: 'sent', to: inv.kontakt_epost });
  } catch (error) {
    console.error('[Invoices] Send error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// FAKTURERBARA KONTRAKT (hjälpendpoint)
// ============================================================

router.get('/billable/contracts', async (req, res) => {
  try {
    // Hitta kontrakt med levererade videos/signups som inte redan har en faktura
    const contracts = await queryAll(`
      SELECT k.*, i.namn as influencer_namn, i.kanalnamn,
             f.namn as foretag_namn,
             (k.videos_delivered * 300 + k.total_signups * 10) as beraknat_belopp,
             (SELECT COUNT(*) FROM fakturor fa WHERE fa.kontrakt_id = k.id AND fa.status != 'makulerad') as antal_fakturor
      FROM kontrakt k
      JOIN influencers i ON k.influencer_id = i.id
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.status IN ('aktivt', 'utgånget', 'avslutat')
        AND (k.videos_delivered > 0 OR k.total_signups > 0)
      ORDER BY beraknat_belopp DESC
    `);

    res.json(contracts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


export default router;
