import './loadEnv.js';
import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, DATA_DIR } from './config.js';
import { store } from './dataStore.js';
import { requireAuth } from './authSession.js';
import authRouter from './routes/auth.js';
import metaRouter from './routes/meta.js';
import queryRouter from './routes/query.js';
import exportRouter from './routes/export.js';
import aiRouter from './routes/ai.js';
import userDataRouter from './routes/userData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');

// Базовые HTTP-заголовки безопасности.
// CSP отключаем, т.к. текущий UI использует inline/CDN-скрипты в MVP.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '4mb' }));

const FRONTEND_DIR = path.resolve(__dirname, '..', 'BPK-IT_Alpha-ver-30-main', 'frontend');
if (!fs.existsSync(FRONTEND_DIR)) {
  throw new Error(`FRONTEND_NOT_FOUND: ${FRONTEND_DIR}`);
}
const PUBLIC_DIR = FRONTEND_DIR;
const IMAGES_DIR = path.resolve(PUBLIC_DIR, 'images');
const ATTACHED_IMAGES_DIR = path.resolve(
  process.env.USERPROFILE || 'C:\\Users\\user',
  '.cursor',
  'projects',
  'c-Users-user-Desktop-BPK-IT-Alpha-ver-30-main',
  'assets',
);
const ATTACHED_LOGO_FILE = path.resolve(
  ATTACHED_IMAGES_DIR,
  'c__Users_user_Desktop_BPK-IT_Alpha-ver-30-main_images________.jpg',
);
const ATTACHED_PLACEHOLDER_FILE = path.resolve(
  ATTACHED_IMAGES_DIR,
  'c__Users_user_Desktop_BPK-IT_Alpha-ver-30-main_images_men_comp.jpg',
);
app.use(express.static(PUBLIC_DIR, {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    // Отключаем кеш статики, чтобы браузер не показывал старый UI после переключения frontend-папки.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));
if (fs.existsSync(IMAGES_DIR)) {
  app.use('/images', express.static(IMAGES_DIR, {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  }));
}
app.get('/images/Логотип.jpeg', (req, res, next) => {
  if (fs.existsSync(ATTACHED_LOGO_FILE)) {
    return res.sendFile(ATTACHED_LOGO_FILE);
  }
  return next();
});
app.get('/images/men_comp.jpg', (req, res, next) => {
  if (fs.existsSync(ATTACHED_PLACEHOLDER_FILE)) {
    return res.sendFile(ATTACHED_PLACEHOLDER_FILE);
  }
  return next();
});
app.get('/images/:fileName', (req, res, next) => {
  const fileName = String(req.params.fileName || '').trim().toLowerCase();
  if (!fileName) return next();
  if ((fileName === 'логотип.jpeg' || fileName === 'логотип.jpg') && fs.existsSync(ATTACHED_LOGO_FILE)) {
    return res.sendFile(ATTACHED_LOGO_FILE);
  }
  if ((fileName === 'men_comp.jpg' || fileName === 'men_comp.jpeg') && fs.existsSync(ATTACHED_PLACEHOLDER_FILE)) {
    return res.sendFile(ATTACHED_PLACEHOLDER_FILE);
  }
  return next();
});

function sendSvg(res, svg) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.type('image/svg+xml').send(svg);
}

app.get('/toolbar-logo', (_req, res) => {
  sendSvg(
    res,
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="32" viewBox="0 0 120 32" role="img" aria-label="BPK">
      <rect width="120" height="32" rx="8" fill="#e8f0fe"/>
      <circle cx="20" cy="16" r="10" fill="#3367d6"/>
      <text x="20" y="20" text-anchor="middle" font-size="10" font-family="Inter,Arial,sans-serif" fill="#fff" font-weight="700">AO</text>
      <text x="38" y="20" font-size="12" font-family="Inter,Arial,sans-serif" fill="#174ea6" font-weight="600">BPK Finance</text>
    </svg>`,
  );
});

app.get('/placeholder-image', (_req, res) => {
  sendSvg(
    res,
    `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="320" viewBox="0 0 520 320" role="img" aria-label="placeholder">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f8fafc"/>
          <stop offset="100%" stop-color="#e2e8f0"/>
        </linearGradient>
      </defs>
      <rect width="520" height="320" rx="18" fill="url(#bg)"/>
      <circle cx="260" cy="128" r="56" fill="#dbeafe"/>
      <path d="M238 132c0-12 10-22 22-22s22 10 22 22v20h-44z" fill="#2563eb" opacity="0.9"/>
      <rect x="180" y="212" width="160" height="18" rx="9" fill="#94a3b8"/>
      <text x="260" y="260" text-anchor="middle" font-size="18" font-family="Inter,Arial,sans-serif" fill="#334155" font-weight="600">Данные появятся после запроса</text>
    </svg>`,
  );
});

// Авторизация без регистрации для тестовых пользователей.
app.use('/api', authRouter);
// Все остальные API защищаем авторизацией.
app.use('/api', requireAuth);
app.use('/api', metaRouter);
app.use('/api', queryRouter);
app.use('/api', exportRouter);
app.use('/api', aiRouter);
app.use('/api', userDataRouter);

app.use((err, req, res, _next) => {
  console.error('[ERR]', err);
  if (err?.name === 'MulterError') {
    return res.status(400).json({
      code: 'MULTER_UPLOAD_ERROR',
      error: 'Ошибка загрузки файла',
      details: err.message,
    });
  }
  if (String(err?.message || '').includes('Допустимы только файлы')) {
    return res.status(400).json({
      code: 'FILE_TYPE_NOT_ALLOWED',
      error: 'Недопустимый тип файла',
      details: err.message,
    });
  }
  // В проде не раскрываем внутренние детали ошибок.
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    code: 'INTERNAL_SERVER_ERROR',
    error: 'Внутренняя ошибка сервера',
    details: isProd ? '' : (err?.stack || err?.message || 'Unknown error'),
  });
});

console.log('[BOOT] Источник данных:', DATA_DIR);
console.log('[BOOT] Источник frontend:', PUBLIC_DIR);
store.load({ reason: 'startup' });
store.startRealtimeRefresh();

app.listen(PORT, () => {
  console.log(`[BOOT] Сервер запущен: http://localhost:${PORT}`);
});
