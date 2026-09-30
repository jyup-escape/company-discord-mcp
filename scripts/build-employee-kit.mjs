import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv, root } from './env-file.mjs';
import { readConfig } from '../src/config.ts';

export function employeeFiles(rawOrigin) {
  const url = new URL(rawOrigin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^[a-z0-9.-]+$/i.test(url.hostname) || /(^|\.)example\.(com|org|net)$/.test(url.hostname)) throw new Error('実際のHTTPS公開元URLが必要です。');
  const endpoint = `${url.origin}/mcp`;
  const setup = '\uFEFF' + readFileSync(new URL('./employee-codex-setup.ps1', import.meta.url), 'utf8').replace('__MCP_ENDPOINT__', endpoint);
  const launcher = '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0codex-setup.ps1"\r\npause\r\n';
  return {
    'Codexに接続.cmd': launcher,
    'codex-setup.ps1': setup,
    'connection.json': JSON.stringify({ name: 'company-discord', url: endpoint }, null, 2) + '\n',
    'codex-config.toml': `[mcp_servers.company-discord]\nurl = "${endpoint}"\n`,
    'claude-mcp.json': JSON.stringify({ mcpServers: { 'company-discord': { type: 'http', url: endpoint } } }, null, 2) + '\n',
    'register-codex.cmd': launcher,
    'register-claude-code.cmd': `@echo off\r\nchcp 65001 >nul\r\nwhere claude >nul 2>nul\r\nif errorlevel 1 (echo Claude Code is not installed. & pause & exit /b 1)\r\ncall claude mcp add --transport http --scope user company-discord "${endpoint}"\r\nif errorlevel 1 (pause & exit /b 1)\r\necho Open Claude Code and run /mcp to sign in.\r\npause\r\n`,
    'register-codex.sh': `#!/bin/sh\nset -eu\ncommand -v codex >/dev/null 2>&1 || { echo 'Codex CLI is required.'; exit 1; }\ncodex mcp add company-discord --url '${endpoint}'\necho 'Restart the Codex app and open a new chat.'\n`,
    'register-claude-code.sh': `#!/bin/sh\nset -eu\ncommand -v claude >/dev/null 2>&1 || { echo 'Claude Code is required.'; exit 1; }\nclaude mcp add --transport http --scope user company-discord '${endpoint}'\necho 'Open Claude Code and run /mcp to sign in.'\n`,
    '社員向け手順.txt': `会社Discord MCP 接続手順\n\n共通URL: ${endpoint}\n${url.hostname.endsWith('.trycloudflare.com') ? '\n現在は管理者PCからの暫定公開です。PCのスリープ・ログアウト中は利用できません。公開の再起動時はURLが変わるため、管理者が共有する新しいURLへ更新して再認証してください。\n' : ''}\nWindows / Codex: ZIPを展開して「Codexに接続.cmd」をダブルクリックします。認証画面が開いた場合だけDiscordで認証し、「接続できました」が出たらCodexアプリを終了して開き直し、新しいチャットで利用してください。\nWindows / Claude Code: register-claude-code.cmd を実行後、Claude Codeで /mcp から認証します。\nMac・Linux: sh register-codex.sh または sh register-claude-code.sh を実行します。\nClaude / Claude Desktop: 設定のカスタムコネクターに上記URLを追加し、Discordで認証します。\n\n会社サーバーに参加しているご自身のDiscordアカウントで認証してください。Botトークンの入力は不要です。\n必要なら管理者から社員ロールを付与してもらってください。\n初回確認: 「Discordで今ログインしている自分を確認して」「Discordのチャンネル一覧を見せて」\n\n設定ファイルの例も同梱しています。既存ファイル全体を上書きせず、company-discordの項目を追加してください。\n同名の既存サーバー設定がある場合は接続先を確認してください。\n取得した投稿は接続したAIサービスに渡ります。自分のDiscord権限内でのみ利用できます。\n投稿は共有Bot名義で、実行社員IDが本文に記録されます。\n`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = readConfig(loadEnv());
    const files = employeeFiles(config.publicUrl);
    const response = await fetch(`${config.publicUrl}/.well-known/oauth-protected-resource/mcp`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok || (await response.json()).resource !== config.resource) throw new Error('公開MCPへの接続を確認できません。サーバーとHTTPSを起動してから実行してください。');
    const dir = join(root, 'employee-kit');
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, { mode: name.endsWith('.sh') ? 0o755 : 0o644 });
    copyFileSync(join(root, 'docs', 'employee-guide.md'), join(dir, '詳細手順.md'));
    console.log(`社員向け配布ファイルを生成しました: ${dir}`);
    console.log('このフォルダーだけを社員へ配布してください。.env・ソース一式・DBを配布する必要はありません。');
  } catch { console.error('社員用ファイルは未生成です。認証情報、実際のHTTPS公開URL、サーバーへの接続を確認してください。'); process.exitCode = 1; }
}
