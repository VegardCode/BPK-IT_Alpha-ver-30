import { Router } from 'express';
import { INDICATORS, CLASSIFIER_FIELDS } from '../config.js';
import { store } from '../dataStore.js';

const router = Router();

function sendApiError(res, status, code, error, details = '') {
  res.status(status).json({ code, error, details: String(details || '') });
}

router.get('/health', (req, res) => {
  res.json({ ok: true, loaded: store.loaded, stats: store.loadStats });
});

router.get('/indicators', (req, res) => {
  res.json({ indicators: INDICATORS, classifiers: CLASSIFIER_FIELDS });
});

router.get('/snapshots', (req, res) => {
  res.json(store.snapshots);
});

router.get('/objects', (req, res) => {
  try {
    const q = String(req.query.q || '').toLowerCase().trim().slice(0, 200);
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 5000);
    let items = store.objectsIndex;
    if (q) {
      items = items.filter(o => {
        const hay = [o.budget, o.kfsr, o.kfsrName, o.kcsr, o.kcsrName, o.kvr, o.kvrName].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    res.json({ total: items.length, items: items.slice(0, limit) });
  } catch (e) {
    sendApiError(res, 400, 'OBJECTS_LIST_FAILED', 'Не удалось получить список объектов', e?.message || 'Проверьте параметры q и limit');
  }
});

// Уникальные значения по классификатору (для выпадающих списков).
router.get('/dictionary/:field', (req, res) => {
  const field = req.params.field;
  const allowed = new Set(['budget', 'kfsr', 'kcsr', 'kvr', 'kosgu', 'kvfo', 'kvsr']);
  if (!allowed.has(field)) {
    return sendApiError(res, 400, 'DICTIONARY_FIELD_INVALID', 'Неизвестный справочник', `Допустимые поля: ${[...allowed].join(', ')}`);
  }

  const set = new Map();
  const addRow = r => {
    const code = r[field];
    if (!code) return;
    const nameField = field === 'budget' ? null : `${field}Name`;
    const name = nameField ? (r[nameField] || '') : code;
    if (!set.has(code)) set.set(code, { code, name });
    else if (name && !set.get(code).name) set.get(code).name = name;
  };
  for (const r of store.allRows()) addRow(r);
  const items = [...set.values()].sort((a, b) => String(a.code).localeCompare(String(b.code), 'ru'));
  res.json({ field, items });
});

export default router;
