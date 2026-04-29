import GigaChat from 'gigachat';
import { Agent } from 'node:https';

/** HTTPS-агент как в официальных примерах GigaChat (корневой сертификат Минцифры). */
const httpsAgent = new Agent({ rejectUnauthorized: false });

let singleton = null;

export function isGigaChatConfigured() {
  return Boolean(process.env.GIGACHAT_CREDENTIALS?.trim());
}

export function getGigaChatClient() {
  if (!isGigaChatConfigured()) return null;
  if (!singleton) {
    singleton = new GigaChat({
      credentials: process.env.GIGACHAT_CREDENTIALS.trim(),
      scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
      model: process.env.GIGACHAT_MODEL || 'GigaChat',
      timeout: Number(process.env.GIGACHAT_TIMEOUT_SEC || 120),
      httpsAgent,
    });
  }
  return singleton;
}

const SYSTEM_PROMPT = `Ты финансовый аналитик бюджетных данных государственного сектора РФ.
По приведённой ниже выгрузке из конструктора аналитических выборок напиши краткую сводку на русском языке: 4–8 предложений.
Правила:
- Опирайся только на цифры и подписи из текста пользователя; ничего не выдумывай.
- Укажи период, режим расчёта и фильтры, если они есть в данных.
- Коротко опиши итоги по выбранным показателям (суммы), отметь 2–4 крупнейших объекта/статьи из таблицы, если они перечислены.
- Если сравниваются периоды — отметь направление изменения (рост/снижение) по ключевым показателям.
- Оформи ответ в Markdown: краткий заголовок ## при необходимости, маркированные списки, **выделение** ключевых сумм и объектов.
- Не подписывай ответ источником модели — служебная строка добавляется интерфейсом отдельно.
- Суммы в рублях подписывай понятно (например «152,3 млн руб.» для крупных значений).`;

const VOICE_NORMALIZE_PROMPT = `Ты помощник для обработки голосовых команд в финансовом интерфейсе.
Задача: исправить только явные ошибки распознавания речи (опечатки, падеж, лишние слова-паразиты), но сохранить исходный смысл.
Если исходная команда уже корректна и понятна — верни её без изменений.
Верни только JSON без пояснений в формате:
{"normalized":"...","changed":true|false}
Правила:
- normalized: строка на русском, максимум 220 символов.
- changed=true только если ты реально исправил текст.
- Ничего не выдумывай и не добавляй новые сущности.`;

/**
 * @param {string} userDigest — компактное описание выборки для модели
 * @returns {Promise<string>}
 */
export async function summarizeDigest(userDigest) {
  const client = getGigaChatClient();
  if (!client) {
    throw new Error('GigaChat не настроен: задайте переменную окружения GIGACHAT_CREDENTIALS');
  }
  const resp = await client.chat({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userDigest },
    ],
  });
  const text = resp.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) {
    throw new Error('Пустой ответ GigaChat');
  }
  return String(text).trim();
}

/**
 * Нормализация распознанной речи:
 * - корректируем явные ASR-ошибки;
 * - если текст уже корректен, возвращаем как есть.
 */
export async function normalizeVoiceCommandText(rawText) {
  const source = String(rawText || '').trim();
  if (!source) return { normalized: '', changed: false };
  const client = getGigaChatClient();
  if (!client) {
    throw new Error('GigaChat не настроен: задайте переменную окружения GIGACHAT_CREDENTIALS');
  }

  const resp = await client.chat({
    messages: [
      { role: 'system', content: VOICE_NORMALIZE_PROMPT },
      { role: 'user', content: source },
    ],
    temperature: 0.1,
    max_tokens: 220,
  });
  const text = String(resp.choices?.[0]?.message?.content || '').trim();
  if (!text) return { normalized: source, changed: false };

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    const normalized = String(parsed?.normalized || source).trim().slice(0, 220);
    // Считаем изменение фактическим, если строка реально поменялась.
    const changed = normalized !== source;
    return { normalized: normalized || source, changed };
  } catch {
    const normalized = text.replace(/^["']|["']$/g, '').trim().slice(0, 220);
    return { normalized: normalized || source, changed: (normalized || source) !== source };
  }
}
