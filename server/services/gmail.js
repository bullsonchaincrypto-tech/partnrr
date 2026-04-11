import { google } from 'googleapis';
import { queryOne, runSql } from '../db/schema.js';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
}

export async function getAuthUrl() {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
}

export async function handleCallback(code) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  // Logga vilka scopes vi faktiskt fick
  console.log('[Gmail] === OAuth Callback ===');
  console.log('[Gmail] Token scope:', tokens.scope);
  console.log('[Gmail] Has refresh_token:', !!tokens.refresh_token);
  console.log('[Gmail] Has access_token:', !!tokens.access_token);
  console.log('[Gmail] Expiry:', tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'N/A');

  oauth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();

  // Upsert
  const existing = await queryOne('SELECT * FROM gmail_tokens WHERE id = 1');
  if (existing) {
    await runSql(
      `UPDATE gmail_tokens SET access_token = ?, refresh_token = ?, expiry_date = ?, email = ?, updated_at = datetime('now') WHERE id = 1`,
      [tokens.access_token, tokens.refresh_token, tokens.expiry_date?.toString(), data.email]
    );
  } else {
    await runSql(
      `INSERT INTO gmail_tokens (id, access_token, refresh_token, expiry_date, email) VALUES (1, ?, ?, ?, ?)`,
      [tokens.access_token, tokens.refresh_token, tokens.expiry_date?.toString(), data.email]
    );
  }

  return { email: data.email };
}

export async function getStoredTokens() {
  return await queryOne('SELECT * FROM gmail_tokens WHERE id = 1');
}

async function getAuthedClient() {
  const tokens = getStoredTokens();
  if (!tokens) throw new Error('Gmail inte ansluten. Autentisera forst.');

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: parseInt(tokens.expiry_date),
  });

  oauth2Client.on('tokens', async (newTokens) => {
    await runSql(
      `UPDATE gmail_tokens SET access_token = ?, expiry_date = ?, updated_at = datetime('now') WHERE id = 1`,
      [newTokens.access_token, newTokens.expiry_date?.toString()]
    );
  });

  return oauth2Client;
}

export async function verifyTokenScopes() {
  const tokens = getStoredTokens();
  if (!tokens) return { ok: false, error: 'Inga tokens sparade' };

  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: parseInt(tokens.expiry_date),
    });

    // Check token info
    const tokenInfo = await oauth2Client.getTokenInfo(tokens.access_token);
    console.log('[Gmail] Token scopes:', tokenInfo.scopes);
    console.log('[Gmail] Token email:', tokenInfo.email);
    console.log('[Gmail] Token expiry:', new Date(parseInt(tokens.expiry_date)).toISOString());

    const hasGmailSend = tokenInfo.scopes?.includes('https://www.googleapis.com/auth/gmail.send');
    return {
      ok: hasGmailSend,
      scopes: tokenInfo.scopes,
      email: tokenInfo.email,
      hasGmailSend,
      expiryDate: tokens.expiry_date,
    };
  } catch (err) {
    console.error('[Gmail] Token verify error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Hämta inkommande meddelanden från Gmail-inkorg.
 * Används av OpenClaw gmail-inbox-monitor skill.
 */
export async function getInboxMessages({ maxResults = 20, unreadOnly = false, after = null } = {}) {
  const auth = await getAuthedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  let query = 'in:inbox';
  if (unreadOnly) query += ' is:unread';
  if (after) query += ` after:${after}`;

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });

  const messageIds = listRes.data.messages || [];
  if (messageIds.length === 0) return [];

  const messages = [];
  for (const msg of messageIds) {
    try {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const headers = detail.data.payload?.headers || [];
      const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      const fromRaw = getHeader('From');
      const fromMatch = fromRaw.match(/^(?:"?([^"]*)"?\s+)?<?([^>]+)>?$/);
      const fromName = fromMatch?.[1]?.trim() || '';
      const fromEmail = fromMatch?.[2]?.trim() || fromRaw;

      messages.push({
        gmail_message_id: detail.data.id,
        gmail_thread_id: detail.data.threadId,
        from_email: fromEmail,
        from_name: fromName,
        subject: getHeader('Subject'),
        snippet: detail.data.snippet || '',
        received_at: getHeader('Date') ? new Date(getHeader('Date')).toISOString() : new Date(parseInt(detail.data.internalDate)).toISOString(),
      });
    } catch (err) {
      console.error(`[Gmail] Error fetching message ${msg.id}:`, err.message);
    }
  }

  return messages;
}

/**
 * Hämta Gmail historyId för lättviktig change-detection.
 * Om vi inte har ett sparat historyId, hämtar vi det senaste från profilen.
 */
export async function getGmailHistoryId() {
  const auth = await getAuthedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.historyId;
}

/**
 * Lättviktig check: finns det nya mail sedan senast?
 * Returnerar { hasNew: boolean, newMessages: [{id, threadId}], newHistoryId }
 * Kostar inga tokens, inget AI — bara ett snabbt Gmail API-anrop.
 */
export async function checkGmailHistory(sinceHistoryId) {
  const auth = await getAuthedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: sinceHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
    });

    const histories = res.data.history || [];
    const newMessages = [];

    for (const h of histories) {
      for (const msg of (h.messagesAdded || [])) {
        if (msg.message?.id) {
          newMessages.push({
            id: msg.message.id,
            threadId: msg.message.threadId,
          });
        }
      }
    }

    return {
      hasNew: newMessages.length > 0,
      newMessages,
      newHistoryId: res.data.historyId || sinceHistoryId,
    };
  } catch (err) {
    // historyId för gammalt — Gmail har rensat det. Hämta alla nya.
    if (err.code === 404) {
      console.warn('[Gmail] HistoryId expired, behöver full refresh');
      return { hasNew: true, newMessages: [], newHistoryId: null, needsFullRefresh: true };
    }
    throw err;
  }
}

/**
 * Hämta fullständig info om specifika meddelanden (id-lista)
 */
export async function getMessageDetails(messageIds) {
  const auth = await getAuthedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const messages = [];
  for (const msgId of messageIds) {
    try {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msgId,
        format: 'full',
      });

      const headers = detail.data.payload?.headers || [];
      const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      const fromRaw = getHeader('From');
      const fromMatch = fromRaw.match(/^(?:"?([^"]*)"?\s+)?<?([^>]+)>?$/);
      const fromName = fromMatch?.[1]?.trim() || '';
      const fromEmail = fromMatch?.[2]?.trim() || fromRaw;

      // Extrahera body från payload
      let bodyText = '';
      const payload = detail.data.payload;
      if (payload.body?.data) {
        bodyText = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      } else if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            bodyText = Buffer.from(part.body.data, 'base64').toString('utf-8');
            break;
          }
        }
      }

      messages.push({
        gmail_message_id: detail.data.id,
        gmail_thread_id: detail.data.threadId,
        from_email: fromEmail.toLowerCase(),
        from_name: fromName,
        subject: getHeader('Subject'),
        snippet: detail.data.snippet || '',
        body_preview: bodyText.slice(0, 1000),
        received_at: getHeader('Date') ? new Date(getHeader('Date')).toISOString() : new Date(parseInt(detail.data.internalDate)).toISOString(),
        labels: detail.data.labelIds || [],
      });
    } catch (err) {
      console.error(`[Gmail] Error fetching message ${msgId}:`, err.message);
    }
  }

  return messages;
}

/**
 * Skicka ett svar i en tråd
 */
export async function sendReply({ to, subject, body, threadId }) {
  const auth = await getAuthedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const message = [
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
    `Content-Transfer-Encoding: 7bit`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `In-Reply-To: ${threadId}`,
    `References: ${threadId}`,
    ``,
    body,
  ].join('\r\n');

  const raw = Buffer.from(message).toString('base64url');

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId },
  });

  console.log(`[Gmail] ✓ Svar skickat till ${to} (tråd: ${threadId})`);
  return result;
}

export async function sendEmail({ to, subject, body, attachmentBuffer, attachmentName }) {
  const auth = await getAuthedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  let raw;
  if (attachmentBuffer) {
    const boundary = 'boundary_rankleague_' + Date.now();
    const parts = [
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      `MIME-Version: 1.0`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(body).toString('base64'),
      `--${boundary}`,
      `Content-Type: application/pdf; name="${attachmentName}"`,
      `Content-Disposition: attachment; filename="${attachmentName}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      attachmentBuffer.toString('base64'),
      `--${boundary}--`,
    ];
    raw = Buffer.from(parts.join('\r\n')).toString('base64url');
  } else {
    const message = [
      `Content-Type: text/plain; charset="UTF-8"`,
      `MIME-Version: 1.0`,
      `Content-Transfer-Encoding: 7bit`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      ``,
      body,
    ].join('\r\n');
    raw = Buffer.from(message).toString('base64url');
  }

  try {
    const result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    console.log(`[Gmail] ✓ Skickat till ${to}`);
    return result;
  } catch (err) {
    console.error(`[Gmail] ✗ Fel vid skickning till ${to}:`);
    console.error(`[Gmail]   Status: ${err.code || err.status}`);
    console.error(`[Gmail]   Message: ${err.message}`);
    if (err.errors) console.error(`[Gmail]   Errors:`, JSON.stringify(err.errors));
    if (err.response?.data) console.error(`[Gmail]   Response:`, JSON.stringify(err.response.data));
    throw err;
  }
}
