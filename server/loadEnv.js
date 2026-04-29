/**
 * Загружает переменные окружения до импорта остальных модулей приложения.
 * Порядок: сначала `.env`, затем `gigachat.env` в корне проекта (можно держать ключ только там).
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });
dotenv.config({ path: path.join(ROOT, 'gigachat.env') });
