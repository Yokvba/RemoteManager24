import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = JSON.parse(await fs.readFile(new URL('../config.json', import.meta.url), 'utf8'));
const { screenName, serverPath, webUrl } = config.minecraft;
const { host = '0.0.0.0', port = 3000 } = config.web || {};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function outputText(stdout, stderr) {
  return (stdout || '').trim() || (stderr || '').trim() || 'Command completed successfully.';
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function isServerOnline() {
  try {
    const { stdout, stderr } = await execAsync('screen -ls', { timeout: 5000, windowsHide: true });
    return `${stdout}\n${stderr}`.includes(screenName);
  } catch (error) {
    return `${error.stdout || ''}\n${error.stderr || ''}`.includes(screenName);
  }
}

async function runCommand(command) {
  try {
    const result = await execAsync(command, { timeout: 15000, windowsHide: true });
    return outputText(result.stdout, result.stderr);
  } catch (error) {
    const output = outputText(error.stdout, error.stderr);
    return output === 'Command completed successfully.' ? error.message : output;
  }
}

async function getLatestLogs() {
  const logDir = path.resolve('/tmp');
  await fs.mkdir(logDir, { recursive: true }).catch(() => {});

  const logFile = path.join(logDir, `${screenName}-screen-${process.pid}-${Date.now()}.log`);

  try {
    await execFileAsync('screen', ['-S', screenName, '-X', 'hardcopy', '-h', logFile], {
      timeout: 5000,
      windowsHide: true,
    });
    await wait(100);

    const log = await fs.readFile(logFile, 'utf8');
    const lines = log.trimEnd().split(/\r?\n/).slice(-20).join('\n');
    return lines || 'No log output returned.';
  } catch (error) {
    return error.message || 'Unable to read the server log.';
  } finally {
    await fs.rm(logFile, { force: true }).catch(() => {});
  }
}

async function sendConsoleCommand(command) {
  const trimmed = (command || '').trim();

  if (!trimmed) {
    return 'No command was provided.';
  }

  await execFileAsync('screen', ['-S', screenName, '-p', '0', '-X', 'stuff', `${trimmed}\r`], {
    timeout: 5000,
    windowsHide: true,
  });

  await wait(400);
  return getLatestLogs();
}

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
  if (['.js', '.css'].includes(extension)) {
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

export function startWebServer() {
  const server = http.createServer(async (req, res) => {
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
      sendJson(res, 403, { success: false, message: 'Direct asset access is not allowed.' });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/status') {
      const online = await isServerOnline();
      sendJson(res, 200, {
        success: true,
        online,
        screenName,
        serverPath,
        webUrl,
        status: online ? 'Online' : 'Offline',
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/logs') {
      const output = await getLatestLogs();
      sendJson(res, 200, { success: true, output });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/start') {
      const command = `cd ${serverPath} && ./start.sh`;
      const output = await runCommand(command);
      sendJson(res, 200, { success: true, output, screenName, command });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/stop') {
      const online = await isServerOnline();
      const output = online
        ? await runCommand(`screen -X -S ${screenName} quit`)
        : `No \`${screenName}\` screen session was found. The stop command was not run.`;

      sendJson(res, 200, { success: true, output, online });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/console') {
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
  });

  return new Promise((resolve) => {
    const httpServer = server.listen(port, host, () => {
      console.log(`Web server running at http://${host}:${port}`);
      resolve(httpServer);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWebServer();
}
