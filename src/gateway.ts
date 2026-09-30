import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import type { Config } from './config.js';

export type BotStatus = 'connecting' | 'online' | 'disconnected' | 'error';

export function connectBot(config: Config, status: (value: BotStatus) => void) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    presence: { status: 'online', activities: [{ name: '社員用MCP', type: ActivityType.Watching }] },
  });
  let stopped = false;
  let retry: NodeJS.Timeout | undefined;
  client.on(Events.ClientReady, ready => {
    if (ready.user.id !== config.DISCORD_CLIENT_ID || !ready.guilds.cache.has(config.DISCORD_GUILD_ID)) {
      status('error');
      console.error('Discord Gateway: Botまたは会社サーバーが設定と一致しません。');
      void client.destroy();
      return;
    }
    status('online');
    console.log(`Discord Bot online: ${ready.user.username} (${ready.user.id})`);
  });
  client.on(Events.ShardDisconnect, () => status('disconnected'));
  client.on(Events.ShardReconnecting, () => status('connecting'));
  client.on(Events.ShardResume, () => status('online'));
  // Never log SDK error objects: they may include authentication request details.
  client.on(Events.Error, () => { status('error'); console.error('Discord Gateway: 接続エラー。'); });
  client.on(Events.ShardError, () => status('error'));
  const login = async () => {
    if (stopped) return;
    status('connecting');
    try { await client.login(config.DISCORD_BOT_TOKEN); }
    catch {
      if (stopped) return;
      status('error');
      console.error('Discord Gateway: ログイン失敗。30秒後に再試行します。');
      retry = setTimeout(() => { void login(); }, 30000);
    }
  };
  void login();
  return async () => { stopped = true; clearTimeout(retry); await client.destroy(); status('disconnected'); };
}
