import fetch from 'node-fetch';

/**
 * Influencer Scoring Pipeline v3 — Förenklad
 *
 * Viktat poängsystem (0–100):
 * - AI-bedömning:       55%  (AI:ns bedömning från sökningen)
 * - Nisch-relevans:     45%  (semantisk matchning företag ↔ influencer)
 *
 * Borttagna (data saknas för AI-hittade influencers):
 * - engagement_rate, audience_demographics, estimated_price_sek, growth_rate_30d
 *
 * PRINCIP: AI-hittade influencers har redan valts ut av AI som relevanta,
 * så scoring ska bekräfta och rangordna — inte straffa för saknad data.
 */

const WEIGHTS = {
  ai_assessment: 0.55,
  niche_relevance: 0.45,
};

// Semantiska nisch-grupper — termer som hör ihop matchas korsvis
const NICHE_GROUPS = [
  ['gaming', 'gamer', 'spel', 'esport', 'esports', 'streamer', 'twitch', 'gameplay', 'lets play'],
  ['fantasy', 'fantasy sport', 'fantasy fotboll', 'fpl', 'allsvenskan fantasy', 'premier league fantasy', 'tips', 'tippning'],
  ['fotboll', 'allsvenskan', 'premier league', 'champions league', 'uefa', 'fifa', 'soccer', 'football'],
  ['sport', 'idrott', 'sporttips', 'betting', 'odds', 'sportanalys'],
  ['tech', 'teknik', 'teknologi', 'ai', 'it', 'programmering', 'data', 'saas', 'startup', 'devops', 'software', 'mjukvara', 'developer', 'utvecklare', 'kod', 'cloud', 'moln', 'cybersäkerhet', 'kodgranskning', 'elektronik', 'hemelektronik', 'gadget', 'gadgets', 'prylar', 'smart hem', 'smarta hem', 'unboxing', 'recension', 'review', 'smartklocka', 'hörlurar', 'högtalare', 'wearable'],
  ['fitness', 'träning', 'gym', 'hälsa', 'wellness', 'kost'],
  ['mode', 'fashion', 'stil', 'kläder', 'beauty', 'skönhet'],
  ['musik', 'music', 'artist', 'sångare', 'producer'],
  ['mat', 'food', 'recept', 'matlagning', 'restaurang'],
  ['resor', 'travel', 'resa', 'äventyr', 'backpacking'],
  ['humor', 'komedi', 'comedy', 'underhållning', 'entertainment', 'rolig'],
  ['finans', 'ekonomi', 'aktier', 'investering', 'sparande', 'pengar'],
  ['youtube', 'youtuber', 'vlogg', 'vlog', 'content creator'],
  ['tiktok', 'tiktoker', 'reels', 'shorts', 'short form'],
  ['instagram', 'influencer', 'influencer marketing'],
];

/**
 * FILTER: Eliminera influencers som inte matchar grundkrav
 */
export async function filterInfluencers(influencers, companyProfile) {
  return influencers.filter(inf => {
    // Kvalitets-filter: fake followers (om data finns)
    if (inf.fake_follower_pct != null && inf.fake_follower_pct > 15) {
      inf._filter_reason = 'Hög andel fake followers (>15%)';
      return false;
    }

    // Kvalitets-filter: extremt låg engagement (om data finns)
    if (inf.engagement_rate != null && inf.engagement_rate < 0.5) {
      inf._filter_reason = 'Extremt låg engagement rate (<0.5%)';
      return false;
    }

    return true;
  });
}

/**
 * SCORING: Beräkna viktad matchnings-score (0-100)
 */
export async function scoreInfluencer(influencer, companyProfile) {
  const scores = {};
  const details = {};

  // 1. AI-BEDÖMNING (0-100) — från AI-sökningen
  scores.ai_assessment = calculateAiScore(influencer);
  details.ai_assessment = `AI-bedömning: ${scores.ai_assessment}/100`;

  // 2. NISCH-RELEVANS (0-100) — semantisk matchning
  scores.niche_relevance = calculateNicheScore(influencer, companyProfile);
  details.niche_relevance = `Nisch-matchning: ${scores.niche_relevance}/100`;

  // Viktat totalpoäng
  const totalScore = Math.round(
    scores.ai_assessment * WEIGHTS.ai_assessment +
    scores.niche_relevance * WEIGHTS.niche_relevance
  );

  return {
    total_score: Math.min(totalScore, 100),
    component_scores: scores,
    details,
    weights: WEIGHTS,
  };
}

/**
 * AI-bedömning: Använd ai_score från AI-sökningen
 * AI:n har redan bedömt relevans — vi litar på det.
 */
function calculateAiScore(influencer) {
  // ai_score sätts av Claude i ai-search.js (0-100)
  if (influencer.ai_score != null) {
    return Math.max(0, Math.min(100, Math.round(influencer.ai_score)));
  }

  // Om AI-sökningen markerade som "top match" eller liknande
  if (influencer.match_quality === 'high' || influencer.match_quality === 'excellent') {
    return 90;
  }
  if (influencer.match_quality === 'medium') {
    return 70;
  }

  // Fallback: AI har hittat denna influencer, vilket redan är en signal
  return 80;
}

/**
 * Nisch-relevans: Semantisk matchning med nisch-grupper
 *
 * Istället för exakt ordmatchning används semantiska grupper
 * så att "fantasy fotboll" matchar "Allsvenskan Fantasy" etc.
 */
function calculateNicheScore(influencer, profile) {
  const companyText = [
    profile?.niches || '',
    profile?.bransch || '',
    profile?.beskrivning || '',
    profile?.brief_answers?.goal || '',
    profile?.namn || profile?.company || '',
  ].join(' ').toLowerCase().trim();

  const infText = [
    ...(influencer.niches || []),
    influencer.nisch || '',
    influencer.bio || '',
    influencer.name || influencer.namn || '',
    influencer.handle || influencer.kanalnamn || '',
  ].join(' ').toLowerCase().trim();

  if (!companyText || !infText) return 80; // Neutral-hög om data saknas

  // Hitta vilka nisch-grupper företaget tillhör
  const companyGroups = new Set();
  for (let i = 0; i < NICHE_GROUPS.length; i++) {
    for (const term of NICHE_GROUPS[i]) {
      if (companyText.includes(term)) {
        companyGroups.add(i);
        break;
      }
    }
  }

  // Hitta vilka nisch-grupper influencern tillhör
  const infGroups = new Set();
  for (let i = 0; i < NICHE_GROUPS.length; i++) {
    for (const term of NICHE_GROUPS[i]) {
      if (infText.includes(term)) {
        infGroups.add(i);
        break;
      }
    }
  }

  // Räkna matchande grupper
  let matchCount = 0;
  for (const g of companyGroups) {
    if (infGroups.has(g)) matchCount++;
  }

  if (companyGroups.size === 0) {
    // Inget att matcha mot — kör direkt ordmatchning som fallback
    return calculateDirectWordMatch(companyText, infText);
  }

  const matchRatio = matchCount / companyGroups.size;

  if (matchRatio >= 0.8) return 95;    // Nästan alla grupper matchar
  if (matchRatio >= 0.6) return 88;
  if (matchRatio >= 0.4) return 78;
  if (matchRatio >= 0.2) return 65;
  if (matchCount >= 1) return 55;      // Minst en grupp matchar

  // Inga grupper matchade — prova direkt ordmatchning men med lägre tak
  // Om företaget HAR nisch-grupper men influencern inte matchar någon,
  // är det en stark signal om dålig matchning
  const directScore = calculateDirectWordMatch(companyText, infText);
  return Math.min(directScore, 50); // Max 50 om inga nisch-grupper matchar
}

/**
 * Fallback: Direkt ordmatchning (om semantiska grupper inte räcker)
 */
function calculateDirectWordMatch(companyText, infText) {
  const companyTerms = companyText.split(/[,\s]+/).filter(t => t.length > 2);
  if (companyTerms.length === 0) return 75;

  const matchCount = companyTerms.filter(term => infText.includes(term)).length;
  const ratio = matchCount / companyTerms.length;

  if (ratio >= 0.5) return 85;
  if (ratio >= 0.3) return 70;
  if (ratio >= 0.1) return 55;
  if (matchCount >= 1) return 45;
  return 35;
}

/**
 * AI-genererad motivering per influencer
 */
export async function generateMatchMotivation(influencer, companyProfile, scoreResult) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const context = [
    `Influencer: ${influencer.name || influencer.namn} (@${influencer.handle || influencer.kanalnamn})`,
    `Plattform: ${influencer.platform || influencer.plattform}`,
    `Följare: ${(influencer.followers || 0).toLocaleString('sv-SE')}`,
    `Nisch: ${(influencer.niches || [influencer.nisch]).filter(Boolean).join(', ')}`,
    ``,
    `Företag: ${companyProfile?.namn || companyProfile?.company}`,
    `Bransch: ${companyProfile?.bransch || companyProfile?.industry || ''}`,
    `Mål: ${companyProfile?.brief_answers?.goal || 'ej angivet'}`,
    ``,
    `Matchnings-score: ${scoreResult.total_score}/100`,
    `AI-bedömning: ${scoreResult.component_scores.ai_assessment}/100`,
    `Nisch-relevans: ${scoreResult.component_scores.niche_relevance}/100`,
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: 'Du skriver MYCKET korta motiveringar (MAX 90 tecken) på svenska för varför en influencer matchar ett företag. Börja ALDRIG med namn/kontonamn. Nämn ALDRIG antal följare. Fokusera på nisch-matchning och passform.',
        messages: [{
          role: 'user',
          content: `Skriv en motivering på MAX 90 tecken:\n\n${context}`,
        }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.content[0].text;
  } catch {
    return null;
  }
}

/**
 * Claude Sonnet Scoring — Steg 6 i pipeline
 *
 * Istället för viktat poängsystem, låter Claude analysera ALLA influencers
 * och ge varje en match_score (0-100) + motivation.
 * Detta ger mycket bättre resultat eftersom Claude kan tolka kontext.
 */
async function scoreWithClaude(influencers, companyProfile, nischLabels = []) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || influencers.length === 0) return null;

  // Formatera influencer-data kompakt
  const infData = influencers.map((inf, i) => ({
    index: i,
    namn: inf.name || inf.namn || 'Okänd',
    handle: inf.handle || inf.kanalnamn || '',
    plattform: inf.platform || inf.plattform || '',
    foljare: inf.followers || inf.foljare_exakt || null,
    nisch: (inf.niches || []).join(', ') || inf.nisch || '',
    bio: (inf.bio || inf.beskrivning || '').slice(0, 100),
    datakalla: inf.datakalla || '',
    ai_score_prev: inf.ai_score || null,
  }));

  const companyContext = [
    `Företag: ${companyProfile?.namn || 'Okänt'}`,
    `Bransch: ${companyProfile?.bransch || 'Ej angiven'}`,
    `Beskrivning: ${companyProfile?.beskrivning || 'Ej angiven'}`,
    companyProfile?.brief_answers?.goal ? `Mål: ${companyProfile.brief_answers.goal}` : '',
    nischLabels.length > 0 ? `AI-identifierade nischer för detta företag: ${nischLabels.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const systemPrompt = `Du är en expert på influencer-marknadsföring i Sverige. Du ska bedöma hur väl varje influencer matchar ett företag.

GE VARJE INFLUENCER:
1. match_score (0-100): Hur väl matchar influencern företagets nisch, publik och mål
2. motivation (MAX 90 tecken, en kort mening på svenska): Förklara VARFÖR profilen matchar eller inte matchar företaget — fokusera på nisch-relevans och passform

BEDÖMNINGSKRITERIER:
- Nisch-relevans (viktigast): Matchar influencerns innehåll företagets bransch och AI-identifierade nischer?
- Plattforms-passform: Rätt plattform för företagets målgrupp?
- Autenticitet: Har profilen riktig data (followers, bio) eller bara AI-uppskattning?
- Storlek — bedöm utifrån kategori:
    Nano (1K–10K): Hög engagemang, nischad publik — bra för konvertering
    Mikro (10K–50K): Bra balans mellan räckvidd och engagemang — ofta bäst ROI
    Mellanstor (50K–200K): Bred räckvidd med bibehållen relevans
    Stor (200K–500K): Hög räckvidd, bra för varumärkeskännedom
    Mega (500K+): Massiv räckvidd men lägre engagemang
    Under 1K: STRAFFAS HÅRT. Troligen ny, inaktiv eller felaktigt konto. Max score 30.
    Under 50 följare: STRAFFAS EXTREMT. Max score 15. Dessa konton är i princip värdelösa.
    0 följare eller null: Max score 10. Profilen kunde inte verifieras.
- Svenska profiler som riktar sig till svensk publik → bonus

SCORING-GUIDE:
90-100: Perfekt match — exakt rätt nisch, verifierad profil (1K+ följare), rätt storlek
80-89:  Mycket bra — rätt nisch, bra storlek (1K+ följare)
70-79:  Bra match — relaterad nisch, bra potential
60-69:  OK match — delvis relevant, kräver mer utredning
50-59:  Svag match — lös koppling till branschen
30-49:  Dålig match — inte relevant ELLER under 1K följare
Under 30: Värdelös — fel nisch och/eller inga följare

Svara med ENBART en JSON-array. Varje element: { "index": 0, "match_score": 85, "motivation": "kort text max 90 tecken" }
REGLER FÖR MOTIVATION:
- MAX 90 tecken. Skriv kort och kärnfullt.
- Börja ALDRIG med influencerns namn eller kontonamn — det syns redan i UI:t.
- Nämn ALDRIG antal följare — det syns redan i UI:t.
- Fokusera ENBART på WHY: nisch-matchning, innehållstyp, publikpassform.`;

  const userMessage = `${companyContext}

INFLUENCERS ATT BEDÖMA:
${JSON.stringify(infData, null, 1)}

Bedöm VARJE influencer. Svara med ENBART JSON-array:`;

  try {
    console.log(`[Scoring] Claude Sonnet bedömer ${influencers.length} influencers...`);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      console.warn(`[Scoring] Claude API ${res.status} — faller tillbaka på algoritmisk scoring`);
      return null;
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    // Parsa JSON från svaret
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      console.warn('[Scoring] Kunde inte parsa Claude-svar');
      return null;
    }

    const scores = JSON.parse(match[0]);
    console.log(`[Scoring] ✅ Claude bedömde ${scores.length} influencers`);
    return scores;
  } catch (err) {
    console.error('[Scoring] Claude scoring misslyckades:', err.message);
    return null;
  }
}

/**
 * Batch: Scorea och motivera en lista med influencers
 *
 * PRIMÄR: Claude Sonnet tolkar alla resultat och ger match_score (Steg 6)
 * FALLBACK: Algoritmisk scoring (viktat AI 55% + nisch 45%)
 */
export async function scoreAndRankInfluencers(influencers, companyProfile, { generateMotivations = true, topN = 5, nischLabels = [] } = {}) {
  // 1. Filter
  const filtered = await filterInfluencers(influencers, companyProfile);

  // 2. Försök Claude Sonnet scoring (primär)
  const claudeScores = await scoreWithClaude(filtered, companyProfile, nischLabels);

  let scored;

  if (claudeScores?.length > 0) {
    // ── Claude Sonnet scoring (primär) ──
    console.log(`[Scoring] Använder Claude Sonnet scoring`);

    // Skapa lookup map: index → score data
    const scoreMap = new Map();
    for (const s of claudeScores) {
      scoreMap.set(s.index, s);
    }

    scored = filtered.map((inf, i) => {
      const claude = scoreMap.get(i);
      return {
        ...inf,
        match_score: claude?.match_score ?? 50,
        ai_motivation: claude?.motivation || inf.ai_motivation || null,
        score_details: { claude_score: claude?.match_score ?? 50 },
        score_breakdown: { claude_motivation: claude?.motivation || '' },
      };
    });
  } else {
    // ── Fallback: algoritmisk scoring ──
    console.log(`[Scoring] Fallback: algoritmisk scoring`);

    scored = await Promise.all(filtered.map(async inf => {
      const result = await scoreInfluencer(inf, companyProfile);
      return {
        ...inf,
        match_score: result.total_score,
        score_details: result.component_scores,
        score_breakdown: result.details,
      };
    }));

    // Generera motiveringar för topp N (bara vid fallback)
    if (generateMotivations) {
      const topInfluencers = scored.slice(0, topN);
      const motivations = await Promise.all(
        topInfluencers.map(inf =>
          generateMatchMotivation(inf, companyProfile, {
            total_score: inf.match_score,
            component_scores: inf.score_details,
          }).catch(() => null)
        )
      );

      for (let i = 0; i < topInfluencers.length; i++) {
        scored[i].ai_motivation = motivations[i];
      }
    }
  }

  // 3. Sortera
  scored.sort((a, b) => b.match_score - a.match_score);

  return scored;
}
