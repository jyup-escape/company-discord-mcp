import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { Options } from 'express-rate-limit';
import { EncryptedStore, now } from '../src/storage.js';
import { DurableDatabase } from '../workers/database.js';
import { PersistentRateLimit } from '../workers/rate-limit.js';
import { KEY } from './helpers.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  const adapter = new DurableDatabase({
    sql: { exec(sql, ...bindings) {
      if (!bindings.length && sql.includes(';')) { db.exec(sql); return { toArray: () => [] }; }
      const rows = db.prepare(sql).all(...bindings);
      return { toArray: () => rows };
    } },
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN');
      try { const value = fn(); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  });
  return { db, adapter, store: new EncryptedStore(adapter, KEY) };
}

test('Durable adapter keeps encrypted records, one-time consumption and rollback', () => {
  const { db, adapter, store } = fixture();
  try {
    store.set('codes', 'one', { secret: 'confidential' }, now() + 60);
    const reloaded = new EncryptedStore(adapter, KEY);
    assert.deepEqual(reloaded.take('codes', 'one'), { secret: 'confidential' });
    assert.equal(store.take('codes', 'one'), undefined);
    assert.throws(() => store.transaction(() => { store.set('codes', 'bad', 1); throw new Error('rollback'); }));
    assert.equal(store.get('codes', 'bad'), undefined);
    store.set('codes', 'encrypted', 'confidential');
    assert.ok(!String(db.prepare("SELECT value FROM records WHERE id='encrypted'").get()!.value).includes('confidential'));
    assert.throws(() => new EncryptedStore(adapter, Buffer.alloc(32, 1).toString('base64')));
  } finally { db.close(); }
});

test('Persistent rate counters survive app recreation and separate limiter prefixes', () => {
  const { db, adapter, store } = fixture();
  try {
    const first = new PersistentRateLimit(store, 'register');
    first.init({ windowMs: 60000 } as Options);
    assert.equal(first.increment('client').totalHits, 1);
    const second = new PersistentRateLimit(new EncryptedStore(adapter, KEY), 'register');
    second.init({ windowMs: 60000 } as Options);
    assert.equal(second.increment('client').totalHits, 2);
    assert.equal(new PersistentRateLimit(store, 'mcp').increment('client').totalHits, 1);
    second.decrement('client');
    assert.equal(first.increment('client').totalHits, 2);
    second.resetKey('client');
    assert.equal(first.increment('client').totalHits, 1);
    store.set('rate-limit', 'register:expired', { totalHits: 20, resetAt: Date.now() - 1 }, now() - 1);
    store.prune();
    assert.equal(store.get('rate-limit', 'register:expired'), undefined);
  } finally { db.close(); }
});
