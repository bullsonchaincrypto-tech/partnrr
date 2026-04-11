import { Router } from 'express';
import crypto from 'crypto';
import { queryAll, queryOne, runSql } from '../db/schema.js';

const router = Router();

// ============================================================
// ROLLER: admin (full access), manager (allt utom team), viewer (läsrättighet)
// ============================================================

const ROLES = {
  admin: { label: 'Admin', permissions: ['team', 'outreach', 'contracts', 'analytics', 'settings'] },
  manager: { label: 'Manager', permissions: ['outreach', 'contracts', 'analytics'] },
  viewer: { label: 'Viewer', permissions: ['analytics'] },
};


// GET /api/team — lista alla teammedlemmar
router.get('/', async (req, res) => {
  try {
    const members = await queryAll(`
      SELECT id, namn, epost, roll, avatar_url, invite_status, last_active_at, created_at
      FROM team_members
      ORDER BY
        CASE roll WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END,
        created_at ASC
    `);

    // Räkna aktiviteter per användare (senaste 30 dagarna)
    const activityCounts = await queryAll(`
      SELECT user_id, COUNT(*) as count
      FROM activity_log
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY user_id
    `);
    const activityMap = activityCounts.reduce((acc, r) => { acc[r.user_id] = r.count; return acc; }, {});

    const enriched = members.map(m => ({
      ...m,
      activity_count_30d: activityMap[m.id] || 0,
      permissions: ROLES[m.roll]?.permissions || [],
      roll_label: ROLES[m.roll]?.label || m.roll,
    }));

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// GET /api/team/roles — tillgängliga roller med behörigheter
router.get('/roles', async (req, res) => {
  res.json(ROLES);
});


// POST /api/team/invite — bjud in teammedlem
router.post('/invite', async (req, res) => {
  try {
    const { namn, epost, roll } = req.body;

    if (!namn || !epost) {
      return res.status(400).json({ error: 'Namn och e-post krävs' });
    }

    const validRoll = ROLES[roll] ? roll : 'viewer';

    // Kolla om redan finns
    const existing = await queryOne('SELECT id, invite_status FROM team_members WHERE LOWER(epost) = ?', [epost.toLowerCase()]);
    if (existing) {
      return res.status(400).json({ error: 'Denna e-postadress är redan tillagd i teamet' });
    }

    const inviteToken = crypto.randomBytes(16).toString('hex');

    const { lastId } = await runSql(`
      INSERT INTO team_members (namn, epost, roll, invite_token, invite_status)
      VALUES (?, ?, ?, ?, 'invited')
    `, [namn, epost.toLowerCase(), validRoll, inviteToken]);

    // Logga aktivitet
    logActivity(null, 'System', 'team_invite', 'team_member', lastId, `Bjöd in ${namn} (${epost}) som ${validRoll}`);

    // Skicka inbjudningsmail (om Gmail är konfigurerat)
    try {
      const { sendEmail } = await import('../services/email-service.js');
      await sendEmail({
        to: epost,
        subject: `Du har bjudits in till Partnrr-teamet`,
        body: `Hej ${namn}!\n\nDu har bjudits in att använda Partnrr (outreach-verktyg för influencer-marknadsföring).\n\nDin roll: ${ROLES[validRoll]?.label || validRoll}\n\nLogga in här: ${process.env.CLIENT_URL || 'http://localhost:5173'}\n\nVälkommen!`,
      });
    } catch (emailErr) {
      console.log('[Team] Kunde inte skicka inbjudningsmail:', emailErr.message);
    }

    res.json({
      id: lastId,
      namn,
      epost,
      roll: validRoll,
      invite_status: 'invited',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// PUT /api/team/:id — uppdatera teammedlem (roll, namn)
router.put('/:id', async (req, res) => {
  try {
    const { namn, roll } = req.body;
    const id = Number(req.params.id);

    const member = await queryOne('SELECT * FROM team_members WHERE id = ?', [id]);
    if (!member) return res.status(404).json({ error: 'Medlemmen hittades inte' });

    const updates = [];
    const params = [];

    if (namn) { updates.push('namn = ?'); params.push(namn); }
    if (roll && ROLES[roll]) { updates.push('roll = ?'); params.push(roll); }

    if (updates.length === 0) return res.status(400).json({ error: 'Inga fält att uppdatera' });

    params.push(id);
    await runSql(`UPDATE team_members SET ${updates.join(', ')} WHERE id = ?`, params);

    if (roll && roll !== member.roll) {
      logActivity(null, 'System', 'role_change', 'team_member', id, `Ändrade ${member.namn} från ${member.roll} till ${roll}`);
    }

    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// DELETE /api/team/:id — ta bort teammedlem
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const member = await queryOne('SELECT * FROM team_members WHERE id = ?', [id]);
    if (!member) return res.status(404).json({ error: 'Medlemmen hittades inte' });

    await runSql('DELETE FROM team_members WHERE id = ?', [id]);
    logActivity(null, 'System', 'team_remove', 'team_member', id, `Tog bort ${member.namn} (${member.epost})`);

    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// AKTIVITETSLOGG
// ============================================================

// GET /api/team/activity — senaste aktiviteter
router.get('/activity', async (req, res) => {
  try {
    const { limit = 50, entity_type } = req.query;
    let sql = `SELECT * FROM activity_log`;
    const params = [];

    if (entity_type) {
      sql += ' WHERE entity_type = ?';
      params.push(entity_type);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(Number(limit));

    res.json(await queryAll(sql, params));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// POST /api/team/activity — logga en aktivitet (anropas av andra endpoints/OpenClaw)
router.post('/activity', async (req, res) => {
  try {
    const { user_name, action, entity_type, entity_id, details } = req.body;

    if (!action) return res.status(400).json({ error: 'action krävs' });

    logActivity(null, user_name || 'System', action, entity_type, entity_id, details);
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// GET /api/team/stats — teamstatistik
router.get('/stats', async (req, res) => {
  try {
    const total = (await queryOne('SELECT COUNT(*) as count FROM team_members'))?.count || 0;
    const byRole = await queryAll('SELECT roll, COUNT(*) as count FROM team_members GROUP BY roll');
    const roleMap = byRole.reduce((acc, r) => { acc[r.roll] = r.count; return acc; }, {});

    const activeToday = (await queryOne(`
      SELECT COUNT(*) as count FROM team_members
      WHERE last_active_at >= datetime('now', '-1 day')
    `))?.count || 0;

    const recentActivity = await queryAll(`
      SELECT * FROM activity_log
      ORDER BY created_at DESC LIMIT 10
    `);

    const activityByDay = await queryAll(`
      SELECT DATE(created_at) as dag, COUNT(*) as count
      FROM activity_log
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY DATE(created_at)
      ORDER BY dag DESC
    `);

    res.json({
      total_members: total,
      by_role: roleMap,
      active_today: activeToday,
      recent_activity: recentActivity,
      activity_by_day: activityByDay,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Hjälpfunktion: logga aktivitet
async function logActivity(userId, userName, action, entityType, entityId, details) {
  try {
    await runSql(`
      INSERT INTO activity_log (user_id, user_name, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [userId, userName || 'System', action, entityType || null, entityId || null, details || null]);
  } catch (e) {
    console.error('[Team] Activity log error:', e.message);
  }
}

export { logActivity };
export default router;
