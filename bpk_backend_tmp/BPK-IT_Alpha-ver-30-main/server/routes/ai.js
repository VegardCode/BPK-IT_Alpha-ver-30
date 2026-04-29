import { Router } from 'express';
import { runQuery, comparePeriods } from '../queryEngine.js';
import { summarizeDigest, isGigaChatConfigured, normalizeVoiceCommandText } from '../gigachatClient.js';
import { buildQueryDigest, buildCompareDigest } from '../aiDigest.js';
import { store } from '../dataStore.js';

const router = Router();

function errorText(e, fallback = 'Ошибка AI-запроса') {
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

// Для AI-эндпоинта используем ту же идею валидации, чтобы не передавать "грязный" или чрезмерный input.
function safeFilter(raw) {
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

function safeIndicators(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => safeText(x, 40)).filter(Boolean).slice(0, 50);
}

function objectSearchText(o) {
  return [
    o.budget, o.kfsr, o.kfsrName, o.kcsr, o.kcsrName, o.kvr, o.kvrName, o.key,
  ].map(v => String(v || '').toLowerCase()).join(' ');
}

function scoreObjectByQuery(o, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 12);
  if (!tokens.length) return 0;
  const hay = objectSearchText(o);

  let score = 0;
  const codes = [String(o.kcsr || '').toLowerCase(), String(o.kvr || '').toLowerCase(), String(o.kfsr || '').toLowerCase()];
  const names = [String(o.kcsrName || '').toLowerCase(), String(o.kvrName || '').toLowerCase(), String(o.kfsrName || '').toLowerCase()];
  const budget = String(o.budget || '').toLowerCase();

  for (const t of tokens) {
    if (!hay.includes(t)) continue;
    score += 10;
    if (codes.some(c => c === t)) score += 120;
    if (codes.some(c => c.startsWith(t))) score += 55;
    if (codes.some(c => c.includes(t))) score += 28;
    if (names.some(n => n.startsWith(t))) score += 24;
    if (names.some(n => n.includes(t))) score += 14;
    if (budget.includes(t)) score += 8;
  }
  return score;
}

function findBestObjectByText(query) {
  const list = Array.isArray(store.objectsIndex) ? store.objectsIndex : [];
  if (!list.length) return { best: null, confidence: 0 };
  const ranked = list.map(o => ({ o, score: scoreObjectByQuery(o, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return { best: null, confidence: 0 };

  const top = ranked[0];
  const second = ranked[1];
  let confidence = 65;
  if (!second) confidence = 92;
  else {
    const delta = top.score - second.score;
    confidence = Math.max(55, Math.min(95, Math.round(60 + (delta / Math.max(1, top.score)) * 70)));
  }

  return {
    best: top.o,
    confidence,
  };
}

router.get('/ai/status', (req, res) => {
  res.json({
    configured: isGigaChatConfigured(),
    hint: isGigaChatConfigured()
      ? null
      : 'Задайте GIGACHAT_CREDENTIALS в .env или в переменных окружения',
  });
});

/** POST /api/ai/summary — краткая ИИ-сводка по текущей выборке или сравнению */
router.post('/ai/summary', async (req, res) => {
  try {
    const body = req.body || {};
    const kind = body.kind === 'compare' ? 'compare' : 'query';

    let digest;
    if (kind === 'compare') {
      const periods = Array.isArray(body.periods) ? body.periods : [];
      if (periods.length < 2) {
        return sendApiError(res, 400, 'AI_COMPARE_PERIODS_REQUIRED', 'Для AI-сравнения нужно минимум 2 периода', `Передано периодов: ${periods.length}`);
      }
      const result = comparePeriods({
        indicators: safeIndicators(body.indicators),
        filter: safeFilter(body.filter),
        periods: periods.slice(0, 5).map(p => ({
          from: safeText(p?.from, 20),
          to: safeText(p?.to, 20),
          label: safeText(p?.label, 100),
        })),
        strategy: body.strategy === 'sum' ? 'sum' : 'latest',
      });
      digest = buildCompareDigest(result);
    } else {
      const result = runQuery({
        indicators: safeIndicators(body.indicators),
        filter: safeFilter(body.filter),
        from: safeText(body.from, 20),
        to: safeText(body.to, 20),
        mode: body.mode === 'timeseries' ? 'timeseries' : 'aggregate',
        strategy: body.strategy === 'latest' ? 'latest' : 'sum',
      });
      digest = buildQueryDigest(result);
    }

    // Ограничиваем размер контекста для LLM, чтобы не провоцировать долгие/тяжелые запросы.
    if (digest.length > 45000) digest = digest.slice(0, 45000);
    const summary = await summarizeDigest(digest);
    res.json({ summary, kind });
  } catch (e) {
    const msg = errorText(e, 'Ошибка формирования AI-сводки');
    const code = msg.includes('не настроен') ? 503 : 400;
    sendApiError(res, code, code === 503 ? 'AI_NOT_CONFIGURED' : 'AI_SUMMARY_FAILED', code === 503 ? 'AI сервис не настроен' : 'Не удалось сформировать AI-сводку', msg);
  }
});

/**
 * POST /api/ai/voice-object
 * 1) Нормализует текст голосовой команды через GigaChat.
 * 2) Находит максимально похожий объект выборки по справочнику объектов.
 */
router.post('/ai/voice-object', async (req, res) => {
  try {
    const body = req.body || {};
    const text = safeText(body.text, 260);
    const enableObjectMatch = body.enableObjectMatch !== false;
    if (!text) {
      return sendApiError(res, 400, 'VOICE_TEXT_EMPTY', 'Пустая голосовая команда', 'Передайте поле text');
    }

    const source = text;
    const normalizedOut = await normalizeVoiceCommandText(source);
    const normalized = safeText(normalizedOut.normalized || source, 260) || source;
    const changed = Boolean(normalizedOut.changed) && normalized !== source;

    let bestObject = null;
    let confidence = 0;
    if (enableObjectMatch) {
      const hit = findBestObjectByText(normalized);
      bestObject = hit.best ? {
        key: hit.best.key,
        budget: hit.best.budget,
        kfsr: hit.best.kfsr,
        kfsrName: hit.best.kfsrName,
        kcsr: hit.best.kcsr,
        kcsrName: hit.best.kcsrName,
        kvr: hit.best.kvr,
        kvrName: hit.best.kvrName,
      } : null;
      confidence = hit.confidence || 0;
    }

    res.json({
      source,
      normalized,
      changed,
      bestObject,
      confidence,
    });
  } catch (e) {
    const msg = errorText(e, 'Ошибка обработки голосовой команды');
    const status = msg.includes('не настроен') ? 503 : 400;
    sendApiError(
      res,
      status,
      status === 503 ? 'VOICE_AI_NOT_CONFIGURED' : 'VOICE_PROCESS_FAILED',
      status === 503 ? 'AI для обработки голоса не настроен' : 'Не удалось обработать голосовую команду',
      msg,
    );
  }
});

export default router;
