import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const now = () => Math.floor(Date.now() / 1000);
export type User = { id: string; name: string; disabled: boolean };
export class Store {
  readonly db: DatabaseSync;
  private readonly key: Buffer;
  constructor(path: string, key: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.key = Buffer.from(key, 'base64');
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, value TEXT NOT NULL, expires INTEGER, PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS expiry ON records(expires);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, user_id TEXT, action TEXT NOT NULL, channel_id TEXT, result TEXT NOT NULL, message_id TEXT);
      CREATE INDEX IF NOT EXISTS audit_time ON audit(at);`);
    try {
      const sentinel = this.get<{ ok: boolean }>('system', 'key-check');
      if (!sentinel) this.set('system', 'key-check', { ok: true });
    } catch (error) { this.db.close(); throw error; }
  }
  private seal(value: unknown, aad: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  private open<T>(value: string, aad: string): T {
    const b = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    cipher.setAAD(Buffer.from(aad));
    cipher.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString()) as T;
  }
  set(kind: string, id: string, value: unknown, expires?: number) {
    this.db.prepare('INSERT INTO records VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value, expires=excluded.expires')
      .run(kind, id, this.seal(value, `${kind}:${id}`), expires ?? null);
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM records WHERE kind=? AND id=? AND (expires IS NULL OR expires>?)').get(kind, id, now());
    return row ? this.open<T>(row.value as string, `${kind}:${id}`) : undefined;
  }
  take<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('DELETE FROM records WHERE kind=? AND id=? RETURNING value,expires').get(kind, id);
    return row && (row.expires === null || Number(row.expires) > now()) ? this.open<T>(row.value as string, `${kind}:${id}`) : undefined;
  }
  list<T>(kind: string): Array<{ id: string; value: T }> {
    return this.db.prepare('SELECT id,value FROM records WHERE kind=? AND (expires IS NULL OR expires>?)').all(kind, now())
      .map(r => ({ id: String(r.id), value: this.open<T>(String(r.value), `${kind}:${r.id}`) }));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  audit(user: string, action: string, result: string, channel?: string, message?: string) {
    this.db.prepare('INSERT INTO audit(at,user_id,action,channel_id,result,message_id) VALUES (?,?,?,?,?,?)').run(now(), user, action, channel ?? null, result, message ?? null);
  }
  prune() {
    this.db.prepare('DELETE FROM records WHERE expires IS NOT NULL AND expires<=?').run(now());
    this.db.prepare('DELETE FROM audit WHERE at<?').run(now() - 90 * 86400);
  }
  close() { this.db.close(); }
}
