import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, destroySession, getCurrentUser, requireAuth, validateLogin } from './auth.js';
import { config, minecraftConfig, webConfig } from './config.js';
import {
  getHostStatus,
  getLatestLogs,
  getStartCommand,
  getStopCommand,
  isServerOnline,
  runCommand,
  runHostCommand,
  sendConsoleCommand,
} from './server-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8').trim();

      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStaticFile(req, res, relativePath) {
  const safePath = relativePath === '/' ? 'index.html' : relativePath.replace(/^\/+|\/+$/g, '');
  const filePath = path.resolve(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    sendJson(res, 403, { success: false, message: 'Forbidden.' });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.js') {
    sendJson(res, 403, { success: false, message: 'Direct asset access is not allowed.' });
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const contentType = mimeTypes[extension] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(file);
  } catch (error) {
    sendJson(res, 404, { success: false, message: 'File not found.' });
  }
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/') {
    await serveStaticFile(req, res, '/index.html');
    return;
  }

  if (req.method === 'GET' && pathname === '/app.js') {
    sendJson(res, 403, { success: false, message: 'Direct asset access is not allowed.' });
    return;
  }

  if (req.method === 'GET' && pathname === '/styles.css') {
    await serveStaticFile(req, res, '/styles.css');
    return;
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    try {
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '').trim();
      const validUser = validateLogin(username, password);

      if (!validUser) {
        sendJson(res, 401, { success: false, message: 'Invalid username or password.' });
        return;
      }

      const sessionId = createSession(validUser);

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `sessionId=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
      });
      res.end(JSON.stringify({ success: true, user: validUser }));
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    destroySession(req);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'sessionId=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    });
    res.end(JSON.stringify({ success: true, message: 'Logged out.' }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/session') {
    const user = getCurrentUser(req);
    sendJson(res, 200, {
      success: true,
      loggedIn: Boolean(user),
      user: user || null,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/status') {
    const user = requireAuth(req, res);
    if (!user) return;

    const hostStatus = await getHostStatus();
    const screenOnline = await isServerOnline();
    const online = Boolean(screenOnline || hostStatus.online);
    sendJson(res, 200, {
      success: true,
      online,
      screenOnline,
      hostOnline: Boolean(hostStatus.online),
      screenName: minecraftConfig.screenName,
      serverPath: minecraftConfig.serverPath,
      webUrl: config.minecraft.webUrl,
      status: online ? 'Online' : 'Offline',
      hostStatus,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/logs') {
    const user = requireAuth(req, res);
    if (!user) return;

    const output = await getLatestLogs();
    sendJson(res, 200, { success: true, output });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/run') {
    const user = requireAuth(req, res);
    if (!user) return;

    try {
      const body = await readBody(req);
      const output = await runHostCommand(body.command || '');
      sendJson(res, 200, { success: true, output });
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/start') {
    const user = requireAuth(req, res);
    if (!user) return;

    const command = getStartCommand();
    const output = await runCommand(command);
    sendJson(res, 200, { success: true, output, screenName: minecraftConfig.screenName, command });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/stop') {
    const user = requireAuth(req, res);
    if (!user) return;

    const online = await isServerOnline();
    const output = online
      ? await runCommand(getStopCommand())
      : `No \`${minecraftConfig.screenName}\` screen session was found. The stop command was not run.`;

    sendJson(res, 200, { success: true, output, online });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/console') {
    const user = requireAuth(req, res);
    if (!user) return;

    try {
      const body = await readBody(req);
      const output = await sendConsoleCommand(body.command || '');
      sendJson(res, 200, { success: true, output });
    } catch (error) {
      sendJson(res, 400, { success: false, message: error.message });
    }
    return;
  }

  sendJson(res, 404, { success: false, message: 'Not found.' });
}
