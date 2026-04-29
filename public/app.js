const { createApp, ref, computed, reactive, onMounted, onUnmounted, watch, nextTick } = Vue;

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

const fmtSharePct = (part, total) => {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total === 0) return '—';
  return `${((part / total) * 100).toFixed(2)}%`;
};

async function api(path, body) {
  let res;
  try {
    res = await fetch('/api' + path, body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : undefined);
  } catch {
    throw new Error(`Сетевая ошибка: не удалось обратиться к /api${path}. Проверьте, запущен ли сервер.`);
  }
  if (!res.ok) {
    throw new Error(await parseHttpError(res, `Ошибка запроса к /api${path}`));
  }
  return res.json();
}

/**
 * Универсальный парсер ошибки HTTP-ответа:
 * - пытается взять серверное сообщение из JSON { error }
 * - если не вышло, использует fallback/статус.
 */
async function parseHttpError(res, fallback = 'Ошибка запроса') {
  try {
    const data = await res.json();
    const msg = String(data?.error || '').trim();
    const code = String(data?.code || '').trim();
    const details = String(data?.details || '').trim();
    if (msg) {
      const parts = [msg];
      if (code) parts.push(`код: ${code}`);
      if (details) parts.push(`детали: ${details}`);
      return parts.join(' | ');
    }
  } catch {
    /* ignore non-json body */
  }
  return `${String(fallback || 'Ошибка запроса')} (HTTP ${res.status})`;
}

/** Нормализация текста ошибки для UI, чтобы не показывать undefined/null. */
function asErrorMessage(err, fallback = 'Неизвестная ошибка') {
  if (!err) return fallback;
  const msg = typeof err === 'string' ? err : (err.message || String(err));
  const text = String(msg || fallback);
  try {
    window.dispatchEvent(new CustomEvent('amurcode:error', { detail: { message: text } }));
  } catch {
    /* ignore dispatch errors */
  }
  return text;
}

/** Устанавливает ошибку в локальный ref и одновременно открывает глобальное модальное окно ошибки. */
function setUiError(errorRef, message) {
  const text = String(message || 'Неизвестная ошибка');
  errorRef.value = text;
  try {
    window.dispatchEvent(new CustomEvent('amurcode:error', { detail: { message: text } }));
  } catch {
    /* ignore dispatch errors */
  }
}

function showUiToast(message, timeoutMs = 1400) {
  try {
    window.dispatchEvent(new CustomEvent('amurcode:toast', {
      detail: { message: String(message || ''), timeoutMs: Number(timeoutMs) || 1400 },
    }));
  } catch {
    /* ignore dispatch errors */
  }
}

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function speechErrorMessage(errCode = '') {
  const code = String(errCode || '');
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Доступ к микрофону запрещен. Разрешите микрофон для сайта.';
  if (code === 'no-speech') return 'Речь не распознана. Попробуйте говорить четче и ближе к микрофону.';
  if (code === 'audio-capture') return 'Не удалось получить аудио с микрофона.';
  if (code === 'network') return 'Ошибка сети сервиса распознавания речи.';
  return `Ошибка голосового ввода${code ? ` (${code})` : ''}`;
}

/**
 * Прогон голосовой фразы через GigaChat:
 * - исправляет распознанные ошибки;
 * - при необходимости подбирает наиболее похожий объект выборки.
 */
async function processVoiceCommand(text, { enableObjectMatch = false } = {}) {
  const source = String(text || '').trim();
  if (!source) return { source: '', normalized: '', changed: false, bestObject: null, confidence: 0 };
  const out = await api('/ai/voice-object', { text: source, enableObjectMatch });
  return {
    source: String(out.source || source),
    normalized: String(out.normalized || source),
    changed: Boolean(out.changed),
    bestObject: out.bestObject || null,
    confidence: Number(out.confidence || 0),
  };
}

/** Пометка в конце каждого анализа (текст для копирования и подпись в UI). */
const AI_ATTRIBUTION = 'Сгенерировано Giga Chat';

function escapeHtmlPlain(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/** Безопасный HTML из Markdown для ответа ИИ (CDN: marked + DOMPurify). */
function aiMarkdownToHtml(markdown) {
  const md = String(markdown || '').trim();
  if (!md) return '';
  try {
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      const raw = marked.parse(md, { breaks: true, gfm: true });
      return DOMPurify.sanitize(raw);
    }
  } catch {
    /* fallback */
  }
  return `<p class="whitespace-pre-wrap">${escapeHtmlPlain(md)}</p>`;
}

function aiSummaryCopyText(summaryBody) {
  const t = String(summaryBody || '').trim();
  if (!t) return '';
  return `${t}\n\n—\n${AI_ATTRIBUTION}`;
}

async function downloadXlsx(path, body, filename) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Сетевая ошибка экспорта: не удалось обратиться к /api${path}`);
  }
  if (!res.ok) throw new Error(await parseHttpError(res, 'Ошибка экспорта'));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

function dataUrlToBlob(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  if (!mime || !b64) return null;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

function downloadDataUrl(dataUrl, filename) {
  const isPng = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,') && dataUrl.length > 128;
  if (!isPng) return false;
  const blob = dataUrlToBlob(dataUrl);
  if (!blob || blob.size === 0) return false;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
    a.remove();
  }, 600);
  return true;
}

function chartToPngDataUrl(canvasEl) {
  try {
    if (!canvasEl) return '';
    return canvasEl.toDataURL('image/png');
  } catch {
    return '';
  }
}

function renderChartConfigToPngDataUrl(config, width = 1400, height = 760) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const chart = new Chart(ctx, config);
    // Принудительно дорисовываем кадр без анимации до снятия PNG.
    chart.resize(width, height);
    chart.update('none');
    const dataUrl = canvas.toDataURL('image/png');
    chart.destroy();
    return dataUrl;
  } catch {
    return '';
  }
}

function getChartPngWithFallback(config, visibleCanvasEl) {
  const offscreen = renderChartConfigToPngDataUrl(config);
  if (offscreen) return offscreen;
  return chartToPngDataUrl(visibleCanvasEl);
}

function htmlEsc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function openPrintableHtml({ title, subtitle, sectionsHtml }) {
  const w = window.open('', '_blank', 'width=1280,height=900');
  if (!w) return false;
  const css = `
    body{font-family:Inter,Arial,sans-serif;color:#111827;margin:24px}
    h1{font-size:20px;margin:0 0 4px}
    h2{font-size:14px;margin:18px 0 8px}
    .sub{color:#6b7280;font-size:12px;margin-bottom:14px}
    .card{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin:8px 0}
    .kv{font-size:12px;line-height:1.5;margin:0}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{border:1px solid #e5e7eb;padding:5px 6px;vertical-align:top;text-align:left}
    th{background:#f8fafc;font-weight:700}
    td.num,th.num{text-align:right;white-space:nowrap}
    .img-wrap{margin-top:8px;border:1px solid #e5e7eb;border-radius:8px;padding:8px}
    img{max-width:100%;height:auto}
    .muted{color:#6b7280}
    @page{size:A4 landscape;margin:10mm}
  `;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${htmlEsc(title)}</title><style>${css}</style></head><body>
    <h1>${htmlEsc(title)}</h1>
    <div class="sub">${htmlEsc(subtitle || '')}</div>
    ${sectionsHtml}
  </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 350);
  return true;
}

function pdfSaveName(prefix) {
  return `${prefix}_${new Date().toISOString().slice(0, 10)}.pdf`;
}

function hasPdfMake() {
  return Boolean(window.pdfMake && window.pdfMake.createPdf);
}

function downloadPdfViaPdfMake(docDefinition, filename) {
  if (!hasPdfMake()) return false;
  window.pdfMake.createPdf(docDefinition).download(filename);
  return true;
}

function readStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorageJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const USER_HISTORY_KEY = 'amurcode.userHistory.v1';
const SELECTOR_LIVE_KEY = 'amurcode.selectorLive.v1';

function getUserHistory() {
  const list = readStorageJson(USER_HISTORY_KEY, []);
  return Array.isArray(list) ? list : [];
}

function appendUserHistory(entry) {
  const list = getUserHistory();
  list.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...entry,
  });
  const trimmed = list.slice(0, 300);
  writeStorageJson(USER_HISTORY_KEY, trimmed);
  window.dispatchEvent(new CustomEvent('amurcode:history-changed'));
}

function clearUserHistory() {
  writeStorageJson(USER_HISTORY_KEY, []);
  window.dispatchEvent(new CustomEvent('amurcode:history-changed'));
}

function compactFilterSummary(filter) {
  const f = filter && typeof filter === 'object' ? filter : {};
  const parts = [];
  if (f.budget) parts.push(`бюджет: ${f.budget}`);
  if (f.kfsr) parts.push(`КФСР: ${f.kfsr}`);
  if (f.kcsr) parts.push(`КЦСР: ${f.kcsr}`);
  if (f.kvr) parts.push(`КВР: ${f.kvr}`);
  if (f.q) parts.push(`поиск: ${String(f.q).slice(0, 60)}`);
  return parts.join(', ');
}

function pushHistory(type, payload = {}) {
  appendUserHistory({
    type: String(type || 'Действие'),
    title: String(payload.title || 'Операция'),
    details: String(payload.details || ''),
    meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
  });
}

function writeSelectorLiveState(result) {
  if (!result || typeof result !== 'object') return;
  const payload = {
    at: new Date().toISOString(),
    result,
  };
  writeStorageJson(SELECTOR_LIVE_KEY, payload);
  try {
    window.dispatchEvent(new CustomEvent('amurcode:selector-live-updated', { detail: payload }));
  } catch {
    /* ignore dispatch errors */
  }
}

function readSelectorLiveState() {
  const data = readStorageJson(SELECTOR_LIVE_KEY, null);
  if (!data || typeof data !== 'object') return null;
  if (!data.result || typeof data.result !== 'object') return null;
  return data;
}

/** Одноразовая навигация из истории личного кабинета (передаётся перед переключением вкладки). */
const PENDING_HISTORY_NAV_KEY = '__amurcodePendingHistory';

function setPendingHistoryNavigation(tab, snapshot) {
  window[PENDING_HISTORY_NAV_KEY] = { tab: String(tab || ''), snapshot };
}

function takePendingHistoryNavigation(expectedTab) {
  const p = window[PENDING_HISTORY_NAV_KEY];
  if (!p || p.tab !== expectedTab) return null;
  window[PENDING_HISTORY_NAV_KEY] = null;
  return p.snapshot;
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
            <div v-if="auth.authenticated && health.loaded" class="text-slate-500">
              Загружено:
              <span class="font-medium text-slate-800">{{ health.stats.objects }}</span> объектов,
              <span class="font-medium text-slate-800">{{ totalRows }}</span> строк
            </div>
            <div v-if="auth.authenticated" class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full" :class="health.ok ? 'bg-emerald-500' : 'bg-red-500'"></span>
              <span class="text-slate-600 text-xs">{{ health.ok ? 'API онлайн' : 'API недоступен' }}</span>
            </div>
            <div v-if="auth.authenticated" class="flex items-center gap-2">
              <span class="text-xs text-slate-600">ФИО: <span class="font-medium text-slate-800">{{ auth.user?.name || auth.user?.username }}</span></span>
              <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5" @click="logout">Выйти</button>
            </div>
          </div>
        </div>
        <nav v-if="auth.authenticated" class="max-w-7xl mx-auto px-6 flex gap-1 border-t border-slate-100">
          <button v-for="t in tabs" :key="t.id"
                  class="px-4 py-2.5 text-sm font-medium border-b-2 transition"
                  :class="activeTab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'"
                  @click="activeTab = t.id">
            {{ t.label }}
          </button>
        </nav>
      </header>

      <main class="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        <div v-if="auth.checking" class="bg-white rounded-xl shadow-card p-8 text-center text-slate-600">
          Проверка авторизации...
        </div>
        <div v-else-if="!auth.authenticated" class="max-w-md mx-auto bg-white rounded-xl shadow-card p-6">
          <h3 class="font-semibold text-slate-900 mb-2">Вход в систему</h3>
          <p class="text-sm text-slate-500 mb-4">Регистрация отключена. Используйте тестового пользователя.</p>
          <div class="space-y-3">
            <div>
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">ФИО</label>
              <input v-model="loginForm.username" class="input" placeholder="user1" />
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Пароль</label>
              <input v-model="loginForm.password" type="password" class="input" placeholder="••••••••" />
            </div>
            <button class="btn bg-brand-600 hover:bg-brand-700 text-white w-full" :disabled="auth.loading" @click="login">
              {{ auth.loading ? 'Вход...' : 'Войти' }}
            </button>
            <div v-if="auth.error" class="text-sm text-red-600">{{ auth.error }}</div>
            <div class="text-xs text-slate-500 border border-slate-200 rounded-lg p-2 bg-slate-50">
              Тестовые пользователи:<br>
              <span v-for="u in testUsers" :key="u.username">{{ u.username }} / {{ u.password }}<br></span>
            </div>
          </div>
        </div>
        <component v-else :is="currentTabComponent" />
      </main>

      <div v-if="toast.open" class="fixed top-4 right-4 z-[80]">
        <div class="bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg shadow-card">
          {{ toast.message }}
        </div>
      </div>

      <div v-if="errorModal.open" class="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-slate-900/50" @click="closeErrorModal"></div>
        <div class="relative bg-white rounded-xl shadow-card w-full max-w-xl p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold text-red-700">Произошла ошибка</h3>
              <p class="text-xs text-slate-500 mt-0.5">Проверьте текст ошибки и исправьте входные данные или параметры.</p>
            </div>
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5" @click="closeErrorModal">Закрыть</button>
          </div>
          <div class="mt-3 border border-red-200 bg-red-50 rounded-lg p-3 text-sm text-red-800 whitespace-pre-wrap">
            {{ errorModal.message }}
          </div>
        </div>
      </div>

      <footer class="border-t border-slate-200 bg-white">
        <div class="max-w-7xl mx-auto px-6 py-3 text-xs text-slate-500 flex items-center justify-between">
          <div>Источник: РЧБ · Соглашения · ГЗ · БУАУ · Сквозная кодировка КФСР/КЦСР/КВР</div>
          <div>Node.js + Express · Vue 3 · Chart.js · ExcelJS</div>
        </div>
      </footer>
    </div>
  `,
  setup() {
    const TAB_STORAGE_KEY = 'amurcode.activeTab.v1';
    const health = reactive({ ok: false, loaded: false, stats: {} });
    const auth = reactive({ checking: true, loading: false, authenticated: false, user: null, error: '' });
    const loginForm = reactive({ username: 'user1', password: 'user123' });
    const testUsers = ref([]);
    const toast = reactive({ open: false, message: '' });
    let toastTimer = null;
    const errorModal = reactive({ open: false, message: '' });
    const activeTab = ref(readStorageJson(TAB_STORAGE_KEY, 'selector') || 'selector');
    const tabs = [
      { id: 'selector', label: 'Конструктор выборок' },
      { id: 'compare',  label: 'Сравнение периодов' },
      { id: 'user-data', label: 'Файлы пользователя' },
      { id: 'account', label: 'Личный кабинет' },
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
    async function loadTestUsers() {
      try {
        const res = await fetch('/api/auth/test-users');
        if (!res.ok) return;
        const data = await res.json();
        testUsers.value = Array.isArray(data?.users) ? data.users : [];
      } catch {
        testUsers.value = [];
      }
    }
    async function checkAuth() {
      auth.checking = true;
      auth.error = '';
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          auth.authenticated = false;
          auth.user = null;
          return;
        }
        const data = await res.json();
        auth.authenticated = Boolean(data?.authenticated);
        auth.user = data?.user || null;
      } catch {
        auth.authenticated = false;
        auth.user = null;
      } finally {
        auth.checking = false;
      }
    }
    async function login() {
      auth.loading = true;
      auth.error = '';
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: String(loginForm.username || '').trim(),
            password: String(loginForm.password || ''),
          }),
        });
        if (!res.ok) {
          auth.error = await parseHttpError(res, 'Ошибка входа');
          return;
        }
        const data = await res.json();
        auth.authenticated = true;
        auth.user = data?.user || null;
        await refreshHealth();
      } catch {
        auth.error = 'Сетевая ошибка входа. Проверьте, запущен ли сервер.';
      } finally {
        auth.loading = false;
      }
    }
    async function logout() {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {}
      auth.authenticated = false;
      auth.user = null;
      health.ok = false;
      health.loaded = false;
    }
    function showErrorModal(message) {
      errorModal.message = String(message || 'Неизвестная ошибка');
      errorModal.open = true;
    }
    function closeErrorModal() {
      errorModal.open = false;
    }
    function onUiError(ev) {
      showErrorModal(ev?.detail?.message || 'Неизвестная ошибка');
    }
    function onUiToast(ev) {
      const message = String(ev?.detail?.message || '').trim();
      const timeoutMs = Math.min(Math.max(Number(ev?.detail?.timeoutMs) || 1400, 600), 4000);
      if (!message) return;
      toast.message = message;
      toast.open = true;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.open = false; }, timeoutMs);
    }
    onMounted(async () => {
      await loadTestUsers();
      await checkAuth();
      if (auth.authenticated) await refreshHealth();
    });
    onMounted(() => { window.addEventListener('amurcode:error', onUiError); });
    onMounted(() => { window.addEventListener('amurcode:toast', onUiToast); });
    onUnmounted(() => { window.removeEventListener('amurcode:error', onUiError); });
    onUnmounted(() => {
      window.removeEventListener('amurcode:toast', onUiToast);
      if (toastTimer) clearTimeout(toastTimer);
    });
    watch(activeTab, (v) => { writeStorageJson(TAB_STORAGE_KEY, v); });

    function onNavigateTabEvent(ev) {
      const tab = ev?.detail?.tab;
      if (!tab) return;
      activeTab.value = tab;
    }
    onMounted(() => { window.addEventListener('amurcode:navigate-tab', onNavigateTabEvent); });
    onUnmounted(() => { window.removeEventListener('amurcode:navigate-tab', onNavigateTabEvent); });

    const currentTabComponent = computed(() => {
      switch (activeTab.value) {
        case 'compare': return CompareTab;
        case 'user-data': return UserDataTab;
        case 'account': return AccountTab;
        case 'about':   return AboutTab;
        default:        return SelectorTab;
      }
    });

    return {
      health, activeTab, tabs, currentTabComponent, totalRows, errorModal, closeErrorModal, toast,
      auth, loginForm, testUsers, login, logout,
    };
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
          <div class="flex gap-2 mb-3">
            <input v-model="filter.q" type="text" placeholder="Поиск: бюджет, наименование КЦСР, программа..." class="input" />
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3"
                    :disabled="!speechSupported"
                    @click="startVoiceInput('selectorQ')">
              {{ voiceListening === 'selectorQ' ? 'Стоп' : '🎤' }}
            </button>
          </div>

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

            <div class="pt-2 border-t border-slate-100 mt-2">
              <div class="flex items-center justify-between mb-1">
                <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide">Несколько объектов</label>
                <span class="text-xs text-slate-500">выбрано: {{ selectedObjects.length }}</span>
              </div>
              <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-800 w-full" @click="openObjectsModal">
                Открыть список объектов
              </button>
              <div v-if="selectedObjects.length" class="mt-2 flex flex-wrap gap-1">
                <span v-for="o in selectedObjects" :key="o.key" class="badge bg-brand-100 text-brand-800 cursor-pointer" @click="removeObject(o.key)">
                  {{ o.kcsr || '—' }} · {{ o.kvr || '—' }} ✕
                </span>
              </div>
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
        <button class="btn bg-rose-600 hover:bg-rose-700 text-white w-full"
                :disabled="!result || result.rows.length === 0"
                @click="downloadPdf">
          Скачать PDF
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

          <!-- ИИ-сводка -->
          <div class="rounded-xl shadow-card p-5 border border-violet-100 bg-gradient-to-br from-violet-50 to-slate-50">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div class="font-semibold text-slate-900">ИИ-сводка (GigaChat)</div>
                <div class="text-xs text-slate-500 mt-0.5">Краткий анализ этой же выборки: итоги, крупные статьи, контекст периода</div>
              </div>
              <button type="button"
                      class="btn shrink-0 bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-lg"
                      :disabled="loading || aiLoading || !result || result.rows.length === 0"
                      @click="fetchAiSummary">
                <span v-if="!aiLoading">Сформировать сводку</span>
                <span v-else>Генерация…</span>
              </button>
            </div>
            <p v-if="aiConfigured === false" class="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              На сервере не задан <code class="text-xs">GIGACHAT_CREDENTIALS</code> — добавьте ключ в файл <code class="text-xs">.env</code> в корне проекта и перезапустите сервер.
            </p>
            <div v-if="aiError" class="mt-3 text-sm text-red-600">{{ aiError }}</div>
            <div v-if="aiSummary" class="mt-3 border-t border-violet-100/80 pt-3">
              <div class="flex flex-wrap items-center justify-end gap-2 mb-2">
                <div class="flex items-center gap-2">
                  <span v-if="aiCopyOk" class="text-xs text-emerald-600 font-medium">Скопировано в буфер</span>
                  <button type="button"
                          class="text-xs font-semibold text-violet-800 bg-white border border-violet-200 hover:bg-violet-50 rounded-lg px-3 py-1.5"
                          @click="copyAiSummary">
                    Копировать сводку
                  </button>
                </div>
              </div>
              <div class="ai-md-content" v-html="aiSummaryHtml"></div>
              <p class="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400 text-right">{{ aiAttribution }}</p>
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
            <div class="flex items-center gap-3">
              <button class="btn bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5"
                      :disabled="!result"
                      @click="exportCurrentChartPng">
                Экспорт диаграммы PNG
              </button>
              <select v-model="chartType" class="input !w-auto min-w-[170px] text-xs">
                <option value="auto">График: Авто</option>
                <option value="bar">График: Столбцы</option>
                <option value="line">График: Линия</option>
                <option value="radar">График: Радар</option>
                <option value="pie">График: Круговая</option>
                <option value="doughnut">График: Кольцевая</option>
              </select>
              <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              <button class="px-3 py-1 rounded-md text-sm transition"
                      :class="viewMode === 'table' ? 'bg-white shadow text-slate-900' : 'text-slate-500'"
                      @click="viewMode = 'table'">Таблица</button>
              <button class="px-3 py-1 rounded-md text-sm transition"
                      :class="viewMode === 'chart' ? 'bg-white shadow text-slate-900' : 'text-slate-500'"
                      @click="viewMode = 'chart'">График</button>
              </div>
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

      <!-- Модальное окно выбора объектов -->
      <div v-if="showObjectsModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-slate-900/45" @click="closeObjectsModal"></div>
        <div class="relative bg-white rounded-xl shadow-card w-full max-w-3xl max-h-[85vh] flex flex-col">
          <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 class="font-semibold text-slate-900">Выбор объектов</h3>
              <p class="text-xs text-slate-500 mt-0.5">Найдите и добавьте один или несколько объектов в выборку</p>
            </div>
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3" @click="closeObjectsModal">Закрыть</button>
          </div>

          <div class="p-5 space-y-3 overflow-auto">
            <div class="flex gap-2">
              <input v-model="objectSearch" type="text" class="input" placeholder="Поиск по коду, наименованию, бюджету..." />
              <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3"
                      :disabled="!speechSupported"
                      @click="startVoiceInput('objectSearch')">
                {{ voiceListening === 'objectSearch' ? 'Стоп' : '🎤' }}
              </button>
              <button class="btn bg-brand-600 hover:bg-brand-700 text-white px-4" :disabled="objectsLoading" @click="loadObjectOptions">
                {{ objectsLoading ? 'Поиск...' : 'Обновить' }}
              </button>
            </div>

            <div class="max-h-[45vh] overflow-auto border border-slate-200 rounded-lg p-2 space-y-1">
              <button v-for="o in objectOptions" :key="o.key" type="button"
                      class="w-full text-left text-xs rounded px-2 py-2 hover:bg-slate-100 flex items-start justify-between gap-2"
                      @click="addObject(o)">
                <span class="text-slate-700">
                  <div><b>{{ o.kcsr || '—' }}</b> / {{ o.kvr || '—' }} · {{ o.budget }}</div>
                  <div class="text-[11px] text-slate-500 mt-0.5">
                    {{ o.kcsrName || '—' }} · {{ o.kvrName || '—' }}
                  </div>
                </span>
                <span class="text-brand-700 font-semibold shrink-0">+ добавить</span>
              </button>
              <div v-if="!objectsLoading && objectOptions.length === 0" class="text-xs text-slate-500 px-2 py-3">
                Ничего не найдено. Измените запрос - список обновится автоматически.
              </div>
            </div>

            <div v-if="selectedObjects.length" class="pt-2 border-t border-slate-100">
              <div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Выбранные объекты</div>
              <div class="flex flex-wrap gap-1">
                <span v-for="o in selectedObjects" :key="o.key" class="badge bg-brand-100 text-brand-800 cursor-pointer" @click="removeObject(o.key)">
                  {{ o.kcsr || '—' }} · {{ o.kvr || '—' }} ✕
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  setup() {
    const STORAGE_KEY = 'amurcode.selectorState.v1';
    const indicators = ref([]);
    const classifiers = ref([]);
    const dictionaries = reactive({ budget: [], kfsr: [], kcsr: [], kvr: [], kosgu: [], kvfo: [], kvsr: [] });
    const snapshots = reactive({ rchb: [], buau: [], agreements: [], gz: [] });

    const filter = reactive({ q: '', budget: '', kfsr: '', kcsr: '', kvr: '', kosgu: '', kvfo: '' });
    const objectSearch = ref('');
    const speechSupported = ref(Boolean(getSpeechRecognitionCtor()));
    const voiceListening = ref('');
    const objectsLoading = ref(false);
    const objectOptions = ref([]);
    const selectedObjects = ref([]);
    const showObjectsModal = ref(false);
    const selectedIndicators = ref(['plan', 'bo', 'cash', 'contracts', 'payments']);
    const from = ref('');
    const to = ref('');
    const strategy = ref('latest');
    const mode = ref('aggregate');

    const result = ref(null);
    const error = ref('');
    const loading = ref(false);
    const aiSummary = ref('');
    const aiLoading = ref(false);
    const aiError = ref('');
    const aiConfigured = ref(null);
    const aiCopyOk = ref(false);
    const viewMode = ref('table');
    const chartType = ref('auto');
    const chartCanvas = ref(null);
    let autoQueryTimer = null;
    let chartInstance = null;
    let saveStateTimer = null;
    /** Блокирует автоповтор запроса при восстановлении вкладки из истории */
    let historyReplayIgnoreWatch = false;
    let objectSearchTimer = null;
    let objectLoadSeq = 0;
    let activeRecognition = null;

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

    const aiSummaryHtml = computed(() => aiMarkdownToHtml(aiSummary.value));
    const aiAttribution = AI_ATTRIBUTION;

    async function copyAiSummary() {
      const text = aiSummaryCopyText(aiSummary.value);
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        aiCopyOk.value = true;
        setTimeout(() => { aiCopyOk.value = false; }, 2500);
      } catch {
        aiCopyOk.value = false;
      }
    }

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
      } catch (e) { error.value = asErrorMessage(e, 'Ошибка загрузки метаданных'); }
    }

    function objectSortName(o) {
      return [o.kcsr, o.kvr, o.kfsr, o.budget, o.kcsrName, o.kvrName, o.kfsrName].map(v => String(v || '')).join(' ');
    }

    function objectRelevanceScore(o, q) {
      const query = String(q || '').trim().toLowerCase();
      if (!query) return 0;
      const fields = {
        kcsr: String(o.kcsr || '').toLowerCase(),
        kvr: String(o.kvr || '').toLowerCase(),
        kfsr: String(o.kfsr || '').toLowerCase(),
        budget: String(o.budget || '').toLowerCase(),
        kcsrName: String(o.kcsrName || '').toLowerCase(),
        kvrName: String(o.kvrName || '').toLowerCase(),
        kfsrName: String(o.kfsrName || '').toLowerCase(),
      };
      const hay = Object.values(fields).join(' ');
      const tokens = query.split(/\s+/).filter(Boolean);
      if (!tokens.length) return 0;

      let score = 0;
      for (const t of tokens) {
        if (!hay.includes(t)) continue;
        score += 15;
        if (fields.kcsr === t || fields.kvr === t || fields.kfsr === t) score += 120;
        if (fields.kcsr.startsWith(t) || fields.kvr.startsWith(t) || fields.kfsr.startsWith(t)) score += 70;
        if (fields.kcsr.includes(t) || fields.kvr.includes(t) || fields.kfsr.includes(t)) score += 35;
        if (fields.kcsrName.startsWith(t) || fields.kvrName.startsWith(t) || fields.kfsrName.startsWith(t)) score += 28;
        if (fields.kcsrName.includes(t) || fields.kvrName.includes(t) || fields.kfsrName.includes(t)) score += 16;
        if (fields.budget.includes(t)) score += 10;
      }
      return score;
    }

    function sortObjectOptions(items, q) {
      return [...items].sort((a, b) => {
        const sa = objectRelevanceScore(a, q);
        const sb = objectRelevanceScore(b, q);
        if (sa !== sb) return sb - sa;
        return objectSortName(a).localeCompare(objectSortName(b), 'ru');
      });
    }

    async function loadObjectOptions() {
      const reqId = ++objectLoadSeq;
      objectsLoading.value = true;
      // Сбрасываем прошлую ошибку перед новым запросом, чтобы UI не держал старый текст.
      error.value = '';
      try {
        const q = encodeURIComponent(objectSearch.value || '');
        const resp = await fetch(`/api/objects?q=${q}&limit=80`);
        if (!resp.ok) throw new Error(await parseHttpError(resp, 'Не удалось загрузить список объектов'));
        const data = await resp.json();
        const items = Array.isArray(data.items) ? data.items : [];
        if (reqId === objectLoadSeq) objectOptions.value = sortObjectOptions(items, objectSearch.value);
      } catch (e) {
        error.value = asErrorMessage(e, 'Ошибка загрузки списка объектов');
      } finally {
        if (reqId === objectLoadSeq) objectsLoading.value = false;
      }
    }

    function addObject(obj) {
      if (!obj?.key) return;
      if (selectedObjects.value.some(x => x.key === obj.key)) return;
      selectedObjects.value.push(obj);
    }

    function removeObject(key) {
      selectedObjects.value = selectedObjects.value.filter(x => x.key !== key);
    }

    function openObjectsModal() {
      showObjectsModal.value = true;
      loadObjectOptions();
    }

    function closeObjectsModal() {
      showObjectsModal.value = false;
    }

    function stopVoiceInput() {
      if (activeRecognition) {
        try { activeRecognition.stop(); } catch {}
        activeRecognition = null;
      }
      voiceListening.value = '';
    }

    function startVoiceInput(target) {
      if (!speechSupported.value) {
        setUiError(error, 'Голосовой ввод не поддерживается в этом браузере.');
        return;
      }
      if (voiceListening.value === target) {
        stopVoiceInput();
        return;
      }
      stopVoiceInput();
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setUiError(error, 'SpeechRecognition API недоступен.');
        return;
      }
      const rec = new Ctor();
      activeRecognition = rec;
      voiceListening.value = target;
      rec.lang = 'ru-RU';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = async (event) => {
        const text = String(event?.results?.[0]?.[0]?.transcript || '').trim();
        if (!text) return;
        try {
          const out = await processVoiceCommand(text, { enableObjectMatch: true });
          const normalized = String(out.normalized || text).trim() || text;
          if (target === 'selectorQ') filter.q = normalized;
          else if (target === 'objectSearch') {
            objectSearch.value = normalized;
            loadObjectOptions();
          }
          if (out.changed) showUiToast(`GigaChat исправил запрос: "${normalized}"`, 1500);
          else showUiToast('GigaChat проверил запрос', 1100);
          if (out.bestObject) {
            addObject(out.bestObject);
            showUiToast(`Найден объект: ${out.bestObject.kcsr || '—'} · ${out.bestObject.kvr || '—'}`, 1400);
          }
        } catch (e) {
          setUiError(error, asErrorMessage(e, 'Не удалось обработать голосовую команду через GigaChat'));
        }
      };
      rec.onerror = (event) => {
        setUiError(error, speechErrorMessage(event?.error));
      };
      rec.onend = () => {
        if (activeRecognition === rec) activeRecognition = null;
        if (voiceListening.value === target) voiceListening.value = '';
      };
      try {
        rec.start();
      } catch {
        setUiError(error, 'Не удалось запустить голосовой ввод.');
        stopVoiceInput();
      }
    }

    function saveState() {
      if (saveStateTimer) clearTimeout(saveStateTimer);
      saveStateTimer = setTimeout(() => {
        writeStorageJson(STORAGE_KEY, {
          filter: { ...filter },
          objectSearch: objectSearch.value,
          selectedObjects: selectedObjects.value,
          selectedIndicators: selectedIndicators.value,
          from: from.value,
          to: to.value,
          strategy: strategy.value,
          mode: mode.value,
          viewMode: viewMode.value,
          chartType: chartType.value,
        });
      }, 250);
    }

    function restoreState() {
      const s = readStorageJson(STORAGE_KEY, null);
      if (!s || typeof s !== 'object') return;
      const f = s.filter && typeof s.filter === 'object' ? s.filter : {};
      filter.q = String(f.q || '');
      filter.budget = String(f.budget || '');
      filter.kfsr = String(f.kfsr || '');
      filter.kcsr = String(f.kcsr || '');
      filter.kvr = String(f.kvr || '');
      filter.kosgu = String(f.kosgu || '');
      filter.kvfo = String(f.kvfo || '');
      objectSearch.value = String(s.objectSearch || '');
      selectedObjects.value = Array.isArray(s.selectedObjects) ? s.selectedObjects.slice(0, 300) : [];
      selectedIndicators.value = Array.isArray(s.selectedIndicators) ? s.selectedIndicators.slice(0, 50) : selectedIndicators.value;
      from.value = String(s.from || '');
      to.value = String(s.to || '');
      strategy.value = s.strategy === 'sum' ? 'sum' : 'latest';
      mode.value = s.mode === 'timeseries' ? 'timeseries' : 'aggregate';
      viewMode.value = s.viewMode === 'chart' ? 'chart' : 'table';
      chartType.value = String(s.chartType || 'auto');
    }

    /** Применить сохранённый снимок (из записи истории). Формат как у saveState/restoreState. */
    function applySelectorSnapshot(s) {
      if (!s || typeof s !== 'object') return;
      if (autoQueryTimer) clearTimeout(autoQueryTimer);
      historyReplayIgnoreWatch = true;
      const f = s.filter && typeof s.filter === 'object' ? s.filter : {};
      filter.q = String(f.q || '');
      filter.budget = String(f.budget || '');
      filter.kfsr = String(f.kfsr || '');
      filter.kcsr = String(f.kcsr || '');
      filter.kvr = String(f.kvr || '');
      filter.kosgu = String(f.kosgu || '');
      filter.kvfo = String(f.kvfo || '');
      objectSearch.value = String(s.objectSearch || '');
      selectedObjects.value = Array.isArray(s.selectedObjects) ? s.selectedObjects.slice(0, 300) : [];
      selectedIndicators.value = Array.isArray(s.selectedIndicators) ? s.selectedIndicators.slice(0, 50) : selectedIndicators.value;
      from.value = String(s.from || '');
      to.value = String(s.to || '');
      strategy.value = s.strategy === 'sum' ? 'sum' : 'latest';
      mode.value = s.mode === 'timeseries' ? 'timeseries' : 'aggregate';
      viewMode.value = s.viewMode === 'chart' ? 'chart' : 'table';
      chartType.value = String(s.chartType || 'auto');
    }

    onMounted(async () => {
      restoreState();
      await loadMeta();
      await loadObjectOptions();
      try {
        const st = await api('/ai/status');
        aiConfigured.value = st.configured === true;
      } catch {
        aiConfigured.value = false;
      }

      const pendingSnap = takePendingHistoryNavigation('selector');
      if (pendingSnap && typeof pendingSnap === 'object') {
        applySelectorSnapshot(pendingSnap);
        await loadObjectOptions();
        await nextTick();
        try {
          await runQuery({ silent: false, skipHistory: true });
        } finally {
          setTimeout(() => { historyReplayIgnoreWatch = false; }, 520);
        }
      }
    });

    function toggleIndicator(id) {
      const i = selectedIndicators.value.indexOf(id);
      if (i === -1) selectedIndicators.value.push(id);
      else selectedIndicators.value.splice(i, 1);
    }

    async function runQuery({ silent = false, skipHistory = false } = {}) {
      if (!silent) loading.value = true;
      if (!silent) error.value = '';
      try {
        result.value = await api('/query', {
          indicators: selectedIndicators.value,
          filter: { ...filter, objectKeys: selectedObjects.value.map(o => o.key) },
          from: from.value, to: to.value,
          mode: mode.value, strategy: strategy.value,
        });
        const rowsCount = Number(result.value?.rows?.length || 0);
        if (!silent && !skipHistory) {
          pushHistory('Выборка', {
            title: 'Выполнена выборка',
            details: `${from.value} -> ${to.value}; режим: ${mode.value}; стратегия: ${strategy.value}; строк: ${rowsCount}${compactFilterSummary(filter) ? `; ${compactFilterSummary(filter)}` : ''}`,
            meta: {
              tab: 'selector',
              snapshot: {
                filter: { ...filter },
                objectSearch: objectSearch.value,
                selectedObjects: selectedObjects.value.slice(0, 300),
                selectedIndicators: selectedIndicators.value.slice(0, 50),
                from: from.value,
                to: to.value,
                strategy: strategy.value,
                mode: mode.value,
                viewMode: viewMode.value,
                chartType: chartType.value,
                rowsCount,
              },
            },
          });
        }
        writeSelectorLiveState(result.value);
        await nextTick();
        if (viewMode.value === 'chart') drawChart();
      } catch (e) { error.value = asErrorMessage(e, 'Ошибка выполнения выборки'); }
      finally { if (!silent) loading.value = false; }
    }

    async function fetchAiSummary() {
      aiLoading.value = true;
      aiError.value = '';
      aiSummary.value = '';
      try {
        const data = await api('/ai/summary', {
          kind: 'query',
          indicators: selectedIndicators.value,
          filter: { ...filter, objectKeys: selectedObjects.value.map(o => o.key) },
          from: from.value,
          to: to.value,
          mode: mode.value,
          strategy: strategy.value,
        });
        aiSummary.value = data.summary || '';
      } catch (e) {
        aiError.value = e.message || String(e);
      } finally {
        aiLoading.value = false;
      }
    }

    async function exportXlsx() {
      try {
        await nextTick();
        drawChart();
        const chartImages = buildSelectorChartImagesForExport();
        await downloadXlsx('/export/xlsx', {
          indicators: selectedIndicators.value,
          filter: { ...filter, objectKeys: selectedObjects.value.map(o => o.key) },
          from: from.value, to: to.value,
          mode: mode.value, strategy: strategy.value,
          chartImageBase64: chartToPngDataUrl(chartCanvas.value),
          chartImages,
        }, `vyborka_${new Date().toISOString().slice(0, 10)}.xlsx`);
      } catch (e) { error.value = asErrorMessage(e, 'Ошибка экспорта Excel'); }
    }

    function downloadPdf() {
      if (!result.value) return;
      if (!hasPdfMake()) {
        setUiError(error, 'PDF-библиотека не загружена');
        return;
      }
      const selectedKind = chartType.value === 'auto'
        ? (result.value.meta.mode === 'timeseries' ? 'line' : 'bar')
        : chartType.value;
      const cfg = buildSelectorChartConfig(selectedKind);
      const chartPng = cfg ? getChartPngWithFallback(cfg, chartCanvas.value) : '';

      const headers = ['Бюджет', 'КФСР', 'КЦСР', 'КВР'];
      if (result.value.meta.mode === 'timeseries') headers.push('Снимок');
      for (const ind of (result.value.indicators || [])) headers.push(ind.label);

      const body = (result.value.rows || []).map(r => {
        const row = [r.budget || '—', r.kfsr || '—', r.kcsr || '—', r.kvr || '—'];
        if (result.value.meta.mode === 'timeseries') row.push(r.snapshot || '—');
        for (const ind of (result.value.indicators || [])) row.push(fmtMoney(r.values?.[ind.id] || 0));
        return row;
      });
      const total = ['ИТОГО', '', '', ''];
      if (result.value.meta.mode === 'timeseries') total.push('');
      for (const ind of (result.value.indicators || [])) total.push(fmtMoney(result.value.totals?.[ind.id] || 0));
      body.push(total);

      const docDefinition = {
        pageOrientation: 'landscape',
        pageSize: 'A4',
        pageMargins: [24, 24, 24, 24],
        defaultStyle: { font: 'Roboto', fontSize: 9 },
        content: [
          { text: 'Печатная форма · Выборка', style: 'h1' },
          { text: `Период: ${result.value.meta.from || '—'} → ${result.value.meta.to || '—'} | Режим: ${result.value.meta.mode || '—'} | Стратегия: ${result.value.meta.strategy || '—'}`, color: '#475569', margin: [0, 0, 0, 8] },
          chartPng ? { image: chartPng, fit: [760, 320], margin: [0, 0, 0, 8] } : { text: 'Диаграмма недоступна', color: '#64748b', margin: [0, 0, 0, 8] },
          {
            table: { headerRows: 1, widths: Array(headers.length).fill('auto'), body: [headers, ...body] },
            layout: 'lightHorizontalLines',
          },
          aiSummary.value ? { text: `ИИ-сводка:\n${aiSummary.value}`, margin: [0, 10, 0, 0] } : {},
        ],
        styles: { h1: { fontSize: 14, bold: true } },
      };
      downloadPdfViaPdfMake(docDefinition, pdfSaveName('vyborka'));
    }

    function printForm() {
      if (!result.value) return;
      const selectedKind = chartType.value === 'auto'
        ? (result.value.meta.mode === 'timeseries' ? 'line' : 'bar')
        : chartType.value;
      const cfg = buildSelectorChartConfig(selectedKind);
      const chartPng = cfg ? getChartPngWithFallback(cfg, chartCanvas.value) : '';
      const f = result.value.meta?.filter || {};
      const indHeaders = (result.value.indicators || []).map(ind => `<th class="num">${htmlEsc(ind.label)}</th>`).join('');
      const rowsHtml = (result.value.rows || []).map(r => {
        const vals = (result.value.indicators || []).map(ind => `<td class="num">${htmlEsc(fmtMoney(r.values?.[ind.id] || 0))}</td>`).join('');
        const snapshotCol = result.value.meta.mode === 'timeseries' ? `<td>${htmlEsc(r.snapshot || '—')}</td>` : '';
        return `<tr>
          <td>${htmlEsc(r.budget || '—')}</td>
          <td>${htmlEsc(r.kfsr || '—')}</td>
          <td>${htmlEsc(r.kcsr || '—')}</td>
          <td>${htmlEsc(r.kvr || '—')}</td>
          ${snapshotCol}
          ${vals}
        </tr>`;
      }).join('');
      const totalVals = (result.value.indicators || []).map(ind => `<td class="num">${htmlEsc(fmtMoney(result.value.totals?.[ind.id] || 0))}</td>`).join('');
      const totalColspan = result.value.meta.mode === 'timeseries' ? 5 : 4;
      const sectionsHtml = `
        <h2>Параметры</h2>
        <div class="card">
          <p class="kv"><b>Период:</b> ${htmlEsc(result.value.meta.from || '—')} → ${htmlEsc(result.value.meta.to || '—')}</p>
          <p class="kv"><b>Режим:</b> ${htmlEsc(result.value.meta.mode || '—')} · <b>Стратегия:</b> ${htmlEsc(result.value.meta.strategy || '—')}</p>
          <p class="kv"><b>Фильтр:</b> бюджет=${htmlEsc(f.budget || '—')}, кфср=${htmlEsc(f.kfsr || '—')}, кцср=${htmlEsc(f.kcsr || '—')}, квр=${htmlEsc(f.kvr || '—')}, поиск=${htmlEsc(f.q || '—')}</p>
          <p class="kv"><b>Показатели:</b> ${htmlEsc((result.value.indicators || []).map(i => i.label).join('; '))}</p>
          <p class="kv muted"><b>Сформировано:</b> ${htmlEsc(new Date().toLocaleString('ru-RU'))}</p>
        </div>

        <h2>Диаграмма (${htmlEsc(selectedKind)})</h2>
        <div class="img-wrap">${chartPng ? `<img src="${chartPng}" alt="chart">` : '<div class="muted">Диаграмма недоступна</div>'}</div>

        <h2>Таблица результатов (${htmlEsc(String(result.value.rows?.length || 0))} строк)</h2>
        <table>
          <thead>
            <tr>
              <th>Бюджет</th>
              <th>КФСР</th>
              <th>КЦСР</th>
              <th>КВР</th>
              ${result.value.meta.mode === 'timeseries' ? '<th>Снимок</th>' : ''}
              ${indHeaders}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr>
              <td colspan="${totalColspan}"><b>ИТОГО</b></td>
              ${totalVals}
            </tr>
          </tbody>
        </table>
        ${aiSummary.value ? `<h2>ИИ-сводка</h2><div class="card">${aiMarkdownToHtml(aiSummary.value)}</div>` : ''}
      `;
      openPrintableHtml({
        title: 'Печатная форма · Выборка',
        subtitle: 'Конструктор аналитических выборок',
        sectionsHtml,
      });
    }

    watch(viewMode, async (v) => {
      if (v === 'chart' && result.value) {
        await nextTick();
        drawChart();
      }
    });

    watch(chartType, async () => {
      if (viewMode.value === 'chart' && result.value) {
        await nextTick();
        drawChart();
      }
    });

    function scheduleAutoQuery() {
      if (historyReplayIgnoreWatch) return;
      if (autoQueryTimer) clearTimeout(autoQueryTimer);
      autoQueryTimer = setTimeout(() => {
        if (historyReplayIgnoreWatch) return;
        if (selectedIndicators.value.length > 0) runQuery({ silent: true });
      }, 450);
    }

    watch([from, to, strategy, mode], scheduleAutoQuery);
    watch(filter, scheduleAutoQuery, { deep: true });
    watch(selectedIndicators, scheduleAutoQuery, { deep: true });
    watch(selectedObjects, scheduleAutoQuery, { deep: true });
    watch(objectSearch, () => {
      if (!showObjectsModal.value) return;
      if (objectSearchTimer) clearTimeout(objectSearchTimer);
      objectSearchTimer = setTimeout(() => { loadObjectOptions(); }, 180);
    });
    watch([from, to, strategy, mode, viewMode, chartType, objectSearch], saveState);
    watch(filter, saveState, { deep: true });
    watch(selectedIndicators, saveState, { deep: true });
    watch(selectedObjects, saveState, { deep: true });

    onUnmounted(() => {
      if (autoQueryTimer) clearTimeout(autoQueryTimer);
      if (objectSearchTimer) clearTimeout(objectSearchTimer);
      if (saveStateTimer) clearTimeout(saveStateTimer);
      if (chartInstance) chartInstance.destroy();
      stopVoiceInput();
    });

    function buildSelectorChartConfig(selectedTypeInput) {
      if (!result.value) return null;
      const PALETTE = ['#3a6dff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#ec4899', '#14b8a6'];
      const inds = result.value.indicators;

      const selectedType = (selectedTypeInput || chartType.value) === 'auto'
        ? (result.value.meta.mode === 'timeseries' ? 'line' : 'bar')
        : (selectedTypeInput || chartType.value);

      let labels, datasets;
      if (selectedType === 'pie' || selectedType === 'doughnut') {
        const head = inds[0];
        if (!head) return null;
        if (result.value.meta.mode === 'timeseries') {
          const snaps = [...new Set(result.value.rows.map(r => r.snapshot))].sort();
          labels = snaps;
          datasets = [{
            label: head.label,
            data: snaps.map(s => result.value.rows.filter(r => r.snapshot === s).reduce((a, r) => a + (r.values[head.id] || 0), 0)),
            backgroundColor: snaps.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'),
            borderColor: snaps.map((_, i) => PALETTE[i % PALETTE.length]),
            borderWidth: 1,
          }];
        } else {
          const top = result.value.rows.slice(0, 15);
          labels = top.map(r => `${r.kcsr || r.kfsr || ''} · ${r.budget?.slice(0, 28) || ''}`);
          datasets = [{
            label: head.label,
            data: top.map(r => r.values[head.id] || 0),
            backgroundColor: top.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'),
            borderColor: top.map((_, i) => PALETTE[i % PALETTE.length]),
            borderWidth: 1,
          }];
        }
      } else if (selectedType === 'radar') {
        const head = inds[0];
        if (!head) return null;
        if (result.value.meta.mode === 'timeseries') {
          const snaps = [...new Set(result.value.rows.map(r => r.snapshot))].sort();
          labels = snaps;
          datasets = [{
            label: head.label,
            data: snaps.map(s => result.value.rows.filter(r => r.snapshot === s).reduce((a, r) => a + (r.values[head.id] || 0), 0)),
            backgroundColor: PALETTE[0] + '33',
            borderColor: PALETTE[0],
            borderWidth: 2,
          }];
        } else {
          const top = result.value.rows.slice(0, 12);
          labels = top.map(r => `${r.kcsr || r.kfsr || ''}`);
          datasets = [{
            label: head.label,
            data: top.map(r => r.values[head.id] || 0),
            backgroundColor: PALETTE[0] + '33',
            borderColor: PALETTE[0],
            borderWidth: 2,
          }];
        }
      } else if (result.value.meta.mode === 'timeseries') {
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
      return {
        type: selectedType,
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            title: {
              display: true,
              text: selectedType === 'pie' || selectedType === 'doughnut' || selectedType === 'radar'
                ? `Показатель: ${(inds[0]?.label || '—')}`
                : 'Сравнение показателей',
            },
            legend: { position: 'top' },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const raw = Number(typeof ctx.parsed === 'object' ? (ctx.parsed?.y ?? ctx.raw) : (ctx.parsed ?? ctx.raw)) || 0;
                  const arr = Array.isArray(ctx.dataset.data) ? ctx.dataset.data.map(v => Number(v) || 0) : [];
                  const total = arr.reduce((a, b) => a + b, 0);
                  let line = `${ctx.dataset.label}: ${fmtMoney(raw)}`;
                  if (selectedType === 'pie' || selectedType === 'doughnut') {
                    line += ` · ${fmtSharePct(raw, total)}`;
                  } else if (total !== 0) {
                    line += ` · доля ${fmtSharePct(raw, total)}`;
                  }
                  return line;
                },
              }
            }
          },
          scales: selectedType === 'pie' || selectedType === 'doughnut'
            ? {}
            : {
                x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 30 } },
                y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v) } },
              }
        },
      };
    }

    function drawChart() {
      if (!chartCanvas.value || !result.value) return;
      if (chartInstance) chartInstance.destroy();
      const config = buildSelectorChartConfig(chartType.value);
      if (!config) return;
      chartInstance = new Chart(chartCanvas.value, config);
    }

    function buildSelectorChartImagesForExport() {
      if (!result.value) return [];
      const kinds = ['bar', 'line', 'radar', 'pie', 'doughnut'];
      const titleMap = {
        bar: 'Выборка · Столбцы',
        line: 'Выборка · Линия',
        radar: 'Выборка · Радар',
        pie: 'Выборка · Круговая',
        doughnut: 'Выборка · Кольцевая',
      };
      const out = [];
      for (const kind of kinds) {
        const cfg = buildSelectorChartConfig(kind);
        if (!cfg) continue;
        const png = renderChartConfigToPngDataUrl(cfg);
        if (!png) continue;
        out.push({ title: titleMap[kind], imageBase64: png });
      }
      return out;
    }

    function exportCurrentChartPng() {
      if (!result.value) return;
      const selectedKind = chartType.value === 'auto'
        ? (result.value.meta.mode === 'timeseries' ? 'line' : 'bar')
        : chartType.value;
      const cfg = buildSelectorChartConfig(selectedKind);
      if (!cfg) {
        setUiError(error, 'Не удалось построить диаграмму для экспорта');
        return;
      }
      const png = getChartPngWithFallback(cfg, chartCanvas.value);
      const d = new Date().toISOString().slice(0, 10);
      const ok = downloadDataUrl(png, `vyborka_chart_${selectedKind}_${d}.png`);
      if (!ok) setUiError(error, 'Экспорт PNG не удался: диаграмма не сформирована');
    }

    function exportAllChartsPng() {
      if (!result.value) return;
      const kinds = ['bar', 'line', 'radar', 'pie', 'doughnut'];
      const d = new Date().toISOString().slice(0, 10);
      let idx = 0;
      for (const kind of kinds) {
        const cfg = buildSelectorChartConfig(kind);
        if (!cfg) continue;
        const png = getChartPngWithFallback(cfg, chartCanvas.value);
        if (!png) continue;
        setTimeout(() => {
          const ok = downloadDataUrl(png, `vyborka_${kind}_${d}.png`);
          if (!ok) setUiError(error, 'Один из PNG не сформировался корректно');
        }, idx * 150);
        idx += 1;
      }
    }

    return {
      indicators, classifiers, dictionaries, snapshots,
      filter, objectSearch, objectOptions, objectsLoading, selectedObjects, selectedIndicators, from, to, strategy, mode,
      speechSupported, voiceListening, startVoiceInput,
      showObjectsModal, openObjectsModal, closeObjectsModal,
      result, error, loading, viewMode, chartType, chartCanvas,
      periodPresets, applyPreset, toggleIndicator, runQuery, exportXlsx, downloadPdf, printForm, loadObjectOptions, addObject, removeObject,
      exportCurrentChartPng, exportAllChartsPng,
      fetchAiSummary, aiSummary, aiSummaryHtml, aiLoading, aiError, aiConfigured,
      copyAiSummary, aiCopyOk, aiAttribution,
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
            <div class="flex gap-2">
              <input v-model="filter.q" class="input" placeholder="бюджет, КЦСР, наименование..." />
              <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3"
                      :disabled="!speechSupported"
                      @click="startVoiceInputCompare">
                {{ voiceListening ? 'Стоп' : '🎤' }}
              </button>
            </div>
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

        <div class="flex gap-2 mt-4 flex-wrap">
          <button class="btn bg-brand-600 hover:bg-brand-700 text-white" :disabled="loading" @click="run">
            <span v-if="!loading">Сравнить</span><span v-else>Считаем…</span>
          </button>
          <button class="btn bg-emerald-600 hover:bg-emerald-700 text-white" :disabled="!result" @click="exportXlsx">Экспорт в Excel</button>
          <button class="btn bg-rose-600 hover:bg-rose-700 text-white" :disabled="!result" @click="downloadPdfCompare">Скачать PDF</button>
          <button class="btn bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5"
                  :disabled="!result"
                  @click="exportCurrentCompareChartPng">
            Экспорт диаграммы PNG
          </button>
          <select v-model="chartType" class="input !w-auto min-w-[170px] text-xs">
            <option value="bar">График: Столбцы</option>
            <option value="line">График: Линия</option>
            <option value="radar">График: Радар</option>
            <option value="pie">График: Круговая</option>
            <option value="doughnut">График: Кольцевая</option>
          </select>
          <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button class="px-3 py-1 rounded-md text-sm transition"
                    :class="viewMode === 'table' ? 'bg-white shadow text-slate-900' : 'text-slate-500'"
                    @click="viewMode = 'table'">Таблица</button>
            <button class="px-3 py-1 rounded-md text-sm transition"
                    :class="viewMode === 'chart' ? 'bg-white shadow text-slate-900' : 'text-slate-500'"
                    @click="viewMode = 'chart'">График</button>
          </div>
        </div>

        <div v-if="result" class="mt-4 rounded-xl shadow-card p-5 border border-violet-100 bg-gradient-to-br from-violet-50 to-slate-50">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div class="font-semibold text-slate-900">ИИ-сводка сравнения (GigaChat)</div>
              <div class="text-xs text-slate-500 mt-0.5">Краткий разбор изменений между периодами по тем же фильтрам</div>
            </div>
            <button type="button"
                    class="btn shrink-0 bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-lg"
                    :disabled="loading || aiLoading || !result || result.rows.length === 0"
                    @click="fetchAiSummaryCompare">
              <span v-if="!aiLoading">Сводка по сравнению</span>
              <span v-else>Генерация…</span>
            </button>
          </div>
          <p v-if="aiConfigured === false" class="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Задайте <code class="text-xs">GIGACHAT_CREDENTIALS</code> в <code class="text-xs">.env</code> и перезапустите сервер.
          </p>
          <div v-if="aiError" class="mt-3 text-sm text-red-600">{{ aiError }}</div>
          <div v-if="aiSummary" class="mt-3 border-t border-violet-100/80 pt-3">
            <div class="flex flex-wrap items-center justify-end gap-2 mb-2">
              <div class="flex items-center gap-2">
                <span v-if="aiCopyOk" class="text-xs text-emerald-600 font-medium">Скопировано в буфер</span>
                <button type="button"
                        class="text-xs font-semibold text-violet-800 bg-white border border-violet-200 hover:bg-violet-50 rounded-lg px-3 py-1.5"
                        @click="copyAiSummary">
                  Копировать сводку
                </button>
              </div>
            </div>
            <div class="ai-md-content" v-html="aiSummaryHtml"></div>
            <p class="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400 text-right">{{ aiAttribution }}</p>
          </div>
        </div>
      </div>

      <div v-if="result" class="space-y-4">
        <div v-show="viewMode === 'table'" class="bg-white rounded-xl shadow-card overflow-hidden">
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
                  <div class="inline-flex flex-col items-end gap-1">
                    <span class="delta-chip" :class="deltaChipClass(r.delta[ind.id].abs)">
                      {{ deltaSign(r.delta[ind.id].abs) }}{{ fmtMoney(Math.abs(r.delta[ind.id].abs || 0)) }}
                    </span>
                    <span class="delta-chip delta-chip-sm" :class="deltaChipClass(r.delta[ind.id].abs)">
                      {{ fmtPct(r.delta[ind.id].pct) }}
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
            </table>
          </div>
        </div>

        <div v-show="viewMode === 'chart'" class="bg-white rounded-xl shadow-card p-4">
          <div style="position: relative; height: 540px;">
            <canvas ref="compareChartCanvas"></canvas>
          </div>
        </div>
      </div>
      <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{{ error }}</div>
    </div>
  `,
  setup() {
    const STORAGE_KEY = 'amurcode.compareState.v1';
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
    const speechSupported = ref(Boolean(getSpeechRecognitionCtor()));
    const voiceListening = ref(false);
    const aiSummary = ref('');
    const aiLoading = ref(false);
    const aiError = ref('');
    const aiConfigured = ref(null);
    const aiCopyOk = ref(false);
    const viewMode = ref('table');
    const chartType = ref('bar');
    const compareChartCanvas = ref(null);
    let compareChartInstance = null;
    let autoCompareTimer = null;
    let saveStateTimer = null;
    let activeRecognition = null;
    let historyReplayIgnoreWatch = false;

    const aiSummaryHtml = computed(() => aiMarkdownToHtml(aiSummary.value));
    const aiAttribution = AI_ATTRIBUTION;

    async function copyAiSummary() {
      const text = aiSummaryCopyText(aiSummary.value);
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        aiCopyOk.value = true;
        setTimeout(() => { aiCopyOk.value = false; }, 2500);
      } catch {
        aiCopyOk.value = false;
      }
    }

    function saveState() {
      if (saveStateTimer) clearTimeout(saveStateTimer);
      saveStateTimer = setTimeout(() => {
        writeStorageJson(STORAGE_KEY, {
          filter: { ...filter },
          selectedIndicators: selectedIndicators.value,
          periods: JSON.parse(JSON.stringify(periods)),
          viewMode: viewMode.value,
          chartType: chartType.value,
        });
      }, 250);
    }

    function restoreState() {
      const s = readStorageJson(STORAGE_KEY, null);
      if (!s || typeof s !== 'object') return;
      const f = s.filter && typeof s.filter === 'object' ? s.filter : {};
      filter.q = String(f.q || '');
      filter.budget = String(f.budget || '');
      filter.kfsr = String(f.kfsr || '');
      filter.kcsr = String(f.kcsr || '');
      if (Array.isArray(s.selectedIndicators) && s.selectedIndicators.length) {
        selectedIndicators.value = s.selectedIndicators.slice(0, 50);
      }
      if (Array.isArray(s.periods) && s.periods.length >= 2) {
        periods[0].from = String(s.periods[0]?.from || periods[0].from);
        periods[0].to = String(s.periods[0]?.to || periods[0].to);
        periods[0].label = String(s.periods[0]?.label || periods[0].label);
        periods[1].from = String(s.periods[1]?.from || periods[1].from);
        periods[1].to = String(s.periods[1]?.to || periods[1].to);
        periods[1].label = String(s.periods[1]?.label || periods[1].label);
      }
      viewMode.value = s.viewMode === 'chart' ? 'chart' : 'table';
      chartType.value = String(s.chartType || 'bar');
    }

    function applyCompareSnapshot(s) {
      if (!s || typeof s !== 'object') return;
      if (autoCompareTimer) clearTimeout(autoCompareTimer);
      historyReplayIgnoreWatch = true;
      const f = s.filter && typeof s.filter === 'object' ? s.filter : {};
      filter.q = String(f.q || '');
      filter.budget = String(f.budget || '');
      filter.kfsr = String(f.kfsr || '');
      filter.kcsr = String(f.kcsr || '');
      if (Array.isArray(s.selectedIndicators) && s.selectedIndicators.length) {
        selectedIndicators.value = s.selectedIndicators.slice(0, 50);
      }
      if (Array.isArray(s.periods) && s.periods.length >= 2) {
        periods[0].from = String(s.periods[0]?.from || periods[0].from);
        periods[0].to = String(s.periods[0]?.to || periods[0].to);
        periods[0].label = String(s.periods[0]?.label || periods[0].label);
        periods[1].from = String(s.periods[1]?.from || periods[1].from);
        periods[1].to = String(s.periods[1]?.to || periods[1].to);
        periods[1].label = String(s.periods[1]?.label || periods[1].label);
      }
      viewMode.value = s.viewMode === 'chart' ? 'chart' : 'table';
      chartType.value = String(s.chartType || 'bar');
    }

    onMounted(async () => {
      restoreState();
      try {
        const meta = await api('/indicators');
        indicators.value = meta.indicators;
        const d = await api('/dictionary/budget');
        dictBudget.value = d.items;
        try {
          const st = await api('/ai/status');
          aiConfigured.value = st.configured === true;
        } catch {
          aiConfigured.value = false;
        }
      } catch (e) { error.value = asErrorMessage(e, 'Ошибка выполнения сравнения'); }

      const pendingSnap = takePendingHistoryNavigation('compare');
      if (pendingSnap && typeof pendingSnap === 'object') {
        applyCompareSnapshot(pendingSnap);
        await nextTick();
        try {
          await run({ silent: false, skipHistory: true });
        } finally {
          setTimeout(() => { historyReplayIgnoreWatch = false; }, 520);
        }
      }
    });

    function toggleIndicator(id) {
      const i = selectedIndicators.value.indexOf(id);
      if (i === -1) selectedIndicators.value.push(id);
      else selectedIndicators.value.splice(i, 1);
    }
    function deltaClass(n) { return n > 0 ? 'delta-pos' : n < 0 ? 'delta-neg' : 'delta-zero'; }
    function deltaChipClass(n) { return n > 0 ? 'delta-chip-pos' : n < 0 ? 'delta-chip-neg' : 'delta-chip-zero'; }
    function deltaSign(n) { return n > 0 ? '+' : n < 0 ? '−' : ''; }

    function stopVoiceInputCompare() {
      if (activeRecognition) {
        try { activeRecognition.stop(); } catch {}
        activeRecognition = null;
      }
      voiceListening.value = false;
    }

    function startVoiceInputCompare() {
      if (!speechSupported.value) {
        setUiError(error, 'Голосовой ввод не поддерживается в этом браузере.');
        return;
      }
      if (voiceListening.value) {
        stopVoiceInputCompare();
        return;
      }
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setUiError(error, 'SpeechRecognition API недоступен.');
        return;
      }
      const rec = new Ctor();
      activeRecognition = rec;
      voiceListening.value = true;
      rec.lang = 'ru-RU';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = async (event) => {
        const text = String(event?.results?.[0]?.[0]?.transcript || '').trim();
        if (!text) return;
        try {
          const out = await processVoiceCommand(text, { enableObjectMatch: true });
          const normalized = String(out.normalized || text).trim() || text;
          filter.q = normalized;
          if (out.changed) showUiToast(`GigaChat исправил запрос: "${normalized}"`, 1500);
          else showUiToast('GigaChat проверил запрос', 1100);
          if (out.bestObject) {
            filter.budget = out.bestObject.budget || filter.budget;
            filter.kfsr = out.bestObject.kfsr || filter.kfsr;
            filter.kcsr = out.bestObject.kcsr || filter.kcsr;
            showUiToast(`Подобран объект: ${out.bestObject.kcsr || '—'}`, 1400);
          }
        } catch (e) {
          setUiError(error, asErrorMessage(e, 'Не удалось обработать голосовую команду через GigaChat'));
        }
      };
      rec.onerror = (event) => {
        setUiError(error, speechErrorMessage(event?.error));
      };
      rec.onend = () => {
        if (activeRecognition === rec) activeRecognition = null;
        voiceListening.value = false;
      };
      try {
        rec.start();
      } catch {
        setUiError(error, 'Не удалось запустить голосовой ввод.');
        stopVoiceInputCompare();
      }
    }

    async function run({ silent = false, skipHistory = false } = {}) {
      if (!silent) loading.value = true;
      if (!silent) error.value = '';
      try {
        result.value = await api('/compare', {
          indicators: selectedIndicators.value,
          filter: { ...filter },
          periods: JSON.parse(JSON.stringify(periods)),
          strategy: 'latest',
        });
        const rowsCount = Number(result.value?.rows?.length || 0);
        const pA = `${periods[0].from}->${periods[0].to}`;
        const pB = `${periods[1].from}->${periods[1].to}`;
        if (!silent && !skipHistory) {
          pushHistory('Сравнение', {
            title: 'Выполнено сравнение периодов',
            details: `A: ${pA}; B: ${pB}; строк: ${rowsCount}${compactFilterSummary(filter) ? `; ${compactFilterSummary(filter)}` : ''}`,
            meta: {
              tab: 'compare',
              snapshot: {
                filter: { ...filter },
                selectedIndicators: selectedIndicators.value.slice(0, 50),
                periods: JSON.parse(JSON.stringify(periods)),
                viewMode: viewMode.value,
                chartType: chartType.value,
                rowsCount,
              },
            },
          });
        }
        await nextTick();
        if (viewMode.value === 'chart') drawCompareChart();
      } catch (e) { error.value = asErrorMessage(e, 'Ошибка экспорта сравнения в Excel'); }
      finally { if (!silent) loading.value = false; }
    }
    async function exportXlsx() {
      try {
        await nextTick();
        drawCompareChart();
        const chartImages = buildCompareChartImagesForExport();
        await downloadXlsx('/export/compare-xlsx', {
          indicators: selectedIndicators.value,
          filter: { ...filter },
          periods: JSON.parse(JSON.stringify(periods)),
          strategy: 'latest',
          chartImageBase64: chartToPngDataUrl(compareChartCanvas.value),
          chartImages,
        }, `compare_${new Date().toISOString().slice(0, 10)}.xlsx`);
      } catch (e) { error.value = asErrorMessage(e, 'Ошибка загрузки метаданных сравнения'); }
    }

    function downloadPdfCompare() {
      if (!result.value) return;
      if (!hasPdfMake()) {
        setUiError(error, 'PDF-библиотека не загружена');
        return;
      }
      const cfg = buildCompareChartConfig(chartType.value);
      const chartPng = cfg ? getChartPngWithFallback(cfg, compareChartCanvas.value) : '';

      const p = result.value.periods || [];
      const p1 = p[0] ? `${p[0].label || 'A'}: ${p[0].from}→${p[0].to}` : 'A: —';
      const p2 = p[1] ? `${p[1].label || 'B'}: ${p[1].from}→${p[1].to}` : 'B: —';

      const headers = ['Бюджет', 'КФСР', 'КЦСР', 'КВР'];
      for (const ind of (result.value.indicators || [])) {
        for (const period of (result.value.periods || [])) {
          headers.push(`${ind.label} [${period.label || `${period.from}-${period.to}`}]`);
        }
        headers.push(`Δ ${ind.label}`);
        headers.push(`Δ% ${ind.label}`);
      }

      const body = (result.value.rows || []).map(r => {
        const row = [r.budget || '—', r.kfsr || '—', r.kcsr || '—', r.kvr || '—'];
        for (const ind of (result.value.indicators || [])) {
          for (let i = 0; i < (result.value.periods || []).length; i++) {
            row.push(fmtMoney(r.periods?.[i]?.[ind.id] || 0));
          }
          row.push(fmtMoney(r.delta?.[ind.id]?.abs || 0));
          row.push(fmtPct(r.delta?.[ind.id]?.pct));
        }
        return row;
      });

      const docDefinition = {
        pageOrientation: 'landscape',
        pageSize: 'A4',
        pageMargins: [24, 24, 24, 24],
        defaultStyle: { font: 'Roboto', fontSize: 8 },
        content: [
          { text: 'Печатная форма · Сравнение', style: 'h1' },
          { text: `${p1} | ${p2}`, color: '#475569', margin: [0, 0, 0, 8] },
          chartPng ? { image: chartPng, fit: [760, 320], margin: [0, 0, 0, 8] } : { text: 'Диаграмма недоступна', color: '#64748b', margin: [0, 0, 0, 8] },
          {
            table: { headerRows: 1, widths: Array(headers.length).fill('auto'), body: [headers, ...body] },
            layout: 'lightHorizontalLines',
          },
          aiSummary.value ? { text: `ИИ-сводка:\n${aiSummary.value}`, margin: [0, 10, 0, 0] } : {},
        ],
        styles: { h1: { fontSize: 14, bold: true } },
      };
      downloadPdfViaPdfMake(docDefinition, pdfSaveName('compare'));
    }

    async function fetchAiSummaryCompare() {
      aiLoading.value = true;
      aiError.value = '';
      aiSummary.value = '';
      try {
        const data = await api('/ai/summary', {
          kind: 'compare',
          indicators: selectedIndicators.value,
          filter: { ...filter },
          periods: JSON.parse(JSON.stringify(periods)),
          strategy: 'latest',
        });
        aiSummary.value = data.summary || '';
      } catch (e) {
        aiError.value = e.message || String(e);
      } finally {
        aiLoading.value = false;
      }
    }

    watch(viewMode, async (v) => {
      if (v === 'chart' && result.value) {
        await nextTick();
        drawCompareChart();
      }
    });

    watch(chartType, async () => {
      if (viewMode.value === 'chart' && result.value) {
        await nextTick();
        drawCompareChart();
      }
    });

    function scheduleAutoCompare() {
      if (historyReplayIgnoreWatch) return;
      if (autoCompareTimer) clearTimeout(autoCompareTimer);
      autoCompareTimer = setTimeout(() => {
        if (historyReplayIgnoreWatch) return;
        if (selectedIndicators.value.length > 0) run({ silent: true });
      }, 450);
    }

    watch(filter, scheduleAutoCompare, { deep: true });
    watch(selectedIndicators, scheduleAutoCompare, { deep: true });
    watch(periods, scheduleAutoCompare, { deep: true });
    watch([viewMode, chartType], saveState);
    watch(filter, saveState, { deep: true });
    watch(selectedIndicators, saveState, { deep: true });
    watch(periods, saveState, { deep: true });

    onUnmounted(() => {
      if (autoCompareTimer) clearTimeout(autoCompareTimer);
      if (saveStateTimer) clearTimeout(saveStateTimer);
      if (compareChartInstance) compareChartInstance.destroy();
      stopVoiceInputCompare();
    });

    function buildCompareChartConfig(selectedTypeInput) {
      if (!result.value) return null;
      const selectedType = selectedTypeInput || chartType.value;
      const inds = result.value.indicators || [];
      const rowsTop = (result.value.rows || []).slice(0, 12);
      const palette = ['#3a6dff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
      let labels = rowsTop.map(r => `${r.kcsr || r.kfsr || ''} · ${String(r.budget || '').slice(0, 28)}`);
      let datasets;
      if (selectedType === 'pie' || selectedType === 'doughnut') {
        const head = inds[0];
        if (!head) return null;
        datasets = [{
          label: `|Δ| ${head.label}`,
          data: rowsTop.map(r => Math.abs(r.delta?.[head.id]?.abs || 0)),
          backgroundColor: rowsTop.map((_, i) => palette[i % palette.length] + 'cc'),
          borderColor: rowsTop.map((_, i) => palette[i % palette.length]),
          borderWidth: 1,
          _indicatorId: head.id,
        }];
      } else if (selectedType === 'radar') {
        const head = inds[0];
        if (!head) return null;
        labels = rowsTop.map(r => `${r.kcsr || r.kfsr || ''}`);
        datasets = [{
          label: `Δ ${head.label}`,
          data: rowsTop.map(r => r.delta?.[head.id]?.abs || 0),
          backgroundColor: palette[0] + '33',
          borderColor: palette[0],
          borderWidth: 2,
          _indicatorId: head.id,
        }];
      } else {
        datasets = inds.map((ind, idx) => ({
          label: `Δ ${ind.label}`,
          data: rowsTop.map(r => r.delta?.[ind.id]?.abs || 0),
          backgroundColor: palette[idx % palette.length] + 'cc',
          borderColor: palette[idx % palette.length],
          borderWidth: 1,
          borderRadius: 4,
          _indicatorId: ind.id,
        }));
      }
      return {
        type: selectedType,
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            title: {
              display: true,
              text: selectedType === 'pie' || selectedType === 'doughnut' || selectedType === 'radar'
                ? `Изменение по показателю: ${(inds[0]?.label || '—')}`
                : 'Сравнение Δ по показателям',
            },
            legend: { position: 'top' },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const raw = Number(typeof ctx.parsed === 'object' ? (ctx.parsed?.y ?? ctx.raw) : (ctx.parsed ?? ctx.raw)) || 0;
                  const arr = Array.isArray(ctx.dataset.data) ? ctx.dataset.data.map(v => Number(v) || 0) : [];
                  const total = arr.reduce((a, b) => a + b, 0);
                  const indId = ctx.dataset._indicatorId;
                  let line = `${ctx.dataset.label}: ${fmtMoney(raw)}`;
                  if (selectedType === 'pie' || selectedType === 'doughnut') {
                    line += ` · ${fmtSharePct(raw, total)}`;
                  } else if (total !== 0) {
                    line += ` · доля ${fmtSharePct(raw, total)}`;
                  }
                  const row = rowsTop[ctx.dataIndex];
                  const pct = row?.delta?.[indId]?.pct;
                  if (pct !== null && pct !== undefined && Number.isFinite(pct)) {
                    line += ` · Δ% ${fmtPct(pct)}`;
                  }
                  return line;
                },
              },
            },
          },
          scales: selectedType === 'pie' || selectedType === 'doughnut'
            ? {}
            : {
                x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 30 } },
                y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v) } },
              },
        },
      };
    }

    function drawCompareChart() {
      if (!compareChartCanvas.value || !result.value) return;
      if (compareChartInstance) compareChartInstance.destroy();
      const config = buildCompareChartConfig(chartType.value);
      if (!config) return;
      compareChartInstance = new Chart(compareChartCanvas.value, config);
    }

    function buildCompareChartImagesForExport() {
      if (!result.value) return [];
      const kinds = ['bar', 'line', 'radar', 'pie', 'doughnut'];
      const titleMap = {
        bar: 'Сравнение · Столбцы',
        line: 'Сравнение · Линия',
        radar: 'Сравнение · Радар',
        pie: 'Сравнение · Круговая',
        doughnut: 'Сравнение · Кольцевая',
      };
      const out = [];
      for (const kind of kinds) {
        const cfg = buildCompareChartConfig(kind);
        if (!cfg) continue;
        const png = renderChartConfigToPngDataUrl(cfg);
        if (!png) continue;
        out.push({ title: titleMap[kind], imageBase64: png });
      }
      return out;
    }

    function exportCurrentCompareChartPng() {
      if (!result.value) return;
      const cfg = buildCompareChartConfig(chartType.value);
      if (!cfg) {
        setUiError(error, 'Не удалось построить диаграмму сравнения для экспорта');
        return;
      }
      const png = getChartPngWithFallback(cfg, compareChartCanvas.value);
      const d = new Date().toISOString().slice(0, 10);
      const ok = downloadDataUrl(png, `compare_chart_${chartType.value}_${d}.png`);
      if (!ok) setUiError(error, 'Экспорт PNG не удался: диаграмма не сформирована');
    }

    function exportAllCompareChartsPng() {
      if (!result.value) return;
      const kinds = ['bar', 'line', 'radar', 'pie', 'doughnut'];
      const d = new Date().toISOString().slice(0, 10);
      let idx = 0;
      for (const kind of kinds) {
        const cfg = buildCompareChartConfig(kind);
        if (!cfg) continue;
        const png = getChartPngWithFallback(cfg, compareChartCanvas.value);
        if (!png) continue;
        setTimeout(() => {
          const ok = downloadDataUrl(png, `compare_${kind}_${d}.png`);
          if (!ok) setUiError(error, 'Один из PNG сравнения не сформировался корректно');
        }, idx * 150);
        idx += 1;
      }
    }

    function printFormCompare() {
      if (!result.value) return;
      const cfg = buildCompareChartConfig(chartType.value);
      const chartPng = cfg ? getChartPngWithFallback(cfg, compareChartCanvas.value) : '';
      const head = (result.value.indicators || []).map(ind => {
        const cols = (result.value.periods || []).map((p, pi) => `<th class="num">${htmlEsc(ind.label)} [${htmlEsc(p.label || `${p.from}–${p.to}`)}]</th>`).join('');
        return `${cols}<th class="num">Δ ${htmlEsc(ind.label)}</th><th class="num">Δ% ${htmlEsc(ind.label)}</th>`;
      }).join('');
      const rowsHtml = (result.value.rows || []).map(r => {
        const vals = (result.value.indicators || []).map(ind => {
          const periodVals = (r.periods || []).map((p) => `<td class="num">${htmlEsc(fmtMoney(p[ind.id] || 0))}</td>`).join('');
          const dAbs = r.delta?.[ind.id]?.abs || 0;
          const dPct = r.delta?.[ind.id]?.pct;
          return `${periodVals}<td class="num">${htmlEsc(fmtMoney(dAbs))}</td><td class="num">${htmlEsc(fmtPct(dPct))}</td>`;
        }).join('');
        return `<tr>
          <td>${htmlEsc(r.budget || '—')}</td>
          <td>${htmlEsc(r.kfsr || '—')}</td>
          <td>${htmlEsc(r.kcsr || '—')}</td>
          <td>${htmlEsc(r.kvr || '—')}</td>
          ${vals}
        </tr>`;
      }).join('');
      const sectionsHtml = `
        <h2>Параметры сравнения</h2>
        <div class="card">
          ${(result.value.periods || []).map((p, i) => `<p class="kv"><b>Период ${i + 1}:</b> ${htmlEsc(p.label || '')} ${htmlEsc(p.from || '—')} → ${htmlEsc(p.to || '—')}</p>`).join('')}
          <p class="kv"><b>Показатели:</b> ${htmlEsc((result.value.indicators || []).map(i => i.label).join('; '))}</p>
          <p class="kv muted"><b>Сформировано:</b> ${htmlEsc(new Date().toLocaleString('ru-RU'))}</p>
        </div>

        <h2>Диаграмма (${htmlEsc(chartType.value)})</h2>
        <div class="img-wrap">${chartPng ? `<img src="${chartPng}" alt="chart">` : '<div class="muted">Диаграмма недоступна</div>'}</div>

        <h2>Таблица сравнения (${htmlEsc(String(result.value.rows?.length || 0))} строк)</h2>
        <table>
          <thead>
            <tr>
              <th>Бюджет</th>
              <th>КФСР</th>
              <th>КЦСР</th>
              <th>КВР</th>
              ${head}
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${aiSummary.value ? `<h2>ИИ-сводка</h2><div class="card">${aiMarkdownToHtml(aiSummary.value)}</div>` : ''}
      `;
      openPrintableHtml({
        title: 'Печатная форма · Сравнение',
        subtitle: 'Конструктор аналитических выборок',
        sectionsHtml,
      });
    }

    return {
      indicators, dictBudget, filter, selectedIndicators, periods,
      speechSupported, voiceListening, startVoiceInputCompare,
      result, error, loading, viewMode, chartType, compareChartCanvas, toggleIndicator, run, exportXlsx,
      downloadPdfCompare, printFormCompare,
      exportCurrentCompareChartPng, exportAllCompareChartsPng,
      fetchAiSummaryCompare, aiSummary, aiSummaryHtml, aiLoading, aiError, aiConfigured,
      copyAiSummary, aiCopyOk, aiAttribution,
      deltaClass, deltaChipClass, deltaSign, fmtMoney, fmtPct,
    };
  },
};

// ---------- Компонент: Файлы пользователя ----------
const UserDataTab = {
  template: `
    <div class="space-y-4">
      <div class="bg-white rounded-xl shadow-card p-5">
        <h3 class="font-semibold text-slate-900 mb-3">Загрузка пользовательского файла</h3>
        <div class="flex flex-col md:flex-row md:items-center gap-3">
          <input type="file" accept=".csv,.xls,.xlsx" @change="onFileChange" class="input md:max-w-sm" />
          <button class="btn bg-brand-600 hover:bg-brand-700 text-white" :disabled="uploading || !selectedFile" @click="uploadFile">
            <span v-if="!uploading">Загрузить файл</span>
            <span v-else>Загрузка...</span>
          </button>
          <button class="btn bg-slate-200 hover:bg-slate-300 text-slate-800" :disabled="clearing || !meta.hasData" @click="clearData">
            Очистить
          </button>
        </div>
        <p class="text-xs text-slate-500 mt-2">Поддерживаются форматы CSV, XLS и XLSX. Используется первый лист Excel.</p>
        <div v-if="meta.hasData" class="mt-3 text-sm text-slate-700">
          Загружен файл: <span class="font-medium">{{ meta.fileName }}</span> ·
          строк: <span class="font-medium">{{ meta.rowCount }}</span> ·
          колонок: <span class="font-medium">{{ meta.columns.length }}</span>
        </div>
        <div v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</div>
      </div>

      <div v-if="meta.hasData" class="bg-white rounded-xl shadow-card p-5 space-y-4">
        <h3 class="font-semibold text-slate-900">Фильтры</h3>
        <div>
          <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Глобальный поиск</label>
          <div class="flex gap-2">
            <input v-model="q" class="input" placeholder="Поиск по всем колонкам..." />
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3"
                    :disabled="!speechSupported"
                    @click="startVoiceInputUserData">
              {{ voiceListening ? 'Стоп' : '🎤' }}
            </button>
          </div>
        </div>

        <div class="space-y-2">
          <div v-for="(f, idx) in filters" :key="idx" class="grid grid-cols-1 md:grid-cols-12 gap-2">
            <select v-model="f.column" class="input md:col-span-4">
              <option value="">Колонка...</option>
              <option v-for="col in meta.columns" :key="col" :value="col">{{ col }}</option>
            </select>
            <select v-model="f.mode" class="input md:col-span-3">
              <option value="contains">Содержит</option>
              <option value="equals">Равно</option>
              <option value="startsWith">Начинается с</option>
            </select>
            <input v-model="f.value" class="input md:col-span-4" placeholder="Значение фильтра..." />
            <button class="btn bg-red-50 text-red-700 border border-red-200 md:col-span-1" @click="removeFilter(idx)">✕</button>
          </div>
          <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-800" @click="addFilter">+ Добавить фильтр</button>
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="btn bg-brand-600 hover:bg-brand-700 text-white" :disabled="loadingRows" @click="runQuery(0)">
            <span v-if="!loadingRows">Применить фильтры</span>
            <span v-else>Загрузка...</span>
          </button>
          <button class="btn bg-slate-200 hover:bg-slate-300 text-slate-800" :disabled="loadingRows || offset === 0" @click="runQuery(Math.max(offset - limit, 0))">← Назад</button>
          <button class="btn bg-slate-200 hover:bg-slate-300 text-slate-800" :disabled="loadingRows || (offset + limit) >= total" @click="runQuery(offset + limit)">Вперёд →</button>
          <div class="text-sm text-slate-600 self-center">Показано {{ rows.length }} из {{ total }}</div>
        </div>
      </div>

      <div v-if="meta.hasData" class="bg-white rounded-xl shadow-card overflow-hidden">
        <div class="max-h-[640px] overflow-auto scroll-thin">
          <table class="data-table">
            <thead>
              <tr>
                <th v-for="col in columns" :key="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in rows" :key="idx">
                <td v-for="col in columns" :key="col + '_' + idx">{{ row[col] }}</td>
              </tr>
              <tr v-if="rows.length === 0">
                <td :colspan="Math.max(columns.length, 1)" class="text-slate-500">Нет данных по текущему фильтру</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  setup() {
    const selectedFile = ref(null);
    const speechSupported = ref(Boolean(getSpeechRecognitionCtor()));
    const voiceListening = ref(false);
    const uploading = ref(false);
    const clearing = ref(false);
    const loadingRows = ref(false);
    const error = ref('');

    const meta = reactive({
      hasData: false,
      fileName: '',
      rowCount: 0,
      columns: [],
      loadedAt: '',
    });

    const q = ref('');
    const filters = ref([{ column: '', mode: 'contains', value: '' }]);
    const columns = ref([]);
    const rows = ref([]);
    const total = ref(0);
    const offset = ref(0);
    const limit = ref(200);
    let activeRecognition = null;

    async function loadMeta() {
      try {
        const m = await api('/user-data/meta');
        Object.assign(meta, m);
      } catch (e) {
        error.value = asErrorMessage(e, 'Ошибка загрузки метаданных файла');
      }
    }

    function onFileChange(event) {
      const file = event?.target?.files?.[0] || null;
      selectedFile.value = file;
    }

    function stopVoiceInputUserData() {
      if (activeRecognition) {
        try { activeRecognition.stop(); } catch {}
        activeRecognition = null;
      }
      voiceListening.value = false;
    }

    function startVoiceInputUserData() {
      if (!speechSupported.value) {
        setUiError(error, 'Голосовой ввод не поддерживается в этом браузере.');
        return;
      }
      if (voiceListening.value) {
        stopVoiceInputUserData();
        return;
      }
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setUiError(error, 'SpeechRecognition API недоступен.');
        return;
      }
      const rec = new Ctor();
      activeRecognition = rec;
      voiceListening.value = true;
      rec.lang = 'ru-RU';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = async (event) => {
        const text = String(event?.results?.[0]?.[0]?.transcript || '').trim();
        if (!text) return;
        try {
          const out = await processVoiceCommand(text, { enableObjectMatch: true });
          const normalized = String(out.normalized || text).trim() || text;
          q.value = normalized;
          if (out.changed) showUiToast(`GigaChat исправил запрос: "${normalized}"`, 1500);
          else showUiToast('GigaChat проверил запрос', 1100);
        } catch (e) {
          setUiError(error, asErrorMessage(e, 'Не удалось обработать голосовую команду через GigaChat'));
        }
      };
      rec.onerror = (event) => {
        setUiError(error, speechErrorMessage(event?.error));
      };
      rec.onend = () => {
        if (activeRecognition === rec) activeRecognition = null;
        voiceListening.value = false;
      };
      try {
        rec.start();
      } catch {
        setUiError(error, 'Не удалось запустить голосовой ввод.');
        stopVoiceInputUserData();
      }
    }

    async function uploadFile() {
      if (!selectedFile.value) return;
      uploading.value = true;
      error.value = '';
      try {
        const fd = new FormData();
        fd.append('file', selectedFile.value);
        const res = await fetch('/api/user-data/upload', { method: 'POST', body: fd });
        if (!res.ok) {
          throw new Error(await parseHttpError(res, 'Ошибка загрузки файла'));
        }
        const data = await res.json();
        Object.assign(meta, {
          hasData: true,
          fileName: data.fileName,
          rowCount: data.rowCount,
          columns: data.columns,
          loadedAt: data.loadedAt,
        });
        await runQuery(0);
      } catch (e) {
        error.value = asErrorMessage(e, 'Ошибка загрузки файла');
      } finally {
        uploading.value = false;
      }
    }

    async function runQuery(nextOffset = 0) {
      loadingRows.value = true;
      error.value = '';
      try {
        const payload = {
          q: q.value,
          filters: filters.value.filter(f => f.column && String(f.value || '').trim()),
          limit: limit.value,
          offset: nextOffset,
        };
        const result = await api('/user-data/query', payload);
        columns.value = result.columns || [];
        rows.value = result.rows || [];
        total.value = result.total || 0;
        offset.value = result.offset || 0;
        limit.value = result.limit || limit.value;
      } catch (e) {
        error.value = asErrorMessage(e, 'Ошибка запроса к данным файла');
      } finally {
        loadingRows.value = false;
      }
    }

    async function clearData() {
      clearing.value = true;
      error.value = '';
      try {
        const res = await fetch('/api/user-data', { method: 'DELETE' });
        if (!res.ok) throw new Error(await parseHttpError(res, 'Не удалось очистить загруженные данные'));
        Object.assign(meta, { hasData: false, fileName: '', rowCount: 0, columns: [], loadedAt: '' });
        rows.value = [];
        columns.value = [];
        total.value = 0;
        offset.value = 0;
      } catch (e) {
        error.value = asErrorMessage(e, 'Ошибка очистки загруженных данных');
      } finally {
        clearing.value = false;
      }
    }

    function addFilter() {
      filters.value.push({ column: '', mode: 'contains', value: '' });
    }

    function removeFilter(idx) {
      filters.value.splice(idx, 1);
      if (filters.value.length === 0) addFilter();
    }

    onMounted(async () => {
      await loadMeta();
      if (meta.hasData) await runQuery(0);
    });
    onUnmounted(() => {
      stopVoiceInputUserData();
    });

    return {
      selectedFile,
      uploading,
      clearing,
      loadingRows,
      speechSupported,
      voiceListening,
      error,
      meta,
      q,
      filters,
      columns,
      rows,
      total,
      offset,
      limit,
      onFileChange,
      startVoiceInputUserData,
      uploadFile,
      runQuery,
      clearData,
      addFilter,
      removeFilter,
    };
  },
};

// ---------- Компонент: Custom Dashboard ----------
const DashboardTabLegacy = {
  template: `
    <div class="space-y-4">
      <div class="bg-white rounded-xl shadow-card p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold text-slate-900">Live-диаграмма из Конструктора выборок</h3>
            <p class="text-xs text-slate-500 mt-0.5">Данные обновляются автоматически после изменения выборки.</p>
          </div>
          <div class="text-xs text-slate-500">Обновлено: {{ liveUpdatedAt || '—' }}</div>
        </div>
        <div v-if="!liveState" class="mt-3 text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-4">
          Пока нет данных. Перейдите в «Конструктор выборок» и выполните запрос.
        </div>
        <div v-else class="mt-3">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Показатели в диаграмме</label>
              <div class="flex flex-wrap gap-1 border border-slate-200 rounded-lg p-2 max-h-28 overflow-auto">
                <button v-for="ind in liveIndicatorOptions" :key="ind.id"
                        class="indicator-pill"
                        :class="{ active: liveSelectedIndicators.includes(ind.id) }"
                        @click="toggleLiveIndicator(ind.id)">
                  {{ ind.label }}
                </button>
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Количество объектов</label>
              <input v-model.number="liveTopN" type="number" min="3" max="30" class="input" />
              <div class="text-xs text-slate-500 mt-1">Сколько строк выборки показывать на диаграмме (3-30).</div>
            </div>
          </div>

          <div class="flex flex-wrap gap-2 mb-3">
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5"
                    :class="liveChartType === 'bar' ? 'border border-brand-300' : ''"
                    @click="liveChartType = 'bar'">Столбцы</button>
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5"
                    :class="liveChartType === 'line' ? 'border border-brand-300' : ''"
                    @click="liveChartType = 'line'">Линия</button>
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5"
                    :class="liveChartType === 'pie' ? 'border border-brand-300' : ''"
                    @click="liveChartType = 'pie'">Круговая</button>
          </div>
          <div style="position: relative; height: 420px;">
            <canvas ref="liveChartCanvas"></canvas>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-card p-5">
        <div class="flex flex-col lg:flex-row lg:items-end gap-3">
          <div class="flex-1">
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Название виджета</label>
            <input v-model="form.title" class="input" placeholder="Например: Исполнение бюджета за месяц" />
          </div>
          <div class="w-full lg:w-52">
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Тип</label>
            <select v-model="form.type" class="input">
              <option value="kpi">KPI</option>
              <option value="text">Текст</option>
              <option value="list">Список</option>
            </select>
          </div>
          <div class="w-full lg:w-56">
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Значение / текст</label>
            <input v-model="form.value" class="input" placeholder="Значение виджета" />
          </div>
          <button class="btn bg-brand-600 hover:bg-brand-700 text-white" @click="addWidget">Добавить виджет</button>
        </div>
        <div class="mt-2 text-xs text-slate-500">Дашборд сохраняется автоматически в браузере пользователя.</div>
      </div>

      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-slate-900">Мой Dashboard</h3>
        <button class="btn bg-red-50 hover:bg-red-100 text-red-700 border border-red-200" :disabled="widgets.length === 0" @click="clearAll">
          Очистить все
        </button>
      </div>

      <div v-if="widgets.length === 0" class="bg-white rounded-xl shadow-card p-10 text-center text-slate-500">
        В дашборде пока нет виджетов. Добавьте первый виджет через форму выше.
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div v-for="w in widgets" :key="w.id" class="bg-white rounded-xl shadow-card p-4 border border-slate-200">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="font-semibold text-slate-900">{{ w.title }}</div>
              <div class="text-xs text-slate-500 uppercase mt-0.5">{{ w.type }}</div>
            </div>
            <button class="btn bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-2 py-1" @click="removeWidget(w.id)">✕</button>
          </div>
          <div class="mt-3">
            <template v-if="w.type === 'kpi'">
              <div class="text-2xl font-bold text-brand-700">{{ w.value }}</div>
            </template>
            <template v-else-if="w.type === 'list'">
              <ul class="list-disc pl-5 text-sm text-slate-700 space-y-1">
                <li v-for="(item, idx) in asList(w.value)" :key="idx">{{ item }}</li>
              </ul>
            </template>
            <template v-else>
              <div class="text-sm text-slate-700 whitespace-pre-wrap">{{ w.value }}</div>
            </template>
          </div>
          <div class="mt-3 pt-3 border-t border-slate-100">
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 w-full" @click="fillFormFromWidget(w)">Редактировать</button>
          </div>
        </div>
      </div>
    </div>
  `,
  setup() {
    const STORAGE_KEY = 'amurcode.customDashboard.v1';
    const widgets = ref(readStorageJson(STORAGE_KEY, []));
    const liveState = ref(readSelectorLiveState());
    const LIVE_SETTINGS_KEY = 'amurcode.customDashboard.liveSettings.v1';
    const savedLiveSettings = readStorageJson(LIVE_SETTINGS_KEY, {});
    const liveChartType = ref('bar');
    const liveUpdatedAt = ref('');
    const liveChartCanvas = ref(null);
    const liveTopN = ref(Math.min(Math.max(Number(savedLiveSettings?.topN) || 14, 3), 30));
    const liveSelectedIndicators = ref(Array.isArray(savedLiveSettings?.selectedIndicators) ? savedLiveSettings.selectedIndicators.slice(0, 10) : []);
    const form = reactive({ id: '', title: '', type: 'kpi', value: '' });
    let saveTimer = null;
    let liveChartInstance = null;

    function normalizeWidgets(v) {
      if (!Array.isArray(v)) return [];
      return v
        .map(x => ({
          id: String(x?.id || ''),
          title: String(x?.title || '').trim().slice(0, 140),
          type: String(x?.type || 'text'),
          value: String(x?.value || '').trim().slice(0, 1200),
        }))
        .filter(x => x.id && x.title);
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        writeStorageJson(STORAGE_KEY, widgets.value);
      }, 180);
    }

    function resetForm() {
      form.id = '';
      form.title = '';
      form.type = 'kpi';
      form.value = '';
    }

    function addWidget() {
      const title = String(form.title || '').trim();
      const value = String(form.value || '').trim();
      if (!title || !value) return;
      if (form.id) {
        const i = widgets.value.findIndex(x => x.id === form.id);
        if (i >= 0) {
          widgets.value[i] = { id: form.id, title, type: form.type, value };
          scheduleSave();
          resetForm();
          return;
        }
      }
      widgets.value.unshift({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        type: form.type,
        value,
      });
      scheduleSave();
      resetForm();
    }

    function removeWidget(id) {
      widgets.value = widgets.value.filter(x => x.id !== id);
      scheduleSave();
    }

    function clearAll() {
      widgets.value = [];
      scheduleSave();
    }

    function fillFormFromWidget(w) {
      form.id = w.id;
      form.title = w.title;
      form.type = w.type;
      form.value = w.value;
    }

    function asList(raw) {
      return String(raw || '')
        .split(/[;,\\n]/)
        .map(x => x.trim())
        .filter(Boolean)
        .slice(0, 20);
    }

    function buildLiveChartConfig() {
      // Сохраняем фирменный live-график: данные приходят из shared state выборки.
      const result = liveState.value?.result;
      if (!result) return null;
      const allIndicators = Array.isArray(result.indicators) ? result.indicators : [];
      const selectedSet = new Set(liveSelectedIndicators.value);
      const inds = allIndicators
        .filter(ind => selectedSet.size === 0 || selectedSet.has(ind.id))
        .slice(0, 6);
      if (!inds.length) return null;
      const rows = Array.isArray(result.rows) ? result.rows.slice(0, liveTopN.value) : [];
      if (!rows.length) return null;
      const labels = rows.map(r => `${r.kcsr || r.kfsr || ''} · ${String(r.budget || '').slice(0, 22)}`);
      const colors = ['#3a6dff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
      const datasets = inds.map((ind, i) => ({
        label: ind.label,
        data: rows.map(r => Number(r.values?.[ind.id] || 0)),
        backgroundColor: liveChartType.value === 'line' ? colors[i % colors.length] + '33' : colors[i % colors.length] + 'cc',
        borderColor: colors[i % colors.length],
        borderWidth: 2,
        tension: 0.2,
        fill: liveChartType.value === 'line',
      }));
      return {
        type: liveChartType.value,
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { position: 'top' } },
          scales: liveChartType.value === 'pie' ? {} : {
            x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 30 } },
            y: { beginAtZero: true, ticks: { callback: v => fmtMoney(Number(v) || 0) } },
          },
        },
      };
    }

    function drawLiveChart() {
      if (!liveChartCanvas.value) return;
      if (liveChartInstance) liveChartInstance.destroy();
      const cfg = buildLiveChartConfig();
      if (!cfg) return;
      liveChartInstance = new Chart(liveChartCanvas.value, cfg);
    }

    function updateLiveStateFromStorage() {
      const state = readSelectorLiveState();
      liveState.value = state;
      liveUpdatedAt.value = state?.at ? new Date(state.at).toLocaleString('ru-RU') : '';
      const allIndicators = Array.isArray(state?.result?.indicators) ? state.result.indicators : [];
      if (allIndicators.length && liveSelectedIndicators.value.length === 0) {
        liveSelectedIndicators.value = allIndicators.slice(0, 3).map(i => i.id);
      } else if (allIndicators.length) {
        const allowed = new Set(allIndicators.map(i => i.id));
        liveSelectedIndicators.value = liveSelectedIndicators.value.filter(id => allowed.has(id)).slice(0, 10);
        if (liveSelectedIndicators.value.length === 0) {
          liveSelectedIndicators.value = allIndicators.slice(0, 3).map(i => i.id);
        }
      }
      nextTick(drawLiveChart);
    }

    const liveIndicatorOptions = computed(() => {
      const allIndicators = Array.isArray(liveState.value?.result?.indicators) ? liveState.value.result.indicators : [];
      return allIndicators.map(ind => ({ id: ind.id, label: ind.label }));
    });

    function toggleLiveIndicator(id) {
      const list = liveSelectedIndicators.value;
      const i = list.indexOf(id);
      if (i === -1) list.push(id);
      else list.splice(i, 1);
    }

    function saveLiveSettings() {
      writeStorageJson(LIVE_SETTINGS_KEY, {
        topN: liveTopN.value,
        selectedIndicators: liveSelectedIndicators.value,
      });
    }

    onMounted(() => {
      widgets.value = normalizeWidgets(widgets.value);
      updateLiveStateFromStorage();
      window.addEventListener('amurcode:selector-live-updated', updateLiveStateFromStorage);
    });
    onUnmounted(() => {
      if (saveTimer) clearTimeout(saveTimer);
      if (liveChartInstance) liveChartInstance.destroy();
      window.removeEventListener('amurcode:selector-live-updated', updateLiveStateFromStorage);
    });
    watch(liveChartType, () => { nextTick(drawLiveChart); });
    watch(liveTopN, (v) => {
      const n = Math.min(Math.max(Number(v) || 14, 3), 30);
      if (n !== v) liveTopN.value = n;
      saveLiveSettings();
      nextTick(drawLiveChart);
    });
    watch(liveSelectedIndicators, () => {
      saveLiveSettings();
      nextTick(drawLiveChart);
    }, { deep: true });

    return {
      widgets,
      liveState,
      liveChartType,
      liveUpdatedAt,
      liveChartCanvas,
      liveTopN,
      liveSelectedIndicators,
      liveIndicatorOptions,
      form,
      addWidget,
      removeWidget,
      clearAll,
      fillFormFromWidget,
      asList,
      toggleLiveIndicator,
    };
  },
};

const DashboardTab = {
  template: `
    <div class="space-y-4">
      <div class="bg-white rounded-xl shadow-card p-5">
        <div class="flex flex-col lg:flex-row lg:items-end gap-3">
          <div class="flex-1">
            <h3 class="font-semibold text-slate-900">Кастомный Dashboard</h3>
            <p class="text-xs text-slate-500 mt-1">Виджеты строятся на сервере по данным вашего загруженного файла и по выбранным фильтрам.</p>
          </div>
          <div class="text-xs text-slate-500">Пересчитано: {{ dashboardUpdatedAt || '—' }}</div>
        </div>
        <div v-if="error" class="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{{ error }}</div>
      </div>

      <div class="bg-white rounded-xl shadow-card p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold text-slate-900">Live-диаграмма из Конструктора выборок</h3>
            <p class="text-xs text-slate-500 mt-0.5">Фишка сохранена: график обновляется после новых выборок в основной вкладке.</p>
          </div>
          <div class="text-xs text-slate-500">Обновлено: {{ liveUpdatedAt || '—' }}</div>
        </div>
        <div v-if="!liveState" class="mt-3 text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-4">
          Пока нет данных. Перейдите в «Конструктор выборок» и выполните запрос.
        </div>
        <div v-else class="mt-3">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Показатели в диаграмме</label>
              <div class="flex flex-wrap gap-1 border border-slate-200 rounded-lg p-2 max-h-28 overflow-auto">
                <button v-for="ind in liveIndicatorOptions" :key="ind.id"
                        class="indicator-pill"
                        :class="{ active: liveSelectedIndicators.includes(ind.id) }"
                        @click="toggleLiveIndicator(ind.id)">
                  {{ ind.label }}
                </button>
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Количество объектов</label>
              <input v-model.number="liveTopN" type="number" min="3" max="30" class="input" />
              <div class="text-xs text-slate-500 mt-1">Сколько строк выборки показывать на диаграмме (3-30).</div>
            </div>
          </div>
          <div class="flex flex-wrap gap-2 mb-3">
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5"
                    :class="liveChartType === 'bar' ? 'border border-brand-300' : ''"
                    @click="liveChartType = 'bar'">Столбцы</button>
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5"
                    :class="liveChartType === 'line' ? 'border border-brand-300' : ''"
                    @click="liveChartType = 'line'">Линия</button>
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5"
                    :class="liveChartType === 'pie' ? 'border border-brand-300' : ''"
                    @click="liveChartType = 'pie'">Круговая</button>
          </div>
          <div style="position: relative; height: 420px;">
            <canvas ref="liveChartCanvas"></canvas>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-card p-5 space-y-3">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="md:col-span-2">
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Поиск по строкам</label>
            <input v-model="globalQuery" class="input" placeholder="Например: образование, ЖКХ, министерство..." />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Топ строк в таблицах</label>
            <input v-model.number="globalLimit" type="number" min="3" max="50" class="input" />
          </div>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-slate-700">Глобальные фильтры</div>
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5" @click="addGlobalFilter">+ Фильтр</button>
          </div>
          <div v-for="(f, idx) in globalFilters" :key="'gf_' + idx" class="grid grid-cols-12 gap-2 items-end">
            <select v-model="f.column" class="input col-span-5">
              <option value="">Колонка</option>
              <option v-for="col in columns" :key="col" :value="col">{{ col }}</option>
            </select>
            <select v-model="f.mode" class="input col-span-3">
              <option value="contains">contains</option>
              <option value="equals">equals</option>
              <option value="startsWith">startsWith</option>
            </select>
            <input v-model="f.value" class="input col-span-3" placeholder="Значение" />
            <button class="btn bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 col-span-1" @click="removeGlobalFilter(idx)">✕</button>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="btn bg-brand-600 hover:bg-brand-700 text-white" :disabled="refreshing || !hasData" @click="refreshDashboard">
            {{ refreshing ? 'Обновление...' : 'Обновить Dashboard' }}
          </button>
          <button class="btn bg-slate-200 hover:bg-slate-300 text-slate-800" :disabled="!hasData" @click="loadMeta">Перечитать данные</button>
        </div>
        <div v-if="!hasData" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          Сначала загрузите файл во вкладке «Файлы пользователя», после этого виджеты начнут получать данные.
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-card p-5 space-y-3">
        <h3 class="font-semibold text-slate-900">Конструктор виджета</h3>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div class="md:col-span-2">
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Название</label>
            <input v-model="builder.title" class="input" placeholder="Например: Сумма по разделу Образование" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Тип</label>
            <select v-model="builder.type" class="input">
              <option value="kpi">KPI</option>
              <option value="top-list">Топ-список</option>
              <option value="table">Таблица</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Лимит</label>
            <input v-model.number="builder.limit" type="number" min="1" max="25" class="input" />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Агрегация</label>
            <select v-model="builder.aggregation" class="input">
              <option value="count">count</option>
              <option value="sum">sum</option>
              <option value="avg">avg</option>
              <option value="min">min</option>
              <option value="max">max</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Числовая колонка</label>
            <select v-model="builder.metricColumn" class="input">
              <option value="">Не выбрано</option>
              <option v-for="col in columns" :key="'m_' + col" :value="col">{{ col }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Группировка (top-list)</label>
            <select v-model="builder.groupBy" class="input">
              <option value="">Не выбрано</option>
              <option v-for="col in columns" :key="'g_' + col" :value="col">{{ col }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Колонки (table)</label>
            <select v-model="builder.tableColumnDraft" class="input">
              <option value="">Добавить колонку...</option>
              <option v-for="col in columns" :key="'tc_' + col" :value="col">{{ col }}</option>
            </select>
          </div>
        </div>

        <div v-if="builder.selectedColumns.length" class="flex flex-wrap gap-1">
          <span v-for="col in builder.selectedColumns" :key="'sel_' + col" class="badge bg-brand-100 text-brand-800 cursor-pointer" @click="removeSelectedColumn(col)">
            {{ col }} ✕
          </span>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-slate-700">Локальные фильтры виджета</div>
            <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5" @click="addWidgetFilter">+ Фильтр</button>
          </div>
          <div v-for="(f, idx) in builder.filters" :key="'wf_' + idx" class="grid grid-cols-12 gap-2 items-end">
            <select v-model="f.column" class="input col-span-5">
              <option value="">Колонка</option>
              <option v-for="col in columns" :key="'wf_col_' + col + '_' + idx" :value="col">{{ col }}</option>
            </select>
            <select v-model="f.mode" class="input col-span-3">
              <option value="contains">contains</option>
              <option value="equals">equals</option>
              <option value="startsWith">startsWith</option>
            </select>
            <input v-model="f.value" class="input col-span-3" placeholder="Значение" />
            <button class="btn bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 col-span-1" @click="removeWidgetFilter(idx)">✕</button>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="btn bg-brand-600 hover:bg-brand-700 text-white" @click="saveWidget">{{ builder.id ? 'Сохранить виджет' : 'Добавить виджет' }}</button>
          <button class="btn bg-slate-200 hover:bg-slate-300 text-slate-800" @click="resetBuilder">Сбросить</button>
        </div>
      </div>

      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-slate-900">Виджеты пользователя</h3>
        <button class="btn bg-red-50 hover:bg-red-100 text-red-700 border border-red-200" :disabled="widgetConfigs.length === 0" @click="clearAll">
          Очистить все
        </button>
      </div>

      <div v-if="widgetConfigs.length === 0" class="bg-white rounded-xl shadow-card p-10 text-center text-slate-500">
        Создайте первый виджет, и Dashboard будет показывать только его.
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div v-for="widget in dashboardWidgets" :key="widget.id" class="bg-white rounded-xl shadow-card p-4 border border-slate-200">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="font-semibold text-slate-900">{{ widget.title }}</div>
              <div class="text-xs text-slate-500 uppercase mt-0.5">{{ widget.type }}</div>
            </div>
            <div class="flex gap-1">
              <button class="btn bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-2 py-1" @click="editWidget(widget.id)">✎</button>
              <button class="btn bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-2 py-1" @click="removeWidget(widget.id)">✕</button>
            </div>
          </div>

          <div class="mt-3" v-if="widget.error">
            <div class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{{ widget.error }}</div>
          </div>
          <div class="mt-3" v-else-if="widget.type === 'kpi'">
            <div class="text-2xl font-bold text-brand-700">{{ fmtWidgetValue(widget.value) }}</div>
            <div class="text-xs text-slate-500 mt-1">Строк после фильтрации: {{ widget.totalRows }}</div>
          </div>
          <div class="mt-3" v-else-if="widget.type === 'top-list'">
            <div v-if="!widget.items || widget.items.length === 0" class="text-sm text-slate-500">Нет данных</div>
            <ul v-else class="space-y-1.5 text-sm text-slate-700">
              <li v-for="(item, idx) in widget.items" :key="widget.id + '_it_' + idx" class="flex items-center justify-between gap-2">
                <span class="truncate">{{ item.label }}</span>
                <b class="text-slate-900 shrink-0">{{ fmtWidgetValue(item.value) }}</b>
              </li>
            </ul>
          </div>
          <div class="mt-3" v-else-if="widget.type === 'table'">
            <div class="overflow-auto max-h-56 border border-slate-200 rounded-lg">
              <table class="data-table">
                <thead>
                  <tr>
                    <th v-for="c in widget.columns" :key="widget.id + '_h_' + c">{{ c }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(r, idx) in widget.rows" :key="widget.id + '_r_' + idx">
                    <td v-for="c in widget.columns" :key="widget.id + '_c_' + idx + '_' + c">{{ r[c] }}</td>
                  </tr>
                  <tr v-if="!widget.rows || widget.rows.length === 0">
                    <td :colspan="Math.max((widget.columns || []).length, 1)" class="text-slate-500">Нет данных</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="text-xs text-slate-500 mt-1">Показано {{ (widget.rows || []).length }} из {{ widget.totalRows }}</div>
          </div>
        </div>
      </div>
    </div>
  `,
  setup() {
    const STORAGE_KEY = 'amurcode.customDashboard.v2';
    const WIDGETS_STORAGE_KEY = 'amurcode.customDashboard.widgetConfigs.v2';
    const SETTINGS_STORAGE_KEY = 'amurcode.customDashboard.settings.v2';

    const hasData = ref(false);
    const columns = ref([]);
    const refreshing = ref(false);
    const error = ref('');
    const dashboardUpdatedAt = ref('');
    const widgetConfigs = ref(readStorageJson(WIDGETS_STORAGE_KEY, []));
    const dashboardWidgets = ref([]);
    const globalSettings = readStorageJson(SETTINGS_STORAGE_KEY, {});
    const globalQuery = ref(String(globalSettings?.q || ''));
    const globalLimit = ref(Math.min(Math.max(Number(globalSettings?.limit) || 12, 3), 50));
    const globalFilters = ref(Array.isArray(globalSettings?.filters) ? globalSettings.filters.slice(0, 50) : []);
    const liveState = ref(readSelectorLiveState());
    const LIVE_SETTINGS_KEY = 'amurcode.customDashboard.liveSettings.v2';
    const savedLiveSettings = readStorageJson(LIVE_SETTINGS_KEY, {});
    const liveChartType = ref('bar');
    const liveUpdatedAt = ref('');
    const liveChartCanvas = ref(null);
    const liveTopN = ref(Math.min(Math.max(Number(savedLiveSettings?.topN) || 14, 3), 30));
    const liveSelectedIndicators = ref(Array.isArray(savedLiveSettings?.selectedIndicators) ? savedLiveSettings.selectedIndicators.slice(0, 10) : []);

    const builder = reactive({
      id: '',
      title: '',
      type: 'kpi',
      aggregation: 'count',
      metricColumn: '',
      groupBy: '',
      limit: 7,
      filters: [],
      selectedColumns: [],
      tableColumnDraft: '',
    });
    let liveChartInstance = null;

    function normalizeFilters(filters) {
      return (Array.isArray(filters) ? filters : [])
        .map(f => ({
          column: String(f?.column || ''),
          mode: String(f?.mode || 'contains'),
          value: String(f?.value || '').slice(0, 300),
        }))
        .filter(f => f.column && f.value);
    }

    function normalizeWidgetConfig(item) {
      return {
        id: String(item?.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        title: String(item?.title || '').trim().slice(0, 140) || 'Новый виджет',
        type: ['kpi', 'top-list', 'table'].includes(String(item?.type || '')) ? String(item.type) : 'kpi',
        aggregation: ['count', 'sum', 'avg', 'min', 'max'].includes(String(item?.aggregation || '')) ? String(item.aggregation) : 'count',
        metricColumn: String(item?.metricColumn || ''),
        groupBy: String(item?.groupBy || ''),
        limit: Math.min(Math.max(Number(item?.limit) || 7, 1), 25),
        filters: normalizeFilters(item?.filters || []),
        columns: (Array.isArray(item?.columns) ? item.columns : []).map(c => String(c || '')).filter(Boolean).slice(0, 8),
      };
    }

    function buildLiveChartConfig() {
      const result = liveState.value?.result;
      if (!result) return null;
      const allIndicators = Array.isArray(result.indicators) ? result.indicators : [];
      const selectedSet = new Set(liveSelectedIndicators.value);
      const inds = allIndicators
        .filter(ind => selectedSet.size === 0 || selectedSet.has(ind.id))
        .slice(0, 6);
      if (!inds.length) return null;
      const rows = Array.isArray(result.rows) ? result.rows.slice(0, liveTopN.value) : [];
      if (!rows.length) return null;
      const labels = rows.map(r => `${r.kcsr || r.kfsr || ''} · ${String(r.budget || '').slice(0, 22)}`);
      const colors = ['#3a6dff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
      const datasets = inds.map((ind, i) => ({
        label: ind.label,
        data: rows.map(r => Number(r.values?.[ind.id] || 0)),
        backgroundColor: liveChartType.value === 'line' ? colors[i % colors.length] + '33' : colors[i % colors.length] + 'cc',
        borderColor: colors[i % colors.length],
        borderWidth: 2,
        tension: 0.2,
        fill: liveChartType.value === 'line',
      }));
      return {
        type: liveChartType.value,
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { position: 'top' } },
          scales: liveChartType.value === 'pie' ? {} : {
            x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 30 } },
            y: { beginAtZero: true, ticks: { callback: v => fmtMoney(Number(v) || 0) } },
          },
        },
      };
    }

    function drawLiveChart() {
      if (!liveChartCanvas.value) return;
      if (liveChartInstance) liveChartInstance.destroy();
      const cfg = buildLiveChartConfig();
      if (!cfg) return;
      liveChartInstance = new Chart(liveChartCanvas.value, cfg);
    }

    function updateLiveStateFromStorage() {
      const state = readSelectorLiveState();
      liveState.value = state;
      liveUpdatedAt.value = state?.at ? new Date(state.at).toLocaleString('ru-RU') : '';
      const allIndicators = Array.isArray(state?.result?.indicators) ? state.result.indicators : [];
      if (allIndicators.length && liveSelectedIndicators.value.length === 0) {
        liveSelectedIndicators.value = allIndicators.slice(0, 3).map(i => i.id);
      } else if (allIndicators.length) {
        const allowed = new Set(allIndicators.map(i => i.id));
        liveSelectedIndicators.value = liveSelectedIndicators.value.filter(id => allowed.has(id)).slice(0, 10);
        if (liveSelectedIndicators.value.length === 0) {
          liveSelectedIndicators.value = allIndicators.slice(0, 3).map(i => i.id);
        }
      }
      nextTick(drawLiveChart);
    }

    const liveIndicatorOptions = computed(() => {
      const allIndicators = Array.isArray(liveState.value?.result?.indicators) ? liveState.value.result.indicators : [];
      return allIndicators.map(ind => ({ id: ind.id, label: ind.label }));
    });

    function toggleLiveIndicator(id) {
      const list = liveSelectedIndicators.value;
      const i = list.indexOf(id);
      if (i === -1) list.push(id);
      else list.splice(i, 1);
    }

    function saveLiveSettings() {
      writeStorageJson(LIVE_SETTINGS_KEY, {
        topN: liveTopN.value,
        selectedIndicators: liveSelectedIndicators.value,
      });
    }

    function saveSettings() {
      writeStorageJson(SETTINGS_STORAGE_KEY, {
        q: globalQuery.value,
        filters: globalFilters.value,
        limit: globalLimit.value,
      });
      writeStorageJson(STORAGE_KEY, { version: 2 });
    }

    function persistWidgets() {
      writeStorageJson(WIDGETS_STORAGE_KEY, widgetConfigs.value.map(normalizeWidgetConfig));
    }

    async function loadMeta() {
      try {
        const meta = await api('/user-data/meta');
        hasData.value = Boolean(meta?.hasData);
        columns.value = Array.isArray(meta?.columns) ? meta.columns : [];
      } catch (e) {
        error.value = asErrorMessage(e, 'Ошибка загрузки метаданных');
      }
    }

    async function refreshDashboard() {
      if (!hasData.value) return;
      refreshing.value = true;
      error.value = '';
      try {
        const payload = {
          q: String(globalQuery.value || '').trim(),
          // Глобальный лимит используется как дефолт для top-list/table виджетов.
          defaultLimit: globalLimit.value,
          filters: normalizeFilters(globalFilters.value),
          widgets: widgetConfigs.value.map(normalizeWidgetConfig),
        };
        const out = await api('/user-data/dashboard', payload);
        dashboardWidgets.value = Array.isArray(out?.widgets) ? out.widgets : [];
        dashboardUpdatedAt.value = out?.generatedAt ? new Date(out.generatedAt).toLocaleString('ru-RU') : '';
      } catch (e) {
        error.value = asErrorMessage(e, 'Ошибка обновления Dashboard');
      } finally {
        refreshing.value = false;
      }
    }

    function resetBuilder() {
      builder.id = '';
      builder.title = '';
      builder.type = 'kpi';
      builder.aggregation = 'count';
      builder.metricColumn = '';
      builder.groupBy = '';
      builder.limit = 7;
      builder.filters = [];
      builder.selectedColumns = [];
      builder.tableColumnDraft = '';
    }

    function saveWidget() {
      const title = String(builder.title || '').trim();
      if (!title) return;
      const config = normalizeWidgetConfig({
        id: builder.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        type: builder.type,
        aggregation: builder.aggregation,
        metricColumn: builder.metricColumn,
        groupBy: builder.groupBy,
        limit: builder.limit,
        filters: builder.filters,
        columns: builder.selectedColumns,
      });
      const idx = widgetConfigs.value.findIndex(x => x.id === config.id);
      if (idx >= 0) widgetConfigs.value[idx] = config;
      else widgetConfigs.value.unshift(config);
      persistWidgets();
      resetBuilder();
      refreshDashboard();
    }

    function removeWidget(id) {
      widgetConfigs.value = widgetConfigs.value.filter(w => w.id !== id);
      dashboardWidgets.value = dashboardWidgets.value.filter(w => w.id !== id);
      persistWidgets();
    }

    function clearAll() {
      widgetConfigs.value = [];
      dashboardWidgets.value = [];
      persistWidgets();
      resetBuilder();
    }

    function editWidget(id) {
      const w = widgetConfigs.value.find(x => x.id === id);
      if (!w) return;
      builder.id = w.id;
      builder.title = w.title;
      builder.type = w.type;
      builder.aggregation = w.aggregation;
      builder.metricColumn = w.metricColumn;
      builder.groupBy = w.groupBy;
      builder.limit = w.limit;
      builder.filters = Array.isArray(w.filters) ? w.filters.map(f => ({ ...f })) : [];
      builder.selectedColumns = Array.isArray(w.columns) ? w.columns.slice() : [];
      builder.tableColumnDraft = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function addGlobalFilter() {
      globalFilters.value.push({ column: '', mode: 'contains', value: '' });
    }

    function removeGlobalFilter(idx) {
      globalFilters.value.splice(idx, 1);
    }

    function addWidgetFilter() {
      builder.filters.push({ column: '', mode: 'contains', value: '' });
    }

    function removeWidgetFilter(idx) {
      builder.filters.splice(idx, 1);
    }

    function removeSelectedColumn(col) {
      builder.selectedColumns = builder.selectedColumns.filter(x => x !== col);
    }

    function fmtWidgetValue(v) {
      const num = Number(v);
      if (Number.isFinite(num)) return fmtMoney(num);
      return String(v ?? '');
    }

    watch(() => builder.tableColumnDraft, (v) => {
      const col = String(v || '');
      if (!col) return;
      if (!builder.selectedColumns.includes(col)) builder.selectedColumns.push(col);
      builder.tableColumnDraft = '';
    });

    watch([globalQuery, globalLimit], () => {
      const n = Math.min(Math.max(Number(globalLimit.value) || 12, 3), 50);
      if (n !== globalLimit.value) globalLimit.value = n;
      saveSettings();
    });
    watch(globalFilters, saveSettings, { deep: true });
    watch(liveChartType, () => { nextTick(drawLiveChart); });
    watch(liveTopN, (v) => {
      const n = Math.min(Math.max(Number(v) || 14, 3), 30);
      if (n !== v) liveTopN.value = n;
      saveLiveSettings();
      nextTick(drawLiveChart);
    });
    watch(liveSelectedIndicators, () => {
      saveLiveSettings();
      nextTick(drawLiveChart);
    }, { deep: true });

    onMounted(async () => {
      widgetConfigs.value = (Array.isArray(widgetConfigs.value) ? widgetConfigs.value : []).map(normalizeWidgetConfig);
      if (!globalFilters.value.length) addGlobalFilter();
      updateLiveStateFromStorage();
      window.addEventListener('amurcode:selector-live-updated', updateLiveStateFromStorage);
      await loadMeta();
      if (hasData.value && widgetConfigs.value.length) await refreshDashboard();
    });
    onUnmounted(() => {
      if (liveChartInstance) liveChartInstance.destroy();
      window.removeEventListener('amurcode:selector-live-updated', updateLiveStateFromStorage);
    });

    return {
      hasData,
      columns,
      refreshing,
      error,
      dashboardUpdatedAt,
      widgetConfigs,
      dashboardWidgets,
      liveState,
      liveChartType,
      liveUpdatedAt,
      liveChartCanvas,
      liveTopN,
      liveSelectedIndicators,
      liveIndicatorOptions,
      builder,
      globalQuery,
      globalLimit,
      globalFilters,
      loadMeta,
      refreshDashboard,
      resetBuilder,
      saveWidget,
      removeWidget,
      clearAll,
      editWidget,
      addGlobalFilter,
      removeGlobalFilter,
      addWidgetFilter,
      removeWidgetFilter,
      removeSelectedColumn,
      fmtWidgetValue,
      toggleLiveIndicator,
    };
  },
};

// ---------- Компонент: Личный кабинет ----------
const AccountTab = {
  template: `
    <div class="space-y-4">
      <div class="bg-white rounded-xl shadow-card p-5">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
          <h3 class="font-semibold text-slate-900">История запросов</h3>
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-500">Всего: {{ history.length }}</span>
            <button class="btn bg-slate-200 hover:bg-slate-300 text-slate-800" @click="reloadHistory">Обновить</button>
            <button class="btn bg-red-50 hover:bg-red-100 text-red-700 border border-red-200" :disabled="history.length === 0" @click="clearHistoryList">Очистить историю</button>
          </div>
        </div>
        <div v-if="history.length === 0" class="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-4">
          История пока пустая. Выполните выборку, сравнение, экспорт или работу с файлами.
        </div>
        <div v-else class="space-y-2 max-h-[650px] overflow-auto scroll-thin pr-1">
          <div v-for="item in history" :key="item.id"
               role="button"
               tabindex="0"
               class="border border-slate-200 rounded-lg p-3 text-left w-full cursor-pointer transition hover:bg-slate-50 hover:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
               @click="openHistoryItem(item)"
               @keydown.enter.prevent="openHistoryItem(item)"
               @keydown.space.prevent="openHistoryItem(item)">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="badge" :class="historyBadgeClass(item.type)">{{ item.type }}</span>
                <span class="font-medium text-slate-900">{{ item.title }}</span>
              </div>
              <span class="text-xs text-slate-500 shrink-0">{{ fmtDateTime(item.at) }}</span>
            </div>
            <div v-if="item.details" class="mt-1 text-sm text-slate-700">{{ item.details }}</div>
            <div class="mt-2 text-xs font-medium"
                 :class="item.meta && item.meta.snapshot ? 'text-brand-600' : 'text-slate-500'">
              {{ item.meta && item.meta.snapshot ? 'Нажмите, чтобы повторить запрос на вкладке' : 'Нажмите, чтобы открыть соответствующую вкладку' }}
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  setup() {
    const history = ref(getUserHistory());

    function reloadHistory() {
      history.value = getUserHistory();
    }

    function clearHistoryList() {
      clearUserHistory();
      reloadHistory();
    }

    function historyBadgeClass(type) {
      const t = String(type || '').toLowerCase();
      if (t.includes('экспорт')) return 'bg-indigo-100 text-indigo-700';
      if (t.includes('ии')) return 'bg-violet-100 text-violet-700';
      if (t.includes('сравнение')) return 'bg-amber-100 text-amber-700';
      if (t.includes('файлы')) return 'bg-cyan-100 text-cyan-700';
      if (t.includes('выборка')) return 'bg-emerald-100 text-emerald-700';
      return 'bg-slate-100 text-slate-700';
    }

    function fmtDateTime(iso) {
      try {
        return new Date(iso).toLocaleString('ru-RU');
      } catch {
        return String(iso || '');
      }
    }

    function inferHistoryTab(item) {
      const m = item.meta;
      if (m && m.tab) return String(m.tab);
      const t = String(item.type || '').toLowerCase();
      if (t.includes('выборк')) return 'selector';
      if (t.includes('сравнен')) return 'compare';
      return null;
    }

    function openHistoryItem(item) {
      const tab = inferHistoryTab(item);
      const snapshot = item.meta && typeof item.meta.snapshot === 'object' ? item.meta.snapshot : null;
      if (!tab) {
        window.dispatchEvent(new CustomEvent('amurcode:toast', { detail: { message: 'Не удалось определить вкладку для этой записи.', timeoutMs: 2400 } }));
        return;
      }
      if (!snapshot) {
        window.dispatchEvent(new CustomEvent('amurcode:toast', { detail: { message: 'У записи нет сохранённых параметров (старые записи до обновления). Открыта только вкладка.', timeoutMs: 3200 } }));
        window.dispatchEvent(new CustomEvent('amurcode:navigate-tab', { detail: { tab } }));
        return;
      }
      setPendingHistoryNavigation(tab, snapshot);
      window.dispatchEvent(new CustomEvent('amurcode:navigate-tab', { detail: { tab } }));
    }

    function onHistoryChanged() {
      reloadHistory();
    }

    onMounted(() => {
      reloadHistory();
      window.addEventListener('amurcode:history-changed', onHistoryChanged);
    });
    onUnmounted(() => {
      window.removeEventListener('amurcode:history-changed', onHistoryChanged);
    });

    return {
      history,
      reloadHistory,
      clearHistoryList,
      historyBadgeClass,
      fmtDateTime,
      openHistoryItem,
    };
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
