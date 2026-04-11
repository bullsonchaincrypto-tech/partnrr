/**
 * Claude Managed Agents — Service
 *
 * Hanterar Agent/Environment/Session-livscykeln mot Anthropic API.
 * Ersätter OpenClaw-skills med molnbaserade agenter.
 */

const API_BASE = 'https://api.anthropic.com/v1';
const BETA_HEADER = 'managed-agents-2026-04-01';

function getApiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY saknas');
  return key;
}

async function apiRequest(method, path, body = null) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
      'content-type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => 'no body');
    throw new Error(`Managed Agents API ${res.status}: ${errBody}`);
  }

  return res.json();
}

// ============================================================
// AGENT CRUD
// ============================================================

/**
 * Skapa en ny agent-definition
 */
export async function createAgent({ name, system, model = 'claude-sonnet-4-6', tools = null }) {
  return apiRequest('POST', '/agents', {
    name,
    model,
    system,
    tools: tools || [{ type: 'agent_toolset_20260401' }],
  });
}

/**
 * Hämta en agent
 */
export async function getAgent(agentId) {
  return apiRequest('GET', `/agents/${agentId}`);
}

/**
 * Lista alla agenter
 */
export async function listAgents() {
  return apiRequest('GET', '/agents');
}

// ============================================================
// ENVIRONMENT CRUD
// ============================================================

/**
 * Skapa en environment (container-template)
 */
export async function createEnvironment({ name, networking = 'unrestricted' }) {
  return apiRequest('POST', '/environments', {
    name,
    config: {
      type: 'cloud',
      networking: { type: networking },
    },
  });
}

/**
 * Hämta en environment
 */
export async function getEnvironment(envId) {
  return apiRequest('GET', `/environments/${envId}`);
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

/**
 * Skapa en ny session (kör en agent i en environment)
 */
export async function createSession({ agentId, environmentId, title }) {
  return apiRequest('POST', '/sessions', {
    agent: agentId,
    environment_id: environmentId,
    title,
  });
}

/**
 * Hämta session-status
 */
export async function getSession(sessionId) {
  return apiRequest('GET', `/sessions/${sessionId}`);
}

/**
 * Skicka event till en session (t.ex. user message)
 */
export async function sendEvent(sessionId, message) {
  return apiRequest('POST', `/sessions/${sessionId}/events`, {
    events: [{
      type: 'user.message',
      content: [{ type: 'text', text: message }],
    }],
  });
}

/**
 * Streama events från en session (SSE)
 * Returnerar en ReadableStream
 */
export async function streamEvents(sessionId) {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/stream`, {
    headers: {
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
      'Accept': 'text/event-stream',
    },
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => 'no body');
    throw new Error(`Stream error ${res.status}: ${errBody}`);
  }

  return res.body;
}

/**
 * Kör en komplett agent-session: skicka meddelande och samla alla events
 * Returnerar { messages: [], result: string, toolsUsed: [] }
 */
export async function runAgentTask({ agentId, environmentId, title, message, timeoutMs = 300000 }) {
  // 1. Skapa session
  const session = await createSession({ agentId, environmentId, title });
  console.log(`[ManagedAgent] Session skapad: ${session.id}`);

  // 2. Öppna stream
  const streamRes = await fetch(`${API_BASE}/sessions/${session.id}/stream`, {
    headers: {
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
      'Accept': 'text/event-stream',
    },
  });

  // 3. Skicka meddelande
  await sendEvent(session.id, message);

  // 4. Samla events
  const messages = [];
  const toolsUsed = [];
  let result = '';

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const timeout = setTimeout(() => {
    reader.cancel();
  }, timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6);
        if (json === '[DONE]') continue;

        try {
          const event = JSON.parse(json);
          messages.push(event);

          switch (event.type) {
            case 'agent.message':
              if (event.content) {
                for (const block of event.content) {
                  if (block.type === 'text') result += block.text;
                }
              }
              break;
            case 'agent.tool_use':
              toolsUsed.push(event.name);
              break;
            case 'session.status_idle':
              clearTimeout(timeout);
              return { sessionId: session.id, messages, result, toolsUsed };
          }
        } catch (parseErr) {
          // Ignorera ogiltiga JSON-rader
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  return { sessionId: session.id, messages, result, toolsUsed };
}

// ============================================================
// PARTNRR-SPECIFIKA AGENTER (setup)
// ============================================================

const PARTNRR_AGENTS = {
  'auto-followup': {
    name: 'Partnrr Auto-Followup',
    system: `Du är en automationsagent för Partnrr Outreach CRM. Din uppgift är att hitta outreach-meddelanden som inte fått svar inom 5 dagar och generera personliga uppföljningar.

REGLER:
- Max 1 uppföljning per outreach
- Aldrig uppföljning om personen redan svarat
- Aldrig uppföljning till status "avböjt" eller "avtal_signerat"
- Max 10 uppföljningar per körning
- Uppföljningen ska vara på svenska, kort (max 100 ord), vänlig men inte desperat
- Alltid inkludera tydlig call-to-action

Backend API: ${process.env.CLIENT_URL || 'http://localhost:3001'}
Använd bash + curl för att anropa API:t.`,
  },

  'content-monitor': {
    name: 'Partnrr Content Monitor',
    system: `Du är en content-övervakningsagent för Partnrr. Du skannar YouTube-kanaler för influencers med aktiva avtal och analyserar publicerat content.

UPPGIFT:
1. Anropa POST http://localhost:3001/api/content/scan för att trigga scanning
2. Anropa GET http://localhost:3001/api/content/overview för att hämta översikt
3. Analysera CTA-kvalitet: Stark (tydlig CTA + referral), Medium (nämner + länk), Svag (kort omnämning), Ingen
4. Flagga influencers som inte publicerat inom 14 dagar
5. Returnera en strukturerad JSON-rapport

Svara ALLTID med JSON-format.`,
  },

  'contract-monitor': {
    name: 'Partnrr Contract Monitor',
    system: `Du är en avtalsövervakningsagent för Partnrr. Du hittar kontrakt som löper ut snart, redan utgångna, och osignerade.

UPPGIFT:
1. Anropa GET http://localhost:3001/api/contracts/reminders/due
2. För varje kategori (expiring_soon, expired, unsigned_stale), skicka påminnelser via POST /api/contracts/:id/send-reminder
3. Max 1 påminnelse per kontrakt per kategori
4. Max 10 påminnelser per körning
5. Returnera strukturerad JSON-rapport

Backend: http://localhost:3001`,
  },

  'gmail-inbox-monitor': {
    name: 'Partnrr Gmail Monitor',
    system: `Du är en inbox-övervakningsagent för Partnrr. Du kollar Gmail för svar på outreach-meddelanden.

UPPGIFT:
1. Kolla Gmail-status via GET http://localhost:3001/api/auth/google/status
2. Om ansluten: hämta meddelanden via GET /api/auth/google/inbox?maxResults=20&unreadOnly=true
3. Registrera varje meddelande via POST /api/automation/inbox
4. Analysera sentiment: positiv/neutral/negativ
5. Föreslå nästa åtgärd: boka_mote/skicka_kontrakt/svara_fraga/ingen_atgard
6. Returnera JSON-rapport

Backend: http://localhost:3001`,
  },

  'smart-email-finder': {
    name: 'Partnrr Email Finder',
    system: `Du är en e-postsökningsagent för Partnrr. Du söker aktivt efter kontaktinfo för influencers som saknar e-postadress.

UPPGIFT:
1. Hämta influencers utan e-post via GET http://localhost:3001/api/email-finder/missing
2. För varje influencer: sök webben efter deras e-post
3. Sökstrategi: YouTube "Om"-sida → sociala profiler → personlig webbsida → Google-sökning
4. Spara hittade e-poster via POST /api/email-finder/save
5. Max 10 influencers per körning
6. Returnera JSON med hittade e-poster och metod

Använd WebSearch och WebFetch för att söka. Var kreativ men respektera rate limits.
Backend: http://localhost:3001`,
  },
};

/**
 * Sätt upp alla Partnrr-agenter och en delad environment
 * Returnerar { agents: {}, environment: {} }
 */
export async function setupPartnrrAgents() {
  console.log('[ManagedAgent] Sätter upp Partnrr-agenter...');

  // Skapa environment
  const environment = await createEnvironment({ name: 'partnrr-automation' });
  console.log(`[ManagedAgent] Environment skapad: ${environment.id}`);

  // Skapa alla agenter
  const agents = {};
  for (const [key, config] of Object.entries(PARTNRR_AGENTS)) {
    const agent = await createAgent(config);
    agents[key] = { id: agent.id, version: agent.version };
    console.log(`[ManagedAgent] Agent "${key}" skapad: ${agent.id}`);
  }

  return { agents, environment: { id: environment.id } };
}

/**
 * Kör en specifik Partnrr-automation
 */
export async function runPartnrrTask(taskKey, agentId, environmentId, customMessage = null) {
  const defaults = {
    'auto-followup': 'Kör auto-uppföljning: hitta alla outreach utan svar efter 5 dagar, generera och logga uppföljningar. Returnera JSON-rapport.',
    'content-monitor': 'Kör content-scan: skanna YouTube-kanaler, analysera CTA-kvalitet, flagga försenade. Returnera JSON-rapport.',
    'contract-monitor': 'Kör avtalsbevakning: hitta utgående/utgångna/osignerade kontrakt, skicka påminnelser. Returnera JSON-rapport.',
    'gmail-inbox-monitor': 'Kör inbox-check: hämta nya Gmail-meddelanden, matcha mot outreach, analysera sentiment. Returnera JSON-rapport.',
    'smart-email-finder': 'Kör e-postsökning: hitta kontaktinfo för influencers som saknar e-post. Returnera JSON med resultat.',
  };

  const message = customMessage || defaults[taskKey] || 'Kör uppgiften och returnera en JSON-rapport.';

  return runAgentTask({
    agentId,
    environmentId,
    title: `Partnrr ${taskKey} — ${new Date().toISOString()}`,
    message,
  });
}
