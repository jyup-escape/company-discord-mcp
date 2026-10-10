import type { Binding, StorageDatabase } from '../src/storage.js';

export interface DurableStorage {
  sql: { exec(sql: string, ...bindings: Binding[]): { toArray(): Record<string, unknown>[] } };
  transactionSync<T>(callback: () => T): T;
}

export class DurableDatabase implements StorageDatabase {
  constructor(private storage: DurableStorage) {}
  exec(sql: string) { return this.storage.sql.exec(sql).toArray(); }
  prepare(sql: string) {
    const rows = (...bindings: Binding[]) => this.storage.sql.exec(sql, ...bindings).toArray();
    return {
      run: (...bindings: Binding[]) => { rows(...bindings); },
      get: (...bindings: Binding[]) => rows(...bindings)[0],
      all: rows,
    };
  }
  transaction<T>(callback: () => T): T { return this.storage.transactionSync(callback); }
  close() {}
}
