import { INDICATORS } from './config.js';
import { store } from './dataStore.js';

const INDICATOR_BY_ID = Object.fromEntries(INDICATORS.map(i => [i.id, i]));

function passDateFilter(row, fromISO, toISO) {
  if (!fromISO && !toISO) return true;
  const s = row.snapshot;
  if (!s) return false;
  if (fromISO && s < fromISO) return false;
  if (toISO && s > toISO) return false;
  return true;
}

function matchString(value, query) {
  if (!query) return true;
  if (!value) return false;
  return String(value).toLowerCase().includes(String(query).toLowerCase());
}

function asArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(x => String(x));
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

function passObjectFilter(row, filt) {
  if (!filt) return true;
  const objectKeys = asArray(filt.objectKeys);
  if (objectKeys.length > 0) {
    const rowKey = [row.budget || '', row.kfsr || '', row.kcsr || '', row.kvr || ''].join('|');
    if (!objectKeys.includes(rowKey)) return false;
  }
  if (filt.budget && !matchString(row.budget, filt.budget)) return false;
  if (filt.kfsr && row.kfsr !== filt.kfsr) return false;
  if (filt.kcsr && row.kcsr !== filt.kcsr) return false;
  if (filt.kvr && row.kvr !== filt.kvr) return false;
  if (filt.kosgu && row.kosgu !== filt.kosgu) return false;
  if (filt.kvfo && row.kvfo !== filt.kvfo) return false;
  if (filt.kvsr && row.kvsr !== filt.kvsr) return false;
  if (filt.q) {
    const hay = [row.budget, row.kcsrName, row.kfsrName, row.kvrName, row.organization].join(' ').toLowerCase();
    if (!hay.includes(String(filt.q).toLowerCase())) return false;
  }
  return true;
}

// Группировка строк по «объекту» и снимку.
// keyMode: 'object' | 'object+snapshot'
function aggregate(rows, indicators, keyMode = 'object') {
  const out = new Map();
  for (const r of rows) {
    const objKey = [r.budget || '', r.kfsr || '', r.kcsr || '', r.kvr || ''].join('|');
    const key = keyMode === 'object' ? objKey : `${objKey}::${r.snapshot || ''}`;
    let entry = out.get(key);
    if (!entry) {
      entry = {
        budget: r.budget || '',
        kfsr: r.kfsr || '',
        kfsrName: r.kfsrName || '',
        kcsr: r.kcsr || '',
        kcsrName: r.kcsrName || '',
        kvr: r.kvr || '',
        kvrName: r.kvrName || '',
        snapshot: keyMode === 'object+snapshot' ? r.snapshot || '' : '',
        sources: new Set(),
        values: Object.fromEntries(indicators.map(id => [id, 0])),
      };
      out.set(key, entry);
    }
    entry.sources.add(r.source);
    for (const id of indicators) {
      if (typeof r[id] === 'number') {
        entry.values[id] += r[id];
      }
    }
  }
  return [...out.values()].map(e => ({ ...e, sources: [...e.sources] }));
}

// Берём «последний» снимок ≤ to (или максимальный, если не задан).
// Используется для метрик типа «остаток на дату» (РЧБ нарастающий итог).
function pickLatestPerObject(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = [r.budget || '', r.kfsr || '', r.kcsr || '', r.kvr || ''].join('|');
    const cur = map.get(key);
    if (!cur || (r.snapshot || '') > (cur.snapshot || '')) map.set(key, r);
  }
  return [...map.values()];
}

function getRowsForIndicator(indId) {
  const ind = INDICATOR_BY_ID[indId];
  if (!ind) return [];
  switch (ind.source) {
    case 'rchb': return store.rchb;
    case 'buau': return store.buau;
    case 'agreements': return store.agreements;
    case 'gz':
      if (indId === 'contracts') return store.contracts;
      if (indId === 'payments') return store.payments;
      return [];
    default: return [];
  }
}

// Основная функция выборки.
// params:
//   indicators: string[] — id показателей
//   filter:     {budget, kfsr, kcsr, kvr, kosgu, kvfo, kvsr, q}
//   from, to:   ISO даты ('YYYY-MM-DD')
//   mode:       'aggregate' (по умолчанию) | 'timeseries' (по снимкам)
//   strategy:   'sum' (по умолчанию) | 'latest' — для нарастающего итога РЧБ.
export function runQuery({ indicators = [], filter = {}, from = '', to = '', mode = 'aggregate', strategy = 'sum' } = {}) {
  if (!Array.isArray(indicators) || indicators.length === 0) {
    indicators = INDICATORS.map(i => i.id);
  }
  const validIndicators = indicators.filter(id => INDICATOR_BY_ID[id]);

  // Собираем строки по каждому индикатору отдельно (т.к. источники разные).
  const collected = [];
  for (const id of validIndicators) {
    let rows = getRowsForIndicator(id);
    rows = rows.filter(r => passDateFilter(r, from, to) && passObjectFilter(r, filter));

    // Стратегия 'latest' для РЧБ-показателей (нарастающий итог)
    if (strategy === 'latest' && (id === 'plan' || id === 'bo' || id === 'limit_remainder' || id === 'cash')) {
      rows = pickLatestPerObject(rows);
    }
    // Размечаем строки только тем индикатором, который их «содержит» (числовое поле уже есть).
    collected.push(...rows.map(r => ({ ...r, _indicator: id })));
  }

  const aggregated = aggregate(collected, validIndicators, mode === 'timeseries' ? 'object+snapshot' : 'object');

  // Сортировка: по убыванию суммы первого индикатора.
  if (validIndicators.length > 0) {
    const head = validIndicators[0];
    aggregated.sort((a, b) => (b.values[head] || 0) - (a.values[head] || 0));
  }

  // Тоталы:
  const totals = Object.fromEntries(validIndicators.map(id => [id, 0]));
  for (const e of aggregated) for (const id of validIndicators) totals[id] += e.values[id] || 0;

  return {
    indicators: validIndicators.map(id => INDICATOR_BY_ID[id]),
    rows: aggregated,
    totals,
    meta: {
      mode, strategy, from, to,
      filter,
      objectCount: aggregated.length,
    },
  };
}

// Сравнение периодов: возвращает строку на объект, где values содержит периоды A/B и delta.
export function comparePeriods({ indicators = [], filter = {}, periods = [], strategy = 'latest' } = {}) {
  if (!Array.isArray(indicators) || indicators.length === 0) indicators = INDICATORS.map(i => i.id);
  if (!Array.isArray(periods) || periods.length < 2) {
    throw new Error('Нужно указать минимум 2 периода для сравнения');
  }

  const perPeriod = periods.map(p => runQuery({
    indicators, filter, from: p.from, to: p.to, mode: 'aggregate', strategy,
  }));

  const allKeys = new Map();
  perPeriod.forEach((res, idx) => {
    for (const r of res.rows) {
      const key = [r.budget, r.kfsr, r.kcsr, r.kvr].join('|');
      let entry = allKeys.get(key);
      if (!entry) {
        entry = {
          budget: r.budget, kfsr: r.kfsr, kfsrName: r.kfsrName,
          kcsr: r.kcsr, kcsrName: r.kcsrName, kvr: r.kvr, kvrName: r.kvrName,
          periods: periods.map(() => Object.fromEntries(indicators.map(id => [id, 0]))),
          sources: new Set(),
        };
        allKeys.set(key, entry);
      }
      for (const id of indicators) entry.periods[idx][id] = r.values[id] || 0;
      for (const s of r.sources) entry.sources.add(s);
    }
  });

  const rows = [...allKeys.values()].map(e => {
    const delta = {};
    for (const id of indicators) {
      const a = e.periods[0][id] || 0;
      const b = e.periods[1][id] || 0;
      delta[id] = { abs: b - a, pct: a !== 0 ? ((b - a) / a) * 100 : null };
    }
    return { ...e, sources: [...e.sources], delta };
  });

  return {
    indicators: indicators.map(id => INDICATOR_BY_ID[id]).filter(Boolean),
    periods,
    rows,
  };
}
