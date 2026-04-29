import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { parseRuNumber, normCode, agreementsSnapshotFromFilename, fmtDate, parseISODateLoose } from '../utils.js';

// Парсер Соглашений. UTF-8, разделитель ',', строки в кавычках.
// Колонки: period_of_date, documentclass_id, budget_id, caption, document_id,
//          close_date, reg_number, main_close_date, main_reg_number, amount_1year,
//          dd_estimate_caption, dd_recipient_caption, kadmr_code, kfsr_code, kcsr_code,
//          kvr_code, dd_purposefulgrant_code, kesr_code, kdr_code, kde_code, kdf_code,
//          dd_grantinvestment_code

export function parseAgreementsFile(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const records = parse(txt, {
    delimiter: ',',
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
  });

  const snapshot = agreementsSnapshotFromFilename(path.basename(file, '.csv'));
  const rows = [];
  for (const r of records) {
    rows.push({
      source: 'agreements',
      snapshot: fmtDate(snapshot),
      budget: (r['caption'] || '').trim(),
      documentClassId: normCode(r['documentclass_id']),
      budgetId: normCode(r['budget_id']),
      documentId: normCode(r['document_id']),
      closeDate: fmtDate(parseISODateLoose(r['close_date'])),
      regNumber: normCode(r['reg_number']),
      mainCloseDate: fmtDate(parseISODateLoose(r['main_close_date'])),
      mainRegNumber: normCode(r['main_reg_number']),
      kadmr: normCode(r['kadmr_code']),
      kfsr: normCode(r['kfsr_code']),
      kcsr: normCode(r['kcsr_code']),
      kvr: normCode(r['kvr_code']),
      purposefulgrant: normCode(r['dd_purposefulgrant_code']),
      kesr: normCode(r['kesr_code']),
      kosgu: normCode(r['kesr_code']), // КОСГУ ~ kesr_code (для сопоставления с РЧБ)
      kdr: normCode(r['kdr_code']),
      kde: normCode(r['kde_code']),
      kdf: normCode(r['kdf_code']),
      grantInvestment: normCode(r['dd_grantinvestment_code']),
      agreements: parseRuNumber(r['amount_1year']),
    });
  }
  return { snapshot, rows };
}

export function loadAllAgreements(agreementsDir) {
  if (!fs.existsSync(agreementsDir)) return [];
  const files = fs.readdirSync(agreementsDir).filter(f => f.toLowerCase().endsWith('.csv'));
  const all = [];
  for (const f of files) {
    try {
      const { rows } = parseAgreementsFile(path.join(agreementsDir, f));
      all.push(...rows);
    } catch (e) {
      console.error(`[AGREEMENTS] Ошибка парсинга ${f}:`, e.message);
    }
  }
  return all;
}
