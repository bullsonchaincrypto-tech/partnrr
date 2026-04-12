import fetch from 'node-fetch';
import dns from 'dns';
import { promisify } from 'util';
import { queryOne, runSql, queryAll } from '../db/schema.js';
import { trackApiCost } from './cost-tracker.js';

const resolveMx = promisify(dns.resolveMx);

/**
 * Hitta e-postadress för en YouTube-kanal automatiskt.
 * VERSION 6 — Optimerad: SerpAPI + MX-validering + sociala länkar.
 *
 * Waterfall med early exit (4 steg):
 * 1. YouTube-beskrivningen — regex på text vi redan har (instant, gratis)
 * 2. SerpAPI — riktiga Google-sökresultat (2-3 queries, stegvis eskalering)
 * 3. Sociala profillänkar — Instagram, hemsidor från beskrivningen
 * 4. DuckDuckGo + Bing (bara om SerpAPI-nyckel saknas)
 *
 * Alla hittade e-poster MX-valideras innan de returneras.
 */

const CONFIDENCE = {
  youtube_description: 'high',
  serpapi_snippet: 'high',
  serpapi_page: 'high',
  duckduckgo: 'medium',
  bing: 'medium',
  social_instagram: 'medium',
  social_twitter: 'medium',
  social_tiktok: 'medium',
  social_facebook: 'medium',
  linked_website: 'medium',
  cache: 'cached',
};

// Cache TTL: 30 dagar
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function findEmailForChannel(channelInfo) {
  const { kanalnamn, namn, beskrivning, kontakt_info } = channelInfo;
  const handle = (kanalnamn || '').replace(/^@/, '');

  // CACHE med TTL
  try {
    const cached = await queryOne('SELECT email, method, updated_at FROM email_cache WHERE kanalnamn = ?', [handle]);
    if (cached?.email) {
      const cacheAge = Date.now() - new Date(cached.updated_at).getTime();
      if (cacheAge < CACHE_TTL_MS) {
        console.log(`[E-post] ⚡ Cache @${handle}: ${cached.email} (${Math.round(cacheAge / 86400000)}d gammal)`);
        return { email: cached.email, method: 'cache', originalMethod: cached.method, confidence: 'cached' };
      } else {
        console.log(`[E-post] ♻️  Cache expired @${handle}, söker igen...`);
      }
    }
  } catch (e) { /* cache miss */ }

  // Hjälpfunktion: MX-validera + spara + returnera
  const found = async (email, method) => {
    const mxValid = await validateMx(email);
    if (!mxValid) {
      console.log(`[E-post] ⚠ MX-check misslyckades för ${email} (${method}) — skippar`);
      return null;
    }
    const confidence = CONFIDENCE[method] || 'low';
    console.log(`[E-post] ✓ ${method} @${handle}: ${email} [${confidence}] [MX: OK]`);
    saveToCache(handle, email, method);
    return { email, method, confidence, mx_valid: true };
  };

  // ── Steg 1: YouTube-beskrivningen (instant, gratis) ──
  let email = extractEmails(beskrivning || '');
  if (!email) email = extractEmails(kontakt_info || '');
  if (email) {
    const result = await found(email, 'youtube_description');
    if (result) return result;
  }

  // ── Steg 2: SerpAPI — riktiga Google-sökresultat ──
  if (handle && process.env.SERPAPI_KEY) {
    const serpResult = await searchWithSerpAPI(handle, { namn });
    if (serpResult) {
      const result = await found(serpResult.email, serpResult.method);
      if (result) return result;
    }
  }

  // ── Steg 3: Sociala profillänkar + länkade webbsidor från beskrivningen ──
  const allLinks = extractAllLinks(beskrivning || '');
  if (allLinks.socialLinks.length > 0 || allLinks.websiteLinks.length > 0) {
    const socialResult = await scrapeSocialAndWebLinks(allLinks);
    if (socialResult) {
      const result = await found(socialResult.email, socialResult.method);
      if (result) return result;
    }
  }

  // ── Steg 4: DuckDuckGo + Bing (bara om SerpAPI saknas) ──
  if (handle && !process.env.SERPAPI_KEY) {
    const searchResult = await searchMultipleEngines(handle);
    if (searchResult) {
      const result = await found(searchResult.email, searchResult.method);
      if (result) return result;
    }
  }

  console.log(`[E-post] ✗ @${handle} — ingen e-post hittad`);
  return { email: null, method: null, confidence: null, mx_valid: null };
}

/**
 * Kör e-postsökning för flera kanaler parallellt.
 */
export async function findEmailsForChannels(channels, concurrency = 8) {
  const results = [];

  for (let i = 0; i < channels.length; i += concurrency) {
    const batch = channels.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(ch =>
        withTimeout(
          findEmailForChannel(ch),
          25000
        ).catch(err => {
          console.error(`[E-post] Timeout/error ${ch.kanalnamn}:`, err.message);
          return { email: null, method: null, confidence: null, error: err.message };
        })
      )
    );

    for (let j = 0; j < batch.length; j++) {
      results.push({
        ...batchResults[j],
        channelIndex: i + j,
        kanalnamn: batch[j].kanalnamn,
      });
    }

    const done = Math.min(i + concurrency, channels.length);
    const foundCount = results.filter(r => r.email).length;
    console.log(`[E-post] Progress: ${done}/${channels.length} kanaler, ${foundCount} e-poster hittade`);
  }

  return results;
}


// ═══════════════════════════════════════════════
// MX-VALIDERING
// ═══════════════════════════════════════════════

async function validateMx(email) {
  try {
    const domain = email.split('@')[1];
    if (!domain) return false;

    const records = await Promise.race([
      resolveMx(domain),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MX timeout')), 5000))
    ]);

    return records && records.length > 0;
  } catch (err) {
    const knownProviders = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'protonmail.com', 'live.se', 'live.com', 'hotmail.se', 'pm.me', 'proton.me'];
    const domain = email.split('@')[1]?.toLowerCase();
    if (knownProviders.includes(domain)) return true;
    console.log(`[E-post] MX-check fel för ${email}: ${err.message}`);
    return false;
  }
}


// ═══════════════════════════════════════════════
// SERPAPI — RIKTIGA GOOGLE-SÖKRESULTAT
// ═══════════════════════════════════════════════

/**
 * Bygg smarta sökfrågor baserat på all tillgänglig data.
 * Mål: maximera chansen att hitta e-post med minimalt antal API-anrop.
 */
function buildSmartQueries(handle, namn) {
  const queries = [];

  const hasRealName = namn && namn.toLowerCase().replace(/\s/g, '') !== handle.toLowerCase();

  // Query 1 (alltid): Handle + e-post-söktermer
  queries.push(`"${handle}" email OR kontakt OR contact`);

  // Query 2: Om vi har riktigt namn — sök på det
  if (hasRealName) {
    queries.push(`"${namn}" email youtube`);
  } else {
    queries.push(`"${handle}" "@gmail.com" OR "@hotmail.com" OR "@outlook.com" OR "@live.se"`);
  }

  // Query 3: Bred sökning
  if (hasRealName) {
    queries.push(`"${namn}" "${handle}" samarbete OR business OR mail`);
  } else {
    queries.push(`"${handle}" youtube samarbete business inquiries email`);
  }

  return queries;
}

/**
 * Sök via SerpAPI (serpapi.com) — riktiga Google-resultat.
 *
 * COST-OPTIMERAD STRATEGI (stegvis eskalering):
 *
 * Fas 1: Kör query 1+2 parallellt (2 API-anrop)
 *         → Kolla snippets + knowledge graph → om träff: KLAR (2 anrop)
 *
 * Fas 2: Följ topp 3 länkar från fas 1 parallellt (0 API-anrop, bara fetch)
 *         → Scrapa huvudsida + /kontakt → om träff: KLAR (2 anrop)
 *
 * Fas 3: Kör query 3 (1 API-anrop till, bara om inget hittat)
 *         → Kolla snippets → följ topp 2 länkar → om träff: KLAR (3 anrop)
 *
 * Bästa fall: 2 API-anrop (snippet-träff)
 * Sämsta fall: 3 API-anrop (inget hittat)
 * Genomsnitt: ~2.2 anrop per influencer
 *
 * 10 influencers: ~22 anrop istället för 30 (27% besparing)
 */
async function searchWithSerpAPI(handle, extra = {}) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return null;

  const { namn } = extra;
  const queries = buildSmartQueries(handle, namn);

  console.log(`[E-post] 🔍 SerpAPI: söker "${handle}"${namn ? ` (${namn})` : ''}...`);

  // ── Fas 1: Query 1+2 parallellt, kolla snippets ──
  const [r1, r2] = await Promise.all([
    serpApiQuery(queries[0], apiKey).catch(() => null),
    serpApiQuery(queries[1], apiKey).catch(() => null),
  ]);

  // Kolla snippets först (snabbast, ingen extra fetch)
  const snippetHit = extractEmailFromSerpResults([r1, r2]);
  if (snippetHit) {
    console.log(`[E-post] 🔍 SerpAPI snippet-träff (fas 1): ${snippetHit.email}`);
    return snippetHit;
  }

  // ── Fas 2: Följ topp 3 länkar (gratis, ingen API-kostnad) ──
  const urls = collectUrls([r1, r2]);
  if (urls.length > 0) {
    console.log(`[E-post] 🔍 SerpAPI: följer ${Math.min(urls.length, 3)} länk(ar)...`);
    const pageHit = await followUrls(urls.slice(0, 3));
    if (pageHit) {
      console.log(`[E-post] 🔍 SerpAPI sida-träff (fas 2): ${pageHit.email} (${pageHit.source})`);
      return pageHit;
    }
  }

  // ── Fas 3: Sista query (bara om inget hittat) ──
  if (queries[2]) {
    console.log(`[E-post] 🔍 SerpAPI: eskalerar till query 3...`);
    const r3 = await serpApiQuery(queries[2], apiKey).catch(() => null);

    const snippetHit3 = extractEmailFromSerpResults([r3]);
    if (snippetHit3) {
      console.log(`[E-post] 🔍 SerpAPI snippet-träff (fas 3): ${snippetHit3.email}`);
      return snippetHit3;
    }

    const urls3 = collectUrls([r3]);
    if (urls3.length > 0) {
      const pageHit3 = await followUrls(urls3.slice(0, 2));
      if (pageHit3) {
        console.log(`[E-post] 🔍 SerpAPI sida-träff (fas 3): ${pageHit3.email} (${pageHit3.source})`);
        return pageHit3;
      }
    }
  }

  return null;
}

/** Extrahera e-post från SerpAPI snippets + knowledge graph */
function extractEmailFromSerpResults(results) {
  for (const r of results) {
    if (!r) continue;

    // Snippets
    if (r.organic_results) {
      for (const item of r.organic_results) {
        const text = `${item.title || ''} ${item.snippet || ''} ${item.rich_snippet?.top?.extensions?.join(' ') || ''}`;
        const email = extractEmails(text);
        if (email) return { email, method: 'serpapi_snippet', source: item.link };
      }
    }

    // Knowledge graph
    if (r.knowledge_graph) {
      const email = extractEmails(JSON.stringify(r.knowledge_graph));
      if (email) return { email, method: 'serpapi_snippet', source: 'knowledge_graph' };
    }
  }
  return null;
}

/** Samla unika URLs från SerpAPI-resultat, filtrerade */
function collectUrls(results) {
  const urls = [];
  const seenDomains = new Set();
  const skipDomains = ['youtube.com', 'youtu.be', 'reddit.com', 'wikipedia.org', 'twitch.tv', 'imdb.com', 'pinterest.com', 'quora.com'];

  for (const r of results) {
    if (!r?.organic_results) continue;
    for (const item of r.organic_results) {
      const url = item.link;
      if (!url) continue;
      if (skipDomains.some(d => url.includes(d))) continue;
      try {
        const domain = new URL(url).hostname;
        if (seenDomains.has(domain)) continue;
        seenDomains.add(domain);
      } catch { continue; }
      urls.push(url);
    }
  }
  return urls;
}

/** Följ URLs parallellt: hämta huvudsida + /kontakt parallellt per URL */
async function followUrls(urls) {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const base = new URL(url).origin;
        // Hämta huvudsida + kontaktsida parallellt (snabbare)
        const [mainEmail, kontaktEmail] = await Promise.all([
          fetchPageEmail(url, 4000),
          fetchPageEmail(`${base}/kontakt`, 3000).catch(() => null),
        ]);

        if (mainEmail) return { email: mainEmail, method: 'serpapi_page', source: url };
        if (kontaktEmail) return { email: kontaktEmail, method: 'serpapi_page', source: `${base}/kontakt` };

        // Fallback: /contact (engelska sajter)
        const contactEmail = await fetchPageEmail(`${base}/contact`, 3000);
        if (contactEmail) return { email: contactEmail, method: 'serpapi_page', source: `${base}/contact` };
      } catch { /* ignore */ }
      return null;
    })
  );

  return results.find(r => r !== null) || null;
}

async function serpApiQuery(query, apiKey) {
  const params = new URLSearchParams({
    api_key: apiKey,
    engine: 'google',
    q: query,
    gl: 'se',        // Sverige
    hl: 'sv',        // Svenska
    num: '10',       // 10 resultat
  });

  const url = `https://serpapi.com/search.json?${params}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.log(`[E-post] SerpAPI-fel (${res.status}): ${errText.slice(0, 200)}`);
      return null;
    }
    trackApiCost({ service: 'serpapi', endpoint: 'search' });
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    console.log(`[E-post] SerpAPI nätverksfel: ${e.message}`);
    return null;
  }
}


// ═══════════════════════════════════════════════
// SOCIALA PROFILLÄNKAR
// ═══════════════════════════════════════════════

function extractAllLinks(text) {
  if (!text) return { socialLinks: [], websiteLinks: [] };

  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
  const matches = text.match(urlRegex) || [];

  const socialDomains = {
    'instagram.com': 'instagram',
    'twitter.com': 'twitter',
    'x.com': 'twitter',
    'tiktok.com': 'tiktok',
    'facebook.com': 'facebook',
  };

  const skipDomains = ['youtube.com', 'youtu.be', 'twitch.tv', 'discord.gg', 'discord.com', 'snapchat.com', 'bit.ly', 'linktr.ee'];

  const socialLinks = [];
  const websiteLinks = [];

  for (const url of matches) {
    if (skipDomains.some(d => url.includes(d))) continue;

    let isSocial = false;
    for (const [domain, platform] of Object.entries(socialDomains)) {
      if (url.includes(domain)) {
        socialLinks.push({ url, platform });
        isSocial = true;
        break;
      }
    }

    if (!isSocial) {
      websiteLinks.push(url);
    }
  }

  return { socialLinks: socialLinks.slice(0, 4), websiteLinks: websiteLinks.slice(0, 3) };
}

async function scrapeSocialAndWebLinks({ socialLinks, websiteLinks }) {
  const tasks = [];

  for (const { url, platform } of socialLinks) {
    tasks.push(scrapeSocialProfile(url, platform));
  }

  for (const url of websiteLinks) {
    tasks.push(scrapeWebsiteForEmail(url));
  }

  const results = await Promise.all(tasks.map(p => p.catch(() => null)));
  return results.find(r => r !== null) || null;
}

async function scrapeSocialProfile(url, platform) {
  const html = await quickFetch(url, 4000);
  if (!html) return null;

  const email = extractEmails(html);
  if (email) {
    return { email, method: `social_${platform}`, source: url };
  }
  return null;
}

async function scrapeWebsiteForEmail(url) {
  let email = await fetchPageEmail(url, 3000);
  if (email) return { email, method: 'linked_website', source: url };

  try {
    const base = new URL(url).origin;
    const contactPages = ['/contact', '/kontakt', '/about', '/om', '/om-oss', '/kontakta-oss'];

    const contactResults = await Promise.all(
      contactPages.map(async (path) => {
        const e = await fetchPageEmail(`${base}${path}`, 3000);
        return e ? { email: e, method: 'linked_website', source: `${base}${path}` } : null;
      })
    );

    return contactResults.find(r => r !== null) || null;
  } catch {
    return null;
  }
}


// ═══════════════════════════════════════════════
// SÖKMOTORER — DUCKDUCKGO + BING (fallback)
// ═══════════════════════════════════════════════

async function searchMultipleEngines(handle) {
  const searches = [
    searchDuckDuckGo(`${handle} email`),
    searchDuckDuckGo(`${handle} kontakt email`),
    searchBing(`${handle} email`),
    searchBing(`${handle} youtube kontakt`),
  ];

  const results = await Promise.all(
    searches.map(p => p.catch(() => null))
  );

  for (const r of results) {
    if (r?.email) return r;
  }
  return null;
}

async function searchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await quickFetch(url, 5000);
  if (!html) return null;
  if (html.includes('error-lite') || html.includes('Something went wrong') || !html.includes('result__')) return null;

  const email = extractEmails(html);
  if (email) return { email, method: 'duckduckgo', source: query };
  return null;
}

async function searchBing(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=sv`;
  const html = await quickFetch(url, 5000);
  if (!html) return null;

  const email = extractEmails(html);
  if (email) return { email, method: 'bing', source: query };
  return null;
}


// ═══════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════

async function saveToCache(handle, email, method) {
  try {
    const existing = await queryOne('SELECT id FROM email_cache WHERE kanalnamn = ?', [handle]);
    if (existing) {
      await runSql('UPDATE email_cache SET email = ?, method = ?, updated_at = datetime("now") WHERE kanalnamn = ?', [email, method, handle]);
    } else {
      await runSql('INSERT INTO email_cache (kanalnamn, email, method) VALUES (?, ?, ?)', [handle, email, method]);
    }
    console.log(`[E-post] 💾 Cachad @${handle}: ${email} (${method})`);
  } catch (e) {
    console.error(`[E-post] Cache-fel:`, e.message);
  }
}


// ═══════════════════════════════════════════════
// HJÄLPFUNKTIONER
// ═══════════════════════════════════════════════

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms))
  ]);
}

async function quickFetch(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function fetchPageEmail(url, timeoutMs = 4000) {
  try {
    if (!url.startsWith('http')) url = `https://${url}`;
    const html = await quickFetch(url, timeoutMs);
    if (!html) return null;
    return extractEmails(html);
  } catch {
    return null;
  }
}

function extractDuckDuckGoUrls(html) {
  const urlRegex = /class="result__a" href="([^"]+)"/g;
  const urls = [];
  let match;
  while ((match = urlRegex.exec(html)) !== null) {
    let url = match[1];
    if (url.startsWith('//duckduckgo.com/l/?')) {
      const uddg = url.match(/uddg=(https?[^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      else continue;
    }
    if (!url.startsWith('http')) continue;

    const skip = ['youtube.com', 'instagram.com', 'tiktok.com', 'facebook.com', 'twitter.com', 'x.com', 'reddit.com', 'wikipedia.org', 'twitch.tv'];
    if (!skip.some(d => url.includes(d))) {
      urls.push(url);
    }
  }
  return urls.slice(0, 3);
}

function extractEmails(text) {
  if (!text) return null;

  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex);
  if (!matches) return null;

  const blacklist = [
    'noreply', 'no-reply', 'no_reply',
    'example.com', 'example.org',
    'test@', 'admin@', 'root@',
    'support@google', 'support@youtube',
    'info@google', 'info@youtube',
    'privacy@', 'abuse@', 'postmaster@',
    'mailer-daemon', 'donotreply',
    'notifications@', 'alert@',
    'schema.org', 'w3.org', 'json-ld',
    'sentry.io', 'github.com',
    'wixpress.com', 'sentry-next',
    'cloudflare.com', 'wordpress.org',
    'googleapis.com', 'gstatic.com',
    'gravatar.com', 'wp.com',
    'google.com', 'youtube.com',
    'facebook.com', 'twitter.com',
    'apple.com', 'microsoft.com',
    'amazon.com', 'adobe.com',
    'jsdelivr.net', 'bootstrapcdn.com',
    'fontawesome.com',
    'duckduckgo.com', 'bing.com',
    'error-lite@', 'error@',
    'tailwindcss.com', 'react.dev',
    'iana.org', 'creativecommons.org',
    'serpapi.com',
    // Analytics, stats & tool platforms (ej influencer-mejl)
    'playboard.co', 'socialblade.com', 'noxinfluencer.com',
    'hypeauditor.com', 'tubular.io', 'vidiq.com',
    'channelcrawler.com', 'statsheep.com',
    'recaptcha@', 'captcha@',
  ];

  const filtered = [...new Set(matches)].filter(email => {
    const lower = email.toLowerCase();
    if (blacklist.some(bl => lower.includes(bl))) return false;
    if (email.length > 60) return false;
    if (!/\.[a-z]{2,6}$/i.test(email)) return false;
    return true;
  });

  if (filtered.length === 0) return null;

  // Prioritera: business/kontakt-adresser
  const priorityKeywords = ['business', 'kontakt', 'contact', 'samarbete', 'collab', 'booking', 'press', 'media', 'management', 'mgmt', 'info@', 'hello@', 'hej@'];
  const prioritized = filtered.find(e =>
    priorityKeywords.some(kw => e.toLowerCase().includes(kw))
  );

  return prioritized || filtered[0];
}
