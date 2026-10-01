import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Standalone Node scripts are shared by the server and Actions runner.
// @ts-ignore JavaScript entrypoint
import { createCommandServer } from '../scripts/command-server.mjs';
// @ts-ignore JavaScript entrypoint
import { pollCommand, executeShellCommand } from '../scripts/poll-command.mjs';

const pollToken = 'p'.repeat(32);
const publishToken = 's'.repeat(32);
async function serve(database = ':memory:') {
  const instance = createCommandServer({ database, pollToken, publishToken });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    request: (path: string, body?: unknown, token = publishToken) => fetch(`${baseUrl}${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    stop: async () => {
      await new Promise<void>((resolve, reject) => server.close((err: Error) => err ? reject(err) : resolve()));
      instance.close();
    },
  };
}

test('parallel polls execute once, timestamp reuse cannot replace command, failures are not retried', async () => {
  const service = await serve();
  try {
    let calls = 0;
    const options = { baseUrl: service.baseUrl, token: pollToken, allowHttp: true, execute: async () => { calls++; return 7; } };
    assert.equal((await pollCommand(options)).status, 'idle');
    assert.equal((await service.request('/command', { command: 'npm test', timestamp: 1 })).status, 201);
    const results = await Promise.all([pollCommand(options), pollCommand(options), pollCommand(options)]);
    assert.equal(calls, 1);
    assert.equal(results.filter(result => result.status === 'failed').length, 1);
    assert.equal((await service.request('/command', { command: 'npm test', timestamp: 1 })).status, 200);
    assert.equal((await service.request('/command', { command: 'npm run build', timestamp: 1 })).status, 409);
    assert.equal((await pollCommand(options)).status, 'idle');
    const status = await (await service.request('/command/1')).json();
    assert.equal(status.status, 'failed');
    assert.equal(status.exit_code, 7);
  } finally { await service.stop(); }
});

test('authentication and shell command input validation', async () => {
  const service = await serve();
  try {
    assert.equal((await service.request('/command', undefined, 'wrong')).status, 401);
    assert.equal((await service.request('/command', { command: 'npm test', timestamp: 2 }, pollToken)).status, 401);
    for (const body of [
      { command: '', timestamp: 2 },
      { command: ' \n ', timestamp: 2 },
      { command: 42, timestamp: 2 },
      { command: 'echo\0bad', timestamp: 2 },
      { command: 'npm test', timestamp: '2' },
      { command: 'npm test', timestamp: -1 },
    ]) assert.equal((await service.request('/command', body)).status, 400);
    await assert.rejects(pollCommand({ baseUrl: service.baseUrl, token: pollToken, execute: () => 0 }), /HTTPS/);
    assert.equal((await service.request('/command/claim', { command: 'npm test', timestamp: 999 }, pollToken)).status, 409);
  } finally { await service.stop(); }
});

const bashPath = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
test('arbitrary Bash command runs through polling with pipes, substitution and multiline syntax', {
  skip: !existsSync(bashPath),
}, async () => {
  const service = await serve();
  try {
    const command = 'value=$(printf hello | tr a-z A-Z)\n[ "$value" = HELLO ] && printf "shell test passed\\n"';
    assert.equal((await service.request('/command', { command, timestamp: 42 })).status, 201);
    const result = await pollCommand({ baseUrl: service.baseUrl, token: pollToken, allowHttp: true,
      execute: (text: string) => executeShellCommand(text, { shellPath: bashPath }),
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(executeShellCommand('exit 23', { shellPath: bashPath }), 23);
    assert.notEqual(executeShellCommand('false | true', { shellPath: bashPath }), 0);
  } finally { await service.stop(); }
});

test('claimed timestamps survive restart even if worker dies before recording a result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'command-poll-'));
  const database = join(dir, 'commands.db');
  let service = await serve(database);
  try {
    const body = { command: 'npm run check', timestamp: 3 };
    await service.request('/command', body);
    assert.equal((await service.request('/command/claim', body, pollToken)).status, 200);
    await service.stop();
    service = await serve(database);
    assert.equal((await service.request('/command/claim', body, pollToken)).status, 409);
    const result = await pollCommand({ baseUrl: service.baseUrl, token: pollToken, allowHttp: true, execute: () => assert.fail('Must not execute again') });
    assert.equal(result.status, 'idle');
    assert.equal((await (await service.request('/command/3')).json()).status, 'claimed');
  } finally { await service.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('successful commands are recorded and next queued timestamp is returned', async () => {
  const service = await serve();
  try {
    await service.request('/command', { command: 'npm run build', timestamp: 10 });
    await service.request('/command', { command: 'npm test', timestamp: 11 });
    const result = await pollCommand({ baseUrl: service.baseUrl, token: pollToken, allowHttp: true, execute: () => 0 });
    assert.equal(result.status, 'succeeded');
    assert.equal((await (await service.request('/command/10')).json()).status, 'succeeded');
    assert.deepEqual(await (await service.request('/command', undefined, pollToken)).json(), { command: 'npm test', timestamp: 11 });
  } finally { await service.stop(); }
});
