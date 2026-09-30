import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fixture, U, C, OTHER, PRIVATE } from './helpers.js';

test('OAuth discovery advertises resource and rejects unauthenticated MCP', async t => {
  const f = await fixture(); t.after(f.close);
  const r = await f.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate')!, /oauth-protected-resource\/mcp/);
  assert.equal((await (await f.request('/.well-known/oauth-protected-resource/mcp')).json()).resource, f.config.resource);
  assert.equal((await (await f.request('/.well-known/oauth-authorization-server')).json()).code_challenge_methods_supported[0], 'S256');
});
test('DCR rejects unapproved redirects and accepts native clients', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.register('https://attacker.example/callback')).status, 400);
  assert.equal((await f.register('http://localhost:1234/cb#fragment')).status, 400);
  assert.equal((await f.register()).status, 201);
});
test('consent is escaped, browser-bound, origin checked and single-use', async t => {
  const f = await fixture(); t.after(f.close);
  const client = await f.register(); const flow = await f.begin(client.data.client_id);
  assert.match(flow.html, /&lt;test-client&gt;/); assert.ok(flow.ticket);
  assert.match(flow.response.headers.get('content-security-policy')!, /form-action 'self' https:\/\/discord.com/);
  assert.equal((await f.form('/oauth/discord/start', { ticket: flow.ticket }, { Origin: f.config.publicUrl })).status, 403);
  assert.equal((await f.form('/oauth/discord/start', { ticket: flow.ticket }, { Origin: 'https://evil.example', Cookie: flow.cookie })).status, 403);
  const ok = await f.form('/oauth/discord/start', { ticket: flow.ticket }, { Origin: f.config.publicUrl, Cookie: flow.cookie });
  assert.equal(ok.status, 302);
  const state = new URL(ok.headers.get('location')!).searchParams.get('state');
  assert.equal((await f.request(`/oauth/discord/callback?state=${state}&code=test-code`)).status, 403);
  assert.equal((await f.form('/oauth/discord/start', { ticket: flow.ticket }, { Origin: f.config.publicUrl, Cookie: flow.cookie })).status, 403);
});
test('PKCE, client binding, resource binding, redirect binding and code replay rejection', async t => {
  const f = await fixture(); t.after(f.close);
  const client = await f.register(), other = await f.register();
  const flow = await f.code(client.data.client_id);
  const body = { grant_type: 'authorization_code', client_id: client.data.client_id, code: flow.code, code_verifier: flow.verifier, redirect_uri: 'http://localhost:3456/callback' };
  assert.equal((await f.form('/token', { ...body, code_verifier: 'wrong' })).status, 400);
  assert.equal((await f.form('/token', { ...body, client_id: other.data.client_id })).status, 400);
  assert.equal((await f.form('/token', { ...body, resource: 'https://evil.example/mcp' })).status, 400);
  assert.equal((await f.form('/token', { ...body, redirect_uri: 'http://localhost:3457/callback' })).status, 400);
  assert.equal((await f.form('/token', body)).status, 200);
  assert.equal((await f.form('/token', body)).status, 400);
});

test('link consent rejects cross-site requests, cookie mismatch and ticket replay', async t => {
  const f = await fixture(); t.after(f.close);
  const client = await f.register(), flow = await f.begin(client.data.client_id);
  const path = `/oauth/discord/start?ticket=${flow.ticket}`;
  assert.equal((await f.request(path)).status, 403);
  assert.equal((await f.request(path, { headers: { Cookie: flow.cookie, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const ok = await f.request(path, { headers: { Cookie: flow.cookie, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(ok.status, 302);
  assert.equal(new URL(ok.headers.get('location')!).hostname, 'discord.com');
  assert.equal((await f.request(path, { headers: { Cookie: flow.cookie } })).status, 403);
});
test('refresh rotation rejects scope escalation and replay revokes the whole grant', async t => {
  const f = await fixture(); t.after(f.close);
  const session = await f.login(undefined, 'discord:read'); assert.equal(session.response.status, 200);
  const body = { grant_type: 'refresh_token', client_id: session.client.client_id, refresh_token: session.tokens.refresh_token! };
  assert.equal((await f.form('/token', { ...body, scope: 'discord:read discord:write' })).status, 400);
  const rotated = await f.form('/token', body); assert.equal(rotated.status, 200);
  const tokens = await rotated.json();
  await f.provider.verifyAccessToken(tokens.access_token);
  assert.equal((await f.form('/token', body)).status, 400);
  await assert.rejects(f.provider.verifyAccessToken(tokens.access_token));
  await assert.rejects(f.provider.verifyAccessToken(session.tokens.access_token!));
});
test('membership removal, local disabling and token revocation take effect', async t => {
  const f = await fixture(); t.after(f.close);
  const session = await f.login(); assert.equal(session.response.status, 200);
  const member = f.api.members.get(U)!;
  f.api.members.delete(U); await assert.rejects(f.provider.verifyAccessToken(session.tokens.access_token!));
  f.api.members.set(U, member);
  f.store.set('users', U, { id: U, disabled: true }); await assert.rejects(f.provider.verifyAccessToken(session.tokens.access_token!));
  f.store.set('users', U, { id: U, disabled: false });
  assert.equal((await f.form('/revoke', { client_id: session.client.client_id, token: session.tokens.refresh_token! })).status, 200);
  await assert.rejects(f.provider.verifyAccessToken(session.tokens.access_token!));
});
test('two SDK clients initialize and use tools with isolated employee permissions', async t => {
  const f = await fixture(); t.after(f.close);
  const a = await f.login(), b = await f.login('other-code');
  assert.equal(a.response.status, 200); assert.equal(b.response.status, 200);
  const clients = [a, b].map((session, i) => ({ client: new Client({ name: `test-${i}`, version: '1' }), transport: new StreamableHTTPClientTransport(new URL(f.config.resource), { requestInit: { headers: { Authorization: `Bearer ${session.tokens.access_token}` } } }) }));
  for (const c of clients) { await c.client.connect(c.transport); t.after(() => c.client.close()); }
  const first = clients[0]!.client, second = clients[1]!.client;
  assert.equal((await first.listTools()).tools.length, 5);
  const who = await second.callTool({ name: 'discord_whoami', arguments: {} });
  assert.match(JSON.stringify(who), new RegExp(OTHER));
  const denied = await second.callTool({ name: 'discord_read_messages', arguments: { channel_id: PRIVATE } });
  assert.equal(denied.isError, true);
  const allowed = await first.callTool({ name: 'discord_read_messages', arguments: { channel_id: PRIVATE } });
  assert.notEqual(allowed.isError, true);
  const posted = await first.callTool({ name: 'discord_send_message', arguments: { channel_id: C, content: 'hello' } });
  assert.notEqual(posted.isError, true); assert.equal(f.api.sends.length, 1);
});
test('read-only tokens do not expose the posting tool; invalid origins and hosts are blocked', async t => {
  const f = await fixture(); t.after(f.close);
  const a = await f.login(undefined, 'discord:read');
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(f.config.resource), { requestInit: { headers: { Authorization: `Bearer ${a.tokens.access_token}` } } }));
  t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 4);
  assert.equal((await f.request('/mcp', { headers: { Origin: 'https://evil.example' } })).status, 403);
  // fetch normalizes Host; use raw HTTP to exercise hostile Host headers.
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const r = httpRequest(`${f.config.publicUrl}/healthz`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject); r.end();
  });
  assert.equal(status, 403);
});
