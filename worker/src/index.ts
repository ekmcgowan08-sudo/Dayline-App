import { config } from './config.js';
import { startHealthServer, type HealthState } from './health.js';
import { logger } from './logger.js';
import { startPollingLoop } from './poller.js';

const state: HealthState = { lastPollAt: null, lastJobId: null, lastError: null };

const healthServer = startHealthServer(config.healthPort, state);

let running = true;
process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  running = false;
});
process.on('SIGINT', () => {
  logger.info('SIGINT received');
  running = false;
});

startPollingLoop(state, () => running).finally(() => {
  healthServer.close();
  process.exit(0);
});
