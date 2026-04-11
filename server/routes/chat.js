/**
 * Routes: /api/chat
 *
 * AI-chatassistent som kan utföra åtgärder i Partnrr
 */

import { Router } from 'express';
import { getDb } from '../db/schema.js';

const router = Router();

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * POST /api/chat — Skicka meddelande till AI-assistenten
 */
router.post('/', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'Meddelande krävs' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY saknas' });

    // Hämta aktuell data för kontext
    const db = getDb();
    let contextData = '';
    try {
      const stats = db.prepare(`SELECT
        (SELECT COUNT(*) FROM outreach) as total_outreach,
        (SELECT COUNT(*) FROM outreach WHERE status = 'skickat') as skickade,
        (SELECT COUNT(*) FROM outreach WHERE status = 'svarat') as svarade,
        (SELECT COUNT(*) FROM outreach WHERE status = 'avtal_signerat') as signerade,
        (SELECT COUNT(*) FROM kontrakt) as total_kontrakt,
        (SELECT COUNT(*) FROM kontrakt WHERE status = 'aktivt') as aktiva_kontrakt,
        (SELECT COUNT(*) FROM influencers) as total_influencers,
        (SELECT COUNT(*) FROM foretag) as total_foretag
      `).get();
      contextData = `\nAktuell data i systemet:\n${JSON.stringify(stats, null, 2)}`;
    } catch { /* Tabeller kanske inte finns ännu */ }

    // Senaste outreach
    let recentOutreach = '';
    try {
      const recent = db.prepare(`SELECT o.*, i.namn as influencer_namn
        FROM outreach o LEFT JOIN influencers i ON o.influencer_id = i.id
        ORDER BY o.created_at DESC LIMIT 5`).all();
      if (recent.length > 0) {
        recentOutreach = `\nSenaste utskick:\n${JSON.stringify(recent.map(r => ({
          influencer: r.influencer_namn, status: r.status, datum: r.created_at
        })), null, 2)}`;
      }
    } catch { /* OK */ }

    const systemPrompt = `Du är Partnrr AI-assistenten — en hjälpsam assistent inbyggd i Partnrr Outreach CRM. Du hjälper användaren med:

1. **Frågor om data** — Visa statistik, outreach-status, konverteringsgrad osv.
2. **Åtgärdsförslag** — Rekommendera uppföljningar, nya influencers att kontakta, optimeringsförslag
3. **Innehållsskapande** — Skriv outreach-meddelanden, uppföljningar, kontraktstext
4. **Analys** — Analysera kampanjresultat, ROI, konvertering

REGLER:
- Svara alltid på svenska
- Var kort och koncis (max 200 ord om inget annat behövs)
- Om du refererar till data, använd siffrorna från systemkontexten
- Om du inte vet, säg det istället för att gissa
- Föreslå alltid nästa steg/åtgärd

${contextData}
${recentOutreach}`;

    // Bygg meddelandehistorik
    const messages = [
      ...history.slice(-10).map(h => ({
        role: h.role,
        content: h.content,
      })),
      { role: 'user', content: message },
    ];

    const apiRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages,
      }),
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text().catch(() => '');
      console.error(`[Chat] API error ${apiRes.status}:`, errBody);
      return res.status(500).json({ error: 'AI-assistenten kunde inte svara just nu.' });
    }

    const data = await apiRes.json();
    const reply = data.content[0].text;

    res.json({
      reply,
      usage: data.usage,
    });
  } catch (error) {
    console.error('[Chat] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
