import { spawn } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { root, updateEnv } from './env-file.mjs';

// Run independently of the administrator's terminal through Windows Task Scheduler.
process.chdir(root);
mkdirSync('data', { recursive: true });
const statePath = join(root, 'data', 'share-runtime.json');
const state = { supervisorPid: process.pid, startedAt: new Date().toISOString(), status: 'starting' };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
save();
let server;
let restarting = false;
let controlTimer;
const log = openSync(join(root, 'data', 'tunnel.err.log'), 'w');
const tunnel = spawn(join(root, '.tools', 'cloudflared.exe'), ['tunnel', '--url', 'http://127.0.0.1:3000', '--no-autoupdate', '--protocol', 'http2'], { windowsHide: true, stdio: ['ignore', 'ignore', log] });
state.tunnelPid = tunnel.pid;
save();
const stop = () => { clearInterval(controlTimer); server?.kill(); tunnel.kill(); };
process.on('SIGINT', () => { stop(); process.exit(); });
process.on('SIGTERM', () => { stop(); process.exit(); });
tunnel.on('error', () => { state.status = 'tunnel_failed'; save(); process.exitCode = 1; });
tunnel.on('exit', () => { server?.kill(); state.status = 'stopped'; save(); });
for (let attempts = 0; attempts < 60; attempts++) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  const text = existsSync('data/tunnel.err.log') ? readFileSync('data/tunnel.err.log', 'utf8') : '';
  const publicUrl = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (!publicUrl) continue;
  updateEnv({ PUBLIC_URL: publicUrl, TRUST_PROXY: '127.0.0.1', HOST: '127.0.0.1', PORT: '3000' });
  const out = openSync(join(root, 'data', 'server.out.log'), 'a');
  const err = openSync(join(root, 'data', 'server.err.log'), 'a');
  const startServer = () => {
    server = spawn(process.execPath, ['--env-file=.env', 'dist/index.js'], { windowsHide: true, stdio: ['ignore', out, err] });
    state.serverPid = server.pid;
    save();
    server.on('error', () => { state.status = 'server_failed'; save(); tunnel.kill(); });
    server.on('exit', () => {
      if (restarting) { restarting = false; startServer(); }
      else { clearInterval(controlTimer); state.status = 'stopped'; save(); tunnel.kill(); }
    });
  };
  state.publicUrl = publicUrl;
  state.callbackUrl = `${publicUrl}/oauth/discord/callback`;
  state.status = 'callback_registration_required';
  startServer();
  let lastControl = existsSync('data/reload-server.txt') ? readFileSync('data/reload-server.txt', 'utf8') : '';
  controlTimer = setInterval(() => {
    const control = existsSync('data/reload-server.txt') ? readFileSync('data/reload-server.txt', 'utf8') : '';
    if (control !== lastControl && !restarting) { lastControl = control; restarting = true; server.kill(); }
  }, 1000);
  break;
}
if (!server) { state.status = 'tunnel_failed'; save(); tunnel.kill(); process.exitCode = 1; }
