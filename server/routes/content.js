import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { runFullContentScan, analyzeVideoWithAI } from '../services/content-scanner.js';

const router = Router();

// ============================================================
// CONTENT DASHBOARD
// ============================================================

// GET /api/content/overview — samlad content-status
router.get('/overview', async (req, res) => {
  try {
    const totalTracked = await queryOne('SELECT COUNT(*) as count FROM content_tracking');
    const withCTA = await queryOne('SELECT COUNT(*) as count FROM content_tracking WHERE has_cta = 1');
    const withReferral = await queryOne('SELECT COUNT(*) as count FROM content_tracking WHERE has_referral_link = 1');
    const byQuality = await queryAll(`
      SELECT cta_quality, COUNT(*) as count
      FROM content_tracking
      GROUP BY cta_quality
    `);

    // Influencers med avtal som INTE publicerat
    const avtalsInfluencers = await queryAll(`
      SELECT DISTINCT i.id, i.namn, i.kanalnamn, om.skickat_datum
      FROM influencers i
      JOIN outreach_meddelanden om ON i.id = om.influencer_id
      WHERE om.status = 'avtal_signerat'
    `);

    const publishedInfluencers = await queryAll(`
      SELECT DISTINCT influencer_id FROM content_tracking WHERE has_company_mention = 1
    `).map(r => r.influencer_id);

    const missingContent = avtalsInfluencers.filter(i => !publishedInfluencers.includes(i.id));

    // Flagga försenade (>14 dagar sedan avtal utan publicering)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const delayed = missingContent.filter(i => i.skickat_datum && i.skickat_datum < fourteenDaysAgo);

    res.json({
      total_videos_tracked: totalTracked?.count || 0,
      videos_with_cta: withCTA?.count || 0,
      videos_with_referral: withReferral?.count || 0,
      cta_quality_breakdown: byQuality.reduce((acc, r) => {
        acc[r.cta_quality] = r.count;
        return acc;
      }, {}),
      influencers_with_deal: avtalsInfluencers.length,
      influencers_published: publishedInfluencers.length,
      influencers_missing: missingContent.length,
      influencers_delayed: delayed.length,
      delayed_influencers: delayed.map(i => ({
        id: i.id,
        namn: i.namn,
        kanalnamn: i.kanalnamn,
        days_since_deal: Math.floor((Date.now() - new Date(i.skickat_datum).getTime()) / (1000 * 60 * 60 * 24))
      }))
    });
  } catch (error) {
    console.error('[Content] Overview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/content/videos — lista alla trackade videos
router.get('/videos', async (req, res) => {
  try {
    const { influencer_id, cta_quality, status } = req.query;
    let sql = `
      SELECT ct.*, i.namn as influencer_namn, i.kanalnamn,
             f.namn as foretag_namn
      FROM content_tracking ct
      JOIN influencers i ON ct.influencer_id = i.id
      LEFT JOIN foretag f ON ct.foretag_id = f.id
      WHERE 1=1
    `;
    const params = [];

    if (influencer_id) {
      sql += ' AND ct.influencer_id = ?';
      params.push(Number(influencer_id));
    }
    if (cta_quality) {
      sql += ' AND ct.cta_quality = ?';
      params.push(cta_quality);
    }
    if (status) {
      sql += ' AND ct.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY ct.published_at DESC';

    const videos = await queryAll(sql, params);

    // Parsa AI-analys JSON
    const enriched = videos.map(v => ({
      ...v,
      ai_analysis: v.ai_analysis ? JSON.parse(v.ai_analysis) : null
    }));

    res.json(enriched);
  } catch (error) {
    console.error('[Content] Videos list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/content/videos/:id — en specifik video med full analys
router.get('/videos/:id', async (req, res) => {
  try {
    const video = await queryOne(`
      SELECT ct.*, i.namn as influencer_namn, i.kanalnamn, i.referral_kod,
             f.namn as foretag_namn
      FROM content_tracking ct
      JOIN influencers i ON ct.influencer_id = i.id
      LEFT JOIN foretag f ON ct.foretag_id = f.id
      WHERE ct.id = ?
    `, [Number(req.params.id)]);

    if (!video) return res.status(404).json({ error: 'Video hittades inte' });

    video.ai_analysis = video.ai_analysis ? JSON.parse(video.ai_analysis) : null;
    res.json(video);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/content/scan — trigga en full content-scan (OpenClaw eller manuell)
router.post('/scan', async (req, res) => {
  try {
    // Logga jobb
    const { lastId: jobId } = await runSql(
      "INSERT INTO automation_log (job_type, details) VALUES ('content_scan', 'Manuell/OpenClaw content-scan')"
    );

    const results = await runFullContentScan();

    // Uppdatera jobblogg
    await runSql(
      `UPDATE automation_log SET status = 'completed', items_processed = ?, items_found = ?, completed_at = datetime('now') WHERE id = ?`,
      [results.influencers_scanned, results.new_videos_found, jobId]
    );

    res.json(results);
  } catch (error) {
    console.error('[Content] Scan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/content/videos/:id/analyze — AI-analysera en specifik video
router.post('/videos/:id/analyze', async (req, res) => {
  try {
    const analysis = await analyzeVideoWithAI(Number(req.params.id));
    if (!analysis) return res.status(404).json({ error: 'Kunde inte analysera videon' });
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/content/influencer/:id — content-status för en specifik influencer
router.get('/influencer/:id', async (req, res) => {
  try {
    const influencerId = Number(req.params.id);

    const videos = await queryAll(`
      SELECT * FROM content_tracking WHERE influencer_id = ? ORDER BY published_at DESC
    `, [influencerId]);

    const scanLog = await queryOne(
      'SELECT * FROM content_scan_log WHERE influencer_id = ?',
      [influencerId]
    );

    const totalVideos = videos.length;
    const withCTA = videos.filter(v => v.has_cta).length;
    const withReferral = videos.filter(v => v.has_referral_link).length;
    const strongCTA = videos.filter(v => v.cta_quality === 'stark').length;

    res.json({
      influencer_id: influencerId,
      total_videos: totalVideos,
      videos_with_cta: withCTA,
      videos_with_referral: withReferral,
      strong_cta_count: strongCTA,
      last_scanned: scanLog?.last_scanned_at || null,
      videos: videos.map(v => ({
        ...v,
        ai_analysis: v.ai_analysis ? JSON.parse(v.ai_analysis) : null
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// CONTENT SUBMISSIONS — Godkännandeflöde
// ============================================================

// GET /api/content/submissions — lista alla inskickade content
router.get('/submissions', async (req, res) => {
  try {
    const { status, influencer_id } = req.query;
    let sql = `
      SELECT cs.*, i.namn as influencer_namn, i.kanalnamn, i.plattform,
             f.namn as foretag_namn,
             k.videos_required, k.videos_delivered
      FROM content_submissions cs
      JOIN influencers i ON cs.influencer_id = i.id
      LEFT JOIN foretag f ON cs.foretag_id = f.id
      LEFT JOIN kontrakt k ON cs.kontrakt_id = k.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND cs.status = ?';
      params.push(status);
    }
    if (influencer_id) {
      sql += ' AND cs.influencer_id = ?';
      params.push(Number(influencer_id));
    }

    sql += ' ORDER BY cs.submitted_at DESC';
    const rows = await queryAll(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/content/submissions/stats — statistik för godkännandeflöde
router.get('/submissions/stats', async (req, res) => {
  try {
    const total = (await queryOne('SELECT COUNT(*) as count FROM content_submissions'))?.count || 0;
    const pending = (await queryOne("SELECT COUNT(*) as count FROM content_submissions WHERE status = 'submitted'"))?.count || 0;
    const inReview = (await queryOne("SELECT COUNT(*) as count FROM content_submissions WHERE status = 'in_review'"))?.count || 0;
    const approved = (await queryOne("SELECT COUNT(*) as count FROM content_submissions WHERE status = 'approved'"))?.count || 0;
    const needsRevision = (await queryOne("SELECT COUNT(*) as count FROM content_submissions WHERE status = 'needs_revision'"))?.count || 0;
    const rejected = (await queryOne("SELECT COUNT(*) as count FROM content_submissions WHERE status = 'rejected'"))?.count || 0;

    // Genomsnittlig tid till godkännande
    const avgReviewTime = await queryOne(`
      SELECT AVG(julianday(reviewed_at) - julianday(submitted_at)) as avg_days
      FROM content_submissions
      WHERE reviewed_at IS NOT NULL AND submitted_at IS NOT NULL
    `);

    res.json({
      total, pending, in_review: inReview, approved, needs_revision: needsRevision, rejected,
      avg_review_days: avgReviewTime?.avg_days ? Number(avgReviewTime.avg_days.toFixed(1)) : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/content/submissions — influencer skickar in content
router.post('/submissions', async (req, res) => {
  try {
    const { influencer_id, kontrakt_id, foretag_id, title, description, content_url, content_type, thumbnail_url, notes_from_influencer, deadline } = req.body;

    if (!influencer_id || !title) {
      return res.status(400).json({ error: 'influencer_id och title krävs' });
    }

    const { lastId } = await runSql(`
      INSERT INTO content_submissions (influencer_id, kontrakt_id, foretag_id, title, description, content_url, content_type, thumbnail_url, notes_from_influencer, deadline)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      influencer_id, kontrakt_id || null, foretag_id || null,
      title, description || null, content_url || null,
      content_type || 'video', thumbnail_url || null,
      notes_from_influencer || null, deadline || null
    ]);

    res.json({ status: 'created', id: lastId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/content/submissions/:id/review — granska och besluta
router.put('/submissions/:id/review', async (req, res) => {
  try {
    const { status, review_notes, reviewed_by } = req.body;
    const validStatuses = ['in_review', 'approved', 'needs_revision', 'rejected'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Ogiltig status. Giltiga: ${validStatuses.join(', ')}` });
    }

    const submission = await queryOne('SELECT * FROM content_submissions WHERE id = ?', [Number(req.params.id)]);
    if (!submission) return res.status(404).json({ error: 'Inskickning hittades inte' });

    const revisionCount = status === 'needs_revision' ? (submission.revision_count || 0) + 1 : submission.revision_count;

    await runSql(`
      UPDATE content_submissions
      SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = datetime('now'), revision_count = ?
      WHERE id = ?
    `, [status, review_notes || null, reviewed_by || 'Admin', revisionCount, Number(req.params.id)]);

    // Om godkänd: uppdatera kontrakt videos_delivered
    if (status === 'approved' && submission.kontrakt_id) {
      await runSql('UPDATE kontrakt SET videos_delivered = videos_delivered + 1 WHERE id = ?', [submission.kontrakt_id]);
    }

    res.json({ status: 'updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/content/submissions/:id/resubmit — influencer skickar in reviderad version
router.put('/submissions/:id/resubmit', async (req, res) => {
  try {
    const { content_url, notes_from_influencer, title, description } = req.body;

    const submission = await queryOne('SELECT * FROM content_submissions WHERE id = ?', [Number(req.params.id)]);
    if (!submission) return res.status(404).json({ error: 'Inskickning hittades inte' });

    await runSql(`
      UPDATE content_submissions
      SET status = 'submitted', content_url = COALESCE(?, content_url), notes_from_influencer = ?,
          title = COALESCE(?, title), description = COALESCE(?, description),
          submitted_at = datetime('now')
      WHERE id = ?
    `, [content_url || null, notes_from_influencer || null, title || null, description || null, Number(req.params.id)]);

    res.json({ status: 'resubmitted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/content/submissions/:id — ta bort
router.delete('/submissions/:id', async (req, res) => {
  try {
    await runSql('DELETE FROM content_submissions WHERE id = ?', [Number(req.params.id)]);
    res.json({ status: 'deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
