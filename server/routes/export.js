import { Router } from 'express';
import ExcelJS from 'exceljs';
import { runQuery, comparePeriods } from '../queryEngine.js';

const router = Router();

function fmtNum(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
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

    const buf = await wb.xlsx.writeBuffer();
    const filename = `vyborka_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(400).json({ error: e.message });
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

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="compare_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
