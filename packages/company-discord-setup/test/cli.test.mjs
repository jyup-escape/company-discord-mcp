import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, setupUnix } from '../bin/cli.mjs';

const url = 'https://discord.company.test/mcp';
function fixture({ current = url, connected = [true], addCode = 0, loginCode = 0, healthy = true } = {}) {
  const calls = [];
  let checks = 0;
  return {
    calls,
    deps: {
      cli: '/fake/codex',
      request: async () => ({ ok: healthy, json: async () => ({ status: healthy ? 'ok' : 'error' }) }),
      check: async () => connected[checks++] ?? false,
      execute: async (_cli, args) => {
        calls.push(args);
        if (args[1] === 'get') return { code: current ? 0 : 1, stdout: JSON.stringify({ transport: { url: current } }) };
        return { code: args[1] === 'add' ? addCode : loginCode };
      },
    },
  };
}

test('invalid URLs and options fail before executing a command', () => {
  for (const bad of ['http://localhost/mcp', 'https://user:secret@host/mcp', 'https://host/mcp?token=secret', 'https://host/mcp#x', 'https://host/other']) assert.throws(() => parseOptions(['--url', bad]));
  assert.throws(() => parseOptions([]));
  assert.throws(() => parseOptions(['--url']));
  assert.throws(() => parseOptions(['--url', url, '--unknown']));
  assert.equal(parseOptions(['--help']).help, true);
});

test('already connected employee does not re-register or log in', async () => {
  const f = fixture();
  await setupUnix(parseOptions(['--url', url]), f.deps);
  assert.deepEqual(f.calls, [['mcp', 'get', 'company-discord', '--json']]);
});

test('new registration completes authentication when add did not log in', async () => {
  const f = fixture({ current: null, connected: [false, true] });
  await setupUnix(parseOptions(['--url', url]), f.deps);
  assert.deepEqual(f.calls.slice(1), [['mcp', 'add', 'company-discord', '--url', url], ['mcp', 'login', 'company-discord']]);
});

test('changed endpoint is registered and successful add avoids a second login', async () => {
  const f = fixture({ current: 'https://old.company.test/mcp' });
  await setupUnix(parseOptions(['--url', url]), f.deps);
  assert.deepEqual(f.calls.slice(1), [['mcp', 'add', 'company-discord', '--url', url]]);
});

test('check mode never modifies missing, changed or expired registrations', async () => {
  for (const state of [{ current: null }, { current: 'https://old.company.test/mcp' }, { connected: [false] }]) {
    const f = fixture(state);
    await assert.rejects(setupUnix(parseOptions(['--url', url, '--check']), f.deps), /incomplete/);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][1], 'get');
  }
});

test('unavailable server does not change registration', async () => {
  const f = fixture({ healthy: false });
  await assert.rejects(setupUnix(parseOptions(['--url', url]), f.deps), /unavailable/);
  assert.equal(f.calls.length, 0);
});

test('failed registration stops before login', async () => {
  const f = fixture({ current: null, addCode: 1 });
  await assert.rejects(setupUnix(parseOptions(['--url', url]), f.deps), /registration failed/);
  assert.ok(!f.calls.some(args => args[1] === 'login'));
});

test('missing tools after OAuth is a failure', async () => {
  const f = fixture({ connected: [false, false] });
  await assert.rejects(setupUnix(parseOptions(['--url', url]), f.deps), /after login/);
});
