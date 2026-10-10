import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { serveHttpRequest } from '../workers/http.js';

test('HTTP dispatch survives recreated handlers and concurrent requests', async () => {
  const ports = new Set<number>();
  const invoke = (id: number) => serveHttpRequest((_req, res) => {
    setTimeout(() => res.end(String(id)), id % 3);
  }, new Request('https://example.test/'), async port => {
    assert.ok(!ports.has(port)); ports.add(port);
    return fetch(`http://127.0.0.1:${port}`);
  }).then(response => response.text());
  const results = await Promise.all(Array.from({ length: 20 }, (_, id) => invoke(id)));
  assert.deepEqual(results, Array.from({ length: 20 }, (_, id) => String(id)));
  assert.equal(await invoke(30), '30');
});

test('failed HTTP dispatch releases its routing registration', async () => {
  let port = 0;
  await assert.rejects(serveHttpRequest((_req, res) => res.end(), new Request('https://example.test/'), async value => {
    port = value; throw new Error('dispatch failure');
  }), /dispatch failure/);
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, resolve); });
  await new Promise<void>(resolve => server.close(() => resolve()));
});
