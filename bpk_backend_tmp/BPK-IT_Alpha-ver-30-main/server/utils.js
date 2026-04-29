// Парсинг локализованных чисел типа "1 234 567,89" -> 1234567.89
export function parseRuNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let s = String(value).trim();
  if (!s) return 0;
  // удаляем все пробелы и неразрывные пробелы
  s = s.replace(/[\s\u00A0]/g, '');
  // запятая -> точка
  s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Нормализация кода (обрезает пробелы, приводит к строке)
export function normCode(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// Безопасное чтение поля по нескольким возможным заголовкам
export function getField(row, names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && row[n] !== '') return row[n];
  }
  return '';
}

// Извлечение даты "снимка" (кумулятивного итога) из имени файла РЧБ.
// Имя файла "январь2025.csv" -> снимок на 01.02.2025 (нарастающим итогом за январь).
const RU_MONTH = {
  'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4, 'май': 5, 'июнь': 6,
  'июль': 7, 'август': 8, 'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12,
};

export function rchbSnapshotFromFilename(filename) {
  const m = filename.toLowerCase().match(/^([а-я]+)\s*(\d{4})/);
  if (!m) return null;
  const month = RU_MONTH[m[1]];
  const year = Number(m[2]);
  if (!month) return null;
  // снимок на 1-е число СЛЕДУЮЩЕГО месяца — нарастающий итог за месяц m
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
  return new Date(Date.UTC(nextYear, nextMonth - 1, 1));
}

export function buauSnapshotFromFilename(filename) {
  return rchbSnapshotFromFilename(filename.replace(/^хакатон\s+БУАУ\s+/i, ''));
}

// Извлечение даты снимка из файла соглашений: "на01012026.csv" -> 2026-01-01
export function agreementsSnapshotFromFilename(filename) {
  const m = filename.match(/на(\d{2})(\d{2})(\d{4})/i);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  // Файлы "01012025-01042026.csv" (период) -> используем правую дату как снимок
  const r = filename.match(/(\d{2})(\d{2})(\d{4})-(\d{2})(\d{2})(\d{4})/);
  if (r) return new Date(Date.UTC(Number(r[6]), Number(r[5]) - 1, Number(r[4])));
  return null;
}

export function fmtDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseISODateLoose(s) {
  if (!s) return null;
  const txt = String(s).trim();
  // 2025-03-07 00:00:00.000
  const m1 = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return new Date(Date.UTC(+m1[1], +m1[2] - 1, +m1[3]));
  // 01.02.2025
  const m2 = txt.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m2) return new Date(Date.UTC(+m2[3], +m2[2] - 1, +m2[1]));
  return null;
}
