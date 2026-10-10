import { DurableObject } from 'cloudflare:workers';
import { handleAsNodeRequest } from 'cloudflare:node';
import { createServer } from 'node:http';
import { readConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { DiscordRest } from '../src/discord.js';
import { EncryptedStore } from '../src/storage.js';
import { DurableDatabase } from './database.js';
import { PersistentRateLimit } from './rate-limit.js';

interface Env {
  COMPANY: DurableObjectNamespace<CompanyDiscord>;
  PUBLIC_URL: string;
  DATABASE_KEY: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
  EMPLOYEE_ROLE_IDS?: string;
  ALLOWED_CHANNEL_IDS?: string;
  ENABLE_SEND?: string;
  OAUTH_REDIRECT_URIS?: string;
}

const configured = (env: Env) => [env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET, env.DISCORD_BOT_TOKEN, env.DISCORD_GUILD_ID, env.DATABASE_KEY]
  .every(value => value && !value.startsWith('replace_'));

export class CompanyDiscord extends DurableObject<Env> {
  private store?: EncryptedStore;
  private listening = false;
  private lastPrune = 0;
  async fetch(request: Request): Promise<Response> {
    if (!configured(this.env)) return Response.json({ status: 'setup_required' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    if (!this.listening) {
      const { COMPANY: _namespace, ...settings } = this.env;
      let config;
      try { config = readConfig({ ...settings, PORT: '3000', HOST: '127.0.0.1', DATABASE_PATH: ':durable:', TRUST_PROXY: '' }); }
      catch (error) {
        console.error('Configuration invalid', (error as { issues?: Array<{ path: unknown; code: string }> }).issues?.map(issue => ({ field: issue.path, code: issue.code })));
        return Response.json({ status: 'setup_required' }, { status: 503 });
      }
      this.store = new EncryptedStore(new DurableDatabase(this.ctx.storage), config.DATABASE_KEY);
      const { app } = createApp(config, this.store, new DiscordRest(config, { disableSweepers: true }), prefix => new PersistentRateLimit(this.store!, prefix));
      // Gateway presence is not used on Workers; MCP operations use Discord REST.
      app.locals.botStatus = 'rest_only';
      // The front Worker discards caller-supplied forwarding headers. Use only the
      // Cloudflare-provided address for Express's existing per-address limiters.
      const server = createServer((req, res) => {
        const address = req.headers['x-company-client-ip'];
        if (typeof address === 'string') Object.defineProperty(req.socket, 'remoteAddress', { value: address, configurable: true });
        delete req.headers['x-company-client-ip'];
        app(req, res);
      });
      server.listen(3000);
      this.listening = true;
    }
    if (Date.now() - this.lastPrune > 3600000) { this.store!.prune(); this.lastPrune = Date.now(); }
    return handleAsNodeRequest(3000, request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.PUBLIC_URL || new URL(request.url).origin !== env.PUBLIC_URL) return Response.json({ error: 'invalid_host' }, { status: 403 });
    if (!configured(env)) return Response.json({ status: 'setup_required' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const headers = new Headers(request.headers);
    headers.delete('forwarded');
    headers.delete('x-forwarded-for');
    headers.delete('x-forwarded-host');
    headers.delete('x-forwarded-proto');
    headers.set('x-company-client-ip', request.headers.get('cf-connecting-ip') ?? '127.0.0.1');
    return env.COMPANY.get(env.COMPANY.idFromName('company')).fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;
