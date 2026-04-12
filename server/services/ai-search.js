/**
 * AI-Driven Influencer Search med SerpAPI multi-engine + Claude Sonnet
 *
 * Arkitektur (v4 — multi-engine):
 *
 *   STEG 1a: Google Short Videos API (engine: google_short_videos)
 *     → TikTok, Instagram Reels, YouTube Shorts — strukturerad data
 *     → Returnerar: channel, source (plattform), title, link
 *
 *   STEG 1b: Google Search (engine: google) med site:-operatorer
 *     → Profiler, listor, artiklar om influencers
 *     → Returnerar: title, snippet, url
 *
 *   STEG 2: Claude Sonnet analyserar ALLA resultat → JSON-array
 *
 *   Fallback: Claude web_search om SerpAPI ger 429
 *
 * Kostnad per sökning:
 *   SerpAPI-väg:  2 × $0.025 + Sonnet ≈ $0.06 = ~0.6 SEK
 *   Fallback-väg: Sonnet + web_search ≈ $0.08 = ~0.8 SEK
 *   Mål: Under 2 SEK — uppnått!
 *
 * Cache: SerpAPI-resultat cachas i SQLite (24h TTL).
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import { trackApiCost } from './cost-tracker.js';

const MODEL_DEFAULT = 'claude-sonnet-4-6';

let _client = null;
function getClient() {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY saknas');
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

// ============================================================
// SERP CACHE — undvik dubbletter, spara SerpAPI-kvota
// ============================================================

let _dbModule = null;
async function getDb() {
  if (!_dbModule) {
    _dbModule = await import('../db/schema.js');
  }
  return _dbModule;
}

async function getCachedSerpResults(cacheKey) {
  try {
    const { queryOne } = await getDb();
    const row = await queryOne(
      `SELECT data FROM influencer_search_cache
       WHERE cache_key = ? AND created_at > datetime('now', '-24 hours')`,
      [cacheKey]
    );
    if (row?.data) {
      console.log(`[SerpCache] HIT: ${cacheKey}`);
      return JSON.parse(row.data);
    }
  } catch (e) {
    console.warn('[SerpCache] Read error:', e.message);
  }
  return null;
}

async function setCachedSerpResults(cacheKey, data) {
  try {
    const { runSql } = await getDb();
    await runSql(
      `INSERT OR REPLACE INTO influencer_search_cache (cache_key, data, created_at)
       VALUES (?, ?, datetime('now'))`,
      [cacheKey, JSON.stringify(data)]
    );
  } catch (e) {
    console.warn('[SerpCache] Write error:', e.message);
  }
}

// ============================================================
// CLAUDE API HELPERS
// ============================================================

async function callClaude(systemPrompt, userMessage, maxTokens = 4000, { model = MODEL_DEFAULT, retries = 2 } = {}) {
  const client = getClient();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      trackApiCost({
        service: 'anthropic',
        endpoint: 'callClaude',
        tokens_input: response.usage?.input_tokens || 0,
        tokens_output: response.usage?.output_tokens || 0,
        model: response.model || model,
      });

      const textBlock = response.content.find(b => b.type === 'text');
      return textBlock?.text || '';
    } catch (err) {
      if (err.status === 429 && attempt < retries) {
        console.log(`[AI] Rate limit — väntar 15s (${attempt + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, 15000));
        continue;
      }
      console.error(`[AI-Search] API-fel:`, err.message);
      throw new Error(`AI-sökning misslyckades: ${err.message}`);
    }
  }
}

async function callClaudeWithWebSearch(systemPrompt, userMessage, maxTokens = 8000, { model = MODEL_DEFAULT, retries = 2, maxSearches = 5 } = {}) {
  const client = getClient();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }],
      });

      if (response.usage) {
        trackApiCost({
          service: 'anthropic',
          endpoint: 'webSearch',
          tokens_input: response.usage.input_tokens || 0,
          tokens_output: response.usage.output_tokens || 0,
          model: response.model || model,
        });
      }

      const contentTypes = response.content.map(b => b.type);
      console.log(`[AI-Search] Response: stop=${response.stop_reason}, types: [${contentTypes.join(', ')}]`);

      const textBlocks = response.content.filter(b => b.type === 'text');
      const fullText = textBlocks.map(b => b.text).join('\n');

      if (!fullText) {
        console.error('[AI-Search] Inget text-content! Types:', contentTypes);
        throw new Error('AI returnerade inget text-svar');
      }

      return fullText;
    } catch (err) {
      if (err.status === 429 && attempt < retries) {
        console.log(`[AI] Rate limit — väntar 15s (${attempt + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, 15000));
        continue;
      }
      console.error(`[AI-Search] Web search fel:`, err.message, err.status || '');
      if (err.status === 401) throw new Error('Anthropic API-nyckel ogiltig. Kontrollera ANTHROPIC_API_KEY i .env');
      if (err.status === 400) throw new Error(`Anthropic API bad request: ${err.message}`);
      throw new Error(`AI web search misslyckades: ${err.message}`);
    }
  }

  throw new Error('Max antal retries nått');
}

function parseJSON(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('Tomt AI-svar — ingen text returnerades');
  }

  console.log(`[AI-Search] Parsar svar (${text.length} tecken), börjar med: ${text.slice(0, 100)}...`);

  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (e) {
      console.warn('[AI-Search] JSON-array parsning misslyckades:', e.message);
    }
  }

  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch (e) {
      console.warn('[AI-Search] JSON-objekt parsning misslyckades:', e.message);
    }
  }

  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch (e) {
      console.warn('[AI-Search] Code block parsning misslyckades:', e.message);
    }
  }

  console.error('[AI-Search] Kunde inte parsa JSON. Svar:', text.slice(0, 500));
  throw new Error('Kunde inte parsa JSON från AI-svar');
}

// ============================================================
// SERPAPI MULTI-ENGINE SÖKNING
// ============================================================

/**
 * Generisk SerpAPI-anrop med cache.
 * Returnerar null vid 429/error (triggar fallback).
 */
async function serpApiQuery(params, cachePrefix) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.warn('[SerpAPI] Ingen API-nyckel konfigurerad');
    return null;
  }

  const cacheKey = `${cachePrefix}_${JSON.stringify(params).replace(/[^a-z0-9]/gi, '').slice(0, 100)}`;
  const cached = await getCachedSerpResults(cacheKey);
  if (cached) return cached;

  try {
    const allParams = new URLSearchParams({ api_key: apiKey, ...params });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(`https://serpapi.com/search.json?${allParams}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 429) {
      console.warn(`[SerpAPI] 429 Rate limit/kvota slut (engine: ${params.engine})`);
      return null;
    }

    if (!res.ok) {
      console.warn(`[SerpAPI] ${res.status} (engine: ${params.engine})`);
      return null;
    }

    trackApiCost({ service: 'serpapi', endpoint: params.engine || 'search' });

    const data = await res.json();
    await setCachedSerpResults(cacheKey, data);
    return data;
  } catch (err) {
    console.warn(`[SerpAPI] Sökning misslyckades (${params.engine}): ${err.message}`);
    return null;
  }
}

/**
 * Steg 1a: Google Short Videos — hitta TikTok/Instagram/YouTube Shorts-kreatörer
 * Returnerar strukturerad data: channel, source (plattform), title, link
 */
async function searchShortVideos(query) {
  console.log(`[SerpAPI] Short Videos: "${query}"`);

  const data = await serpApiQuery({
    engine: 'google_short_videos',
    q: query,
    hl: 'sv',
    gl: 'se',
    device: 'desktop',
  }, 'sv');

  if (!data) return [];

  const results = (data.short_video_results || []).map(item => ({
    type: 'short_video',
    title: item.title || '',
    link: item.link || '',
    source: (item.source || '').toLowerCase(), // youtube, tiktok, instagram, facebook
    channel: item.channel || '',
    duration: item.duration || '',
  }));

  console.log(`[SerpAPI] Short Videos → ${results.length} resultat (${results.map(r => r.source).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`);
  return results;
}

/**
 * Steg 1b: Google Search med site:-operatorer — hitta profiler & artiklar
 */
async function searchGoogle(query) {
  console.log(`[SerpAPI] Google: "${query}"`);

  const data = await serpApiQuery({
    engine: 'google',
    q: query,
    hl: 'sv',
    gl: 'se',
    num: '10',
  }, 'gs');

  if (!data) return [];

  const results = (data.organic_results || []).slice(0, 8).map(item => ({
    type: 'organic',
    title: item.title || '',
    snippet: item.snippet || '',
    url: item.link || '',
  }));

  console.log(`[SerpAPI] Google → ${results.length} resultat`);
  return results;
}

/**
 * STEG 0: AI tolkar företagets beskrivning och genererar optimala söktermer.
 * Returnerar { shortVideoQuery, googleQuery, nischKeywords }.
 *
 * Detta ersätter den statiska nisch-mappningen — Claude förstår alla branscher
 * och genererar exakt rätt söktermer oavsett hur beskrivningen formuleras.
 */
export async function buildSearchQueries({ companyName, beskrivning, nischer, platforms }) {
  const platformList = (platforms || ['instagram']).map(p => p.toLowerCase());
  const nischStr = (nischer || []).join(', ');

  // ── AI-genererade söktermer (primär väg) ──
  let nischKeywords = '';
  try {
    const systemPrompt = `Du är en sökterms-expert. Givet en företagsbeskrivning, generera de BÄSTA Google-söktermerna för att hitta svenska influencers som passar företaget.

REGLER:
- Svara med ENBART ett JSON-objekt, ingen annan text
- "nisch_keywords" = 3-6 nyckelord som beskriver vilken typ av influencer som passar (svenska termer)
- "short_video_query" = en Google Short Videos-sökfråga (max 8 ord) för att hitta TikTok/Instagram Reels-kreatörer
- "google_queries" = array med 2-3 Google-sökfrågor med site:-operatorer för att hitta profiler
- Fokusera på den EXAKTA branschen — inte breda termer
- Tänk: vilka typer av influencers skulle ett sådant företag vilja samarbeta med?

EXEMPEL:
Beskrivning: "Vi säljer smarta produkter inom hemelektronik"
→ nisch_keywords: "tech elektronik gadgets unboxing recension prylar"
→ short_video_query: "svenska tech gadgets elektronik review"
→ google_queries: ["site:instagram.com svenska tech influencer gadgets elektronik", "site:tiktok.com svensk tech review prylar unboxing"]

Beskrivning: "Ekologiska kryddor och marinader"
→ nisch_keywords: "mat matlagning recept kryddor foodie"
→ short_video_query: "svenska matlagning kryddor recept influencer"
→ google_queries: ["site:instagram.com svensk matbloggare foodie kryddor", "site:tiktok.com svenska matlagning recept foodie"]`;

    const userMessage = `FÖRETAG: ${companyName}
BESKRIVNING: ${beskrivning || 'Ej angiven'}
BRANSCH: ${nischStr || 'Ej angiven'}
PLATTFORMAR: ${platformList.join(', ')}

Generera optimala söktermer. Svara med ENBART JSON:
{
  "nisch_keywords": "...",
  "short_video_query": "...",
  "google_queries": ["...", "..."]
}`;

    console.log(`[AI-Search] Steg 0: AI genererar söktermer för "${beskrivning?.slice(0, 80) || companyName}"...`);
    const raw = await callClaude(systemPrompt, userMessage, 500, { model: MODEL_DEFAULT });
    const parsed = parseJSON(raw);

    if (parsed.nisch_keywords) {
      nischKeywords = parsed.nisch_keywords;

      // Bygg queries från AI-svaret
      const shortVideoQuery = parsed.short_video_query || `svenska ${nischKeywords} influencer`;

      // Google queries — använd AI-genererade eller bygg från nisch_keywords
      let googleQuery = '';
      if (parsed.google_queries?.length > 0) {
        // Filtrera till bara de plattformar användaren valt
        const relevantQueries = parsed.google_queries.filter(q => {
          if (platformList.includes('instagram') && q.includes('instagram.com')) return true;
          if (platformList.includes('tiktok') && q.includes('tiktok.com')) return true;
          return false;
        });
        googleQuery = relevantQueries[0] || parsed.google_queries[0] || '';
      }

      if (!googleQuery) {
        // Fallback: bygg Google query manuellt
        const siteOps = platformList.map(p => {
          if (p === 'instagram') return 'site:instagram.com';
          if (p === 'tiktok') return 'site:tiktok.com';
          return '';
        }).filter(Boolean);
        googleQuery = siteOps.length > 0
          ? `(${siteOps.join(' OR ')}) svenska ${nischKeywords} influencer 2025`
          : `svenska ${nischKeywords} influencer ${platformList.join(' ')} 2025`;
      }

      console.log(`[AI-Search] ✅ AI-genererade termer: "${nischKeywords}"`);
      console.log(`[AI-Search]    Short Videos: "${shortVideoQuery}"`);
      console.log(`[AI-Search]    Google: "${googleQuery}"`);

      return { shortVideoQuery, googleQuery, nischKeywords };
    }
  } catch (err) {
    console.warn(`[AI-Search] ⚠️ AI-söktermsgenerering misslyckades: ${err.message} — faller tillbaka på statisk mappning`);
  }

  // ── Fallback: statisk nisch-extraktion (om AI misslyckas) ──
  if (!nischKeywords) {
    if (beskrivning) {
      const stopwords = new Set(['vi', 'och', 'i', 'på', 'för', 'med', 'som', 'är', 'ett', 'en', 'av', 'till', 'det', 'att', 'den', 'de', 'har', 'vara', 'vill', 'ska', 'kan', 'inte', 'alla', 'från', 'vår', 'våra', 'sin', 'sina', 'sitt', 'gör', 'säljer', 'samarbeta', 'unga', 'vuxna', 'företag', 'produkter', 'inom']);
      const words = beskrivning.toLowerCase().replace(/[^a-zåäö\s-]/g, '').split(/\s+/).filter(w => w.length > 3 && !stopwords.has(w));
      nischKeywords = words.slice(0, 5).join(' ') || companyName;
    } else {
      nischKeywords = nischStr || companyName;
    }
    console.log(`[AI-Search] Fallback söktermer: "${nischKeywords}"`);
  }

  const shortVideoQuery = `svenska ${nischKeywords} influencer`;
  const siteOps = platformList.map(p => {
    if (p === 'instagram') return 'site:instagram.com';
    if (p === 'tiktok') return 'site:tiktok.com';
    return '';
  }).filter(Boolean);
  const googleQuery = siteOps.length > 0
    ? `(${siteOps.join(' OR ')}) svenska ${nischKeywords} influencer 2025`
    : `svenska ${nischKeywords} influencer ${platformList.join(' ')} 2025`;

  return { shortVideoQuery, googleQuery, nischKeywords };
}

// ============================================================
// INFLUENCER-SÖKNING: Multi-engine SerpAPI → Sonnet
// ============================================================

export async function searchInfluencersAI({ companyName, industry, nischer, platforms, budget, audience_age, goal, previousCollabs, beskrivning, erbjudande_typ, syfte, apifyDiscoveryData }) {
  const platformStr = (platforms || ['youtube']).join(', ');
  const nischStr = (nischer || []).join(', ');

  const { shortVideoQuery, googleQuery, nischKeywords } = await buildSearchQueries({ companyName, beskrivning, nischer, platforms });

  // ── STEG 1: Parallella SerpAPI-sökningar (2 queries) ──
  console.log(`[AI-Search] Steg 1: Multi-engine sökning...`);
  console.log(`  [Short Videos] "${shortVideoQuery}"`);
  console.log(`  [Google]        "${googleQuery}"`);

  const [shortVideoResults, googleResults] = await Promise.all([
    searchShortVideos(shortVideoQuery),
    searchGoogle(googleQuery),
  ]);

  const totalResults = shortVideoResults.length + googleResults.length;
  const serpWorked = totalResults > 0;

  // ── STEG 2+3: Sonnet analyserar SerpAPI + Apify discovery ──
  const hasApifyData = apifyDiscoveryData && (apifyDiscoveryData.instagram?.length > 0 || apifyDiscoveryData.tiktok?.length > 0);
  const hasAnyData = serpWorked || hasApifyData;

  if (hasAnyData) {
    console.log(`[AI-Search] SerpAPI: ${shortVideoResults.length} short videos + ${googleResults.length} organic = ${totalResults} totalt`);
    if (hasApifyData) {
      console.log(`[AI-Search] Apify Discovery: ${apifyDiscoveryData.instagram?.length || 0} IG + ${apifyDiscoveryData.tiktok?.length || 0} TT creators`);
    }

    // Formatera Short Videos som strukturerad data
    const svData = shortVideoResults.length > 0
      ? 'SHORT VIDEOS (TikTok/Instagram Reels/YouTube Shorts):\n' +
        shortVideoResults.map(r => `  ${r.channel} [${r.source}] — "${r.title}" (${r.link})`).join('\n')
      : '';

    // Formatera Google-resultat
    const gsData = googleResults.length > 0
      ? 'GOOGLE-SÖKRESULTAT:\n' +
        googleResults.map(r => `  ${r.title} | ${r.snippet} | ${r.url}`).join('\n')
      : '';

    // Formatera Apify discovery-resultat
    let apifyData = '';
    if (hasApifyData) {
      const { formatDiscoveryForClaude } = await import('./apify-discovery.js');
      apifyData = formatDiscoveryForClaude(apifyDiscoveryData);
    }

    const condensed = [svData, gsData, apifyData].filter(Boolean).join('\n\n').slice(0, 10000);

    const systemPrompt = `Du är en expert på influencer-marknadsföring i Sverige. Du får data från FLERA KÄLLOR:
1. Google Short Videos (TikTok/Instagram Reels/YouTube Shorts)
2. Google-sökresultat (profiler, listor, artiklar)
3. Apify Instagram Discovery (creators hittade via hashtag-sökning på Instagram)
4. Apify TikTok Discovery (creators hittade via hashtag-sökning på TikTok)

UPPGIFT:
Analysera ALLA resultat och identifiera de BÄSTA svenska influencers som matchar företaget.
Returnera ENBART en JSON-array — ingen annan text.

STRIKT MATCHNINGSKRAV:
- Matcha influencers som är relevanta för EXAKT det företaget erbjuder
- Om företaget säljer kryddor/mat → hitta matbloggare, foodie-influencers, kock-profiler
- Om företaget handlar om fantasy fotboll → hitta fotbollsanalytiker, fantasy sports-kreatörer, tipsters
- Om företaget säljer kläder → hitta mode-influencers, stilbloggare
- SKIPPA profiler som inte matchar det specifika erbjudandet — en fitness-influencer passar INTE ett matföretag
- Short Videos-resultaten ger KANALNAMN och PLATTFORM direkt — använd dessa!
- Apify Discovery ger RIKTIGA Instagram/TikTok-handles som är aktiva i relevanta hashtags — dessa är ofta de bästa resultaten!
- Inkludera BARA profiler du hittar bevis för i sökresultaten
- Ange BARA kanalnamn som nämns i resultaten — hitta ALDRIG PÅ kanalnamn
- Hellre 5 träffsäkra resultat än 20 dåliga — NISCH-MATCHNING ÄR VIKTIGARE ÄN KVANTITET

VIKTIGT OM DATA:
- Följarantal: ange BARA om det EXAKT nämns i sökresultaten (Apify TikTok ger ofta followers), annars null
- profil_beskrivning: ange BARA text som DIREKT citeras i sökresultaten. HITTA ALDRIG PÅ beskrivningar.
  Om du inte har exakt text från profilen, sätt till null. Apify hämtar riktig bio senare.
- GISSA ALDRIG innehåll — om du inte ser det i sökresultaten, sätt null
- Apify Discovery-creators som har många posts/videos i hashtaggen är troligen mer relevanta

Svara med ENBART en JSON-array, inget annat.`;

    const userMessage = `FÖRETAG: ${companyName}
BESKRIVNING: ${beskrivning || 'Ej angiven'}
BRANSCH: ${industry || nischStr || 'gaming'}
PLATTFORMAR: ${platformStr}
${budget ? `BUDGET: ${budget}` : ''}
${goal ? `MÅL: ${goal}` : ''}

${condensed}

Baserat på resultaten ovan, extrahera upp till 20 SVENSKA influencers.
VIKTIGT: Inkludera BARA profiler som skapar innehåll PÅ SVENSKA eller riktar sig till en SVENSK publik.
Uteslut internationella/engelskspråkiga profiler även om de är relevanta ämnesvis.
Returnera JSON-array:
[
  {
    "namn": "Influencerns riktiga namn eller kanalnamn",
    "kanalnamn": "@kanalnamn",
    "plattform": "instagram|tiktok|youtube",
    "foljare": null,
    "nisch": "t.ex. tech elektronik, matlagning",
    "profil_beskrivning": null,
    "kontakt_epost": null,
    "ai_score": 85,
    "ai_motivation": "Varför denna influencer passar ${companyName}"
  }
]

REGLER FÖR FÄLTEN:
- foljare: BARA exakt siffra om den står i sökresultaten, annars ALLTID null
- profil_beskrivning: BARA exakt citat från sökresultaten, annars ALLTID null (Apify hämtar sen)
- kontakt_epost: BARA om den syns i sökresultaten, annars null

ENBART JSON. Inga kommentarer.`;

    const allDataCount = totalResults + (apifyDiscoveryData?.instagram?.length || 0) + (apifyDiscoveryData?.tiktok?.length || 0);
    console.log(`[AI-Search] Steg 3: Sonnet analyserar ${allDataCount} datapunkter (SerpAPI + Apify)...`);
    const raw = await callClaude(systemPrompt, userMessage, 5000);
    const influencers = parseJSON(raw);

    console.log(`[AI-Search] ✅ ${influencers.length} influencers (SerpAPI + Apify Discovery → Sonnet)`);
    return normalizeResults(influencers);
  }

  // ── FALLBACK: Claude web_search (om SerpAPI misslyckades helt) ──
  console.log(`[AI-Search] ⚠️ SerpAPI misslyckades — fallback till Claude web_search`);

  const fallbackSystemPrompt = `Du är en expert på influencer-marknadsföring i Sverige. Använd web_search för att hitta relevanta svenska influencers.

STRIKT MATCHNINGSKRAV:
- Matcha influencers som är relevanta för EXAKT det företaget erbjuder
- Om företaget säljer mat/kryddor → hitta matbloggare, foodie-influencers, kock-profiler
- Om företaget handlar om fantasy fotboll → hitta fotbollsanalytiker, tipsters
- SKIPPA profiler som inte matchar nischen — en fitness-influencer passar INTE ett matföretag
- Hellre 5 träffsäkra resultat än 20 dåliga — NISCH-MATCHNING ÄR VIKTIGAST

Svara med ENBART en JSON-array — ingen annan text.`;

  const fallbackUserMessage = `FÖRETAG: ${companyName}
BESKRIVNING: ${beskrivning || 'Ej angiven'}
BRANSCH: ${industry || nischStr || 'gaming'}
PLATTFORMAR: ${platformStr}

Sök webben och hitta upp till 20 SVENSKA influencers som passar detta företag.
VIKTIGT: Inkludera BARA profiler som skapar innehåll PÅ SVENSKA eller riktar sig till en SVENSK publik.
Uteslut internationella/engelskspråkiga profiler.
Returnera JSON-array:
[
  {
    "namn": "Influencerns riktiga namn",
    "kanalnamn": "@kanalnamn",
    "plattform": "instagram|tiktok",
    "foljare": 50000 eller null,
    "nisch": "t.ex. fantasy fotboll",
    "profil_beskrivning": "Kort beskrivning",
    "kontakt_epost": "email@example.com eller null",
    "ai_score": 85,
    "ai_motivation": "Varför denna influencer passar ${companyName}"
  }
]

ENBART JSON. Inga kommentarer.`;

  const raw = await callClaudeWithWebSearch(fallbackSystemPrompt, fallbackUserMessage, 8000, { maxSearches: 3 });
  const influencers = parseJSON(raw);

  console.log(`[AI-Search] ✅ ${influencers.length} influencers (Claude web_search fallback)`);
  return normalizeResults(influencers);
}

/**
 * Exporterad helper: Generera AI-drivna nisch-keywords som andra moduler (t.ex. YouTube-sökning) kan använda.
 * Returnerar en array av söktermer.
 */
export async function generateNischKeywords(beskrivning, companyName) {
  try {
    const result = await buildSearchQueries({ companyName: companyName || '', beskrivning, nischer: [], platforms: ['youtube'] });
    if (result.nischKeywords) {
      // Splitta keywords till en array av labels
      return result.nischKeywords.split(/\s+/).filter(w => w.length > 2);
    }
  } catch (err) {
    console.warn('[AI-Search] generateNischKeywords misslyckades:', err.message);
  }
  return [];
}

function normalizeResults(influencers) {
  return influencers.map((inf, i) => ({
    ...inf,
    kanalnamn: (inf.kanalnamn || '').replace(/^@+/, ''),
    id: `ai-${Date.now()}-${i}`,
    datakalla: 'ai_serp_search',
    sokt_at: new Date().toISOString(),
    foljare: inf.foljare || null,
    ai_score: (inf.ai_score && inf.ai_score > 0) ? inf.ai_score : 85,
    engagemang_procent: inf.engagemang_procent || null,
    profil_beskrivning: inf.profil_beskrivning || '',
  }));
}

// ============================================================
// E-POSTSÖKNING MED WEB SEARCH
// ============================================================

export async function findEmailAI({ namn, kanalnamn, plattform }) {
  const systemPrompt = `Du hittar kontaktinformation för influencers genom att söka på webben. Sök efter deras e-post via sociala profiler, "om"-sidor, kontaktsidor, och liknande.

REGLER:
- Sök webben efter deras riktiga kontaktinfo
- Business/samarbete-adresser är bättre än personliga
- Ange aldrig noreply@, admin@, eller system-adresser
- Om du hittar e-post, ange confidence "high" om den kommer direkt från profilen

Svara ENBART med JSON.`;

  const userMessage = `Hitta kontakt-e-post för:
Namn: ${namn}
Kanal: ${kanalnamn}
Plattform: ${plattform}

Sök webben efter deras e-postadress. Kolla YouTube "Om"-sida, Instagram bio, TikTok bio, egna hemsidor, etc.

Svara med JSON:
{
  "email": "hittad@email.com eller null",
  "confidence": "high|medium|low|none",
  "metod": "profile_bio|website|search_result|guess",
  "kalla": "Var hittade du e-posten",
  "alternativa_emails": ["alt1@email.com"],
  "notering": "Kort notering"
}`;

  console.log(`[AI-Email] Söker e-post för ${namn} (${kanalnamn}) via web search...`);

  const raw = await callClaudeWithWebSearch(systemPrompt, userMessage, 2000, { maxSearches: 2 });
  const result = parseJSON(raw);

  if (result.email && result.confidence !== 'none') {
    console.log(`[AI-Email] ✅ ${kanalnamn}: ${result.email} (${result.confidence})`);
  } else {
    console.log(`[AI-Email] ✗ ${kanalnamn}: ingen e-post hittad`);
  }

  return {
    ...result,
    influencer: namn,
    kanalnamn,
    plattform,
    sokt_at: new Date().toISOString(),
  };
}

// ============================================================
// BATCH E-POSTSÖKNING
// ============================================================

export async function findEmailsBatch(influencers, maxConcurrent = 2) {
  const results = [];

  for (let i = 0; i < influencers.length; i += maxConcurrent) {
    const batch = influencers.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(inf => findEmailAI(inf).catch(err => ({
        influencer: inf.namn,
        email: null,
        confidence: 'none',
        error: err.message,
      })))
    );
    results.push(...batchResults);
    console.log(`[AI-Email] Progress: ${Math.min(i + maxConcurrent, influencers.length)}/${influencers.length}`);
  }

  return results;
}

// ============================================================
// OUTREACH-MEDDELANDE GENERERING
// ============================================================

export async function generateOutreachMessage({ influencer, foretag, outreachType, kontaktperson, briefAnswers }) {
  const isCompany = outreachType === 'sponsor' || outreachType === 'company';

  const CTA_LABELS = {
    skapa_video: 'Skapa en video',
    testa_plattform: 'Testa plattformen & dela upplevelsen',
    posta_story: 'Posta en story / reel',
    boka_mote: 'Boka ett möte / samtal',
    dela_lank: 'Dela en länk / referral-kod',
    annat: 'Annat',
  };

  let brief = briefAnswers;
  if (!brief && foretag.company_profile) {
    try {
      const profile = typeof foretag.company_profile === 'string'
        ? JSON.parse(foretag.company_profile)
        : foretag.company_profile;
      brief = profile.brief_answers || profile.outreach_brief || null;
    } catch {}
  }

  const ctaText = brief?.cta?.length
    ? brief.cta.map(id => CTA_LABELS[id] || id).join(', ')
    : null;

  const beskrivning_text = foretag.beskrivning || '';
  const kontakt = kontaktperson || foretag.kontaktperson || foretag.namn;

  const systemPrompt = isCompany
    ? `Du skriver professionella B2B-sponsorförfrågningar på svenska. Tonen ska vara professionell men personlig. Alltid inkludera tydlig CTA och nästa steg.`
    : `Du skriver outreach-meddelanden på svenska för betalda influencer-samarbeten. Meddelandet är ett affärsförslag — det ska vara tydligt, direkt och konkret. Skriv med du-tilltal.

Det MÅSTE framgå att:
1. Vi vill att influencern ska MARKNADSFÖRA/PROMOTA företaget
2. Det är ett BETALT samarbete med konkret ersättning
3. Exakt VAD influencern förväntas göra
4. Vad ersättningen är

REGEL OM FÖRETAGSBESKRIVNING:
Företagsnamnet är: "${foretag.namn}"
${beskrivning_text ? `Användarens beskrivning av företaget (OBS: detta är råtext från användaren, ofta slarvigt skrivet): "${beskrivning_text}"` : 'Ingen beskrivning angiven.'}

Din uppgift: Formulera EN professionell mening som presenterar företaget. Basera dig på informationen ovan men skriv om den till korrekt, professionell svenska. Kopiera INTE användarens text ordagrant — förbättra den.
Skriv ALDRIG ord som "lag", "team", "app", "plattform", "community" om företaget om det inte tydligt framgår av beskrivningen.
Om ingen beskrivning finns, skriv bara: "Vi på ${foretag.namn} söker influencers för ett betalt samarbete."

VIKTIG REGEL — GISSA ALDRIG OM INFLUENCERNS CONTENT:
Du har INGEN information om vad influencern faktiskt publicerar. Hitta INTE PÅ detaljer som "dina träningsvideos", "dina podcastavsnitt", "ditt tekniska innehåll" etc. Skriv istället en generell hälsning som nämner kanalnamnet utan att gissa på specifikt content.`;

  let erbjudandeBlock = '';
  if (brief?.erbjudande) {
    erbjudandeBlock = `Vad vi erbjuder influencern (MÅSTE nämnas tydligt i meddelandet):\n${brief.erbjudande}`;
  } else {
    erbjudandeBlock = `Ersättning (MÅSTE nämnas tydligt): 300 SEK per video + 10 SEK per signup via referral-kod`;
  }

  let ctaBlock = '';
  if (ctaText) {
    ctaBlock = `Vad vi vill att influencern SKA GÖRA (skriv ut detta tydligt):\n${ctaText}`;
  } else {
    ctaBlock = `Vad influencern ska göra: Skapa content som promotar oss och uppmanar tittarna att registrera sig via referral-länk/kod`;
  }

  let extraBlock = '';
  if (brief?.extra) {
    extraBlock = `Extra kontext:\n${brief.extra}`;
  }

  const userMessage = `Skriv ett outreach-meddelande:

Mottagare: ${influencer.namn} (${influencer.kanalnamn} på ${influencer.plattform}, ${influencer.foljare} följare)
Content-stil: ${influencer.content_stil || 'okänd'}
Nisch: ${influencer.nisch || 'gaming'}

Avsändare: ${kontakt}, ${foretag.namn} (${foretag.epost})

${erbjudandeBlock}

${ctaBlock}

${extraBlock}

KRAV — följ dessa EXAKT:
1. Börja med en kort hälsning som nämner influencerns kanalnamn (max 1 mening). VIKTIGT: Hitta INTE PÅ specifika detaljer om deras content — du vet INTE vad de gör på sin kanal. Skriv ALDRIG saker som "dina träningsvideos", "dina podcastavsnitt", "ditt tekniska innehåll" etc. om det inte TYDLIGT framgår av deras kanalnamn. Skriv istället något generellt som "Vi har hittat din kanal X och tror att det finns potential för ett samarbete."
2. Presentera företaget professionellt baserat på informationen i systempromten (formulera själv, kopiera INTE användarens text)
3. Förklara KONKRET vad vi vill att influencern gör (se CTA ovan)
4. Skriv ut ersättningen TYDLIGT med siffror
5. Avsluta med ett tydligt nästa steg
6. Avsluta brödtexten med "Låter detta intressant? Svara gärna så skickar jag mer information!" eller liknande — INKLUDERA INTE signatur/avsändare, den läggs till automatiskt
7. Max 150 ord totalt
8. GISSA ALDRIG — om du inte vet något säkert, utelämna det. Det är bättre att vara generell än att hitta på fel information.

Returnera BARA meddelandet formaterat så här:
ÄMNE: [ämnesrad]
---
[brödtext]`;

  const raw = await callClaude(systemPrompt, userMessage, 1000);

  // Bygg signatur programmatiskt — ALDRIG AI-genererad
  const signaturDelar = ['Mvh,', kontakt];
  if (foretag.namn) signaturDelar.push(foretag.namn);
  if (foretag.epost) signaturDelar.push(foretag.epost);
  const signatur = signaturDelar.join('\n');

  // Ta bort eventuell AI-genererad signatur och ersätt med den riktiga
  const cleaned = raw.trim().replace(/\n*(Mvh|Med vänlig hälsning|Vänligen|Hälsningar),?\n[\s\S]*$/i, '');
  return cleaned.trimEnd() + '\n\n' + signatur;
}

export async function generateSubject({ influencer, foretag, outreachType }) {
  const raw = await callClaude(
    'Du genererar korta, engagerande e-postämnesrader på svenska. Max 60 tecken. Svara ENBART med ämnesraden, inget annat.',
    `Ämnesrad för outreach till ${influencer.namn} (${influencer.plattform}, ${influencer.nisch}) från ${foretag.namn}. Typ: ${outreachType === 'sponsor' ? 'sponsorförfrågan' : 'influencer-samarbete'}.`,
    100,
  );
  return raw.trim().replace(/^["']|["']$/g, '');
}

// ============================================================
// CONTENT-ANALYS MED AI
// ============================================================

export async function analyzeContentQuality({ kanalnamn, plattform, nisch }) {
  const systemPrompt = `Du analyserar influencers content-kvalitet. Använd web_search för att kolla deras senaste content och bedöm kvalitet, engagemang, regelbundenhet och brand-safety. Svara med JSON.`;

  const userMessage = `Analysera: ${kanalnamn} på ${plattform} (nisch: ${nisch})

Sök webben efter deras senaste content och svara med JSON:
{
  "content_kvalitet": "hög|medel|låg",
  "engagemang_bedomning": "högt|medel|lågt",
  "publiceringsfrekvens": "dagligen|2-3/vecka|veckovis|oregelbundet",
  "brand_safety": "säker|viss_risk|hög_risk",
  "styrkor": ["styrka1", "styrka2"],
  "risker": ["risk1"],
  "rekommendation": "Kort sammanfattning"
}`;

  const raw = await callClaudeWithWebSearch(systemPrompt, userMessage, 2000, { maxSearches: 2 });
  return parseJSON(raw);
}

// ============================================================
// GOOGLE MAPS — SPONSOR / PARTNER-SÖKNING
// ============================================================

/**
 * Söker Google Maps via SerpAPI efter företag som matchar söktermer.
 * Returnerar strukturerad data: namn, webbplats, telefon, betyg, typ, adress.
 */
export async function searchGoogleMaps(query, location = 'Sverige') {
  const data = await serpApiQuery({
    engine: 'google_maps',
    q: query,
    hl: 'sv',
    ll: '@62.0,15.0,5z',  // Centrerat på Sverige
    type: 'search',
  }, 'gmaps');

  if (!data || !data.local_results) {
    console.warn(`[GoogleMaps] Inga resultat för "${query}"`);
    return [];
  }

  return data.local_results.map(r => ({
    namn: r.title || '',
    adress: r.address || '',
    telefon: r.phone || '',
    hemsida: r.website || '',
    betyg: r.rating || null,
    recensioner: r.reviews || 0,
    typ: r.type || (r.types ? r.types.join(', ') : ''),
    beskrivning: r.description || '',
    place_id: r.place_id || '',
    thumbnail: r.thumbnail || '',
  }));
}

/**
 * Genererar söktermer baserat på företagsbeskrivning med Claude,
 * söker Google Maps för varje term, och returnerar unika resultat.
 */
export async function findSponsorsViaGoogleMaps(foretagNamn, beskrivning) {
  // Steg 1: Låt Claude generera relevanta Google Maps-söktermer
  const client = new Anthropic();
  const searchTermResponse = await client.messages.create({
    model: MODEL_DEFAULT,
    max_tokens: 500,
    system: 'Du genererar söktermer för Google Maps för att hitta svenska företag som kan vara relevanta partners, sponsorer eller konkurrenter. Svara BARA med en JSON-array av strängar.',
    messages: [{
      role: 'user',
      content: `Företag: "${foretagNamn}"
Beskrivning: "${beskrivning}"

Generera 10-12 Google Maps-söktermer för att hitta svenska företag som är relevanta. Inkludera ALLA dessa kategorier:

1. DIREKTA KONKURRENTER & LIKNANDE FÖRETAG (2-3 termer) — företag som gör samma sak eller liknande
2. SAMMA BRANSCH (2-3 termer) — företag inom samma industri/nisch
3. POTENTIELLA SPONSORER (3-4 termer) — företag vars målgrupp överlappar och som kan vilja sponsra
4. KOMPLETTERANDE TJÄNSTER (2-3 termer) — företag som erbjuder relaterade produkter/tjänster

Varje sökterm ska vara specifik. Inkludera "Sverige" eller svenska städer.

Exempel: om beskrivningen är "fantasy fotboll-plattform för Allsvenskan" →
["fantasy sport företag Sverige", "fantasy fotboll Sverige", "betting företag Stockholm", "sportdata företag Sverige", "sportbutiker Stockholm", "sportbar Sverige", "fotbollsutrustning Sverige", "energidrycker grossist Sverige", "sportmedia företag Stockholm", "esport företag Sverige", "sportappar Sverige"]

Returnera BARA JSON-arrayen.`
    }],
  });

  trackApiCost({ service: 'anthropic', endpoint: 'sonnet-search-terms', inputTokens: searchTermResponse.usage?.input_tokens, outputTokens: searchTermResponse.usage?.output_tokens });

  let searchTerms;
  try {
    const raw = searchTermResponse.content[0].text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    searchTerms = JSON.parse(raw);
  } catch {
    console.error('[GoogleMaps] Kunde inte parsa söktermer, använder fallback');
    searchTerms = [`${beskrivning || foretagNamn} sponsorer Sverige`, `sportföretag Sverige`];
  }

  console.log(`[GoogleMaps] Söktermer: ${searchTerms.join(', ')}`);

  // Steg 2: Sök Google Maps för varje term
  const allResults = [];
  const seenNames = new Set();

  for (const term of searchTerms.slice(0, 12)) {
    const results = await searchGoogleMaps(term);
    for (const r of results) {
      const key = r.namn.toLowerCase().trim();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        allResults.push({ ...r, sokterm: term });
      }
    }
  }

  console.log(`[GoogleMaps] Totalt ${allResults.length} unika företag hittade`);
  return allResults;
}
