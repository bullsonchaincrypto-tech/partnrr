/**
 * Routes: /api/gmail-watcher
 *
 * Unified inbox watcher — stödjer både Gmail och Microsoft/Outlook.
 * Pollar inbox för inkommande svar OCH sent-mail för externa svar
 * (d.v.s. svar skickade direkt via Outlook/Gmail, inte via plattformen).
 */

import { Router } from 'express';
import { queryAll, queryOne, runSql, getDb } from '../db/schema.js';
import {
  getGmailHistoryId,
  checkGmailHistory,
  getMessageDetails,
  getStoredTokens,
} from '../services/gmail.js';
import { getActiveProvider } from '../services/email-service.js';
import {
  checkMicrosoftInbox,
  checkMicrosoftSentMail,
  isMicrosoftConnected,
} from '../services/microsoft-inbox.js';
import { runSparkCollabTask } from '../services/managed-agents.js';

const router = Router();

/**
 * GET /api/gmail-watcher/check
 *
 * Unified check: kollar inkommande + skickade svar för aktiv provider.
 * Kostar 0 AI-tokens. Frontend kan kalla detta var 30:e sekund.
 */
router.get('/check', async (req, res) => {
  try {
    const active = await getActiveProvider();
    if (!active) return res.json({ skip: true, reason: 'ingen_epost_ansluten' });

    const provider = active.provider;

    if (provider === 'microsoft' || provider === 'outlook' || provider === 'hotmail') {
      return await checkMicrosoftProvider(req, res);
    } else if (provider === 'gmail') {
      return await checkGmailProvider(req, res);
    } else {
      return res.json({ skip: true, reason: `provider_${provider}_stöds_inte_för_inbox` });
    }

  } catch (err) {
    console.error('[InboxWatcher] Check error:', err.message);
    res.status(500).json({ error: 'Kunde inte kontrollera inbox.' });
  }
});

// ─── Microsoft inbox check ────────────────────────────────────
async function checkMicrosoftProvider(req, res) {
  if (!isMicrosoftConnected()) {
    return res.json({ skip: true, reason: 'microsoft_ej_ansluten' });
  }

  // Hämta senast kollad tid
  const state = await queryOne('SELECT * FROM gmail_watch_state WHERE id = 1');
  const lastChecked = state?.last_checked_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Konvertera till ISO-format för Graph API
  const sinceISO = new Date(lastChecked).toISOString();

  // 1. Kolla inkommande mail
  const inboxResult = await checkMicrosoftInbox(sinceISO);
  if (!inboxResult.ok) {
    return res.json({ skip: true, reason: inboxResult.reason });
  }

  // 2. Kolla skickade mail (fångar externa svar)
  const sentResult = await checkMicrosoftSentMail(sinceISO);

  // Hämta alla kända e-postadresser
  const knownEmails = getKnownContactEmails();

  // 3. Bearbeta inkommande
  let newIncoming = 0;
  for (const msg of inboxResult.messages) {
    if (!knownEmails.has(msg.from_email.toLowerCase())) continue;

    const exists = await queryOne(
      'SELECT id FROM inbox_messages WHERE gmail_message_id = ?',
      [msg.provider_message_id]
    );
    if (exists) continue;

    const contactInfo = knownEmails.get(msg.from_email.toLowerCase());
    saveIncomingMessage(msg, contactInfo);
    newIncoming++;
  }

  // 4. Bearbeta skickade (fånga externa svar)
  let newExternal = 0;
  if (sentResult.ok) {
    for (const msg of sentResult.messages) {
      const toEmail = msg.to_email.toLowerCase();
      if (!knownEmails.has(toEmail)) continue;

      // Kolla om redan loggat (via plattformen eller tidigare scan)
      const exists = await queryOne(
        'SELECT id FROM inbox_messages WHERE gmail_message_id = ?',
        [msg.provider_message_id]
      );
      if (exists) continue;

      const contactInfo = knownEmails.get(toEmail);
      saveExternalReply(msg, contactInfo);
      newExternal++;
    }
  }

  // Uppdatera last_checked
  await runSql(
    `UPDATE gmail_watch_state SET last_checked_at = datetime('now') WHERE id = 1`,
    []
  );

  res.json({
    provider: 'microsoft',
    hasNew: newIncoming > 0 || newExternal > 0,
    incoming: newIncoming,
    external_replies: newExternal,
    total_scanned: inboxResult.messages.length + (sentResult.messages?.length || 0),
  });
}

// ─── Gmail inbox check (original) ────────────────────────────
async function checkGmailProvider(req, res) {
  const tokens = getStoredTokens();
  if (!tokens) return res.json({ skip: true, reason: 'gmail_ej_ansluten' });

  // Hämta sparat historyId
  const state = await queryOne('SELECT * FROM gmail_watch_state WHERE id = 1');
  let historyId = state?.history_id;

  // Inget historyId? Initiera med nuvarande
  if (!historyId) {
    historyId = await getGmailHistoryId();
    await runSql(
      `UPDATE gmail_watch_state SET history_id = ?, last_checked_at = datetime('now') WHERE id = 1`,
      [historyId]
    );
    return res.json({ provider: 'gmail', hasNew: false, initialized: true, historyId });
  }

  // Kolla om något hänt sedan senast
  const result = await checkGmailHistory(historyId);

  if (result.needsFullRefresh) {
    const newId = await getGmailHistoryId();
    await runSql(
      `UPDATE gmail_watch_state SET history_id = ?, last_checked_at = datetime('now') WHERE id = 1`,
      [newId]
    );
    return res.json({ provider: 'gmail', hasNew: true, needsFullRefresh: true });
  }

  // Uppdatera historyId
  if (result.newHistoryId) {
    await runSql(
      `UPDATE gmail_watch_state SET history_id = ?, last_checked_at = datetime('now') WHERE id = 1`,
      [result.newHistoryId]
    );
  }

  if (!result.hasNew) {
    return res.json({ provider: 'gmail', hasNew: false });
  }

  // Hämta detaljer om nya meddelanden
  const msgIds = result.newMessages.map(m => m.id);
  if (msgIds.length === 0) {
    return res.json({ provider: 'gmail', hasNew: true, needsFullRefresh: true });
  }

  const messages = await getMessageDetails(msgIds);
  const knownEmails = getKnownContactEmails();

  const relevantMessages = messages.filter(msg =>
    knownEmails.has(msg.from_email?.toLowerCase())
  );

  let newCount = 0;
  for (const msg of relevantMessages) {
    const exists = await queryOne(
      'SELECT id FROM inbox_messages WHERE gmail_message_id = ?',
      [msg.gmail_message_id]
    );
    if (exists) continue;

    const contactInfo = knownEmails.get(msg.from_email.toLowerCase());

    await runSql(`
      INSERT INTO inbox_messages (
        gmail_message_id, gmail_thread_id, from_email, from_name,
        subject, snippet, body_preview, received_at,
        influencer_id, prospect_id, outreach_id,
        match_type, is_reply
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      msg.gmail_message_id,
      msg.gmail_thread_id,
      msg.from_email,
      msg.from_name || contactInfo?.namn || '',
      msg.subject,
      msg.snippet,
      msg.body_preview,
      msg.received_at,
      contactInfo?.influencer_id || null,
      contactInfo?.prospect_id || null,
      contactInfo?.outreach_id || null,
      contactInfo?.type || 'unknown',
    ]);

    upsertConversationThread(msg, contactInfo);
    newCount++;
  }

  res.json({
    provider: 'gmail',
    hasNew: relevantMessages.length > 0,
    total_new_gmail: messages.length,
    relevant: relevantMessages.length,
    saved: newCount,
    ignored: messages.length - relevantMessages.length,
  });
}

/**
 * POST /api/gmail-watcher/analyze/:messageId
 */
router.post('/analyze/:messageId', async (req, res) => {
  try {
    const msg = await queryOne('SELECT * FROM inbox_messages WHERE id = ?', [Number(req.params.messageId)]);
    if (!msg) return res.status(404).json({ error: 'Meddelande hittades inte' });

    let kontextInfo = '';
    if (msg.influencer_id) {
      const inf = await queryOne('SELECT * FROM influencers WHERE id = ?', [msg.influencer_id]);
      const kontrakt = await queryOne('SELECT * FROM kontrakt WHERE influencer_id = ?', [msg.influencer_id]);
      kontextInfo = `Influencer: ${inf?.namn || 'Okänd'} (@${inf?.kanalnamn || ''}) på ${inf?.plattform || ''}. `;
      if (kontrakt) kontextInfo += `Avtalsstatus: ${kontrakt.status}. `;
    }

    const agentConfig = await queryOne("SELECT value FROM agent_config WHERE key = 'agents'");

    if (agentConfig) {
      const agents = JSON.parse(agentConfig.value);
      const envRow = await queryOne("SELECT value FROM agent_config WHERE key = 'environment'");
      const envId = envRow ? JSON.parse(envRow.value).id || JSON.parse(envRow.value) : null;
      const agentInfo = agents['gmail-inbox-monitor'];

      if (agentInfo && envId) {
        const result = await runSparkCollabTask(
          'gmail-inbox-monitor', agentInfo.id, envId,
          `Analysera detta inkommande mail:\n\nFrån: ${msg.from_name} <${msg.from_email}>\nÄmne: ${msg.subject}\nInnehåll: ${msg.body_preview || msg.snippet}\n\n${kontextInfo}\n\nReturnera JSON: { "summary": "kort sammanfattning på svenska (max 50 ord)", "sentiment": "positive|neutral|negative", "suggested_action": "svara_intresse|boka_mote|skicka_kontrakt|skicka_info|avvakta|ingen_atgard", "suggested_reply": "förslag på svar (svenska, max 100 ord)" }`
        );

        try {
          const aiResult = JSON.parse(result.result);
          await runSql(`UPDATE inbox_messages SET ai_summary = ?, ai_sentiment = ?, ai_suggested_action = ?, processed_at = datetime('now') WHERE id = ?`,
            [aiResult.summary, aiResult.sentiment, aiResult.suggested_action, msg.id]);
          if (msg.from_email) {
            await runSql(`UPDATE conversation_threads SET ai_summary = ?, ai_sentiment = ?, ai_next_action = ?, updated_at = datetime('now') WHERE contact_email = ?`,
              [aiResult.summary, aiResult.sentiment, aiResult.suggested_action, msg.from_email]);
          }
          return res.json({ success: true, analysis: aiResult, source: 'managed_agent' });
        } catch {
          await runSql(`UPDATE inbox_messages SET ai_summary = ?, processed_at = datetime('now') WHERE id = ?`, [result.result?.slice(0, 500), msg.id]);
          return res.json({ success: true, analysis: { summary: result.result }, source: 'managed_agent_raw' });
        }
      }
    }

    // Fallback: direkt Anthropic-anrop
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY saknas' });

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: 'Du analyserar inkommande mail i ett influencer-outreach CRM. Svara ALLTID med giltig JSON.',
        messages: [{
          role: 'user',
          content: `Analysera detta mail:\n\nFrån: ${msg.from_name} <${msg.from_email}>\nÄmne: ${msg.subject}\nInnehåll: ${msg.body_preview || msg.snippet}\n\n${kontextInfo}\n\nReturnera JSON: { "summary": "kort sammanfattning (svenska, max 50 ord)", "sentiment": "positive|neutral|negative", "suggested_action": "svara_intresse|boka_mote|skicka_kontrakt|skicka_info|avvakta|ingen_atgard", "suggested_reply": "förslag på svar (svenska, max 100 ord)" }`
        }],
      }),
    });

    if (!aiRes.ok) return res.status(500).json({ error: 'AI-analys misslyckades' });

    const aiData = await aiRes.json();
    const aiText = aiData.content?.[0]?.text || '{}';

    try {
      const analysis = JSON.parse(aiText);
      await runSql(`UPDATE inbox_messages SET ai_summary = ?, ai_sentiment = ?, ai_suggested_action = ?, processed_at = datetime('now') WHERE id = ?`,
        [analysis.summary, analysis.sentiment, analysis.suggested_action, msg.id]);
      if (msg.from_email) {
        await runSql(`UPDATE conversation_threads SET ai_summary = ?, ai_sentiment = ?, ai_next_action = ?, updated_at = datetime('now') WHERE contact_email = ?`,
          [analysis.summary, analysis.sentiment, analysis.suggested_action, msg.from_email]);
      }
      res.json({ success: true, analysis, source: 'direct_api' });
    } catch {
      res.json({ success: true, analysis: { summary: aiText }, source: 'direct_api_raw' });
    }
  } catch (err) {
    console.error('[InboxWatcher] Analyze error:', err.message);
    res.status(500).json({ error: 'AI-analys kunde inte genomföras.' });
  }
});

/**
 * GET /api/gmail-watcher/conversations
 */
router.get('/conversations', async (req, res) => {
  try {
    const threads = await queryAll(`
      SELECT ct.*,
        COALESCE(i.namn, sp.namn) as influencer_namn,
        COALESCE(i.kanalnamn, sp.bransch) as kanalnamn,
        COALESCE(i.plattform, 'Sponsor') as inf_plattform,
        i.foljare,
        k.status as kontrakt_status
      FROM conversation_threads ct
      LEFT JOIN influencers i ON ct.influencer_id = i.id
      LEFT JOIN sponsor_prospects sp ON ct.prospect_id = sp.id
      LEFT JOIN kontrakt k ON k.influencer_id = COALESCE(ct.influencer_id, ct.prospect_id)
        AND CASE WHEN ct.prospect_id IS NOT NULL THEN k.source_type = 'sponsor' ELSE COALESCE(k.source_type, 'influencer') = 'influencer' END
      ORDER BY ct.last_message_at DESC
    `);
    res.json(threads);
  } catch (err) {
    console.error('[InboxWatcher] Conversations error:', err.message);
    res.json([]);
  }
});

/**
 * GET /api/gmail-watcher/conversations/:email/messages
 */
router.get('/conversations/:email/messages', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);

    const incoming = await queryAll(`
      SELECT *, 'inbound' as direction FROM inbox_messages
      WHERE from_email = ? ORDER BY received_at ASC
    `, [email]);

    // Utgående via plattformen (outreach)
    const outgoing = await queryAll(`
      SELECT om.*, 'outbound' as direction, om.skickat_datum as received_at,
        om.amne as subject, om.meddelande as body_preview,
        i.kontakt_epost
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE LOWER(i.kontakt_epost) = ?
      ORDER BY om.skickat_datum ASC
    `, [email.toLowerCase()]);

    // Externa svar (skickade direkt via Outlook/Gmail)
    const externalReplies = await queryAll(`
      SELECT *, 'outbound_external' as direction FROM inbox_messages
      WHERE match_type = 'outbound_external' AND LOWER(from_email) = ?
      ORDER BY received_at ASC
    `, [email.toLowerCase()]);

    // Merge och sortera
    const all = [...incoming, ...outgoing, ...externalReplies].sort(
      (a, b) => new Date(a.received_at || a.skickat_datum || 0) - new Date(b.received_at || b.skickat_datum || 0)
    );

    const thread = await queryOne('SELECT * FROM conversation_threads WHERE contact_email = ?', [email]);
    const influencer = thread?.influencer_id
      ? await queryOne('SELECT * FROM influencers WHERE id = ?', [thread.influencer_id])
      : null;
    const kontrakt = influencer
      ? await queryOne('SELECT * FROM kontrakt WHERE influencer_id = ?', [influencer.id])
      : null;

    await runSql('UPDATE inbox_messages SET is_read = 1 WHERE from_email = ? AND is_read = 0', [email]);
    await runSql('UPDATE conversation_threads SET unread_count = 0 WHERE contact_email = ?', [email]);

    res.json({
      messages: all,
      contact: {
        email,
        namn: influencer?.namn || thread?.contact_name || '',
        kanalnamn: influencer?.kanalnamn || thread?.kanalnamn || '',
        plattform: influencer?.plattform || thread?.plattform || '',
        foljare: influencer?.foljare || null,
        kontrakt_status: kontrakt?.status || null,
        deal_stage: thread?.deal_stage || 'outreach',
        ai_summary: thread?.ai_summary || null,
        ai_sentiment: thread?.ai_sentiment || null,
        ai_next_action: thread?.ai_next_action || null,
      },
    });
  } catch (err) {
    console.error('[InboxWatcher] Thread messages error:', err.message);
    res.json({ messages: [], contact: {} });
  }
});

/**
 * POST /api/gmail-watcher/reply
 *
 * Skicka svar — fungerar med alla providers
 */
router.post('/reply', async (req, res) => {
  try {
    const { to_email, subject, body, thread_id } = req.body;
    if (!to_email || !body) return res.status(400).json({ error: 'to_email och body krävs' });

    const active = await getActiveProvider();
    const { sendEmail } = await import('../services/email-service.js');

    let result;

    if (active?.provider === 'gmail' && thread_id) {
      // Gmail: kan svara i samma tråd
      const { sendReply } = await import('../services/gmail.js');
      result = await sendReply({ to: to_email, subject: subject || 'Re: Samarbete', body, threadId: thread_id });
    } else {
      // Alla providers: skicka via universal sendEmail
      result = await sendEmail({ to: to_email, subject: subject || 'Re: Samarbete', body });
    }

    // Logga utgående svar
    await runSql(`
      INSERT INTO inbox_messages (
        gmail_message_id, gmail_thread_id, from_email, from_name,
        subject, body_preview, received_at, match_type, is_reply
      ) VALUES (?, ?, ?, 'Du', ?, ?, datetime('now'), 'outbound_reply', 0)
    `, [
      result?.data?.id || result?.messageId || `reply_${Date.now()}`,
      thread_id || result?.data?.threadId || null,
      to_email,
      subject || 'Re: Samarbete',
      body,
    ]);

    // Uppdatera conversation_thread
    await runSql(`
      UPDATE conversation_threads SET
        message_count = message_count + 1,
        last_message_at = datetime('now'),
        updated_at = datetime('now')
      WHERE contact_email = ?
    `, [to_email]);

    res.json({ success: true, messageId: result?.data?.id || 'sent', provider: active?.provider });
  } catch (err) {
    console.error('[InboxWatcher] Reply error:', err.message);
    res.status(500).json({ error: 'Kunde inte skicka svar: ' + err.message });
  }
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Bygg en Map av alla kända e-postadresser vi kontaktat
 */
async function getKnownContactEmails() {
  const emailMap = new Map();

  try {
    const influencers = await queryAll(`
      SELECT DISTINCT i.id as influencer_id, i.kontakt_epost, i.namn, i.kanalnamn, i.plattform,
        om.id as outreach_id
      FROM influencers i
      JOIN outreach_meddelanden om ON om.influencer_id = i.id
      WHERE i.kontakt_epost IS NOT NULL AND om.status != 'utkast'
    `);
    for (const inf of influencers) {
      emailMap.set(inf.kontakt_epost.toLowerCase(), {
        type: 'influencer',
        influencer_id: inf.influencer_id,
        outreach_id: inf.outreach_id,
        namn: inf.namn,
        kanalnamn: inf.kanalnamn,
        plattform: inf.plattform,
      });
    }
  } catch (e) { /* OK */ }

  try {
    const sponsors = await queryAll(`
      SELECT DISTINCT sp.id as prospect_id, sp.epost, sp.namn,
        so.id as outreach_id
      FROM sponsor_prospects sp
      JOIN sponsor_outreach so ON so.prospect_id = sp.id
      WHERE sp.epost IS NOT NULL AND so.status != 'utkast'
    `);
    for (const sp of sponsors) {
      emailMap.set(sp.epost.toLowerCase(), {
        type: 'sponsor',
        prospect_id: sp.prospect_id,
        outreach_id: sp.outreach_id,
        namn: sp.namn,
      });
    }
  } catch (e) { /* OK */ }

  return emailMap;
}

/**
 * Spara inkommande meddelande + uppdatera konversation
 */
async function saveIncomingMessage(msg, contactInfo) {
  await runSql(`
    INSERT INTO inbox_messages (
      gmail_message_id, gmail_thread_id, from_email, from_name,
      subject, snippet, body_preview, received_at,
      influencer_id, prospect_id, outreach_id,
      match_type, is_reply
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `, [
    msg.provider_message_id,
    msg.provider_thread_id,
    msg.from_email,
    msg.from_name || contactInfo?.namn || '',
    msg.subject,
    msg.snippet,
    msg.body_preview,
    msg.received_at,
    contactInfo?.influencer_id || null,
    contactInfo?.prospect_id || null,
    contactInfo?.outreach_id || null,
    contactInfo?.type || 'unknown',
  ]);

  upsertConversationThread({
    from_email: msg.from_email,
    from_name: msg.from_name || contactInfo?.namn || '',
    gmail_thread_id: msg.provider_thread_id,
    received_at: msg.received_at,
  }, contactInfo);

  // Uppdatera outreach-status till 'svarat'
  if (contactInfo?.outreach_id) {
    await runSql(`UPDATE outreach_meddelanden SET status = 'svarat' WHERE id = ? AND status = 'skickat'`,
      [contactInfo.outreach_id]);
  }
  if (contactInfo?.type === 'sponsor' && contactInfo?.outreach_id) {
    await runSql(`UPDATE sponsor_outreach SET status = 'svarat' WHERE id = ? AND status = 'skickat'`,
      [contactInfo.outreach_id]);
  }
}

/**
 * Spara externt svar (skickat direkt via Outlook/Gmail, inte plattformen)
 */
async function saveExternalReply(msg, contactInfo) {
  await runSql(`
    INSERT INTO inbox_messages (
      gmail_message_id, gmail_thread_id, from_email, from_name,
      subject, body_preview, received_at, match_type, is_reply
    ) VALUES (?, ?, ?, 'Du (extern)', ?, ?, ?, 'outbound_external', 0)
  `, [
    msg.provider_message_id,
    msg.provider_thread_id,
    msg.to_email,  // Sparar mottagarens e-post i from_email för enkel matchning
    msg.subject,
    msg.body_preview,
    msg.sent_at,
  ]);

  // Uppdatera conversation_thread
  const existing = await queryOne(
    'SELECT * FROM conversation_threads WHERE contact_email = ?',
    [msg.to_email]
  );

  if (existing) {
    await runSql(`
      UPDATE conversation_threads SET
        message_count = message_count + 1,
        last_message_at = ?,
        updated_at = datetime('now')
      WHERE contact_email = ?
    `, [msg.sent_at, msg.to_email]);
  }
}

/**
 * Skapa eller uppdatera conversation_thread
 */
async function upsertConversationThread(msg, contactInfo) {
  const existing = await queryOne(
    'SELECT * FROM conversation_threads WHERE contact_email = ?',
    [msg.from_email]
  );

  if (existing) {
    await runSql(`
      UPDATE conversation_threads SET
        message_count = message_count + 1,
        unread_count = unread_count + 1,
        last_message_at = ?,
        gmail_thread_id = COALESCE(?, gmail_thread_id),
        updated_at = datetime('now')
      WHERE contact_email = ?
    `, [msg.received_at, msg.gmail_thread_id, msg.from_email]);
  } else {
    await runSql(`
      INSERT INTO conversation_threads (
        influencer_id, prospect_id, contact_email, contact_name,
        plattform, kanalnamn, gmail_thread_id,
        last_message_at, message_count, unread_count, deal_stage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'replied')
    `, [
      contactInfo?.influencer_id || null,
      contactInfo?.prospect_id || null,
      msg.from_email,
      msg.from_name || contactInfo?.namn || '',
      contactInfo?.plattform || null,
      contactInfo?.kanalnamn || null,
      msg.gmail_thread_id || null,
      msg.received_at,
    ]);
  }
}

export default router;
