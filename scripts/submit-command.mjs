import { validateCommand } from './command-protocol.mjs';

const [command, statusTimestamp] = process.argv.slice(2);
const token = process.env.COMMAND_PUBLISH_TOKEN;
if (!token) throw new Error('Start with node --env-file=.env.command scripts/submit-command.mjs');
const baseUrl = `http://127.0.0.1:${process.env.COMMAND_PORT ?? 8787}`;
const isStatus = command === '--status';
if (isStatus && (!Number.isSafeInteger(Number(statusTimestamp)) || Number(statusTimestamp) <= 0)) throw new Error('Supply a positive timestamp');
const body = isStatus ? undefined : validateCommand({ command, timestamp: Date.now() });
const response = await fetch(`${baseUrl}/command${isStatus ? `/${statusTimestamp}` : ''}`, {
  method: isStatus ? 'GET' : 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
});
console.log(JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exitCode = 1;
