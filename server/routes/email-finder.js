import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { findEmailForChannel } from '../services/email-finder.js';

const router = Router();


// ============================================================
// INFLUENCERS SOM SAKNAR E-POST
// ============================================================

// GET /api/email-finder/missing — lista influencers utan e-post
router.get('/missing', async (req, res) => {
  try {
    // Prioritera: aktiva kontrakt först, sen valda influencers, sen alla
    const missing = await queryAll(`
      SELECT
        i.id, i.namn, i.kanalnamn, i.plattform, i.foljare, i.nisch,
        i.kontakt_epost, i.kontakt_info,
        k.status as kontrakt_status,
        ec.email as cached_email, ec.method as cached_method, ec.updated_at as cache_date,
        CASE
          WHEN k.status IN ('aktivt','signerat') THEN 1
          WHEN k.status = 'skickat' THEN 2
          WHEN i.vald = 1 THEN 3
          ELSE 4
        END as prioritet
      FROM influencers i
      LEFT JOIN kontrakt k ON k.influencer_id = i.id
      LEFT JOIN email_cache ec ON ec.kanalnamn = REPLACE(i.kanalnamn, '@', '')
      WHERE (i.kontakt_epost IS NULL OR i.kontakt_epost = '' OR i.kontakt_epost = 'N/A')
      GROUP BY i.id
      ORDER BY prioritet ASC, i.created_at DESC
      LIMIT 20
    `);

    const stats = {
      total_missing: missing.length,
      with_active_contract: missing.filter(m => m.prioritet === 1).length,
      with_pending_contract: missing.filter(m => m.prioritet === 2).length,
      with_cache: missing.filter(m => m.cached_email).length,
    };

    res.json({ influencers: missing, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// SÖK E-POST FÖR EN INFLUENCER
// ============================================================

// POST /api/email-finder/search — kör automatisk e-postsökning
router.post('/search', async (req, res) => {
  try {
    const { influencer_id } = req.body;
    if (!influencer_id) return res.status(400).json({ error: 'influencer_id krävs' });

    const inf = await queryOne('SELECT * FROM influencers WHERE id = ?', [Number(influencer_id)]);
    if (!inf) return res.status(404).json({ error: 'Influencer hittades inte' });

    console.log(`[E-post] 🔍 Söker e-post för ${inf.namn} (@${inf.kanalnamn})...`);

    const result = await findEmailForChannel({
      kanalnamn: inf.kanalnamn,
      namn: inf.namn,
      beskrivning: inf.kontakt_info || '',
      kontakt_info: inf.kontakt_info || '',
    });

    if (result?.email) {
      // Spara direkt på influencer-objektet
      await runSql('UPDATE influencers SET kontakt_epost = ? WHERE id = ?', [result.email, inf.id]);
      console.log(`[E-post] ✅ Hittade e-post för ${inf.namn}: ${result.email} (${result.method})`);
    }

    res.json({
      influencer_id: inf.id,
      influencer_namn: inf.namn,
      kanalnamn: inf.kanalnamn,
      ...result,
    });
  } catch (error) {
    console.error('[E-post] Search error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// SPARA E-POST (manuellt / från browser-skill)
// ============================================================

// POST /api/email-finder/save — spara hittad e-post
router.post('/save', async (req, res) => {
  try {
    const { influencer_id, email, method, confidence } = req.body;
    if (!influencer_id || !email) return res.status(400).json({ error: 'influencer_id och email krävs' });

    const inf = await queryOne('SELECT * FROM influencers WHERE id = ?', [Number(influencer_id)]);
    if (!inf) return res.status(404).json({ error: 'Influencer hittades inte' });

    // Uppdatera influencer
    await runSql('UPDATE influencers SET kontakt_epost = ? WHERE id = ?', [email, inf.id]);

    // Uppdatera/skapa cache
    const handle = (inf.kanalnamn || '').replace(/^@/, '');
    const existing = await queryOne('SELECT id FROM email_cache WHERE kanalnamn = ?', [handle]);
    if (existing) {
      await runSql('UPDATE email_cache SET email = ?, method = ?, updated_at = datetime("now") WHERE kanalnamn = ?', [email, method || 'manual', handle]);
    } else {
      await runSql('INSERT INTO email_cache (kanalnamn, email, method) VALUES (?, ?, ?)', [handle, email, method || 'manual']);
    }

    console.log(`[E-post] 💾 Sparad: ${inf.namn} (@${inf.kanalnamn}) → ${email} (${method || 'manual'}, ${confidence || 'unknown'})`);

    res.json({
      status: 'saved',
      influencer_id: inf.id,
      influencer_namn: inf.namn,
      email,
      method: method || 'manual',
      confidence: confidence || 'unknown',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// BATCH-SÖKNING (kör för alla som saknar)
// ============================================================

// POST /api/email-finder/batch — sök e-post för alla som saknar (max 10)
router.post('/batch', async (req, res) => {
  try {
    const maxCount = Math.min(Number(req.body?.max) || 10, 20);

    // Hämta influencers utan e-post, prioriterat
    const missing = await queryAll(`
      SELECT i.id, i.namn, i.kanalnamn, i.plattform, i.kontakt_info,
        CASE
          WHEN k.status IN ('aktivt','signerat') THEN 1
          WHEN k.status = 'skickat' THEN 2
          WHEN i.vald = 1 THEN 3
          ELSE 4
        END as prioritet
      FROM influencers i
      LEFT JOIN kontrakt k ON k.influencer_id = i.id
      WHERE (i.kontakt_epost IS NULL OR i.kontakt_epost = '' OR i.kontakt_epost = 'N/A')
      GROUP BY i.id
      ORDER BY prioritet ASC, i.created_at DESC
      LIMIT ?
    `, [maxCount]);

    if (missing.length === 0) {
      return res.json({ status: 'ok', message: 'Alla influencers har e-postadresser', found: 0, searched: 0 });
    }

    console.log(`[E-post] 🔍 Batch-sökning: ${missing.length} influencers...`);

    const results = [];
    let foundCount = 0;

    for (const inf of missing) {
      try {
        const result = await findEmailForChannel({
          kanalnamn: inf.kanalnamn,
          namn: inf.namn,
          beskrivning: inf.kontakt_info || '',
          kontakt_info: inf.kontakt_info || '',
        });

        if (result?.email) {
          await runSql('UPDATE influencers SET kontakt_epost = ? WHERE id = ?', [result.email, inf.id]);
          foundCount++;
        }

        results.push({
          influencer_id: inf.id,
          namn: inf.namn,
          kanalnamn: inf.kanalnamn,
          email: result?.email || null,
          method: result?.method || null,
          confidence: result?.confidence || null,
        });
      } catch (err) {
        results.push({
          influencer_id: inf.id,
          namn: inf.namn,
          kanalnamn: inf.kanalnamn,
          email: null,
          error: err.message,
        });
      }
    }

    // Logga i automation_log
    await runSql(
      "INSERT INTO automation_log (job_type, status, details, items_processed, items_found, completed_at) VALUES (?, 'completed', ?, ?, ?, datetime('now'))",
      ['smart_email_finder', `Batch-sökning: ${foundCount}/${missing.length} hittade`, missing.length, foundCount]
    );

    console.log(`[E-post] ✅ Batch klar: ${foundCount}/${missing.length} e-poster hittade`);

    res.json({
      status: 'ok',
      searched: missing.length,
      found: foundCount,
      results,
    });
  } catch (error) {
    console.error('[E-post] Batch error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// STATISTIK
// ============================================================

router.get('/stats', async (req, res) => {
  try {
    const total = (await queryOne('SELECT COUNT(*) as count FROM influencers'))?.count || 0;
    const withEmail = (await queryOne("SELECT COUNT(*) as count FROM influencers WHERE kontakt_epost IS NOT NULL AND kontakt_epost != '' AND kontakt_epost != 'N/A'"))?.count || 0;
    const withoutEmail = total - withEmail;
    const cached = (await queryOne('SELECT COUNT(*) as count FROM email_cache'))?.count || 0;

    // Metod-fördelning
    const byMethod = await queryAll('SELECT method, COUNT(*) as count FROM email_cache GROUP BY method ORDER BY count DESC');

    // Senaste sökningar
    const recentJobs = await queryAll(
      "SELECT * FROM automation_log WHERE job_type = 'smart_email_finder' ORDER BY started_at DESC LIMIT 5"
    );

    res.json({
      total_influencers: total,
      with_email: withEmail,
      without_email: withoutEmail,
      coverage_pct: total > 0 ? Math.round((withEmail / total) * 100) : 0,
      cached_emails: cached,
      by_method: byMethod,
      recent_jobs: recentJobs,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


export default router;
