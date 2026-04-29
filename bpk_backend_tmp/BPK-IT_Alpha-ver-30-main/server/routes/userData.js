import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { userDataStore } from '../userDataStore.js';

const router = Router();
const SESSION_COOKIE = 'udsid';
const MAX_ROWS = 200000;
const MAX_COLUMNS = 300;

function sendApiError(res, status, code, error, details = '') {
  res.status(status).json({ code, error, details: String(details || '') });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const allowedMime = new Set([
      'text/csv',
      'text/plain',
      'application/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
    ]);
    if ((ext === '.csv' || ext === '.xls' || ext === '.xlsx') && (!mime || allowedMime.has(mime))) {
      cb(null, true);
      return;
    }
    cb(new Error('Допустимы только файлы CSV, XLS или XLSX'));
  },
});

function parseCookies(cookieHeader = '') {
  const out = {};
  for (const part of String(cookieHeader).split(';')) {
    const [k, ...v] = part.split('=');
    const key = String(k || '').trim();
    if (!key) continue;
    const rawValue = v.join('=').trim();
    // Невалидный URL-encoding в cookie не должен ронять API.
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch {
      out[key] = rawValue;
    }
  }
  return out;
}

// Каждому клиенту выдаём отдельный session id через HttpOnly cookie.
// Это изолирует пользовательские загрузки друг от друга.
function ensureSession(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  let sid = String(cookies[SESSION_COOKIE] || '').trim();
  if (!sid) {
    sid = crypto.randomUUID();
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`);
  }
  return sid;
}

function normalizeRows(rows) {
  const normalized = [];
  const columnsSet = new Set();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const out = {};
    for (const [rawKey, rawVal] of Object.entries(row)) {
      const key = String(rawKey || '').trim();
      if (!key) continue;
      columnsSet.add(key);
      out[key] = rawVal ?? '';
    }
    if (Object.keys(out).length > 0) normalized.push(out);
  }

  // Дополнительные предохранители по размеру набора.
  const columns = [...columnsSet].slice(0, MAX_COLUMNS);
  const rowsLimited = normalized.slice(0, MAX_ROWS);
  return {
    columns,
    rows: rowsLimited.map(r => {
      const normalizedRow = {};
      for (const col of columns) normalizedRow[col] = r[col] ?? '';
      return normalizedRow;
    }),
  };
}

function parseCsvBuffer(buf) {
  const source = buf.toString('utf8');
  const lines = source.split(/\r?\n/);
  const delimiters = [';', ','];

  let best = {
    delimiter: ',',
    headerIndex: 0,
    score: -1,
  };

  for (const delimiter of delimiters) {
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      const line = String(lines[i] || '').trim();
      if (!line) continue;
      const cells = line.split(delimiter).map(x => String(x || '').trim());
      const columnsCount = cells.length;
      const nonEmptyCount = cells.filter(Boolean).length;
      if (columnsCount < 3) continue;
      if (nonEmptyCount < 3) continue;
      // Чем больше колонок, тем вероятнее это строка заголовка таблицы.
      const score = columnsCount + nonEmptyCount;
      if (score > best.score) {
        best = { delimiter, headerIndex: i, score };
      }
    }
  }

  const content = lines.slice(best.headerIndex).join('\n');
  return parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    delimiter: best.delimiter,
  });
}

function parseExcelBuffer(buf) {
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const firstSheetName = workbook.SheetNames?.[0];
  if (!firstSheetName) return [];
  const ws = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

function matchesFilter(value, filterValue, mode) {
  const hay = String(value ?? '').toLowerCase();
  const needle = String(filterValue ?? '').toLowerCase();
  if (!needle) return true;
  if (mode === 'equals') return hay === needle;
  if (mode === 'startsWith') return hay.startsWith(needle);
  return hay.includes(needle);
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? '')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .trim();
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function applyFilters(rows, columns, filters) {
  let out = rows;
  for (const f of filters) {
    const col = String(f?.column || '');
    const value = String(f?.value || '').slice(0, 300);
    const mode = String(f?.mode || 'contains');
    if (!col || !value || !columns.includes(col)) continue;
    out = out.filter(row => matchesFilter(row[col], value, mode));
  }
  return out;
}

function calcKpi(rows, aggregation, metricColumn) {
  if (aggregation === 'count') return rows.length;
  if (!metricColumn) return 0;
  const nums = rows
    .map(row => toNumber(row[metricColumn]))
    .filter(v => Number.isFinite(v));
  if (!nums.length) return 0;
  if (aggregation === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (aggregation === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (aggregation === 'min') return Math.min(...nums);
  if (aggregation === 'max') return Math.max(...nums);
  return rows.length;
}

// Универсальный расчет виджета Dashboard на стороне сервера:
// фронт передает только конфиг, а API возвращает готовые данные для отображения.
function buildDashboardWidget(widget, rows, columns, defaultLimit = 7) {
  const id = String(widget?.id || '').trim();
  const title = String(widget?.title || '').trim().slice(0, 140) || 'Виджет';
  const type = String(widget?.type || 'kpi');
  const aggregation = String(widget?.aggregation || 'count');
  const metricColumn = String(widget?.metricColumn || '');
  const groupBy = String(widget?.groupBy || '');
  const baseLimit = Math.min(Math.max(Number(defaultLimit) || 7, 1), 25);
  const limit = Math.min(Math.max(Number(widget?.limit) || baseLimit, 1), 25);

  const localFilters = Array.isArray(widget?.filters) ? widget.filters.slice(0, 20) : [];
  const scopedRows = applyFilters(rows, columns, localFilters);

  if (type === 'top-list') {
    if (!groupBy || !columns.includes(groupBy)) {
      return {
        id,
        title,
        type,
        error: 'Для виджета top-list нужно указать колонку группировки',
      };
    }

    const map = new Map();
    for (const row of scopedRows) {
      const key = String(row[groupBy] ?? '').trim() || '(пусто)';
      if (!map.has(key)) map.set(key, { label: key, count: 0, sum: 0 });
      const bucket = map.get(key);
      bucket.count += 1;
      if (metricColumn && columns.includes(metricColumn)) {
        bucket.sum += toNumber(row[metricColumn]) || 0;
      }
    }

    const sortBy = metricColumn && columns.includes(metricColumn) ? 'sum' : 'count';
    const items = [...map.values()]
      .sort((a, b) => Number(b[sortBy] || 0) - Number(a[sortBy] || 0))
      .slice(0, limit)
      .map(item => ({
        label: item.label,
        value: sortBy === 'sum' ? item.sum : item.count,
      }));

    return {
      id,
      title,
      type,
      groupBy,
      metricColumn: metricColumn && columns.includes(metricColumn) ? metricColumn : '',
      totalRows: scopedRows.length,
      items,
    };
  }

  if (type === 'table') {
    const visibleColumns = Array.isArray(widget?.columns)
      ? widget.columns.map(c => String(c || '')).filter(c => columns.includes(c)).slice(0, 8)
      : [];
    const outputColumns = visibleColumns.length ? visibleColumns : columns.slice(0, 6);
    return {
      id,
      title,
      type,
      columns: outputColumns,
      rows: scopedRows.slice(0, limit).map(r => {
        const out = {};
        for (const col of outputColumns) out[col] = r[col] ?? '';
        return out;
      }),
      totalRows: scopedRows.length,
    };
  }

  if (aggregation !== 'count' && (!metricColumn || !columns.includes(metricColumn))) {
    return {
      id,
      title,
      type: 'kpi',
      error: 'Для агрегатора sum/avg/min/max нужна числовая колонка',
    };
  }

  const value = calcKpi(scopedRows, aggregation, metricColumn);
  return {
    id,
    title,
    type: 'kpi',
    aggregation,
    metricColumn: metricColumn && columns.includes(metricColumn) ? metricColumn : '',
    totalRows: scopedRows.length,
    value,
  };
}

router.post('/user-data/upload', upload.single('file'), (req, res) => {
  try {
    const sessionId = ensureSession(req, res);
    if (!req.file) return sendApiError(res, 400, 'USER_FILE_MISSING', 'Файл не загружен', 'Передайте файл в поле form-data "file"');
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    let rows = [];
    if (ext === '.csv') rows = parseCsvBuffer(req.file.buffer);
    else rows = parseExcelBuffer(req.file.buffer);

    const normalized = normalizeRows(rows);
    if (normalized.rows.length === 0) {
      return sendApiError(res, 400, 'USER_FILE_EMPTY', 'Файл пустой или не содержит табличных данных', 'Проверьте, что в файле есть заголовки и строки данных');
    }

    userDataStore.setData(sessionId, {
      fileName: req.file.originalname,
      columns: normalized.columns,
      rows: normalized.rows,
    });

    const meta = userDataStore.getMeta(sessionId);
    res.json({
      ok: true,
      fileName: meta.fileName,
      rowCount: meta.rowCount,
      columns: meta.columns,
      loadedAt: meta.loadedAt,
    });
  } catch (e) {
    sendApiError(res, 400, 'USER_FILE_UPLOAD_FAILED', 'Не удалось обработать загруженный файл', e?.message || 'Проверьте формат CSV/XLS/XLSX');
  }
});

router.get('/user-data/meta', (req, res) => {
  try {
    const sessionId = ensureSession(req, res);
    res.json(userDataStore.getMeta(sessionId));
  } catch (e) {
    sendApiError(res, 400, 'USER_META_FAILED', 'Не удалось получить метаданные файла', e?.message || '');
  }
});

router.post('/user-data/query', (req, res) => {
  try {
    const sessionId = ensureSession(req, res);
    if (!userDataStore.hasData(sessionId)) {
      return sendApiError(res, 400, 'USER_DATA_NOT_LOADED', 'Сначала загрузите файл', 'Сначала вызовите /api/user-data/upload');
    }
    const body = req.body || {};
    const filters = Array.isArray(body.filters) ? body.filters.slice(0, 50) : [];
    const q = String(body.q || '').trim().toLowerCase().slice(0, 300);
    const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 1000);
    const offset = Math.max(Number(body.offset) || 0, 0);

    const columns = userDataStore.getColumns(sessionId);
    let rows = userDataStore.getRows(sessionId);

    if (q) {
      rows = rows.filter(row =>
        columns.some(col => String(row[col] ?? '').toLowerCase().includes(q))
      );
    }

    rows = applyFilters(rows, columns, filters);

    const total = rows.length;
    const page = rows.slice(offset, offset + limit);

    return res.json({
      columns,
      total,
      offset,
      limit,
      rows: page,
    });
  } catch (e) {
    return sendApiError(res, 400, 'USER_QUERY_FAILED', 'Ошибка обработки запроса к файлу', e?.message || 'Проверьте filters/q/limit/offset');
  }
});

router.post('/user-data/dashboard', (req, res) => {
  try {
    const sessionId = ensureSession(req, res);
    if (!userDataStore.hasData(sessionId)) {
      return sendApiError(res, 400, 'USER_DATA_NOT_LOADED', 'Сначала загрузите файл', 'Сначала вызовите /api/user-data/upload');
    }

    const body = req.body || {};
    const widgets = Array.isArray(body.widgets) ? body.widgets.slice(0, 60) : [];
    const filters = Array.isArray(body.filters) ? body.filters.slice(0, 50) : [];
    const q = String(body.q || '').trim().toLowerCase().slice(0, 300);
    const columns = userDataStore.getColumns(sessionId);
    let rows = userDataStore.getRows(sessionId);

    if (q) {
      rows = rows.filter(row =>
        columns.some(col => String(row[col] ?? '').toLowerCase().includes(q))
      );
    }
    rows = applyFilters(rows, columns, filters);

    // Глобальный лимит можно переопределить в конкретном виджете.
    const defaultLimit = Math.min(Math.max(Number(body.defaultLimit) || 7, 1), 25);
    const computedWidgets = widgets.map(w => buildDashboardWidget(w, rows, columns, defaultLimit));
    res.json({
      generatedAt: new Date().toISOString(),
      totalRows: rows.length,
      columns,
      widgets: computedWidgets,
    });
  } catch (e) {
    sendApiError(res, 400, 'USER_DASHBOARD_FAILED', 'Ошибка построения Dashboard', e?.message || 'Проверьте конфигурацию виджетов');
  }
});

router.delete('/user-data', (req, res) => {
  try {
    const sessionId = ensureSession(req, res);
    userDataStore.clear(sessionId);
    res.json({ ok: true });
  } catch (e) {
    sendApiError(res, 400, 'USER_DATA_CLEAR_FAILED', 'Не удалось очистить загруженные данные', e?.message || '');
  }
});

export default router;
