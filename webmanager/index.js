import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { webConfig } from './config.js';
import { handleRequest } from './router.js';

export function startWebServer() {
  const server = http.createServer(async (req, res) => {
    await handleRequest(req, res);
  });

  return new Promise((resolve) => {
    const httpServer = server.listen(webConfig.port || 3000, webConfig.host || '0.0.0.0', () => {
      console.log(`Web server running at http://${webConfig.host || '0.0.0.0'}:${webConfig.port || 3000}`);
      resolve(httpServer);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWebServer();
}
