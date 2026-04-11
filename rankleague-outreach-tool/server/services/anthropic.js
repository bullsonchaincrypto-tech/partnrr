import fetch from 'node-fetch';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

async function callClaude(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY saknas i .env');

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error: ${res.status} - ${err}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

export async function findInfluencers(foretagNamn, bransch) {
  const system = `Du är en expert på svensk influencer-marknadsföring inom gaming, esports och underhållning.
Du ska alltid svara med giltig JSON, inget annat.`;

  const prompt = `Hitta 20 relevanta svenska influencers för företaget "${foretagNamn}" (bransch: ${bransch || 'gaming/esports'}).

Returnera en JSON-array med exakt detta format:
[
  {
    "namn": "Influencerns riktiga namn",
    "kanalnamn": "Kanalnamnet på plattformen",
    "plattform": "YouTube",
    "foljare": "150K",
    "nisch": "Gaming, FPS-spel",
    "kontakt_epost": "email@example.com eller null",
    "kontakt_info": "DM på Instagram @handle"
  }
]

Blanda plattformar: YouTube, Instagram och TikTok. Fokusera på svenska kreatörer inom gaming, esports, fantasy sports och underhållning. Returnera BARA JSON-arrayen, inget annat.`;

  const response = await callClaude(system, prompt);

  try {
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    throw new Error('Kunde inte tolka AI-svar som JSON');
  }
}

export async function generateOutreachMessage(influencer, foretag) {
  const system = `Du skriver professionella men avslappnade outreach-meddelanden på svenska för RankLeague (rankleague.com), en gaming-/tävlingsplattform. Du-tilltal. Alltid inkludera tydlig CTA.`;

  const prompt = `Skriv ett outreach-meddelande till influencern ${influencer.namn} (kanal: ${influencer.kanalnamn} på ${influencer.plattform}, nisch: ${influencer.nisch}).

Företag: ${foretag.namn}
Kontaktperson: ${foretag.kontaktperson || foretag.namn}

Meddelandet ska:
- Vara personligt och referera till influencerns innehåll
- Förklara samarbetsmöjligheten med RankLeague
- Betona hård call-to-action och konvertering (inte bara viralitet)
- Nämna ersättningsmodellen: 300 SEK per video + 10 SEK per signup via referral-kod
- Inkludera tydligt nästa steg / CTA
- Vara på svenska med du-tilltal

Returnera BARA meddelandet (ämne och brödtext), formaterat så här:
ÄMNE: [ämnesrad]
---
[brödtext]`;

  return await callClaude(system, prompt);
}

export async function generateFollowUp(influencer, originalMessage) {
  const system = `Du skriver uppföljningsmeddelanden på svenska för RankLeague. Tonen ska vara vänlig men professionell.`;

  const prompt = `Skriv ett uppföljningsmeddelande till ${influencer.namn} (${influencer.kanalnamn} på ${influencer.plattform}).

Originalmeddelandet skickades för 5+ dagar sedan utan svar. Skriv en kort, vänlig uppföljning som:
- Refererar till det tidigare meddelandet
- Lyfter fram fördelarna med samarbetet
- Har en tydlig CTA
- Inte är påträngande

Returnera BARA meddelandet.`;

  return await callClaude(system, prompt);
}

export async function analyzeConversion(stats) {
  const system = `Du är en marknadsföringsanalytiker specialiserad på influencer-kampanjer.`;

  const prompt = `Analysera dessa outreach-resultat och ge förbättringsförslag:

Total kontaktade: ${stats.total}
Svarat: ${stats.svarat} (${stats.svarsfrekvens}%)
Aktiva avtal: ${stats.avtal}
Avböjt: ${stats.avbojt}

Ge 3-5 konkreta förbättringsförslag på svenska.`;

  return await callClaude(system, prompt);
}

export async function findSponsorProspects(foretagNamn, bransch) {
  const system = `Du är en expert på svenska företag och sponsorpartnerskap inom gaming och esports.
Du ska alltid svara med giltig JSON, inget annat.`;

  const prompt = `Hitta 15 svenska företag som passar som kampanjsponsorer för "${foretagNamn}" (bransch: ${bransch || 'gaming/esports'}).

Fokusera på: gaming-relaterade företag, energidrycker, tech, lifestyle, kläder, snacks/mat som riktar sig mot gamers.

Returnera en JSON-array med exakt detta format:
[
  {
    "namn": "Företagsnamn",
    "kontaktperson": "Namn om känt, annars null",
    "epost": "info@foretag.se eller null",
    "bransch": "Gaming peripherals",
    "instagram_handle": "@handle eller null",
    "hemsida": "https://foretag.se"
  }
]

Returnera BARA JSON-arrayen, inget annat.`;

  const response = await callClaude(system, prompt);
  try {
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    throw new Error('Kunde inte tolka AI-svar som JSON');
  }
}

export async function generateSponsorPitch(prospect, foretag, kanal) {
  const system = `Du skriver professionella sponsorpitcher på svenska för RankLeague (rankleague.com), en gaming-/tävlingsplattform. Tonen ska vara professionell men personlig.`;

  const isInstagramDM = kanal === 'instagram_dm';

  const prompt = `Skriv ${isInstagramDM ? 'ett kort Instagram DM' : 'ett professionellt e-postmeddelande'} till ${prospect.namn} (bransch: ${prospect.bransch}) för att pitcha sponsormöjligheter med RankLeague.

Avsändare: ${foretag.namn}
Kontaktperson: ${foretag.kontaktperson || foretag.namn}

${isInstagramDM ? `Instagram DM ska vara:
- Max 300 tecken
- Direkt och personligt
- Nämna deras Instagram-profil
- Kort CTA (boka möte/chatta vidare)` : `E-postmeddelandet ska:
- Ha professionell ton
- Förklara RankLeagues sponsormöjligheter
- Nämna målgruppen (svenska gamers 16-35 år)
- Erbjuda sponsorpaket (logotypexponering, kampanjsponsring, turneringssponsring)
- Inkludera konkreta siffror på räckvidd
- Ha tydlig CTA (boka demo/möte)`}

Vara på svenska.

Returnera BARA meddelandet formaterat så här:
ÄMNE: [ämnesrad]
---
[brödtext]`;

  return await callClaude(system, prompt);
}

export async function deepAnalyzeOutreach(outreachData) {
  const system = `Du är en senior marknadsföringsanalytiker specialiserad på influencer-kampanjer och konverteringsoptimering. Du ger detaljerade, datadrivna analyser på svenska.`;

  const prompt = `Analysera följande outreach-data i detalj och ge strategiska förbättringsförslag:

ÖVERGRIPANDE STATISTIK:
- Totalt kontaktade: ${outreachData.total}
- Svarat: ${outreachData.svarat} (${outreachData.svarsfrekvens}%)
- Aktiva avtal: ${outreachData.avtal}
- Avböjt: ${outreachData.avbojt}
- E-post öppnade: ${outreachData.oppnade || 0}
- Öppningsfrekvens: ${outreachData.oppningsfrekvens || 0}%

PER PLATTFORM:
${outreachData.perPlatform?.map(p => `- ${p.plattform}: ${p.count} kontaktade, ${p.svar} svar`).join('\n') || 'Ingen data'}

KONVERTERINGSTRATT:
- Kontaktade → Öppnade: ${outreachData.oppningsfrekvens || 0}%
- Öppnade → Svarade: ${outreachData.total > 0 ? ((outreachData.svarat / outreachData.total) * 100).toFixed(1) : 0}%
- Svarade → Avtal: ${outreachData.svarat > 0 ? ((outreachData.avtal / outreachData.svarat) * 100).toFixed(1) : 0}%

TOP INFLUENCERS (efter signups):
${outreachData.topInfluencers?.map(i => `- ${i.namn} (${i.plattform}): ${i.antal_signups} signups`).join('\n') || 'Ingen data'}

Ge en strukturerad analys med:
1. SAMMANFATTNING (2-3 meningar)
2. STYRKOR (vad som fungerar bra)
3. SVAGHETER (vad som behöver förbättras)
4. CTA-OPTIMERING (specifika förslag för bättre call-to-action)
5. PLATTFORMSREKOMMENDATIONER (vilka plattformar som konverterar bäst och varför)
6. INFLUENCER-TYPANALYS (vilka typer av influencers som konverterar bäst)
7. KONKRETA NÄSTA STEG (3-5 åtgärdspunkter)

Var specifik och datadrivet.`;

  return await callClaude(system, prompt);
}
