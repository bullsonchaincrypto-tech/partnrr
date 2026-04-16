// ============================================================
// V9 Pipeline — Fas 1: Search Term Generator (Sonnet ×2 parallellt)
// ============================================================
// Genererar svenska söktermer för YouTube + IG/TT + hashtags.
// V1's ai-search.js är ORÖRD. Denna fil aktiveras endast bakom USE_V9_PIPELINE.
//
// Output: Queries — { yt_terms, ig_terms, hashtag_terms, long_tail_terms, negative_terms }
// Kostnad: ~$0.008 totalt.

import {
  isValidYtTerm,
  isValidIgTerm,
  isValidHashtag,
} from './data/brand-keywords.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

// ============================================================
// === SYSTEM PROMPTS ==========================================
// ============================================================

const YT_SYSTEM = `Du genererar svenska söktermer för YouTube-video-search. Målet är att hitta
SVENSKA KREATÖRER (människor eller familjer, inte företag) som skapar content
i nischen <PRIMARY_NICHE>.

Returnera STRIKT JSON (ingen markdown):
{
  "terms": [8 strängar],
  "long_tail_terms": [3 strängar],
  "negative_terms": [3-5 strängar]
}

Regler för terms (8 st):
1. 2-4 ord per term.
2. Minst ett av följande i varje term:
   (a) åäö-tecken
   (b) "sverige"/"svensk"/"svenska"
   (c) garanterat-svenskt ord (recension, uppkopplade, smarta, prylar,
       hemautomation, högtalare, robotdammsugare, etc.)
3. FÖRBJUDNA "magnet"-ord (drar till internationellt content):
   tech, review, unboxing, gadget, home, alexa, apple, samsung, gaming,
   vlog, tutorial, how to, vs, best, top 10, amazon, aliexpress
4. FÖRBJUDNA "brand"-ord (drar till företagskonton):
   officiell, store, shop, butik, återförsäljare, brand, AB, sweden official
5. Maximera variation: varje term ska fånga en UNIK typ av kreatör
   (recensent, tipsare, byggare, testare, jämförare, berättare, guider,
   nybörjar-orienterad).
6. Fokus på RECENSIONER / TESTER / TIPS / JÄMFÖRELSER — ej marknadsförings-språk.

Regler för long_tail_terms (3 st):
- Biasade mot nano/micro. Inkludera ord som "liten", "nischad", "mikro-",
  "okänd", "underrated", "ny", "bäst dold". Fortfarande svensk-enforcement.

negative_terms (3-5): ord/fraser som starkt indikerar brand snarare än creator.`;

const IG_SYSTEM = `Du genererar söktermer för Instagram + TikTok video-discovery. Målet är
svenska KREATÖRER (människor/familjer, ej företag) i nischen <PRIMARY_NICHE>.

KRITISKT: Instagram/TikTok search saknar region-filter. Våra queries MÅSTE
därför anchoras hårt mot svenska för att undvika internationella träffar.
Queries som "fantasy fotboll svenska" drar in engelska reels med "svenska"
någonstans i captionen. Vi behöver STARKARE anchors.

Returnera STRIKT JSON:
{
  "ig_terms": [8 strängar],
  "hashtag_terms": [6 strängar utan #],
  "serper_keywords": [5 strängar]
}

Regler för ig_terms (8 st):
1. MINST ETT AV dessa STARKA svenska anchors per term:
   (a) åäö-tecken i ordet (prioriterat — matchar bara svenskt innehåll)
   (b) "på svenska" som fras
   (c) ett svenskt stadsnamn (Stockholm, Göteborg, Malmö, Uppsala, Lund)
   (d) ".se" eller "sverige.se"
   (e) en sammansatt svensk term (fotbollsproffs, träningsvlogg, matrecept)
2. Varje term måste innehålla minst ett CREATOR-ord:
   "youtuber", "bloggare", "influencer", "tiktokare", "creator",
   "recenserar", "tipsar", "berättar", "visar", "skapar"
3. 2-4 ord per term.
4. FÖRBJUDNA: engelska magnet-ord (review, tutorial, tips — ENGELSKA) och
   brand-ord (officiell, shop, etc.)
5. Variation över flera content-typer.

Exempel PRIO-ordning för en nisch "fantasy fotboll":
Bra (åäö + creator):   "fantasyfotboll bloggare tips"
Bra (sammansatt):       "fantasyliga tipsar svenska"
Bra (nischad):          "managerspel fotboll influencer"
Dåligt (för generiskt): "fotboll svensk" (matchar ALLA fotbollskonton, inte fantasy)
Dåligt (för svagt):     "fantasy fotboll svensk" (SC matchar eng reels)

Regler för hashtag_terms (6 st):
1. Svenska nisch-hashtags, utan #-tecken.
2. Matcha regex: /^[a-zåäö0-9_]{4,30}$/i
3. Föredra sammansatta som "svensktiktok", "fantasyfotbollsverige".
4. Mix av generiska svenska (svensktiktok, svenskfotboll) + nisch-specifika.

Regler för serper_keywords (5 st):
Dessa används i Google-dork queries: "keyword" "Stockholm" site:instagram.com
1. 1-3 ord per keyword. SKRIV ISÄR ord — använd INTE sammansättningar!
   Google matchar "fantasy fotboll" mycket bättre än "fantasyfotboll".
   Sammansatta ord som inte är etablerade svenska ord ger ofta 0 träffar.

   FÖRBJUDET: "fantasyfotboll", "fantasyliga", "smarthem", "hemautomation"
   RÄTT:      "fantasy fotboll", "fantasy liga", "smart hem", "hem automation"

2. BARA SVENSKA ORD (engelska OK om de används i Sverige, t.ex. "fantasy", "smart").
3. KRITISKT: Keywords måste vara NISCH-SPECIFIKA, inte generiska!
   Om nischen är "fantasy fotboll" ska keywords handla om FANTASY, inte bara fotboll.
   Generiska ord som "fotboll" eller "teknik" ensamt ger tusentals irrelevanta träffar
   och är FÖRBJUDNA som ensamt keyword.

   BRA exempel per nisch:
   "fantasy fotboll": ["fantasy fotboll", "fantasy tips", "drömlag", "speltips fotboll", "manager spel"]
   "smart hem":       ["smart hem", "hem teknik", "uppkopplat hem", "smart belysning", "hemma prylar"]
   "hudvård":         ["hudvård tips", "ansiktsvård", "hud rutin", "skönhets tips", "hudvård recension"]

   DÅLIGA exempel (FÖRBJUDNA):
   "fantasyfotboll"  → ihopskrivet påhittat ord, ger 0 träffar på Google
   "fotboll"         → alldeles för brett, matchar fotbollslag
   "teknik"          → matchar teknikbutiker, inte smart hem-creators
   "elektronik"      → matchar elektronisk MUSIK

4. ALLA 5 keywords ska vara nisch-specifika. Inga generiska kategori-ord.
5. Tänk: "Ger detta keyword träffar på Google?" Ihopskrivna nischord gör det sällan.`;

// ============================================================
// === HELPERS =================================================
// ============================================================

async function callSonnet(systemPrompt, userPrompt, maxTokens = 700, temperature = 0.4) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('[AI-Search v9] ANTHROPIC_API_KEY saknas');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`[AI-Search v9] Sonnet ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function parseJson(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Ingen JSON-block hittades');
  return JSON.parse(m[0]);
}

function renderUserPrompt(foretag, brief) {
  return [
    `Företag: ${foretag?.namn || ''}`,
    `Bransch: ${foretag?.bransch || ''}`,
    `Beskrivning: ${foretag?.beskrivning || ''}`,
    `Nisch: ${brief.primary_niche}`,
    `Sekundära nischer: ${(brief.secondary_niches || []).join(', ')}`,
    `Målgrupp: ${brief.target_audience}`,
    `Size tier hint: ${brief.size_tier_hint}`,
    `Must-have signals: ${(brief.must_have_signals || []).join('; ')}`,
    `Exclusions: ${(brief.exclusions || []).join(', ')}`,
  ].join('\n');
}

// ============================================================
// === YT-GENERATION (med 1 retry) =============================
// ============================================================

async function generateYTWithRetry(foretag, brief) {
  const systemPrompt = YT_SYSTEM.replaceAll('<PRIMARY_NICHE>', brief.primary_niche);
  let userPrompt = renderUserPrompt(foretag, brief);
  for (let attempt = 0; attempt <= 1; attempt++) {
    let parsed;
    try {
      const raw = await callSonnet(systemPrompt, userPrompt);
      parsed = parseJson(raw);
    } catch (err) {
      console.warn(`[AI-Search v9] YT attempt ${attempt + 1} parse-fail: ${err.message}`);
      if (attempt === 1) throw err;
      userPrompt += '\n\nFöregående försök gav ogiltig JSON. Försök igen och returnera STRIKT JSON.';
      continue;
    }
    const validTerms = (parsed.terms || []).filter(isValidYtTerm).slice(0, 8);
    const validLongTail = (parsed.long_tail_terms || []).filter(isValidYtTerm).slice(0, 3);
    if (validTerms.length >= 5) {
      console.log(`[AI-Search v9] YT returned ${parsed.terms?.length || 0} raw, ${validTerms.length} after filter, ${validLongTail.length} long_tail`);
      return {
        yt_terms: validTerms,
        long_tail_terms: validLongTail,
        negative_terms: Array.isArray(parsed.negative_terms) ? parsed.negative_terms.slice(0, 5) : [],
      };
    }
    userPrompt += `\n\nFöregående försök gav endast ${validTerms.length} godkända termer (kräver minst 5 efter svensk/brand-filter). Försök igen.`;
  }
  console.warn('[AI-Search v9] YT generation failed after retries — returnerar tomt set');
  return { yt_terms: [], long_tail_terms: [], negative_terms: [] };
}

// ============================================================
// === IG-GENERATION (med 1 retry) =============================
// ============================================================

async function generateIGWithRetry(foretag, brief) {
  const systemPrompt = IG_SYSTEM.replaceAll('<PRIMARY_NICHE>', brief.primary_niche);
  let userPrompt = renderUserPrompt(foretag, brief);
  for (let attempt = 0; attempt <= 1; attempt++) {
    let parsed;
    try {
      const raw = await callSonnet(systemPrompt, userPrompt);
      parsed = parseJson(raw);
    } catch (err) {
      console.warn(`[AI-Search v9] IG attempt ${attempt + 1} parse-fail: ${err.message}`);
      if (attempt === 1) throw err;
      userPrompt += '\n\nFöregående försök gav ogiltig JSON. Försök igen.';
      continue;
    }
    const validIg = (parsed.ig_terms || []).filter(isValidIgTerm).slice(0, 8);
    const validHashtags = (parsed.hashtag_terms || [])
      .map(t => String(t || '').replace(/^#/, '').toLowerCase())
      .filter(isValidHashtag)
      .slice(0, 6);
    // Serper keywords: 1-3 svenska ord, inga speciella filter behövs
    const serperKeywords = (parsed.serper_keywords || [])
      .map(k => String(k || '').trim())
      .filter(k => k.length >= 2 && k.length <= 40)
      .slice(0, 5);

    if (validIg.length >= 4) {
      console.log(`[AI-Search v9] IG returned ${parsed.ig_terms?.length || 0} raw, ${validIg.length} after filter, ${validHashtags.length} hashtags, ${serperKeywords.length} serper-keywords`);
      return { ig_terms: validIg, hashtag_terms: validHashtags, serper_keywords: serperKeywords };
    }
    userPrompt += `\n\nFöregående försök gav endast ${validIg.length} godkända IG-termer. Försök igen.`;
  }
  console.warn('[AI-Search v9] IG generation failed after retries — returnerar tomt set');
  return { ig_terms: [], hashtag_terms: [], serper_keywords: [] };
}

// ============================================================
// === ENTRY POINT =============================================
// ============================================================

/**
 * Fas 1 entry point — kör YT- och IG-generation parallellt.
 * @returns {Promise<Queries>}
 */
export async function generateAllSearchTerms(foretag, brief) {
  const t0 = Date.now();
  console.log(`[AI-Search v9] Started niche="${brief.primary_niche}"`);
  const [yt, ig] = await Promise.all([
    generateYTWithRetry(foretag, brief),
    generateIGWithRetry(foretag, brief),
  ]);
  console.log(`[AI-Search v9] Done in ${Date.now() - t0}ms`);
  return {
    yt_terms: yt.yt_terms,
    ig_terms: ig.ig_terms,
    hashtag_terms: ig.hashtag_terms,
    long_tail_terms: yt.long_tail_terms,
    negative_terms: yt.negative_terms,
    serper_keywords: ig.serper_keywords || [],
  };
}

export const __test__ = { generateYTWithRetry, generateIGWithRetry, parseJson };
