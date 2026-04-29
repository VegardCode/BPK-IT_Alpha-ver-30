import fs from 'node:fs';
import path from 'node:path';

const BASE = 'c:/Users/Rifresh/Desktop/Amurcode/Кейс_ Интеллектуальный отбор данных (БФТ, Минфин АО)';

function head(file, n = 6) {
  const buf = fs.readFileSync(file);
  let txt = buf.toString('utf8');
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  const lines = txt.split(/\r?\n/);
  console.log('===== ' + path.relative(BASE, file) + ' =====');
  console.log('TOTAL LINES:', lines.length);
  for (let i = 0; i < Math.min(n, lines.length); i++) {
    const line = lines[i];
    console.log(`[${i}] ${line.length > 400 ? line.slice(0, 400) + '...<TRUNC>' : line}`);
  }
  console.log();
}

const files = [
  '1. РЧБ/январь2025.csv',
  '1. РЧБ/декабрь2025.csv',
  '4. Выгрузка БУАУ/хакатон БУАУ август 2025.csv',
  '2. Соглашения/на01012026.csv',
  '3. ГЗ/Бюджетные строки.csv',
  '3. ГЗ/Контракты и договора.csv',
  '3. ГЗ/Платежки.csv',
];

for (const f of files) head(path.join(BASE, f), 12);
