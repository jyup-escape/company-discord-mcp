import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EncryptedStore } from './storage.js';
export { randomToken, digest, now, type User } from './storage.js';

export class Store extends EncryptedStore {
  constructor(path: string, key: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const database = new DatabaseSync(path);
    database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    super(database, key);
  }
}
