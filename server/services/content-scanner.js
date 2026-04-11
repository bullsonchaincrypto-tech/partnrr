import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import { queryAll, queryOne, runSql } from '../db/schema.js';

const youtube = google.youtube('v3');

/**
 * Content Scanner — skannar YouTube-kanaler för influencers med aktiva avtal.
 * Detekterar nya videos, analyserar CTA-kvalitet med AI.
 */

// ============================================================
// STEG 1: Hitta influencers med aktiva avtal som behöver scanning
// ============================================================

export async function getInfluencersToScan() {
  // Hämta alla influencers med status 'avtal_signerat'
  const influencers = await queryAll(`
    SELECT DISTINCT i.id, i.namn, i.kanalnamn, i.kontakt_info, i.referral_kod,
           om.foretag_id, om.id as outreach_id, om.status as outreach_status,
           f.namn as foretag_namn,
           k.id as kontrakt_id
    FROM influencers i
    JOIN outreach_meddelanden om ON i.id = om.influencer_id
    JOIN foretag f ON om.foretag_id = f.id
    LEFT JOIN kontrakt k ON i.id = k.influencer_id AND k.foretag_id = om.foretag_id
    WHERE om.status = 'avtal_signerat'
  `);

  // Filtrera bort de som skannades nyligen (senaste 6 timmarna)
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const result = [];
  for (const inf of influencers) {
    const scanLog = await queryOne(
      'SELECT last_scanned_at FROM content_scan_log WHERE influencer_id = ?',
      [inf.id]
    );
    if (!scanLog || scanLog.last_scanned_at < sixHoursAgo) {
      result.push(inf);
    }
  }
  return result;
}


// ============================================================
// STEG 2: Sök efter nya videos på en YouTube-kanal
// ============================================================

export async function scanChannelForVideos(influencer) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY saknas');

  // Extrahera channel handle/ID från kontakt_info
  const channelHandle = extractChannelHandle(influencer.kontakt_info || influencer.kanalnamn);

  if (!channelHandle) {
    console.log(`[Content] Kan inte hitta kanal-handle för ${influencer.namn}`);
    return [];
  }

  try {
    // Först: hämta channel ID om vi har handle
    let channelId = null;

    // Kolla om vi redan har channel ID i scan_log
    const existingLog = await queryOne(
      'SELECT channel_id FROM content_scan_log WHERE influencer_id = ?',
      [influencer.id]
    );

    if (existingLog?.channel_id) {
      channelId = existingLog.channel_id;
    } else {
      // Sök kanal via handle/namn
      const searchRes = await youtube.search.list({
        key: apiKey,
        q: channelHandle,
        type: 'channel',
        maxResults: 1,
        part: 'snippet',
      });

      channelId = searchRes.data.items?.[0]?.id?.channelId;
      if (!channelId) {
        console.log(`[Content] Ingen kanal hittad för "${channelHandle}"`);
        return [];
      }
    }

    // Hämta senaste videos från kanalen (senaste 30 dagarna)
    const publishedAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const videosRes = await youtube.search.list({
      key: apiKey,
      channelId: channelId,
      type: 'video',
      order: 'date',
      publishedAfter: publishedAfter,
      maxResults: 10,
      part: 'snippet',
    });

    const videoIds = (videosRes.data.items || [])
      .map(v => v.id?.videoId)
      .filter(Boolean);

    if (videoIds.length === 0) {
      // Uppdatera scan log
      upsertScanLog(influencer.id, channelId, 0);
      return [];
    }

    // Hämta detaljerad videodata (statistik + beskrivning)
    const detailsRes = await youtube.videos.list({
      key: apiKey,
      id: videoIds.join(','),
      part: 'snippet,statistics',
    });

    const videos = (detailsRes.data.items || []).map(v => ({
      youtube_video_id: v.id,
      video_title: v.snippet?.title || '',
      video_url: `https://youtube.com/watch?v=${v.id}`,
      video_description: v.snippet?.description || '',
      published_at: v.snippet?.publishedAt || '',
      view_count: parseInt(v.statistics?.viewCount) || 0,
      like_count: parseInt(v.statistics?.likeCount) || 0,
      comment_count: parseInt(v.statistics?.commentCount) || 0,
    }));

    // Uppdatera scan log
    upsertScanLog(influencer.id, channelId, videos.length);

    return videos;
  } catch (err) {
    console.error(`[Content] YouTube API error for ${influencer.namn}:`, err.message);
    return [];
  }
}


// ============================================================
// STEG 3: Registrera nya videos i databasen
// ============================================================

export async function registerVideo(influencer, video) {
  // Kolla om videon redan finns
  const existing = await queryOne(
    'SELECT id FROM content_tracking WHERE youtube_video_id = ?',
    [video.youtube_video_id]
  );

  if (existing) {
    // Uppdatera statistik
    await runSql(
      `UPDATE content_tracking SET
        view_count = ?, like_count = ?, comment_count = ?,
        last_checked_at = datetime('now')
      WHERE id = ?`,
      [video.view_count, video.like_count, video.comment_count, existing.id]
    );
    return { id: existing.id, isNew: false };
  }

  // Grundläggande keyword-check innan AI-analys
  const quickCheck = quickContentCheck(video, influencer);

  const { lastId } = await runSql(
    `INSERT INTO content_tracking (
      influencer_id, foretag_id, kontrakt_id,
      youtube_video_id, video_title, video_url, video_description,
      published_at, view_count, like_count, comment_count,
      has_company_mention, has_cta, has_referral_link, referral_kod_found,
      cta_quality, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      influencer.id, influencer.foretag_id || null, influencer.kontrakt_id || null,
      video.youtube_video_id, video.video_title, video.video_url,
      video.video_description, video.published_at,
      video.view_count, video.like_count, video.comment_count,
      quickCheck.has_company_mention ? 1 : 0,
      quickCheck.has_cta ? 1 : 0,
      quickCheck.has_referral_link ? 1 : 0,
      quickCheck.referral_kod_found || null,
      quickCheck.cta_quality,
      'detected'
    ]
  );

  return { id: lastId, isNew: true, quickCheck };
}


// ============================================================
// STEG 4: AI-analys av video (CTA, referral, omnämning)
// ============================================================

export async function analyzeVideoWithAI(contentId) {
  const content = await queryOne('SELECT * FROM content_tracking WHERE id = ?', [contentId]);
  if (!content) return null;

  const influencer = await queryOne('SELECT * FROM influencers WHERE id = ?', [content.influencer_id]);
  const foretag = content.foretag_id
    ? await queryOne('SELECT * FROM foretag WHERE id = ?', [content.foretag_id])
    : null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('[Content] ANTHROPIC_API_KEY saknas — hoppar över AI-analys');
    return null;
  }

  const client = new Anthropic({ apiKey });

  const prompt = `Analysera denna YouTube-video från influencern "${influencer?.namn || 'okänd'}" som har ett avtal med "${foretag?.namn || 'RankLeague'}".

VIDEO-TITEL: ${content.video_title}

VIDEO-BESKRIVNING:
${(content.video_description || '').slice(0, 2000)}

INFLUENCERNS REFERRAL-KOD: ${influencer?.referral_kod || 'okänd'}
FÖRETAGSNAMN: ${foretag?.namn || 'RankLeague'}

Analysera och svara i EXAKT detta JSON-format (inga andra tecken):
{
  "has_company_mention": true/false,
  "company_mention_details": "var/hur företaget nämns",
  "has_cta": true/false,
  "cta_details": "beskrivning av call-to-action om det finns",
  "has_referral_link": true/false,
  "referral_details": "vilken referral-kod/länk som hittades",
  "cta_quality": "stark/medium/svag/ingen",
  "overall_assessment": "kort sammanfattning av videons kvalitet som marknadsföring",
  "improvement_suggestions": "förslag på förbättringar om CTA är svag"
}

CTA-kvalitet:
- "stark": Tydlig CTA + referral-länk/kod i beskrivning + uppmanar tittare att registrera sig
- "medium": Nämner företaget + har länk ELLER kod, men inte tydlig CTA
- "svag": Bara kort omnämning utan tydlig CTA eller referral
- "ingen": Ingen koppling till företaget/RankLeague alls`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.text || '';

    // Försök parsa JSON
    let analysis;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      analysis = { raw_response: text, parse_error: true };
    }

    if (analysis && !analysis.parse_error) {
      await runSql(
        `UPDATE content_tracking SET
          has_company_mention = ?,
          has_cta = ?,
          has_referral_link = ?,
          cta_quality = ?,
          ai_analysis = ?,
          ai_analyzed_at = datetime('now'),
          status = 'analyzed'
        WHERE id = ?`,
        [
          analysis.has_company_mention ? 1 : 0,
          analysis.has_cta ? 1 : 0,
          analysis.has_referral_link ? 1 : 0,
          analysis.cta_quality || 'ingen',
          JSON.stringify(analysis),
          contentId
        ]
      );
    }

    return analysis;
  } catch (err) {
    console.error('[Content] AI analysis error:', err.message);
    return null;
  }
}


// ============================================================
// STEG 5: Komplett scan-flöde (anropas av OpenClaw)
// ============================================================

export async function runFullContentScan() {
  const results = {
    influencers_scanned: 0,
    new_videos_found: 0,
    videos_analyzed: 0,
    cta_results: { stark: 0, medium: 0, svag: 0, ingen: 0 },
    errors: [],
    details: [],
  };

  const influencers = getInfluencersToScan();

  if (influencers.length === 0) {
    return { ...results, message: 'Inga influencers med aktiva avtal att skanna' };
  }

  for (const inf of influencers) {
    results.influencers_scanned++;

    try {
      const videos = await scanChannelForVideos(inf);

      for (const video of videos) {
        const reg = registerVideo(inf, video);

        if (reg.isNew) {
          results.new_videos_found++;

          // AI-analys av nya videos
          const analysis = await analyzeVideoWithAI(reg.id);
          if (analysis && !analysis.parse_error) {
            results.videos_analyzed++;
            const quality = analysis.cta_quality || 'ingen';
            if (results.cta_results[quality] !== undefined) {
              results.cta_results[quality]++;
            }
          }

          results.details.push({
            influencer: inf.namn,
            video: video.video_title,
            cta_quality: analysis?.cta_quality || 'ej_analyserad',
            has_referral: analysis?.has_referral_link || false,
          });
        }
      }
    } catch (err) {
      results.errors.push(`${inf.namn}: ${err.message}`);
    }
  }

  return results;
}


// ============================================================
// HJÄLPFUNKTIONER
// ============================================================

function extractChannelHandle(kontaktInfo) {
  if (!kontaktInfo) return null;

  // youtube.com/@handle
  const handleMatch = kontaktInfo.match(/youtube\.com\/@?([\w-]+)/);
  if (handleMatch) return handleMatch[1];

  // youtube.com/channel/UCxxxx
  const channelMatch = kontaktInfo.match(/youtube\.com\/channel\/([\w-]+)/);
  if (channelMatch) return channelMatch[1];

  // youtube.com/c/name
  const cMatch = kontaktInfo.match(/youtube\.com\/c\/([\w-]+)/);
  if (cMatch) return cMatch[1];

  // Bara ett namn/handle
  return kontaktInfo.replace(/^@/, '').trim();
}

function quickContentCheck(video, influencer) {
  const title = (video.video_title || '').toLowerCase();
  const desc = (video.video_description || '').toLowerCase();
  const text = title + ' ' + desc;

  const companyTerms = ['rankleague', 'rank league', 'rank-league'];
  const ctaTerms = ['registrera', 'signup', 'sign up', 'anmäl', 'kod', 'code', 'länk i beskrivningen', 'link in description', 'bio'];
  const referralKod = (influencer.referral_kod || '').toLowerCase();

  const has_company_mention = companyTerms.some(t => text.includes(t));
  const has_cta = ctaTerms.some(t => text.includes(t));
  const has_referral_link = referralKod ? text.includes(referralKod) : false;
  const referral_kod_found = has_referral_link ? influencer.referral_kod : null;

  let cta_quality = 'ingen';
  if (has_company_mention && has_cta && has_referral_link) cta_quality = 'stark';
  else if (has_company_mention && (has_cta || has_referral_link)) cta_quality = 'medium';
  else if (has_company_mention) cta_quality = 'svag';

  return { has_company_mention, has_cta, has_referral_link, referral_kod_found, cta_quality };
}

async function upsertScanLog(influencerId, channelId, videosFound) {
  const existing = await queryOne(
    'SELECT id FROM content_scan_log WHERE influencer_id = ?',
    [influencerId]
  );

  if (existing) {
    await runSql(
      `UPDATE content_scan_log SET channel_id = ?, last_scanned_at = datetime('now'), videos_found = ?, next_scan_after = datetime('now', '+6 hours') WHERE id = ?`,
      [channelId, videosFound, existing.id]
    );
  } else {
    await runSql(
      `INSERT INTO content_scan_log (influencer_id, channel_id, videos_found, next_scan_after) VALUES (?, ?, ?, datetime('now', '+6 hours'))`,
      [influencerId, channelId, videosFound]
    );
  }
}
