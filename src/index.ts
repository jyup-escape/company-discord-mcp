import { readConfig } from './config.js';
import { Store } from './store.js';
import { createApp } from './app.js';
import { connectBot } from './gateway.js';

const config = readConfig();
const store = new Store(config.DATABASE_PATH, config.DATABASE_KEY);
store.prune();
const timer = setInterval(() => store.prune(), 3600000).unref();
const { app } = createApp(config, store);
const disconnectBot = connectBot(config, value => { app.locals.botStatus = value; });
const server = app.listen(config.PORT, config.HOST, () => console.log(`Company Discord MCP: ${config.resource}`));
server.requestTimeout = 60000;
server.headersTimeout = 15000;
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  void disconnectBot().catch(() => {});
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
