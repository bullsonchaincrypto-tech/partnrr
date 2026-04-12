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
  ['tech', 'teknik', 'teknologi', 'ai', 'it', 'programmering', 'data'],
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

  // Inga grupper matchade — prova direkt ordmatchning
  return calculateDirectWordMatch(companyText, infText);
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
        system: 'Du skriver korta (max 2 meningar) motiveringar på svenska för varför en influencer matchar ett företag. Var specifik och datadrivet — nämn konkreta siffror. Ingen inledande fras som "Denna influencer...". Börja direkt med insikten.',
        messages: [{
          role: 'user',
          content: `Skriv en 2-menings motivering:\n\n${context}`,
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
 * Batch: Scorea och motivera en lista med influencers
 */
export async function scoreAndRankInfluencers(influencers, companyProfile, { generateMotivations = true, topN = 5 } = {}) {
  // 1. Filter
  const filtered = await filterInfluencers(influencers, companyProfile);

  // 2. Score alla
  const scored = filtered.map(inf => {
    const result = scoreInfluencer(inf, companyProfile);
    return {
      ...inf,
      match_score: result.total_score,
      score_details: result.component_scores,
      score_breakdown: result.details,
    };
  });

  // 3. Sortera
  scored.sort((a, b) => b.match_score - a.match_score);

  // 4. Generera motiveringar för topp N
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

  return scored;
}
