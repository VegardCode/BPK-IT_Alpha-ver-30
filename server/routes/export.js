import { Router } from 'express';
import ExcelJS from 'exceljs';
import { runQuery, comparePeriods } from '../queryEngine.js';

const router = Router();

function errorText(e, fallback = 'Ошибка экспорта') {
  const msg = e?.message || String(e || '');
  return String(msg || fallback);
}

function sendApiError(res, status, code, error, details = '') {
  res.status(status).json({ code, error, details: String(details || '') });
}

function fmtNum(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function getPngBytesFromDataUrl(maybeDataUrl) {
  const s = String(maybeDataUrl || '');
  const m = s.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  // Ограничиваем размер картинки, чтобы не раздувать файл экспорта.
  if (m[1].length > 8_000_000) return null;
  return Buffer.from(m[1], 'base64');
}

function toSafeSheetName(input, fallback) {
  const raw = String(input || '').trim() || fallback;
  const cleaned = raw.replace(/[\[\]\:\*\?\/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || fallback).slice(0, 31);
}

function normalizeChartImages(body) {
  const out = [];
  if (Array.isArray(body.chartImages)) {
    for (const item of body.chartImages.slice(0, 12)) {
      const title = String(item?.title || '').trim();
      const imageBase64 = String(item?.imageBase64 || '');
      if (!imageBase64) continue;
      out.push({ title, imageBase64 });
    }
  }
  if (out.length === 0 && body.chartImageBase64) {
    out.push({ title: 'Текущий график', imageBase64: body.chartImageBase64 });
  }
  return out;
}

function addChartWorksheet(workbook, title, chartImageDataUrl, idx = 1) {
  const png = getPngBytesFromDataUrl(chartImageDataUrl);
  if (!png) return false;
  const ws = workbook.addWorksheet(toSafeSheetName(title, `Диаграмма ${idx}`));
  ws.columns = [{ header: 'Диаграмма', key: 'x', width: 4 }];
  ws.getRow(1).font = { bold: true };
  const imageId = workbook.addImage({ buffer: png, extension: 'png' });
  ws.addImage(imageId, {
    tl: { col: 0, row: 1 },
    ext: { width: 1200, height: 620 },
  });
  return true;
}

function addChartWorksheets(workbook, body) {
  const images = normalizeChartImages(body);
  let idx = 1;
  for (const img of images) {
    const ok = addChartWorksheet(workbook, img.title, img.imageBase64, idx);
    if (ok) idx += 1;
  }
}

router.post('/export/xlsx', async (req, res) => {
  try {
    const body = req.body || {};
    const result = runQuery({
      indicators: body.indicators || [],
      filter: body.filter || {},
      from: body.from || '',
      to: body.to || '',
      mode: body.mode || 'aggregate',
      strategy: body.strategy || 'sum',
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Конструктор аналитических выборок';
    wb.created = new Date();

    const ws = wb.addWorksheet('Выборка');
    const baseCols = [
      { header: 'Бюджет', key: 'budget', width: 38 },
      { header: 'КФСР', key: 'kfsr', width: 8 },
      { header: 'Наименование КФСР', key: 'kfsrName', width: 38 },
      { header: 'КЦСР', key: 'kcsr', width: 14 },
      { header: 'Наименование КЦСР', key: 'kcsrName', width: 50 },
      { header: 'КВР', key: 'kvr', width: 8 },
      { header: 'Наименование КВР', key: 'kvrName', width: 38 },
    ];
    if (body.mode === 'timeseries') baseCols.push({ header: 'Снимок', key: 'snapshot', width: 12 });
    const indCols = result.indicators.map(i => ({ header: i.label, key: `v_${i.id}`, width: 20, style: { numFmt: '#,##0.00' } }));
    ws.columns = [...baseCols, ...indCols, { header: 'Источники', key: 'sources', width: 22 }];

    for (const r of result.rows) {
      const row = {
        budget: r.budget,
        kfsr: r.kfsr,
        kfsrName: r.kfsrName,
        kcsr: r.kcsr,
        kcsrName: r.kcsrName,
        kvr: r.kvr,
        kvrName: r.kvrName,
        snapshot: r.snapshot || '',
        sources: (r.sources || []).join(', '),
      };
      for (const ind of result.indicators) row[`v_${ind.id}`] = fmtNum(r.values[ind.id]);
      ws.addRow(row);
    }

    // Итоговая строка
    const totalRow = { budget: 'ИТОГО' };
    for (const ind of result.indicators) totalRow[`v_${ind.id}`] = fmtNum(result.totals[ind.id] || 0);
    const tr = ws.addRow(totalRow);
    tr.font = { bold: true };

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    // Лист с метаданными запроса
    const meta = wb.addWorksheet('Параметры');
    meta.columns = [
      { header: 'Параметр', key: 'k', width: 30 },
      { header: 'Значение', key: 'v', width: 60 },
    ];
    meta.addRow({ k: 'Период (с)', v: body.from || '—' });
    meta.addRow({ k: 'Период (по)', v: body.to || '—' });
    meta.addRow({ k: 'Режим', v: body.mode || 'aggregate' });
    meta.addRow({ k: 'Стратегия', v: body.strategy || 'sum' });
    meta.addRow({ k: 'Показатели', v: result.indicators.map(i => i.label).join('; ') });
    const f = body.filter || {};
    meta.addRow({ k: 'Фильтр.Бюджет', v: f.budget || '—' });
    meta.addRow({ k: 'Фильтр.КФСР', v: f.kfsr || '—' });
    meta.addRow({ k: 'Фильтр.КЦСР', v: f.kcsr || '—' });
    meta.addRow({ k: 'Фильтр.КВР', v: f.kvr || '—' });
    meta.addRow({ k: 'Фильтр.поиск', v: f.q || '—' });
    meta.addRow({ k: 'Дата выгрузки', v: new Date().toISOString() });
    meta.getRow(1).font = { bold: true };
    addChartWorksheets(wb, body);

    const buf = await wb.xlsx.writeBuffer();
    const filename = `vyborka_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    sendApiError(res, 400, 'EXPORT_QUERY_XLSX_FAILED', 'Ошибка экспорта выборки в Excel', errorText(e, 'Проверьте параметры выборки'));
  }
});

router.post('/export/compare-xlsx', async (req, res) => {
  try {
    const body = req.body || {};
    const result = comparePeriods({
      indicators: body.indicators || [],
      filter: body.filter || {},
      periods: body.periods || [],
      strategy: body.strategy || 'latest',
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Сравнение');

    const cols = [
      { header: 'Бюджет', key: 'budget', width: 38 },
      { header: 'КФСР', key: 'kfsr', width: 8 },
      { header: 'КЦСР', key: 'kcsr', width: 14 },
      { header: 'Наименование КЦСР', key: 'kcsrName', width: 50 },
      { header: 'КВР', key: 'kvr', width: 8 },
    ];
    for (let pi = 0; pi < result.periods.length; pi++) {
      const p = result.periods[pi];
      for (const ind of result.indicators) {
        cols.push({ header: `${ind.label}\n[${p.label || `${p.from} – ${p.to}`}]`, key: `p${pi}_${ind.id}`, width: 22, style: { numFmt: '#,##0.00' } });
      }
    }
    for (const ind of result.indicators) {
      cols.push({ header: `Δ ${ind.label} (абс.)`, key: `d_${ind.id}_abs`, width: 22, style: { numFmt: '#,##0.00' } });
      cols.push({ header: `Δ ${ind.label} (%)`, key: `d_${ind.id}_pct`, width: 14, style: { numFmt: '0.00' } });
    }
    ws.columns = cols;

    for (const r of result.rows) {
      const row = { budget: r.budget, kfsr: r.kfsr, kcsr: r.kcsr, kcsrName: r.kcsrName, kvr: r.kvr };
      r.periods.forEach((p, pi) => { for (const ind of result.indicators) row[`p${pi}_${ind.id}`] = fmtNum(p[ind.id]); });
      for (const ind of result.indicators) {
        row[`d_${ind.id}_abs`] = fmtNum(r.delta[ind.id].abs);
        row[`d_${ind.id}_pct`] = r.delta[ind.id].pct === null ? '' : fmtNum(r.delta[ind.id].pct);
      }
      ws.addRow(row);
    }
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    addChartWorksheets(wb, body);

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="compare_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    sendApiError(res, 400, 'EXPORT_COMPARE_XLSX_FAILED', 'Ошибка экспорта сравнения в Excel', errorText(e, 'Проверьте параметры сравнения'));
  }
});

export default router;
