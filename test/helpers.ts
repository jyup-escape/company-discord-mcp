import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { APIChannel, APIGuild, APIGuildMember, APIMessage, APIRole, APIUser } from 'discord-api-types/v10';
import { readConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { P } from '../src/permissions.js';
import { createApp } from '../src/app.js';
import type { DiscordApi } from '../src/discord.js';
export const G = '100000000000000001', U = '100000000000000002', B = '100000000000000003', R = '100000000000000004', C = '100000000000000005', PRIVATE = '100000000000000006', OTHER = '100000000000000007';
export const KEY = Buffer.alloc(32, 42).toString('base64');
export const cfg = () => readConfig({ DISCORD_CLIENT_ID: B, DISCORD_CLIENT_SECRET: 'test-secret', DISCORD_BOT_TOKEN: 'test-bot-token', DISCORD_GUILD_ID: G, DATABASE_KEY: KEY });
export const member = (id = U, roles: string[] = [R]) => ({ user: { id, username: id === U ? '社員' : 'Bot', bot: id === B }, roles, pending: false }) as APIGuildMember;
export const role = (id: string, bits: bigint) => ({ id, permissions: String(bits) }) as APIRole;
export const channel = (id = C) => ({ id, guild_id: G, type: 0, name: 'general', permission_overwrites: [], rate_limit_per_user: 0 }) as APIChannel;
export const msg = (id: string, content: string, channelId = C) => ({ id, channel_id: channelId, content, author: { id: U, username: '社員' }, timestamp: '2026-09-30T00:00:00Z', attachments: [] }) as unknown as APIMessage;
export class FakeDiscord implements DiscordApi {
  members = new Map([[U, member()], [B, member(B, [])], [OTHER, member(OTHER, [])]]);
  roleList = [role(G, P.ViewChannel | P.ReadMessageHistory | P.SendMessages), role(R, 0n)];
  channelList = [channel(), { ...channel(PRIVATE), name: 'private', permission_overwrites: [{ id: G, type: 0, deny: String(P.ViewChannel), allow: '0' }, { id: U, type: 1, deny: '0', allow: String(P.ViewChannel) }, { id: B, type: 1, deny: '0', allow: String(P.ViewChannel) }] } as APIChannel];
  history = [msg('200000000000000002', 'release alpha'), msg('200000000000000001', 'こんにちは')];
  reads: string[] = [];
  sends: Array<{ id: string; content: string }> = [];
  async user() { return { id: B, username: 'Bot' } as APIUser; }
  async guild() { return { id: G, owner_id: '100000000000000099' } as APIGuild; }
  async member(id: string) { const m = this.members.get(id); if (!m) throw new Error('404'); return m; }
  async roles() { return this.roleList; }
  async channels() { return this.channelList; }
  async channel(id: string) { const c = this.channelList.find(c => c.id === id); if (!c) throw new Error('404'); return c; }
  async messages(id: string, limit: number, before?: string) { this.reads.push(id); return this.history.filter(m => !before || BigInt(m.id) < BigInt(before)).slice(0, limit).map(m => ({ ...m, channel_id: id })); }
  async send(id: string, content: string) { this.sends.push({ id, content }); return msg('300000000000000001', content, id); }
  async login(code: string) { return { id: code === 'other-code' ? OTHER : U, username: '社員' } as APIUser; }
}
export async function fixture() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const config = cfg();
  config.PORT = port; config.publicUrl = `http://127.0.0.1:${port}`; config.resource = `${config.publicUrl}/mcp`; config.origins = [config.publicUrl];
  const store = new Store(':memory:', KEY), api = new FakeDiscord();
  const app = createApp(config, store, api);
  server.on('request', app.app);
  const request = (path: string, init?: RequestInit) => fetch(`${config.publicUrl}${path}`, { redirect: 'manual', ...init });
  const form = (path: string, body: Record<string, string>, headers = {}) => request(path, { method: 'POST', body: new URLSearchParams(body), headers });
  const register = async (redirect = 'http://localhost:3456/callback') => {
    const r = await request('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: '<test-client>', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
    return { status: r.status, data: await r.json() as Record<string, any> };
  };
  const begin = async (clientId: string, scope = 'discord:read discord:write', resource = config.resource) => {
    const verifier = 'v'.repeat(64), challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: 'http://localhost:3456/callback', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'client-state', scope, resource });
    const r = await request(`/authorize?${q}`);
    const cookie = r.headers.get('set-cookie')?.split(';')[0] ?? '';
    const html = await r.text();
    return { response: r, html, cookie, verifier, ticket: /start\?ticket=([A-Za-z0-9_-]+)/.exec(html)?.[1] ?? '' };
  };
  const code = async (clientId: string, userCode = 'test-code', scope?: string) => {
    const flow = await begin(clientId, scope);
    const start = await form('/oauth/discord/start', { ticket: flow.ticket }, { Cookie: flow.cookie, Origin: config.publicUrl });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const callback = await request(`/oauth/discord/callback?${new URLSearchParams({ code: userCode, state })}`, { headers: { Cookie: flow.cookie } });
    return { ...flow, callback, code: callback.headers.get('location') ? new URL(callback.headers.get('location')!).searchParams.get('code')! : '', state };
  };
  const login = async (userCode?: string, scope?: string) => {
    const client = await register();
    const flow = await code(client.data.client_id, userCode, scope);
    const r = await form('/token', { grant_type: 'authorization_code', client_id: client.data.client_id, code: flow.code, code_verifier: flow.verifier, redirect_uri: 'http://localhost:3456/callback', resource: config.resource });
    return { client: client.data, flow, response: r, tokens: await r.json() as Record<string, string> };
  };
  return { ...app, config, store, api, request, form, register, begin, code, login, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); } };
}
