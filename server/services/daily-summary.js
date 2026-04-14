import { queryAll, queryOne, runSql, saveDb } from '../db/schema.js';
import { sendEmail } from './email-service.js';

// OpenClaw triggar daglig sammanfattning via API (POST /api/dashboard/daily-summary/send)
// Ingen intern setInterval behövs — cron hanteras av OpenClaw

/**
 * Generera daglig sammanfattning av vad som behöver uppmärksamhet
 */
export async function generateDailySummary() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // 1. Outreach som väntar på svar (skickade men inget svar)
  const awaitingReply = await queryAll(`
    SELECT om.id, om.amne, om.skickat_datum, om.followup_step,
           i.namn as influencer_namn, i.kanalnamn
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    WHERE om.status = 'skickat'
      AND om.skickat_datum IS NOT NULL
    ORDER BY om.skickat_datum ASC
  `);

  // 2. Uppföljningar som behöver skickas idag
  const followupsDue = await queryAll(`
    SELECT om.id, om.amne, om.followup_step, om.skickat_datum,
           i.namn as influencer_namn
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    WHERE om.status = 'skickat'
      AND COALESCE(om.followup_paused, 0) = 0
      AND COALESCE(om.dismissed_followup, 0) = 0
      AND COALESCE(om.followup_step, 0) < 3
      AND julianday('now') - julianday(COALESCE(om.last_followup_at, om.skickat_datum)) >= 3
  `);

  // 3. Avtal som löper ut snart (inom 7 dagar)
  const expiringContracts = await queryAll(`
    SELECT k.id, COALESCE(i.namn, sp.namn) as influencer_namn, k.status, k.expires_at
    FROM kontrakt k
    LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
    LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
    WHERE k.status = 'aktivt'
      AND k.expires_at IS NOT NULL
      AND julianday(k.expires_at) - julianday('now') <= 7
      AND julianday(k.expires_at) - julianday('now') > 0
      AND (i.id IS NOT NULL OR sp.id IS NOT NULL)
  `);

  // 4. Osignerade avtal (väntat 5+ dagar)
  const unsignedContracts = await queryAll(`
    SELECT k.id, COALESCE(i.namn, sp.namn) as influencer_namn, k.created_at
    FROM kontrakt k
    LEFT JOIN influencers i ON k.influencer_id = i.id AND COALESCE(k.source_type, 'influencer') = 'influencer'
    LEFT JOIN sponsor_prospects sp ON k.influencer_id = sp.id AND k.source_type = 'sponsor'
    WHERE k.status = 'skickat'
      AND julianday('now') - julianday(k.created_at) >= 5
      AND (i.id IS NOT NULL OR sp.id IS NOT NULL)
  `);

  // 5. Nya svar sedan igår
  const newReplies = await queryAll(`
    SELECT om.id, om.amne, i.namn as influencer_namn
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    WHERE om.status = 'svarat'
      AND julianday('now') - julianday(om.skickat_datum) <= 2
  `);

  // 6. Stats
  const totalSent = (await queryOne('SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = \'skickat\''))?.count || 0;
  const totalReplied = (await queryOne('SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = \'svarat\''))?.count || 0;
  const totalContracts = (await queryOne('SELECT COUNT(*) as count FROM kontrakt WHERE status IN (\'aktivt\', \'signerat\')'))?.count || 0;

  const actionItems = [];

  if (followupsDue.length > 0) {
    actionItems.push({
      type: 'followup',
      priority: 'high',
      title: `${followupsDue.length} uppföljningar att skicka`,
      items: followupsDue.map(f => `${f.influencer_namn} (steg ${(f.followup_step || 0) + 1})`),
    });
  }

  if (newReplies.length > 0) {
    actionItems.push({
      type: 'reply',
      priority: 'high',
      title: `${newReplies.length} nya svar!`,
      items: newReplies.map(r => r.influencer_namn),
    });
  }

  if (expiringContracts.length > 0) {
    actionItems.push({
      type: 'expiring',
      priority: 'medium',
      title: `${expiringContracts.length} avtal löper ut inom 7 dagar`,
      items: expiringContracts.map(c => `${c.influencer_namn} (${new Date(c.expires_at).toLocaleDateString('sv-SE')})`),
    });
  }

  if (unsignedContracts.length > 0) {
    actionItems.push({
      type: 'unsigned',
      priority: 'medium',
      title: `${unsignedContracts.length} avtal väntar på signering`,
      items: unsignedContracts.map(c => c.influencer_namn),
    });
  }

  return {
    date: todayStr,
    stats: {
      awaitingReply: awaitingReply.length,
      followupsDue: followupsDue.length,
      expiringContracts: expiringContracts.length,
      unsignedContracts: unsignedContracts.length,
      newReplies: newReplies.length,
      totalSent,
      totalReplied,
      totalContracts,
      responseRate: totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0,
    },
    actionItems,
    awaitingReply: awaitingReply.slice(0, 10),
    followupsDue,
    expiringContracts,
    unsignedContracts,
    newReplies,
  };
}

/**
 * Formatera sammanfattning som e-posttext
 */
function formatSummaryEmail(summary) {
  const lines = [];
  lines.push(`SparkCollab — Daglig sammanfattning (${summary.date})`);
  lines.push('');
  lines.push(`📊 Nyckeltal`);
  lines.push(`   Skickade: ${summary.stats.totalSent} · Svar: ${summary.stats.totalReplied} (${summary.stats.responseRate}%) · Avtal: ${summary.stats.totalContracts}`);
  lines.push('');

  if (summary.actionItems.length > 0) {
    lines.push(`⚡ Kräver uppmärksamhet:`);
    lines.push('');
    for (const item of summary.actionItems) {
      const icon = item.priority === 'high' ? '🔴' : '🟡';
      lines.push(`${icon} ${item.title}`);
      for (const sub of item.items.slice(0, 5)) {
        lines.push(`   • ${sub}`);
      }
      if (item.items.length > 5) {
        lines.push(`   ... och ${item.items.length - 5} till`);
      }
      lines.push('');
    }
  } else {
    lines.push('✅ Allt under kontroll — inga akuta åtgärder idag.');
    lines.push('');
  }

  lines.push(`Väntar på svar: ${summary.stats.awaitingReply} utskick`);
  lines.push('');
  lines.push('—');
  lines.push('Öppna SparkCollab för att se detaljer och agera.');

  return lines.join('\n');
}

/**
 * Skicka daglig sammanfattning via email
 */
export async function sendDailySummary(recipientEmail) {
  if (!recipientEmail) throw new Error('E-postadress saknas');

  const summary = generateDailySummary();
  const body = formatSummaryEmail(summary);
  const subject = summary.actionItems.length > 0
    ? `SparkCollab: ${summary.actionItems.length} saker kräver uppmärksamhet`
    : `SparkCollab: Daglig sammanfattning (${summary.date})`;

  await sendEmail({ to: recipientEmail, subject, body });

  return { sent: true, to: recipientEmail, summary };
}

/**
 * Starta daglig sammanfattningsscheduler (legacy — behålls för bakåtkompatibilitet)
 * OpenClaw hanterar scheduling via cron → POST /api/dashboard/daily-summary/send
 */
export async function startDailyScheduler(email) {
  console.log(`[DailySummary] Scheduling hanteras av OpenClaw. Använd POST /api/dashboard/daily-summary/send för manuell körning.`);
}

export async function stopDailyScheduler() {
  console.log('[DailySummary] Scheduling hanteras av OpenClaw.');
}
