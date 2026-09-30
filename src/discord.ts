import { REST } from '@discordjs/rest';
import { randomBytes } from 'node:crypto';
import { Routes, ChannelType, type APIChannel, type APIGuild, type APIGuildMember, type APIMessage, type APIRole, type APIUser } from 'discord-api-types/v10';
import type { Config } from './config.js';
import { has, P, permissionsFor } from './permissions.js';
import { Store, now, type User } from './store.js';

export class AccessError extends Error {}
type TextChannel = Extract<APIChannel, { type: ChannelType.GuildText | ChannelType.GuildAnnouncement }>;
export interface DiscordApi {
  user(): Promise<APIUser>;
  guild(): Promise<APIGuild>;
  member(id: string): Promise<APIGuildMember>;
  roles(): Promise<APIRole[]>;
  channels(): Promise<APIChannel[]>;
  channel(id: string): Promise<APIChannel>;
  messages(id: string, limit: number, before?: string): Promise<APIMessage[]>;
  send(id: string, content: string): Promise<APIMessage>;
  login(code: string): Promise<APIUser>;
}
export class DiscordRest implements DiscordApi {
  private rest: REST;
  constructor(private config: Config) {
    this.rest = new REST({ version: '10', timeout: 15000, retries: 2 }).setToken(config.DISCORD_BOT_TOKEN);
  }
  async user() { return await this.rest.get(Routes.user()) as APIUser; }
  async guild() { return await this.rest.get(Routes.guild(this.config.DISCORD_GUILD_ID)) as APIGuild; }
  async member(id: string) { return await this.rest.get(Routes.guildMember(this.config.DISCORD_GUILD_ID, id)) as APIGuildMember; }
  async roles() { return await this.rest.get(Routes.guildRoles(this.config.DISCORD_GUILD_ID)) as APIRole[]; }
  async channels() { return await this.rest.get(Routes.guildChannels(this.config.DISCORD_GUILD_ID)) as APIChannel[]; }
  async channel(id: string) { return await this.rest.get(Routes.channel(id)) as APIChannel; }
  async messages(id: string, limit: number, before?: string) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set('before', before);
    return await this.rest.get(Routes.channelMessages(id), { query }) as APIMessage[];
  }
  async send(id: string, content: string) {
    return await this.rest.post(Routes.channelMessages(id), {
      body: { content, nonce: randomBytes(12).toString('hex'), enforce_nonce: true, allowed_mentions: { parse: [], users: [], roles: [], replied_user: false } },
    }) as APIMessage;
  }
  async login(code: string) {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ client_id: this.config.DISCORD_CLIENT_ID, client_secret: this.config.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code', code, redirect_uri: `${this.config.publicUrl}/oauth/discord/callback` }),
    });
    if (!response.ok) throw new AccessError('Discordログインに失敗しました。最初から接続してください。');
    const token = await response.json() as { access_token: string };
    // The Discord user token is used only to identify the employee; never passed to MCP clients or stored.
    const user = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000),
    });
    if (!user.ok) throw new AccessError('Discordアカウントを確認できませんでした。');
    return await user.json() as APIUser;
  }
}
export class DiscordService {
  constructor(readonly config: Config, readonly store: Store, readonly api: DiscordApi) {}
  async eligible(userId: string) {
    if (this.store.get<User>('users', userId)?.disabled) throw new AccessError('このアカウントは利用停止中です。');
    let member: APIGuildMember;
    try { member = await this.api.member(userId); }
    catch { throw new AccessError('会社サーバーへの参加とBotのアクセスを確認できません。'); }
    if (this.store.get<User>('users', userId)?.disabled) throw new AccessError('このアカウントは利用停止中です。');
    if (!member.user || member.user.id !== userId || member.user.bot || member.pending) throw new AccessError('参加手続きが完了した社員アカウントが必要です。');
    if (this.config.employeeRoles.length && !member.roles.some(r => this.config.employeeRoles.includes(r))) throw new AccessError('利用に必要な社員ロールがありません。');
    return member;
  }
  private async context(userId: string) {
    const member = await this.eligible(userId);
    const [guild, roles, botUser] = await Promise.all([this.api.guild(), this.api.roles(), this.api.user()]);
    const bot = await this.api.member(botUser.id);
    return { member, guild, roles, bot };
  }
  private supported(c: APIChannel): c is TextChannel {
    return (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
      && c.guild_id === this.config.DISCORD_GUILD_ID
      && (!this.config.allowedChannels.length || this.config.allowedChannels.includes(c.id));
  }
  private allowed(c: TextChannel, ctx: Awaited<ReturnType<DiscordService['context']>>, write: boolean) {
    const bits = P.ViewChannel | (write ? P.SendMessages : P.ReadMessageHistory);
    return [ctx.member, ctx.bot].every(m => {
      if (write && m.communication_disabled_until && Date.parse(m.communication_disabled_until) > Date.now()) return false;
      return has(permissionsFor(ctx.guild.id, ctx.guild.owner_id, m, ctx.roles, c.permission_overwrites), bits);
    });
  }
  async authorize(userId: string, channelId: string, write = false) {
    const ctx = await this.context(userId);
    const c = await this.api.channel(channelId);
    if (!this.supported(c) || !this.allowed(c, ctx, write)) throw new AccessError('このチャンネルの操作は許可されていません（スレッド・DM・フォーラムには未対応）。');
    return { channel: c, member: ctx.member };
  }
  async list(userId: string) {
    const ctx = await this.context(userId);
    const channels = await this.api.channels();
    return channels.filter(c => this.supported(c) && this.allowed(c, ctx, false)).map(c => ({
      id: c.id, name: 'name' in c ? c.name : '', type: c.type,
    }));
  }
  private message(m: APIMessage) {
    return { id: m.id, channel_id: m.channel_id, author: { id: m.author.id, name: m.author.global_name ?? m.author.username, bot: m.author.bot ?? false },
      content: m.content, timestamp: m.timestamp, url: `https://discord.com/channels/${this.config.DISCORD_GUILD_ID}/${m.channel_id}/${m.id}`,
      attachments: m.attachments.map(a => ({ filename: a.filename, url: a.url, size: a.size })),
    };
  }
  async read(userId: string, channelId: string, limit: number, before?: string) {
    await this.authorize(userId, channelId);
    const messages = await this.api.messages(channelId, limit, before);
    return { messages: messages.map(m => this.message(m)), next_before: messages.at(-1)?.id ?? null,
      note: '本文が空の場合はBotのMessage Content Intentを確認してください。' };
  }
  async search(userId: string, channelId: string, query: string, maxScan: number, before?: string) {
    await this.authorize(userId, channelId);
    let scanned = 0, cursor = before, exhausted = false;
    const matches: ReturnType<DiscordService['message']>[] = [];
    while (scanned < maxScan && matches.length < 20) {
      // Recheck on every page so permission changes are not hidden by a long-running scan.
      await this.authorize(userId, channelId);
      const batch = await this.api.messages(channelId, Math.min(100, maxScan - scanned), cursor);
      if (!batch.length) { exhausted = true; break; }
      for (const m of batch) {
        scanned++; cursor = m.id;
        if (m.content.toLocaleLowerCase().includes(query.toLocaleLowerCase())) matches.push(this.message(m));
        if (matches.length === 20) break;
      }
    }
    return { matches, scanned, exhausted, next_before: exhausted ? null : cursor ?? null,
      scope: '指定チャンネルの直近メッセージのみ。全文検索・全サーバー検索ではありません。' };
  }
  async send(userId: string, channelId: string, content: string) {
    if (!this.config.enableSend) throw new AccessError('管理者が投稿を無効にしています。');
    const { channel } = await this.authorize(userId, channelId, true);
    // Apply the channel slowmode conservatively, even when the shared bot is exempt.
    const cooldownKey = `${userId}:${channelId}`;
    this.store.transaction(() => {
      if (this.store.get('cooldown', cooldownKey)) throw new AccessError('チャンネルの低速モードにより、少し待ってから投稿してください。');
      this.store.set('cooldown', cooldownKey, true, now() + Math.max(1, channel.rate_limit_per_user ?? 0));
    });
    this.store.audit(userId, 'discord_send_message', 'attempt', channelId);
    const message = await this.api.send(channelId, `【MCP投稿・社員Discord ID: ${userId}】\n${content}`);
    this.store.audit(userId, 'discord_send_message', 'success', channelId, message.id);
    return this.message(message);
  }
}
