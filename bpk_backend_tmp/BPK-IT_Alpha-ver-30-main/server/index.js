import './loadEnv.js';
import express from 'express';
import helmet from 'helmet';
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

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

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
store.load();

app.listen(PORT, () => {
  console.log(`[BOOT] Сервер запущен: http://localhost:${PORT}`);
});
