import fetch from 'node-fetch';

/**
 * Domän-enrichment: Hämta företagsinfo från hemsida.
 * Scrapar meta-taggar, OG-data, sociala profiler.
 * Ingen extern API krävs — fungerar med alla publika hemsidor.
 */

const SOCIAL_PATTERNS = [
  { platform: 'instagram', regex: /(?:instagram\.com|instagr\.am)\/([a-zA-Z0-9_.]+)/i },
  { platform: 'tiktok', regex: /tiktok\.com\/@?([a-zA-Z0-9_.]+)/i },
  { platform: 'youtube', regex: /youtube\.com\/(?:@|channel\/|c\/|user\/)([a-zA-Z0-9_-]+)/i },
  { platform: 'twitter', regex: /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i },
  { platform: 'linkedin', regex: /linkedin\.com\/(?:company|in)\/([a-zA-Z0-9_-]+)/i },
  { platform: 'facebook', regex: /facebook\.com\/([a-zA-Z0-9._-]+)/i },
  { platform: 'twitch', regex: /twitch\.tv\/([a-zA-Z0-9_]+)/i },
];

/**
 * Normalisera domän: ta bort protocol, www, trailing slash
 */
function normalizeDomain(input) {
  let domain = (input || '').trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/^www\./, '');
  domain = domain.replace(/\/.*$/, '');
  return domain;
}

/**
 * Hämta och parsa HTML från en URL
 */
async function fetchHtml(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Partnrr/1.0; +https://rankleague.com)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'sv,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return html.slice(0, 200000); // Max 200KB
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extrahera meta-taggar från HTML
 */
function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ');
}

function extractMeta(html) {
  const meta = {};

  // <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) meta.title = decodeHtmlEntities(titleMatch[1].trim().replace(/\s+/g, ' '));

  // Meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i)
    || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/i);
  if (descMatch) meta.description = decodeHtmlEntities(descMatch[1].trim());

  // OG tags
  const ogTags = ['og:title', 'og:description', 'og:image', 'og:type', 'og:site_name', 'og:locale'];
  for (const tag of ogTags) {
    const pattern = new RegExp(`<meta[^>]*property=["']${tag}["'][^>]*content=["']([^"']*?)["']`, 'i');
    const altPattern = new RegExp(`<meta[^>]*content=["']([^"']*?)["'][^>]*property=["']${tag}["']`, 'i');
    const match = html.match(pattern) || html.match(altPattern);
    if (match) meta[tag.replace('og:', 'og_')] = decodeHtmlEntities(match[1].trim());
  }

  // Keywords
  const kwMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([\s\S]*?)["']/i);
  if (kwMatch) meta.keywords = kwMatch[1].trim();

  // Canonical URL
  const canMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*?)["']/i);
  if (canMatch) meta.canonical = canMatch[1].trim();

  // Favicon / logo
  const iconMatch = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']*?)["']/i);
  if (iconMatch) meta.favicon = iconMatch[1].trim();

  return meta;
}

/**
 * Hitta sociala profil-länkar i HTML
 */
function extractSocialLinks(html) {
  const links = {};

  // Hitta alla href-attribut
  const hrefMatches = html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi);

  for (const m of hrefMatches) {
    const url = m[1];
    for (const pattern of SOCIAL_PATTERNS) {
      const match = url.match(pattern.regex);
      if (match && !links[pattern.platform]) {
        links[pattern.platform] = {
          handle: match[1],
          url: url,
        };
      }
    }
  }

  return links;
}

/**
 * Försök gissa företagets storlek/bransch baserat på meta-data
 */
function inferIndustry(meta, domain, html) {
  // Extrahera synlig text från body (ta bort script/style-taggar)
  let bodyText = '';
  if (html) {
    bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 5000); // Begränsa för prestanda
  }

  const text = [
    meta.description || '',
    meta.og_description || '',
    meta.keywords || '',
    meta.title || '',
    domain || '',
    bodyText,
  ].join(' ').toLowerCase();

  // Bransch-gissning
  const industries = [
    { id: 'fantasy_sports', keywords: ['fantasy', 'rank', 'ranking', 'league', 'points', 'wins', 'picks', 'predict', 'prediction', 'teams', 'score', 'matchday', 'gameweek', 'lineup', 'roster', 'draft', 'bet', 'betting', 'odds', 'tippa', 'tävling', 'poäng', 'lag'] },
    { id: 'gaming', keywords: ['gaming', 'spel', 'esport', 'game', 'gamer'] },
    { id: 'tech', keywords: ['tech', 'software', 'saas', 'app', 'digital', 'ai', 'data'] },
    { id: 'ecommerce', keywords: ['shop', 'butik', 'köp', 'handla', 'webshop', 'e-handel'] },
    { id: 'fashion', keywords: ['mode', 'fashion', 'kläder', 'style', 'design'] },
    { id: 'food', keywords: ['mat', 'food', 'restaurang', 'recept', 'dryck', 'kaffe'] },
    { id: 'fitness', keywords: ['fitness', 'träning', 'gym', 'hälsa', 'sport', 'workout'] },
    { id: 'finance', keywords: ['finans', 'bank', 'investering', 'aktier', 'pension', 'försäkring'] },
    { id: 'media', keywords: ['media', 'nyheter', 'tidning', 'podcast', 'video', 'streaming'] },
    { id: 'education', keywords: ['utbildning', 'skola', 'kurs', 'lärande', 'education'] },
    { id: 'beauty', keywords: ['skönhet', 'beauty', 'hudvård', 'smink', 'cosmetic'] },
    { id: 'travel', keywords: ['resa', 'travel', 'hotell', 'flyg', 'semester'] },
    { id: 'automotive', keywords: ['bil', 'fordon', 'motor', 'auto', 'car'] },
  ];

  const scores = industries.map(ind => ({
    ...ind,
    score: ind.keywords.filter(kw => text.includes(kw)).length,
  })).filter(i => i.score > 0).sort((a, b) => b.score - a.score);

  return scores.length > 0 ? scores[0].id : null;
}

/**
 * HUVUDFUNKTION: Enricha ett företag baserat på domän/URL
 */
export async function enrichCompanyDomain(domainInput) {
  const domain = normalizeDomain(domainInput);
  if (!domain) throw new Error('Ingen giltig domän angiven');

  const result = {
    domain,
    success: false,
    company_name: null,
    description: null,
    industry: null,
    logo_url: null,
    social_profiles: {},
    meta: {},
    enriched_at: new Date().toISOString(),
  };

  // Försök HTTPS först, fallback till HTTP
  let html;
  for (const protocol of ['https', 'http']) {
    try {
      html = await fetchHtml(`${protocol}://${domain}`);
      break;
    } catch (err) {
      console.log(`[Enrichment] ${protocol}://${domain} failed:`, err.message);
    }
  }

  // Försök med www om utan misslyckades
  if (!html && !domain.startsWith('www.')) {
    for (const protocol of ['https', 'http']) {
      try {
        html = await fetchHtml(`${protocol}://www.${domain}`);
        break;
      } catch (err) {
        // Tyst
      }
    }
  }

  if (!html) {
    result.error = 'Kunde inte nå hemsidan';
    return result;
  }

  // Extrahera meta
  result.meta = extractMeta(html);
  // Extrahera företagsnamn: försök OG site_name, annars första delen av title
  let companyName = result.meta.og_site_name || result.meta.title?.split(/[|–—\-]/)[0]?.trim() || null;
  // Rensa duplicerade namn typ "Rankleague – Rankleague"
  if (companyName) {
    const parts = companyName.split(/\s*[–—\-|]\s*/);
    if (parts.length > 1 && parts[0].toLowerCase() === parts[1]?.toLowerCase()) {
      companyName = parts[0].trim();
    }
  }
  result.company_name = companyName;
  result.description = result.meta.og_description || result.meta.description || null;
  result.industry = inferIndustry(result.meta, domain, html);

  // Logo
  if (result.meta.og_image) {
    let logoUrl = result.meta.og_image;
    if (logoUrl.startsWith('/')) logoUrl = `https://${domain}${logoUrl}`;
    result.logo_url = logoUrl;
  } else if (result.meta.favicon) {
    let faviconUrl = result.meta.favicon;
    if (faviconUrl.startsWith('/')) faviconUrl = `https://${domain}${faviconUrl}`;
    result.logo_url = faviconUrl;
  }

  // Sociala profiler
  result.social_profiles = extractSocialLinks(html);

  result.success = true;
  return result;
}

/**
 * AI-genererade kontextuella frågor baserat på enrichment-data
 */
export async function generateBriefQuestions(enrichmentData, bransch, outreachType = 'influencer') {
  const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY saknas');

  const isCompany = outreachType === 'company';

  const companyContext = [
    enrichmentData.company_name ? `Företagsnamn: ${enrichmentData.company_name}` : '',
    enrichmentData.description ? `Beskrivning: ${enrichmentData.description}` : '',
    enrichmentData.industry ? `Bransch: ${enrichmentData.industry}` : '',
    bransch ? `Valda nischer: ${bransch}` : '',
    `Outreach-typ: ${isCompany ? 'Företag & sponsorer (B2B)' : 'Influencers (kreatörer)'}`,
    Object.keys(enrichmentData.social_profiles || {}).length > 0
      ? `Sociala profiler: ${Object.keys(enrichmentData.social_profiles).join(', ')}`
      : '',
  ].filter(Boolean).join('\n');

  let res;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: isCompany
          ? 'Du hjälper ett företag att hitta sponsorpartners och företagskunder (B2B). Baserat på företagets data, generera 4-5 kontextuella frågor som hjälper oss matcha dem med rätt sponsorer och partners. Svara ENBART med JSON.'
          : 'Du hjälper ett företag att hitta influencers och kreatörer. Baserat på företagets data, generera 4-5 kontextuella frågor som hjälper oss matcha dem med rätt influencers. Svara ENBART med JSON.',
        messages: [{
          role: 'user',
          content: isCompany
            ? `Företagsdata:\n${companyContext || 'Ingen data tillgänglig'}\n\nGenerera 4-5 frågor med svarsalternativ som hjälper oss förstå vilken typ av sponsorer/partners företaget söker.\n\nSvara med JSON i exakt detta format:\n[\n  {\n    "id": "sponsor_goal",\n    "question": "Vad vill ni uppnå med sponsorpartnerskapet?",\n    "type": "single_choice",\n    "options": [\n      {"value": "brand_exposure", "label": "Varumärkesexponering i tävlingar"},\n      {"value": "product_placement", "label": "Produktplacering hos spelare"},\n      {"value": "co_marketing", "label": "Gemensamma kampanjer"},\n      {"value": "data_access", "label": "Tillgång till spelardata & insikter"}\n    ]\n  }\n]\n\nVIKTIGT: Budgetfrågan ska formuleras som max-tak, t.ex. 'Upp till 500 SEK', 'Upp till 2 000 SEK', 'Upp till 10 000 SEK', 'Upp till 50 000 SEK', 'Över 50 000 SEK'.\nAnpassa frågorna för B2B-sponsring. Fråga om sponsorbudget, vilken typ av exponering de vill ha, om de har sponsrat tidigare, och vilken bransch de riktar sig mot.\nENBART JSON, ingen annan text.`
            : `Företagsdata:\n${companyContext || 'Ingen data tillgänglig'}\n\nGenerera 4-5 frågor med svarsalternativ som hjälper oss förstå vad företaget söker i ett influencer-samarbete.\n\nSvara med JSON i exakt detta format:\n[\n  {\n    "id": "goal",\n    "question": "Vad är huvudmålet med samarbetet?",\n    "type": "single_choice",\n    "options": [\n      {"value": "awareness", "label": "Räckvidd & varumärkeskännedom"},\n      {"value": "traffic", "label": "Trafik till hemsidan"},\n      {"value": "signups", "label": "Registreringar / signups"},\n      {"value": "sales", "label": "Direktförsäljning"}\n    ]\n  }\n]\n\nVIKTIGT: Budgetfrågan ska formuleras som max-tak, t.ex. 'Upp till 500 SEK', 'Upp till 2 000 SEK', 'Upp till 10 000 SEK', 'Upp till 50 000 SEK', 'Över 50 000 SEK'.\nAnpassa frågorna baserat på företagets bransch och kontext. T.ex. om de är inom gaming, fråga om specifika plattformar. Om de har Instagram, fråga om de vill ha UGC.\nENBART JSON, ingen annan text.`,
        }],
      }),
    });
  } catch (fetchErr) {
    console.error('[Brief] Fetch error:', fetchErr.message);
    return getDefaultQuestions(isCompany);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => 'no body');
    console.error(`[Brief] Anthropic API ${res.status}:`, errBody);
    return getDefaultQuestions(isCompany);
  }

  const data = await res.json();
  const raw = data.content[0].text;

  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return getDefaultQuestions(isCompany);
    return JSON.parse(match[0]);
  } catch {
    return getDefaultQuestions(isCompany);
  }
}

/**
 * Fallback: standard-frågor om AI:n inte svarar korrekt
 */
function getDefaultQuestions(isCompany = false) {
  if (isCompany) {
    return [
      {
        id: 'sponsor_goal',
        question: 'Vad vill ni uppnå med sponsorpartnerskapet?',
        type: 'single_choice',
        options: [
          { value: 'brand_exposure', label: 'Varumärkesexponering i tävlingar' },
          { value: 'product_placement', label: 'Produktplacering hos spelare' },
          { value: 'co_marketing', label: 'Gemensamma kampanjer' },
          { value: 'data_access', label: 'Tillgång till spelardata & insikter' },
        ],
      },
      {
        id: 'sponsor_budget',
        question: 'Vilken är er max sponsorbudget per samarbete?',
        type: 'single_choice',
        options: [
          { value: 'micro', label: 'Upp till 500 SEK' },
          { value: 'small', label: 'Upp till 2 000 SEK' },
          { value: 'medium', label: 'Upp till 10 000 SEK' },
          { value: 'large', label: 'Upp till 50 000 SEK' },
          { value: 'enterprise', label: 'Över 50 000 SEK' },
        ],
      },
      {
        id: 'sponsor_type',
        question: 'Vilken typ av exponering är ni mest intresserade av?',
        type: 'multi_choice',
        options: [
          { value: 'logo', label: 'Logotyp i tävlingar & evenemang' },
          { value: 'prizes', label: 'Produkter som priser/vinster' },
          { value: 'content', label: 'Sponsrat innehåll & artiklar' },
          { value: 'naming', label: 'Naming rights (t.ex. "X-cupen")' },
        ],
      },
      {
        id: 'target_audience',
        question: 'Vilken målgrupp vill ni nå?',
        type: 'multi_choice',
        options: [
          { value: 'youth', label: 'Ungdomar (13-24)' },
          { value: 'adults', label: 'Vuxna (25-44)' },
          { value: 'gamers', label: 'Gamers & esport-fans' },
          { value: 'sports', label: 'Sportentusiaster' },
        ],
      },
      {
        id: 'previous_sponsoring',
        question: 'Har ni sponsrat gaming/esport/fantasy tidigare?',
        type: 'single_choice',
        options: [
          { value: 'none', label: 'Nej, detta är nytt för oss' },
          { value: 'few', label: 'Ja, några gånger' },
          { value: 'experienced', label: 'Ja, vi har en aktiv sponsorstrategi' },
        ],
      },
    ];
  }

  return [
    {
      id: 'goal',
      question: 'Vad är huvudmålet med samarbetet?',
      type: 'single_choice',
      options: [
        { value: 'awareness', label: 'Räckvidd & varumärkeskännedom' },
        { value: 'traffic', label: 'Trafik till hemsidan' },
        { value: 'signups', label: 'Registreringar / signups' },
        { value: 'sales', label: 'Direktförsäljning' },
      ],
    },
    {
      id: 'budget',
      question: 'Vilken är er max budget per influencer-samarbete?',
      type: 'single_choice',
      options: [
        { value: 'micro', label: 'Upp till 500 SEK' },
        { value: 'small', label: 'Upp till 2 000 SEK' },
        { value: 'medium', label: 'Upp till 10 000 SEK' },
        { value: 'large', label: 'Upp till 50 000 SEK' },
        { value: 'enterprise', label: 'Över 50 000 SEK' },
      ],
    },
    {
      id: 'audience_age',
      question: 'Vilken åldersgrupp vill ni nå?',
      type: 'single_choice',
      options: [
        { value: '13-17', label: '13–17 år' },
        { value: '18-24', label: '18–24 år' },
        { value: '25-34', label: '25–34 år' },
        { value: '35+', label: '35+ år' },
        { value: 'all', label: 'Blandat / spelar ingen roll' },
      ],
    },
    {
      id: 'target_platforms',
      question: 'Vilka plattformar vill ni synas på?',
      type: 'multi_choice',
      options: [
        { value: 'youtube', label: 'YouTube' },
        { value: 'tiktok', label: 'TikTok' },
        { value: 'instagram', label: 'Instagram' },
        { value: 'twitch', label: 'Twitch' },
      ],
    },
    {
      id: 'previous_collabs',
      question: 'Har ni gjort influencer-samarbeten tidigare?',
      type: 'single_choice',
      options: [
        { value: 'none', label: 'Nej, första gången' },
        { value: 'few', label: 'Ja, 1-3 samarbeten' },
        { value: 'experienced', label: 'Ja, regelbundet' },
      ],
    },
  ];
}
