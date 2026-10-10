import type { Options, Store } from 'express-rate-limit';
import { digest, type EncryptedStore } from '../src/storage.js';

type Counter = { totalHits: number; resetAt: number };
export class PersistentRateLimit implements Store {
  readonly localKeys = false;
  private windowMs = 60000;
  constructor(private store: EncryptedStore, readonly prefix: string) {}
  init(options: Options) { this.windowMs = options.windowMs; }
  private key(key: string) { return `${this.prefix}:${digest(key)}`; }
  increment(key: string) {
    return this.store.transaction(() => {
      const id = this.key(key), timestamp = Date.now();
      let value = this.store.get<Counter>('rate-limit', id);
      if (!value || value.resetAt <= timestamp) value = { totalHits: 0, resetAt: timestamp + this.windowMs };
      value.totalHits++;
      this.store.set('rate-limit', id, value, Math.ceil(value.resetAt / 1000));
      return { totalHits: value.totalHits, resetTime: new Date(value.resetAt) };
    });
  }
  decrement(key: string) {
    this.store.transaction(() => {
      const id = this.key(key), value = this.store.get<Counter>('rate-limit', id);
      if (value) this.store.set('rate-limit', id, { ...value, totalHits: Math.max(0, value.totalHits - 1) }, Math.ceil(value.resetAt / 1000));
    });
  }
  resetKey(key: string) { this.store.take('rate-limit', this.key(key)); }
}
