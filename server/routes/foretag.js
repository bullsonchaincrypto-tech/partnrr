import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { enrichCompanyDomain, generateBriefQuestions } from '../services/enrichment.js';

const router = Router();

router.get('/', async (req, res) => {
  const rows = await queryAll('SELECT * FROM foretag ORDER BY created_at DESC');
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const row = await queryOne('SELECT * FROM foretag WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Företag hittades inte' });
  res.json(row);
});

router.post('/', async (req, res) => {
  const { namn, epost, kontaktperson, bransch, syfte, erbjudande_typ, beskrivning, domain, org_nummer } = req.body;
  // Bakåtkompatibel: namn = foretag_namn, hemsida = domain
  const foretagNamn = namn || req.body.foretag_namn;
  const hemsida = domain || req.body.hemsida || null;
  if (!foretagNamn || !epost) return res.status(400).json({ error: 'Företagsnamn och e-post krävs' });

  const { lastId } = await runSql(
    `INSERT INTO foretag (namn, epost, kontaktperson, bransch, hemsida, syfte, erbjudande_typ, beskrivning, org_nummer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [foretagNamn, epost, kontaktperson || null, bransch || null, hemsida, syfte || null, erbjudande_typ || null, beskrivning || null, org_nummer || null]
  );
  console.log('Created foretag with lastId:', lastId);
  let foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [lastId]);
  if (!foretag) {
    foretag = await queryOne('SELECT * FROM foretag ORDER BY id DESC LIMIT 1');
    console.log('Fallback foretag:', foretag);
  }
  res.status(201).json(foretag);
});

router.put('/:id', async (req, res) => {
  const { namn, epost, kontaktperson, bransch, syfte, erbjudande_typ, beskrivning, domain, org_nummer } = req.body;
  const foretagNamn = namn || req.body.foretag_namn;
  const hemsida = domain || req.body.hemsida || null;
  await runSql(
    `UPDATE foretag SET namn = ?, epost = ?, kontaktperson = ?, bransch = ?, hemsida = ?, syfte = ?, erbjudande_typ = ?, beskrivning = ?, org_nummer = ? WHERE id = ?`,
    [foretagNamn, epost, kontaktperson, bransch || null, hemsida, syfte || null, erbjudande_typ || null, beskrivning || null, org_nummer || null, Number(req.params.id)]
  );
  const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [Number(req.params.id)]);
  res.json(foretag);
});

// ============================================================
// DOMÄN-ENRICHMENT
// ============================================================

// POST /api/foretag/enrich — enricha företag baserat på domän (med 24h cache)
router.post('/enrich', async (req, res) => {
  try {
    const { domain, foretag_id } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domän krävs' });

    // Kolla cache först
    const cached = await queryOne(
      `SELECT data FROM enrichment_cache WHERE domain = ? AND expires_at > datetime('now')`,
      [domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')]
    );
    if (cached) {
      console.log(`[Enrichment] Cache-träff för ${domain}`);
      const data = JSON.parse(cached.data);
      // Om foretag_id angetts, uppdatera company_profile
      if (foretag_id) {
        await runSql('UPDATE foretag SET company_profile = ? WHERE id = ?', [cached.data, foretag_id]);
      }
      return res.json(data);
    }

    console.log(`[Enrichment] Enrichar domän: ${domain}`);
    const data = await enrichCompanyDomain(domain);
    console.log(`[Enrichment] Resultat:`, {
      success: data.success,
      company: data.company_name,
      industry: data.industry,
      socials: Object.keys(data.social_profiles || {}),
    });

    // Spara i cache
    const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    try {
      await runSql(
        `INSERT OR REPLACE INTO enrichment_cache (domain, data, created_at, expires_at) VALUES (?, ?, datetime('now'), datetime('now', '+24 hours'))`,
        [cleanDomain, JSON.stringify(data)]
      );
    } catch (e) { console.log('[Enrichment] Cache-sparning misslyckades:', e.message); }

    // Om foretag_id angetts, uppdatera company_profile + logo_url
    if (foretag_id) {
      await runSql('UPDATE foretag SET company_profile = ? WHERE id = ?', [JSON.stringify(data), foretag_id]);
      if (data.logo_url) {
        await runSql('UPDATE foretag SET logo_url = ? WHERE id = ?', [data.logo_url, foretag_id]);
      }
    }

    res.json(data);
  } catch (error) {
    console.error('[Enrichment] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/foretag/brief-questions — generera AI-drivna brief-frågor
router.post('/brief-questions', async (req, res) => {
  try {
    const { enrichment_data, bransch, outreach_type } = req.body;
    // Frontend skickar 'sponsor', backend mappar till 'company'
    const mappedType = (outreach_type === 'sponsor' || outreach_type === 'company') ? 'company' : 'influencer';
    const questions = await generateBriefQuestions(enrichment_data || {}, bransch || '', mappedType);
    res.json(questions);
  } catch (error) {
    console.error('[Brief] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/foretag/:id/profile — spara strukturerad profil med enrichment + brief-svar
router.put('/:id/profile', async (req, res) => {
  try {
    const { enrichment_data, brief_answers, kontrakt_brief, company_profile } = req.body;
    const id = Number(req.params.id);

    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [id]);
    if (!foretag) return res.status(404).json({ error: 'Företag hittades inte' });

    // Hämta befintlig profil och merga — inte skriv över
    let existingProfile = {};
    try {
      if (foretag.company_profile) existingProfile = JSON.parse(foretag.company_profile);
    } catch {}

    const profileJson = JSON.stringify({
      ...existingProfile,
      ...company_profile,
      enrichment_data: enrichment_data || existingProfile.enrichment_data || null,
      brief_answers: brief_answers || existingProfile.brief_answers || null,
      kontrakt_brief: kontrakt_brief || existingProfile.kontrakt_brief || null,
      updated_at: new Date().toISOString(),
    });

    await runSql('UPDATE foretag SET company_profile = ? WHERE id = ?', [profileJson, id]);

    // Uppdatera även enskilda fält om enrichment har bättre data
    if (enrichment_data?.domain) {
      await runSql('UPDATE foretag SET hemsida = ? WHERE id = ? AND (hemsida IS NULL OR hemsida = "")', [enrichment_data.domain, id]);
    }

    const updated = await queryOne('SELECT * FROM foretag WHERE id = ?', [id]);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
