import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readConfig } from '../src/config.ts';
import { loadEnv, updateEnv, isConfigured } from './env-file.mjs';

if (!process.stdin.isTTY) {
  console.error('対話端末で npm run configure を実行してください。トークンはコマンド引数に指定しないでください。');
  process.exit(1);
}
const current = loadEnv();
let muted = false;
const output = new Writable({ write(chunk, _encoding, next) { if (!muted) process.stdout.write(chunk); next(); } });
const rl = createInterface({ input: process.stdin, output, terminal: true });
rl.on('SIGINT', () => { muted = false; process.stdout.write('\nキャンセルしました。設定は保存していません。\n'); process.exit(130); });
async function ask(key, label, secret = false) {
  const old = isConfigured(current[key]) ? current[key] : '';
  const hint = old ? secret ? '入力済み・Enterで保持' : `現在: ${old}` : '未設定';
  process.stdout.write(`${label} (${hint}): `);
  muted = secret;
  const input = (await rl.question('')).trim();
  muted = false;
  if (secret) process.stdout.write('\n');
  return input === '-' ? '' : input || old;
}
try {
  console.log('会社Discord MCP 管理者セットアップ');
  console.log('秘密情報はこの端末に表示せず、ローカルの.envだけに保存します。Enterで既存値を保持、-で空欄。');
  const updates = {};
  const prompts = [
    ['PUBLIC_URL', '公開URL / ローカルでは http://localhost:3000'],
    ['DISCORD_CLIENT_ID', 'Application ID'],
    ['DISCORD_CLIENT_SECRET', 'OAuth2 Client Secret', true],
    ['DISCORD_BOT_TOKEN', 'Bot Token', true],
    ['DISCORD_GUILD_ID', '会社DiscordサーバーID'],
    ['EMPLOYEE_ROLE_IDS', '社員ロールID (カンマ区切り / 空欄=参加者全員)'],
    ['ALLOWED_CHANNEL_IDS', '許可するチャンネルID (空欄=本人の権限で判断)'],
  ];
  for (const [key, label, secret] of prompts) {
    if (process.argv.includes('--secrets-only') && !secret) continue;
    updates[key] = await ask(key, label, secret);
  }
  const complete = { ...current, ...updates };
  const missing = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID'].filter(k => !isConfigured(complete[k]));
  if (missing.length) throw new Error(`未入力: ${missing.join(', ')}`);
  let config;
  try { config = readConfig(complete); }
  catch { throw new Error('設定値が不正です。ID・URL・暗号鍵の形式を確認してください。'); }
  updates.PUBLIC_URL = config.publicUrl;
  if (config.publicUrl.startsWith('https:')) updates.MCP_DOMAIN = new URL(config.publicUrl).hostname;
  updateEnv(updates);
  console.log('保存しました。トークンの値は表示しません。');
  console.log(`Discord OAuth2 Redirects: ${config.publicUrl}/oauth/discord/callback`);
  console.log('次に npm run doctor を実行するとBotとサーバーへの接続を検証できます。');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { muted = false; rl.close(); }
