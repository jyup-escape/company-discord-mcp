import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
mkdirSync('data', { recursive: true });
const statePath = join(root, 'data', 'command-runtime.json');
const state = { startedAt: new Date().toISOString(), status: 'starting', workerPid: process.pid };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
save();
const serverLog = openSync(join(root, 'data', 'command-server.log'), 'a');
const tunnelLogPath = join(root, 'data', 'command-tunnel.log');
const tunnelLog = openSync(tunnelLogPath, 'w');
const server = spawn(process.execPath, ['--env-file=.env.command', 'scripts/command-server.mjs'], {
  windowsHide: true, stdio: ['ignore', serverLog, serverLog],
});
state.serverPid = server.pid;
const tunnel = spawn(join(root, '.tools', 'cloudflared.exe'), [
  'tunnel', '--url', 'http://127.0.0.1:8787', '--no-autoupdate', '--protocol', 'http2',
], { windowsHide: true, stdio: ['ignore', 'ignore', tunnelLog] });
state.tunnelPid = tunnel.pid;
save();
let stopping = false;
function stop(status) {
  if (stopping) return;
  stopping = true;
  state.status = status; save(); server.kill(); tunnel.kill();
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop('stopped'));
server.on('error', () => stop('server_failed'));
tunnel.on('error', () => stop('tunnel_failed'));
server.on('exit', () => stop('server_stopped'));
tunnel.on('exit', () => stop('tunnel_stopped'));
for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  const log = existsSync(tunnelLogPath) ? readFileSync(tunnelLogPath, 'utf8') : '';
  const publicUrl = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (publicUrl) { state.publicUrl = publicUrl; state.status = 'running'; save(); break; }
}
if (!state.publicUrl && !stopping) stop('tunnel_failed');
