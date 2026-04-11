import { Router } from 'express';
import { getAuthUrl, handleCallback, getStoredTokens } from '../services/gmail.js';
import { runSql } from '../db/schema.js';

const router = Router();

router.get('/status', (req, res) => {
  const tokens = getStoredTokens();
  res.json({ authenticated: !!tokens, email: tokens?.email || null });
});

router.get('/google', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Ingen kod mottagen');
    await handleCallback(code);
    res.redirect(`${process.env.CLIENT_URL || 'http://localhost:5173'}?auth=success`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.CLIENT_URL || 'http://localhost:5173'}?auth=error`);
  }
});

router.post('/disconnect', (req, res) => {
  runSql('DELETE FROM gmail_tokens WHERE id = 1');
  res.json({ success: true });
});

export default router;
