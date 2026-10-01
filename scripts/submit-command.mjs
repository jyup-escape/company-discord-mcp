import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCommand } from './command-protocol.mjs';

export async function submitAndWait({ baseUrl, token, command, timestamp = Date.now(), timeout = 1_200_000, pollInterval = 5000, onSubmitted }) {
  const body = validateCommand({ command, timestamp });
  const request = async (path, payload) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: payload ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error ?? 'Request failed'}`);
    return data;
  };
  await request('/command', body);
  onSubmitted?.(timestamp);
  const deadline = Date.now() + timeout;
  while (true) {
    const result = await request(`/command/${timestamp}`);
    if (result.status === 'succeeded' || result.status === 'failed') return result;
    if (Date.now() >= deadline) throw new Error(`Waiting timed out; command ${timestamp} remains ${result.status}. It may still run. Check with --status ${timestamp}; do not resubmit automatically.`);
    await new Promise(resolveWait => setTimeout(resolveWait, Math.min(pollInterval, deadline - Date.now())));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
const [command, statusTimestamp] = process.argv.slice(2);
const token = process.env.COMMAND_PUBLISH_TOKEN;
if (!token) throw new Error('Start with node --env-file=.env.command scripts/submit-command.mjs');
const baseUrl = `http://127.0.0.1:${process.env.COMMAND_PORT ?? 8787}`;
const isStatus = command === '--status';
if (isStatus && (!Number.isSafeInteger(Number(statusTimestamp)) || Number(statusTimestamp) <= 0)) throw new Error('Supply a positive timestamp');
if (!isStatus) {
  try {
    const result = await submitAndWait({ baseUrl, token, command });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.truncated) process.stderr.write('\n[Output truncated at 128 KiB per stream]\n');
    process.exitCode = result.exit_code;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
} else {
const response = await fetch(`${baseUrl}/command${isStatus ? `/${statusTimestamp}` : ''}`, {
  method: 'GET',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  signal: AbortSignal.timeout(15_000),
});
console.log(JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exitCode = 1;
}
}
