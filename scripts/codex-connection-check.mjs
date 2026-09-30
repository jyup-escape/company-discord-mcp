import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const cli = process.env.CODEX_CLI_PATH || 'codex';
const child = spawn(cli, ['app-server', ...(process.argv.includes('--standalone') ? ['--stdio'] : ['proxy'])], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
let id = 0;
const pending = new Map();
const send = data => child.stdin.write(JSON.stringify(data) + '\n');
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let data; try { data = JSON.parse(line); } catch { return; }
  const request = pending.get(data.id);
  if (request) { pending.delete(data.id); clearTimeout(request.timer); data.error ? request.reject(new Error(data.error.message)) : request.resolve(data.result); }
});
child.stderr.on('data', () => {});
child.on('error', () => { for (const p of pending.values()) p.reject(new Error('Codexを起動できません。')); });
child.on('exit', () => { for (const p of pending.values()) p.reject(new Error('Codexアプリへの接続が終了しました。')); });
const call = (method, params) => new Promise((resolve, reject) => {
  const n = ++id;
  const timer = setTimeout(() => { pending.delete(n); reject(new Error('Codex接続確認がタイムアウトしました。')); }, 30000);
  pending.set(n, { resolve, reject, timer });
  send({ id: n, method, params });
});
try {
  await call('initialize', { clientInfo: { name: 'company_discord_setup_check', version: '1' }, capabilities: { experimentalApi: true } });
  send({ method: 'initialized', params: {} });
  if (process.argv.includes('--reload')) await call('config/mcpServer/reload', {});
  const response = await call('mcpServerStatus/list', { serverName: 'company-discord', detail: 'toolsAndAuthOnly' });
  const server = response.data.find(s => s.name === 'company-discord');
  console.log(JSON.stringify(server ? { name: server.name, authStatus: server.authStatus, runtimeStatus: server.runtimeStatus, toolsError: server.toolsError, tools: Object.keys(server.tools ?? {}) } : { error: 'company-discordが読み込まれていません。' }, null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { for (const p of pending.values()) clearTimeout(p.timer); child.stdin.end(); child.kill(); lines.close(); }
