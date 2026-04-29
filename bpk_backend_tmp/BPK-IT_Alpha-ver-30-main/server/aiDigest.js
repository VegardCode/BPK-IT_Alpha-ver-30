/** Сжатое представление выборки для промпта GigaChat (объём ограничен). */

function roundRub(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function fmtRub(n) {
  const x = roundRub(n);
  if (Math.abs(x) >= 1e9) return `${(x / 1e9).toFixed(2)} млрд руб.`;
  if (Math.abs(x) >= 1e6) return `${(x / 1e6).toFixed(2)} млн руб.`;
  if (Math.abs(x) >= 1e3) return `${(x / 1e3).toFixed(1)} тыс. руб.`;
  return `${x} руб.`;
}

/** @param result Результат runQuery из queryEngine.js */
export function buildQueryDigest(result) {
  const { meta, indicators, totals, rows } = result;
  const indList = indicators.map(i => `${i.label} (${i.id})`).join(', ');
  const filt = meta?.filter || {};
  const filtLines = [];
  if (filt.budget) filtLines.push(`Бюджет: ${filt.budget}`);
  if (filt.q) filtLines.push(`Поиск: ${filt.q}`);
  if (filt.kfsr) filtLines.push(`КФСР: ${filt.kfsr}`);
  if (filt.kcsr) filtLines.push(`КЦСР: ${filt.kcsr}`);
  if (filt.kvr) filtLines.push(`КВР: ${filt.kvr}`);

  const totalLines = indicators.map(i => `- ${i.label}: ${fmtRub(totals[i.id] || 0)}`);

  const headInd = indicators[0]?.id;
  const sorted = [...(rows || [])];
  if (headInd) {
    sorted.sort((a, b) => (b.values?.[headInd] || 0) - (a.values?.[headInd] || 0));
  }
  const top = sorted.slice(0, 15).map((r, idx) => {
    const parts = [
      `${idx + 1}. ${r.budget || '—'}`,
      `КФСР ${r.kfsr || '—'}, КЦСР ${r.kcsr || '—'}, КВР ${r.kvr || '—'}`,
      r.kcsrName ? `«${String(r.kcsrName).slice(0, 80)}»` : '',
    ];
    const vals = indicators.map(i => `${i.label}: ${fmtRub(r.values?.[i.id] || 0)}`).join('; ');
    return [...parts, vals].filter(Boolean).join(' · ');
  });

  return [
    'Тип отчёта: единая выборка по объектам бюджетной классификации.',
    `Период: с ${meta?.from || '—'} по ${meta?.to || '—'}.`,
    `Режим: ${meta?.mode || '—'}, стратегия: ${meta?.strategy || '—'}.`,
    `Показатели: ${indList}.`,
    filtLines.length ? `Фильтры:\n${filtLines.join('\n')}` : 'Фильтры: не заданы (все доступные объекты в пределах периода).',
    `Итого по выборке (${result.rows?.length || 0} строк агрегирования):\n${totalLines.join('\n')}`,
    'Крупнейшие объекты (по первому показателю в запросе):',
    top.join('\n'),
  ].join('\n');
}

/** @param result Результат comparePeriods из queryEngine.js */
export function buildCompareDigest(result) {
  const { periods, indicators, rows } = result;
  const indList = indicators.map(i => `${i.label}`).join(', ');
  const plines = (periods || []).map((p, i) => `Период ${i + 1} (${p.label || 'без подписи'}): ${p.from} — ${p.to}`);

  const headInd = indicators[0]?.id;
  const sorted = [...(rows || [])];
  if (headInd) {
    sorted.sort((a, b) => Math.abs(b.delta?.[headInd]?.abs || 0) - Math.abs(a.delta?.[headInd]?.abs || 0));
  }
  const top = sorted.slice(0, 15).map((r, idx) => {
    const d = indicators.map(i => {
      const x = r.delta?.[i.id];
      if (!x) return `${i.label}: Δ —`;
      const pct = x.pct === null || x.pct === undefined ? 'n/a' : `${x.pct.toFixed(1)}%`;
      return `${i.label}: Δ ${fmtRub(x.abs)} (${pct})`;
    }).join('; ');
    return `${idx + 1}. ${r.budget || '—'} · КЦСР ${r.kcsr || '—'} · ${d}`;
  });

  return [
    'Тип отчёта: сравнение двух периодов по одним и тем же объектам.',
    plines.join('\n'),
    `Показатели: ${indList}.`,
    `Строк в сравнении: ${rows?.length || 0}.`,
    'Наибольшие изменения (по модулю Δ первого показателя):',
    top.join('\n'),
  ].join('\n');
}
