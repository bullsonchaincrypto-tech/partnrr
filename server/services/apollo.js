import fetch from 'node-fetch';

/**
 * Apollo.io API-integration — Sponsor & Företags-discovery (B2B)
 *
 * Docs: https://docs.apollo.io/
 * Base URL: https://api.apollo.io/api/v1
 * Auth: X-Api-Key header
 *
 * Endpoints:
 *   POST /mixed_companies/search  — Sök företag
 *   POST /mixed_people/search     — Sök kontaktpersoner
 *   POST /people/match            — People enrichment
 *   POST /organizations/enrich    — Company enrichment
 *
 * Free plan: begränsat antal credits/mån, API inkluderad
 */

const BASE_URL = process.env.APOLLO_BASE_URL || 'https://api.apollo.io/api/v1';

// Gaming/esport/tech-industrier på Apollo
const GAMING_INDUSTRIES = [
  'computer games',
  'entertainment',
  'gambling & casinos',
  'leisure, travel & tourism',
  'sporting goods',
  'consumer electronics',
  'food & beverages',
  'health, wellness and fitness',
  'information technology and services',
  'marketing and advertising',
  'media production',
  'sports',
];

/**
 * Kolla om API:et är konfigurerat
 */
export async function isApolloConfigured() {
  return !!process.env.APOLLO_API_KEY;
}

/**
 * Skapa auth headers
 */
function getHeaders() {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new Error('APOLLO_API_KEY saknas i .env');

  return {
    'X-Api-Key': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

/**
 * Gör ett API-anrop med retry
 */
async function apiRequest(endpoint, body = null, method = 'POST') {
  const url = `${BASE_URL}${endpoint}`;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Apollo] ${method} ${endpoint}`);

      const options = {
        method,
        headers: getHeaders(),
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const res = await fetch(url, options);

      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '5');
        console.log(`[Apollo] Rate limited, väntar ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Apollo API ${res.status}: ${errText.slice(0, 300)}`);
      }

      return await res.json();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
}

// ============================================================
// FÖRETAGS-SÖKNING — Hitta potentiella sponsorer
// ============================================================

/**
 * Sök svenska företag som potentiella sponsorer.
 *
 * @param {Object} params
 * @param {string[]} [params.industries] - Branschfilter
 * @param {string} [params.keyword] - Sökord
 * @param {string} [params.country='Sweden'] - Land
 * @param {number} [params.minEmployees] - Min antal anställda
 * @param {number} [params.maxEmployees] - Max antal anställda
 * @param {number} [params.minRevenue] - Min omsättning
 * @param {string[]} [params.technologies] - Tech stack (ex: "Shopify")
 * @param {number} [params.limit=25]
 * @param {number} [params.page=1]
 */
export async function searchCompanies({
  industries,
  keyword,
  country = 'Sweden',
  minEmployees,
  maxEmployees,
  minRevenue,
  technologies,
  limit = 25,
  page = 1,
} = {}) {
  if (!isApolloConfigured()) {
    console.log('[Apollo] Ej konfigurerad');
    return { results: [], source: 'none' };
  }

  try {
    const body = {
      page,
      per_page: Math.min(limit, 100),
    };

    // Sökord
    if (keyword) {
      body.q_organization_keyword_tags = [keyword];
    }

    // Land
    if (country) {
      body.organization_locations = [country];
    }

    // Branscher
    if (industries && industries.length > 0) {
      body.organization_industry_tag_ids = industries;
    }

    // Storlek
    if (minEmployees || maxEmployees) {
      body.organization_num_employees_ranges = [];
      if (minEmployees && minEmployees >= 50) {
        body.organization_num_employees_ranges.push('51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+');
      } else if (minEmployees && minEmployees >= 11) {
        body.organization_num_employees_ranges.push('11-50', '51-200', '201-500', '501-1000', '1001-5000');
      } else {
        body.organization_num_employees_ranges.push('1-10', '11-50', '51-200', '201-500');
      }
    }

    console.log(`[Apollo] Company search:`, JSON.stringify(body).slice(0, 300));

    const data = await apiRequest('/mixed_companies/search', body);

    const companies = (data.organizations || data.accounts || []).map(normalizeCompany);

    console.log(`[Apollo] Hittade ${companies.length} företag`);
    return {
      results: companies,
      source: 'apollo',
      total: data.pagination?.total_entries || companies.length,
      page: data.pagination?.page || page,
      total_pages: data.pagination?.total_pages || 1,
    };
  } catch (err) {
    console.error(`[Apollo] Company search error:`, err.message);
    return { results: [], source: 'error', error: err.message };
  }
}

/**
 * Sök potentiella sponsorer — förkonfigurerad sökning för RankLeague.
 * Fokuserar på gaming, esport, energidryck, tech, lifestyle-företag i Sverige.
 */
export async function searchSponsors({ keyword, category, limit = 25, page = 1 } = {}) {
  // Mappning av RankLeague-kategorier till Apollo-branscher
  const categoryMap = {
    gaming: ['computer games', 'entertainment', 'media production'],
    esport: ['computer games', 'sports', 'entertainment'],
    energidryck: ['food & beverages', 'health, wellness and fitness'],
    tech: ['information technology and services', 'consumer electronics'],
    lifestyle: ['sporting goods', 'leisure, travel & tourism', 'health, wellness and fitness'],
    betting: ['gambling & casinos', 'entertainment'],
    all: GAMING_INDUSTRIES,
  };

  const industries = categoryMap[category?.toLowerCase()] || categoryMap.all;

  return searchCompanies({
    industries,
    keyword: keyword || 'gaming OR esport OR streaming',
    country: 'Sweden',
    limit,
    page,
  });
}

// ============================================================
// KONTAKTPERSON-SÖKNING — Hitta beslutsfattare
// ============================================================

/**
 * Sök kontaktpersoner på ett specifikt företag.
 * Perfekt för: "hitta marketing-chefen på NOCCO"
 *
 * @param {Object} params
 * @param {string} params.companyName - Företagsnamn
 * @param {string[]} [params.titles] - Titlar att söka (ex: ['marketing', 'CMO'])
 * @param {string[]} [params.departments] - Avdelningar (ex: ['marketing', 'sales'])
 * @param {number} [params.limit=5]
 */
export async function searchContacts({
  companyName,
  companyDomain,
  titles,
  departments,
  limit = 5,
} = {}) {
  if (!isApolloConfigured()) {
    return { results: [], source: 'none' };
  }

  try {
    const body = {
      per_page: Math.min(limit, 25),
      page: 1,
    };

    // Företag
    if (companyDomain) {
      body.q_organization_domains = companyDomain;
    } else if (companyName) {
      body.q_organization_name = companyName;
    }

    // Titlar (marketing, sponsorship, partnership, etc.)
    if (titles && titles.length > 0) {
      body.person_titles = titles;
    } else {
      // Standard: sök beslutfattare inom marketing/partnerships
      body.person_titles = [
        'Marketing Manager',
        'Marketing Director',
        'CMO',
        'Chief Marketing Officer',
        'Sponsorship Manager',
        'Partnership Manager',
        'Brand Manager',
        'Head of Marketing',
        'Marknadschef',
        'Marknadsdirektör',
      ];
    }

    // Avdelningar
    if (departments && departments.length > 0) {
      body.person_departments = departments;
    }

    // Land
    body.organization_locations = ['Sweden'];

    console.log(`[Apollo] Contact search for ${companyName || companyDomain}`);

    const data = await apiRequest('/mixed_people/search', body);

    const contacts = (data.people || data.contacts || []).map(normalizeContact);

    return {
      results: contacts,
      source: 'apollo',
      total: data.pagination?.total_entries || contacts.length,
    };
  } catch (err) {
    console.error(`[Apollo] Contact search error:`, err.message);
    return { results: [], source: 'error', error: err.message };
  }
}

/**
 * Enricha ett företag med mer data
 */
export async function enrichCompany(domain) {
  if (!isApolloConfigured()) return null;

  try {
    const data = await apiRequest('/organizations/enrich', {
      domain,
    });

    return normalizeCompany(data.organization || data);
  } catch (err) {
    console.error(`[Apollo] Company enrich error:`, err.message);
    return null;
  }
}

// ============================================================
// NORMALIZERS
// ============================================================

/**
 * Normalisera Apollo företagsdata till vårt format
 */
function normalizeCompany(raw) {
  if (!raw) return null;

  return {
    // Identifiering
    apollo_id: raw.id || null,
    name: raw.name || raw.organization_name || 'Okänt företag',
    domain: raw.primary_domain || raw.domain || raw.website_url || null,
    website: raw.website_url || (raw.primary_domain ? `https://${raw.primary_domain}` : null),
    logo_url: raw.logo_url || raw.organization_logo_url || null,

    // Bransch
    industry: raw.industry || null,
    industries: raw.industries || [],
    keywords: raw.keywords || raw.tags || [],

    // Storlek
    employees: raw.estimated_num_employees || raw.num_employees || null,
    employee_range: raw.employee_range || null,

    // Ekonomi
    revenue: raw.annual_revenue || raw.estimated_annual_revenue || null,
    revenue_range: raw.annual_revenue_printed || null,

    // Sociala medier
    linkedin_url: raw.linkedin_url || null,
    facebook_url: raw.facebook_url || null,
    twitter_url: raw.twitter_url || null,
    instagram_url: null, // Apollo har sällan Instagram

    // Geografi
    country: raw.country || null,
    city: raw.city || null,
    address: raw.raw_address || raw.street_address || null,

    // Kontakt
    phone: raw.phone || raw.primary_phone?.number || null,

    // Beskrivning
    description: raw.short_description || raw.seo_description || '',

    // Tech stack
    technologies: raw.current_technologies || [],

    // Senaste nyheter
    recent_news: raw.recent_news || [],

    // Datakälla
    datakalla: 'apollo',

    // RankLeague-specifikt
    sponsor_fit_score: calculateSponsorFit(raw),
    sponsor_category: categorizeSponsor(raw),
  };
}

/**
 * Normalisera Apollo kontaktdata
 */
function normalizeContact(raw) {
  if (!raw) return null;

  return {
    apollo_id: raw.id || null,
    name: raw.name || `${raw.first_name || ''} ${raw.last_name || ''}`.trim(),
    first_name: raw.first_name || '',
    last_name: raw.last_name || '',
    title: raw.title || raw.headline || '',
    email: raw.email || null,
    email_status: raw.email_status || null, // 'verified', 'guessed', etc.
    phone: raw.phone_numbers?.[0]?.sanitized_number || null,
    linkedin_url: raw.linkedin_url || null,

    // Företag
    company_name: raw.organization?.name || raw.organization_name || '',
    company_domain: raw.organization?.primary_domain || '',
    company_industry: raw.organization?.industry || '',

    // Geografi
    city: raw.city || null,
    country: raw.country || null,

    datakalla: 'apollo',
  };
}

/**
 * Beräkna "sponsor fit score" baserat på företagsdata.
 * Används för att ranka potentiella sponsorer.
 */
function calculateSponsorFit(company) {
  let score = 50; // Baseline

  const industry = (company.industry || '').toLowerCase();
  const keywords = (company.keywords || []).map(k => k.toLowerCase());
  const desc = (company.short_description || '').toLowerCase();

  // Gaming/esport/streaming — hög relevans
  const gamingKeywords = ['gaming', 'esport', 'game', 'streaming', 'twitch', 'youtube'];
  if (gamingKeywords.some(k => industry.includes(k) || desc.includes(k) || keywords.some(kw => kw.includes(k)))) {
    score += 25;
  }

  // Tech/energi/lifestyle — medium relevans
  const techKeywords = ['technology', 'electronics', 'energy drink', 'fitness', 'sports'];
  if (techKeywords.some(k => industry.includes(k) || desc.includes(k))) {
    score += 15;
  }

  // Svensk marknad — bonus
  if ((company.country || '').toLowerCase().includes('sweden') || (company.country || '') === 'SE') {
    score += 10;
  }

  // Storlek — medelstora företag bäst (kan sponsra, ej byråkratiska)
  const employees = company.estimated_num_employees || 0;
  if (employees >= 50 && employees <= 500) score += 10;
  else if (employees >= 10 && employees <= 1000) score += 5;

  return Math.min(score, 100);
}

/**
 * Kategorisera sponsor baserat på bransch
 */
function categorizeSponsor(company) {
  const industry = (company.industry || '').toLowerCase();
  const desc = (company.short_description || '').toLowerCase();

  if (industry.includes('game') || desc.includes('gaming') || desc.includes('esport')) return 'gaming';
  if (industry.includes('food') || industry.includes('beverage') || desc.includes('energy')) return 'energidryck';
  if (industry.includes('technology') || industry.includes('electronics')) return 'tech';
  if (industry.includes('sporting') || industry.includes('fitness')) return 'lifestyle';
  if (industry.includes('gambling') || industry.includes('betting')) return 'betting';
  if (industry.includes('marketing') || industry.includes('advertising')) return 'marknadsföring';

  return 'övrigt';
}

// ============================================================
// TEST / DIAGNOSTIK
// ============================================================

/**
 * Testa API-anslutningen
 */
export async function testConnection() {
  if (!isApolloConfigured()) {
    return { ok: false, error: 'APOLLO_API_KEY saknas i .env' };
  }

  try {
    const data = await apiRequest('/mixed_companies/search', {
      q_organization_keyword_tags: ['gaming'],
      organization_locations: ['Sweden'],
      per_page: 1,
      page: 1,
    });

    return {
      ok: true,
      source: 'apollo',
      total_results: data.pagination?.total_entries || 0,
      base_url: BASE_URL,
    };
  } catch (err) {
    return { ok: false, error: err.message, base_url: BASE_URL };
  }
}
