import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const envPath = fileURLToPath(new URL('../.env', import.meta.url));
export const isConfigured = value => !!value && !/^(replace_|GENERATE_)/.test(value);
export function loadEnv(path = envPath) { return parseEnv(readFileSync(path, 'utf8')); }
export function updateEnv(updates, path = envPath) {
  let source = readFileSync(path, 'utf8');
  for (const [key, raw] of Object.entries(updates)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Invalid setting name');
    const value = String(raw);
    // Discord credentials never require quotes, backslashes or control characters.
    if (/[\x00-\x1f\x7f"'`\\]/.test(value)) throw new Error(`${key}: unsupported characters`);
    const line = `${key}="${value}"`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    source = pattern.test(source) ? source.replace(pattern, () => line) : `${source.trimEnd()}\n${line}\n`;
  }
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temp, source, { mode: 0o600, flag: 'wx' });
  renameSync(temp, path);
}
