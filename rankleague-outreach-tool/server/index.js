import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb } from './db/schema.js';
import foretagRoutes from './routes/foretag.js';
import influencerRoutes from './routes/influencers.js';
import outreachRoutes from './routes/outreach.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import sponsorRoutes from './routes/sponsors.js';
import trackingRoutes from './routes/tracking.js';
import exportRoutes from './routes/export.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`RankLeague server kors pa http://localhost:${PORT}`);
  });
}

start().catch(console.error);
