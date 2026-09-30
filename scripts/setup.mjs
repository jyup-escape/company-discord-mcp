import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(target)) {
  console.log('.env は既に存在するため変更しません。必要な設定を直接編集してください。');
} else {
  const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  writeFileSync(target, template.replace('DATABASE_KEY=GENERATE_WITH_SETUP', `DATABASE_KEY=${randomBytes(32).toString('base64')}`), { flag: 'wx', mode: 0o600 });
  console.log('.env を作成しました。Discordの4項目を入力してください。暗号鍵は生成済みです。');
}
