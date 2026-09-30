import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readConfig } from '../src/config.js';
import { Store, randomToken, digest, now } from '../src/store.js';
import type { Grant } from '../src/auth.js';

// Administrator smoke check: use an existing, employee-approved OAuth grant.
// The temporary credential stays in this process and is removed after the check.
const config = readConfig();
const store = new Store(config.DATABASE_PATH, config.DATABASE_KEY);
const client = new Client({ name: 'administrator-live-check', version: '1' });
let key: string | undefined;
try {
  const grant = store.list<Grant>('grants').find(g => !g.value.revoked && g.value.resource === config.resource && g.value.scopes.includes('discord:read'));
  if (!grant) throw new Error('先に社員アカウントでOAuthログインを完了してください。');
  const token = randomToken(); key = digest(token);
  store.set('access', key, { grantId: grant.id, expires: now() + 60 }, now() + 60);
  await client.connect(new StreamableHTTPClientTransport(new URL(config.resource), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const tools = await client.listTools();
  console.log(`OK: 公開MCPの初期化・ツール一覧 (${tools.tools.length} tools)`);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError || !Array.isArray(result.content)) throw new Error(`${name}に失敗しました。`);
    const item = result.content.find(c => c.type === 'text');
    if (!item || item.type !== 'text') throw new Error('応答形式を確認してください。');
    return JSON.parse(item.text);
  };
  const who = await call('discord_whoami');
  if (who.user_id !== grant.value.userId || who.guild_id !== config.DISCORD_GUILD_ID) throw new Error('本人・会社サーバーが一致しません。');
  console.log('OK: OAuthログインした社員本人・会社サーバーの検証');
  const channels = await call('discord_list_channels');
  if (!Array.isArray(channels) || !channels.length) throw new Error('閲覧できるチャンネルがありません。');
  console.log(`OK: 社員とBotの両方が閲覧できるチャンネル (${channels.length})`);
  const read = await call('discord_read_messages', { channel_id: channels[0].id, limit: 3 });
  console.log(`OK: 実Discordの履歴取得 (${read.messages.length}件、本文を表示せず確認)`);
  await call('discord_search_messages', { channel_id: channels[0].id, query: '__mcp_connection_check__', max_scan: 3 });
  console.log('OK: 実Discordの検索');
  console.log('投稿ツール: ' + (tools.tools.some(t => t.name === 'discord_send_message') ? '登録済み（実投稿は行っていません）' : '読み取り専用接続'));
} catch (error) {
  console.error(error instanceof Error && !('status' in error) ? error.message : '接続確認に失敗しました。');
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  if (key) store.take('access', key);
  store.close();
}
