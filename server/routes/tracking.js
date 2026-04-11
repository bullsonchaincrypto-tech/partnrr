import { Router } from 'express';
import crypto from 'crypto';
import { queryOne, queryAll, runSql } from '../db/schema.js';

const router = Router();

// 1x1 transparent GIF pixel
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Create a tracking ID for an outreach message
export async function createTrackingId(outreachId, type = 'influencer') {
  const trackingId = crypto.randomBytes(16).toString('hex');
  if (type === 'influencer') {
    await runSql(
      'INSERT INTO email_tracking (outreach_id, tracking_id) VALUES (?, ?)',
      [outreachId, trackingId]
    );
  } else {
    await runSql(
      'INSERT INTO email_tracking (sponsor_outreach_id, tracking_id) VALUES (?, ?)',
      [outreachId, trackingId]
    );
  }
  return trackingId;
}

// Generate tracking pixel HTML to embed in email
export async function getTrackingPixelHtml(trackingId, serverUrl) {
  return `<img src="${serverUrl}/api/tracking/pixel/${trackingId}" width="1" height="1" style="display:none" alt="" />`;
}

// Tracking pixel endpoint - returns 1x1 GIF and logs the open
router.get('/pixel/:trackingId', async (req, res) => {
  const { trackingId } = req.params;

  const record = await queryOne('SELECT * FROM email_tracking WHERE tracking_id = ?', [trackingId]);
  if (record) {
    await runSql(
      `UPDATE email_tracking SET oppnad = 1, oppnad_count = oppnad_count + 1, oppnad_datum = datetime('now') WHERE tracking_id = ?`,
      [trackingId]
    );

    // Auto-update outreach status if first open
    if (!record.oppnad) {
      if (record.outreach_id) {
        const msg = await queryOne('SELECT status FROM outreach_meddelanden WHERE id = ?', [record.outreach_id]);
        if (msg && msg.status === 'skickat') {
          // Don't change status automatically, but we log the open
        }
      }
    }
  }

  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(TRACKING_PIXEL);
});

// Get tracking stats
router.get('/stats', async (req, res) => {
  const totalTracked = (await queryOne('SELECT COUNT(*) as count FROM email_tracking'))?.count || 0;
  const totalOpened = (await queryOne('SELECT COUNT(*) as count FROM email_tracking WHERE oppnad = 1'))?.count || 0;
  const openRate = totalTracked > 0 ? parseFloat(((totalOpened / totalTracked) * 100).toFixed(1)) : 0;

  const recentOpens = await queryAll(`
    SELECT et.*,
      COALESCE(i.namn, sp.namn) as mottagare_namn,
      CASE WHEN et.outreach_id IS NOT NULL THEN 'influencer' ELSE 'sponsor' END as typ
    FROM email_tracking et
    LEFT JOIN outreach_meddelanden om ON et.outreach_id = om.id
    LEFT JOIN influencers i ON om.influencer_id = i.id
    LEFT JOIN sponsor_outreach so ON et.sponsor_outreach_id = so.id
    LEFT JOIN sponsor_prospects sp ON so.prospect_id = sp.id
    WHERE et.oppnad = 1
    ORDER BY et.oppnad_datum DESC
    LIMIT 20
  `);

  res.json({ totalTracked, totalOpened, openRate, recentOpens });
});

// Get tracking for specific outreach message
router.get('/message/:outreachId', async (req, res) => {
  const record = await queryOne('SELECT * FROM email_tracking WHERE outreach_id = ?', [Number(req.params.outreachId)]);
  res.json(record || { oppnad: false });
});

export default router;
