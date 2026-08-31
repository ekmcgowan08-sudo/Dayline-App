import http from 'node:http';
import { logger } from './logger.js';

export type HealthState = { lastPollAt: string | null; lastJobId: string | null; lastError: string | null };

export function startHealthServer(port: number, state: HealthState) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ...state }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => logger.info('health server listening', { port }));
  return server;
}
