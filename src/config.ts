import { z } from 'zod';

const ids = (s: string) => s.split(',').map(v => v.trim()).filter(Boolean);
const snowflake = z.string().regex(/^\d{17,20}$/);
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = z.object({
    PUBLIC_URL: z.url().default('http://localhost:3000'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DISCORD_CLIENT_ID: snowflake,
    DISCORD_CLIENT_SECRET: z.string().min(1),
    DISCORD_BOT_TOKEN: z.string().min(1),
    DISCORD_GUILD_ID: snowflake,
    EMPLOYEE_ROLE_IDS: z.string().default(''),
    ALLOWED_CHANNEL_IDS: z.string().default(''),
    ENABLE_SEND: z.enum(['true', 'false']).default('true'),
    DATABASE_PATH: z.string().default('./data/company-discord.db'),
    DATABASE_KEY: z.string().refine(s => /^[A-Za-z0-9+/]{43}=$/.test(s) && Buffer.from(s, 'base64').length === 32, '32-byte base64 key required'),
    OAUTH_REDIRECT_URIS: z.string().default('https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback'),
    ALLOWED_ORIGINS: z.string().default(''),
    TRUST_PROXY: z.string().default(''),
  }).parse(env);
  const url = new URL(c.PUBLIC_URL);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('PUBLIC_URL must be an origin without a path');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('PUBLIC_URL requires HTTPS (except loopback development)');
  for (const id of [...ids(c.EMPLOYEE_ROLE_IDS), ...ids(c.ALLOWED_CHANNEL_IDS)]) snowflake.parse(id);
  for (const uri of ids(c.OAUTH_REDIRECT_URIS)) {
    const u = new URL(uri);
    if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new Error('OAUTH_REDIRECT_URIS must contain exact HTTPS callback URLs');
  }
  return {
    ...c, publicUrl: url.origin, resource: `${url.origin}/mcp`,
    employeeRoles: ids(c.EMPLOYEE_ROLE_IDS), allowedChannels: ids(c.ALLOWED_CHANNEL_IDS),
    redirectUris: ids(c.OAUTH_REDIRECT_URIS), origins: [url.origin, ...ids(c.ALLOWED_ORIGINS)],
    enableSend: c.ENABLE_SEND === 'true',
  };
}
export type Config = ReturnType<typeof readConfig>;
