import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Config } from './config.js';
import { Store } from './store.js';
import { AuthProvider } from './auth.js';
import { AccessError, DiscordService, DiscordRest, type DiscordApi } from './discord.js';
import { createMcp } from './mcp.js';

export function createApp(config: Config, store: Store, api: DiscordApi = new DiscordRest(config)) {
  const discord = new DiscordService(config, store, api);
  const provider = new AuthProvider(config, store, discord);
  const app = express();
  app.disable('x-powered-by');
  // Only explicit proxy IPs/subnets are trusted; never trust every forwarded header.
  if (config.TRUST_PROXY) app.set('trust proxy', config.TRUST_PROXY.split(',').map(v => v.trim()));
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], formAction: ["'self'", 'https://discord.com'], frameAncestors: ["'none'"], baseUri: ["'none'"], upgradeInsecureRequests: null } } }));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const allowedHosts = [new URL(config.publicUrl).host, `127.0.0.1:${config.PORT}`, `localhost:${config.PORT}`];
    if (!req.headers.host || !allowedHosts.includes(req.headers.host.toLowerCase())) { res.status(403).json({ error: 'invalid_host' }); return; }
    next();
  });
  app.use(express.json({ limit: '64kb' }), express.urlencoded({ extended: false, limit: '16kb' }));
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', bot: app.locals.botStatus ?? 'not_connected' }));
  app.get('/', (_req, res) => res.json({ name: 'Company Discord MCP', endpoint: config.resource, registration: 'MCPクライアントにendpointを追加し、Discordでログインしてください。' }));
  const authLimit = rateLimit({ windowMs: 600000, limit: 1000, standardHeaders: 'draft-8', legacyHeaders: false });
  app.use('/oauth', authLimit);
  app.use(mcpAuthRouter({ provider, issuerUrl: new URL(config.publicUrl), resourceServerUrl: new URL(config.resource),
    scopesSupported: config.enableSend ? ['discord:read', 'discord:write'] : ['discord:read'], resourceName: 'Company Discord',
    clientRegistrationOptions: { clientSecretExpirySeconds: 0, rateLimit: { windowMs: 3600000, limit: 500 } },
    authorizationOptions: { rateLimit: { windowMs: 600000, limit: 1000 } },
    tokenOptions: { rateLimit: { windowMs: 600000, limit: 5000 } },
  }));
  app.post('/oauth/discord/start', (req, res) => provider.start(req, res));
  app.get('/oauth/discord/start', (req, res) => provider.start(req, res));
  app.get('/oauth/discord/callback', (req, res) => provider.callback(req, res));
  app.use('/mcp', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin)) { res.status(403).json({ error: 'invalid_origin' }); return; }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,MCP-Protocol-Version,Mcp-Session-Id,Last-Event-ID');
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate,MCP-Protocol-Version');
      res.setHeader('Access-Control-Allow-Methods', 'POST,GET,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  app.use('/mcp', rateLimit({ windowMs: 60000, limit: 6000, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/mcp', requireBearerAuth({ verifier: provider, resourceMetadataUrl: `${config.publicUrl}/.well-known/oauth-protected-resource/mcp` }));
  app.use('/mcp', rateLimit({ windowMs: 60000, limit: 60, keyGenerator: req => String(req.auth!.extra!.userId), standardHeaders: 'draft-8', legacyHeaders: false }));
  app.post('/mcp', async (req, res) => {
    const server = createMcp(discord, req.auth!);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'method_not_allowed' }); });
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) { res.end(); return; }
    const status = err instanceof AccessError ? 403 : err?.type === 'entity.too.large' ? 413 : err instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ error: status === 500 ? 'internal_error' : 'request_rejected', message: err instanceof AccessError ? err.message : 'リクエストを処理できませんでした。' });
  };
  app.use(onError);
  return { app, provider, discord };
}
