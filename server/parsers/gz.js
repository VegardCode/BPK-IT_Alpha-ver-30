import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { parseRuNumber, normCode, fmtDate, parseISODateLoose } from '../utils.js';

// Парсер ГЗ — три связанные таблицы (по con_document_id):
//   Бюджетные строки.csv:  con_document_id, kfsr_code, kcsr_code, kvr_code, kesr_code,
//                          kvsr_code, kdf_code, kde_code, kdr_code, kif_code, purposefulgrant
//   Контракты и договора.csv: con_document_id, con_number, con_date, con_amount, zakazchik_key
//   Платежки.csv:          con_document_id, platezhka_paydate, platezhka_key,
//                          platezhka_num, platezhka_amount

function readCsv(file, opts = {}) {
  const txt = fs.readFileSync(file, 'utf8');
  return parse(txt, {
    delimiter: ',',
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
    ...opts,
  });
}

export function loadGz(gzDir) {
  if (!fs.existsSync(gzDir)) return { contracts: [], payments: [] };

  const linesFile = path.join(gzDir, 'Бюджетные строки.csv');
  const contractsFile = path.join(gzDir, 'Контракты и договора.csv');
  const paymentsFile = path.join(gzDir, 'Платежки.csv');

  // Бюджетные строки -> Map<con_document_id, classifier>
  const classifiers = new Map();
  if (fs.existsSync(linesFile)) {
    for (const r of readCsv(linesFile)) {
      const id = normCode(r['con_document_id']);
      if (!id) continue;
      // Если уже есть запись — оставляем первую (или агрегируем) — у одного контракта
      // может быть несколько бюджетных строк. Сохраняем все строки в массив.
      const arr = classifiers.get(id) || [];
      arr.push({
        kfsr: normCode(r['kfsr_code']),
        kcsr: normCode(r['kcsr_code']),
        kvr: normCode(r['kvr_code']),
        kosgu: normCode(r['kesr_code']),
        kvsr: normCode(r['kvsr_code']),
        kdf: normCode(r['kdf_code']),
        kde: normCode(r['kde_code']),
        kdr: normCode(r['kdr_code']),
        kif: normCode(r['kif_code']),
        purposefulgrant: normCode(r['purposefulgrant']),
      });
      classifiers.set(id, arr);
    }
  }

  function pickClassifier(id) {
    const arr = classifiers.get(id);
    if (!arr || !arr.length) return {};
    return arr[0]; // для MVP берём первую строку классификации
  }

  const contracts = [];
  if (fs.existsSync(contractsFile)) {
    for (const r of readCsv(contractsFile)) {
      const id = normCode(r['con_document_id']);
      const cls = pickClassifier(id);
      contracts.push({
        source: 'gz',
        kind: 'contract',
        documentId: id,
        snapshot: fmtDate(parseISODateLoose(r['con_date'])),
        contractNumber: normCode(r['con_number']),
        contractDate: fmtDate(parseISODateLoose(r['con_date'])),
        zakazchikKey: normCode(r['zakazchik_key']),
        kfsr: cls.kfsr || '',
        kcsr: cls.kcsr || '',
        kvr: cls.kvr || '',
        kosgu: cls.kosgu || '',
        kvsr: cls.kvsr || '',
        kvfo: cls.kif || '',
        kdr: cls.kdr || '',
        kde: cls.kde || '',
        kdf: cls.kdf || '',
        purposefulgrant: cls.purposefulgrant || '',
        budget: '',
        contracts: parseRuNumber(r['con_amount']),
      });
    }
  }

  const payments = [];
  if (fs.existsSync(paymentsFile)) {
    for (const r of readCsv(paymentsFile)) {
      const id = normCode(r['con_document_id']);
      const cls = pickClassifier(id);
      payments.push({
        source: 'gz',
        kind: 'payment',
        documentId: id,
        snapshot: fmtDate(parseISODateLoose(r['platezhka_paydate'])),
        paymentKey: normCode(r['platezhka_key']),
        paymentNum: normCode(r['platezhka_num']),
        paymentDate: fmtDate(parseISODateLoose(r['platezhka_paydate'])),
        kfsr: cls.kfsr || '',
        kcsr: cls.kcsr || '',
        kvr: cls.kvr || '',
        kosgu: cls.kosgu || '',
        kvsr: cls.kvsr || '',
        kvfo: cls.kif || '',
        kdr: cls.kdr || '',
        kde: cls.kde || '',
        kdf: cls.kdf || '',
        purposefulgrant: cls.purposefulgrant || '',
        budget: '',
        payments: parseRuNumber(r['platezhka_amount']),
      });
    }
  }

  return { contracts, payments };
}
