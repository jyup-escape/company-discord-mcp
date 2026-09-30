#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function parseOptions(args) {
  const options = { checkOnly: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--check') options.checkOnly = true;
    else if (arg === '--url' && args[i + 1] && !args[i + 1].startsWith('--')) options.url = args[++i];
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if (options.help) return options;
  if (!options.url) throw new Error('Specify the company MCP endpoint with --url https://YOUR-HOST/mcp');
  const url = new URL(options.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/mcp' || url.search || url.hash) {
    throw new Error('The endpoint must be an HTTPS URL ending in /mcp, without credentials, query or fragment.');
  }
  options.url = url.href;
  return options;
}

function run(cli, args, capture = false) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(cli, args, { windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '';
    if (capture) {
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.resume();
    }
    child.once('error', reject);
    child.once('close', code => resolveResult({ code, stdout }));
  });
}

export async function hasDiscordTools(cli, timeoutMs = 35000) {
  const child = spawn(cli, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  return new Promise(resolveResult => {
    let done = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill();
      resolveResult(result);
    }
    const send = data => child.stdin.write(JSON.stringify(data) + '\n');
    child.once('error', () => finish(false));
    child.once('exit', () => finish(false));
    child.stdin.on('error', () => finish(false));
    lines.on('line', line => {
      let response;
      try { response = JSON.parse(line); } catch { return; }
      if (response.id === 1) {
        if (response.error) return finish(false);
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'mcpServerStatus/list', params: { serverName: 'company-discord', detail: 'toolsAndAuthOnly' } });
      } else if (response.id === 2) {
        const server = response.result?.data?.find(item => item.name === 'company-discord');
        finish(Boolean(server?.tools?.discord_whoami));
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'company_discord_setup', version: '1' }, capabilities: { experimentalApi: true } } });
  });
}

export async function setupUnix(options, { cli = process.env.CODEX_CLI_PATH || 'codex', execute = run, check = hasDiscordTools, request = fetch } = {}) {
  const origin = new URL(options.url).origin;
  const response = await request(`${origin}/healthz`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok || (await response.json()).status !== 'ok') throw new Error('The company MCP server is unavailable. Ask the administrator to check it.');
  const current = await execute(cli, ['mcp', 'get', 'company-discord', '--json'], true);
  const exists = current.code === 0;
  const sameUrl = exists && JSON.parse(current.stdout).transport?.url === options.url;
  if (options.checkOnly) {
    if (!sameUrl || !await check(cli)) throw new Error('Registration or login is incomplete. Run setup without --check.');
    return;
  }
  if (!sameUrl) {
    console.log('Sign in with your own Discord account in the browser.');
    const added = await execute(cli, ['mcp', 'add', 'company-discord', '--url', options.url]);
    if (added.code !== 0) throw new Error('Codex registration failed.');
  }
  if (!await check(cli)) {
    console.log('Sign in with your own Discord account in the browser.');
    const login = await execute(cli, ['mcp', 'login', 'company-discord']);
    if (login.code !== 0 || !await check(cli)) throw new Error('Could not retrieve Discord tools after login.');
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    console.log('Usage: company-discord-setup --url https://YOUR-HOST/mcp [--check]\nRequires Node.js 24+ and Codex. Windows: also finds the CLI bundled with the Codex app.');
    return;
  }
  if (process.platform === 'win32') {
    const script = fileURLToPath(new URL('../codex-setup.ps1', import.meta.url));
    const result = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Endpoint', options.url, ...(options.checkOnly ? ['-CheckOnly'] : [])]);
    if (result.code !== 0) throw new Error('Company Discord setup failed. See the message above.');
  } else {
    await setupUnix(options);
    console.log('Connected. Restart the Codex app and open a new chat.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
