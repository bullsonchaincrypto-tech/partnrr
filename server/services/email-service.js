/**
 * Multi-provider email service
 * Stödjer: Gmail (OAuth2), Microsoft/Outlook (OAuth2 + Graph API), Yahoo (SMTP), Custom SMTP
 */
import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import { queryOne, runSql } from '../db/schema.js';

// ─── Provider presets ────────────────────────────────────────
const SMTP_PRESETS = {
  outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  hotmail: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
  custom: { host: '', port: 587, secure: false },
};

// ─── Config helpers ──────────────────────────────────────────
export async function getEmailConfig() {
  return await queryOne('SELECT * FROM email_config WHERE id = 1');
}

export async function getActiveProvider() {
  const config = await getEmailConfig();
  if (config) return { provider: config.provider, email: config.email, displayName: config.display_name };
  // Fallback: check microsoft_tokens
  const msTokens = await queryOne('SELECT * FROM microsoft_tokens WHERE id = 1');
  if (msTokens) return { provider: 'microsoft', email: msTokens.email, displayName: msTokens.display_name };
  // Fallback: check legacy gmail_tokens
  const gmailTokens = await queryOne('SELECT * FROM gmail_tokens WHERE id = 1');
  if (gmailTokens) return { provider: 'gmail', email: gmailTokens.email, displayName: null };
  return null;
}

export async function isEmailConfigured() {
  const active = await getActiveProvider();
  return !!active;
}

// ─── Save SMTP config ────────────────────────────────────────
export async function saveSmtpConfig({ provider, email, password, host, port, secure, displayName }) {
  const preset = SMTP_PRESETS[provider] || SMTP_PRESETS.custom;
  const smtpHost = host || preset.host;
  const smtpPort = port || preset.port;
  const smtpSecure = secure !== undefined ? (secure ? 1 : 0) : (preset.secure ? 1 : 0);

  const existing = await queryOne('SELECT * FROM email_config WHERE id = 1');
  if (existing) {
    await runSql(
      `UPDATE email_config SET provider = ?, email = ?, smtp_host = ?, smtp_port = ?, smtp_user = ?, smtp_pass = ?, smtp_secure = ?, display_name = ?, updated_at = datetime('now') WHERE id = 1`,
      [provider, email, smtpHost, smtpPort, email, password, smtpSecure, displayName || '']
    );
  } else {
    await runSql(
      `INSERT INTO email_config (id, provider, email, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, display_name) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [provider, email, smtpHost, smtpPort, email, password, smtpSecure, displayName || '']
    );
  }

  return { provider, email };
}

// ─── Verify SMTP connection ─────────────────────────────────
export async function verifySmtpConnection({ provider, email, password, host, port, secure }) {
  const preset = SMTP_PRESETS[provider] || SMTP_PRESETS.custom;
  const transport = nodemailer.createTransport({
    host: host || preset.host,
    port: port || preset.port,
    secure: secure !== undefined ? secure : preset.secure,
    auth: { user: email, pass: password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });

  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    console.error(`[Email] SMTP verify failed for ${provider}:`, err.message);
    return { ok: false, error: err.message };
  } finally {
    transport.close();
  }
}

// ─── Remove config (disconnect) ─────────────────────────────
export async function removeEmailConfig() {
  await runSql('DELETE FROM email_config WHERE id = 1');
  await runSql('DELETE FROM gmail_tokens WHERE id = 1');
  await runSql('DELETE FROM microsoft_tokens WHERE id = 1');
}

// ─── Create SMTP transporter from saved config ──────────────
function createSmtpTransport() {
  const config = getEmailConfig();
  if (!config) throw new Error('Ingen e-postkonfiguration sparad');

  return nodemailer.createTransport({
    host: config.smtp_host,
    port: config.smtp_port,
    secure: !!config.smtp_secure,
    auth: { user: config.smtp_user, pass: config.smtp_pass },
  });
}

// ─── Gmail OAuth send (legacy) ──────────────────────────────
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
}

async function getGmailAuthedClient() {
  const tokens = await queryOne('SELECT * FROM gmail_tokens WHERE id = 1');
  if (!tokens) throw new Error('Gmail inte ansluten');

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

async function sendViaGmail({ to, subject, body, attachmentBuffer, attachmentName }) {
  const auth = await getGmailAuthedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  let raw;
  if (attachmentBuffer) {
    const boundary = 'boundary_partnrr_' + Date.now();
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

  const result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  console.log(`[Email/Gmail] ✓ Skickat till ${to}`);
  return result;
}

// ─── Send via SMTP (Outlook, Yahoo, Custom) ─────────────────
async function sendViaSmtp({ to, subject, body, attachmentBuffer, attachmentName }) {
  const config = getEmailConfig();
  const transport = createSmtpTransport();

  const mailOptions = {
    from: config.display_name ? `"${config.display_name}" <${config.email}>` : config.email,
    to,
    subject,
    text: body,
  };

  if (attachmentBuffer && attachmentName) {
    mailOptions.attachments = [{
      filename: attachmentName,
      content: attachmentBuffer,
      contentType: 'application/pdf',
    }];
  }

  try {
    const result = await transport.sendMail(mailOptions);
    console.log(`[Email/SMTP] ✓ Skickat till ${to} via ${config.provider}`);
    return result;
  } catch (err) {
    console.error(`[Email/SMTP] ✗ Fel vid skickning till ${to}:`, err.message);
    throw err;
  } finally {
    transport.close();
  }
}

// ─── Microsoft Graph API send ──────────────────────────────
async function getMicrosoftAccessToken() {
  const msTokens = await queryOne('SELECT * FROM microsoft_tokens WHERE id = 1');
  if (!msTokens) throw new Error('Microsoft-konto inte anslutet');

  const expiryDate = parseInt(msTokens.expiry_date || '0');
  const now = Date.now();

  // If token is still valid (with 5 min buffer), return it
  if (msTokens.access_token && expiryDate > now + 300000) {
    return msTokens.access_token;
  }

  // Token expired — refresh it
  if (!msTokens.refresh_token) throw new Error('Ingen refresh token — logga in med Microsoft igen');

  console.log('[Email/Microsoft] Refreshing access token...');
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
    const errData = await resp.text();
    console.error('[Email/Microsoft] Token refresh failed:', errData);
    throw new Error('Kunde inte förnya Microsoft-token. Logga in igen.');
  }

  const data = await resp.json();
  const newExpiry = (Date.now() + data.expires_in * 1000).toString();

  await runSql(
    `UPDATE microsoft_tokens SET access_token = ?, refresh_token = ?, expiry_date = ?, updated_at = datetime('now') WHERE id = 1`,
    [data.access_token, data.refresh_token || msTokens.refresh_token, newExpiry]
  );

  return data.access_token;
}

async function sendViaMicrosoft({ to, subject, body, attachmentBuffer, attachmentName }) {
  const accessToken = await getMicrosoftAccessToken();

  const message = {
    message: {
      subject,
      body: { contentType: 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  };

  // Add attachment if present
  if (attachmentBuffer && attachmentName) {
    message.message.attachments = [{
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: attachmentName,
      contentType: 'application/pdf',
      contentBytes: attachmentBuffer.toString('base64'),
    }];
  }

  const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  console.log(`[Email/Microsoft] sendMail response: ${resp.status} ${resp.statusText}`);

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[Email/Microsoft] Send failed:', resp.status, errText);
    throw new Error(`Microsoft Graph sendMail misslyckades (${resp.status}): ${errText}`);
  }

  // Verifiera att mailet dök upp i Sent Items
  try {
    const sentResp = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/sentItems/messages?$top=1&$orderby=sentDateTime desc&$select=subject,toRecipients,sentDateTime', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (sentResp.ok) {
      const sentData = await sentResp.json();
      const latest = sentData.value?.[0];
      if (latest) {
        console.log(`[Email/Microsoft] ✓ Senaste i Skickat: "${latest.subject}" → ${latest.toRecipients?.[0]?.emailAddress?.address} (${latest.sentDateTime})`);
      } else {
        console.warn('[Email/Microsoft] ⚠ Skickat-mappen är tom — mailet kanske inte sparades');
      }
    }
  } catch (e) {
    console.warn('[Email/Microsoft] Kunde inte verifiera Skickat-mapp:', e.message);
  }

  console.log(`[Email/Microsoft] ✓ Skickat till ${to}`);
  return { status: resp.status, provider: 'microsoft' };
}

// ─── Universal send — routes to the right provider ──────────
export async function sendEmail({ to, subject, body, attachmentBuffer, attachmentName }) {
  const config = getEmailConfig();
  const msTokens = await queryOne('SELECT * FROM microsoft_tokens WHERE id = 1');
  const gmailTokens = await queryOne('SELECT * FROM gmail_tokens WHERE id = 1');

  console.log(`[Email] Skickar till: ${to} | Ämne: "${subject?.slice(0, 50)}..." | Provider config: ${config?.provider || 'ingen'} | MS tokens: ${!!msTokens} | Gmail tokens: ${!!gmailTokens}`);

  // Priority: email_config > microsoft_tokens > legacy gmail_tokens
  if (config) {
    if (config.provider === 'gmail') {
      return sendViaGmail({ to, subject, body, attachmentBuffer, attachmentName });
    } else if (config.provider === 'microsoft' || config.provider === 'outlook' || config.provider === 'hotmail') {
      return sendViaMicrosoft({ to, subject, body, attachmentBuffer, attachmentName });
    } else {
      // SMTP (yahoo, custom)
      return sendViaSmtp({ to, subject, body, attachmentBuffer, attachmentName });
    }
  } else if (msTokens) {
    return sendViaMicrosoft({ to, subject, body, attachmentBuffer, attachmentName });
  } else if (gmailTokens) {
    return sendViaGmail({ to, subject, body, attachmentBuffer, attachmentName });
  }

  throw new Error('Ingen e-postleverantör konfigurerad. Anslut ditt e-postkonto först.');
}

// ─── Gmail-specific exports (for inbox reading etc) ─────────
export { getOAuth2Client, getGmailAuthedClient };
