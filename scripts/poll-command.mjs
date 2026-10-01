import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCommand } from './command-protocol.mjs';

export function executeShellCommand(command, { shellPath = '/bin/bash', timeout = 480_000, outputLimit = 131072 } = {}) {
  const env = { ...process.env };
  delete env.COMMAND_POLL_TOKEN;
  delete env.COMMAND_SERVER_URL;
  delete env.COMMAND_PUBLISH_TOKEN;
  // The command is intentionally interpreted by Bash, as one argument.
  return new Promise(resolveResult => {
    const child = spawn(shellPath, ['--noprofile', '--norc', '-o', 'pipefail', '-c', command], {
      shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, env,
    });
    const output = { stdout: [], stderr: [] };
    const lengths = { stdout: 0, stderr: 0 };
    let truncated = false;
    let timedOut = false;
    let executionError;
    for (const name of ['stdout', 'stderr']) child[name].on('data', chunk => {
      // Continue draining after the limit so verbose commands can finish normally.
      const remaining = outputLimit - lengths[name];
      if (chunk.length > remaining) truncated = true;
      if (remaining > 0) { const kept = chunk.subarray(0, remaining); output[name].push(kept); lengths[name] += kept.length; }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      else child.kill('SIGKILL');
    }, timeout);
    child.on('error', error => { executionError = error; });
    child.on('close', code => {
      clearTimeout(timer);
      // Avoid a partial UTF-8 character at the byte limit expanding beyond the limit.
      const decode = chunks => Buffer.from(Buffer.concat(chunks).toString('utf8')).subarray(0, outputLimit).toString('utf8').replace(/\uFFFD$/, '');
      let stderr = decode(output.stderr);
      if (timedOut) stderr = `Command timed out.\n${stderr}`;
      if (executionError) stderr = `Command could not complete: ${executionError.code ?? 'execution error'}\n${stderr}`;
      resolveResult({ exitCode: timedOut ? 124 : (code ?? 1), stdout: decode(output.stdout),
        stderr: Buffer.from(stderr).subarray(0, outputLimit).toString('utf8').replace(/\uFFFD$/, ''), truncated });
    });
  });
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
  let execution;
  try { execution = await execute(command.command); }
  catch { execution = { exitCode: 1, stderr: 'Command execution failed.\n' }; }
  if (typeof execution === 'number') execution = { exitCode: execution };
  let exitCode = execution?.exitCode;
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) exitCode = 1;
  const result = await request('/command/result', { ...command, exitCode,
    stdout: execution?.stdout ?? '', stderr: execution?.stderr ?? '', truncated: execution?.truncated ?? false });
  if (!result.ok) throw new Error(`Result recording failed: HTTP ${result.status}; command will not be retried`);
  return { status: exitCode === 0 ? 'succeeded' : 'failed', timestamp: command.timestamp, exitCode };
}

export async function pollCommands(options, { interval = 10_000, duration = 300_000, onPoll = () => {}, onError = () => {} } = {}) {
  if (!Number.isFinite(interval) || interval <= 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Polling interval and duration must be positive');
  }
  const deadline = performance.now() + duration;
  let failed = false;
  let polls = 0;
  while (performance.now() < deadline) {
    const started = performance.now();
    const polledAt = new Date().toISOString();
    try {
      const result = await pollCommand(options);
      if (result.status === 'failed') failed = true;
      onPoll({ ...result, polledAt });
    } catch (error) { failed = true; onError(error); }
    polls++;
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    const wait = Math.min(remaining, Math.max(0, interval - (performance.now() - started)));
    if (wait > 0) await new Promise(resolveWait => setTimeout(resolveWait, wait));
  }
  return { polls, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await pollCommands({
    baseUrl: process.env.COMMAND_SERVER_URL, token: process.env.COMMAND_POLL_TOKEN,
    execute: executeShellCommand,
  }, {
    interval: Number(process.env.COMMAND_POLL_INTERVAL_MS ?? 10_000),
    duration: Number(process.env.COMMAND_POLL_DURATION_MS ?? 300_000),
    onPoll: result => console.log(JSON.stringify(result)),
    onError: error => console.error(`Polling failed: ${error.message}`),
  });
  if (result.failed) process.exitCode = 1;
}
