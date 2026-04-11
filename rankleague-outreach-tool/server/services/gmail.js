import { google } from 'googleapis';
import { queryOne, runSql } from '../db/schema.js';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
}

export function getAuthUrl() {
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
  oauth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();

  // Upsert
  const existing = queryOne('SELECT * FROM gmail_tokens WHERE id = 1');
  if (existing) {
    runSql(
      `UPDATE gmail_tokens SET access_token = ?, refresh_token = ?, expiry_date = ?, email = ?, updated_at = datetime('now') WHERE id = 1`,
      [tokens.access_token, tokens.refresh_token, tokens.expiry_date?.toString(), data.email]
    );
  } else {
    runSql(
      `INSERT INTO gmail_tokens (id, access_token, refresh_token, expiry_date, email) VALUES (1, ?, ?, ?, ?)`,
      [tokens.access_token, tokens.refresh_token, tokens.expiry_date?.toString(), data.email]
    );
  }

  return { email: data.email };
}

export function getStoredTokens() {
  return queryOne('SELECT * FROM gmail_tokens WHERE id = 1');
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

  oauth2Client.on('tokens', (newTokens) => {
    runSql(
      `UPDATE gmail_tokens SET access_token = ?, expiry_date = ?, updated_at = datetime('now') WHERE id = 1`,
      [newTokens.access_token, newTokens.expiry_date?.toString()]
    );
  });

  return oauth2Client;
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

  return await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}
