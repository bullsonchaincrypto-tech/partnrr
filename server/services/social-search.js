import { searchYouTubeChannels } from './youtube.js';
import fetch from 'node-fetch';

/**
 * Sök influencers över ALLA plattformar.
 * YouTube = verifierad API-data
 * Instagram/TikTok = extraherade från YouTube-beskrivningar + dedikerade sökningar
 */
export async function searchAllPlatforms(searchQueries, options = {}) {
  const { maxResults = 20 } = options;
  const allInfluencers = [];

  // --- YouTube (verifierad API-data) ---
  console.log('[Partnrr] Söker YouTube-kanaler...');
  const youtubeChannels = await searchYouTubeChannels(searchQueries, 50);
  console.log(`[Partnrr] ${youtubeChannels.length} YouTube-kanaler hittade`);

  // Extrahera cross-platform-länkar från YouTube-beskrivningar
  for (const ch of youtubeChannels) {
    allInfluencers.push(ch);

    // Sök efter Instagram/TikTok-länkar i kanalbeskrivningen
    const crossPlatform = extractCrossPlatformLinks(ch.beskrivning || '');

    if (crossPlatform.instagram) {
      allInfluencers.push({
        namn: ch.namn,
        kanalnamn: crossPlatform.instagram,
        plattform: 'Instagram',
        foljare: 'Se profil',
        foljare_exakt: 0,
        nisch: ch.nisch,
        beskrivning: `Hittad via YouTube-kanal: ${ch.kanalnamn}`,
        thumbnail: ch.thumbnail,
        kontakt_epost: ch.kontakt_epost,
        kontakt_info: `instagram.com/${crossPlatform.instagram}`,
        datakalla: 'youtube_crossref',
        verifierad: false,
        crossref_from: ch.kanalnamn,
      });
    }

    if (crossPlatform.tiktok) {
      allInfluencers.push({
        namn: ch.namn,
        kanalnamn: crossPlatform.tiktok,
        plattform: 'TikTok',
        foljare: 'Se profil',
        foljare_exakt: 0,
        nisch: ch.nisch,
        beskrivning: `Hittad via YouTube-kanal: ${ch.kanalnamn}`,
        thumbnail: ch.thumbnail,
        kontakt_epost: ch.kontakt_epost,
        kontakt_info: `tiktok.com/@${crossPlatform.tiktok}`,
        datakalla: 'youtube_crossref',
        verifierad: false,
        crossref_from: ch.kanalnamn,
      });
    }
  }

  // Deduplicera (samma person kan dyka upp flera gånger)
  const unique = deduplicateInfluencers(allInfluencers);

  // Sortera: verifierade först, sedan efter följarantal
  unique.sort((a, b) => {
    if (a.verifierad && !b.verifierad) return -1;
    if (!a.verifierad && b.verifierad) return 1;
    return (b.foljare_exakt || 0) - (a.foljare_exakt || 0);
  });

  return unique.slice(0, maxResults);
}

/**
 * Extrahera Instagram och TikTok-handles från en YouTube-kanalbeskrivning.
 * Många kreatörer listar sina sociala medier i "Om"-sektionen.
 */
function extractCrossPlatformLinks(text) {
  const result = { instagram: null, tiktok: null };

  // Instagram: instagram.com/handle eller @handle nämnt med instagram
  const igPatterns = [
    /instagram\.com\/([a-zA-Z0-9_.]+)/i,
    /(?:instagram|insta|ig)\s*[:@]\s*@?([a-zA-Z0-9_.]+)/i,
  ];
  for (const pattern of igPatterns) {
    const match = text.match(pattern);
    if (match && match[1] && !match[1].includes('.com')) {
      result.instagram = match[1].replace(/^@/, '');
      break;
    }
  }

  // TikTok: tiktok.com/@handle eller @handle nämnt med tiktok
  const ttPatterns = [
    /tiktok\.com\/@?([a-zA-Z0-9_.]+)/i,
    /(?:tiktok|tik\s*tok)\s*[:@]\s*@?([a-zA-Z0-9_.]+)/i,
  ];
  for (const pattern of ttPatterns) {
    const match = text.match(pattern);
    if (match && match[1] && !match[1].includes('.com')) {
      result.tiktok = match[1].replace(/^@/, '');
      break;
    }
  }

  return result;
}

/**
 * Ta bort dubbletter — om samma person finns på flera plattformar,
 * behåll alla plattformar men ta bort exakta dubbletter.
 */
function deduplicateInfluencers(influencers) {
  const seen = new Set();
  return influencers.filter(inf => {
    const key = `${inf.kanalnamn?.toLowerCase()}_${inf.plattform}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
