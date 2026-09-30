import { readConfig } from './config.js';
import { ApplicationFlags, Routes, type APIApplication, type APIGuild, type APIGuildMember, type APIRole, type APIUser, type APIChannel } from 'discord-api-types/v10';
import { REST } from '@discordjs/rest';
import { permissionsFor, has, P } from './permissions.js';

async function main() {
  let config;
  try { config = readConfig(); }
  catch {
    console.error('設定が未完了です。npm run configure でDiscordの認証情報とサーバーIDを設定してください。');
    process.exitCode = 1; return;
  }
  if ([config.DISCORD_CLIENT_SECRET, config.DISCORD_BOT_TOKEN].some(s => s.startsWith('replace_'))) {
    console.error('Client Secret / Bot Token が未設定です。npm run configure で入力してください。');
    process.exitCode = 1; return;
  }
  const rest = new REST({ version: '10', timeout: 10000, retries: 0 }).setToken(config.DISCORD_BOT_TOKEN);
  const check = async <T>(label: string, path: `/${string}`): Promise<T | undefined> => {
    try { const value = await rest.get(path) as T; console.log(`OK: ${label}`); return value; }
    catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : undefined;
      console.error(`NG: ${label}${status ? ` (HTTP ${status})` : ''}。設定とDiscord側のアクセスを確認してください。`);
      process.exitCode = 1; return undefined;
    }
  };
  const bot = await check<APIUser>('Botトークン', Routes.user());
  if (!bot) return;
  const app = await check<APIApplication>('Discordアプリ', Routes.oauth2CurrentApplication());
  if (app?.id !== config.DISCORD_CLIENT_ID) { console.error('NG: Application IDとBotが一致しません。'); process.exitCode = 1; return; }
  console.log(`Bot名: ${bot.username} / Application ID: ${app.id}`);
  if (!((app.flags ?? 0) & (ApplicationFlags.GatewayMessageContent | ApplicationFlags.GatewayMessageContentLimited))) {
    console.error('NG: Message Content IntentをDeveloper Portalで有効にしてください。'); process.exitCode = 1;
  } else console.log('OK: Message Content Intent');
  const guild = await check<APIGuild>('会社サーバーへのBot参加', Routes.guild(config.DISCORD_GUILD_ID));
  if (!guild) {
    console.log(`Bot招待: https://discord.com/oauth2/authorize?client_id=${config.DISCORD_CLIENT_ID}&scope=bot&permissions=68608&guild_id=${config.DISCORD_GUILD_ID}&disable_guild_select=true`);
    return;
  }
  console.log(`会社サーバー: ${guild.name} / ${guild.id}`);
  const member = await check<APIGuildMember>('Botメンバー情報', Routes.guildMember(guild.id, bot.id));
  const roles = await check<APIRole[]>('サーバーロール', Routes.guildRoles(guild.id));
  const channels = await check<APIChannel[]>('チャンネル一覧', Routes.guildChannels(guild.id));
  if (roles) for (const roleId of config.employeeRoles) {
    const role = roles.find(r => r.id === roleId);
    if (role) console.log(`OK: 社員ロール ${role.name} (${role.id})`);
    else { console.error(`NG: 社員ロールID ${roleId} が存在しません。`); process.exitCode = 1; }
  }
  if (!config.employeeRoles.length) console.log('利用対象: このサーバーの参加者全員。社員限定にする場合は社員ロールIDを設定してください。');
  if (roles && channels && member) {
    const eligible = channels.filter(c => (c.type === 0 || c.type === 5) && (!config.allowedChannels.length || config.allowedChannels.includes(c.id)));
    const readable = eligible.filter(c => 'permission_overwrites' in c && has(permissionsFor(guild.id, guild.owner_id, member, roles, c.permission_overwrites), P.ViewChannel | P.ReadMessageHistory));
    console.log(`Botが履歴を取得できる対象チャンネル数: ${readable.length}`);
    if (!readable.length) { console.error('NG: Botに閲覧可能な対象チャンネルがありません。'); process.exitCode = 1; }
  }
  console.log(`Discord OAuth2 Redirectsに登録するURL: ${config.publicUrl}/oauth/discord/callback`);
  console.log('Client SecretとRedirectsの組み合わせは、社員のOAuthログインで最終確認します。');
  console.log(config.publicUrl.startsWith('https:') ? '公開URLはHTTPSです。起動後に社員用配布ファイルを生成してください。' : '現在はローカル確認用です。社員全員の利用にはHTTPSの公開URLが必要です。');
}
await main();
