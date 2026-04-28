const { createApp, ref, computed, reactive, onMounted, watch, nextTick } = Vue;

const fmtMoney = (n) => {
  if (!Number.isFinite(n)) return '0,00';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const [intPart, fracPart = '00'] = abs.toFixed(2).split('.');
  const intWithSpaces = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${intWithSpaces},${fracPart.padEnd(2, '0')}`;
};

const fmtPct = (n) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
};

async function api(path, body) {
  const res = await fetch('/api' + path, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function downloadXlsx(path, body, filename) {
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Ошибка экспорта');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

const App = {
  template: `
    <div class="min-h-screen flex flex-col">
      <header class="bg-white border-b border-slate-200">
        <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold">АО</div>
            <div>
              <div class="font-semibold text-slate-900 leading-tight">Конструктор аналитических выборок</div>
              <div class="text-xs text-slate-500">Бюджетный процесс · Минфин Амурской области · MVP</div>
            </div>
          </div>
          <div class="flex items-center gap-4 text-sm">
            <div v-if="health.loaded" class="text-slate-500">
              Загружено:
              <span class="font-medium text-slate-800">{{ health.stats.objects }}</span> объектов,
              <span class="font-medium text-slate-800">{{ totalRows }}</span> строк
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full" :class="health.ok ? 'bg-emerald-500' : 'bg-red-500'"></span>
              <span class="text-slate-600 text-xs">{{ health.ok ? 'API онлайн' : 'API недоступен' }}</span>
            </div>
          </div>
        </div>
        <nav class="max-w-7xl mx-auto px-6 flex gap-1 border-t border-slate-100">
          <button v-for="t in tabs" :key="t.id"
                  class="px-4 py-2.5 text-sm font-medium border-b-2 transition"
                  :class="activeTab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'"
                  @click="activeTab = t.id">
            {{ t.label }}
          </button>
        </nav>
      </header>

      <main class="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        <component :is="currentTabComponent" />
      </main>

      <footer class="border-t border-slate-200 bg-white">
        <div class="max-w-7xl mx-auto px-6 py-3 text-xs text-slate-500 flex items-center justify-between">
          <div>Источник: РЧБ · Соглашения · ГЗ · БУАУ · Сквозная кодировка КФСР/КЦСР/КВР</div>
          <div>Node.js + Express · Vue 3 · Chart.js · ExcelJS</div>
        </div>
      </footer>
    </div>
  `,
  setup() {
    const health = reactive({ ok: false, loaded: false, stats: {} });
    const activeTab = ref('selector');
    const tabs = [
      { id: 'selector', label: 'Конструктор выборок' },
      { id: 'compare',  label: 'Сравнение периодов' },
      { id: 'about',    label: 'Об инструменте' },
    ];
    const totalRows = computed(() =>
      (health.stats.rchb || 0) + (health.stats.buau || 0) + (health.stats.agreements || 0) + (health.stats.contracts || 0) + (health.stats.payments || 0)
    );

    async function refreshHealth() {
      try {
        const h = await api('/health');
        Object.assign(health, h);
      } catch (e) { health.ok = false; }
    }
    onMounted(refreshHealth);

    const currentTabComponent = computed(() => {
      switch (activeTab.value) {
        case 'compare': return CompareTab;
        case 'about':   return AboutTab;
        default:        return SelectorTab;
      }
    });

    return { health, activeTab, tabs, currentTabComponent, totalRows };
  },
};

// ---------- Компонент: Конструктор выборок ----------
const SelectorTab = {
  template: `
    <div class="grid grid-cols-12 gap-6">
      <!-- Левая колонка: фильтры -->
      <aside class="col-span-12 lg:col-span-4 xl:col-span-3 space-y-4">
        <div class="bg-white rounded-xl shadow-card p-5">
          <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M16 10a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            Объект выборки
          </h3>
          <input v-model="filter.q" type="text" placeholder="Поиск: бюджет, наименование КЦСР, программа..." class="input mb-3" />

          <div class="space-y-2">
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide">Бюджет</label>
            <select v-model="filter.budget" class="input">
              <option value="">— Все бюджеты —</option>
              <option v-for="b in dictionaries.budget" :key="b.code" :value="b.code">{{ b.code }}</option>
            </select>

            <div class="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide">КФСР</label>
                <select v-model="filter.kfsr" class="input">
                  <option value="">— все —</option>
                  <option v-for="b in dictionaries.kfsr" :key="b.code" :value="b.code">{{ b.code }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide">КВР</label>
                <select v-model="filter.kvr" class="input">
                  <option value="">— все —</option>
                  <option v-for="b in dictionaries.kvr" :key="b.code" :value="b.code">{{ b.code }}</option>
                </select>
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mt-2">КЦСР (целевая статья)</label>
              <select v-model="filter.kcsr" class="input">
                <option value="">— все —</option>
                <option v-for="b in dictionaries.kcsr" :key="b.code" :value="b.code">{{ b.code }}</option>
              </select>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-xl shadow-card p-5">
          <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V9m4 8V5m4 12v-7M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
            Показатели
          </h3>
          <div class="flex flex-wrap gap-2">
            <button v-for="ind in indicators" :key="ind.id"
                    class="indicator-pill"
                    :class="{ active: selectedIndicators.includes(ind.id) }"
                    @click="toggleIndicator(ind.id)">
              <span class="badge bg-slate-100 text-slate-600">{{ ind.group }}</span>
              {{ ind.label }}
            </button>
          </div>
        </div>

        <div class="bg-white rounded-xl shadow-card p-5">
          <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            Период
          </h3>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide">с</label>
              <input v-model="from" type="date" class="input" />
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide">по</label>
              <input v-model="to" type="date" class="input" />
            </div>
          </div>
          <div class="flex flex-wrap gap-1 mt-2 text-xs">
            <button v-for="p in periodPresets" :key="p.label" class="badge bg-slate-100 hover:bg-brand-100 text-slate-700 cursor-pointer" @click="applyPreset(p)">
              {{ p.label }}
            </button>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide">Стратегия</label>
              <select v-model="strategy" class="input">
                <option value="latest">Последний снимок (нарастающий)</option>
                <option value="sum">Сумма за период</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide">Режим</label>
              <select v-model="mode" class="input">
                <option value="aggregate">Агрегировать</option>
                <option value="timeseries">По снимкам</option>
              </select>
            </div>
          </div>
        </div>

        <button class="btn bg-brand-600 hover:bg-brand-700 text-white w-full text-base shadow-card"
                :disabled="loading || selectedIndicators.length === 0"
                @click="runQuery">
          <span v-if="!loading">Получить выборку</span>
          <span v-else>Загрузка…</span>
        </button>
        <button class="btn bg-emerald-600 hover:bg-emerald-700 text-white w-full"
                :disabled="!result || result.rows.length === 0"
                @click="exportXlsx">
          Экспорт в Excel
        </button>
      </aside>

      <!-- Правая колонка: результаты -->
      <section class="col-span-12 lg:col-span-8 xl:col-span-9 space-y-4">
        <div v-if="!result" class="bg-white rounded-xl shadow-card p-12 text-center text-slate-500">
          <div class="text-5xl mb-3">📊</div>
          <div class="text-lg font-medium text-slate-700">Конструктор готов к работе</div>
          <div class="text-sm mt-1">Выберите объект, показатели и период, затем нажмите «Получить выборку».</div>
        </div>

        <template v-else>
          <!-- KPI карточки тоталов -->
          <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            <div v-for="ind in result.indicators" :key="ind.id"
                 class="bg-white rounded-xl shadow-card p-4 border-l-4 border-brand-500">
              <div class="text-xs text-slate-500 uppercase tracking-wide">{{ ind.label }}</div>
              <div class="text-xl font-bold text-slate-900 mt-1 tabular-nums">{{ fmtMoney(result.totals[ind.id] || 0) }}</div>
              <div class="text-xs text-slate-400 mt-0.5">{{ ind.unit }}</div>
            </div>
          </div>

          <!-- Управление видом -->
          <div class="bg-white rounded-xl shadow-card p-4 flex items-center justify-between">
            <div class="text-sm text-slate-700">
              <span class="font-semibold">{{ result.rows.length }}</span> объектов в выборке
              <span v-if="result.meta.from || result.meta.to" class="text-slate-500">
                · период
                <span class="font-medium">{{ result.meta.from || '...' }} → {{ result.meta.to || '...' }}</span>
              </span>
            </div>
            <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              <button class="px-3 py-1 rounded-md text-sm transition"
                      :class="viewMode === 'table' ? 'bg-white shadow text-slate-900' : 'text-slate-500'"
                      @click="viewMode = 'table'">Таблица</button>
              <button class="px-3 py-1 rounded-md text-sm transition"
                      :class="viewMode === 'chart' ? 'bg-white shadow text-slate-900' : 'text-slate-500'"
                      @click="viewMode = 'chart'">График</button>
            </div>
          </div>

          <!-- Таблица -->
          <div v-show="viewMode === 'table'" class="bg-white rounded-xl shadow-card overflow-hidden">
            <div class="max-h-[640px] overflow-auto scroll-thin">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Бюджет</th>
                    <th>КФСР</th>
                    <th>КЦСР</th>
                    <th>КВР</th>
                    <th v-if="result.meta.mode === 'timeseries'">Снимок</th>
                    <th v-for="ind in result.indicators" :key="ind.id" class="text-right">{{ ind.label }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(r, idx) in result.rows" :key="idx">
                    <td>
                      <div class="font-medium">{{ r.budget || '—' }}</div>
                      <div class="text-xs text-slate-400" v-if="r.kfsrName || r.kcsrName">{{ r.kcsrName || r.kfsrName }}</div>
                    </td>
                    <td><span class="badge bg-slate-100 text-slate-700">{{ r.kfsr || '—' }}</span></td>
                    <td><span class="badge bg-slate-100 text-slate-700">{{ r.kcsr || '—' }}</span></td>
                    <td><span class="badge bg-slate-100 text-slate-700">{{ r.kvr || '—' }}</span></td>
                    <td v-if="result.meta.mode === 'timeseries'" class="text-slate-500">{{ r.snapshot || '—' }}</td>
                    <td v-for="ind in result.indicators" :key="ind.id" class="num"
                        :class="(r.values[ind.id] || 0) === 0 ? 'text-slate-300' : 'text-slate-900'">
                      {{ fmtMoney(r.values[ind.id] || 0) }}
                    </td>
                  </tr>
                  <tr class="totals">
                    <td :colspan="result.meta.mode === 'timeseries' ? 5 : 4">ИТОГО</td>
                    <td v-for="ind in result.indicators" :key="ind.id" class="num">{{ fmtMoney(result.totals[ind.id] || 0) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- График -->
          <div v-show="viewMode === 'chart'" class="bg-white rounded-xl shadow-card p-4">
            <div style="position: relative; height: 540px;">
              <canvas ref="chartCanvas"></canvas>
            </div>
          </div>
        </template>

        <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{{ error }}</div>
      </section>
    </div>
  `,
  setup() {
    const indicators = ref([]);
    const classifiers = ref([]);
    const dictionaries = reactive({ budget: [], kfsr: [], kcsr: [], kvr: [], kosgu: [], kvfo: [], kvsr: [] });
    const snapshots = reactive({ rchb: [], buau: [], agreements: [], gz: [] });

    const filter = reactive({ q: '', budget: '', kfsr: '', kcsr: '', kvr: '', kosgu: '', kvfo: '' });
    const selectedIndicators = ref(['plan', 'bo', 'cash', 'contracts', 'payments']);
    const from = ref('');
    const to = ref('');
    const strategy = ref('latest');
    const mode = ref('aggregate');

    const result = ref(null);
    const error = ref('');
    const loading = ref(false);
    const viewMode = ref('table');
    const chartCanvas = ref(null);
    let chartInstance = null;

    const periodPresets = computed(() => {
      const all = [...new Set([...snapshots.rchb, ...snapshots.agreements])].sort();
      if (!all.length) return [];
      const last = all[all.length - 1];
      const first = all[0];
      return [
        { label: 'Весь период', from: first, to: last },
        { label: 'Последний снимок', from: last, to: last },
        { label: '2025 год', from: '2025-01-01', to: '2025-12-31' },
        { label: '2026 год', from: '2026-01-01', to: '2026-12-31' },
      ];
    });

    function applyPreset(p) { from.value = p.from; to.value = p.to; }

    async function loadMeta() {
      try {
        const ind = await api('/indicators');
        indicators.value = ind.indicators;
        classifiers.value = ind.classifiers;
        const sn = await api('/snapshots');
        Object.assign(snapshots, sn);
        for (const f of ['budget', 'kfsr', 'kcsr', 'kvr', 'kosgu', 'kvfo', 'kvsr']) {
          try {
            const d = await api('/dictionary/' + f);
            dictionaries[f] = d.items;
          } catch {}
        }
      } catch (e) { error.value = e.message; }
    }
    onMounted(loadMeta);

    function toggleIndicator(id) {
      const i = selectedIndicators.value.indexOf(id);
      if (i === -1) selectedIndicators.value.push(id);
      else selectedIndicators.value.splice(i, 1);
    }

    async function runQuery() {
      loading.value = true; error.value = '';
      try {
        result.value = await api('/query', {
          indicators: selectedIndicators.value,
          filter: { ...filter },
          from: from.value, to: to.value,
          mode: mode.value, strategy: strategy.value,
        });
        await nextTick();
        if (viewMode.value === 'chart') drawChart();
      } catch (e) { error.value = e.message; }
      finally { loading.value = false; }
    }

    async function exportXlsx() {
      try {
        await downloadXlsx('/export/xlsx', {
          indicators: selectedIndicators.value,
          filter: { ...filter },
          from: from.value, to: to.value,
          mode: mode.value, strategy: strategy.value,
        }, `vyborka_${new Date().toISOString().slice(0, 10)}.xlsx`);
      } catch (e) { error.value = e.message; }
    }

    watch(viewMode, async (v) => {
      if (v === 'chart' && result.value) {
        await nextTick();
        drawChart();
      }
    });

    function drawChart() {
      if (!chartCanvas.value || !result.value) return;
      if (chartInstance) chartInstance.destroy();

      const PALETTE = ['#3a6dff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#ec4899', '#14b8a6'];
      const inds = result.value.indicators;

      let labels, datasets;
      if (result.value.meta.mode === 'timeseries') {
        const snaps = [...new Set(result.value.rows.map(r => r.snapshot))].sort();
        labels = snaps;
        datasets = inds.map((ind, i) => ({
          label: ind.label,
          data: snaps.map(s => result.value.rows.filter(r => r.snapshot === s).reduce((a, r) => a + (r.values[ind.id] || 0), 0)),
          backgroundColor: PALETTE[i % PALETTE.length] + '33',
          borderColor: PALETTE[i % PALETTE.length],
          borderWidth: 2,
          tension: 0.25,
        }));
      } else {
        const top = result.value.rows.slice(0, 15);
        labels = top.map(r => `${r.kcsr || r.kfsr || ''} · ${r.budget?.slice(0, 35) || ''}`);
        datasets = inds.map((ind, i) => ({
          label: ind.label,
          data: top.map(r => r.values[ind.id] || 0),
          backgroundColor: PALETTE[i % PALETTE.length] + 'cc',
          borderRadius: 4,
        }));
      }

      chartInstance = new Chart(chartCanvas.value, {
        type: result.value.meta.mode === 'timeseries' ? 'line' : 'bar',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y || ctx.parsed)}`,
              }
            }
          },
          scales: {
            x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 30 } },
            y: { ticks: { callback: v => fmtMoney(v) } }
          }
        }
      });
    }

    return {
      indicators, classifiers, dictionaries, snapshots,
      filter, selectedIndicators, from, to, strategy, mode,
      result, error, loading, viewMode, chartCanvas,
      periodPresets, applyPreset, toggleIndicator, runQuery, exportXlsx,
      fmtMoney,
    };
  },
};

// ---------- Компонент: Сравнение периодов ----------
const CompareTab = {
  template: `
    <div class="space-y-4">
      <div class="bg-white rounded-xl shadow-card p-5">
        <h3 class="font-semibold text-slate-900 mb-3">Параметры сравнения</h3>

        <div class="grid grid-cols-12 gap-4">
          <div class="col-span-12 md:col-span-4">
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Поиск (объект)</label>
            <input v-model="filter.q" class="input" placeholder="бюджет, КЦСР, наименование..." />
          </div>
          <div class="col-span-12 md:col-span-4">
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Бюджет</label>
            <select v-model="filter.budget" class="input">
              <option value="">— Все бюджеты —</option>
              <option v-for="b in dictBudget" :key="b.code" :value="b.code">{{ b.code }}</option>
            </select>
          </div>
          <div class="col-span-12 md:col-span-2">
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">КФСР</label>
            <input v-model="filter.kfsr" class="input" />
          </div>
          <div class="col-span-12 md:col-span-2">
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">КЦСР</label>
            <input v-model="filter.kcsr" class="input" />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div class="border border-slate-200 rounded-lg p-4">
            <div class="font-semibold text-slate-700 mb-2">Период A</div>
            <div class="grid grid-cols-2 gap-2">
              <input v-model="periods[0].from" type="date" class="input" />
              <input v-model="periods[0].to"   type="date" class="input" />
            </div>
            <input v-model="periods[0].label" class="input mt-2" placeholder="Подпись (например, 2025)" />
          </div>
          <div class="border border-slate-200 rounded-lg p-4">
            <div class="font-semibold text-slate-700 mb-2">Период B</div>
            <div class="grid grid-cols-2 gap-2">
              <input v-model="periods[1].from" type="date" class="input" />
              <input v-model="periods[1].to"   type="date" class="input" />
            </div>
            <input v-model="periods[1].label" class="input mt-2" placeholder="Подпись (например, 2026)" />
          </div>
        </div>

        <div class="mt-4">
          <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Показатели</label>
          <div class="flex flex-wrap gap-2">
            <button v-for="ind in indicators" :key="ind.id"
                    class="indicator-pill"
                    :class="{ active: selectedIndicators.includes(ind.id) }"
                    @click="toggleIndicator(ind.id)">
              {{ ind.label }}
            </button>
          </div>
        </div>

        <div class="flex gap-2 mt-4">
          <button class="btn bg-brand-600 hover:bg-brand-700 text-white" :disabled="loading" @click="run">
            <span v-if="!loading">Сравнить</span><span v-else>Считаем…</span>
          </button>
          <button class="btn bg-emerald-600 hover:bg-emerald-700 text-white" :disabled="!result" @click="exportXlsx">Экспорт в Excel</button>
        </div>
      </div>

      <div v-if="result" class="bg-white rounded-xl shadow-card overflow-hidden">
        <div class="max-h-[640px] overflow-auto scroll-thin">
          <table class="data-table">
            <thead>
              <tr>
                <th>Объект</th>
                <th v-for="(p, pi) in result.periods" :key="'p'+pi" class="text-right" :colspan="result.indicators.length">
                  {{ p.label || (p.from + ' – ' + p.to) }}
                </th>
                <th class="text-right" :colspan="result.indicators.length">Δ Изменение</th>
              </tr>
              <tr>
                <th></th>
                <template v-for="(p, pi) in result.periods" :key="'p'+pi">
                  <th v-for="ind in result.indicators" :key="'p'+pi+ind.id" class="text-right">{{ ind.label }}</th>
                </template>
                <th v-for="ind in result.indicators" :key="'d'+ind.id" class="text-right">{{ ind.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, idx) in result.rows" :key="idx">
                <td>
                  <div class="font-medium">{{ r.budget || '—' }}</div>
                  <div class="text-xs text-slate-400">{{ r.kcsr }} · {{ r.kvr }}</div>
                </td>
                <template v-for="(p, pi) in result.periods" :key="'pv'+pi">
                  <td v-for="ind in result.indicators" :key="'v'+pi+ind.id" class="num">{{ fmtMoney(r.periods[pi][ind.id] || 0) }}</td>
                </template>
                <td v-for="ind in result.indicators" :key="'dv'+ind.id" class="num">
                  <div :class="deltaClass(r.delta[ind.id].abs)">{{ fmtMoney(r.delta[ind.id].abs) }}</div>
                  <div class="text-xs" :class="deltaClass(r.delta[ind.id].abs)">{{ fmtPct(r.delta[ind.id].pct) }}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{{ error }}</div>
    </div>
  `,
  setup() {
    const indicators = ref([]);
    const dictBudget = ref([]);
    const filter = reactive({ q: '', budget: '', kfsr: '', kcsr: '' });
    const selectedIndicators = ref(['plan', 'bo', 'cash']);
    const periods = reactive([
      { from: '2025-01-01', to: '2025-12-31', label: '2025' },
      { from: '2026-01-01', to: '2026-12-31', label: '2026' },
    ]);
    const result = ref(null);
    const error = ref('');
    const loading = ref(false);

    onMounted(async () => {
      try {
        const meta = await api('/indicators');
        indicators.value = meta.indicators;
        const d = await api('/dictionary/budget');
        dictBudget.value = d.items;
      } catch (e) { error.value = e.message; }
    });

    function toggleIndicator(id) {
      const i = selectedIndicators.value.indexOf(id);
      if (i === -1) selectedIndicators.value.push(id);
      else selectedIndicators.value.splice(i, 1);
    }
    function deltaClass(n) { return n > 0 ? 'delta-pos' : n < 0 ? 'delta-neg' : 'delta-zero'; }

    async function run() {
      loading.value = true; error.value = '';
      try {
        result.value = await api('/compare', {
          indicators: selectedIndicators.value,
          filter: { ...filter },
          periods: JSON.parse(JSON.stringify(periods)),
          strategy: 'latest',
        });
      } catch (e) { error.value = e.message; }
      finally { loading.value = false; }
    }
    async function exportXlsx() {
      try {
        await downloadXlsx('/export/compare-xlsx', {
          indicators: selectedIndicators.value,
          filter: { ...filter },
          periods: JSON.parse(JSON.stringify(periods)),
          strategy: 'latest',
        }, `compare_${new Date().toISOString().slice(0, 10)}.xlsx`);
      } catch (e) { error.value = e.message; }
    }
    return { indicators, dictBudget, filter, selectedIndicators, periods, result, error, loading, toggleIndicator, run, exportXlsx, deltaClass, fmtMoney, fmtPct };
  },
};

// ---------- Компонент: Об инструменте ----------
const AboutTab = {
  template: `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="bg-white rounded-xl shadow-card p-6 lg:col-span-2 space-y-4">
        <h2 class="text-xl font-bold">Конструктор аналитических выборок</h2>
        <p class="text-slate-600">Объединяет данные трёх ключевых информационных систем (АЦК-Планирование, АЦК-Финансы, АЦК-Госзаказ) и БУАУ в едином интерфейсе. Связка идёт через сквозную бюджетную классификацию (КФСР · КЦСР · КВР · КОСГУ · КВФО).</p>
        <div>
          <h3 class="font-semibold mt-3 mb-1">Источники данных</h3>
          <ul class="list-disc pl-5 text-slate-700 space-y-1 text-sm">
            <li><b>РЧБ</b> — помесячные снимки нарастающим итогом: лимиты ПБС (план), принятые БО, остаток лимитов, кассовые выплаты.</li>
            <li><b>Соглашения</b> — снимки по соглашениям (МБТ, ИЦ, ЮЛ_ИП_ФЛ) c суммой на год.</li>
            <li><b>Госзаказ</b> — реестр контрактов и фактов оплат.</li>
            <li><b>БУАУ</b> — выгрузки по бюджетным/автономным учреждениям.</li>
          </ul>
        </div>
        <div>
          <h3 class="font-semibold mt-3 mb-1">Стратегия расчёта</h3>
          <ul class="list-disc pl-5 text-slate-700 space-y-1 text-sm">
            <li><b>Последний снимок</b> — для нарастающего итога РЧБ берётся последний доступный снимок ≤ верхней границы периода.</li>
            <li><b>Сумма за период</b> — суммируются все наблюдения внутри периода (для контрактов/платежей).</li>
          </ul>
        </div>
      </div>
      <div class="bg-white rounded-xl shadow-card p-6">
        <h3 class="font-semibold mb-2">Стек MVP</h3>
        <ul class="text-sm text-slate-700 space-y-1">
          <li>• Backend: Node.js · Express · csv-parse · ExcelJS</li>
          <li>• Frontend: Vue 3 · TailwindCSS · Chart.js</li>
          <li>• Хранение: in-memory (CSV из исходной папки)</li>
        </ul>
        <h3 class="font-semibold mb-2 mt-4">Целевая архитектура</h3>
        <ul class="text-sm text-slate-700 space-y-1">
          <li>• БД: PostgreSQL Pro</li>
          <li>• Backend: Python · Django (или Java · Spring Boot)</li>
          <li>• ETL: Apache NiFi для регулярной загрузки</li>
          <li>• ОС: РЕД ОС / Astra Linux</li>
        </ul>
      </div>
    </div>
  `,
};

createApp(App).mount('#app');
