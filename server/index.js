import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env'), override: true });
import express from 'express';
import cors from 'cors';
import { initDb } from './db/schema.js';
import foretagRoutes from './routes/foretag.js';
import influencerRoutes, { seedEmailCache } from './routes/influencers.js';
import outreachRoutes from './routes/outreach.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import sponsorRoutes from './routes/sponsors.js';
import trackingRoutes from './routes/tracking.js';
import exportRoutes from './routes/export.js';
import automationRoutes from './routes/automation.js';
import contentRoutes from './routes/content.js';
import contractRoutes from './routes/contracts.js';
import invoiceRoutes from './routes/invoices.js';
import analyticsRoutes from './routes/analytics.js';
import emailFinderRoutes from './routes/email-finder.js';
import intakterRoutes from './routes/intakter.js';
import followupSequenceRoutes from './routes/followup-sequence.js';
import abTestingRoutes from './routes/ab-testing.js';
import kampanjRoutes from './routes/kampanjer.js';
import signingRoutes from './routes/signing.js';
import teamRoutes from './routes/team.js';
import searchRoutes from './routes/search.js';
import agentRoutes from './routes/agents.js';
import chatRoutes from './routes/chat.js';
import gmailWatcherRoutes from './routes/gmail-watcher.js';
import blacklistRoutes from './routes/blacklist.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';
import testStatusRoutes from './routes/test-status.js';
import { startScheduler as startFollowupScheduler, getSettings as getFollowupSettings } from './services/followup-scheduler.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(',').map(s => s.trim())
    : 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

app.use('/api/foretag', foretagRoutes);
app.use('/api/influencers', influencerRoutes);
app.use('/api/outreach', outreachRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sponsors', sponsorRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/email-finder', emailFinderRoutes);
app.use('/api/intakter', intakterRoutes);
app.use('/api/followup-sequence', followupSequenceRoutes);
app.use('/api/ab-tests', abTestingRoutes);
app.use('/api/kampanjer', kampanjRoutes);
app.use('/api/sign', signingRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/gmail-watcher', gmailWatcherRoutes);
app.use('/api/blacklist', blacklistRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/test', testStatusRoutes);


// Unikt ID per serverstart — klienten jämför för att rensa sessionStorage vid omstart
const SERVER_BOOT_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), bootId: SERVER_BOOT_ID });
});

// Global error sanitizer — se till att interna API-detaljer aldrig når klienten
app.use((err, req, res, _next) => {
  console.error('[Server] Ohanterat fel:', err);
  const msg = err.message || '';
  // Sanitera bort allt som ser ut som intern API-data
  const isSensitive = /anthropic|org-|sk-ant|api-key|request.id|claude-/i.test(msg);
  res.status(err.status || 500).json({
    error: isSensitive
      ? 'Ett internt fel uppstod. Försök igen om en stund.'
      : msg || 'Ett oväntat fel uppstod.',
  });
});

async function start() {
  await initDb();
  seedEmailCache();

  // Starta auto-uppföljning om den är aktiverad
  try {
    const followupSettings = getFollowupSettings();
    if (followupSettings.enabled) {
      startFollowupScheduler();
    }
  } catch (e) {
    console.log('[Followup] Kunde inte starta scheduler:', e.message);
  }

  app.listen(PORT, () => {
    console.log(`RankLeague server kors pa http://localhost:${PORT}`);
  });
}

start().catch(console.error);
