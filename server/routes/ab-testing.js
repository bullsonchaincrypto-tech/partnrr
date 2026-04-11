import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';

const router = Router();

// ============================================================
// A/B-TESTER — Skapa, hantera och analysera
// ============================================================

// GET /api/ab-tests — lista alla tester
router.get('/', async (req, res) => {
  try {
    const { foretag_id, status } = req.query;
    let sql = `
      SELECT ab.*, f.namn as foretag_namn
      FROM ab_tests ab
      LEFT JOIN foretag f ON ab.foretag_id = f.id
      WHERE 1=1
    `;
    const params = [];

    if (foretag_id) {
      sql += ' AND ab.foretag_id = ?';
      params.push(Number(foretag_id));
    }
    if (status) {
      sql += ' AND ab.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY ab.created_at DESC';
    const tests = await queryAll(sql, params);

    // Beräkna live-statistik
    const enriched = tests.map(t => {
      const stats = getTestStats(t.id);
      return { ...t, ...stats };
    });

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ab-tests — skapa nytt A/B-test
router.post('/', async (req, res) => {
  try {
    const { foretag_id, name } = req.body;
    if (!foretag_id || !name) {
      return res.status(400).json({ error: 'foretag_id och name krävs' });
    }

    const { lastId } = await runSql(
      'INSERT INTO ab_tests (foretag_id, name) VALUES (?, ?)',
      [foretag_id, name]
    );

    res.json({ status: 'created', id: lastId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ab-tests/:id — detaljer med full statistik
router.get('/:id', async (req, res) => {
  try {
    const test = await queryOne('SELECT ab.*, f.namn as foretag_namn FROM ab_tests ab LEFT JOIN foretag f ON ab.foretag_id = f.id WHERE ab.id = ?', [Number(req.params.id)]);
    if (!test) return res.status(404).json({ error: 'Test hittades inte' });

    const stats = getTestStats(test.id);

    // Hämta alla outreach kopplade till testet
    const variantA = await queryAll(`
      SELECT om.id, om.amne, om.status, om.skickat_datum,
             i.namn as influencer_namn, i.kanalnamn
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE om.ab_test_id = ? AND om.ab_variant = 'A'
      ORDER BY om.skickat_datum DESC
    `, [test.id]);

    const variantB = await queryAll(`
      SELECT om.id, om.amne, om.status, om.skickat_datum,
             i.namn as influencer_namn, i.kanalnamn
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE om.ab_test_id = ? AND om.ab_variant = 'B'
      ORDER BY om.skickat_datum DESC
    `, [test.id]);

    res.json({ ...test, ...stats, variant_a_outreach: variantA, variant_b_outreach: variantB });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/ab-tests/:id/complete — avsluta test och utse vinnare
router.put('/:id/complete', async (req, res) => {
  try {
    const test = await queryOne('SELECT * FROM ab_tests WHERE id = ?', [Number(req.params.id)]);
    if (!test) return res.status(404).json({ error: 'Test hittades inte' });

    const stats = getTestStats(test.id);

    // Utse vinnare baserat på svarsfrekvens
    let winner = null;
    if (stats.rate_a > stats.rate_b) winner = 'A';
    else if (stats.rate_b > stats.rate_a) winner = 'B';
    else winner = 'draw';

    await runSql(
      `UPDATE ab_tests SET status = 'completed', winner = ?,
       total_sent_a = ?, total_sent_b = ?,
       total_replied_a = ?, total_replied_b = ?,
       completed_at = datetime('now')
       WHERE id = ?`,
      [winner, stats.sent_a, stats.sent_b, stats.replied_a, stats.replied_b, Number(req.params.id)]
    );

    res.json({ status: 'completed', winner, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/ab-tests/:id
router.delete('/:id', async (req, res) => {
  try {
    // Koppla loss outreach från testet
    await runSql('UPDATE outreach_meddelanden SET ab_test_id = NULL, ab_variant = NULL WHERE ab_test_id = ?', [Number(req.params.id)]);
    await runSql('DELETE FROM ab_tests WHERE id = ?', [Number(req.params.id)]);
    res.json({ status: 'deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ab-tests/insights/summary — övergripande A/B-insikter
router.get('/insights/summary', async (req, res) => {
  try {
    const completed = await queryAll("SELECT * FROM ab_tests WHERE status = 'completed' AND winner IS NOT NULL");

    const totalTests = completed.length;
    const aWins = completed.filter(t => t.winner === 'A').length;
    const bWins = completed.filter(t => t.winner === 'B').length;
    const draws = completed.filter(t => t.winner === 'draw').length;

    // Genomsnittliga svarsfrekvenser
    let avgRateA = 0, avgRateB = 0;
    if (totalTests > 0) {
      avgRateA = completed.reduce((s, t) => {
        const rate = t.total_sent_a > 0 ? (t.total_replied_a / t.total_sent_a) * 100 : 0;
        return s + rate;
      }, 0) / totalTests;

      avgRateB = completed.reduce((s, t) => {
        const rate = t.total_sent_b > 0 ? (t.total_replied_b / t.total_sent_b) * 100 : 0;
        return s + rate;
      }, 0) / totalTests;
    }

    res.json({
      total_tests: totalTests,
      a_wins: aWins,
      b_wins: bWins,
      draws,
      avg_response_rate_a: Number(avgRateA.toFixed(1)),
      avg_response_rate_b: Number(avgRateB.toFixed(1)),
      active_tests: (await queryOne("SELECT COUNT(*) as count FROM ab_tests WHERE status = 'active'"))?.count || 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// HJÄLPFUNKTIONER
// ============================================================

async function getTestStats(testId) {
  const sentA = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE ab_test_id = ? AND ab_variant = 'A' AND status != 'utkast'", [testId]))?.count || 0;
  const sentB = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE ab_test_id = ? AND ab_variant = 'B' AND status != 'utkast'", [testId]))?.count || 0;
  const repliedA = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE ab_test_id = ? AND ab_variant = 'A' AND status IN ('svarat', 'avtal_signerat')", [testId]))?.count || 0;
  const repliedB = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE ab_test_id = ? AND ab_variant = 'B' AND status IN ('svarat', 'avtal_signerat')", [testId]))?.count || 0;

  const rateA = sentA > 0 ? Number(((repliedA / sentA) * 100).toFixed(1)) : 0;
  const rateB = sentB > 0 ? Number(((repliedB / sentB) * 100).toFixed(1)) : 0;

  const contractA = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE ab_test_id = ? AND ab_variant = 'A' AND status = 'avtal_signerat'", [testId]))?.count || 0;
  const contractB = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE ab_test_id = ? AND ab_variant = 'B' AND status = 'avtal_signerat'", [testId]))?.count || 0;

  return {
    sent_a: sentA, sent_b: sentB,
    replied_a: repliedA, replied_b: repliedB,
    rate_a: rateA, rate_b: rateB,
    contract_a: contractA, contract_b: contractB,
    leading: rateA > rateB ? 'A' : rateB > rateA ? 'B' : 'draw',
  };
}

export default router;
