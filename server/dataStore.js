import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { DATA_DIR, SUBDIRS } from './config.js';
import { loadAllRchb } from './parsers/rchb.js';
import { loadAllBuau } from './parsers/buau.js';
import { loadAllAgreements } from './parsers/agreements.js';
import { loadGz } from './parsers/gz.js';

class DataStore extends EventEmitter {
  constructor() {
    super();
    this.rchb = [];
    this.buau = [];
    this.agreements = [];
    this.contracts = [];
    this.payments = [];
    this.snapshots = { rchb: [], buau: [], agreements: [], gz: [] };
    this.objectsIndex = []; // уникальные «объекты» по сквозной кодировке
    this.loaded = false;
    this.loadStats = {};
    this.version = 0;
    this.updatedAt = null;
    this.fileSignature = '';
    this.refreshTimer = null;
    this.watchHandle = null;
    this.watchDebounce = null;
    this.loading = false;
  }

  load({ reason = 'manual', emitUpdate = false } = {}) {
    if (this.loading) return false;
    this.loading = true;
    const t0 = Date.now();
    try {
      if (!fs.existsSync(DATA_DIR)) {
        console.warn(`[DATA] Папка с данными не найдена: ${DATA_DIR}`);
        this.loaded = true;
        this.fileSignature = '';
        this.updatedAt = new Date().toISOString();
        this.version += 1;
        return true;
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
      this.version += 1;
      this.updatedAt = new Date().toISOString();
      this.fileSignature = this.#buildFileSignature();
      const payload = this.#updatePayload(reason);
      console.log('[DATA] Загружено:', this.loadStats);
      if (emitUpdate) this.emit('updated', payload);
      return true;
    } finally {
      this.loading = false;
    }
  }

  startRealtimeRefresh({ intervalMs = 5000 } = {}) {
    if (this.refreshTimer) return;
    this.fileSignature = this.#buildFileSignature();

    this.refreshTimer = setInterval(() => {
      this.refreshIfChanged('poll');
    }, intervalMs);
    this.refreshTimer.unref?.();

    try {
      this.watchHandle = fs.watch(DATA_DIR, { recursive: true }, () => {
        this.#scheduleRefresh('watch');
      });
      this.watchHandle.unref?.();
      console.log(`[DATA] Realtime monitor enabled: ${DATA_DIR}`);
    } catch (e) {
      console.warn(`[DATA] fs.watch недоступен, используется polling: ${e.message}`);
    }
  }

  refreshIfChanged(reason = 'manual') {
    if (!fs.existsSync(DATA_DIR)) return false;
    const nextSignature = this.#buildFileSignature();
    if (nextSignature === this.fileSignature) return false;
    console.log(`[DATA] Обнаружены изменения (${reason}), перезагрузка...`);
    return this.load({ reason, emitUpdate: true });
  }

  #scheduleRefresh(reason) {
    clearTimeout(this.watchDebounce);
    this.watchDebounce = setTimeout(() => {
      this.refreshIfChanged(reason);
    }, 400);
    this.watchDebounce.unref?.();
  }

  #updatePayload(reason) {
    return {
      reason,
      version: this.version,
      updatedAt: this.updatedAt,
      stats: this.loadStats,
      snapshots: this.snapshots,
    };
  }

  #buildFileSignature() {
    const files = [];
    const visit = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(fullPath);
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (!['.csv', '.xlsx', '.xls'].includes(ext)) continue;
        const st = fs.statSync(fullPath);
        files.push(`${path.relative(DATA_DIR, fullPath)}:${st.size}:${Math.floor(st.mtimeMs)}`);
      }
    };
    visit(DATA_DIR);
    return files.sort().join('|');
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
