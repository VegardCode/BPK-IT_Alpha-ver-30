import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { parseRuNumber, normCode, buauSnapshotFromFilename, fmtDate } from '../utils.js';

// Парсер БУАУ. UTF-8 BOM, разделитель ';'. Заголовок в первой строке.
// Колонки: Бюджет; Дата проводки; КФСР; КЦСР; КВР; КОСГУ; Код субсидии;
//          Отраслевой код; КВФО; Организация; Орган, предоставляющий субсидии;
//          Выплаты с учетом возврата; Выплаты - Исполнение; Выплаты - Восстановление выплат - год

function readUtf8(file) {
  let txt = fs.readFileSync(file, 'utf8');
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  return txt;
}

export function parseBuauFile(file) {
  const txt = readUtf8(file);
  const records = parse(txt, {
    delimiter: ';',
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  const snapshot = buauSnapshotFromFilename(path.basename(file, '.csv'));
  const rows = [];
  for (const r of records) {
    const budget = (r['Бюджет'] || '').trim();
    if (!budget) continue;
    if (/^итог/i.test(budget)) continue;

    rows.push({
      source: 'buau',
      snapshot: fmtDate(snapshot),
      budget,
      postingDate: (r['Дата проводки'] || '').trim(),
      kfsr: normCode(r['КФСР']),
      kcsr: normCode(r['КЦСР']),
      kvr: normCode(r['КВР']),
      kosgu: normCode(r['КОСГУ']),
      kvfo: normCode(r['КВФО']),
      subsidyCode: normCode(r['Код субсидии']),
      branchCode: normCode(r['Отраслевой код']),
      organization: (r['Организация'] || '').trim(),
      grantor: (r['Орган, предоставляющий субсидии'] || '').trim(),
      buau_payments: parseRuNumber(r['Выплаты с учетом возврата']),
      buau_executed: parseRuNumber(r['Выплаты - Исполнение']),
    });
  }
  return { snapshot, rows };
}

export function loadAllBuau(buauDir) {
  if (!fs.existsSync(buauDir)) return [];
  const files = fs.readdirSync(buauDir).filter(f => f.toLowerCase().endsWith('.csv'));
  const all = [];
  for (const f of files) {
    try {
      const { rows } = parseBuauFile(path.join(buauDir, f));
      all.push(...rows);
    } catch (e) {
      console.error(`[BUAU] Ошибка парсинга ${f}:`, e.message);
    }
  }
  return all;
}
