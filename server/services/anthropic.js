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
    const rawErr = await res.text();
    console.error(`[Anthropic] API-fel ${res.status}:`, rawErr);
    // Sanitera — visa aldrig rå API-data till användaren
    if (res.status === 429) throw new Error('AI-tjänsten är tillfälligt överbelastad. Vänta några sekunder och försök igen.');
    if (res.status === 529) throw new Error('AI-tjänsten är tillfälligt överbelastad. Vänta en minut och försök igen.');
    if (res.status >= 500) throw new Error('AI-tjänsten svarar inte just nu. Försök igen om en stund.');
    throw new Error('Kunde inte generera meddelande. Kontrollera inställningar och försök igen.');
  }

  const data = await res.json();
  return data.content[0].text;
}

/**
 * Nischer med precisa YouTube-söktermer.
 * Organiserade i huvudkategorier med underkategorier.
 * Användaren väljer FÖRST en huvudkategori i dropdown, sedan 1-3 underkategorier.
 */
export const NISCH_GROUPS = [
  {
    group: 'Gaming',
    icon: '🎮',
    nischer: [
      { id: 'allman-gaming', label: 'Allmän Gaming', terms: ['svenska gaming youtubers', 'svensk gamer youtube', 'gaming sverige kanal', 'bästa svenska gaming kanaler'] },
      { id: 'minecraft', label: 'Minecraft', terms: ['minecraft svensk youtube', 'minecraft lets play svenska', 'minecraft survival svensk'] },
      { id: 'fortnite', label: 'Fortnite', terms: ['fortnite svensk youtube', 'fortnite gameplay svenska', 'fortnite clips sverige'] },
      { id: 'fifa-ea-fc', label: 'FIFA / EA FC', terms: ['FIFA ultimate team svensk', 'EA FC 25 gameplay svenska', 'FIFA youtuber sverige', 'EA FC karriärläge svensk'] },
      { id: 'roblox', label: 'Roblox', terms: ['roblox svenska youtube', 'roblox gameplay svensk', 'roblox lets play sverige'] },
      { id: 'call-of-duty', label: 'Call of Duty / Warzone', terms: ['call of duty svensk youtube', 'warzone gameplay svenska', 'COD clips sverige'] },
      { id: 'cs2', label: 'CS2 / Counter-Strike', terms: ['CS2 svensk youtube', 'counter-strike 2 gameplay svenska', 'CS2 highlights sverige', 'CSGO svensk'] },
      { id: 'valorant', label: 'Valorant', terms: ['valorant svensk youtube', 'valorant gameplay svenska', 'valorant tips sverige'] },
      { id: 'apex', label: 'Apex Legends', terms: ['apex legends svensk youtube', 'apex gameplay svenska', 'apex legends sverige'] },
      { id: 'league-of-legends', label: 'League of Legends', terms: ['league of legends svensk', 'LoL gameplay svenska', 'league of legends sverige youtube'] },
      { id: 'gta', label: 'GTA / Rockstar', terms: ['GTA svensk youtube', 'GTA roleplay svenska', 'GTA online sverige'] },
      { id: 'pokemon', label: 'Pokémon', terms: ['pokemon svensk youtube', 'pokemon gameplay svenska', 'pokemon cards sverige'] },
      { id: 'horror-gaming', label: 'Skräckspel', terms: ['skräckspel svensk youtube', 'horror game svenska', 'scary games sverige'] },
      { id: 'retro-gaming', label: 'Retro Gaming', terms: ['retro gaming svensk', 'retro spel youtube svenska', 'gamla spel sverige'] },
      { id: 'vr-gaming', label: 'VR Gaming', terms: ['VR gaming svensk youtube', 'virtual reality spel svenska', 'VR gameplay sverige'] },
    ],
  },
  {
    group: 'Esport & Tävling',
    icon: '🏆',
    nischer: [
      { id: 'esport', label: 'Esport & Turneringar', terms: ['esport sverige youtube', 'svensk esport turnering', 'esport nyheter svenska'] },
      { id: 'esport-cs2', label: 'CS2 Esport', terms: ['CS2 esport svenska', 'CS2 turnering sverige', 'NIP CS2 youtube'] },
      { id: 'esport-valorant', label: 'Valorant Esport', terms: ['valorant esport svenska', 'valorant turnering sverige', 'VCT nordic'] },
      { id: 'esport-lol', label: 'LoL Esport', terms: ['league of legends esport svensk', 'NLC league of legends', 'LoL esport norden'] },
    ],
  },
  {
    group: 'Fantasy & Betting',
    icon: '📊',
    nischer: [
      { id: 'fpl', label: 'Fantasy Premier League (FPL)', terms: ['FPL tips svenska', 'fantasy premier league svenska', 'FPL gameweek tips', 'FPL manager svensk youtube'] },
      { id: 'fantasy-fotboll', label: 'Fantasy Fotboll (Allsvenskan)', terms: ['fantasy allsvenskan tips', 'allsvenskan fantasy manager', 'fantasy fotboll svenska'] },
      { id: 'fantasy-hockey', label: 'Fantasy Hockey', terms: ['fantasy hockey tips svenska', 'NHL fantasy svensk', 'SHL fantasy youtube'] },
      { id: 'betting', label: 'Betting & Odds', terms: ['betting tips svenska youtube', 'odds tips svensk', 'sportsbetting sverige youtube'] },
      { id: 'poker', label: 'Poker', terms: ['poker svensk youtube', 'poker tips svenska', 'poker turnering sverige'] },
    ],
  },
  {
    group: 'Sport',
    icon: '⚽',
    nischer: [
      { id: 'fotboll', label: 'Fotboll', terms: ['fotboll youtube svenska', 'allsvenskan highlights youtube', 'premier league svenska youtube', 'fotbollssnack svensk'] },
      { id: 'hockey', label: 'Hockey / Ishockey', terms: ['hockey youtube svenska', 'SHL highlights youtube', 'NHL svenska youtube', 'ishockey sverige'] },
      { id: 'basket', label: 'Basket / NBA', terms: ['basket youtube svenska', 'NBA svenska youtube', 'basketball sverige'] },
      { id: 'kampsport', label: 'Kampsport / MMA / UFC', terms: ['MMA svensk youtube', 'UFC svenska', 'kampsport sverige youtube', 'boxning svensk'] },
      { id: 'tennis', label: 'Tennis', terms: ['tennis svensk youtube', 'tennis tips svenska', 'tennis sverige'] },
      { id: 'golf', label: 'Golf', terms: ['golf svensk youtube', 'golf tips svenska', 'golf vlogg sverige'] },
      { id: 'schack', label: 'Schack', terms: ['schack youtube svenska', 'chess tips svenska', 'schack tutorial svensk'] },
      { id: 'lopsport', label: 'Löpning / Marathon', terms: ['löpning youtube svenska', 'marathon tips svensk', 'löpträning youtube sverige'] },
      { id: 'vintersport', label: 'Vintersport / Skidor', terms: ['skidor youtube svenska', 'vintersport sverige', 'slalom youtube svensk', 'längdskidor youtube'] },
    ],
  },
  {
    group: 'Fordon & Motor',
    icon: '🚗',
    nischer: [
      { id: 'bilar', label: 'Bilar / Bilrecensioner', terms: ['bilar youtube svenska', 'bilrecension svensk', 'bil vlogg sverige', 'sportbil svensk youtube'] },
      { id: 'motorcykel', label: 'Motorcykel', terms: ['motorcykel youtube svenska', 'mc vlogg svensk', 'motorcykel sverige youtube'] },
      { id: 'skoter', label: 'Skoter / Snöskoter', terms: ['skoter youtube svenska', 'snöskoter youtube svensk', 'skoter vlogg sverige', 'skoterkörning youtube'] },
      { id: 'elbil', label: 'Elbil / Tesla', terms: ['elbil youtube svenska', 'Tesla svensk youtube', 'elbil recension svenska', 'elektrisk bil sverige'] },
      { id: 'epa-traktor', label: 'EPA / A-traktor', terms: ['EPA traktor youtube svenska', 'A-traktor youtube svensk', 'EPA bygge sverige', 'moppe youtube svensk'] },
      { id: 'bat', label: 'Båt / Marin', terms: ['båt youtube svenska', 'båtliv youtube svensk', 'segelbåt sverige youtube', 'båt vlogg'] },
      { id: 'lastbil', label: 'Lastbil / Truck', terms: ['lastbil youtube svenska', 'truck vlogg svensk', 'långtradare youtube sverige'] },
    ],
  },
  {
    group: 'Ekonomi & Finans',
    icon: '💰',
    nischer: [
      { id: 'aktier', label: 'Aktier & Investeringar', terms: ['aktier youtube svenska', 'investering tips svensk', 'aktiemarknaden youtube sverige', 'börsen svenska'] },
      { id: 'trading', label: 'Trading / Daytrading', terms: ['trading youtube svenska', 'daytrading svensk', 'forex trading sverige youtube', 'aktietrading tips'] },
      { id: 'krypto', label: 'Krypto / Bitcoin', terms: ['krypto youtube svenska', 'bitcoin tips svensk', 'kryptovaluta youtube sverige', 'crypto svenska'] },
      { id: 'privatekonomi', label: 'Privatekonomi / Spara', terms: ['privatekonomi youtube svenska', 'spara pengar tips svensk', 'ekonomi tips youtube sverige'] },
      { id: 'fastigheter', label: 'Fastigheter / Bostäder', terms: ['fastigheter youtube svenska', 'bostadsmarknad svensk', 'hyresfastigheter tips youtube sverige'] },
      { id: 'entreprenorskap', label: 'Entreprenörskap', terms: ['entreprenörskap youtube svenska', 'starta företag youtube svensk', 'business tips sverige'] },
    ],
  },
  {
    group: 'Underhållning',
    icon: '🎭',
    nischer: [
      { id: 'vlogg', label: 'Svenska Vloggare', terms: ['svensk vlogg youtube', 'svenska youtubers vlogg', 'vardagsvlogg svensk'] },
      { id: 'humor', label: 'Humor & Komedi', terms: ['roliga svenska youtubers', 'komedi youtube svensk', 'humor sverige youtube'] },
      { id: 'reaktioner', label: 'Reaktioner', terms: ['reagerar på svenska youtube', 'reaction video svensk', 'reaktion svenska youtube'] },
      { id: 'podcast', label: 'Podcast / Samtal', terms: ['podcast youtube svenska', 'svensk podcast youtube', 'samtalspodcast sverige'] },
      { id: 'paranormalt', label: 'Mysterier / Paranormalt', terms: ['mysterier youtube svenska', 'true crime svensk', 'paranormalt youtube sverige', 'spöken svensk'] },
      { id: 'animation', label: 'Animation / Cartoon', terms: ['animation youtube svenska', 'svensk animatör youtube', 'tecknad film youtube'] },
      { id: 'asmr', label: 'ASMR', terms: ['ASMR svenska youtube', 'ASMR svensk', 'ASMR triggers sverige'] },
    ],
  },
  {
    group: 'Streaming',
    icon: '📺',
    nischer: [
      { id: 'streaming', label: 'Svenska Streamers', terms: ['svensk streamer youtube', 'twitch highlights svenska', 'svenska streamers highlights'] },
      { id: 'just-chatting', label: 'Just Chatting / IRL', terms: ['just chatting svensk', 'IRL stream svenska', 'svenska twitch IRL'] },
    ],
  },
  {
    group: 'Musik & Kultur',
    icon: '🎵',
    nischer: [
      { id: 'musik', label: 'Musik / Artister', terms: ['svensk musik youtube', 'svenska artister youtube', 'ny svensk musik', 'swedish rap youtube'] },
      { id: 'musikproduktion', label: 'Musikproduktion', terms: ['musikproduktion youtube svenska', 'beatmaking svensk', 'producera musik youtube sverige'] },
      { id: 'instrument', label: 'Instrument / Tutorial', terms: ['gitarr tutorial svenska', 'piano youtube svensk', 'trummor youtube sverige', 'instrument tutorial'] },
      { id: 'dans', label: 'Dans', terms: ['dans youtube svenska', 'dance tutorial svensk', 'koreografi youtube sverige'] },
    ],
  },
  {
    group: 'Tech & Vetenskap',
    icon: '💻',
    nischer: [
      { id: 'tech', label: 'Tech & Recensioner', terms: ['svensk tech youtube', 'teknik recension svenska', 'unboxing svenska youtube'] },
      { id: 'programmering', label: 'Programmering / Kodning', terms: ['programmering youtube svenska', 'kodning tutorial svensk', 'webbutveckling youtube sverige'] },
      { id: 'ai', label: 'AI / Artificiell Intelligens', terms: ['AI youtube svenska', 'artificiell intelligens svensk', 'ChatGPT tips svenska youtube'] },
      { id: 'vetenskap', label: 'Vetenskap & Fakta', terms: ['vetenskap youtube svenska', 'fakta youtube svensk', 'populärvetenskap youtube sverige'] },
      { id: 'mobiler', label: 'Mobiler / Smartphones', terms: ['mobil recension svenska', 'smartphone test svensk', 'bästa mobil youtube sverige'] },
      { id: 'datorer', label: 'Datorer / PC-byggen', terms: ['dator youtube svenska', 'PC bygge svensk', 'gaming dator youtube sverige'] },
      { id: '3d-print', label: '3D-print / Maker', terms: ['3D print youtube svenska', '3D skrivare svensk', 'maker projekt youtube sverige'] },
    ],
  },
  {
    group: 'Livsstil & Hälsa',
    icon: '🧘',
    nischer: [
      { id: 'fitness', label: 'Fitness & Träning', terms: ['träning youtube svenska', 'gym vlogg svensk', 'fitness tips svenska youtube'] },
      { id: 'kost', label: 'Kost & Nutrition', terms: ['kost tips youtube svenska', 'nutrition youtube svensk', 'hälsosam mat youtube sverige'] },
      { id: 'mental-halsa', label: 'Mental Hälsa', terms: ['mental hälsa youtube svenska', 'psykologi youtube svensk', 'välmående tips youtube sverige'] },
      { id: 'yoga', label: 'Yoga / Meditation', terms: ['yoga youtube svenska', 'meditation svensk youtube', 'yoga hemma youtube sverige'] },
      { id: 'mode-skonhet', label: 'Mode & Skönhet', terms: ['mode youtube svenska', 'smink tutorial svensk youtube', 'beauty tips svenska'] },
      { id: 'hudvard', label: 'Hudvård / Skincare', terms: ['hudvård youtube svenska', 'skincare rutin svensk', 'hudvård tips youtube sverige'] },
      { id: 'har', label: 'Hår & Frisyrer', terms: ['frisyr youtube svenska', 'hår tutorial svensk', 'frisör youtube sverige'] },
    ],
  },
  {
    group: 'Mat & Dryck',
    icon: '🍳',
    nischer: [
      { id: 'mat', label: 'Matlagning', terms: ['matlagning youtube svenska', 'recept youtube svensk', 'laga mat youtube svenska'] },
      { id: 'bakning', label: 'Bakning', terms: ['bakning youtube svenska', 'baka youtube svensk', 'bakrecept youtube sverige'] },
      { id: 'grillning', label: 'Grillning / BBQ', terms: ['grillning youtube svenska', 'BBQ tips svensk', 'grilla youtube sverige'] },
      { id: 'ol-vin', label: 'Öl / Vin / Dryck', terms: ['öl recension youtube svenska', 'vin tips svensk youtube', 'dryck youtube sverige', 'craft beer svenska'] },
      { id: 'restaurang', label: 'Restauranger / Matrecensioner', terms: ['restaurang recension youtube svenska', 'matrecension svensk', 'food review youtube sverige'] },
    ],
  },
  {
    group: 'Friluftsliv & Natur',
    icon: '🏕️',
    nischer: [
      { id: 'friluftsliv', label: 'Friluftsliv / Camping', terms: ['friluftsliv youtube svenska', 'camping youtube svensk', 'vandring youtube sverige', 'bushcraft svensk'] },
      { id: 'fiske', label: 'Fiske', terms: ['fiske youtube svenska', 'sportfiske svensk', 'fiska youtube sverige', 'gäddfiske youtube'] },
      { id: 'jakt', label: 'Jakt', terms: ['jakt youtube svenska', 'jakt vlogg svensk', 'älgjakt youtube sverige', 'jägare youtube'] },
      { id: 'hund', label: 'Hundar / Husdjur', terms: ['hund youtube svenska', 'hundträning svensk youtube', 'husdjur youtube sverige', 'valp youtube'] },
      { id: 'hast', label: 'Hästar / Ridsport', terms: ['häst youtube svenska', 'ridsport youtube svensk', 'hästar youtube sverige', 'ridning vlogg'] },
      { id: 'tradgard', label: 'Trädgård / Odling', terms: ['trädgård youtube svenska', 'odling youtube svensk', 'trädgårdstips youtube sverige'] },
    ],
  },
  {
    group: 'Hem & Bygg',
    icon: '🏠',
    nischer: [
      { id: 'renovering', label: 'Renovering / Bygg', terms: ['renovering youtube svenska', 'bygga hus youtube svensk', 'hemrenovering youtube sverige'] },
      { id: 'inredning', label: 'Inredning / Design', terms: ['inredning youtube svenska', 'heminredning svensk youtube', 'interior design youtube sverige'] },
      { id: 'diy', label: 'DIY / Gör det själv', terms: ['DIY youtube svenska', 'gör det själv svensk youtube', 'hantverk youtube sverige'] },
      { id: 'smarthome', label: 'Smarta Hem', terms: ['smart hem youtube svenska', 'hemautomation svensk', 'smart home youtube sverige'] },
    ],
  },
  {
    group: 'Resor & Äventyr',
    icon: '✈️',
    nischer: [
      { id: 'resor', label: 'Resor / Travel', terms: ['resor youtube svenska', 'travel vlogg svensk', 'resa youtube sverige'] },
      { id: 'vanlife', label: 'Vanlife / Husbil', terms: ['vanlife youtube svenska', 'husbil youtube svensk', 'husvagn youtube sverige'] },
      { id: 'backpacking', label: 'Backpacking', terms: ['backpacking youtube svenska', 'backpacka svensk youtube', 'resa billigt youtube sverige'] },
    ],
  },
  {
    group: 'Familj & Barn',
    icon: '👨‍👩‍👧',
    nischer: [
      { id: 'familj', label: 'Familjevlogg', terms: ['familj vlogg youtube svenska', 'familjeliv youtube svensk', 'förälder youtube sverige'] },
      { id: 'graviditet', label: 'Graviditet / Bebis', terms: ['graviditet youtube svenska', 'bebis youtube svensk', 'mamma youtube sverige'] },
      { id: 'barn-content', label: 'Barninnehåll', terms: ['barn youtube svenska', 'kids content svensk youtube', 'barnkanal youtube sverige'] },
    ],
  },
  {
    group: 'Utbildning',
    icon: '📚',
    nischer: [
      { id: 'sprak', label: 'Språk / Lära sig svenska', terms: ['lära sig svenska youtube', 'learn swedish youtube', 'svenska lektioner youtube'] },
      { id: 'studietips', label: 'Studietips / Plugg', terms: ['studietips youtube svenska', 'plugga tips svensk youtube', 'student youtube sverige'] },
      { id: 'historia', label: 'Historia', terms: ['historia youtube svenska', 'svensk historia youtube', 'historisk dokumentär youtube'] },
    ],
  },
];

// Platt lookup: nisch-id → söktermer
const NISCH_TERMS_MAP = {};
for (const group of NISCH_GROUPS) {
  for (const nisch of group.nischer) {
    NISCH_TERMS_MAP[nisch.id] = nisch.terms;
  }
}

/**
 * Hämta söktermer baserat på valda nisch-ID:n.
 * @param {string} bransch - Komma-separerade nisch-ID:n, t.ex. "fpl,fantasy-fotboll"
 * @returns {string[]} Alla söktermer för valda nischer
 */
export async function getLockedSearchQueries(bransch) {
  const selected = (bransch || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const terms = [];
  for (const id of selected) {
    if (NISCH_TERMS_MAP[id]) {
      terms.push(...NISCH_TERMS_MAP[id]);
    }
  }

  // Fallback: om inga nischer matchade, använd allmän gaming
  if (terms.length === 0) {
    terms.push(...(NISCH_TERMS_MAP['allman-gaming'] || []));
  }

  return terms;
}

/**
 * Generera influencer-förslag via AI för plattformar utan API (TikTok, Instagram, Twitch)
 */
export async function generateInfluencerSuggestions(plattform, nischer, antal = 10) {
  const system = `Du är en expert på den svenska influencer-marknaden. Du föreslår verkliga, existerande influencers baserat på plattform och nisch. Svara ENBART med JSON — ingen annan text.`;

  const prompt = `Ge mig ${antal} svenska influencers på ${plattform} inom dessa nischer: ${nischer}.

Svara med en JSON-array med exakt detta format:
[
  {
    "namn": "Riktigt namn eller kanalnamn",
    "kanalnamn": "handtag utan @",
    "plattform": "${plattform}",
    "foljare": "uppskattad siffra, t.ex. 150000",
    "nisch": "gaming, esports, etc",
    "kontakt_epost": null,
    "kontakt_info": "Hur man kontaktar (DM, e-post i bio, etc)",
    "beskrivning": "Kort beskrivning av kanalen"
  }
]

VIKTIGT:
- Föreslå VERKLIGA influencers som existerar på ${plattform}
- Fokusera på svenska/nordiska creators
- Följarantal ska vara UNGEFÄRLIGT men realistiskt
- Variera storlek: blanda micro (5K-50K), mid (50K-500K) och macro (500K+)
- Om du inte hittar tillräckligt med svenska, fyll på med skandinaviska
- ENBART JSON, ingen annan text`;

  const raw = await callClaude(system, prompt);

  try {
    // Hitta JSON-array i svaret
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch (e) {
    console.error('[AI] Kunde inte parsa influencer-förslag:', e.message);
    return [];
  }
}

export async function generateOutreachMessage(influencer, foretag) {
  // Parsa company_profile för brief-data
  let brief = null;
  let profileData = null;
  try {
    if (foretag.company_profile) {
      profileData = typeof foretag.company_profile === 'string'
        ? JSON.parse(foretag.company_profile)
        : foretag.company_profile;
      brief = profileData.brief_answers || profileData.outreach_brief || null;
    }
  } catch (e) {
    console.warn('[AI] Kunde inte parsa company_profile:', e.message);
  }

  // Mappa CTA-val till läsbar text
  const CTA_LABELS = {
    skapa_video: 'Skapa en video',
    testa_plattform: 'Testa plattformen & dela upplevelsen',
    posta_story: 'Posta en story / reel',
    boka_mote: 'Boka ett möte / samtal',
    dela_lank: 'Dela en länk / referral-kod',
    annat: 'Annat',
  };

  const ctaText = brief?.cta?.length
    ? brief.cta.map(id => CTA_LABELS[id] || id).join(', ')
    : null;

  // Företagsfakta — AI:n formulerar professionellt utifrån dessa
  const beskrivning = foretag.beskrivning || profileData?.enrichment_data?.description || '';

  const system = `Du skriver outreach-meddelanden på svenska för betalda influencer-samarbeten. Meddelandet är ett affärsförslag — det ska vara tydligt, direkt och konkret. Skriv med du-tilltal.

Det MÅSTE framgå att:
1. Vi vill att influencern ska MARKNADSFÖRA/PROMOTA företaget
2. Det är ett BETALT samarbete med konkret ersättning
3. Exakt VAD influencern förväntas göra
4. Vad ersättningen är

REGEL OM FÖRETAGSBESKRIVNING:
Företagsnamnet är: "${foretag.namn}"
${beskrivning ? `Användarens beskrivning av företaget (OBS: detta är råtext från användaren, ofta slarvigt skrivet): "${beskrivning}"` : 'Ingen beskrivning angiven.'}

Din uppgift: Formulera EN professionell mening som presenterar företaget. Basera dig på informationen ovan men skriv om den till korrekt, professionell svenska. Kopiera INTE användarens text ordagrant — förbättra den.
Skriv ALDRIG ord som "lag", "team", "app", "plattform", "community" om företaget om det inte tydligt framgår av beskrivningen.
Om ingen beskrivning finns, skriv bara: "Vi på ${foretag.namn} söker influencers för ett betalt samarbete."`;


  // Bygg erbjudande-sektion baserat på brief
  let erbjudandeBlock = '';
  if (brief?.erbjudande) {
    erbjudandeBlock = `\nVad vi erbjuder influencern (MÅSTE nämnas tydligt i meddelandet):\n${brief.erbjudande}`;
  } else {
    erbjudandeBlock = `\nErsättning (MÅSTE nämnas tydligt): 300 SEK per video + 10 SEK per signup via referral-kod`;
  }

  let ctaBlock = '';
  if (ctaText) {
    ctaBlock = `\nVad vi vill att influencern SKA GÖRA (skriv ut detta tydligt):\n${ctaText}`;
  } else {
    ctaBlock = `\nVad influencern ska göra: Skapa content som promotar oss och uppmanar tittarna att registrera sig via referral-länk/kod`;
  }

  let extraBlock = '';
  if (brief?.extra) {
    extraBlock = `\nExtra kontext:\n${brief.extra}`;
  }

  const kontakt = foretag.kontaktperson || foretag.namn;
  const prompt = `Skriv ett outreach-meddelande till influencern ${influencer.namn} (kanal: ${influencer.kanalnamn} på ${influencer.plattform}, nisch: ${influencer.nisch}).

Avsändare: ${kontakt}, ${foretag.namn} (${foretag.epost || ''})
${erbjudandeBlock}
${ctaBlock}
${extraBlock}

KRAV — följ dessa EXAKT:
1. Börja med en kort personlig kommentar om influencerns kanal (max 1 mening)
2. Presentera företaget professionellt baserat på informationen i systempromten (formulera själv, kopiera INTE användarens text)
3. Förklara KONKRET vad vi vill att influencern gör (se CTA ovan)
4. Skriv ut ersättningen TYDLIGT med siffror
5. Avsluta med ett tydligt nästa steg
6. Signatur: Mvh, ${kontakt}, ${foretag.namn}, ${foretag.epost || ''}
7. Max 150 ord totalt

Returnera BARA meddelandet (ämne och brödtext), formaterat så här:
ÄMNE: [ämnesrad]
---
[brödtext]`;

  return await callClaude(system, prompt);
}

export async function generateFollowUp(influencer, originalMessage, stepNumber = 1) {
  const system = `Du skriver uppföljningsmeddelanden på svenska. Tonen ska vara vänlig men professionell.`;

  const stepInstructions = {
    1: `Detta är en MJUK PÅMINNELSE (steg 1 av 3), skickad ~3 dagar efter originalmeddelandet.
- Kort och lätt
- "Ville bara kolla om du hann se mitt meddelande"
- Max 4-5 meningar
- Inte påträngande alls`,
    2: `Detta är en DIREKT UPPFÖLJNING (steg 2 av 3), skickad ~7 dagar efter originalmeddelandet.
- Lyft fram ett specifikt värde/fördel med samarbetet
- Nämn en konkret siffra eller erbjudande
- Tydlig CTA med nästa steg
- Professionell men bestämd ton`,
    3: `Detta är ett SISTA FÖRSÖK (steg 3 av 3), skickad ~14 dagar efter originalmeddelandet.
- Kort: "Jag förstår om det inte passar just nu"
- Lämna dörren öppen för framtida kontakt
- Erbjud alternativ: "Kanske längre fram?"
- Avsluta positivt, utan press
- Max 3-4 meningar`,
  };

  const instruction = stepInstructions[stepNumber] || stepInstructions[1];

  const prompt = `Skriv ett uppföljningsmeddelande till ${influencer.namn} (${influencer.kanalnamn} på ${influencer.plattform}).

${instruction}

Originalmeddelandet (för kontext, citera det INTE ordagrant):
---
${originalMessage}
---

Returnera BARA meddelandet, inget ämne.`;

  return await callClaude(system, prompt);
}

export async function generateFollowUpSubject(influencerName, stepNumber = 1) {
  const subjects = {
    1: `Uppföljning: Samarbete med ${influencerName}?`,
    2: `Påminnelse — erbjudande till ${influencerName}`,
    3: `Sista meddelandet — ${influencerName}`,
  };
  return subjects[stepNumber] || subjects[1];
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

export async function findSponsorProspects(foretagNamn, bransch, beskrivning, googleMapsResults = []) {
  const system = `Du är en expert på svenska företag och sponsorpartnerskap.
Du ska alltid svara med giltig JSON, inget annat.`;

  const companyContext = beskrivning
    ? `"${foretagNamn}" — ${beskrivning}`
    : `"${foretagNamn}" (bransch: ${bransch || 'gaming/esports'})`;

  // Om vi har Google Maps-resultat, låt Claude ranka och berika dem
  let mapsContext = '';
  if (googleMapsResults.length > 0) {
    const mapsList = googleMapsResults.slice(0, 40).map((r, i) =>
      `${i + 1}. ${r.namn} | Typ: ${r.typ} | Betyg: ${r.betyg || '-'} (${r.recensioner} rec.) | Webb: ${r.hemsida || '-'} | Adress: ${r.adress} | Tel: ${r.telefon || '-'}`
    ).join('\n');

    mapsContext = `\n\nHär är RIKTIGA företag som hittats via Google Maps. Prioritera dessa framför påhittade förslag:
${mapsList}

Välj de 25 mest relevanta från listan ovan. Om du hittar färre än 25 relevanta, fyll på med egna förslag.
För varje företag från Google Maps, behåll deras riktiga kontaktuppgifter (hemsida, telefon).
Gissa e-post baserat på domännamnet (t.ex. info@foretag.se).`;
  }

  const prompt = `Hitta 25 svenska företag som passar som kampanjsponsorer för ${companyContext}.

Basera dina förslag på vad företaget FAKTISKT gör — hitta sponsorer vars målgrupp matchar.
${beskrivning ? `Företagets beskrivning: "${beskrivning}"` : ''}
${mapsContext}

Tänk på företag inom: sportrelaterade varumärken, energidrycker, sportappar, betting/odds, tech, lifestyle, kläder — men BARA om de är relevanta för företagets nisch.

Returnera en JSON-array med exakt detta format:
[
  {
    "namn": "Företagsnamn",
    "kontaktperson": "Namn om känt, annars null",
    "epost": "info@foretag.se eller null",
    "bransch": "Kort branschbeskrivning",
    "instagram_handle": "@handle eller null",
    "hemsida": "https://foretag.se",
    "telefon": "Telefonnummer eller null",
    "betyg": "Google-betyg eller null",
    "kalla": "google_maps eller ai"
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

export async function generateSponsorPitch(prospect, foretag, kanal, brief, sponsorQuestions) {
  const system = `Du skriver professionella sponsorpitcher på svenska.

KRITISKT VIKTIGT:
- Hitta ALDRIG PÅ siffror, statistik, fakta eller påståenden om avsändarens företag
- Använd BARA den information som ges i prompten
- Om ingen information finns om t.ex. antal användare — nämn det INTE
- Gissa ALDRIG vad företaget gör — använd bara beskrivningen som ges
- Skriv kort och professionellt — max 150 ord för e-post`;

  const isInstagramDM = kanal === 'instagram_dm';

  // Samla all känd info om avsändarens företag
  const foretagInfo = [];
  foretagInfo.push(`Företagsnamn: ${foretag.namn}`);
  if (foretag.beskrivning) foretagInfo.push(`Verksamhet: ${foretag.beskrivning}`);
  if (foretag.bransch) foretagInfo.push(`Bransch: ${foretag.bransch}`);
  if (foretag.kontaktperson) foretagInfo.push(`Kontaktperson: ${foretag.kontaktperson}`);
  if (foretag.hemsida) foretagInfo.push(`Hemsida: ${foretag.hemsida}`);

  // Brief-info om den finns
  const briefInfo = [];
  if (brief?.erbjudande) briefInfo.push(`Erbjudande: ${brief.erbjudande}`);
  if (brief?.cta?.length) briefInfo.push(`Önskad CTA: ${brief.cta.join(', ')}`);
  if (brief?.extra) briefInfo.push(`Extra info: ${brief.extra}`);

  // Sponsor-specifika frågor (från step 3)
  const sponsorInfo = [];
  if (sponsorQuestions?.samarbetstyper?.length) {
    sponsorInfo.push(`Typ av samarbete: ${sponsorQuestions.samarbetstyper.join(', ')}`);
  }
  if (sponsorQuestions?.vadNiErbjuder) {
    sponsorInfo.push(`Vad vi erbjuder: ${sponsorQuestions.vadNiErbjuder}`);
  }
  if (sponsorQuestions?.sponsorPris) {
    sponsorInfo.push(`Pris/ersättning: ${sponsorQuestions.sponsorPris}`);
  }

  const prompt = `Skriv ${isInstagramDM ? 'ett kort Instagram DM (max 300 tecken)' : 'ett professionellt e-postmeddelande (max 150 ord)'} till ${prospect.namn} (bransch: ${prospect.bransch}) för att föreslå ett samarbete/sponsring.

AVSÄNDARE (använd BARA denna info, hitta inget på):
${foretagInfo.join('\n')}

${briefInfo.length > 0 ? `BRIEF:\n${briefInfo.join('\n')}` : ''}

${sponsorInfo.length > 0 ? `SPONSORSAMARBETE DETALJER:\n${sponsorInfo.join('\n')}` : ''}

MOTTAGARE:
Företag: ${prospect.namn}
Bransch: ${prospect.bransch}
${prospect.hemsida ? `Hemsida: ${prospect.hemsida}` : ''}

REGLER:
- Använd BARA fakta som ges ovan — INGA påhittade siffror, statistik eller användarnatal
- Nämn ALDRIG specifika siffror (användare, sidvisningar, följare) om de inte ges explicit ovan
- Beskriv företaget EXAKT som i "Verksamhet"-fältet — gissa inte
- Kort, professionellt och på svenska
- Tydlig CTA${brief?.cta?.length ? ` (${brief.cta.join(', ')})` : ''}

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
