import path from 'node:path';
import fs from 'node:fs';
import { DATA_DIR, SUBDIRS } from './config.js';
import { loadAllRchb } from './parsers/rchb.js';
import { loadAllBuau } from './parsers/buau.js';
import { loadAllAgreements } from './parsers/agreements.js';
import { loadGz } from './parsers/gz.js';

class DataStore {
  constructor() {
    this.rchb = [];
    this.buau = [];
    this.agreements = [];
    this.contracts = [];
    this.payments = [];
    this.snapshots = { rchb: [], buau: [], agreements: [], gz: [] };
    this.objectsIndex = []; // уникальные «объекты» по сквозной кодировке
    this.loaded = false;
    this.loadStats = {};
  }

  load() {
    const t0 = Date.now();
    if (!fs.existsSync(DATA_DIR)) {
      console.warn(`[DATA] Папка с данными не найдена: ${DATA_DIR}`);
      this.loaded = true;
      return;
    }

    this.rchb       = loadAllRchb(path.join(DATA_DIR, SUBDIRS.rchb));
    this.buau       = loadAllBuau(path.join(DATA_DIR, SUBDIRS.buau));
    this.agreements = loadAllAgreements(path.join(DATA_DIR, SUBDIRS.agreements));
    const gz        = loadGz(path.join(DATA_DIR, SUBDIRS.gz));
    this.contracts  = gz.contracts;
    this.payments   = gz.payments;

    this.snapshots = {
      rchb: [...new Set(this.rchb.map(r => r.snapshot).filter(Boolean))].sort(),
      buau: [...new Set(this.buau.map(r => r.snapshot).filter(Boolean))].sort(),
      agreements: [...new Set(this.agreements.map(r => r.snapshot).filter(Boolean))].sort(),
      gz: [...new Set([
        ...this.contracts.map(r => r.snapshot),
        ...this.payments.map(r => r.snapshot),
      ].filter(Boolean))].sort(),
    };

    this.objectsIndex = this.#buildObjectIndex();

    this.loadStats = {
      rchb: this.rchb.length,
      buau: this.buau.length,
      agreements: this.agreements.length,
      contracts: this.contracts.length,
      payments: this.payments.length,
      objects: this.objectsIndex.length,
      durationMs: Date.now() - t0,
    };
    this.loaded = true;
    console.log('[DATA] Загружено:', this.loadStats);
  }

  // Объект = уникальная комбинация классификаторов с человекочитаемыми именами.
  #buildObjectIndex() {
    const map = new Map();
    const addRow = (r, sourceLabel) => {
      const key = [r.budget || '', r.kfsr || '', r.kcsr || '', r.kvr || ''].join('|');
      if (!key.replace(/\|/g, '').trim()) return;
      const existing = map.get(key);
      if (existing) {
        existing.sources.add(sourceLabel);
        if (!existing.kcsrName && r.kcsrName) existing.kcsrName = r.kcsrName;
        if (!existing.kfsrName && r.kfsrName) existing.kfsrName = r.kfsrName;
        if (!existing.kvrName && r.kvrName) existing.kvrName = r.kvrName;
      } else {
        map.set(key, {
          key,
          budget: r.budget || '',
          kfsr: r.kfsr || '',
          kfsrName: r.kfsrName || '',
          kcsr: r.kcsr || '',
          kcsrName: r.kcsrName || '',
          kvr: r.kvr || '',
          kvrName: r.kvrName || '',
          sources: new Set([sourceLabel]),
        });
      }
    };
    for (const r of this.rchb) addRow(r, 'РЧБ');
    for (const r of this.buau) addRow(r, 'БУАУ');
    for (const r of this.agreements) addRow(r, 'Соглашения');
    for (const r of this.contracts) addRow(r, 'Госзаказ');
    return [...map.values()].map(o => ({ ...o, sources: [...o.sources] }))
      .sort((a, b) => (a.budget || '').localeCompare(b.budget || '', 'ru')
        || a.kcsr.localeCompare(b.kcsr, 'ru'));
  }

  // Все строки данных в едином формате (для движка выборки).
  allRows() {
    return [
      ...this.rchb,
      ...this.buau,
      ...this.agreements,
      ...this.contracts,
      ...this.payments,
    ];
  }
}

export const store = new DataStore();
