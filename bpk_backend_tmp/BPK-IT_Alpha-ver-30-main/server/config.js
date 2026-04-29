import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..');

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'Кейс_ Интеллектуальный отбор данных (БФТ, Минфин АО)');

export const SUBDIRS = {
  rchb: '1. РЧБ',
  agreements: '2. Соглашения',
  gz: '3. ГЗ',
  buau: '4. Выгрузка БУАУ',
};

export const PORT = Number(process.env.PORT || 3000);

// Канонический список показателей. Каждый показатель имеет:
//   id     — машинный код (используется в API)
//   label  — человекочитаемое имя (UI)
//   source — источник данных
//   unit   — единица измерения ("руб.")
//   group  — группа в UI
export const INDICATORS = [
  { id: 'plan',           label: 'План (лимиты ПБС)',          source: 'rchb',       group: 'РЧБ',         unit: 'руб.' },
  { id: 'bo',             label: 'Принятые БО',                 source: 'rchb',       group: 'РЧБ',         unit: 'руб.' },
  { id: 'limit_remainder', label: 'Остаток лимитов',             source: 'rchb',       group: 'РЧБ',         unit: 'руб.' },
  { id: 'cash',           label: 'Кассовые выплаты',             source: 'rchb',       group: 'РЧБ',         unit: 'руб.' },
  { id: 'agreements',     label: 'Сумма соглашений',             source: 'agreements', group: 'Соглашения',  unit: 'руб.' },
  { id: 'contracts',      label: 'Сумма контрактов',             source: 'gz',         group: 'Госзаказ',    unit: 'руб.' },
  { id: 'payments',       label: 'Платежи по контрактам',        source: 'gz',         group: 'Госзаказ',    unit: 'руб.' },
  { id: 'buau_payments',  label: 'БУАУ — выплаты',               source: 'buau',       group: 'БУАУ',        unit: 'руб.' },
  { id: 'buau_executed',  label: 'БУАУ — исполнение',            source: 'buau',       group: 'БУАУ',        unit: 'руб.' },
];

// Поля сквозной кодировки (по которым можно фильтровать «объект»)
export const CLASSIFIER_FIELDS = [
  { id: 'budget',  label: 'Бюджет' },
  { id: 'kfsr',    label: 'КФСР' },
  { id: 'kcsr',    label: 'КЦСР (целевая статья)' },
  { id: 'kvr',     label: 'КВР' },
  { id: 'kvsr',    label: 'КВСР' },
  { id: 'kosgu',   label: 'КОСГУ' },
  { id: 'kvfo',    label: 'КВФО' },
];
