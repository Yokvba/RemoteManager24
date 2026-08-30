import { randomUUID } from 'node:crypto';
import { webConfig } from './config.js';

const sessionStore = new Map();

export function getSessionId(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('sessionId='));

  return cookie ? decodeURIComponent(cookie.slice('sessionId='.length)) : null;
}

export function getCurrentUser(req) {
  const sessionId = getSessionId(req);
  return sessionId ? sessionStore.get(sessionId) || null : null;
}

export function requireAuth(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, message: 'Authentication required.' }));
    return null;
  }

  return user;
}

export function createSession(username) {
  const sessionId = randomUUID();
  sessionStore.set(sessionId, username);
  return sessionId;
}

export function destroySession(req) {
  const sessionId = getSessionId(req);
  if (sessionId) {
    sessionStore.delete(sessionId);
  }
}

export function validateLogin(username, password) {
  const user = (webConfig.users || []).find(
    (entry) => entry.username === username && entry.password === password
  );

  return user ? user.username : null;
}
