import crypto from 'node:crypto';

const AUTH_COOKIE = 'amur_auth_sid';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const defaultUsers = [
  { username: 'user1', password: 'user123', name: 'Иванов Иван Иванович' },
  { username: 'user2', password: 'user123', name: 'Петров Петр Петрович' },
  { username: 'user3', password: 'user123', name: 'Сидорова Анна Сергеевна' },
];

const sessions = new Map();

function safeText(v, max = 120) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

function parseUsersFromEnv() {
  const raw = String(process.env.TEST_USERS_JSON || '').trim();
  if (!raw) return defaultUsers;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultUsers;
    const users = parsed
      .map(u => ({
        username: safeText(u?.username, 64),
        password: safeText(u?.password, 128),
        name: safeText(u?.name, 120) || safeText(u?.username, 64),
      }))
      .filter(u => u.username && u.password);
    return users.length ? users : defaultUsers;
  } catch {
    return defaultUsers;
  }
}

const testUsers = parseUsersFromEnv();

function parseCookies(cookieHeader = '') {
  const out = {};
  for (const part of String(cookieHeader).split(';')) {
    const [k, ...v] = part.split('=');
    const key = String(k || '').trim();
    if (!key) continue;
    const rawValue = v.join('=').trim();
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch {
      out[key] = rawValue;
    }
  }
  return out;
}

function sanitizeUser(user) {
  return { username: user.username, name: user.name };
}

function createSession(user) {
  const sid = crypto.randomUUID();
  sessions.set(sid, {
    user: sanitizeUser(user),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return sid;
}

function readSessionByReq(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sid = safeText(cookies[AUTH_COOKIE], 200);
  if (!sid) return null;
  const item = sessions.get(sid);
  if (!item) return null;
  if (!item.expiresAt || item.expiresAt < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return { sid, user: item.user };
}

export function setAuthCookie(res, sid) {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`);
}

export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function loginWithCredentials(username, password) {
  const u = safeText(username, 64);
  const p = safeText(password, 128);
  const found = testUsers.find(x => x.username === u && x.password === p);
  if (!found) return null;
  const sid = createSession(found);
  return { sid, user: sanitizeUser(found) };
}

export function getCurrentAuth(req) {
  return readSessionByReq(req);
}

export function logoutByReq(req) {
  const item = readSessionByReq(req);
  if (item?.sid) sessions.delete(item.sid);
}

export function listTestUsers() {
  return testUsers.map(u => ({ username: u.username, password: u.password, name: u.name }));
}

export function requireAuth(req, res, next) {
  const auth = readSessionByReq(req);
  if (!auth) {
    return res.status(401).json({
      code: 'AUTH_REQUIRED',
      error: 'Требуется авторизация',
      details: 'Войдите под тестовым пользователем',
    });
  }
  req.authUser = auth.user;
  next();
}
