import { google } from 'googleapis';
import { trackApiCost } from './cost-tracker.js';

const youtube = google.youtube('v3');

/**
 * Sök YouTube-kanaler med riktiga API-data.
 * Returnerar verifierade kanaldata — inga gissningar.
 */
export async function searchYouTubeChannels(searchQueries, maxResultsPerQuery = 50) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY saknas i .env — aktivera YouTube Data API v3 i Google Cloud Console och skapa en API-nyckel.');

  const allChannelIds = new Set();
  let totalHits = 0;

  // Steg 1: Sök kanaler med varje sökterm
  for (const query of searchQueries) {
    try {
      const searchRes = await youtube.search.list({
        key: apiKey,
        q: query,
        type: 'channel',
        // Ingen regionCode — det filtrerar bort svenska kanaler som inte explicit satt land=SE.
        // relevanceLanguage räcker för att prioritera svenskt innehåll.
        relevanceLanguage: 'sv',
        maxResults: maxResultsPerQuery,
        part: 'snippet',
      });

      trackApiCost({ service: 'youtube', endpoint: 'search.list' });

      const items = searchRes.data.items || [];
      const beforeSize = allChannelIds.size;
      for (const item of items) {
        if (item.id?.channelId) {
          allChannelIds.add(item.id.channelId);
        }
      }
      const newUnique = allChannelIds.size - beforeSize;
      totalHits += items.length;
      console.log(`[YouTube] "${query}" → ${items.length} träffar, ${newUnique} nya unika (totalt: ${allChannelIds.size})`);
    } catch (err) {
      console.error(`YouTube search error for "${query}":`, err.message);
      // Om kvoten är slut (403) — avbryt hela loopen, fortsätta är meningslöst
      if (err.code === 403 || err.status === 403 || err.message?.includes('quota')) {
        console.error(`[YouTube] ⚠️ Kvot-fel — avbryter resterande ${searchQueries.length - searchQueries.indexOf(query) - 1} sökningar`);
        break;
      }
    }
  }

  console.log(`[YouTube] Totalt: ${totalHits} träffar → ${allChannelIds.size} unika kanaler (${searchQueries.length} söktermer)`);

  if (allChannelIds.size === 0) {
    return [];
  }

  // Steg 2: Hämta detaljerad kanaldata (prenumeranter, beskrivning, etc.)
  const channelIds = [...allChannelIds];
  const channels = [];

  // YouTube API tillåter max 50 kanaler per anrop
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    try {
      const channelRes = await youtube.channels.list({
        key: apiKey,
        id: batch.join(','),
        part: 'snippet,statistics,brandingSettings',
      });

      trackApiCost({ service: 'youtube', endpoint: 'channels.list' });

      for (const ch of (channelRes.data.items || [])) {
        const stats = ch.statistics || {};
        const snippet = ch.snippet || {};
        const branding = ch.brandingSettings?.channel || {};

        // Filtrera bort kanaler som explicit har ett ANNAT land än SE.
        // Kanaler utan land (vanligt bland svenska kanaler) släpps igenom.
        const country = (snippet.country || '').toUpperCase();
        const allowedCountries = new Set(['', 'SE']);
        if (!allowedCountries.has(country)) {
          console.log(`[SparkCollab] Filtrerar bort "${snippet.title}" (land: ${country})`);
          continue;
        }

        channels.push({
          channelId: ch.id,
          namn: snippet.title || 'Okänd',
          kanalnamn: snippet.customUrl?.replace(/^@/, '') || snippet.title?.toLowerCase().replace(/\s+/g, '') || ch.id,
          plattform: 'YouTube',
          foljare: formatSubscribers(stats.subscriberCount),
          foljare_exakt: parseInt(stats.subscriberCount) || 0,
          nisch: kategoriseraKanal(snippet.description, branding.keywords),
          beskrivning: (snippet.description || '').slice(0, 1000),
          thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url,
          kontakt_epost: extractEmail(snippet.description || ''),
          kontakt_info: `youtube.com/${snippet.customUrl || 'channel/' + ch.id}`,
          videoCount: parseInt(stats.videoCount) || 0,
          viewCount: parseInt(stats.viewCount) || 0,
          land: snippet.country || 'Okänt',
          datakalla: 'youtube_api',
          verifierad: true,
        });
      }
    } catch (err) {
      console.error('YouTube channels.list error:', err.message);
    }
  }

  const filteredCount = channelIds.length - channels.length;
  console.log(`[YouTube] Country-filter: ${channelIds.length} → ${channels.length} kanaler (${filteredCount} borttagna pga land ≠ SE)`);

  // Returnera utan sortering — routen hanterar sortering (nisch > följare)
  return channels;
}

/**
 * Hämta detaljerad data för en specifik kanal via channel ID.
 */
export async function getChannelDetails(channelId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY saknas i .env');

  const res = await youtube.channels.list({
    key: apiKey,
    id: channelId,
    part: 'snippet,statistics,brandingSettings,contentDetails',
  });

  if (!res.data.items?.length) return null;

  const ch = res.data.items[0];
  const stats = ch.statistics || {};
  const snippet = ch.snippet || {};

  return {
    channelId: ch.id,
    namn: snippet.title,
    kanalnamn: snippet.customUrl?.replace(/^@/, '') || snippet.title,
    prenumeranter: parseInt(stats.subscriberCount) || 0,
    visningar: parseInt(stats.viewCount) || 0,
    videos: parseInt(stats.videoCount) || 0,
    beskrivning: snippet.description,
    land: snippet.country,
    thumbnail: snippet.thumbnails?.medium?.url,
  };
}

// --- Hjälpfunktioner ---

function formatSubscribers(count) {
  const n = parseInt(count);
  if (isNaN(n)) return 'Okänt';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n.toString();
}

function kategoriseraKanal(description, keywords) {
  const text = ((description || '') + ' ' + (keywords || '')).toLowerCase();

  const categories = [];

  // Använd regex med ordgränser för att undvika falska matchningar
  // t.ex. "mat" ska inte matcha "information", "automatiskt", "match"
  const mappings = [
    // === SPECIFIKA SPEL (kolla FÖRST) ===
    { patterns: [/\bchess\b/, /\bschack\b/, /\bchesscom\b/, /chess\.com/], label: 'Schack' },
    { patterns: [/\bminecraft\b/], label: 'Minecraft' },
    { patterns: [/\bfortnite\b/], label: 'Fortnite' },
    { patterns: [/\bcs2\b/, /\bcs:go\b/, /\bcsgo\b/, /\bcounter-strike\b/, /\bcounterstrike\b/], label: 'CS2' },
    { patterns: [/\bvalorant\b/], label: 'Valorant' },
    { patterns: [/\bfifa\b/, /\bfc 24\b/, /\bfc24\b/, /\bfc 25\b/, /\bfc25\b/, /\bea fc\b/, /\bultimate team\b/], label: 'FIFA/EA FC' },
    { patterns: [/\broblox\b/], label: 'Roblox' },
    { patterns: [/\bcall of duty\b/, /\bwarzone\b/], label: 'Call of Duty' },
    { patterns: [/\bapex legends\b/, /\bapex\b/], label: 'Apex Legends' },
    { patterns: [/\bleague of legends\b/, /\blol\b/], label: 'League of Legends' },
    { patterns: [/\bgta\b/, /\bgrand theft auto\b/, /\broleplay\b/], label: 'GTA' },
    { patterns: [/\bpokemon\b/, /\bpokémon\b/], label: 'Pokémon' },
    // === FANTASY & BETTING ===
    { patterns: [/\bfpl\b/, /\bfantasy premier league\b/], label: 'FPL' },
    { patterns: [/\bfantasy fotboll\b/, /\bfantasy allsvenskan\b/], label: 'Fantasy Fotboll' },
    { patterns: [/\bfantasy hockey\b/, /\bfantasy nhl\b/, /\bfantasy shl\b/], label: 'Fantasy Hockey' },
    { patterns: [/\bbetting\b/, /\bodds\b/, /\bsportsbetting\b/], label: 'Betting' },
    { patterns: [/\bpoker\b/], label: 'Poker' },
    // === SPORT ===
    { patterns: [/\bfotboll\b/, /\ballsvenskan\b/, /\bpremier league\b/], label: 'Fotboll' },
    { patterns: [/\bhockey\b/, /\bshl\b/, /\bnhl\b/, /\bishockey\b/], label: 'Hockey' },
    { patterns: [/\bbasket\b/, /\bnba\b/], label: 'Basket' },
    { patterns: [/\bmma\b/, /\bufc\b/, /\bkampsport\b/, /\bboxning\b/], label: 'Kampsport' },
    { patterns: [/\bgolf\b/], label: 'Golf' },
    { patterns: [/\btennis\b/], label: 'Tennis' },
    { patterns: [/\blöpning\b/, /\bmaraton\b/, /\bmarathon\b/], label: 'Löpning' },
    { patterns: [/\bskidor\b/, /\bslalom\b/, /\blängdskidor\b/, /\bvintersport\b/], label: 'Vintersport' },
    // === FORDON & MOTOR ===
    { patterns: [/\bbil\b/, /\bbilar\b/, /\bbilrecension\b/, /\bsportbil\b/], label: 'Bilar' },
    { patterns: [/\bmotorcykel\b/, /\bmc\b/], label: 'Motorcykel' },
    { patterns: [/\bskoter\b/, /\bsnöskoter\b/], label: 'Skoter' },
    { patterns: [/\belbil\b/, /\btesla\b/], label: 'Elbil' },
    { patterns: [/\bepa\b/, /\ba-traktor\b/, /\bmoppe\b/], label: 'EPA/A-traktor' },
    { patterns: [/\bbåt\b/, /\bsegel\b/, /\bmarin\b/], label: 'Båt' },
    { patterns: [/\blastbil\b/, /\btruck\b/, /\blångtradare\b/], label: 'Lastbil' },
    // === EKONOMI & FINANS ===
    { patterns: [/\baktier\b/, /\binvester\b/, /\bbörsen\b/], label: 'Aktier' },
    { patterns: [/\btrading\b/, /\bdaytrading\b/, /\bforex\b/], label: 'Trading' },
    { patterns: [/\bkrypto\b/, /\bbitcoin\b/, /\bcrypto\b/, /\bethereum\b/], label: 'Krypto' },
    { patterns: [/\bprivatekonomi\b/, /\bspara pengar\b/], label: 'Privatekonomi' },
    { patterns: [/\bfastighet\b/, /\bbostads\b/], label: 'Fastigheter' },
    { patterns: [/\bentreprenör\b/, /\bföretag\b/, /\bstartup\b/], label: 'Entreprenörskap' },
    // === BREDA GAMING ===
    { patterns: [/\bgaming\b/, /\bgamer\b/, /\bspel\b/, /\bgameplay\b/], label: 'Gaming' },
    { patterns: [/\besport\b/, /\be-sport\b/, /\bturnering\b/], label: 'Esport' },
    // === UNDERHÅLLNING ===
    { patterns: [/\bvlogg\b/, /\bvlog\b/, /\bvardag\b/, /\blivsstil\b/], label: 'Vlogg/Livsstil' },
    { patterns: [/\bunderhållning\b/, /\bhumor\b/, /\bkomedi\b/], label: 'Underhållning' },
    { patterns: [/\breagerar\b/, /\breaktion\b/], label: 'Reaktioner' },
    { patterns: [/\bpodcast\b/, /\bsamtal\b/], label: 'Podcast' },
    { patterns: [/\bmysterier\b/, /\btrue crime\b/, /\bparanormalt\b/], label: 'Mysterier' },
    { patterns: [/\basin\b/, /\basmr\b/i], label: 'ASMR' },
    { patterns: [/\bstream\b/, /\btwitch\b/], label: 'Streaming' },
    // === MUSIK ===
    { patterns: [/\bmusik\b/, /\bmusic\b/, /\bartist\b/, /\brapper\b/, /\bsångare\b/], label: 'Musik' },
    { patterns: [/\bproducer\b/, /\bbeatmaking\b/, /\bmusikproduktion\b/], label: 'Musikproduktion' },
    { patterns: [/\bgitarr\b/, /\bpiano\b/, /\btrummor\b/], label: 'Instrument' },
    { patterns: [/\bdans\b/, /\bdance\b/, /\bkoreografi\b/], label: 'Dans' },
    // === TECH ===
    { patterns: [/\btech\b/, /\bteknik\b/, /\bunboxing\b/], label: 'Tech' },
    { patterns: [/\bprogrammer\b/, /\bkodning\b/, /\bwebbutveck\b/], label: 'Programmering' },
    { patterns: [/\bai\b/, /\bartificiell intelligens\b/, /\bchatgpt\b/], label: 'AI' },
    { patterns: [/\b3d.?print\b/, /\bmaker\b/], label: '3D-print' },
    // === LIVSSTIL & HÄLSA ===
    { patterns: [/\bträning\b/, /\bfitness\b/, /\bgym\b/], label: 'Fitness' },
    { patterns: [/\byoga\b/, /\bmeditation\b/], label: 'Yoga' },
    { patterns: [/\bmode\b/, /\bfashion\b/, /\bkläder\b/], label: 'Mode' },
    { patterns: [/\bbeauty\b/, /\bsmink\b/, /\bmakeup\b/, /\bskönhet\b/], label: 'Skönhet' },
    { patterns: [/\bhudvård\b/, /\bskincare\b/], label: 'Hudvård' },
    // === MAT ===
    { patterns: [/\bmatlagning\b/, /\brecept\b/, /\blaga mat\b/, /\bkock\b/], label: 'Matlagning' },
    { patterns: [/\bbakning\b/, /\bbaka\b/], label: 'Bakning' },
    { patterns: [/\bgrill\b/, /\bbbq\b/], label: 'Grillning' },
    // === FRILUFTSLIV ===
    { patterns: [/\bfriluftsliv\b/, /\bcamping\b/, /\bvandring\b/, /\bbushcraft\b/], label: 'Friluftsliv' },
    { patterns: [/\bfiske\b/, /\bsportfiske\b/], label: 'Fiske' },
    { patterns: [/\bjakt\b/, /\bjägare\b/], label: 'Jakt' },
    { patterns: [/\bhund\b/, /\bhusdjur\b/, /\bvalp\b/, /\bkatt\b/], label: 'Husdjur' },
    { patterns: [/\bhäst\b/, /\bridsport\b/, /\bridning\b/], label: 'Hästar' },
    { patterns: [/\bträdgård\b/, /\bodling\b/], label: 'Trädgård' },
    // === HEM & BYGG ===
    { patterns: [/\brenovering\b/, /\bbygga\b/, /\bsnickare\b/], label: 'Renovering' },
    { patterns: [/\binredning\b/, /\binterior\b/], label: 'Inredning' },
    { patterns: [/\bdiy\b/, /\bgör det själv\b/, /\bhantverk\b/], label: 'DIY' },
    // === RESOR ===
    { patterns: [/\bresa\b/, /\bresor\b/, /\btravel\b/], label: 'Resor' },
    { patterns: [/\bvanlife\b/, /\bhusbil\b/, /\bhusvagn\b/], label: 'Vanlife' },
    // === FAMILJ ===
    { patterns: [/\bfamilj\b/, /\bförälder\b/, /\bmamma\b/, /\bpappa\b/], label: 'Familj' },
    { patterns: [/\bgraviditet\b/, /\bbebis\b/], label: 'Graviditet' },
  ];

  for (const mapping of mappings) {
    if (mapping.patterns.some(rx => rx.test(text))) {
      categories.push(mapping.label);
    }
  }

  if (categories.length === 0) {
    categories.push('Övrigt');
  }

  return categories.slice(0, 3).join(', ');
}

function extractEmail(text) {
  const emailRegex = /[\w.+-]+@[\w-]+\.[\w.]+/g;
  const matches = text.match(emailRegex);
  if (!matches) return null;
  // Filtrera bort vanliga icke-kontakt-adresser
  const filtered = matches.filter(e =>
    !e.includes('example.com') &&
    !e.includes('noreply') &&
    !e.includes('no-reply')
  );
  return filtered[0] || null;
}
