/**
 * Microsoft Graph API inbox service
 * Läser inkommande mail + skickade svar via Graph API
 */
import { queryOne, runSql } from '../db/schema.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Get a valid access token (refreshing if needed)
 */
async function getAccessToken() {
  const msTokens = await queryOne('SELECT * FROM microsoft_tokens WHERE id = 1');
  if (!msTokens) return null;

  const expiryDate = parseInt(msTokens.expiry_date || '0');
  const now = Date.now();

  if (msTokens.access_token && expiryDate > now + 300000) {
    return msTokens.access_token;
  }

  if (!msTokens.refresh_token) return null;

  console.log('[Microsoft/Inbox] Refreshing access token...');
  const resp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      refresh_token: msTokens.refresh_token,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read offline_access openid profile email',
    }),
  });

  if (!resp.ok) {
    console.error('[Microsoft/Inbox] Token refresh failed:', await resp.text());
    return null;
  }

  const data = await resp.json();
  const newExpiry = (Date.now() + data.expires_in * 1000).toString();

  await runSql(
    `UPDATE microsoft_tokens SET access_token = ?, refresh_token = ?, expiry_date = ?, updated_at = datetime('now') WHERE id = 1`,
    [data.access_token, data.refresh_token || msTokens.refresh_token, newExpiry]
  );

  return data.access_token;
}

/**
 * Check for new INCOMING messages since a given datetime
 * Returns array of normalized message objects
 */
export async function checkMicrosoftInbox(sinceDate) {
  const token = await getAccessToken();
  if (!token) return { ok: false, reason: 'no_token' };

  // Fetch recent inbox messages received after sinceDate
  const filter = sinceDate
    ? `&$filter=receivedDateTime ge ${sinceDate}`
    : '';

  const url = `${GRAPH_BASE}/me/mailFolders/inbox/messages?$top=50&$orderby=receivedDateTime desc&$select=id,conversationId,subject,from,bodyPreview,receivedDateTime,isRead${filter}`;

  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[Microsoft/Inbox] Fetch failed:', resp.status, errText);
    return { ok: false, reason: 'api_error', error: errText };
  }

  const data = await resp.json();
  const messages = (data.value || []).map(normalizeMessage);

  return { ok: true, messages };
}

/**
 * Check for SENT messages since a given datetime
 * This catches replies sent directly from Outlook/Hotmail (outside the platform)
 */
export async function checkMicrosoftSentMail(sinceDate) {
  const token = await getAccessToken();
  if (!token) return { ok: false, reason: 'no_token' };

  const filter = sinceDate
    ? `&$filter=sentDateTime ge ${sinceDate}`
    : '';

  const url = `${GRAPH_BASE}/me/mailFolders/sentItems/messages?$top=50&$orderby=sentDateTime desc&$select=id,conversationId,subject,toRecipients,bodyPreview,sentDateTime${filter}`;

  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!resp.ok) {
    console.error('[Microsoft/Inbox] Sent mail fetch failed:', resp.status);
    return { ok: false, reason: 'api_error' };
  }

  const data = await resp.json();
  const messages = (data.value || []).map(normalizeSentMessage);

  return { ok: true, messages };
}

/**
 * Check if Microsoft is connected
 */
export async function isMicrosoftConnected() {
  const msTokens = await queryOne('SELECT * FROM microsoft_tokens WHERE id = 1');
  return !!msTokens?.access_token;
}

/**
 * Normalize incoming message to our standard format
 */
function normalizeMessage(msg) {
  return {
    provider_message_id: msg.id,
    provider_thread_id: msg.conversationId,
    provider: 'microsoft',
    from_email: msg.from?.emailAddress?.address || '',
    from_name: msg.from?.emailAddress?.name || '',
    subject: msg.subject || '',
    snippet: (msg.bodyPreview || '').slice(0, 200),
    body_preview: msg.bodyPreview || '',
    received_at: msg.receivedDateTime,
    is_read: msg.isRead ? 1 : 0,
  };
}

/**
 * Normalize sent message
 */
function normalizeSentMessage(msg) {
  const to = msg.toRecipients?.[0]?.emailAddress || {};
  return {
    provider_message_id: msg.id,
    provider_thread_id: msg.conversationId,
    provider: 'microsoft',
    to_email: to.address || '',
    to_name: to.name || '',
    subject: msg.subject || '',
    body_preview: msg.bodyPreview || '',
    sent_at: msg.sentDateTime,
    direction: 'outbound_external',
  };
}
