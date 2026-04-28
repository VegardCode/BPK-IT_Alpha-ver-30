import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, DATA_DIR } from './config.js';
import { store } from './dataStore.js';
import metaRouter from './routes/meta.js';
import queryRouter from './routes/query.js';
import exportRouter from './routes/export.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '4mb' }));

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

app.use('/api', metaRouter);
app.use('/api', queryRouter);
app.use('/api', exportRouter);

app.use((err, req, res, _next) => {
  console.error('[ERR]', err);
  res.status(500).json({ error: err.message });
});

console.log('[BOOT] Источник данных:', DATA_DIR);
store.load();

app.listen(PORT, () => {
  console.log(`[BOOT] Сервер запущен: http://localhost:${PORT}`);
});
