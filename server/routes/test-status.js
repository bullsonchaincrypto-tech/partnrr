/**
 * Test-status endpoint — verifierar att alla anslutningar fungerar
 * GET /api/test/status
 */
import { Router } from 'express';
import { queryOne, queryAll } from '../db/schema.js';
import { getActiveProvider } from '../services/email-service.js';
import { isMicrosoftConnected } from '../services/microsoft-inbox.js';

const router = Router();

router.get('/status', async (req, res) => {
  const results = {};

  // 1. Database
  try {
    const count = await queryOne('SELECT count(*) as c FROM influencers');
    results.database = { ok: true, message: `SQLite OK — ${count.c} influencers i databasen` };
  } catch (err) {
    results.database = { ok: false, message: err.message };
  }

  // 2. E-post (aktiv provider)
  try {
    const active = await getActiveProvider();
    if (active) {
      results.email = { ok: true, provider: active.provider, email: active.email, displayName: active.displayName };
    } else {
      results.email = { ok: false, message: 'Ingen e-postleverantör ansluten' };
    }
  } catch (err) {
    results.email = { ok: false, message: err.message };
  }

  // 3. Microsoft OAuth tokens
  try {
    const msTokens = await queryOne('SELECT email, display_name, expiry_date FROM microsoft_tokens WHERE id = 1');
    if (msTokens) {
      const expiresAt = new Date(parseInt(msTokens.expiry_date));
      const isExpired = expiresAt < new Date();
      results.microsoft = {
        ok: !isExpired,
        email: msTokens.email,
        displayName: msTokens.display_name,
        tokenExpires: expiresAt.toISOString(),
        expired: isExpired,
      };
    } else {
      results.microsoft = { ok: false, message: 'Inga Microsoft-tokens sparade' };
    }
  } catch (err) {
    results.microsoft = { ok: false, message: err.message };
  }

  // 4. Gmail OAuth tokens
  try {
    const gmailTokens = await queryOne('SELECT email, expiry_date FROM gmail_tokens WHERE id = 1');
    if (gmailTokens) {
      const expiresAt = new Date(parseInt(gmailTokens.expiry_date));
      const isExpired = expiresAt < new Date();
      results.gmail = {
        ok: !isExpired,
        email: gmailTokens.email,
        tokenExpires: expiresAt.toISOString(),
        expired: isExpired,
      };
    } else {
      results.gmail = { ok: false, message: 'Inga Gmail-tokens sparade' };
    }
  } catch (err) {
    results.gmail = { ok: false, message: err.message };
  }

  // 5. Anthropic API
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      results.anthropic = { ok: false, message: 'ANTHROPIC_API_KEY saknas i .env' };
    } else {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Svara bara "OK"' }],
        }),
      });
      if (resp.ok) {
        results.anthropic = { ok: true, message: 'API-nyckel fungerar' };
      } else {
        const errData = await resp.json().catch(() => ({}));
        results.anthropic = { ok: false, message: errData.error?.message || `HTTP ${resp.status}` };
      }
    }
  } catch (err) {
    results.anthropic = { ok: false, message: err.message };
  }

  // 6. YouTube API
  try {
    const ytKey = process.env.YOUTUBE_API_KEY;
    if (!ytKey) {
      results.youtube = { ok: false, message: 'YOUTUBE_API_KEY saknas i .env' };
    } else {
      const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1&key=${ytKey}`);
      if (resp.ok) {
        results.youtube = { ok: true, message: 'API-nyckel fungerar' };
      } else {
        const errData = await resp.json().catch(() => ({}));
        results.youtube = { ok: false, message: errData.error?.message || `HTTP ${resp.status}` };
      }
    }
  } catch (err) {
    results.youtube = { ok: false, message: err.message };
  }

  // 7. SerpAPI
  try {
    const serpKey = process.env.SERPAPI_KEY;
    if (!serpKey) {
      results.serpapi = { ok: false, message: 'SERPAPI_KEY saknas i .env' };
    } else {
      const resp = await fetch(`https://serpapi.com/account.json?api_key=${serpKey}`);
      if (resp.ok) {
        const data = await resp.json();
        results.serpapi = { ok: true, message: `Konto OK — ${data.searches_remaining ?? '?'} sökningar kvar` };
      } else {
        results.serpapi = { ok: false, message: `HTTP ${resp.status}` };
      }
    }
  } catch (err) {
    results.serpapi = { ok: false, message: err.message };
  }

  // 8. Apify
  try {
    const apifyToken = process.env.APIFY_API_TOKEN;
    if (!apifyToken) {
      results.apify = { ok: false, message: 'APIFY_API_TOKEN saknas i .env' };
    } else {
      const resp = await fetch('https://api.apify.com/v2/users/me', {
        headers: { 'Authorization': `Bearer ${apifyToken}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        results.apify = { ok: true, message: `Konto: ${data.data?.username || 'OK'}` };
      } else {
        results.apify = { ok: false, message: `HTTP ${resp.status}` };
      }
    }
  } catch (err) {
    results.apify = { ok: false, message: err.message };
  }

  // Sammanfattning
  const allOk = Object.values(results).every(r => r.ok);
  const okCount = Object.values(results).filter(r => r.ok).length;
  const total = Object.keys(results).length;

  res.json({
    allOk,
    summary: `${okCount}/${total} tjänster OK`,
    timestamp: new Date().toISOString(),
    services: results,
  });
});

// Testmail — skicka ett enkelt mail för att verifiera leverans
router.get('/send-test', async (req, res) => {
  try {
    const { sendEmail } = await import('../services/email-service.js');
    const to = req.query.to || 'jimmymunter@hotmail.com';
    const result = await sendEmail({
      to,
      subject: `Partnrr testmail — ${new Date().toLocaleTimeString('sv-SE')}`,
      body: `Detta är ett testmeddelande från Partnrr.\n\nTid: ${new Date().toISOString()}\n\nOm du ser detta mail fungerar e-postleveransen korrekt.`,
    });
    res.json({ ok: true, message: `Testmail skickat till ${to}`, result });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

export default router;
