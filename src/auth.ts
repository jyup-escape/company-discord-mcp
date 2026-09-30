import type { Request, Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidRequestError, InvalidScopeError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Config } from './config.js';
import { Store, now, digest, randomToken, type User } from './store.js';
import { AccessError, DiscordService } from './discord.js';

type Pending = { clientId: string; redirectUri: string; challenge: string; state?: string; scopes: string[]; browserHash: string };
type Code = Pending & { userId: string };
export type Grant = { userId: string; clientId: string; scopes: string[]; resource: string; expires: number; revoked: boolean };
type Token = { grantId: string; expires: number; used?: boolean };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const page = (body: string) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Company Discord MCP 接続</title></head><body><main>${body}</main></body></html>`;

export class AuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  readonly cookieName: string;
  constructor(readonly config: Config, readonly store: Store, readonly discord: DiscordService) {
    this.cookieName = config.publicUrl.startsWith('https:') ? '__Host-discord_mcp_flow' : 'discord_mcp_flow';
    this.clientsStore = {
      getClient: id => store.get<OAuthClientInformationFull>('clients', id),
      registerClient: input => {
        if (input.redirect_uris.length < 1 || input.redirect_uris.length > 5) throw new InvalidClientMetadataError('1–5 redirect URIs required');
        for (const uri of input.redirect_uris) {
          const u = new URL(uri);
          const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && u.protocol === 'http:';
          if (u.username || u.password || u.hash || (!loopback && !config.redirectUris.includes(uri))) throw new InvalidClientMetadataError('Callback URL is not permitted by the administrator');
        }
        if (!['none', 'client_secret_post', 'client_secret_basic'].includes(input.token_endpoint_auth_method ?? 'client_secret_post')) throw new InvalidClientMetadataError('Unsupported authentication method');
        const client = { ...input, client_id: randomToken(), client_id_issued_at: now() };
        store.set('clients', client.client_id, client);
        return client;
      },
    };
  }
  private resource(resource?: URL) {
    if (resource && resource.href !== this.config.resource) throw new InvalidRequestError('Invalid resource');
  }
  private cookie(req: Request) {
    return req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${this.cookieName}=`))?.slice(this.cookieName.length + 1) ?? '';
  }
  private browser(req: Request, pending: Pending) {
    if (digest(this.cookie(req)) !== pending.browserHash) throw new AccessError('ログインを開始したブラウザで再接続してください。');
  }
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    this.resource(params.resource);
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidRequestError('S256 PKCE challenge required');
    const supported = this.config.enableSend ? ['discord:read', 'discord:write'] : ['discord:read'];
    const scopes = params.scopes?.length ? [...new Set(params.scopes)] : supported;
    if (scopes.some(s => !supported.includes(s))) throw new InvalidScopeError('Unsupported scope');
    const browser = randomToken(), ticket = randomToken();
    this.store.set('consent', digest(ticket), { clientId: client.client_id, redirectUri: params.redirectUri,
      state: params.state, challenge: params.codeChallenge, scopes, browserHash: digest(browser) } satisfies Pending, now() + 600);
    res.cookie(this.cookieName, browser, { httpOnly: true, secure: this.config.publicUrl.startsWith('https:'), sameSite: 'lax', path: '/', maxAge: 600000 });
    // Explicit per-flow consent prevents a dynamically registered client from silently reusing Discord consent.
    res.type('html').send(page(`<h1>会社Discordへの接続</h1><p>接続アプリ: <strong>${escape(client.client_name ?? 'MCPクライアント')}</strong>（アプリが申告した名称）</p>
      <p>認証結果の送信先: <code>${escape(new URL(params.redirectUri).origin)}</code></p>
      <p>権限: ${scopes.includes('discord:read') ? 'チャンネル一覧・閲覧・直近メッセージ検索' : ''}${scopes.includes('discord:write') ? ' / Bot経由のメッセージ投稿' : ''}</p>
      <p>Discord上のあなたの権限の範囲で利用できます。取得した内容は接続アプリに渡ります。投稿にはあなたのDiscord IDを表示します。</p>
      <p><a href="/oauth/discord/start?ticket=${ticket}">同意してDiscordでログイン</a></p><p>接続しない場合は、このページを閉じてください。</p>`));
  }
  start(req: Request, res: Response) {
    if (req.method === 'POST' && req.headers.origin !== this.config.publicUrl) throw new AccessError('接続元を確認できません。');
    if (req.method === 'GET' && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw new AccessError('接続元を確認できません。');
    // The unguessable single-use ticket and matching HttpOnly browser cookie bind
    // consent to this browser. GET also works in embedded clients that block forms.
    const rawTicket = req.method === 'GET' ? req.query.ticket : req.body?.ticket;
    const ticket = typeof rawTicket === 'string' ? rawTicket : '';
    const pending = this.store.get<Pending>('consent', digest(ticket));
    if (!pending) throw new AccessError('接続リクエストの有効期限が切れています。');
    this.browser(req, pending);
    this.store.take('consent', digest(ticket));
    const state = randomToken();
    this.store.set('discord-state', digest(state), pending, now() + 600);
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: this.config.DISCORD_CLIENT_ID, redirect_uri: `${this.config.publicUrl}/oauth/discord/callback`, response_type: 'code', scope: 'identify', state, prompt: 'consent' }).toString();
    res.redirect(url.href);
  }
  async callback(req: Request, res: Response) {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const pending = this.store.get<Pending>('discord-state', digest(state));
    if (!pending) throw new AccessError('接続リクエストが無効か、有効期限が切れています。');
    this.browser(req, pending);
    this.store.take('discord-state', digest(state));
    res.clearCookie(this.cookieName, { path: '/', secure: this.config.publicUrl.startsWith('https:'), httpOnly: true, sameSite: 'lax' });
    const redirect = new URL(pending.redirectUri);
    if (pending.state !== undefined) redirect.searchParams.set('state', pending.state);
    if (req.query.error) { redirect.searchParams.set('error', 'access_denied'); res.redirect(redirect.href); return; }
    if (typeof req.query.code !== 'string') throw new AccessError('Discordの認証コードがありません。');
    const user = await this.discord.api.login(req.query.code);
    await this.discord.eligible(user.id);
    const code = randomToken();
    this.store.transaction(() => {
      if (this.store.get<User>('users', user.id)?.disabled) throw new AccessError('このアカウントは利用停止中です。');
      this.store.set('users', user.id, { id: user.id, name: user.global_name ?? user.username, disabled: false } satisfies User);
      this.store.set('codes', digest(code), { ...pending, userId: user.id } satisfies Code, now() + 120);
      this.store.audit(user.id, 'login', 'success');
    });
    redirect.searchParams.set('code', code);
    res.redirect(redirect.href);
  }
  private code(client: OAuthClientInformationFull, raw: string) {
    const code = this.store.get<Code>('codes', digest(raw));
    if (!code || code.clientId !== client.client_id) throw new InvalidGrantError('Invalid authorization code');
    return code;
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, raw: string) { return this.code(client, raw).challenge; }
  private issue(grantId: string, grant: Grant): OAuthTokens {
    const access = randomToken(), refresh = randomToken();
    const expiry = Math.min(now() + 3600, grant.expires);
    this.store.set('access', digest(access), { grantId, expires: expiry } satisfies Token, expiry);
    this.store.set('refresh', digest(refresh), { grantId, expires: grant.expires, used: false } satisfies Token, grant.expires);
    return { access_token: access, token_type: 'Bearer', expires_in: expiry - now(), refresh_token: refresh, scope: grant.scopes.join(' ') };
  }
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, raw: string, _verifier?: string, redirectUri?: string, resource?: URL) {
    this.resource(resource);
    const code = this.code(client, raw);
    if (redirectUri !== code.redirectUri) throw new InvalidGrantError('redirect_uri does not match');
    try { await this.discord.eligible(code.userId); }
    catch { throw new InvalidGrantError('Membership or employee role could not be verified'); }
    return this.store.transaction(() => {
      this.code(client, raw);
      if (this.store.get<User>('users', code.userId)?.disabled) throw new InvalidGrantError('Account disabled');
      this.store.take('codes', digest(raw));
      const id = randomToken();
      const grant: Grant = { userId: code.userId, clientId: client.client_id, scopes: code.scopes, resource: this.config.resource, expires: now() + 30 * 86400, revoked: false };
      this.store.set('grants', id, grant, grant.expires);
      return this.issue(id, grant);
    });
  }
  private grant(id: string) {
    const grant = this.store.get<Grant>('grants', id);
    if (!grant || grant.revoked || grant.resource !== this.config.resource || this.store.get<User>('users', grant.userId)?.disabled) throw new InvalidTokenError('Session revoked or expired');
    return grant;
  }
  private revokeGrant(id: string) {
    const grant = this.store.get<Grant>('grants', id);
    if (grant) this.store.set('grants', id, { ...grant, revoked: true }, grant.expires);
  }
  async exchangeRefreshToken(client: OAuthClientInformationFull, raw: string, scopes?: string[], resource?: URL) {
    this.resource(resource);
    const key = digest(raw);
    const token = this.store.get<Token>('refresh', key);
    if (!token) throw new InvalidGrantError('Invalid refresh token');
    let grant: Grant;
    try { grant = this.grant(token.grantId); }
    catch { throw new InvalidGrantError('Session revoked or expired'); }
    if (grant.clientId !== client.client_id) throw new InvalidGrantError('Wrong client');
    if (token.used) { this.revokeGrant(token.grantId); throw new InvalidGrantError('Refresh token reuse detected; sign in again'); }
    if (scopes && scopes.some(s => !grant.scopes.includes(s))) throw new InvalidScopeError('Cannot expand scopes');
    try { await this.discord.eligible(grant.userId); }
    catch { throw new InvalidGrantError('Membership or employee role could not be verified'); }
    // No await between rereading the token and rotating it, including across processes.
    let replay = false;
    const result = this.store.transaction(() => {
      const current = this.store.get<Token>('refresh', key);
      const live = this.grant(token.grantId);
      if (!current || current.used) { this.revokeGrant(token.grantId); replay = true; return undefined; }
      this.store.set('refresh', key, { ...current, used: true }, current.expires);
      const next = { ...live, scopes: scopes ?? live.scopes };
      this.store.set('grants', token.grantId, next, next.expires);
      return this.issue(token.grantId, next);
    });
    if (replay || !result) throw new InvalidGrantError('Refresh token reuse detected');
    return result;
  }
  async verifyAccessToken(raw: string): Promise<AuthInfo> {
    const token = this.store.get<Token>('access', digest(raw));
    if (!token) throw new InvalidTokenError('Invalid access token');
    const grant = this.grant(token.grantId);
    if (token.expires <= now()) throw new InvalidTokenError('Expired access token');
    try { await this.discord.eligible(grant.userId); }
    catch { throw new InvalidTokenError('Membership or employee role could not be verified'); }
    const live = this.grant(token.grantId);
    return { token: raw, clientId: live.clientId, scopes: live.scopes, expiresAt: token.expires,
      resource: new URL(live.resource), extra: { userId: live.userId } };
  }
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const key = digest(request.token);
    const token = this.store.get<Token>('access', key) ?? this.store.get<Token>('refresh', key);
    if (token && this.store.get<Grant>('grants', token.grantId)?.clientId === client.client_id) this.revokeGrant(token.grantId);
  }
}
