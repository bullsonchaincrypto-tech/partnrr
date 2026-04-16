// ============================================================
// V9 Pipeline — Fas 5: Haiku Binary Classifier
// ============================================================
// AI-judgment för kandidater som Fas 4 inte kunde avgöra deterministiskt.
// Klassificerar som creator/brand/uncertain. Creators + högförtroende-uncertain
// passerar till enrichment; medelförtroende uncertain → reserve pool för Fas 8.
//
// Batching: 50 profiler per anrop, parallella batches.
// Kostnad: ~$0.022 per 300 kandidater.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const BATCH_SIZE = 50;

const SYSTEM_PROMPT = `Du klassificerar Instagram/TikTok/YouTube-profiler.

För varje profil, ange exakt EN klass:
- "creator" = specifik person, persons-duo, eller familj som skapar content
  för en publik
- "brand" = ett företag, organisation, butik, återförsäljare eller officiellt
  konto
- "uncertain" = otillräcklig data för säker klassificering

Signaler för "creator":
- Personens/familjens namn i handle eller profilnamn
- Bio skriven i jag-form med personlig ton
- Content handlar om att personen själv testar/använder/visar något
- Nano-influencer (< 5K följare) med business-konto är fortfarande creator
  (business-konto används ofta för att få samarbetskontakt)

Signaler för "brand":
- Företagsnamn/produktnamn i handle eller profilnamn
- "Official", "Officiell", "Store", "Shop", "AB" i profil
- Bio i vi-form utan personlig kontext
- Bio marknadsför produkter/tjänster till kund
- External URL är e-handelssajt

Om du är säker men data är tunn, ge lägre confidence (0.5-0.7).
Om du inte kan avgöra alls, använd "uncertain" med confidence 0.3-0.5.

Returnera STRIKT JSON-array (inga extra tecken):
[{"index": N, "class": "creator"|"brand"|"uncertain", "confidence": 0.0-1.0}]`;

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function renderUserPrompt(batch) {
  const lines = ['Profiler att klassificera:', ''];
  batch.forEach((p, i) => {
    lines.push(
      `[${i}] ${p.platform}: @${p.handle} (${p.name || ''})`,
      `  Bio: ${truncate(p.bio, 200)}`,
      `  Followers: ${p.followers ?? '?'}, Following: ${p.raw?.following_count ?? p.raw?.user?.following_count ?? '?'}`,
      `  External URL: ${p.external_url || 'none'}`,
      `  Business account: ${p.is_business_account ?? '?'}`,
      `  Business category: ${p.business_category || 'none'}`,
      `  Sample caption: ${truncate(p.caption_sample, 150) || 'none'}`,
      ''
    );
  });
  return lines.join('\n');
}

/** Strip unpaired surrogates that break JSON serialization (common in IG bios with emojis). */
function sanitizeUnicode(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
            .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

async function callHaiku(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('[Haiku] ANTHROPIC_API_KEY saknas');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      temperature: 0,
      system: sanitizeUnicode(systemPrompt),
      messages: [{ role: 'user', content: sanitizeUnicode(userPrompt) }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`[Haiku] ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

/**
 * Parsa Haiku-response som JSON-array. Tål truncation.
 */
export function parseClassifications(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const re = /\{[^{}]*"index"\s*:\s*\d+[^{}]*\}/g;
    const matches = raw.match(re) || [];
    const parsed = [];
    for (const m of matches) {
      try { parsed.push(JSON.parse(m)); } catch {}
    }
    return parsed;
  }
}

/**
 * @param {Candidate[]} candidates - post-Fas-4 kept
 * @returns {Promise<{ confirmed: Candidate[], reserve: Candidate[] }>}
 */
export async function classifyWithHaiku(candidates) {
  const confirmed = [];
  const reserve = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    let results = [];
    try {
      const raw = await callHaiku(SYSTEM_PROMPT, renderUserPrompt(batch));
      results = parseClassifications(raw);
    } catch (err) {
      console.warn(`[HaikuClassifier] Batch ${i / BATCH_SIZE + 1} fail: ${err.message} — passing through uncertain`);
      // På fail → pass-through alla med brand_score <= 1 som uncertain/0.5
      for (const cand of batch) {
        if ((cand.brand_score || 0) <= 1) {
          confirmed.push({ ...cand, haiku_class: 'uncertain', haiku_confidence: 0.5 });
        }
      }
      continue;
    }

    const breakdown = { creator: 0, brand: 0, uncertain: 0, missing: 0 };
    const dropped = [];
    batch.forEach((cand, idx) => {
      const r = results.find(x => x.index === idx);
      if (!r) { breakdown.missing++; return; }
      const conf = typeof r.confidence === 'number' ? r.confidence : 0.5;
      breakdown[r.class] = (breakdown[r.class] || 0) + 1;

      if (r.class === 'creator') {
        confirmed.push({ ...cand, haiku_class: 'creator', haiku_confidence: conf });
      } else if (r.class === 'uncertain' && conf >= 0.4 && (cand.brand_score || 0) <= 1) {
        // Sänkt från 0.5 → 0.4 eftersom IG-reel-data är för tunn för hög konfidens.
        confirmed.push({ ...cand, haiku_class: 'creator', haiku_confidence: conf });
      } else if (r.class === 'uncertain' && conf >= 0.25 && (cand.brand_score || 0) <= 2 && reserve.length < 30) {
        // Sänkt från 0.3 → 0.25 för samma anledning.
        reserve.push({ ...cand, haiku_class: 'uncertain', haiku_confidence: conf });
      } else {
        dropped.push({ handle: cand.handle, platform: cand.platform, class: r.class, conf, bio: (cand.bio || '').slice(0, 50) });
      }
    });
    console.log(`[HaikuClassifier] Batch breakdown — creator:${breakdown.creator}, brand:${breakdown.brand}, uncertain:${breakdown.uncertain}, missing:${breakdown.missing}`);
    // Logga ALLA droppade handles (inte bara sample)
    if (dropped.length > 0) {
      const brandDrops = dropped.filter(d => d.class === 'brand');
      const otherDrops = dropped.filter(d => d.class !== 'brand');
      if (brandDrops.length > 0) {
        console.log(`[HaikuClassifier]   BRAND-REJECT (${brandDrops.length}): ${brandDrops.map(d => `@${d.handle}`).join(', ')}`);
      }
      if (otherDrops.length > 0) {
        console.log(`[HaikuClassifier]   OTHER-DROP (${otherDrops.length}): ${otherDrops.map(d => `@${d.handle}(${d.class})`).join(', ')}`);
      }
    }
    console.log(`[HaikuClassifier] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(candidates.length / BATCH_SIZE)} processed (${batch.length} profiler)`);
  }

  console.log(`[HaikuClassifier] Total: confirmed=${confirmed.length}, reserve=${reserve.length}, dropped=${candidates.length - confirmed.length - reserve.length}`);
  return { confirmed, reserve };
}

export const __test__ = { parseClassifications, renderUserPrompt, truncate };
