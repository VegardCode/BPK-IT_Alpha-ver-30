import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { parseRuNumber, normCode, rchbSnapshotFromFilename, fmtDate } from '../utils.js';

// Парсер РЧБ. Файлы — UTF-8 BOM, разделитель ';'. Первые ~10 строк — шапка отчёта.
// Колонки данных (после шапки):
//   Бюджет; Дата проводки; КФСР; Наим. КФСР; КЦСР; Наим. КЦСР; КВР; Наим. КВР;
//   КВСР; Наим. КВСР; КОСГУ; Наим. КОСГУ; Код цели; Наим. Код цели; КВФО;
//   Наим. КВФО; Источник средств; Лимиты ПБС 2025 год; Подтв. лимитов по БО 2025 год;
//   Подтв. лимитов без БО 2025 год; Остаток лимитов 2025 год; Всего выбытий (бух.уч.)

function readUtf8(file) {
  let txt = fs.readFileSync(file, 'utf8');
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  return txt;
}

function findHeaderLine(lines) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('Бюджет;') && l.includes('Дата проводки')) return i;
  }
  return -1;
}

export function parseRchbFile(file) {
  const txt = readUtf8(file);
  const lines = txt.split(/\r?\n/);
  const headerIdx = findHeaderLine(lines);
  if (headerIdx === -1) return { snapshot: null, rows: [] };

  const csvBlock = lines.slice(headerIdx).join('\n');
  const records = parse(csvBlock, {
    delimiter: ';',
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  const snapshot = rchbSnapshotFromFilename(path.basename(file, '.csv'));
  const rows = [];

  for (const r of records) {
    const budget = (r['Бюджет'] || '').trim();
    if (!budget) continue;
    if (/^итог/i.test(budget)) continue;

    rows.push({
      source: 'rchb',
      snapshot: fmtDate(snapshot),
      budget,
      postingDate: (r['Дата проводки'] || '').trim(),
      kfsr: normCode(r['КФСР']),
      kfsrName: (r['Наименование КФСР'] || '').trim(),
      kcsr: normCode(r['КЦСР']),
      kcsrName: (r['Наименование КЦСР'] || '').trim(),
      kvr: normCode(r['КВР']),
      kvrName: (r['Наименование КВР'] || '').trim(),
      kvsr: normCode(r['КВСР']),
      kvsrName: (r['Наименование КВСР'] || '').trim(),
      kosgu: normCode(r['КОСГУ']),
      kosguName: (r['Наименование КОСГУ'] || '').trim(),
      kvfo: normCode(r['КВФО']),
      kvfoName: (r['Наименование КВФО'] || '').trim(),
      // Числа-показатели:
      plan: parseRuNumber(r['Лимиты ПБС 2025 год']),
      bo: parseRuNumber(r['Подтв. лимитов по БО 2025 год']),
      limit_remainder: parseRuNumber(r['Остаток лимитов 2025 год']),
      cash: parseRuNumber(r['Всего выбытий (бух.уч.)']),
    });
  }
  return { snapshot, rows };
}

export function loadAllRchb(rchbDir) {
  if (!fs.existsSync(rchbDir)) return [];
  const files = fs.readdirSync(rchbDir).filter(f => f.toLowerCase().endsWith('.csv'));
  const all = [];
  for (const f of files) {
    try {
      const { rows } = parseRchbFile(path.join(rchbDir, f));
      all.push(...rows);
    } catch (e) {
      console.error(`[RCHB] Ошибка парсинга ${f}:`, e.message);
    }
  }
  return all;
}
