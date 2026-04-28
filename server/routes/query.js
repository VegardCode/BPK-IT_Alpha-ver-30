import { Router } from 'express';
import { runQuery, comparePeriods } from '../queryEngine.js';

const router = Router();

function readParams(body) {
  const indicators = Array.isArray(body.indicators) ? body.indicators : [];
  const filter = body.filter && typeof body.filter === 'object' ? body.filter : {};
  const from = body.from || '';
  const to = body.to || '';
  const mode = body.mode || 'aggregate';
  const strategy = body.strategy || 'sum';
  return { indicators, filter, from, to, mode, strategy };
}

router.post('/query', (req, res) => {
  try {
    const params = readParams(req.body || {});
    const result = runQuery(params);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/compare', (req, res) => {
  try {
    const body = req.body || {};
    const result = comparePeriods({
      indicators: body.indicators || [],
      filter: body.filter || {},
      periods: body.periods || [],
      strategy: body.strategy || 'latest',
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
