import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';

const router = Router();

router.get('/', (req, res) => {
  const rows = queryAll('SELECT * FROM foretag ORDER BY created_at DESC');
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = queryOne('SELECT * FROM foretag WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Företag hittades inte' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { namn, epost, kontaktperson, bransch } = req.body;
  if (!namn || !epost) return res.status(400).json({ error: 'Namn och e-post krävs' });

  const { lastId } = runSql(
    'INSERT INTO foretag (namn, epost, kontaktperson, bransch) VALUES (?, ?, ?, ?)',
    [namn, epost, kontaktperson || null, bransch || null]
  );
  const foretag = queryOne('SELECT * FROM foretag WHERE id = ?', [lastId]);
  res.status(201).json(foretag);
});

router.put('/:id', (req, res) => {
  const { namn, epost, kontaktperson, bransch } = req.body;
  runSql(
    'UPDATE foretag SET namn = ?, epost = ?, kontaktperson = ?, bransch = ? WHERE id = ?',
    [namn, epost, kontaktperson, bransch, Number(req.params.id)]
  );
  const foretag = queryOne('SELECT * FROM foretag WHERE id = ?', [Number(req.params.id)]);
  res.json(foretag);
});

export default router;
