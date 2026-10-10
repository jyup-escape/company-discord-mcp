import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../dist/config.js';
import { loadEnv } from './env-file.mjs';

const settings = loadEnv();
const allowIncomplete = process.argv.includes('--allow-incomplete');
const fields = ['DATABASE_KEY', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'EMPLOYEE_ROLE_IDS', 'ALLOWED_CHANNEL_IDS', 'ENABLE_SEND', 'OAUTH_REDIRECT_URIS'];
const secrets = Object.fromEntries(fields.filter(key => typeof settings[key] === 'string' && !settings[key].startsWith('replace_')).map(key => [key, settings[key]]));
if (!allowIncomplete) readConfig(settings);
const deployment = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (settings.PUBLIC_URL !== deployment.vars.PUBLIC_URL) throw new Error('公開URLがwrangler設定と一致しません。設定を確認してください。');
if (!/^[A-Za-z0-9+/]{43}=$/.test(secrets.DATABASE_KEY ?? '')) throw new Error('保存用暗号鍵が未設定です。npm run setupを実行してください。');
const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
async function run(args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, windowsHide: true, stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'] });
    child.on('error', reject);
    if (input) child.stdin.end(input);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Cloudflare処理に失敗しました (${code})`)));
  });
}
await run(['deploy']);
await run(['secret', 'bulk'], JSON.stringify(secrets));
console.log(allowIncomplete ? '公開先を作成しました。Discord設定が揃うまで利用要求を503で拒否します。' : '公開先と秘密情報を更新しました。Discordログインと利用権限を確認してください。');
