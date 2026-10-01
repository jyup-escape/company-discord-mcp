import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCommand } from './command-protocol.mjs';

export function executeShellCommand(command, { shellPath = '/bin/bash', timeout = 480_000 } = {}) {
  const env = { ...process.env };
  delete env.COMMAND_POLL_TOKEN;
  delete env.COMMAND_SERVER_URL;
  delete env.COMMAND_PUBLISH_TOKEN;
  // The command is intentionally interpreted by Bash, as one argument.
  const child = spawnSync(shellPath, ['--noprofile', '--norc', '-o', 'pipefail', '-c', command], {
    shell: false, stdio: 'inherit', timeout, env,
  });
  if (child.error) console.error(`Command could not complete: ${child.error.code ?? 'execution error'}`);
  return child.status ?? 1;
}

export async function pollCommand({ baseUrl, token, execute, allowHttp = false }) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('COMMAND_SERVER_URL must use HTTPS (local HTTP is allowed only for testing)');
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('COMMAND_SERVER_URL must be an origin without credentials, path, query or fragment');
  }
  if (!token) throw new Error('COMMAND_POLL_TOKEN is required');
  const request = (path, body) => fetch(new URL(path, url), {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const pending = await request('/command');
  if (pending.status === 204) return { status: 'idle' };
  if (!pending.ok) throw new Error(`Polling failed: HTTP ${pending.status}`);
  const command = validateCommand(await pending.json());
  const claimed = await request('/command/claim', command);
  if (claimed.status === 409) return { status: 'duplicate', timestamp: command.timestamp };
  if (!claimed.ok) throw new Error(`Claim failed: HTTP ${claimed.status}`);
  let exitCode;
  try { exitCode = await execute(command.command); }
  catch { exitCode = 1; }
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) exitCode = 1;
  const result = await request('/command/result', { ...command, exitCode });
  if (!result.ok) throw new Error(`Result recording failed: HTTP ${result.status}; command will not be retried`);
  return { status: exitCode === 0 ? 'succeeded' : 'failed', timestamp: command.timestamp, exitCode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await pollCommand({
    baseUrl: process.env.COMMAND_SERVER_URL, token: process.env.COMMAND_POLL_TOKEN,
    execute: executeShellCommand,
  });
  console.log(JSON.stringify(result));
  if (result.status === 'failed') process.exitCode = 1;
}
