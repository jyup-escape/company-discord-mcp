import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, existsSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, now } from '../src/store.js';
import { KEY } from './helpers.js';
test('encrypted storage survives restart; wrong key is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discord-mcp-test-')), path = join(dir, 'test.db');
  try {
    const first = new Store(path, KEY);
    first.set('clients', 'x', { secret: 'sensitive-client-secret' });
    assert.ok(!String(first.db.prepare("SELECT value FROM records WHERE id='x'").get()!.value).includes('sensitive'));
    first.close();
    const second = new Store(path, KEY);
    assert.deepEqual(second.get('clients', 'x'), { secret: 'sensitive-client-secret' }); second.close();
    assert.throws(() => new Store(path, Buffer.alloc(32, 11).toString('base64')));
  } finally {
    for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) unlinkSync(file);
    rmdirSync(dir);
  }
});
test('expired records and consumed records cannot be reused; transactions roll back', () => {
  const s = new Store(':memory:', KEY);
  try {
    s.set('code', 'expired', true, now() - 1); assert.equal(s.get('code', 'expired'), undefined);
    s.set('code', 'fresh', true, now() + 60); assert.equal(s.take('code', 'fresh'), true); assert.equal(s.take('code', 'fresh'), undefined);
    assert.throws(() => s.transaction(() => { s.set('code', 'rollback', true); throw new Error('fail'); }));
    assert.equal(s.get('code', 'rollback'), undefined);
  } finally { s.close(); }
});
