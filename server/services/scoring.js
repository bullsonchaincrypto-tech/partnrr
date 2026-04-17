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
 * men scoring MÅSTE straffa profiler med 0 eller väldigt få följare.
 * En profil utan följare kan aldrig vara värdefull oavsett nisch-matchning.
 */

const WEIGHTS = {
  ai_assessment: 0.45,
  niche_relevance: 0.35,
  follower_credibility: 0.20,
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

    // OBS: Vi filtrerar INTE bort 0-follower-profiler här — de behålls men
    // straffas hårt i scoring (max 10 poäng). Detta ger transparens i resultaten
    // istället för att de bara försvinner.

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

  // 3. FÖLJAR-TROVÄRDIGHET (0-100) — straffar profiler med 0 eller väldigt få följare
  scores.follower_credibility = calculateFollowerScore(influencer);
  details.follower_credibility = `Följar-trovärdighet: ${scores.follower_credibility}/100`;

  // Viktat totalpoäng
  const totalScore = Math.round(
    scores.ai_assessment * WEIGHTS.ai_assessment +
    scores.niche_relevance * WEIGHTS.niche_relevance +
    scores.follower_credibility * WEIGHTS.follower_credibility
  );

  // Hård cap: oavsett andra poäng, 0 followers → max 10, <50 → max 25, <1000 → max 40
  const cappedScore = applyFollowerCap(totalScore, influencer);

  return {
    total_score: Math.min(cappedScore, 100),
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
 * Följar-trovärdighet: Straffar profiler med 0 eller väldigt få följare.
 * En profil utan followers är i princip värdelös för marknadsföring.
 */
function calculateFollowerScore(influencer) {
  const followers = influencer.followers || influencer.foljare_exakt || 0;

  if (followers === 0 || followers == null) return 0;    // Ingen data alls
  if (followers < 50) return 5;                           // Nästan tom profil
  if (followers < 100) return 15;
  if (followers < 500) return 30;
  if (followers < 1000) return 45;                        // Under nano
  if (followers < 5000) return 65;                        // Nano (liten)
  if (followers < 10000) return 75;                       // Nano
  if (followers < 50000) return 85;                       // Mikro
  if (followers < 200000) return 92;                      // Mellanstor
  return 100;                                              // Stor+
}

/**
 * Hård cap baserat på följarantal — oavsett AI-bedömning och nisch-matchning
 * kan en profil med 0 followers aldrig få hög score.
 */
function applyFollowerCap(score, influencer) {
  const followers = influencer.followers || influencer.foljare_exakt || 0;

  // YouTube-profiler med verifierad data från API har alltid subscribers
  // Men IG/TT profiler kan ha null followers om enrichment misslyckades
  if (followers === 0 || followers == null) return Math.min(score, 15);
  if (followers < 50) return Math.min(score, 20);
  if (followers < 100) return Math.min(score, 30);
  if (followers < 500) return Math.min(score, 45);

  return score; // 500+ followers → ingen cap
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
// Maxbatch-storlek innan vi delar upp anropet. 80 profiler ≈ 3,200 output tokens
// (välunder max_tokens=8000) → säker marginal mot trunkering.
const SCORING_BATCH_SIZE = 80;

async function scoreWithClaude(influencers, companyProfile, nischLabels = []) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || influencers.length === 0) return null;

  // BATCHA stora dataset så vi inte överskrider output token-limit
  if (influencers.length > SCORING_BATCH_SIZE) {
    console.log(`[Scoring] ${influencers.length} influencers > ${SCORING_BATCH_SIZE} → batchar i ${Math.ceil(influencers.length / SCORING_BATCH_SIZE)} omgångar`);
    const allScores = [];
    let runningOffset = 0;
    for (let i = 0; i < influencers.length; i += SCORING_BATCH_SIZE) {
      const batch = influencers.slice(i, i + SCORING_BATCH_SIZE);
      const batchScores = await scoreWithClaudeSingleBatch(batch, companyProfile, nischLabels, runningOffset);
      if (!batchScores) {
        console.warn(`[Scoring] Batch ${Math.floor(i / SCORING_BATCH_SIZE) + 1} misslyckades — fortsätter med övriga`);
      } else {
        allScores.push(...batchScores);
      }
      runningOffset += batch.length;
    }
    if (allScores.length === 0) return null;
    console.log(`[Scoring] ✅ Klar batching: ${allScores.length}/${influencers.length} influencers scorade`);
    return allScores;
  }

  // Liten lista — kör som ett enskilt anrop (med offset 0)
  return scoreWithClaudeSingleBatch(influencers, companyProfile, nischLabels, 0);
}

/**
 * Internt anrop: scorea EN batch av influencers med Claude Sonnet.
 * `globalOffset` används för att returnera korrekta globala index så
 * att caller kan matcha tillbaka mot original-listan.
 */
async function scoreWithClaudeSingleBatch(influencers, companyProfile, nischLabels = [], globalOffset = 0) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || influencers.length === 0) return null;

  // Formatera influencer-data kompakt — använd LOKALA index (0..N-1) för Claude
  const infData = influencers.map((inf, i) => ({
    index: i,
    namn: inf.name || inf.namn || 'Okänd',
    handle: inf.handle || inf.kanalnamn || '',
    plattform: inf.platform || inf.plattform || '',
    foljare: inf.followers || inf.foljare_exakt || null,
    nisch: (inf.niches || []).join(', ') || inf.nisch || '',
    bio: (inf.bio || inf.beskrivning || '').slice(0, 500),
    yt_topics: inf.topic_categories || [],
    business_category: inf.business_category || '',
    datakalla: inf.datakalla || '',
  }));

  const companyContext = [
    `Företag: ${companyProfile?.namn || 'Okänt'}`,
    `Bransch: ${companyProfile?.bransch || 'Ej angiven'}`,
    `Beskrivning: ${companyProfile?.beskrivning || 'Ej angiven'}`,
    companyProfile?.brief_answers?.goal ? `Mål: ${companyProfile.brief_answers.goal}` : '',
    nischLabels.length > 0 ? `AI-identifierade nischer för detta företag: ${nischLabels.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const systemPrompt = `Du bedömer hur väl svenska influencers matchar ett företag för samarbete.

GE VARJE INFLUENCER:
1. match_score (0-100)
2. motivation (MAX 90 tecken, svenska)

VIKTIGASTE KRITERIET — NISCH-RELEVANS (80% av bedömningen):
Fråga dig: "Skapar denna person content som företagets kunder tittar på?"
- Om influencerns bio/handle/topics handlar om SAMMA ämne som företaget → 75+
- Om influencerns bio/handle/topics är EXAKT rätt nisch → 85+
- Om influencern dessutom gör recensioner/tester/tips i nischen → 90+

SEKUNDÄRT — STORLEK (20% av bedömningen):
- 1K+ följare med rätt nisch = fullt värdefull
- Nano (1K–10K) med rätt nisch är LIKA BRA som mikro — de har ofta bättre konvertering
- Under 500 följare → dra av 15-20 poäng
- Under 100 eller 0 → max score 25

SCORING-REFERENS (kalibrering):
95: Exakt nisch + recenserar/testar produkter i nischen + 1K+ följare
85: Exakt nisch + skapar content i nischen + 1K+ följare
75: Relaterad nisch + content överlappar delvis
60: Lös koppling — nisch angränsar men inte direkt match
40: Svag koppling — bred kanal där nischen bara nämns ibland
25: Fel nisch eller för få följare för att vara användbar

VIKTIGT: Var INTE för konservativ. En kanal som heter "SmartaHem" och gör
hemautomation-videos ÄR en 85-95 match för ett smart hem-företag.
En tech-recensent som testar smarta prylar ÄR en 75-85 match.
Använd hela skalan — de flesta profiler som passerat vår pipeline har
redan filtrerats för relevans, så 70+ borde vara vanligt.

Svara med ENBART JSON-array: [{ "index": 0, "match_score": 85, "motivation": "text" }]
MOTIVATION: Max 90 tecken. Nämn INTE namn eller följarantal (syns i UI). Fokusera på WHY.`;

  const userMessage = `${companyContext}

INFLUENCERS ATT BEDÖMA:
${JSON.stringify(infData, null, 1)}

Bedöm VARJE influencer. Svara med ENBART JSON-array:`;

  try {
    console.log(`[Scoring] Claude Sonnet bedömer ${influencers.length} influencers (offset=${globalOffset})...`);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        // Höjt från 4000 → 8000. Per profil ~40 output tokens × 80 batch = 3200
        // tokens; med 8000 har vi gott om marginal mot trunkering.
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[Scoring] Claude API ${res.status} — faller tillbaka på algoritmisk scoring. ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const stopReason = data.stop_reason;

    // Varna om Claude trunkerades (max_tokens nått)
    if (stopReason === 'max_tokens') {
      console.warn(`[Scoring] ⚠ Claude-svaret trunkerades (stop_reason=max_tokens). Försöker parsa partiellt svar...`);
    }

    // Parsa JSON från svaret. Om svaret trunkerades kan vi extrahera
    // alla kompletta objekt fram till sista parsbara komma.
    let scores;
    const fullMatch = text.match(/\[[\s\S]*\]/);
    if (fullMatch) {
      try {
        scores = JSON.parse(fullMatch[0]);
      } catch {
        scores = null;
      }
    }
    if (!scores) {
      // Fallback: extrahera så många kompletta objekt vi kan från ett trunkerat svar
      const objects = [];
      const objRegex = /\{\s*"index"\s*:\s*\d+[^{}]*\}/g;
      let m;
      while ((m = objRegex.exec(text)) !== null) {
        try { objects.push(JSON.parse(m[0])); } catch {}
      }
      if (objects.length > 0) {
        console.warn(`[Scoring] Parsade ${objects.length} kompletta objekt från trunkerat svar`);
        scores = objects;
      }
    }
    if (!scores) {
      console.warn('[Scoring] Kunde inte parsa Claude-svar');
      return null;
    }

    // Översätt LOKALA index till GLOBALA så caller kan matcha tillbaka korrekt
    const globalScores = scores.map(s => ({ ...s, index: (s.index || 0) + globalOffset }));

    console.log(`[Scoring] ✅ Claude bedömde ${globalScores.length}/${influencers.length} influencers (offset=${globalOffset})`);
    return globalScores;
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
      const rawScore = claude?.match_score ?? 50;
      // Säkerhetsnät: cap baserat på followers även för Claude-scoring
      const cappedScore = applyFollowerCap(rawScore, inf);
      if (cappedScore !== rawScore) {
        console.log(`[Scoring] Cap: @${inf.handle || inf.kanalnamn} ${rawScore}→${cappedScore} (${inf.followers || 0} followers)`);
      }
      return {
        ...inf,
        match_score: cappedScore,
        ai_motivation: claude?.motivation || inf.ai_motivation || null,
        score_details: { claude_score: rawScore, capped_score: cappedScore },
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
