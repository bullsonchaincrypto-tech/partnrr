import { Router } from 'express';
import { getAuthUrl, handleCallback, getStoredTokens, verifyTokenScopes, getInboxMessages } from '../services/gmail.js';
import { getActiveProvider, saveSmtpConfig, verifySmtpConnection, removeEmailConfig, isEmailConfigured } from '../services/email-service.js';
import { runSql, queryOne } from '../db/schema.js';

const router = Router();

// CLIENT_URL kan vara komma-separerad (för CORS). Använd bara den första som redirect.
const clientRedirectUrl = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();

// ─── Unified auth status ─────────────────────────────────────
router.get('/status', async (req, res) => {
  const active = await getActiveProvider();
  if (active) {
    return res.json({ authenticated: true, provider: active.provider, email: active.email, displayName: active.displayName });
  }
  res.json({ authenticated: false });
});

// ─── Gmail OAuth flow ────────────────────────────────────────
router.get('/google', async (req, res) => {
  const url = await getAuthUrl();
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Ingen kod mottagen');
    const result = await handleCallback(code);
    // Also save to email_config so unified status works
    const existing = await queryOne('SELECT * FROM email_config WHERE id = 1');
    if (existing) {
      await runSql(`UPDATE email_config SET provider = 'gmail', email = ?, updated_at = datetime('now') WHERE id = 1`, [result.email]);
    } else {
      await runSql(`INSERT INTO email_config (id, provider, email) VALUES (1, 'gmail', ?)`, [result.email]);
    }
    res.redirect(`${clientRedirectUrl}?auth=success`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${clientRedirectUrl}?auth=error`);
  }
});

// ─── Microsoft OAuth2 flow (Outlook/Hotmail via Graph API) ───
router.get('/microsoft', async (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3001/api/auth/microsoft/callback',
    response_mode: 'query',
    scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read offline_access openid profile email',
    prompt: 'consent',
  });
  const authUrl = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params}`;
  res.redirect(authUrl);
});

router.get('/microsoft/callback', async (req, res) => {
  try {
    const { code, error, error_description } = req.query;
    if (error) {
      console.error('[Auth/Microsoft] OAuth error:', error, error_description);
      return res.redirect(`${clientRedirectUrl}?auth=error&msg=${encodeURIComponent(error_description || error)}`);
    }
    if (!code) return res.status(400).send('Ingen kod mottagen');

    // Exchange code for tokens
    const tokenResp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        code,
        redirect_uri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3001/api/auth/microsoft/callback',
        grant_type: 'authorization_code',
        scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read offline_access openid profile email',
      }),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error('[Auth/Microsoft] Token exchange failed:', errText);
      return res.redirect(`${clientRedirectUrl}?auth=error`);
    }

    const tokens = await tokenResp.json();

    // Get user email — try multiple sources since personal accounts are tricky
    let email = '';
    let displayName = '';

    // 1. Try decoding the id_token JWT (most reliable for personal accounts)
    if (tokens.id_token) {
      try {
        const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString());
        email = payload.email || payload.preferred_username || '';
        displayName = payload.name || '';
        console.log('[Auth/Microsoft] ID token claims:', { email, displayName, sub: payload.sub });
      } catch (e) {
        console.warn('[Auth/Microsoft] Kunde inte parsa id_token:', e.message);
      }
    }

    // 2. Fallback: Graph API /me
    if (!email) {
      const profileResp = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` },
      });
      const profile = profileResp.ok ? await profileResp.json() : {};
      email = profile.mail || profile.userPrincipalName || email;
      displayName = displayName || profile.displayName || '';
    }

    const expiryDate = (Date.now() + tokens.expires_in * 1000).toString();

    // Save microsoft tokens
    const existing = await queryOne('SELECT * FROM microsoft_tokens WHERE id = 1');
    if (existing) {
      await runSql(
        `UPDATE microsoft_tokens SET access_token = ?, refresh_token = ?, expiry_date = ?, email = ?, display_name = ?, updated_at = datetime('now') WHERE id = 1`,
        [tokens.access_token, tokens.refresh_token, expiryDate, email, displayName]
      );
    } else {
      await runSql(
        `INSERT INTO microsoft_tokens (id, access_token, refresh_token, expiry_date, email, display_name) VALUES (1, ?, ?, ?, ?, ?)`,
        [tokens.access_token, tokens.refresh_token, expiryDate, email, displayName]
      );
    }

    // Also save to email_config so unified status works
    const existingConfig = await queryOne('SELECT * FROM email_config WHERE id = 1');
    if (existingConfig) {
      await runSql(`UPDATE email_config SET provider = 'microsoft', email = ?, display_name = ?, updated_at = datetime('now') WHERE id = 1`, [email, displayName]);
    } else {
      await runSql(`INSERT INTO email_config (id, provider, email, display_name) VALUES (1, 'microsoft', ?, ?)`, [email, displayName]);
    }

    console.log(`[Auth/Microsoft] ✓ Ansluten: ${email} (${displayName})`);
    res.redirect(`${clientRedirectUrl}?auth=success`);
  } catch (error) {
    console.error('[Auth/Microsoft] Callback error:', error);
    res.redirect(`${clientRedirectUrl}?auth=error`);
  }
});

// ─── SMTP connect (Outlook, Yahoo, Custom) ───────────────────
router.post('/smtp/connect', async (req, res) => {
  try {
    const { provider, email, password, host, port, secure, displayName } = req.body;

    if (!provider || !email || !password) {
      return res.status(400).json({ error: 'Provider, e-post och lösenord krävs' });
    }

    // Verify connection first
    const verification = await verifySmtpConnection({ provider, email, password, host, port, secure });
    if (!verification.ok) {
      return res.status(400).json({ error: `Kunde inte ansluta: ${verification.error}`, details: verification.error });
    }

    // Save config
    const result = saveSmtpConfig({ provider, email, password, host, port, secure, displayName });
    console.log(`[Auth] ✓ SMTP ${provider} kopplat: ${email}`);
    res.json({ success: true, provider: result.provider, email: result.email });
  } catch (err) {
    console.error('[Auth] SMTP connect error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Test SMTP without saving ────────────────────────────────
router.post('/smtp/test', async (req, res) => {
  try {
    const { provider, email, password, host, port, secure } = req.body;
    const result = await verifySmtpConnection({ provider, email, password, host, port, secure });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Disconnect (all providers) ──────────────────────────────
router.post('/disconnect', async (req, res) => {
  await removeEmailConfig();
  console.log('[Auth] ✓ E-postkonto frånkopplat');
  res.json({ success: true });
});

// ─── Legacy Gmail endpoints ──────────────────────────────────
router.get('/debug-scopes', async (req, res) => {
  try {
    const result = await verifyTokenScopes();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/force-reauth', async (req, res) => {
  await removeEmailConfig();
  const url = await getAuthUrl();
  res.redirect(url);
});

// Gmail inbox (used by OpenClaw)
router.get('/google/inbox', async (req, res) => {
  try {
    const tokens = getStoredTokens();
    if (!tokens) return res.status(401).json({ error: 'Gmail inte ansluten' });

    const maxResults = parseInt(req.query.maxResults) || 20;
    const unreadOnly = req.query.unreadOnly === 'true';
    const after = req.query.after || null;

    const messages = await getInboxMessages({ maxResults, unreadOnly, after });
    res.json({ messages, count: messages.length });
  } catch (error) {
    console.error('[Gmail] Inbox fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
