import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateCommand } from './command-protocol.mjs';

export function createCommandServer({ database, pollToken, publishToken }) {
  if (!pollToken || !publishToken || pollToken.length < 32 || publishToken.length < 32 || pollToken === publishToken) {
    throw new Error('Set distinct COMMAND_POLL_TOKEN and COMMAND_PUBLISH_TOKEN (at least 32 characters each)');
  }
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS commands (
      timestamp INTEGER PRIMARY KEY, command TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', claimed_at INTEGER, finished_at INTEGER,
      exit_code INTEGER
    );`);
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(rateLimit({ windowMs: 60_000, limit: 60 }));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const auth = token => (req, res, next) => {
    const expected = Buffer.from(`Bearer ${token}`);
    const actual = Buffer.from(req.headers.authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
  const json = express.json({ limit: '4kb' });
  app.get('/command', auth(pollToken), (req, res) => {
    const row = db.prepare("SELECT command,timestamp FROM commands WHERE status='pending' ORDER BY timestamp LIMIT 1").get();
    if (!row) return res.status(204).end();
    res.json(row);
  });
  app.post('/command', auth(publishToken), json, (req, res) => {
    const { command, timestamp } = validateCommand(req.body);
    const existing = db.prepare('SELECT command,status FROM commands WHERE timestamp=?').get(timestamp);
    if (existing) {
      if (existing.command !== command) return res.status(409).json({ error: 'timestamp already belongs to another command' });
      return res.json({ command, timestamp, status: existing.status, duplicate: true });
    }
    db.prepare('INSERT INTO commands(timestamp,command) VALUES (?,?)').run(timestamp, command);
    res.status(201).json({ command, timestamp, status: 'pending' });
  });
  app.post('/command/claim', auth(pollToken), json, (req, res) => {
    const { command, timestamp } = validateCommand(req.body);
    // Persist before execution. Exactly one worker can change pending -> claimed.
    const result = db.prepare("UPDATE commands SET status='claimed',claimed_at=? WHERE timestamp=? AND command=? AND status='pending'")
      .run(Date.now(), timestamp, command);
    if (result.changes !== 1) return res.status(409).json({ error: 'Already claimed or unknown command' });
    res.json({ command, timestamp, status: 'claimed' });
  });
  app.post('/command/result', auth(pollToken), json, (req, res) => {
    const { command, timestamp } = validateCommand(req.body);
    const { exitCode } = req.body;
    if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new Error('Invalid exitCode');
    const result = db.prepare("UPDATE commands SET status=?,finished_at=?,exit_code=? WHERE timestamp=? AND command=? AND status='claimed'")
      .run(exitCode === 0 ? 'succeeded' : 'failed', Date.now(), exitCode, timestamp, command);
    if (result.changes !== 1) return res.status(409).json({ error: 'Command is not claimed' });
    res.json({ timestamp, exitCode });
  });
  app.get('/command/:timestamp', auth(publishToken), (req, res) => {
    const timestamp = Number(req.params.timestamp);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return res.status(400).json({ error: 'Invalid timestamp' });
    const row = db.prepare('SELECT * FROM commands WHERE timestamp=?').get(timestamp);
    if (!row) return res.status(404).json({ error: 'Unknown timestamp' });
    res.json(row);
  });
  app.use((err, req, res, next) => {
    res.status(400).json({ error: err.type === 'entity.too.large' ? 'Request too large' : 'Invalid command or request' });
  });
  return { app, close: () => db.close() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { app, close } = createCommandServer({
    database: process.env.COMMAND_DATABASE ?? 'data/commands.db',
    pollToken: process.env.COMMAND_POLL_TOKEN,
    publishToken: process.env.COMMAND_PUBLISH_TOKEN,
  });
  const server = app.listen(Number(process.env.COMMAND_PORT ?? 8787), process.env.COMMAND_HOST ?? '127.0.0.1', () => {
    console.log('Command server listening');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { close(); process.exit(0); }));
}
