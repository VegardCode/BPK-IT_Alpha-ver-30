import { Router } from 'express';
import {
  clearAuthCookie,
  getCurrentAuth,
  listTestUsers,
  loginWithCredentials,
  logoutByReq,
  setAuthCookie,
} from '../authSession.js';

const router = Router();

function safeText(v, max = 120) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

router.get('/auth/me', (req, res) => {
  const auth = getCurrentAuth(req);
  if (!auth) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Не авторизован', details: '' });
  res.json({ authenticated: true, user: auth.user });
});

router.post('/auth/login', (req, res) => {
  const body = req.body || {};
  const username = safeText(body.username, 64);
  const password = safeText(body.password, 128);
  if (!username || !password) {
    return res.status(400).json({
      code: 'AUTH_LOGIN_INVALID_PAYLOAD',
      error: 'Логин и пароль обязательны',
      details: 'Передайте username и password',
    });
  }
  const logged = loginWithCredentials(username, password);
  if (!logged) {
    return res.status(401).json({
      code: 'AUTH_LOGIN_FAILED',
      error: 'Неверный логин или пароль',
      details: 'Используйте тестовые учетные записи',
    });
  }
  setAuthCookie(res, logged.sid);
  res.json({ ok: true, user: logged.user });
});

router.post('/auth/logout', (req, res) => {
  logoutByReq(req);
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/auth/test-users', (_req, res) => {
  res.json({ users: listTestUsers() });
});

export default router;
