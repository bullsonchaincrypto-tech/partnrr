/**
 * Routes: /api/agents
 *
 * Hanterar Managed Agents (automation) och AI-driven sökning
 */

import { Router } from 'express';
import {
  setupPartnrrAgents,
  runPartnrrTask,
  createSession,
  sendEvent,
  getSession,
  listAgents,
} from '../services/managed-agents.js';
import {
  searchInfluencersAI,
  findEmailAI,
  findEmailsBatch,
  generateOutreachMessage,
  generateSubject,
  analyzeContentQuality,
} from '../services/ai-search.js';
import { getDb } from '../db/schema.js';
import { findEmailsForChannels } from '../services/email-finder.js';

const router = Router();

// ============================================================
// MANAGED AGENTS — SETUP & AUTOMATION
// ============================================================

// Lagra agent-config i minnet (persisteras i DB vid setup)
let agentConfig = null;

/**
 * POST /api/agents/setup — Sätt upp alla Partnrr-agenter i Anthropic molnet
 */
router.post('/setup', async (req, res) => {
  try {
    console.log('[Agents] Sätter upp Managed Agents...');
    const config = await setupPartnrrAgents();
    agentConfig = config;

    // Spara i DB
    const db = getDb();
    db.run(`CREATE TABLE IF NOT EXISTS agent_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    const stmt = db.prepare('INSERT OR REPLACE INTO agent_config (key, value, updated_at) VALUES (?, ?, ?)');
    stmt.run('agents', JSON.stringify(config.agents), new Date().toISOString());
    stmt.run('environment', JSON.stringify(config.environment), new Date().toISOString());

    console.log('[Agents] Setup klar!', Object.keys(config.agents).length, 'agenter skapade');
    res.json({ success: true, ...config });
  } catch (error) {
    console.error('[Agents] Setup error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agents/status — Kolla om agenter är konfigurerade
 */
router.get('/status', async (req, res) => {
  try {
    if (!agentConfig) {
      // Försök ladda från DB
      const db = getDb();
      try {
        const agents = db.prepare('SELECT value FROM agent_config WHERE key = ?').get('agents');
        const env = db.prepare('SELECT value FROM agent_config WHERE key = ?').get('environment');
        if (agents && env) {
          agentConfig = {
            agents: JSON.parse(agents.value),
            environment: JSON.parse(env.value),
          };
        }
      } catch {
        // Tabellen kanske inte finns ännu
      }
    }

    res.json({
      configured: !!agentConfig,
      agents: agentConfig ? Object.keys(agentConfig.agents) : [],
      environment: agentConfig?.environment?.id || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agents/run/:task — Kör en specifik automation
 * Tasks: auto-followup, content-monitor, contract-monitor, gmail-inbox-monitor, smart-email-finder
 */
router.post('/run/:task', async (req, res) => {
  try {
    const { task } = req.params;
    const { message } = req.body; // Valfritt custom-meddelande

    if (!agentConfig) {
      return res.status(400).json({ error: 'Agenter inte konfigurerade. Kör POST /api/agents/setup först.' });
    }

    const agentInfo = agentConfig.agents[task];
    if (!agentInfo) {
      return res.status(404).json({ error: `Okänd task: ${task}. Tillgängliga: ${Object.keys(agentConfig.agents).join(', ')}` });
    }

    console.log(`[Agents] Kör task: ${task}`);
    const result = await runPartnrrTask(
      task,
      agentInfo.id,
      agentConfig.environment.id,
      message
    );

    // Logga i automation_log
    try {
      const db = getDb();
      db.prepare(`INSERT INTO automation_log (job_type, status, details, created_at)
                   VALUES (?, 'completed', ?, datetime('now'))`).run(
        `managed_agent_${task}`,
        JSON.stringify({ sessionId: result.sessionId, toolsUsed: result.toolsUsed })
      );
    } catch { /* Logga tyst */ }

    res.json({
      success: true,
      task,
      sessionId: result.sessionId,
      result: result.result,
      toolsUsed: result.toolsUsed,
    });
  } catch (error) {
    console.error(`[Agents] Task error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// AI-DRIVEN INFLUENCER-SÖKNING
// ============================================================

/**
 * POST /api/agents/search — Sök influencers med AI
 */
router.post('/search', async (req, res) => {
  try {
    const { companyName, industry, nischer, platforms, budget, audience_age, goal, previousCollabs, beskrivning, erbjudande_typ, syfte } = req.body;

    if (!companyName) {
      return res.status(400).json({ error: 'companyName krävs' });
    }

    console.log(`[AI-Search] Startar sökning för "${companyName}" på ${(platforms || []).join(', ')}...`);
    console.log(`[AI-Search] Beskrivning: ${beskrivning || '(saknas)'}`);

    const influencers = await searchInfluencersAI({
      companyName,
      industry,
      nischer,
      platforms,
      budget,
      audience_age,
      goal,
      previousCollabs,
      beskrivning,
      erbjudande_typ,
      syfte,
    });

    console.log(`[AI-Search] ✅ Hittade ${influencers.length} influencers`);

    // Steg 2: Sök e-post med SerpAPI för alla som saknar e-post
    const withoutEmail = influencers.filter(inf => !inf.kontakt_epost);
    if (withoutEmail.length > 0 && process.env.SERPAPI_KEY) {
      console.log(`[AI-Search] 📧 Söker e-post för ${withoutEmail.length} influencers via SerpAPI...`);
      try {
        const emailResults = await findEmailsForChannels(
          withoutEmail.map(inf => ({
            kanalnamn: (inf.kanalnamn || '').replace(/^@/, ''),
            namn: inf.namn || '',
            beskrivning: inf.profil_beskrivning || '',
            kontakt_info: '',
          })),
          8
        );

        // Mappa tillbaka e-poster till influencers
        let emailsFound = 0;
        for (let i = 0; i < withoutEmail.length; i++) {
          const emailResult = emailResults[i];
          if (emailResult?.email) {
            withoutEmail[i].kontakt_epost = emailResult.email;
            emailsFound++;
          }
        }
        console.log(`[AI-Search] 📧 SerpAPI hittade ${emailsFound} nya e-poster`);
      } catch (emailErr) {
        console.warn(`[AI-Search] ⚠ SerpAPI e-postsökning misslyckades:`, emailErr.message);
      }
    }

    const totalEmails = influencers.filter(inf => inf.kontakt_epost).length;
    console.log(`[AI-Search] 📊 Totalt: ${influencers.length} influencers, ${totalEmails} med e-post`);

    res.json({
      success: true,
      count: influencers.length,
      source: 'ai_web_search',
      influencers,
    });
  } catch (error) {
    console.error('[AI-Search] ❌ FEL:', error.message);
    console.error('[AI-Search] Stack:', error.stack?.split('\n').slice(0, 3).join('\n'));
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agents/find-email — Hitta e-post för en influencer
 */
router.post('/find-email', async (req, res) => {
  try {
    const { namn, kanalnamn, plattform } = req.body;
    if (!namn || !kanalnamn) {
      return res.status(400).json({ error: 'namn och kanalnamn krävs' });
    }

    const result = await findEmailAI({ namn, kanalnamn, plattform: plattform || 'youtube' });
    res.json(result);
  } catch (error) {
    console.error('[AI-Email] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agents/find-emails-batch — Hitta e-post för flera influencers
 */
router.post('/find-emails-batch', async (req, res) => {
  try {
    const { influencers } = req.body;
    if (!influencers?.length) {
      return res.status(400).json({ error: 'influencers-array krävs' });
    }

    const results = await findEmailsBatch(influencers);
    const found = results.filter(r => r.email && r.confidence !== 'none').length;

    res.json({
      success: true,
      total: influencers.length,
      found,
      results,
    });
  } catch (error) {
    console.error('[AI-Email-Batch] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agents/generate-outreach — Generera outreach-meddelande med AI
 */
router.post('/generate-outreach', async (req, res) => {
  try {
    const { influencer, foretag, outreachType, kontaktperson, briefAnswers } = req.body;
    if (!influencer || !foretag) {
      return res.status(400).json({ error: 'influencer och foretag krävs' });
    }

    const [raw, fallbackAmne] = await Promise.all([
      generateOutreachMessage({ influencer, foretag, outreachType, kontaktperson, briefAnswers }),
      generateSubject({ influencer, foretag, outreachType }),
    ]);

    // Parsa ÄMNE: ... --- [brödtext] format
    let amnesrad = fallbackAmne;
    let meddelande = raw;
    const parts = raw.split('---');
    if (parts.length >= 2) {
      const amneLine = parts[0].trim();
      amnesrad = amneLine.replace(/^ÄMNE:\s*/i, '').trim() || fallbackAmne;
      meddelande = parts.slice(1).join('---').trim();
    }

    res.json({
      success: true,
      amnesrad,
      meddelande,
      influencer: influencer.namn,
    });
  } catch (error) {
    console.error('[AI-Outreach] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agents/generate-outreach-batch — Generera meddelanden för flera influencers
 */
router.post('/generate-outreach-batch', async (req, res) => {
  try {
    const { influencers, foretag, outreachType, kontaktperson, briefAnswers } = req.body;
    if (!influencers?.length || !foretag) {
      return res.status(400).json({ error: 'influencers och foretag krävs' });
    }

    const results = [];
    // Kör 2 åt gången för att inte överbelasta API:t
    for (let i = 0; i < influencers.length; i += 2) {
      const batch = influencers.slice(i, i + 2);
      const batchResults = await Promise.all(
        batch.map(async (inf) => {
          try {
            const [raw, fallbackAmne] = await Promise.all([
              generateOutreachMessage({ influencer: inf, foretag, outreachType, kontaktperson, briefAnswers }),
              generateSubject({ influencer: inf, foretag, outreachType }),
            ]);
            // Parsa ÄMNE: ... --- [brödtext] format
            let amnesrad = fallbackAmne;
            let meddelande = raw;
            const parts = raw.split('---');
            if (parts.length >= 2) {
              const amneLine = parts[0].trim();
              amnesrad = amneLine.replace(/^ÄMNE:\s*/i, '').trim() || fallbackAmne;
              meddelande = parts.slice(1).join('---').trim();
            }
            return { influencer: inf.namn, amnesrad, meddelande, success: true };
          } catch (err) {
            return { influencer: inf.namn, error: err.message, success: false };
          }
        })
      );
      results.push(...batchResults);
    }

    res.json({
      success: true,
      total: influencers.length,
      generated: results.filter(r => r.success).length,
      results,
    });
  } catch (error) {
    console.error('[AI-Outreach-Batch] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agents/analyze-content — Analysera influencers content-kvalitet
 */
router.post('/analyze-content', async (req, res) => {
  try {
    const { kanalnamn, plattform, nisch } = req.body;
    if (!kanalnamn) {
      return res.status(400).json({ error: 'kanalnamn krävs' });
    }

    const analysis = await analyzeContentQuality({ kanalnamn, plattform: plattform || 'youtube', nisch: nisch || 'gaming' });
    res.json({ success: true, ...analysis });
  } catch (error) {
    console.error('[AI-Content] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
