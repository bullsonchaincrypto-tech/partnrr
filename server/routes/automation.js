import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';

const router = Router();

// ============================================================
// WEBHOOK-LOGGING — spåra alla inkommande OpenClaw-anrop
// ============================================================
async function logWebhook(source, action, data, status = 'ok', error = null) {
  try {
    await runSql(
      `INSERT INTO automation_log (job_type, details, status, items_processed, completed_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [
        `openclaw_${source}`,
        JSON.stringify({ action, ...data, ...(error ? { error: error.message || error } : {}) }),
        status === 'ok' ? 'completed' : 'failed',
        status === 'ok' ? 1 : 0
      ]
    );
  } catch (e) {
    console.error('[Webhook Log] Kunde inte logga:', e.message);
  }
}

// ============================================================
// INBOX — OpenClaw skickar in Gmail-svar hit
// ============================================================

// POST /api/automation/inbox — registrera ett inkommande e-postmeddelande
router.post('/inbox', async (req, res) => {
  try {
    const {
      gmail_message_id, gmail_thread_id, from_email, from_name,
      subject, snippet, body_preview, received_at
    } = req.body;

    if (!gmail_message_id || !from_email) {
      return res.status(400).json({ error: 'gmail_message_id och from_email krävs' });
    }

    // Kolla om meddelandet redan finns
    const existing = await queryOne('SELECT id FROM inbox_messages WHERE gmail_message_id = ?', [gmail_message_id]);
    if (existing) {
      return res.json({ status: 'already_exists', id: existing.id });
    }

    // Matcha mot outreach — hitta vilken influencer/prospect detta svar tillhör
    const match = matchIncomingEmail(from_email);

    const { lastId } = await runSql(
      `INSERT INTO inbox_messages (
        gmail_message_id, gmail_thread_id, from_email, from_name,
        subject, snippet, body_preview, received_at,
        outreach_id, sponsor_outreach_id, influencer_id, prospect_id,
        match_type, is_reply
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gmail_message_id, gmail_thread_id || null, from_email, from_name || null,
        subject || null, snippet || null, body_preview || null,
        received_at || new Date().toISOString(),
        match?.outreach_id || null, match?.sponsor_outreach_id || null,
        match?.influencer_id || null, match?.prospect_id || null,
        match?.type || 'unknown', match ? 1 : 0
      ]
    );

    // Om matchad: uppdatera outreach-status till "svarat"
    if (match?.outreach_id) {
      await runSql("UPDATE outreach_meddelanden SET status = 'svarat' WHERE id = ? AND status = 'skickat'",
        [match.outreach_id]);
    }
    if (match?.sponsor_outreach_id) {
      await runSql("UPDATE sponsor_outreach SET status = 'svarat' WHERE id = ? AND status = 'skickat'",
        [match.sponsor_outreach_id]);
    }

    // Kolla om meddelandet är en e-signering ("JAG ACCEPTERAR")
    let signatureResult = null;
    const textToCheck = (snippet || '') + ' ' + (body_preview || '');
    if (textToCheck.toUpperCase().includes('ACCEPTERAR')) {
      const signCheck = checkForSignature(from_email, textToCheck);
      if (signCheck) signatureResult = signCheck;
    }

    logWebhook('inbox', 'message_received', { from_email, match_type: match?.type || 'unknown', signature: !!signatureResult });
    res.json({ status: 'created', id: lastId, match: match?.type || 'unknown', signature: signatureResult });
  } catch (error) {
    logWebhook('inbox', 'message_received', { from_email: req.body?.from_email }, 'error', error);
    console.error('[Automation] Inbox error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/automation/inbox — hämta alla inbox-meddelanden
router.get('/inbox', async (req, res) => {
  try {
    const { unread_only, match_type, limit } = req.query;
    let sql = 'SELECT * FROM inbox_messages WHERE 1=1';
    const params = [];

    if (unread_only === 'true') {
      sql += ' AND is_read = 0';
    }
    if (match_type) {
      sql += ' AND match_type = ?';
      params.push(match_type);
    }

    sql += ' ORDER BY received_at DESC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(parseInt(limit));
    }

    const rows = await queryAll(sql, params);

    // Berika med influencer/prospect-info
    const enriched = [];
    for (const row of rows) {
      let contact_name = row.from_name || row.from_email;
      if (row.influencer_id) {
        const inf = await queryOne('SELECT namn, kanalnamn FROM influencers WHERE id = ?', [row.influencer_id]);
        if (inf) contact_name = `${inf.namn} (@${inf.kanalnamn})`;
      }
      if (row.prospect_id) {
        const p = await queryOne('SELECT namn FROM sponsor_prospects WHERE id = ?', [row.prospect_id]);
        if (p) contact_name = p.namn;
      }
      enriched.push({ ...row, contact_name });
    }

    res.json(enriched);
  } catch (error) {
    console.error('[Automation] Inbox list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/automation/inbox/:id/read — markera som läst
router.put('/inbox/:id/read', async (req, res) => {
  try {
    await runSql('UPDATE inbox_messages SET is_read = 1 WHERE id = ?', [Number(req.params.id)]);
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/automation/inbox/:id/ai-analysis — spara AI-analys av meddelande
router.put('/inbox/:id/ai-analysis', async (req, res) => {
  try {
    const { ai_summary, ai_sentiment, ai_suggested_action } = req.body;
    await runSql(
      `UPDATE inbox_messages SET ai_summary = ?, ai_sentiment = ?, ai_suggested_action = ?, processed_at = datetime('now') WHERE id = ?`,
      [ai_summary || null, ai_sentiment || null, ai_suggested_action || null, Number(req.params.id)]
    );
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/automation/inbox/conversations — gruppera inbox per avsändare
router.get('/inbox/conversations', async (req, res) => {
  try {
    const conversations = await queryAll(`
      SELECT from_email,
             MAX(from_name) as from_name,
             MAX(CASE WHEN influencer_id IS NOT NULL THEN influencer_id END) as influencer_id,
             MAX(CASE WHEN prospect_id IS NOT NULL THEN prospect_id END) as prospect_id,
             MAX(match_type) as match_type,
             COUNT(*) as message_count,
             SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread_count,
             MAX(received_at) as last_message_at,
             MAX(subject) as last_subject,
             MAX(snippet) as last_snippet
      FROM inbox_messages
      GROUP BY from_email
      ORDER BY last_message_at DESC
    `);

    const enriched = [];
    for (const c of conversations) {
      let contact_name = c.from_name || c.from_email;
      let kanalnamn = null;
      let plattform = null;
      if (c.influencer_id) {
        const inf = await queryOne('SELECT namn, kanalnamn, plattform FROM influencers WHERE id = ?', [c.influencer_id]);
        if (inf) {
          contact_name = inf.namn;
          kanalnamn = inf.kanalnamn;
          plattform = inf.plattform;
        }
      }
      if (c.prospect_id) {
        const p = await queryOne('SELECT namn, bransch FROM sponsor_prospects WHERE id = ?', [c.prospect_id]);
        if (p) contact_name = p.namn;
      }
      enriched.push({ ...c, contact_name, kanalnamn, plattform });
    }

    res.json(enriched);
  } catch (error) {
    console.error('[Automation] Conversations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/automation/inbox/thread/:email — hämta fullständig konversationstråd
router.get('/inbox/thread/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase().trim();

    // Inkommande meddelanden
    const inbound = await queryAll(
      `SELECT id, from_email, from_name, subject, snippet, body_preview, received_at, is_read,
              ai_summary, ai_sentiment, ai_suggested_action, 'inbound' as direction
       FROM inbox_messages WHERE LOWER(from_email) = ? ORDER BY received_at ASC`,
      [email]
    );

    // Markera alla som lästa
    await runSql('UPDATE inbox_messages SET is_read = 1 WHERE LOWER(from_email) = ?', [email]);

    // Outbound — outreach-meddelanden skickade till denna e-post
    const outbound = await queryAll(`
      SELECT om.id, om.amne as subject, om.meddelande as body_preview,
             om.skickat_datum as received_at, 'outbound' as direction,
             om.followup_step
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE LOWER(i.kontakt_epost) = ?
        AND om.skickat_datum IS NOT NULL
      ORDER BY om.skickat_datum ASC
    `, [email]);

    // Outbound — sponsor-outreach
    const sponsorOutbound = await queryAll(`
      SELECT so.id, so.amne as subject, so.meddelande as body_preview,
             so.skickat_datum as received_at, 'outbound' as direction
      FROM sponsor_outreach so
      JOIN sponsor_prospects sp ON so.prospect_id = sp.id
      WHERE LOWER(sp.epost) = ?
        AND so.skickat_datum IS NOT NULL
      ORDER BY so.skickat_datum ASC
    `, [email]);

    // Merge och sortera kronologiskt
    const thread = [...inbound, ...outbound, ...sponsorOutbound]
      .sort((a, b) => new Date(a.received_at) - new Date(b.received_at));

    // Kontaktinfo
    let contact = { email };
    const inf = await queryOne('SELECT id, namn, kanalnamn, plattform, foljare FROM influencers WHERE LOWER(kontakt_epost) = ?', [email]);
    if (inf) {
      contact = { ...contact, type: 'influencer', ...inf };
    } else {
      const sp = await queryOne('SELECT id, namn, bransch, plattform FROM sponsor_prospects WHERE LOWER(epost) = ?', [email]);
      if (sp) contact = { ...contact, type: 'sponsor', ...sp };
    }

    res.json({ contact, thread, total: thread.length });
  } catch (error) {
    console.error('[Automation] Thread error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/automation/inbox/reply — skicka svar via Gmail
router.post('/inbox/reply', async (req, res) => {
  try {
    const { to_email, subject, body, outreach_id, sponsor_outreach_id } = req.body;
    if (!to_email || !body) {
      return res.status(400).json({ error: 'to_email och body krävs' });
    }

    const { sendEmail } = await import('../services/email-service.js');
    await sendEmail({
      to: to_email,
      subject: subject || 'Re: Samarbete med RankLeague',
      body
    });

    // Logga svaret som outbound i inbox
    await runSql(
      `INSERT INTO inbox_messages (
        gmail_message_id, from_email, from_name, subject, body_preview,
        received_at, match_type, is_reply, is_read, outreach_id, sponsor_outreach_id
      ) VALUES (?, ?, 'RankLeague', ?, ?, datetime('now'), 'outbound_reply', 0, 1, ?, ?)`,
      [
        'manual_reply_' + Date.now(), to_email,
        subject || 'Re: Samarbete', body,
        outreach_id || null, sponsor_outreach_id || null
      ]
    );

    logWebhook('inbox', 'reply_sent', { to_email });
    res.json({ status: 'sent' });
  } catch (error) {
    logWebhook('inbox', 'reply_sent', { to_email: req.body?.to_email }, 'error', error);
    console.error('[Automation] Reply error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// UPPFÖLJNING — OpenClaw triggar och loggar automatiska uppföljningar
// ============================================================

// GET /api/automation/followup/due — hämta alla outreach som behöver uppföljning
router.get('/followup/due', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 5;
    const now = new Date().toISOString();

    // Influencer-outreach utan svar efter X dagar
    const influencerDue = await queryAll(`
      SELECT om.id as outreach_id, om.influencer_id, om.foretag_id,
             om.skickat_datum, om.amne, om.status,
             i.namn as influencer_namn, i.kanalnamn, i.kontakt_epost,
             'influencer' as outreach_type
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE om.status = 'skickat'
        AND om.skickat_datum IS NOT NULL
        AND julianday(?) - julianday(om.skickat_datum) >= ?
        AND om.id NOT IN (
          SELECT DISTINCT outreach_id FROM inbox_messages WHERE outreach_id IS NOT NULL
        )
        AND om.id NOT IN (
          SELECT DISTINCT outreach_id FROM followup_log WHERE outreach_id IS NOT NULL AND status = 'sent'
        )
    `, [now, days]);

    // Sponsor-outreach utan svar efter X dagar
    const sponsorDue = await queryAll(`
      SELECT so.id as sponsor_outreach_id, so.prospect_id, so.foretag_id,
             so.skickat_datum, so.amne, so.status,
             sp.namn as prospect_namn, sp.epost as kontakt_epost,
             'sponsor' as outreach_type
      FROM sponsor_outreach so
      JOIN sponsor_prospects sp ON so.prospect_id = sp.id
      WHERE so.status = 'skickat'
        AND so.skickat_datum IS NOT NULL
        AND julianday(?) - julianday(so.skickat_datum) >= ?
        AND so.id NOT IN (
          SELECT DISTINCT sponsor_outreach_id FROM inbox_messages WHERE sponsor_outreach_id IS NOT NULL
        )
        AND so.id NOT IN (
          SELECT DISTINCT sponsor_outreach_id FROM followup_log WHERE sponsor_outreach_id IS NOT NULL AND status = 'sent'
        )
    `, [now, days]);

    res.json({
      influencer_due: influencerDue,
      sponsor_due: sponsorDue,
      total: influencerDue.length + sponsorDue.length
    });
  } catch (error) {
    console.error('[Automation] Followup due error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/automation/followup — logga en skickad uppföljning
router.post('/followup', async (req, res) => {
  try {
    const {
      outreach_id, sponsor_outreach_id, influencer_id, prospect_id,
      followup_nr, trigger_reason, meddelande
    } = req.body;

    const { lastId } = await runSql(
      `INSERT INTO followup_log (
        outreach_id, sponsor_outreach_id, influencer_id, prospect_id,
        followup_nr, trigger_reason, meddelande, status, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', datetime('now'))`,
      [
        outreach_id || null, sponsor_outreach_id || null,
        influencer_id || null, prospect_id || null,
        followup_nr || 1, trigger_reason || 'auto_5days',
        meddelande || null
      ]
    );

    res.json({ status: 'created', id: lastId });
  } catch (error) {
    console.error('[Automation] Followup log error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/automation/followup/log — hämta uppföljningshistorik
router.get('/followup/log', async (req, res) => {
  try {
    const rows = await queryAll('SELECT * FROM followup_log ORDER BY created_at DESC LIMIT 50');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// AUTOMATION LOG — spåra alla OpenClaw-jobb
// ============================================================

// POST /api/automation/log — starta ett nytt jobb
router.post('/log', async (req, res) => {
  try {
    const { job_type, details } = req.body;
    const { lastId } = await runSql(
      "INSERT INTO automation_log (job_type, details) VALUES (?, ?)",
      [job_type, details || null]
    );
    res.json({ id: lastId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/automation/log/:id — uppdatera jobb-status
router.put('/log/:id', async (req, res) => {
  try {
    const { status, items_processed, items_found, error: errMsg } = req.body;
    await runSql(
      `UPDATE automation_log SET status = ?, items_processed = ?, items_found = ?, error = ?, completed_at = datetime('now') WHERE id = ?`,
      [status || 'completed', items_processed || 0, items_found || 0, errMsg || null, Number(req.params.id)]
    );
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/automation/log — hämta senaste jobb
router.get('/log', async (req, res) => {
  try {
    const rows = await queryAll('SELECT * FROM automation_log ORDER BY started_at DESC LIMIT 25');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// STATISTIK — samlad data för OpenClaw dashboard
// ============================================================

router.get('/stats', async (req, res) => {
  try {
    const totalOutreach = await queryOne('SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = "skickat"');
    const totalSponsorOutreach = await queryOne('SELECT COUNT(*) as count FROM sponsor_outreach WHERE status = "skickat"');
    const totalReplies = await queryOne('SELECT COUNT(*) as count FROM inbox_messages WHERE is_reply = 1');
    const unreadReplies = await queryOne('SELECT COUNT(*) as count FROM inbox_messages WHERE is_read = 0');
    const pendingFollowups = await queryOne('SELECT COUNT(*) as count FROM followup_log WHERE status = "pending"');
    const sentFollowups = await queryOne('SELECT COUNT(*) as count FROM followup_log WHERE status = "sent"');

    const totalSent = (totalOutreach?.count || 0) + (totalSponsorOutreach?.count || 0);
    const replyRate = totalSent > 0 ? ((totalReplies?.count || 0) / totalSent * 100).toFixed(1) : 0;

    res.json({
      total_sent: totalSent,
      total_replies: totalReplies?.count || 0,
      unread_replies: unreadReplies?.count || 0,
      reply_rate: parseFloat(replyRate),
      pending_followups: pendingFollowups?.count || 0,
      sent_followups: sentFollowups?.count || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// HJÄLPFUNKTIONER
// ============================================================

async function checkForSignature(fromEmail, bodyText) {
  const text = bodyText.toUpperCase();
  const isAcceptance = text.includes('JAG ACCEPTERAR') || text.includes('JA, JAG GODKÄNNER');

  if (!isAcceptance) return null;

  // Hitta kontrakt som väntar på signering från denna e-post
  const k = await queryOne(`
    SELECT k.id, k.outreach_id
    FROM kontrakt k
    JOIN influencers i ON k.influencer_id = i.id
    WHERE k.status = 'skickat'
      AND LOWER(i.kontakt_epost) = ?
    ORDER BY k.created_at DESC LIMIT 1
  `, [fromEmail.toLowerCase()]);

  if (!k) return null;

  // Signera och aktivera kontraktet automatiskt!
  await runSql(
    "UPDATE kontrakt SET status = 'aktivt', signed_at = datetime('now'), activated_at = datetime('now'), expires_at = datetime('now', '+30 days') WHERE id = ?",
    [k.id]
  );

  if (k.outreach_id) {
    await runSql("UPDATE outreach_meddelanden SET status = 'avtal_signerat' WHERE id = ?", [k.outreach_id]);
  }

  console.log(`[Automation] Kontrakt #${k.id} signerat via e-post från ${fromEmail}`);
  return { contract_id: k.id, new_status: 'aktivt' };
}

async function matchIncomingEmail(fromEmail) {
  const email = fromEmail.toLowerCase().trim();

  // Matcha mot influencer-outreach
  const influencerMatch = await queryOne(`
    SELECT om.id as outreach_id, om.influencer_id, i.kontakt_epost
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    WHERE LOWER(i.kontakt_epost) = ?
    ORDER BY om.skickat_datum DESC LIMIT 1
  `, [email]);

  if (influencerMatch) {
    return {
      type: 'influencer',
      outreach_id: influencerMatch.outreach_id,
      influencer_id: influencerMatch.influencer_id,
      sponsor_outreach_id: null,
      prospect_id: null
    };
  }

  // Matcha mot sponsor-outreach
  const sponsorMatch = await queryOne(`
    SELECT so.id as sponsor_outreach_id, so.prospect_id, sp.epost
    FROM sponsor_outreach so
    JOIN sponsor_prospects sp ON so.prospect_id = sp.id
    WHERE LOWER(sp.epost) = ?
    ORDER BY so.skickat_datum DESC LIMIT 1
  `, [email]);

  if (sponsorMatch) {
    return {
      type: 'sponsor',
      outreach_id: null,
      influencer_id: null,
      sponsor_outreach_id: sponsorMatch.sponsor_outreach_id,
      prospect_id: sponsorMatch.prospect_id
    };
  }

  return null;
}

export default router;
