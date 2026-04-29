const { createApp, ref, computed, reactive, onMounted, onUnmounted, watch, nextTick } = Vue;
const API_BASE = window.__APP_CONFIG__?.apiBase || '';

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
  const res = await fetch(API_BASE + '/api' + path, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  } : { credentials: 'include' });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function downloadXlsx(path, body, filename) {
  const res = await fetch(API_BASE + '/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
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

function getChartTooltipValue(ctx) {
  const parsed = ctx?.parsed;
  if (typeof parsed === 'number') return parsed;
  if (Number.isFinite(parsed?.y)) return parsed.y;
  if (Number.isFinite(parsed?.r)) return parsed.r;
  if (Number.isFinite(ctx?.raw)) return ctx.raw;
  return 0;
}

function getChartScales(chartType, xTickOptions = {}) {
  if (['pie', 'doughnut', 'polarArea', 'radar'].includes(chartType)) {
    return {};
  }
  return {
    x: { ticks: { autoSkip: false, ...xTickOptions } },
    y: { ticks: { callback: v => fmtMoney(v) } }
  };
}

function ensureDefaultChartState(showTable, showChart, selectedChartTypes) {
  showTable.value = true;
  showChart.value = true;
  if (!selectedChartTypes.value.length) {
    selectedChartTypes.value = ['bar'];
  }
}

function hasActiveQueryLimits(filter, from, to) {
  return Boolean(from || to || Object.values(filter || {}).some(v => {
    if (Array.isArray(v)) return v.length > 0;
    return String(v || '').trim() !== '';
  }));
}

function hasRenderableResult(data) {
  if (!data || !Array.isArray(data.rows) || data.rows.length === 0) return false;
  const total = Object.values(data.totals || {}).reduce((acc, value) => acc + Math.abs(Number(value) || 0), 0);
  return total > 0;
}

function resetSelectorFilter(filter) {
  for (const key of Object.keys(filter)) {
    filter[key] = Array.isArray(filter[key]) ? [] : '';
  }
}

function drawCanvasFallback(canvas, labels = [], datasets = []) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(640, Math.floor(rect.width || canvas.parentElement?.clientWidth || 640));
  const height = Math.max(360, Math.floor(rect.height || canvas.parentElement?.clientHeight || 360));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const values = (datasets[0]?.data || []).map(v => Number(v) || 0);
  const visibleLabels = labels.slice(0, values.length);
  const max = Math.max(...values.map(v => Math.abs(v)), 1);
  const pad = { left: 72, right: 24, top: 28, bottom: 86 };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = Math.max(1, height - pad.top - pad.bottom);
  const barGap = 8;
  const barW = Math.max(8, (plotW - barGap * Math.max(values.length - 1, 0)) / Math.max(values.length, 1));

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d7dce3';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  ctx.fillStyle = '#5f6368';
  ctx.font = '12px Inter, Arial, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + plotH - (plotH * i / 4);
    const value = max * i / 4;
    ctx.strokeStyle = '#eef1f5';
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillText(fmtMoney(value), pad.left - 8, y + 4);
  }

  values.forEach((value, i) => {
    const x = pad.left + i * (barW + barGap);
    const h = Math.max(1, Math.abs(value) / max * plotH);
    const y = pad.top + plotH - h;
    ctx.fillStyle = '#4285f4';
    ctx.fillRect(x, y, barW, h);
    ctx.save();
    ctx.translate(x + barW / 2, pad.top + plotH + 10);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#3c4043';
    ctx.textAlign = 'right';
    ctx.fillText(String(visibleLabels[i] || '').slice(0, 42), 0, 0);
    ctx.restore();
  });
}

const App = {
  template: `
    <div class="min-h-screen flex flex-col">
      <header class="border-b border-[#e0e0e0] bg-[#f2f2f2]">
        <div class="w-full px-4 py-2.5">
        </div>
      </header>

      <main class="flex-1 w-full px-4 py-3">
        <component :is="currentTabComponent"
                   :active-tab="activeTab"
                   :is-authenticated="isAuthenticated"
                   :is-dark-theme="isDarkTheme"
                   :username="username"
                   :history-restore="historyRestore"
                   :realtime-revision="realtimeRevision"
                   @change-tab="activeTab = $event"
                   @open-login="openLoginModal"
                   @open-cabinet="openCabinetModal"
                   @toggle-theme="toggleTheme"
                   @query-run="addQueryHistory" />
      </main>

      <div v-if="loginModalOpen" class="login-overlay" @click.self="closeLoginModal">
        <div class="login-modal">
          <button type="button" class="login-close-btn" @click="closeLoginModal">✕</button>
          <h2 class="text-[22px] leading-none font-medium text-center text-[#202124] mb-2">Войдите в аккаунт</h2>
          <div class="login-form-card">
            <label class="login-label">Почта</label>
            <input v-model="loginEmail" type="text" class="input mb-1" placeholder="example@mail.ru" />
            <div v-if="emailError" class="login-error">{{ emailError }}</div>

            <label class="login-label mt-4">Пароль</label>
            <input v-model="loginPassword" type="password" class="input mb-1" placeholder="example-password" />
            <div v-if="passwordError" class="login-error">{{ passwordError }}</div>

            <button type="button" class="btn bg-brand-500 hover:bg-brand-600 text-white w-full mt-3" @click="submitLogin">Войти</button>
          </div>
        </div>
      </div>

      <div v-if="cabinetModalOpen" class="login-overlay" @click.self="handleCabinetOverlayClick">
        <div class="account-modal" :style="accountModalStyle">
          <button type="button" class="login-close-btn" @click="closeCabinetModal">✕</button>
          <div class="account-modal-header" @mousedown.prevent="startCabinetDrag">
            <h2 class="text-[22px] leading-none font-medium text-center text-[#202124] mb-3">Личный кабинет</h2>
          </div>
          <div class="account-card">
            <div class="account-history-toolbar">
              <label class="login-label">История запросов</label>
              <div class="account-history-toolbar-actions">
                <button type="button" class="btn account-btn-refresh text-white" @click="refreshQueryHistory">Обновить</button>
                <button type="button" class="btn account-btn-clear text-white" @click="openClearHistoryConfirm">Очистить</button>
              </div>
            </div>
            <div class="account-history-field">
              <div v-if="queryHistory.length === 0" class="text-[#5f6368]">История запросов пока пуста</div>
              <ul v-else class="space-y-2">
                <li v-for="entry in queryHistory" :key="entry.id" class="account-history-item cursor-pointer" @click="openHistoryEntry(entry)">
                  <div class="font-medium">{{ entry.tab }}</div>
                  <div class="text-[#5f6368]">{{ entry.text }}</div>
                  <div class="text-[#5f6368]">{{ entry.time }}</div>
                </li>
              </ul>
            </div>

            <button type="button" class="btn bg-[#ea4335] hover:bg-[#d93025] text-white w-full mt-3" @click="logout">
              Выйти из аккаунта
            </button>
          </div>
          <div v-if="clearHistoryConfirmOpen" class="account-confirm-overlay">
            <div class="account-confirm-modal">
              <div class="account-confirm-title">Вы уверены что хотите удалить историю запросов?</div>
              <div class="account-confirm-actions">
                <button type="button" class="btn account-btn-clear text-white" @click="confirmClearHistory">Да</button>
                <button type="button" class="btn account-btn-refresh text-white" @click="cancelClearHistory">Нет</button>
              </div>
            </div>
          </div>
          <div class="resize-handle resize-handle--top" @mousedown.prevent="startCabinetResize($event, 't')"></div>
          <div class="resize-handle resize-handle--right" @mousedown.prevent="startCabinetResize($event, 'r')"></div>
          <div class="resize-handle resize-handle--bottom" @mousedown.prevent="startCabinetResize($event, 'b')"></div>
          <div class="resize-handle resize-handle--left" @mousedown.prevent="startCabinetResize($event, 'l')"></div>
          <div class="resize-handle resize-handle--top-left" @mousedown.prevent="startCabinetResize($event, 'tl')"></div>
          <div class="resize-handle resize-handle--top-right" @mousedown.prevent="startCabinetResize($event, 'tr')"></div>
          <div class="resize-handle resize-handle--bottom-right" @mousedown.prevent="startCabinetResize($event, 'br')"></div>
          <div class="resize-handle resize-handle--bottom-left" @mousedown.prevent="startCabinetResize($event, 'bl')"></div>
        </div>
      </div>

      <footer class="h-2"></footer>
    </div>
  `,
  setup() {
    const health = reactive({ ok: false, loaded: false, stats: {} });
    const activeTab = ref('selector');
    const tabs = [
      { id: 'selector', label: 'Выборка' },
      { id: 'compare',  label: 'Сравнение периодов' },
      { id: 'about',    label: 'Помощь' },
    ];
    const totalRows = computed(() =>
      (health.stats.rchb || 0) + (health.stats.buau || 0) + (health.stats.agreements || 0) + (health.stats.contracts || 0) + (health.stats.payments || 0)
    );
    const isAuthenticated = ref(false);
    const username = ref('Имя пользователя');
    const loginModalOpen = ref(false);
    const cabinetModalOpen = ref(false);
    const loginEmail = ref('');
    const loginPassword = ref('');
    const emailError = ref('');
    const passwordError = ref('');
    const queryHistory = ref([]);
    const historyRestore = ref(null);
    const realtimeRevision = ref(0);
    const suppressCabinetOverlayClose = ref(false);
    const CABINET_STORAGE_KEY = 'cabinet-modal-geometry-v1';
    const HISTORY_STORAGE_KEY = 'cabinet-query-history-v1';
    const MODAL_MIN_W = 520;
    const MODAL_MIN_H = 420;
    const clearHistoryConfirmOpen = ref(false);
    const THEME_STORAGE_KEY = 'theme-preference-auth-v1';
    const isDarkTheme = ref(false);
    const resizeState = reactive({
      active: false,
      dir: '',
      startMouseX: 0,
      startMouseY: 0,
      startX: 0,
      startY: 0,
      startWidth: 760,
      startHeight: 620,
    });
    const dragState = reactive({
      active: false,
      startMouseX: 0,
      startMouseY: 0,
      startX: 0,
      startY: 0,
    });
    const cabinetGeometry = reactive({
      x: 80,
      y: 80,
      width: 760,
      height: 620,
      ready: false,
    });
    const accountModalStyle = computed(() => ({
      width: `${cabinetGeometry.width}px`,
      height: `${cabinetGeometry.height}px`,
      left: `${cabinetGeometry.x}px`,
      top: `${cabinetGeometry.y}px`,
    }));
    let realtimeEvents = null;

    function clamp(n, min, max) {
      return Math.min(Math.max(n, min), max);
    }
    function getCabinetMaxSize() {
      return {
        maxW: Math.floor(window.innerWidth * 0.95),
        maxH: Math.floor(window.innerHeight * 0.92),
      };
    }
    function normalizeCabinetGeometry(input) {
      const { maxW, maxH } = getCabinetMaxSize();
      const width = clamp(Number(input?.width) || 760, MODAL_MIN_W, Math.max(MODAL_MIN_W, maxW));
      const height = clamp(Number(input?.height) || 620, MODAL_MIN_H, Math.max(MODAL_MIN_H, maxH));
      const xRaw = Number(input?.x);
      const yRaw = Number(input?.y);
      const x = clamp(Number.isFinite(xRaw) ? xRaw : 0, 0, Math.max(0, window.innerWidth - width));
      const y = clamp(Number.isFinite(yRaw) ? yRaw : 0, 0, Math.max(0, window.innerHeight - height));
      return { x, y, width, height };
    }
    function applyCabinetGeometry(nextGeometry) {
      const normalized = normalizeCabinetGeometry(nextGeometry);
      cabinetGeometry.x = normalized.x;
      cabinetGeometry.y = normalized.y;
      cabinetGeometry.width = normalized.width;
      cabinetGeometry.height = normalized.height;
      cabinetGeometry.ready = true;
    }
    function centerCabinetGeometry() {
      const normalized = normalizeCabinetGeometry({ width: cabinetGeometry.width, height: cabinetGeometry.height });
      applyCabinetGeometry({
        x: Math.max(0, Math.floor((window.innerWidth - normalized.width) / 2)),
        y: Math.max(0, Math.floor((window.innerHeight - normalized.height) / 2)),
        width: normalized.width,
        height: normalized.height,
      });
    }
    function loadCabinetGeometry() {
      try {
        const raw = localStorage.getItem(CABINET_STORAGE_KEY);
        if (!raw) {
          centerCabinetGeometry();
          return;
        }
        applyCabinetGeometry(JSON.parse(raw));
      } catch {
        centerCabinetGeometry();
      }
    }
    function persistCabinetGeometry() {
      try {
        localStorage.setItem(CABINET_STORAGE_KEY, JSON.stringify({
          x: cabinetGeometry.x,
          y: cabinetGeometry.y,
          width: cabinetGeometry.width,
          height: cabinetGeometry.height,
        }));
      } catch {}
    }
    function applyThemeClass() {
      document.body.classList.toggle('theme-dark', isDarkTheme.value);
    }
    function loadThemePreference() {
      try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'dark') isDarkTheme.value = true;
        else if (saved === 'light') isDarkTheme.value = false;
      } catch {}
      applyThemeClass();
    }
    function persistThemePreference() {
      if (!isAuthenticated.value) return;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, isDarkTheme.value ? 'dark' : 'light');
      } catch {}
    }
    function toggleTheme() {
      isDarkTheme.value = !isDarkTheme.value;
      applyThemeClass();
      persistThemePreference();
    }
    function loadQueryHistory() {
      try {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (!raw) {
          queryHistory.value = [];
          return;
        }
        const parsed = JSON.parse(raw);
        queryHistory.value = Array.isArray(parsed) ? parsed : [];
      } catch {
        queryHistory.value = [];
      }
    }
    function persistQueryHistory() {
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(queryHistory.value));
      } catch {}
    }

    async function refreshHealth() {
      try {
        const h = await api('/health');
        Object.assign(health, h);
      } catch (e) { health.ok = false; }
    }
    function closeRealtime() {
      if (!realtimeEvents) return;
      realtimeEvents.close();
      realtimeEvents = null;
    }
    function startRealtime() {
      if (realtimeEvents || !isAuthenticated.value || typeof EventSource === 'undefined') return;
      realtimeEvents = new EventSource(API_BASE + '/api/events');
      const bumpRevision = async () => {
        realtimeRevision.value += 1;
        await refreshHealth();
      };
      realtimeEvents.addEventListener('ready', bumpRevision);
      realtimeEvents.addEventListener('data-updated', bumpRevision);
      realtimeEvents.onerror = () => {
        // EventSource переподключается сам; при потере сессии API просто не пришлет новые события.
      };
    }
    async function checkAuth() {
      try {
        const res = await fetch(API_BASE + '/api/auth/me', { credentials: 'include' });
        if (!res.ok) {
          isAuthenticated.value = false;
          username.value = 'Имя пользователя';
          return false;
        }
        const data = await res.json();
        isAuthenticated.value = Boolean(data?.authenticated);
        username.value = data?.user?.name || data?.user?.username || 'Имя пользователя';
        return isAuthenticated.value;
      } catch {
        isAuthenticated.value = false;
        username.value = 'Имя пользователя';
        return false;
      }
    }
    async function tryAutoLogin() {
      try {
        const res = await fetch(API_BASE + '/api/auth/test-users', { credentials: 'include' });
        if (!res.ok) return false;
        const data = await res.json();
        const users = Array.isArray(data?.users) ? data.users : [];
        if (!users.length) return false;
        const candidate = users[0];
        const loginRes = await fetch(API_BASE + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            username: String(candidate.username || '').trim(),
            password: String(candidate.password || ''),
          }),
        });
        if (!loginRes.ok) return false;
        const out = await loginRes.json();
        isAuthenticated.value = true;
        username.value = out?.user?.name || out?.user?.username || candidate.username || 'Имя пользователя';
        return true;
      } catch {
        return false;
      }
    }
    function onCabinetResizeMove(event) {
      if (!resizeState.active) return;
      const dx = event.clientX - resizeState.startMouseX;
      const dy = event.clientY - resizeState.startMouseY;
      const { maxW, maxH } = getCabinetMaxSize();
      const minW = MODAL_MIN_W;
      const minH = MODAL_MIN_H;
      const dir = resizeState.dir;
      let width = resizeState.startWidth;
      let height = resizeState.startHeight;
      let x = resizeState.startX;
      let y = resizeState.startY;

      if (dir.includes('r')) {
        width = clamp(resizeState.startWidth + dx, minW, Math.max(minW, maxW));
      }
      if (dir.includes('l')) {
        const desired = clamp(resizeState.startWidth - dx, minW, Math.max(minW, maxW));
        x = resizeState.startX + (resizeState.startWidth - desired);
        width = desired;
      }
      if (dir.includes('b')) {
        height = clamp(resizeState.startHeight + dy, minH, Math.max(minH, maxH));
      }
      if (dir.includes('t')) {
        const desired = clamp(resizeState.startHeight - dy, minH, Math.max(minH, maxH));
        y = resizeState.startY + (resizeState.startHeight - desired);
        height = desired;
      }

      x = clamp(x, 0, Math.max(0, window.innerWidth - width));
      y = clamp(y, 0, Math.max(0, window.innerHeight - height));
      applyCabinetGeometry({ x, y, width, height });
    }
    function onCabinetResizeEnd() {
      if (!resizeState.active) return;
      resizeState.active = false;
      resizeState.dir = '';
      document.body.style.userSelect = '';
      persistCabinetGeometry();
      suppressCabinetOverlayClose.value = true;
      setTimeout(() => {
        suppressCabinetOverlayClose.value = false;
      }, 80);
    }
    function onCabinetDragMove(event) {
      if (!dragState.active) return;
      const dx = event.clientX - dragState.startMouseX;
      const dy = event.clientY - dragState.startMouseY;
      const nextX = clamp(dragState.startX + dx, 0, Math.max(0, window.innerWidth - cabinetGeometry.width));
      const nextY = clamp(dragState.startY + dy, 0, Math.max(0, window.innerHeight - cabinetGeometry.height));
      applyCabinetGeometry({
        x: nextX,
        y: nextY,
        width: cabinetGeometry.width,
        height: cabinetGeometry.height,
      });
    }
    function onCabinetDragEnd() {
      if (!dragState.active) return;
      dragState.active = false;
      document.body.style.userSelect = '';
      persistCabinetGeometry();
      suppressCabinetOverlayClose.value = true;
      setTimeout(() => {
        suppressCabinetOverlayClose.value = false;
      }, 80);
    }
    function onWindowResize() {
      if (!cabinetGeometry.ready) return;
      applyCabinetGeometry(cabinetGeometry);
    }
    onMounted(async () => {
      const ok = await checkAuth();
      if (!ok) {
        await tryAutoLogin();
      }
      if (isAuthenticated.value) await refreshHealth();
      startRealtime();
      loadCabinetGeometry();
      loadQueryHistory();
      loadThemePreference();
      window.addEventListener('mousemove', onCabinetResizeMove);
      window.addEventListener('mouseup', onCabinetResizeEnd);
      window.addEventListener('mousemove', onCabinetDragMove);
      window.addEventListener('mouseup', onCabinetDragEnd);
      window.addEventListener('resize', onWindowResize);
    });
    onUnmounted(() => {
      window.removeEventListener('mousemove', onCabinetResizeMove);
      window.removeEventListener('mouseup', onCabinetResizeEnd);
      window.removeEventListener('mousemove', onCabinetDragMove);
      window.removeEventListener('mouseup', onCabinetDragEnd);
      window.removeEventListener('resize', onWindowResize);
      document.body.style.userSelect = '';
      closeRealtime();
    });

    function openLoginModal() {
      emailError.value = '';
      passwordError.value = '';
      loginModalOpen.value = true;
    }
    function closeLoginModal() {
      loginModalOpen.value = false;
    }
    function openCabinetModal() {
      if (!isAuthenticated.value) return;
      if (!cabinetGeometry.ready) loadCabinetGeometry();
      applyCabinetGeometry(cabinetGeometry);
      loadQueryHistory();
      clearHistoryConfirmOpen.value = false;
      cabinetModalOpen.value = true;
    }
    function closeCabinetModal() {
      persistCabinetGeometry();
      clearHistoryConfirmOpen.value = false;
      cabinetModalOpen.value = false;
    }
    function handleCabinetOverlayClick() {
      if (resizeState.active || suppressCabinetOverlayClose.value) return;
      closeCabinetModal();
    }
    function startCabinetResize(event, dir) {
      if (!cabinetModalOpen.value) return;
      if (dragState.active) return;
      resizeState.active = true;
      resizeState.dir = dir;
      resizeState.startMouseX = event.clientX;
      resizeState.startMouseY = event.clientY;
      resizeState.startX = cabinetGeometry.x;
      resizeState.startY = cabinetGeometry.y;
      resizeState.startWidth = cabinetGeometry.width;
      resizeState.startHeight = cabinetGeometry.height;
      document.body.style.userSelect = 'none';
    }
    function startCabinetDrag(event) {
      if (!cabinetModalOpen.value) return;
      if (resizeState.active) return;
      const target = event.target;
      if (target instanceof Element) {
        if (target.closest('button, input, textarea, select, a, .resize-handle')) return;
      }
      dragState.active = true;
      dragState.startMouseX = event.clientX;
      dragState.startMouseY = event.clientY;
      dragState.startX = cabinetGeometry.x;
      dragState.startY = cabinetGeometry.y;
      document.body.style.userSelect = 'none';
    }
    function addQueryHistory(payload) {
      const tab = payload?.tab || 'Запрос';
      const text = payload?.text || 'Выполнен запрос';
      const entry = {
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tab,
        tabId: payload?.tabId || null,
        text,
        restore: payload?.restore || null,
        time: new Date().toLocaleString('ru-RU'),
      };
      queryHistory.value.unshift(entry);
      if (queryHistory.value.length > 30) queryHistory.value = queryHistory.value.slice(0, 30);
      persistQueryHistory();
    }
    function openHistoryEntry(entry) {
      if (!entry) return;
      const fallbackTab = entry.tabId || (entry.tab === 'Сравнение периодов' ? 'compare' : 'selector');
      activeTab.value = fallbackTab;
      if (entry.restore && entry.restore.tabId) {
        historyRestore.value = {
          ...entry.restore,
          nonce: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        };
      }
      closeCabinetModal();
    }
    function refreshQueryHistory() {
      loadQueryHistory();
    }
    function openClearHistoryConfirm() {
      clearHistoryConfirmOpen.value = true;
    }
    function cancelClearHistory() {
      clearHistoryConfirmOpen.value = false;
    }
    function confirmClearHistory() {
      queryHistory.value = [];
      persistQueryHistory();
      clearHistoryConfirmOpen.value = false;
    }
    async function logout() {
      try {
        await fetch(API_BASE + '/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch {}
      isAuthenticated.value = false;
      username.value = 'Имя пользователя';
      closeRealtime();
      cabinetModalOpen.value = false;
      loginModalOpen.value = false;
      loginEmail.value = '';
      loginPassword.value = '';
      emailError.value = '';
      passwordError.value = '';
    }
    async function submitLogin() {
      emailError.value = '';
      passwordError.value = '';
      let hasError = false;
      if (!loginEmail.value.trim()) {
        emailError.value = 'Введите почту';
        hasError = true;
      }
      if (!loginPassword.value.trim()) {
        passwordError.value = 'Введите пароль';
        hasError = true;
      }
      if (hasError) return;
      try {
        const rawLogin = loginEmail.value.trim();
        const usernameForApi = rawLogin.includes('@') ? rawLogin.split('@')[0] : rawLogin;
        const res = await fetch(API_BASE + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            username: usernameForApi,
            password: loginPassword.value,
          }),
        });
        if (!res.ok) {
          let msg = 'Ошибка входа';
          try { msg = (await res.json())?.error || msg; } catch {}
          passwordError.value = msg;
          return;
        }
        const data = await res.json();
        isAuthenticated.value = true;
        username.value = data?.user?.name || data?.user?.username || 'Имя пользователя';
        loginModalOpen.value = false;
        await refreshHealth();
        startRealtime();
        persistThemePreference();
      } catch {
        passwordError.value = 'Сетевая ошибка входа';
      }
    }

    const currentTabComponent = computed(() => {
      switch (activeTab.value) {
        case 'compare': return CompareTab;
        case 'about':   return AboutTab;
        default:        return SelectorTab;
      }
    });

    return {
      health, activeTab, tabs, currentTabComponent, totalRows,
      isAuthenticated, username, isDarkTheme, realtimeRevision,
      loginModalOpen, cabinetModalOpen, queryHistory, accountModalStyle, clearHistoryConfirmOpen,
      historyRestore,
      loginEmail, loginPassword, emailError, passwordError,
      openLoginModal, closeLoginModal, submitLogin, toggleTheme,
      openCabinetModal, closeCabinetModal, handleCabinetOverlayClick,
      startCabinetResize, startCabinetDrag, addQueryHistory,
      openHistoryEntry,
      refreshQueryHistory, openClearHistoryConfirm, cancelClearHistory, confirmClearHistory,
      logout,
    };
  },
};

// ---------- Компонент: Конструктор выборок ----------
const SelectorTab = {
  props: {
    activeTab: { type: String, default: 'selector' },
    isAuthenticated: { type: Boolean, default: false },
    isDarkTheme: { type: Boolean, default: false },
    username: { type: String, default: 'Имя пользователя' },
    historyRestore: { type: Object, default: null },
    realtimeRevision: { type: Number, default: 0 },
  },
  emits: ['change-tab', 'open-login', 'open-cabinet', 'toggle-theme', 'query-run'],
  template: `
    <div class="space-y-5">
    <div class="panel p-2 selector-toolbar flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
      <div class="flex flex-col gap-2 min-w-0 flex-1 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2">
        <div class="flex w-full items-center justify-between gap-2 lg:contents">
          <div class="flex items-center gap-2 min-w-0 lg:contents">
            <span class="toolbar-logo-slot shrink-0">
              <span class="toolbar-logo-badge">
                <img src="/images/Логотип.jpeg" alt="Логотип" class="toolbar-logo-img" />
              </span>
            </span>
            <div class="toolbar-menu-filters-row flex min-w-0 flex-row items-center gap-1.5 lg:gap-2">
              <div class="toolbar-mf-menu-host relative shrink-0" ref="menuRoot">
                <button type="button" class="toolbar-btn max-lg:px-2 max-lg:text-[15px]" @click.stop="menuOpen = !menuOpen">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
                  Меню
                </button>
                <div v-show="menuOpen" class="absolute left-0 top-full mt-1 w-[260px] user-dropdown-dark rounded-md py-1 z-[121]">
                  <div class="dropdown-section-title">Файлы</div>
                  <button type="button" class="dropdown-item-dark">Загрузить файлы</button>
                  <button type="button" class="dropdown-item-dark" :disabled="!result" @click="exportXlsx">Экспортировать в Excel</button>
                  <button type="button" class="dropdown-item-dark">Экспортировать диаграмму как PNG</button>
                  <button type="button" class="dropdown-item-dark">Экспорт в PDF</button>
                </div>
              </div>
              <button type="button" class="toolbar-btn mobile-sidebar-toggle shrink-0 max-lg:px-2 max-lg:text-[15px]" @click="toggleMobileSidebar">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h18M3 12h18M3 18h18"/></svg>
                Фильтры
              </button>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0 max-lg:ml-1 lg:contents">
            <div class="toolbar-round-actions toolbar-round-actions--mobile max-lg:ml-0 shrink-0 lg:hidden">
              <button type="button" class="toolbar-round-btn" aria-label="Микрофон">
                <svg class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="10" rx="3" stroke-width="2"></rect>
                  <path d="M7 11a5 5 0 0 0 10 0" stroke-width="2" stroke-linecap="round"></path>
                  <path d="M12 16v4" stroke-width="2" stroke-linecap="round"></path>
                  <path d="M9 20h6" stroke-width="2" stroke-linecap="round"></path>
                </svg>
              </button>
              <button type="button" class="toolbar-round-btn" :aria-label="isDarkTheme ? 'Светлая тема' : 'Тёмная тема'" @click="$emit('toggle-theme')">
                <svg v-if="!isDarkTheme" class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 1 0 10.5 10.5z" stroke-width="2" stroke-linejoin="round"></path>
                </svg>
                <svg v-else class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <circle cx="12" cy="12" r="4.5" stroke-width="2"></circle>
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2" stroke-width="2" stroke-linecap="round"></path>
                </svg>
              </button>
            </div>
            <div class="flex items-center max-lg:flex lg:hidden shrink-0">
              <template v-if="isAuthenticated">
                <button type="button" class="toolbar-user-btn max-lg:px-2 max-lg:text-[15px]" @click="$emit('open-cabinet')">{{ username }}
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A9 9 0 1118.88 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                </button>
              </template>
              <template v-else>
                <button type="button" class="toolbar-user-btn max-lg:px-2 max-lg:text-[15px]" @click="$emit('open-login')">Войти
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A9 9 0 1118.88 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                </button>
              </template>
            </div>
          </div>
        </div>
        <span class="text-[17px] text-[#5f6368] w-full shrink-0 lg:w-auto">Вкладки:</span>
        <div class="grid w-full min-w-0 grid-cols-3 gap-2 lg:flex lg:w-auto lg:items-center lg:gap-3">
          <button type="button" class="toolbar-tab max-lg:inline-flex max-lg:min-h-[52px] max-lg:items-center max-lg:justify-center max-lg:text-center max-lg:text-[15px] max-lg:leading-snug max-lg:px-1.5" :class="{ 'toolbar-tab--active': activeTab === 'selector' }" @click="switchTab('selector')">Выборка</button>
          <button type="button" class="toolbar-tab max-lg:inline-flex max-lg:min-h-[52px] max-lg:items-center max-lg:justify-center max-lg:text-center max-lg:text-[15px] max-lg:leading-snug max-lg:px-1.5" :class="{ 'toolbar-tab--active': activeTab === 'compare' }" @click="switchTab('compare')">Сравнение периодов</button>
          <button type="button" class="toolbar-tab max-lg:inline-flex max-lg:min-h-[52px] max-lg:items-center max-lg:justify-center max-lg:text-center max-lg:text-[15px] max-lg:leading-snug max-lg:px-1.5" :class="{ 'toolbar-tab--active': activeTab === 'about' }" @click="switchTab('about')">Помощь</button>
        </div>
        <div class="toolbar-round-actions toolbar-round-actions--desktop hidden shrink-0 lg:inline-flex">
          <button type="button" class="toolbar-round-btn" aria-label="Микрофон">
            <svg class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <rect x="9" y="3" width="6" height="10" rx="3" stroke-width="2"></rect>
              <path d="M7 11a5 5 0 0 0 10 0" stroke-width="2" stroke-linecap="round"></path>
              <path d="M12 16v4" stroke-width="2" stroke-linecap="round"></path>
              <path d="M9 20h6" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
          <button type="button" class="toolbar-round-btn" :aria-label="isDarkTheme ? 'Светлая тема' : 'Тёмная тема'" @click="$emit('toggle-theme')">
            <svg v-if="!isDarkTheme" class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 1 0 10.5 10.5z" stroke-width="2" stroke-linejoin="round"></path>
            </svg>
            <svg v-else class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <circle cx="12" cy="12" r="4.5" stroke-width="2"></circle>
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="hidden w-full justify-end lg:flex lg:w-auto lg:shrink-0">
        <template v-if="isAuthenticated">
          <button type="button" class="toolbar-user-btn" @click="$emit('open-cabinet')">{{ username }}
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A9 9 0 1118.88 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          </button>
        </template>
        <template v-else>
          <button type="button" class="toolbar-user-btn" @click="$emit('open-login')">Войти
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A9 9 0 1118.88 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          </button>
        </template>
      </div>
    </div>
    <div class="grid grid-cols-12 gap-3">
      <!-- Левая колонка: фильтры -->
      <aside id="selection-sidebar" class="desktop-sidebar mobile-sidebar col-span-12 lg:col-span-3 xl:col-span-2 flex flex-col gap-2" :class="{ 'mobile-sidebar-open': mobileSidebarOpen }">
        <div class="mobile-sidebar-header">
          <span>Фильтры</span>
          <button type="button" class="mobile-sidebar-close" @click="closeMobileSidebar">✕</button>
        </div>
        <div class="panel p-4">
          <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M16 10a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            Объект выборки
          </h3>
          <input v-model="filter.q" type="text" placeholder="Поиск: бюджет, наименование КЦСР, программа..." class="input mb-3" />

          <div class="space-y-2">
            <label class="block text-xs font-medium text-slate-500">Бюджет</label>
            <select v-model="filter.budget" class="input">
              <option value="">— Все бюджеты —</option>
              <option v-for="b in dictionaries.budget" :key="b.code" :value="b.code">{{ b.code }}</option>
            </select>

            <div class="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label class="block text-xs font-medium text-slate-500">КФСР
                  <span class="abbr-hint" tabindex="0">?
                    <span class="abbr-tooltip">КФСР - код функциональной статьи расхода. Это код, который присваивается каждой статье расхода в зависимости от ее экономического содержания и функциональной направленности.

Состоит из 3-5 разрядов:
1 разряд - код главного распорядителя бюджетных расходов
2-3 разряды - код раздела классификации расходов
4-5 разряды - код подраздела классификации расходов

21502:
2 - министерство юстиции; 15 - Национальная экономика; 02 - Топливно-энергетический комплекс</span>
                  </span>
                </label>
                <select v-model="filter.kfsr" class="input">
                  <option value="">— все —</option>
                  <option v-for="b in dictionaries.kfsr" :key="b.code" :value="b.code">{{ b.code }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-500">КВР
                  <span class="abbr-hint" tabindex="0">?
                    <span class="abbr-tooltip">КВР - Классификация вида расходов. Он классифицирует вид работы.

Состоит обычно из 3 разрядов:
1 разряд: Общероссийский классификатор деятельности предприятий
2 разряд: Общероссийский классификатор единиц измерения
3 разряд: Общероссийский классификатор продукции</span>
                  </span>
                </label>
                <select v-model="filter.kvr" class="input">
                  <option value="">— все —</option>
                  <option v-for="b in dictionaries.kvr" :key="b.code" :value="b.code">{{ b.code }}</option>
                </select>
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 mt-2">КЦСР (целевая статья)
                <span class="abbr-hint" tabindex="0">?
                  <span class="abbr-tooltip">КЦСР - код целевой статьи расхода. Это более точная форма куда именно пойдут деньги.

Состоит из 8-20 разрядов:
1-3 разряды - код главного распорядителя средств
4-5 разряды - код раздела
6-7 разряды - код подраздела
8-17 разряды - код целевой статьи
18-20 разряды - код вида расходов</span>
                </span>
              </label>
              <select v-model="filter.kcsr" class="input">
                <option value="">— все —</option>
                <option v-for="b in dictionaries.kcsr" :key="b.code" :value="b.code">{{ b.code }}</option>
              </select>
            </div>
          </div>
        </div>

        <div class="panel p-4">
          <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V9m4 8V5m4 12v-7M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
            Показатели
          </h3>
          <div class="indicator-stack">
            <button v-for="ind in indicators" :key="ind.id"
                    class="indicator-option"
                    :class="{ active: selectedIndicators.includes(ind.id) }"
                    @click="toggleIndicator(ind.id)">
              {{ ind.label }}
            </button>
          </div>
        </div>

        <div class="panel p-4">
          <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            Период
          </h3>
          <label class="block text-xs font-medium text-slate-500">Начало</label>
          <input v-model="from" type="date" class="input input-date-period mb-2" />
          <label class="block text-xs font-medium text-slate-500">Конец</label>
          <input v-model="to" type="date" class="input input-date-period" />
        </div>

        <div class="panel p-4">
          <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V9m4 8V5m4 12v-7M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
            Режим показа
          </h3>
          <div class="grid grid-cols-2 gap-2">
            <button type="button"
                    class="mode-action-btn"
                    :class="{ active: showTable }"
                    @click="toggleDisplay('table')">
              Таблицы
            </button>
            <div class="relative" ref="chartMenuRoot">
              <button type="button"
                      class="mode-action-btn w-full"
                      :class="{ active: isChartButtonActive }"
                      @click="toggleDisplay('chart')">
                <span>Диаграммы</span>
                <svg class="w-3.5 h-3.5 ml-auto opacity-70 cursor-pointer" fill="none" stroke="currentColor" viewBox="0 0 24 24" @click.stop="toggleChartMenu">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div v-show="chartMenuOpen" class="absolute right-0 bottom-full mb-1 z-[100] w-[180px] user-dropdown-dark rounded-md py-1">
                <label v-for="opt in chartTypeOptions" :key="opt.id" class="dropdown-chart-item">
                  <input type="checkbox"
                         :checked="selectedChartTypes.includes(opt.id)"
                         @change="toggleChartType(opt.id)" />
                  <span>{{ opt.label }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <button class="btn bg-brand-600 hover:bg-brand-700 text-white w-full text-base shadow-panel"
                :disabled="loading || selectedIndicators.length === 0"
                @click="runQuery">
          <span v-if="!loading">Показать результат</span>
          <span v-else>Загрузка…</span>
        </button>
      </aside>
      <div v-if="mobileSidebarOpen" class="mobile-sidebar-overlay" @click="closeMobileSidebar"></div>

      <!-- Правая колонка: результаты -->
      <section class="col-span-12 lg:col-span-9 xl:col-span-10 h-full flex flex-col gap-2">
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
          <div class="panel summary-stat-card p-3 min-h-[110px]">
            <div class="text-[16px] text-[#5f6368] mb-1">Общая сумма</div>
            <div class="text-[22px] font-semibold text-[#202124]">{{ result ? fmtMoney(Object.values(result.totals || {}).reduce((a,b)=>a+(b||0),0)) : '—' }}</div>
          </div>
          <div class="panel summary-stat-card p-3 min-h-[110px]">
            <div class="text-[16px] text-[#5f6368] mb-1">Объекты</div>
            <div class="text-[22px] font-semibold text-[#202124]">{{ result ? result.rows.length : '—' }}</div>
          </div>
          <div class="panel summary-stat-card p-3 min-h-[110px]">
            <div class="text-[16px] text-[#5f6368] mb-1">Период</div>
            <div class="text-[18px] text-[#202124]">{{ from || '...' }} — {{ to || '...' }}</div>
          </div>
          <div class="panel summary-stat-card p-3 min-h-[110px]">
            <div class="text-[16px] text-[#5f6368] mb-1">Выбранные показатели</div>
            <div class="text-[18px] text-[#202124]">{{ selectedIndicators.length || '0' }}</div>
          </div>
        </div>

        <div class="panel p-2.5 ai-summary-panel flex items-center justify-between gap-3">
          <div>
            <div class="text-[24px] font-medium ai-summary-title ml-2 leading-snug">ИИ - сводка (от GigaChat)</div>
          </div>
          <button type="button"
                  class="btn ai-summary-btn ai-summary-btn--large text-white text-[18px] px-5 py-3 font-medium"
                  :disabled="aiLoading || !result"
                  @click="fetchAiSummary">
            {{ aiLoading ? 'Генерация…' : 'Сформировать сводку' }}
          </button>
        </div>
        <div v-if="aiError" class="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{{ aiError }}</div>
        <div v-if="aiSummary" class="panel p-4">
          <div class="whitespace-pre-wrap text-sm text-slate-700">{{ aiSummary }}</div>
        </div>

        <div v-if="!result" class="panel flex-1 min-h-[0] flex items-center justify-center p-2">
          <img src="/images/men_comp.jpg" alt="Готов к работе" class="human-placeholder human-placeholder-uniform opacity-50" />
        </div>

        <template v-else>
          <!-- Таблица -->
          <div v-show="showTable" class="panel overflow-hidden flex-1 min-h-[0]">
            <div class="h-full overflow-auto scroll-thin">
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
          <div v-show="canShowChart" class="panel p-4 flex-1 min-h-[0]">
            <div style="position: relative; height: 100%;">
              <canvas ref="chartCanvas"></canvas>
            </div>
          </div>
        </template>

        <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{{ error }}</div>
      </section>
    </div>
    </div>
  `,
  setup(props, { emit }) {
    const indicators = ref([]);
    const classifiers = ref([]);
    const dictionaries = reactive({ budget: [], kfsr: [], kcsr: [], kvr: [], kosgu: [], kvfo: [], kvsr: [] });
    const snapshots = reactive({ rchb: [], buau: [], agreements: [], gz: [] });

    const filter = reactive({ q: '', budget: '', kfsr: '', kcsr: '', kvr: '', kosgu: '', kvfo: '' });
    const selectedIndicators = ref([]);
    const from = ref('');
    const to = ref('');
    const mode = ref('aggregate');

    const result = ref(null);
    const error = ref('');
    const loading = ref(false);
    const aiSummary = ref('');
    const aiLoading = ref(false);
    const aiError = ref('');
    const showTable = ref(false);
    const showChart = ref(false);
    const chartCanvas = ref(null);
    const chartMenuOpen = ref(false);
    const chartMenuRoot = ref(null);
    const menuOpen = ref(false);
    const menuRoot = ref(null);
    const mobileSidebarOpen = ref(false);
    const chartTypeOptions = [
      { id: 'bar', label: 'Столбчатая' },
      { id: 'histogram', label: 'Гистограмма' },
      { id: 'pie', label: 'Круговая' },
      { id: 'line', label: 'Линейная' },
      { id: 'radar', label: 'Радарная' },
      { id: 'map', label: 'Картодиаграмма' },
    ];
    const selectedChartTypes = ref([]);
    const isChartButtonActive = computed(() => showChart.value && selectedChartTypes.value.length > 0);
    const canShowChart = computed(() => showChart.value && selectedChartTypes.value.length > 0);
    let chartInstance = null;

    async function loadMeta() {
      try {
        const ind = await api('/indicators');
        indicators.value = ind.indicators;
        classifiers.value = ind.classifiers;
        if (selectedIndicators.value.length === 0) {
          selectedIndicators.value = indicators.value.map(indicator => indicator.id);
        }
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
    function onDocClick(e) {
      if (chartMenuOpen.value) {
        const root = chartMenuRoot.value;
        if (!root || !root.contains(e.target)) chartMenuOpen.value = false;
      }
      if (menuOpen.value) {
        const menu = menuRoot.value;
        if (!menu || !menu.contains(e.target)) menuOpen.value = false;
      }
    }
    onMounted(async () => {
      await loadMeta();
      if (!result.value && selectedIndicators.value.length > 0) {
        await runQuery({ silentHistory: true });
      }
      document.addEventListener('click', onDocClick);
    });
    onUnmounted(() => document.removeEventListener('click', onDocClick));

    function toggleDisplay(nextMode) {
      if (nextMode === 'table') {
        showTable.value = !showTable.value;
        return;
      }
      if (selectedChartTypes.value.length === 0) {
        selectedChartTypes.value = ['bar'];
      }
      if (showChart.value) {
        chartMenuOpen.value = true;
        if (result.value && canShowChart.value) nextTick().then(drawChart);
        return;
      }
      showChart.value = true;
      chartMenuOpen.value = true;
      if (result.value && canShowChart.value) nextTick().then(drawChart);
    }
    function toggleChartMenu() {
      chartMenuOpen.value = !chartMenuOpen.value;
    }
    function toggleChartType(id) {
      const idx = selectedChartTypes.value.indexOf(id);
      if (idx === -1) selectedChartTypes.value.push(id);
      else selectedChartTypes.value.splice(idx, 1);
      if (result.value && canShowChart.value) nextTick().then(drawChart);
    }

    function toggleIndicator(id) {
      const i = selectedIndicators.value.indexOf(id);
      if (i === -1) selectedIndicators.value.push(id);
      else selectedIndicators.value.splice(i, 1);
    }
    function switchTab(tabId) {
      mobileSidebarOpen.value = false;
      emit('change-tab', tabId);
    }
    function toggleMobileSidebar() {
      mobileSidebarOpen.value = !mobileSidebarOpen.value;
    }
    function closeMobileSidebar() {
      mobileSidebarOpen.value = false;
    }

    async function runQuery(options = {}) {
      loading.value = true; error.value = '';
      try {
        let data = await api('/query', {
          indicators: selectedIndicators.value,
          filter: { ...filter },
          from: from.value, to: to.value,
          mode: mode.value, strategy: 'latest',
        });
        if (!hasRenderableResult(data) && hasActiveQueryLimits(filter, from.value, to.value)) {
          resetSelectorFilter(filter);
          from.value = '';
          to.value = '';
          data = await api('/query', {
            indicators: selectedIndicators.value,
            filter: { ...filter },
            from: '', to: '',
            mode: mode.value, strategy: 'latest',
          });
        }
        result.value = data;
        ensureDefaultChartState(showTable, showChart, selectedChartTypes);
        if (!options.silentHistory) {
          emit('query-run', {
            tab: 'Выборка',
            tabId: 'selector',
            text: `Показатели: ${selectedIndicators.value.length}, период: ${from.value || '...'} - ${to.value || '...'}`,
            restore: {
              tabId: 'selector',
              data: {
                filter: { ...filter },
                selectedIndicators: [...selectedIndicators.value],
                from: from.value,
                to: to.value,
                mode: mode.value,
                showTable: showTable.value,
                showChart: showChart.value,
                selectedChartTypes: [...selectedChartTypes.value],
              },
            },
          });
        }
        closeMobileSidebar();
        await nextTick();
        if (canShowChart.value) drawChart();
      } catch (e) { error.value = e.message; }
      finally { loading.value = false; }
    }

    async function exportXlsx() {
      try {
        await downloadXlsx('/export/xlsx', {
          indicators: selectedIndicators.value,
          filter: { ...filter },
          from: from.value, to: to.value,
          mode: mode.value, strategy: 'latest',
        }, `vyborka_${new Date().toISOString().slice(0, 10)}.xlsx`);
      } catch (e) { error.value = e.message; }
    }
    async function fetchAiSummary() {
      if (!result.value || aiLoading.value) return;
      aiLoading.value = true;
      aiError.value = '';
      aiSummary.value = '';
      try {
        const data = await api('/ai/summary', {
          kind: 'query',
          indicators: selectedIndicators.value,
          filter: { ...filter },
          from: from.value,
          to: to.value,
          mode: mode.value,
          strategy: 'latest',
        });
        aiSummary.value = String(data?.summary || '').trim();
      } catch (e) {
        aiError.value = e?.message || 'Не удалось получить ИИ-сводку';
      } finally {
        aiLoading.value = false;
      }
    }

    watch(canShowChart, async (v) => {
      if (v && result.value) {
        await nextTick();
        drawChart();
      }
    });
    watch(
      () => props.realtimeRevision,
      async (revision) => {
        if (!revision || loading.value) return;
        await loadMeta();
        if (result.value || selectedIndicators.value.length > 0) {
          await runQuery({ silentHistory: true });
        }
      }
    );
    watch(
      () => props.historyRestore,
      async (restore) => {
        if (!restore || restore.tabId !== 'selector') return;
        const data = restore.data || {};
        Object.assign(filter, data.filter || {});
        selectedIndicators.value = Array.isArray(data.selectedIndicators) ? [...data.selectedIndicators] : [];
        from.value = data.from || '';
        to.value = data.to || '';
        mode.value = data.mode || 'aggregate';
        showTable.value = !!data.showTable;
        showChart.value = !!data.showChart;
        selectedChartTypes.value = Array.isArray(data.selectedChartTypes) ? [...data.selectedChartTypes] : [];
        await runQuery({ silentHistory: true });
      },
      { deep: true, immediate: true }
    );

    function drawChart() {
      if (!chartCanvas.value || !result.value) return;
      if (chartInstance) chartInstance.destroy();
      chartInstance = null;

      const PALETTE = ['#4285f4', '#34a853', '#fbbc04', '#ea4335', '#8b5cf6', '#06b6d4', '#84cc16', '#ec4899'];
      const inds = result.value.indicators;
      const requestedType = selectedChartTypes.value[0] || 'bar';
      const chartType = requestedType === 'histogram' ? 'bar' : requestedType === 'map' ? 'polarArea' : requestedType;

      let labels, datasets;
      if (result.value.meta.mode === 'timeseries') {
        const snaps = [...new Set(result.value.rows.map(r => r.snapshot))].sort();
        labels = snaps;
        datasets = inds.map((ind, i) => {
          const data = snaps.map((s) => result.value.rows.filter((r) => r.snapshot === s).reduce((a, r) => a + (r.values[ind.id] || 0), 0));
          const base = {
            label: ind.label,
            data,
            backgroundColor: PALETTE[i % PALETTE.length] + (chartType === 'line' ? '33' : 'cc'),
            borderColor: PALETTE[i % PALETTE.length],
            borderWidth: 2,
          };
          if (chartType === 'line' || chartType === 'radar') base.tension = 0.25;
          return base;
        });
      } else {
        const top = result.value.rows.slice(0, 15);
        labels = top.map(r => `${r.kcsr || r.kfsr || ''} · ${r.budget?.slice(0, 35) || ''}`);
        if (['pie', 'doughnut', 'polarArea'].includes(chartType)) {
          const primary = inds[0];
          datasets = [{
            label: primary.label,
            data: top.map((r) => r.values[primary.id] || 0),
            backgroundColor: top.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'),
            borderColor: top.map((_, i) => PALETTE[i % PALETTE.length]),
            borderWidth: 1,
          }];
        } else {
          datasets = inds.map((ind, i) => ({
            label: ind.label,
            data: top.map(r => r.values[ind.id] || 0),
            backgroundColor: PALETTE[i % PALETTE.length] + 'cc',
            borderColor: PALETTE[i % PALETTE.length],
            borderRadius: 4,
          }));
        }
      }

      if (typeof Chart === 'undefined') {
        drawCanvasFallback(chartCanvas.value, labels, datasets);
        return;
      }

      chartInstance = new Chart(chartCanvas.value, {
        type: chartType,
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${fmtMoney(getChartTooltipValue(ctx))}`,
              }
            }
          },
          scales: getChartScales(chartType, { maxRotation: 60, minRotation: 30 })
        }
      });
    }

    return {
      indicators, classifiers, dictionaries, snapshots,
      filter, selectedIndicators, from, to, mode,
      result, error, loading, chartCanvas,
      aiSummary, aiLoading, aiError, fetchAiSummary,
      showTable, showChart, isChartButtonActive, canShowChart, chartMenuOpen, chartMenuRoot,
      menuOpen, menuRoot, mobileSidebarOpen,
      chartTypeOptions, selectedChartTypes,
      toggleIndicator, runQuery, exportXlsx,
      toggleDisplay, toggleChartMenu, toggleChartType, switchTab, toggleMobileSidebar, closeMobileSidebar,
      fmtMoney,
    };
  },
};

// ---------- Компонент: Сравнение периодов ----------
const CompareTab = {
  props: {
    activeTab: { type: String, default: 'compare' },
    isAuthenticated: { type: Boolean, default: false },
    isDarkTheme: { type: Boolean, default: false },
    username: { type: String, default: 'Имя пользователя' },
    historyRestore: { type: Object, default: null },
    realtimeRevision: { type: Number, default: 0 },
  },
  emits: ['change-tab', 'open-login', 'open-cabinet', 'toggle-theme', 'query-run'],
  template: `
    <div class="space-y-5">
      <div class="panel p-2 selector-toolbar flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div class="flex flex-col gap-2 min-w-0 flex-1 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2">
          <div class="flex w-full items-center justify-between gap-2 lg:contents">
            <div class="flex items-center gap-2 min-w-0 lg:contents">
              <span class="toolbar-logo-slot shrink-0">
                <span class="toolbar-logo-badge">
                  <img src="/images/Логотип.jpeg" alt="Логотип" class="toolbar-logo-img" />
                </span>
              </span>
              <div class="toolbar-menu-filters-row flex min-w-0 flex-row items-center gap-1.5 lg:gap-2">
                <div class="toolbar-mf-menu-host relative shrink-0" ref="menuRoot">
                  <button type="button" class="toolbar-btn max-lg:px-2 max-lg:text-[15px]" @click.stop="menuOpen = !menuOpen">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
                    Меню
                  </button>
                  <div v-show="menuOpen" class="absolute left-0 top-full mt-1 w-[260px] user-dropdown-dark rounded-md py-1 z-[121]">
                    <div class="dropdown-section-title">Файлы</div>
                    <button type="button" class="dropdown-item-dark">Загрузить файлы</button>
                    <button type="button" class="dropdown-item-dark" :disabled="!result" @click="exportXlsx">Экспортировать в Excel</button>
                    <button type="button" class="dropdown-item-dark">Экспортировать диаграмму как PNG</button>
                    <button type="button" class="dropdown-item-dark">Экспорт в PDF</button>
                  </div>
                </div>
                <button type="button" class="toolbar-btn mobile-sidebar-toggle shrink-0 max-lg:px-2 max-lg:text-[15px]" @click="toggleMobileSidebar">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h18M3 12h18M3 18h18"/></svg>
                  Фильтры
                </button>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0 max-lg:ml-1 lg:contents">
              <div class="toolbar-round-actions toolbar-round-actions--mobile max-lg:ml-0 shrink-0 lg:hidden">
                <button type="button" class="toolbar-round-btn" aria-label="Микрофон">
                  <svg class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="10" rx="3" stroke-width="2"></rect>
                    <path d="M7 11a5 5 0 0 0 10 0" stroke-width="2" stroke-linecap="round"></path>
                    <path d="M12 16v4" stroke-width="2" stroke-linecap="round"></path>
                    <path d="M9 20h6" stroke-width="2" stroke-linecap="round"></path>
                  </svg>
                </button>
                <button type="button" class="toolbar-round-btn" :aria-label="isDarkTheme ? 'Светлая тема' : 'Тёмная тема'" @click="$emit('toggle-theme')">
                  <svg v-if="!isDarkTheme" class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 1 0 10.5 10.5z" stroke-width="2" stroke-linejoin="round"></path>
                  </svg>
                  <svg v-else class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <circle cx="12" cy="12" r="4.5" stroke-width="2"></circle>
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2" stroke-width="2" stroke-linecap="round"></path>
                  </svg>
                </button>
              </div>
              <div class="flex items-center max-lg:flex lg:hidden shrink-0">
                <template v-if="isAuthenticated">
                  <button type="button" class="toolbar-user-btn max-lg:px-2 max-lg:text-[15px]" @click="$emit('open-cabinet')">{{ username }}
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A9 9 0 1118.88 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                  </button>
                </template>
                <template v-else>
                  <button type="button" class="toolbar-user-btn max-lg:px-2 max-lg:text-[15px]" @click="$emit('open-login')">Войти
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A9 9 0 1118.88 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                  </button>
                </template>
              </div>
            </div>
          </div>
          <span class="text-[17px] text-[#5f6368] w-full shrink-0 lg:w-auto">Вкладки:</span>
          <div class="grid w-full min-w-0 grid-cols-3 gap-2 lg:flex lg:w-auto lg:items-center lg:gap-3">
            <button type="button" class="toolbar-tab max-lg:inline-flex max-lg:min-h-[52px] max-lg:items-center max-lg:justify-center max-lg:text-center max-lg:text-[15px] max-lg:leading-snug max-lg:px-1.5" :class="{ 'toolbar-tab--active': activeTab === 'selector' }" @click="switchTab('selector')">Выборка</button>
            <button type="button" class="toolbar-tab max-lg:inline-flex max-lg:min-h-[52px] max-lg:items-center max-lg:justify-center max-lg:text-center max-lg:text-[15px] max-lg:leading-snug max-lg:px-1.5" :class="{ 'toolbar-tab--active': activeTab === 'compare' }" @click="switchTab('compare')">Сравнение периодов</button>
            <button type="button" class="toolbar-tab max-lg:inline-flex max-lg:min-h-[52px] max-lg:items-center max-lg:justify-center max-lg:text-center max-lg:text-[15px] max-lg:leading-snug max-lg:px-1.5" :class="{ 'toolbar-tab--active': activeTab === 'about' }" @click="switchTab('about')">Помощь</button>
          </div>
          <div class="toolbar-round-actions toolbar-round-actions--desktop hidden shrink-0 lg:inline-flex">
            <button type="button" class="toolbar-round-btn" aria-label="Микрофон">
              <svg class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <rect x="9" y="3" width="6" height="10" rx="3" stroke-width="2"></rect>
                <path d="M7 11a5 5 0 0 0 10 0" stroke-width="2" stroke-linecap="round"></path>
                <path d="M12 16v4" stroke-width="2" stroke-linecap="round"></path>
                <path d="M9 20h6" stroke-width="2" stroke-linecap="round"></path>
              </svg>
            </button>
            <button type="button" class="toolbar-round-btn" :aria-label="isDarkTheme ? 'Светлая тема' : 'Тёмная тема'" @click="$emit('toggle-theme')">
              <svg v-if="!isDarkTheme" class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 1 0 10.5 10.5z" stroke-width="2" stroke-linejoin="round"></path>
              </svg>
              <svg v-else class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <circle cx="12" cy="12" r="4.5" stroke-width="2"></circle>
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2" stroke-width="2" stroke-linecap="round"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="hidden w-full justify-end lg:flex lg:w-auto lg:shrink-0">
          <template v-if="isAuthenticated">
            <button type="button" class="toolbar-user-btn" @click="$emit('open-cabinet')">{{ username }}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A9 9 0 1118.88 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            </button>
          </template>
          <template v-else>
            <button type="button" class="toolbar-user-btn" @click="$emit('open-login')">Войти
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A9 9 0 1118.88 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            </button>
          </template>
        </div>
      </div>

      <div class="grid grid-cols-12 gap-3">
        <aside class="desktop-sidebar mobile-sidebar col-span-12 lg:col-span-3 xl:col-span-2 flex flex-col gap-2" :class="{ 'mobile-sidebar-open': mobileSidebarOpen }">
          <div class="mobile-sidebar-header">
            <span>Фильтры</span>
            <button type="button" class="mobile-sidebar-close" @click="closeMobileSidebar">✕</button>
          </div>
          <div class="panel p-4">
            <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M16 10a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
              Объект сравнения
            </h3>
            <input v-model="filter.q" type="text" placeholder="Поиск: бюджет, наименование КЦСР, программа..." class="input mb-3" />

            <div class="space-y-2">
              <label class="block text-xs font-medium text-slate-500">Бюджет</label>
              <select v-model="filter.budget" class="input">
                <option value="">— Все бюджеты —</option>
                <option v-for="b in dictionaries.budget" :key="b.code" :value="b.code">{{ b.code }}</option>
              </select>

              <div class="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label class="block text-xs font-medium text-slate-500">КФСР
                    <span class="abbr-hint" tabindex="0">?
                      <span class="abbr-tooltip">КФСР - код функциональной статьи расхода. Это код, который присваивается каждой статье расхода в зависимости от ее экономического содержания и функциональной направленности.

Состоит из 3-5 разрядов:
1 разряд - код главного распорядителя бюджетных расходов
2-3 разряды - код раздела классификации расходов
4-5 разряды - код подраздела классификации расходов

21502:
2 - министерство юстиции; 15 - Национальная экономика; 02 - Топливно-энергетический комплекс</span>
                    </span>
                  </label>
                  <select v-model="filter.kfsr" class="input">
                    <option value="">— все —</option>
                    <option v-for="b in dictionaries.kfsr" :key="b.code" :value="b.code">{{ b.code }}</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-medium text-slate-500">КВР
                    <span class="abbr-hint" tabindex="0">?
                      <span class="abbr-tooltip">КВР - Классификация вида расходов. Он классифицирует вид работы.

Состоит обычно из 3 разрядов:
1 разряд: Общероссийский классификатор деятельности предприятий
2 разряд: Общероссийский классификатор единиц измерения
3 разряд: Общероссийский классификатор продукции</span>
                    </span>
                  </label>
                  <select v-model="filter.kvr" class="input">
                    <option value="">— все —</option>
                    <option v-for="b in dictionaries.kvr" :key="b.code" :value="b.code">{{ b.code }}</option>
                  </select>
                </div>
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-500 mt-2">КЦСР (целевая статья)
                  <span class="abbr-hint" tabindex="0">?
                    <span class="abbr-tooltip">КЦСР - код целевой статьи расхода. Это более точная форма куда именно пойдут деньги.

Состоит из 8-20 разрядов:
1-3 разряды - код главного распорядителя средств
4-5 разряды - код раздела
6-7 разряды - код подраздела
8-17 разряды - код целевой статьи
18-20 разряды - код вида расходов</span>
                  </span>
                </label>
                <select v-model="filter.kcsr" class="input">
                  <option value="">— все —</option>
                  <option v-for="b in dictionaries.kcsr" :key="b.code" :value="b.code">{{ b.code }}</option>
                </select>
              </div>
            </div>
          </div>

          <div class="panel p-4">
            <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V9m4 8V5m4 12v-7M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
              Показатели
            </h3>
            <div class="indicator-stack">
              <button v-for="ind in indicators" :key="ind.id"
                      class="indicator-option"
                      :class="{ active: selectedIndicators.includes(ind.id) }"
                      @click="toggleIndicator(ind.id)">
                {{ ind.label }}
              </button>
            </div>
          </div>

          <div class="panel p-4">
            <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              Первый Период
            </h3>
            <label class="block text-xs font-medium text-slate-500">Начало</label>
            <input v-model="periods[0].from" type="date" class="input input-date-period mb-2" />
            <label class="block text-xs font-medium text-slate-500">Конец</label>
            <input v-model="periods[0].to" type="date" class="input input-date-period" />
          </div>

          <div class="panel p-4">
            <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              Второй Период
            </h3>
            <label class="block text-xs font-medium text-slate-500">Начало</label>
            <input v-model="periods[1].from" type="date" class="input input-date-period mb-2" />
            <label class="block text-xs font-medium text-slate-500">Конец</label>
            <input v-model="periods[1].to" type="date" class="input input-date-period" />
          </div>

          <div class="panel p-4">
            <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V9m4 8V5m4 12v-7M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
              Режим показа
            </h3>
            <div class="grid grid-cols-2 gap-2">
              <button type="button" class="mode-action-btn" :class="{ active: showTable }" @click="toggleDisplay('table')">Таблицы</button>
              <div class="relative" ref="chartMenuRoot">
                <button type="button" class="mode-action-btn w-full" :class="{ active: isChartButtonActive }" @click="toggleDisplay('chart')">
                  <span>Диаграммы</span>
                  <svg class="w-3.5 h-3.5 ml-auto opacity-70 cursor-pointer" fill="none" stroke="currentColor" viewBox="0 0 24 24" @click.stop="toggleChartMenu">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div v-show="chartMenuOpen" class="absolute right-0 bottom-full mb-1 z-[100] w-[180px] user-dropdown-dark rounded-md py-1">
                  <label v-for="opt in chartTypeOptions" :key="opt.id" class="dropdown-chart-item">
                    <input type="checkbox" :checked="selectedChartTypes.includes(opt.id)" @change="toggleChartType(opt.id)" />
                    <span>{{ opt.label }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <button class="btn bg-brand-600 hover:bg-brand-700 text-white w-full text-base shadow-panel" :disabled="loading || selectedIndicators.length === 0" @click="run">
            <span v-if="!loading">Сравнить</span><span v-else>Считаем…</span>
          </button>
        </aside>
        <div v-if="mobileSidebarOpen" class="mobile-sidebar-overlay" @click="closeMobileSidebar"></div>

        <section class="col-span-12 lg:col-span-9 xl:col-span-10 h-full flex flex-col gap-2">
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
            <div class="panel summary-stat-card p-3 min-h-[110px]">
              <div class="text-[16px] text-[#5f6368] mb-1">Общая сумма</div>
              <div class="text-[22px] font-semibold text-[#202124]">{{ result ? fmtMoney(compareTotalAbs) : '—' }}</div>
            </div>
            <div class="panel summary-stat-card p-3 min-h-[110px]">
              <div class="text-[16px] text-[#5f6368] mb-1">Объекты</div>
              <div class="text-[22px] font-semibold text-[#202124]">{{ result ? result.rows.length : '—' }}</div>
            </div>
            <div class="panel summary-stat-card p-3 min-h-[110px]">
              <div class="text-[16px] text-[#5f6368] mb-1">Период</div>
              <div class="text-[18px] text-[#202124]">
                {{ periods[0].from || '...' }} — {{ periods[0].to || '...' }}<br/>
                {{ periods[1].from || '...' }} — {{ periods[1].to || '...' }}
              </div>
            </div>
            <div class="panel summary-stat-card p-3 min-h-[110px]">
              <div class="text-[16px] text-[#5f6368] mb-1">Выбранные показатели</div>
              <div class="text-[22px] font-semibold text-[#202124]">{{ selectedIndicators.length }}</div>
            </div>
          </div>

          <div class="panel p-2.5 ai-summary-panel flex items-center justify-between gap-3">
            <div>
              <div class="text-[24px] font-medium ai-summary-title ml-2 leading-snug">ИИ - сводка (от GigaChat)</div>
            </div>
            <button type="button"
                    class="btn ai-summary-btn ai-summary-btn--large text-white text-[18px] px-5 py-3 font-medium"
                    :disabled="aiLoading || !result"
                    @click="fetchAiSummaryCompare">
              {{ aiLoading ? 'Генерация…' : 'Сформировать сводку' }}
            </button>
          </div>
          <div v-if="aiError" class="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{{ aiError }}</div>
          <div v-if="aiSummary" class="panel p-4">
            <div class="whitespace-pre-wrap text-sm text-slate-700">{{ aiSummary }}</div>
          </div>

          <div v-if="!result" class="panel flex-1 min-h-[0] flex items-center justify-center p-2">
            <img src="/images/men_comp.jpg"
                 alt="Готов к работе"
                 class="human-placeholder human-placeholder-uniform opacity-50" />
          </div>

          <div v-if="result && showTable" class="panel overflow-hidden flex-1 min-h-[0]">
            <div class="h-full overflow-auto scroll-thin">
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

          <div v-if="result && canShowChart" class="panel p-4 flex-1 min-h-[0]">
            <div style="position: relative; height: 100%;">
              <canvas ref="chartCanvas"></canvas>
            </div>
          </div>
        </div>
        <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{{ error }}</div>
        </section>
      </div>
    </div>
  `,
  setup(props, { emit }) {
    const indicators = ref([]);
    const dictionaries = reactive({ budget: [], kfsr: [], kcsr: [], kvr: [], kosgu: [], kvfo: [], kvsr: [] });
    const filter = reactive({ q: '', budget: '', kfsr: '', kvr: '', kcsr: '' });
    const selectedIndicators = ref([]);
    const periods = reactive([
      { from: '', to: '', label: 'Период 1' },
      { from: '', to: '', label: 'Период 2' },
    ]);
    const result = ref(null);
    const error = ref('');
    const loading = ref(false);
    const aiSummary = ref('');
    const aiLoading = ref(false);
    const aiError = ref('');
    const showTable = ref(false);
    const showChart = ref(false);
    const chartMenuOpen = ref(false);
    const chartMenuRoot = ref(null);
    const chartCanvas = ref(null);
    const chartTypeOptions = [
      { id: 'bar', label: 'Столбчатая' },
      { id: 'histogram', label: 'Гистограмма' },
      { id: 'pie', label: 'Круговая' },
      { id: 'line', label: 'Линейная' },
      { id: 'radar', label: 'Радарная' },
      { id: 'map', label: 'Картодиаграмма' },
    ];
    const selectedChartTypes = ref([]);
    const isChartButtonActive = computed(() => showChart.value && selectedChartTypes.value.length > 0);
    const canShowChart = computed(() => showChart.value && selectedChartTypes.value.length > 0);
    const compareTotalAbs = computed(() => {
      if (!result.value || !result.value.rows || !result.value.indicators) return 0;
      return result.value.rows.reduce((rowAcc, row) => {
        const rowDelta = result.value.indicators.reduce((acc, ind) => acc + Math.abs(row?.delta?.[ind.id]?.abs || 0), 0);
        return rowAcc + rowDelta;
      }, 0);
    });
    const menuOpen = ref(false);
    const menuRoot = ref(null);
    const mobileSidebarOpen = ref(false);
    let chartInstance = null;

    function onDocClick(e) {
      if (chartMenuOpen.value) {
        const root = chartMenuRoot.value;
        if (!root || !root.contains(e.target)) chartMenuOpen.value = false;
      }
      if (menuOpen.value) {
        const menu = menuRoot.value;
        if (!menu || !menu.contains(e.target)) menuOpen.value = false;
      }
    }

    async function loadMeta() {
      try {
        const ind = await api('/indicators');
        indicators.value = ind.indicators;
        for (const f of ['budget', 'kfsr', 'kcsr', 'kvr', 'kosgu', 'kvfo', 'kvsr']) {
          try {
            const d = await api('/dictionary/' + f);
            dictionaries[f] = d.items;
          } catch {}
        }
      } catch (e) { error.value = e.message; }
    }

    onMounted(() => {
      loadMeta();
      document.addEventListener('click', onDocClick);
    });
    onUnmounted(() => document.removeEventListener('click', onDocClick));

    function toggleIndicator(id) {
      const i = selectedIndicators.value.indexOf(id);
      if (i === -1) selectedIndicators.value.push(id);
      else selectedIndicators.value.splice(i, 1);
    }
    function toggleDisplay(nextMode) {
      if (nextMode === 'table') {
        showTable.value = !showTable.value;
        return;
      }
      if (selectedChartTypes.value.length === 0) {
        selectedChartTypes.value = ['bar'];
      }
      if (showChart.value) {
        chartMenuOpen.value = true;
        if (result.value && canShowChart.value) nextTick().then(drawCompareChart);
        return;
      }
      showChart.value = true;
      chartMenuOpen.value = true;
      if (result.value && canShowChart.value) nextTick().then(drawCompareChart);
    }
    function toggleChartMenu() { chartMenuOpen.value = !chartMenuOpen.value; }
    function toggleChartType(id) {
      const idx = selectedChartTypes.value.indexOf(id);
      if (idx === -1) selectedChartTypes.value.push(id);
      else selectedChartTypes.value.splice(idx, 1);
      if (result.value && canShowChart.value) nextTick().then(drawCompareChart);
    }
    function switchTab(tabId) {
      mobileSidebarOpen.value = false;
      emit('change-tab', tabId);
    }
    function toggleMobileSidebar() {
      mobileSidebarOpen.value = !mobileSidebarOpen.value;
    }
    function closeMobileSidebar() {
      mobileSidebarOpen.value = false;
    }
    function deltaClass(n) { return n > 0 ? 'delta-pos' : n < 0 ? 'delta-neg' : 'delta-zero'; }

    async function run(options = {}) {
      loading.value = true; error.value = '';
      try {
        result.value = await api('/compare', {
          indicators: selectedIndicators.value,
          filter: { ...filter },
          periods: JSON.parse(JSON.stringify(periods)),
          strategy: 'latest',
        });
        ensureDefaultChartState(showTable, showChart, selectedChartTypes);
        if (!options.silentHistory) {
          emit('query-run', {
            tab: 'Сравнение периодов',
            tabId: 'compare',
            text: `Показатели: ${selectedIndicators.value.length}, период 1: ${periods[0].from || '...'} - ${periods[0].to || '...'}, период 2: ${periods[1].from || '...'} - ${periods[1].to || '...'}`,
            restore: {
              tabId: 'compare',
              data: {
                filter: { ...filter },
                selectedIndicators: [...selectedIndicators.value],
                periods: JSON.parse(JSON.stringify(periods)),
                showTable: showTable.value,
                showChart: showChart.value,
                selectedChartTypes: [...selectedChartTypes.value],
              },
            },
          });
        }
        closeMobileSidebar();
        if (canShowChart.value) {
          await nextTick();
          drawCompareChart();
        }
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
    async function fetchAiSummaryCompare() {
      if (!result.value || aiLoading.value) return;
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
        aiSummary.value = String(data?.summary || '').trim();
      } catch (e) {
        aiError.value = e?.message || 'Не удалось получить ИИ-сводку';
      } finally {
        aiLoading.value = false;
      }
    }

    watch(canShowChart, async (v) => {
      if (v && result.value) {
        await nextTick();
        drawCompareChart();
      }
    });
    watch(
      () => props.realtimeRevision,
      async (revision) => {
        if (!revision || loading.value) return;
        await loadMeta();
        if (result.value && selectedIndicators.value.length > 0) {
          await run({ silentHistory: true });
        }
      }
    );
    watch(
      () => props.historyRestore,
      async (restore) => {
        if (!restore || restore.tabId !== 'compare') return;
        const data = restore.data || {};
        Object.assign(filter, data.filter || {});
        selectedIndicators.value = Array.isArray(data.selectedIndicators) ? [...data.selectedIndicators] : [];
        if (Array.isArray(data.periods)) {
          periods.splice(0, periods.length, ...data.periods.map((p, i) => ({
            from: p?.from || '',
            to: p?.to || '',
            label: p?.label || `Период ${i + 1}`,
          })));
        }
        showTable.value = !!data.showTable;
        showChart.value = !!data.showChart;
        selectedChartTypes.value = Array.isArray(data.selectedChartTypes) ? [...data.selectedChartTypes] : [];
        await run({ silentHistory: true });
      },
      { deep: true, immediate: true }
    );

    function drawCompareChart() {
      if (!chartCanvas.value || !result.value) return;
      if (chartInstance) chartInstance.destroy();
      chartInstance = null;

      const PALETTE = ['#4285f4', '#34a853', '#fbbc04', '#ea4335', '#8b5cf6', '#06b6d4', '#84cc16', '#ec4899'];
      const inds = result.value.indicators;
      const requestedType = selectedChartTypes.value[0] || 'bar';
      const chartType = requestedType === 'histogram' ? 'bar' : requestedType === 'map' ? 'polarArea' : requestedType;
      const rows = result.value.rows || [];

      let labels = [];
      let datasets = [];

      if (['pie', 'doughnut', 'polarArea'].includes(chartType)) {
        labels = inds.map((ind) => ind.label);
        const totalDeltas = inds.map((ind) =>
          rows.reduce((acc, row) => acc + Math.abs(row?.delta?.[ind.id]?.abs || 0), 0)
        );
        datasets = [{
          label: 'Сумма изменений',
          data: totalDeltas,
          backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'),
          borderColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 1,
        }];
      } else {
        const topRows = rows.slice(0, 12);
        labels = topRows.map((r) => `${r.kcsr || ''} · ${r.budget || ''}`.slice(0, 40));
        datasets = inds.map((ind, i) => {
          const data = topRows.map((r) => r?.delta?.[ind.id]?.abs || 0);
          const base = {
            label: ind.label,
            data,
            backgroundColor: PALETTE[i % PALETTE.length] + (chartType === 'line' ? '33' : 'cc'),
            borderColor: PALETTE[i % PALETTE.length],
            borderWidth: 2,
          };
          if (chartType === 'line' || chartType === 'radar') base.tension = 0.25;
          return base;
        });
      }

      if (typeof Chart === 'undefined') {
        drawCanvasFallback(chartCanvas.value, labels, datasets);
        return;
      }

      chartInstance = new Chart(chartCanvas.value, {
        type: chartType,
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${fmtMoney(getChartTooltipValue(ctx))}`,
              },
            },
          },
          scales: getChartScales(chartType, { maxRotation: 45, minRotation: 0 }),
        },
      });
    }

    return {
      indicators, dictionaries, filter, selectedIndicators, periods, result, error, loading,
      aiSummary, aiLoading, aiError, fetchAiSummaryCompare,
      showTable, showChart, isChartButtonActive, canShowChart, chartMenuOpen, chartMenuRoot, chartCanvas,
      menuOpen, menuRoot, mobileSidebarOpen,
      chartTypeOptions, selectedChartTypes,
      compareTotalAbs,
      toggleIndicator, run, exportXlsx, deltaClass, fmtMoney, fmtPct,
      toggleDisplay, toggleChartMenu, toggleChartType, switchTab, toggleMobileSidebar, closeMobileSidebar,
    };
  },
};

// ---------- Компонент: Об инструменте ----------
const AboutTab = {
  props: {
    activeTab: { type: String, default: 'about' },
    isDarkTheme: { type: Boolean, default: false },
    historyRestore: { type: Object, default: null },
  },
  emits: ['change-tab', 'toggle-theme'],
  template: `
    <div class="space-y-5">
      <div class="panel p-2 selector-toolbar flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div class="flex w-full items-center justify-between gap-2 lg:hidden">
          <span class="toolbar-logo-slot shrink-0">
            <span class="toolbar-logo-badge">
              <img src="/images/Логотип.jpeg" alt="Логотип" class="toolbar-logo-img" />
            </span>
          </span>
          <div class="toolbar-round-actions ml-0 shrink-0">
            <button type="button" class="toolbar-round-btn" aria-label="Микрофон">
              <svg class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <rect x="9" y="3" width="6" height="10" rx="3" stroke-width="2"></rect>
                <path d="M7 11a5 5 0 0 0 10 0" stroke-width="2" stroke-linecap="round"></path>
                <path d="M12 16v4" stroke-width="2" stroke-linecap="round"></path>
                <path d="M9 20h6" stroke-width="2" stroke-linecap="round"></path>
              </svg>
            </button>
            <button type="button" class="toolbar-round-btn" :aria-label="isDarkTheme ? 'Светлая тема' : 'Тёмная тема'" @click="$emit('toggle-theme')">
              <svg v-if="!isDarkTheme" class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 1 0 10.5 10.5z" stroke-width="2" stroke-linejoin="round"></path>
              </svg>
              <svg v-else class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <circle cx="12" cy="12" r="4.5" stroke-width="2"></circle>
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2" stroke-width="2" stroke-linecap="round"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="hidden lg:flex items-center gap-2 shrink-0">
          <span class="toolbar-logo-slot shrink-0">
            <span class="toolbar-logo-badge">
              <img src="/images/Логотип.jpeg" alt="Логотип" class="toolbar-logo-img" />
            </span>
          </span>
        </div>
        <div class="flex flex-col gap-2 min-w-0 flex-1 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2">
          <span class="text-[17px] text-[#5f6368] w-full shrink-0 lg:w-auto">Вкладки:</span>
          <div class="grid w-full min-w-0 grid-cols-3 gap-2 lg:flex lg:w-auto lg:items-center lg:gap-3">
            <button type="button" class="toolbar-tab max-lg:inline-flex max-lg:min-h-[52px] max-lg:items-center max-lg:justify-center max-lg:text-center max-lg:text-[15px] max-lg:leading-snug max-lg:px-1.5" :class="{ 'toolbar-tab--active': activeTab === 'selector' }" @click="switchTab('selector')">Выборка</button>
            <button type="button" class="toolbar-tab max-lg:inline-flex max-lg:min-h-[52px] max-lg:items-center max-lg:justify-center max-lg:text-center max-lg:text-[15px] max-lg:leading-snug max-lg:px-1.5" :class="{ 'toolbar-tab--active': activeTab === 'compare' }" @click="switchTab('compare')">Сравнение периодов</button>
            <button type="button" class="toolbar-tab max-lg:inline-flex max-lg:min-h-[52px] max-lg:items-center max-lg:justify-center max-lg:text-center max-lg:text-[15px] max-lg:leading-snug max-lg:px-1.5" :class="{ 'toolbar-tab--active': activeTab === 'about' }" @click="switchTab('about')">Помощь</button>
          </div>
        </div>
        <div class="toolbar-round-actions hidden shrink-0 lg:flex">
          <button type="button" class="toolbar-round-btn" aria-label="Микрофон">
            <svg class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <rect x="9" y="3" width="6" height="10" rx="3" stroke-width="2"></rect>
              <path d="M7 11a5 5 0 0 0 10 0" stroke-width="2" stroke-linecap="round"></path>
              <path d="M12 16v4" stroke-width="2" stroke-linecap="round"></path>
              <path d="M9 20h6" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
          <button type="button" class="toolbar-round-btn" :aria-label="isDarkTheme ? 'Светлая тема' : 'Тёмная тема'" @click="$emit('toggle-theme')">
            <svg v-if="!isDarkTheme" class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 1 0 10.5 10.5z" stroke-width="2" stroke-linejoin="round"></path>
            </svg>
            <svg v-else class="toolbar-round-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <circle cx="12" cy="12" r="4.5" stroke-width="2"></circle>
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
      </div>

      <div class="panel p-6 min-h-[680px]">
        <h2 class="text-xl font-bold mb-3">Конструктор аналитических выборок</h2>
        <p class="text-slate-600">Объединяет данные трёх ключевых информационных систем (АЦК-Планирование, АЦК-Финансы, АЦК-Госзаказ) и БУАУ в едином интерфейсе. Связка идёт через сквозную бюджетную классификацию (КФСР · КЦСР · КВР · КОСГУ · КВФО).</p>
        <div class="mt-4">
          <h3 class="font-semibold mb-1">Источники данных</h3>
          <ul class="list-disc pl-5 text-slate-700 space-y-1 text-sm">
            <li><b>РЧБ</b> — помесячные снимки нарастающим итогом: лимиты ПБС (план), принятые БО, остаток лимитов, кассовые выплаты.</li>
            <li><b>Соглашения</b> — снимки по соглашениям (МБТ, ИЦ, ЮЛ_ИП_ФЛ) c суммой на год.</li>
            <li><b>Госзаказ</b> — реестр контрактов и фактов оплат.</li>
            <li><b>БУАУ</b> — выгрузки по бюджетным/автономным учреждениям.</li>
          </ul>
        </div>
        <div class="mt-4">
          <h3 class="font-semibold mb-1">Стратегия расчёта</h3>
          <ul class="list-disc pl-5 text-slate-700 space-y-1 text-sm">
            <li><b>Последний снимок</b> — для нарастающего итога РЧБ берётся последний доступный снимок ≤ верхней границы периода.</li>
            <li><b>Сумма за период</b> — суммируются все наблюдения внутри периода (для контрактов/платежей).</li>
          </ul>
        </div>
        <div class="mt-4">
          <h3 class="font-semibold mb-1">Стек MVP</h3>
          <ul class="text-sm text-slate-700 space-y-1">
            <li>• Backend: Node.js · Express · csv-parse · ExcelJS</li>
            <li>• Frontend: Vue 3 · TailwindCSS · Chart.js</li>
            <li>• Хранение: in-memory (CSV из исходной папки)</li>
          </ul>
        </div>
        <div class="mt-4">
          <h3 class="font-semibold mb-1">Целевая архитектура</h3>
          <ul class="text-sm text-slate-700 space-y-1">
            <li>• БД: PostgreSQL Pro</li>
            <li>• Backend: Python · Django (или Java · Spring Boot)</li>
            <li>• ETL: Apache NiFi для регулярной загрузки</li>
            <li>• ОС: РЕД ОС / Astra Linux</li>
          </ul>
        </div>
      </div>
    </div>
  `,
  setup(props, { emit }) {
    function switchTab(tabId) { emit('change-tab', tabId); }
    return { switchTab };
  },
};

createApp(App).mount('#app');
