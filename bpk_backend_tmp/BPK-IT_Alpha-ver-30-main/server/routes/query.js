import { Router } from 'express';
import { runQuery, comparePeriods } from '../queryEngine.js';

const router = Router();

// Единый формат текста ошибки для API-ответов.
function errorText(e, fallback = 'Ошибка запроса') {
  const msg = e?.message || String(e || '');
  return String(msg || fallback);
}

function sendApiError(res, status, code, error, details = '') {
  res.status(status).json({ code, error, details: String(details || '') });
}

function safeText(v, max = 200) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

// Нормализация фильтра: ограничиваем длины строк и размер массивов.
function readFilter(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  return {
    budget: safeText(f.budget, 200),
    kfsr: safeText(f.kfsr, 60),
    kcsr: safeText(f.kcsr, 60),
    kvr: safeText(f.kvr, 60),
    kosgu: safeText(f.kosgu, 60),
    kvfo: safeText(f.kvfo, 60),
    kvsr: safeText(f.kvsr, 60),
    q: safeText(f.q, 300),
    objectKeys: Array.isArray(f.objectKeys)
      ? f.objectKeys.map(x => safeText(x, 200)).filter(Boolean).slice(0, 500)
      : [],
  };
}

function readParams(body) {
  // Защита от слишком больших payload: режем массивы/строки до разумных лимитов.
  const indicators = Array.isArray(body.indicators)
    ? body.indicators.map(x => safeText(x, 40)).filter(Boolean).slice(0, 50)
    : [];
  const filter = readFilter(body.filter);
  const from = safeText(body.from, 20);
  const to = safeText(body.to, 20);
  const mode = body.mode === 'timeseries' ? 'timeseries' : 'aggregate';
  const strategy = body.strategy === 'latest' ? 'latest' : 'sum';
  return { indicators, filter, from, to, mode, strategy };
}

router.post('/query', (req, res) => {
  try {
    const params = readParams(req.body || {});
    const result = runQuery(params);
    res.json(result);
  } catch (e) {
    sendApiError(res, 400, 'QUERY_FAILED', 'Не удалось выполнить выборку', errorText(e, 'Некорректные параметры выборки'));
  }
});

router.post('/compare', (req, res) => {
  try {
    const body = req.body || {};
    const result = comparePeriods({
      indicators: Array.isArray(body.indicators)
        ? body.indicators.map(x => safeText(x, 40)).filter(Boolean).slice(0, 50)
        : [],
      filter: readFilter(body.filter),
      periods: Array.isArray(body.periods)
        ? body.periods.slice(0, 5).map(p => ({
            from: safeText(p?.from, 20),
            to: safeText(p?.to, 20),
            label: safeText(p?.label, 100),
          }))
        : [],
      strategy: body.strategy === 'sum' ? 'sum' : 'latest',
    });
    res.json(result);
  } catch (e) {
    sendApiError(res, 400, 'COMPARE_FAILED', 'Не удалось выполнить сравнение периодов', errorText(e, 'Проверьте периоды и фильтры'));
  }
});

export default router;
