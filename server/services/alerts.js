// ============================================================
// V9 Pipeline — Alerts (leverantörsagnostisk waterfall)
// ============================================================
// Routing:
//   1. PAGERDUTY_INTEGRATION_KEY satt → PagerDuty
//   2. SLACK_WEBHOOK_URL satt → Slack incoming-webhook
//   3. Annars → console.error
//
// Critical-severity skickar till BÅDA om båda är konfigurerade.

const PD_URL = 'https://events.pagerduty.com/v2/enqueue';

/**
 * @param {object} args
 * @param {'info'|'warning'|'critical'} args.severity
 * @param {string} args.summary - kort one-liner
 * @param {object} [args.details] - additional structured context
 * @param {string} [args.source] - origin (default: 'sparkcollab-v9')
 */
export async function notifyAlert({ severity = 'warning', summary, details = {}, source = 'sparkcollab-v9' }) {
  const pdKey = process.env.PAGERDUTY_INTEGRATION_KEY;
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  const tasks = [];

  if (pdKey) {
    tasks.push(sendPagerDuty({ pdKey, severity, summary, details, source }));
  }
  // Critical → båda; annars Slack endast om PD inte fanns
  if (slackUrl && (severity === 'critical' || !pdKey)) {
    tasks.push(sendSlack({ slackUrl, severity, summary, details, source }));
  }

  if (tasks.length === 0) {
    console.error(`[Alert][${severity}] ${summary}`, details);
    return { delivered: 'console' };
  }

  const results = await Promise.allSettled(tasks);
  return {
    delivered: results.map(r => r.status).join(','),
    errors: results.filter(r => r.status === 'rejected').map(r => r.reason?.message),
  };
}

async function sendPagerDuty({ pdKey, severity, summary, details, source }) {
  const body = {
    routing_key: pdKey,
    event_action: 'trigger',
    payload: {
      summary,
      source,
      severity,
      custom_details: details,
    },
  };
  const res = await fetch(PD_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PagerDuty ${res.status}`);
  return res.json();
}

async function sendSlack({ slackUrl, severity, summary, details, source }) {
  const emoji = severity === 'critical' ? ':rotating_light:' :
                severity === 'warning'  ? ':warning:' : ':information_source:';
  const body = {
    text: `${emoji} *[${severity.toUpperCase()}] ${source}* — ${summary}`,
    attachments: details && Object.keys(details).length ? [{
      color: severity === 'critical' ? 'danger' : severity === 'warning' ? 'warning' : 'good',
      text: '```' + JSON.stringify(details, null, 2) + '```',
    }] : undefined,
  };
  const res = await fetch(slackUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}`);
  return { ok: true };
}
