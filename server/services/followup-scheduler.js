import { queryAll, queryOne, runSql, saveDb } from '../db/schema.js';
import { generateFollowUp, generateFollowUpSubject } from './anthropic.js';
import { sendEmail } from './email-service.js';

// OpenClaw triggar uppföljningar via API (POST /api/followup-sequence/run)
// Ingen intern setInterval behövs — cron hanteras av OpenClaw

/**
 * Hämta uppföljningsinställningar
 */
export async function getSettings() {
  return await queryOne('SELECT * FROM followup_sequence_settings WHERE id = 1') || {
    enabled: 0, step1_days: 3, step2_days: 7, step3_days: 14, max_steps: 3, auto_send: 0
  };
}

/**
 * Hitta alla outreach som behöver uppföljning
 */
export async function getDueFollowups() {
  const settings = getSettings();
  if (!settings.enabled) return [];

  const stepDays = [settings.step1_days, settings.step2_days, settings.step3_days];

  // Hämta alla skickade outreach som inte fått svar, inte pausade, inte nått max steg
  const candidates = await queryAll(`
    SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost,
           f.namn as foretag_namn
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    JOIN foretag f ON om.foretag_id = f.id
    WHERE om.status = 'skickat'
      AND om.skickat_datum IS NOT NULL
      AND COALESCE(om.followup_paused, 0) = 0
      AND COALESCE(om.dismissed_followup, 0) = 0
      AND COALESCE(om.followup_step, 0) < ?
    ORDER BY om.skickat_datum ASC
  `, [settings.max_steps]);

  const now = new Date();
  const due = [];

  for (const msg of candidates) {
    const currentStep = msg.followup_step || 0;
    const nextStep = currentStep + 1;

    if (nextStep > settings.max_steps) continue;

    const daysNeeded = stepDays[nextStep - 1] || 14;

    // Beräkna datum sedan senaste kontakt (originalt utskick eller senaste uppföljning)
    const lastContact = msg.last_followup_at || msg.skickat_datum;
    const lastContactDate = new Date(lastContact);
    const daysSinceLastContact = (now - lastContactDate) / (1000 * 60 * 60 * 24);

    if (daysSinceLastContact >= daysNeeded) {
      due.push({
        ...msg,
        nextStep,
        daysSinceLastContact: Math.floor(daysSinceLastContact),
        daysNeeded,
      });
    }
  }

  return due;
}

/**
 * Generera och (valfritt) skicka uppföljning för ett specifikt outreach-meddelande
 */
export async function processFollowup(outreachId, forceSend = false) {
  const settings = getSettings();

  const msg = await queryOne(`
    SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost,
           f.namn as foretag_namn
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    JOIN foretag f ON om.foretag_id = f.id
    WHERE om.id = ?
  `, [outreachId]);

  if (!msg) throw new Error('Outreach hittades inte');

  const nextStep = (msg.followup_step || 0) + 1;
  if (nextStep > settings.max_steps) throw new Error('Max antal uppföljningar nått');

  // Generera meddelande med AI
  const followUpText = await generateFollowUp(
    { namn: msg.influencer_namn, kanalnamn: msg.kanalnamn, plattform: msg.plattform },
    msg.meddelande,
    nextStep
  );

  const followUpSubject = await generateFollowUpSubject(msg.influencer_namn, nextStep);

  // Spara i uppfoljningar-tabellen
  const { lastId } = await runSql(`
    INSERT INTO uppfoljningar (outreach_id, influencer_id, meddelande, status)
    VALUES (?, ?, ?, ?)
  `, [msg.id, msg.influencer_id, followUpText, (settings.auto_send || forceSend) ? 'skickat' : 'vaentar']);

  // Logga i followup_log
  await runSql(`
    INSERT INTO followup_log (outreach_id, influencer_id, followup_nr, trigger_reason, meddelande, status, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `, [msg.id, msg.influencer_id, nextStep, `auto_step${nextStep}`, followUpText, 'pending']);

  // Skicka om auto_send är aktivt eller forceSend
  let sent = false;
  if ((settings.auto_send || forceSend) && msg.kontakt_epost) {
    try {
      await sendEmail({
        to: msg.kontakt_epost,
        subject: followUpSubject,
        body: followUpText,
      });
      sent = true;

      // Uppdatera uppföljningen som skickad
      await runSql('UPDATE uppfoljningar SET skickat_datum = datetime(\'now\'), status = \'skickat\' WHERE id = ?', [lastId]);
      await runSql('UPDATE followup_log SET status = \'sent\', sent_at = datetime(\'now\') WHERE outreach_id = ? AND followup_nr = ? ORDER BY id DESC LIMIT 1', [msg.id, nextStep]);
    } catch (err) {
      console.error(`[Followup] Kunde inte skicka till ${msg.kontakt_epost}:`, err.message);
    }
  }

  // Uppdatera outreach-meddelandet med nytt steg
  await runSql(`
    UPDATE outreach_meddelanden
    SET followup_step = ?, last_followup_at = datetime('now')
    WHERE id = ?
  `, [nextStep, msg.id]);

  saveDb();

  return {
    outreachId: msg.id,
    influencer: msg.influencer_namn,
    step: nextStep,
    message: followUpText,
    subject: followUpSubject,
    sent,
    email: msg.kontakt_epost,
  };
}

/**
 * Kör auto-uppföljning för alla som behöver det
 */
export async function runAutoFollowups() {
  const settings = getSettings();
  if (!settings.enabled) return { processed: 0, results: [] };

  const due = getDueFollowups();
  const results = [];

  for (const msg of due) {
    try {
      const result = await processFollowup(msg.id);
      results.push(result);
    } catch (err) {
      console.error(`[Followup] Fel för outreach ${msg.id}:`, err.message);
      results.push({ outreachId: msg.id, error: err.message });
    }
  }

  if (results.length > 0) {
    console.log(`[Followup] Processade ${results.length} uppföljningar`);
  }

  return { processed: results.length, results };
}

/**
 * Starta bakgrundsjobbet (legacy — behålls för bakåtkompatibilitet)
 * OpenClaw hanterar scheduling via cron → POST /api/followup-sequence/run
 */
export async function startScheduler() {
  console.log('[Followup] Scheduling hanteras av OpenClaw. Använd POST /api/followup-sequence/run för manuell körning.');
}

/**
 * Stoppa bakgrundsjobbet (no-op — OpenClaw hanterar scheduling)
 */
export async function stopScheduler() {
  console.log('[Followup] Scheduling hanteras av OpenClaw.');
}
