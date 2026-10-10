import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { DiscordService } from '../src/discord.js';
import { P } from '../src/permissions.js';
import { G, U, B, C, PRIVATE, OTHER, KEY, cfg, FakeDiscord, role, msg } from './helpers.js';

function fixture(t: test.TestContext) {
  const config = cfg(), store = new Store(':memory:', KEY), api = new FakeDiscord();
  t.after(() => store.close());
  return { config, store, api, service: new DiscordService(config, store, api) };
}
test('shared bot never leaks private channels between employees', async t => {
  const { service, api } = fixture(t);
  assert.equal((await service.list(U)).length, 2);
  assert.equal((await service.list(OTHER)).length, 1);
  await assert.rejects(service.read(OTHER, PRIVATE, 20));
  await assert.rejects(service.search(OTHER, PRIVATE, 'secret', 100));
  assert.deepEqual(api.reads, []);
});
test('removed members, missing employee roles, pending and disabled users are rejected', async t => {
  const { service, api, config, store } = fixture(t);
  config.employeeRoles = ['999999999999999999'];
  await assert.rejects(service.eligible(U));
  config.employeeRoles = [];
  api.members.get(U)!.pending = true; await assert.rejects(service.eligible(U));
  api.members.get(U)!.pending = false;
  store.set('users', U, { id: U, disabled: true }); await assert.rejects(service.eligible(U));
  store.take('users', U); api.members.delete(U); await assert.rejects(service.eligible(U));
});
test('cross-guild, private threads and excluded channels fail closed', async t => {
  const { service, api, config } = fixture(t);
  api.channelList[0] = { ...api.channelList[0], guild_id: OTHER } as any;
  await assert.rejects(service.read(U, C, 1));
  api.channelList[0] = { ...api.channelList[0], guild_id: G, type: 12 } as any;
  await assert.rejects(service.read(U, C, 1));
  config.allowedChannels = [C]; await assert.rejects(service.read(U, PRIVATE, 1));
  assert.equal(api.reads.length, 0);
});
test('bot permission and current employee permissions are both required', async t => {
  const { service, api } = fixture(t);
  api.channelList[0] = { ...api.channelList[0], permission_overwrites: [{ id: B, type: 1, deny: String(P.ViewChannel), allow: '0' }] } as any;
  await assert.rejects(service.read(U, C, 1));
  api.channelList[0] = { ...api.channelList[0], permission_overwrites: [] } as any;
  await service.read(U, C, 1);
  api.roleList = [role(G, P.ViewChannel)];
  await assert.rejects(service.read(U, C, 1));
  await assert.rejects(service.send(U, C, 'blocked'));
  assert.equal(api.sends.length, 0);
});
test('bounded search exposes coverage and cursor without skipping unscanned matches', async t => {
  const { service, api } = fixture(t);
  api.history = Array.from({ length: 150 }, (_, i) => msg(String(200000000000000500n - BigInt(i)), 'ALPHA'));
  const first = await service.search(U, C, 'alpha', 150);
  assert.equal(first.scanned, 20); assert.equal(first.matches.length, 20);
  const second = await service.search(U, C, 'alpha', 150, first.next_before!);
  assert.notEqual(first.matches[19]!.id, second.matches[0]!.id);
  const none = await service.search(U, C, 'absent', 120);
  assert.equal(none.scanned, 120); assert.equal(none.exhausted, false);
});
test('posting is attributed, audited and respects timeout, slowmode and read-only configuration', async t => {
  const { service, api, config, store } = fixture(t);
  api.members.get(U)!.communication_disabled_until = new Date(Date.now() + 60000).toISOString();
  await assert.rejects(service.send(U, C, 'test'));
  api.members.get(U)!.communication_disabled_until = null;
  await service.send(U, C, 'hello');
  assert.match(api.sends[0]!.content, new RegExp(U));
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE result='success'").get()!.n, 1);
  await assert.rejects(service.send(U, C, 'too fast'));
  config.enableSend = false; await assert.rejects(service.send(U, PRIVATE, 'disabled'));
});

const F = '100000000000000010', T = '100000000000000011', T2 = '100000000000000012';
function forumFixture(t: test.TestContext) {
  const f = fixture(t);
  f.api.channelList.push({ id: F, guild_id: G, type: 15, name: 'アイデア', permission_overwrites: [] } as any);
  const post = (id: string, parent = F, type = 11) => ({ id, guild_id: G, type, parent_id: parent, name: '案', thread_metadata: { archived: false, archive_timestamp: '2026-10-10T01:00:00Z' } }) as any;
  f.api.channelList.push(post(T), post(T2));
  f.api.threadList = [post(T), post(T2), post(PRIVATE, F, 12), post(C, PRIVATE), { ...post(OTHER), guild_id: OTHER }];
  return { ...f, post };
}

test('forum posts paginate without exposing other parents, guilds or private threads', async t => {
  const { service } = forumFixture(t);
  assert.ok((await service.list(U)).some(c => c.id === F));
  const first = await service.listPosts(U, F, false, 1);
  assert.deepEqual(first.posts.map(p => p.id), [T2]);
  assert.equal(first.next_offset, 1);
  const second = await service.listPosts(U, F, false, 1, undefined, first.next_offset!);
  assert.deepEqual(second.posts.map(p => p.id), [T]);
  assert.equal(second.has_more, false);
});

test('forum read and search inherit parent permissions and reject write operations', async t => {
  const { service, api, config } = forumFixture(t);
  await service.read(U, T, 1);
  assert.equal((await service.search(U, T, 'alpha', 20)).matches.length, 1);
  await assert.rejects(service.send(U, T, 'reply'));
  await assert.rejects(service.send(U, F, 'new post'));
  assert.equal(api.sends.length, 0);
  config.allowedChannels = [T];
  await assert.rejects(service.read(U, T, 1));
  config.allowedChannels = [F];
  await service.read(U, T, 1);
  for (const id of [U, B]) {
    api.channelList.find(c => c.id === F)!.permission_overwrites = [{ id, type: 1, deny: String(P.ReadMessageHistory), allow: '0' }];
    const previous = api.reads.length;
    await assert.rejects(service.read(U, T, 1));
    await assert.rejects(service.listPosts(U, F, false, 20));
    assert.equal(api.reads.length, previous);
    assert.ok(!(await service.list(U)).some(c => c.id === F));
  }
});

test('forum starter is available separately from recent replies and may be deleted', async t => {
  const { service, api } = forumFixture(t);
  api.history = [msg('200000000000000001', 'reply', T), msg(T, 'original body', T)];
  const result = await service.readPost(U, T, 1);
  assert.equal(result.starter!.content, 'original body');
  assert.equal(result.messages[0]!.content, 'reply');
  const older = await service.readPost(U, T, 1, result.next_before!);
  assert.equal(older.messages[0]!.id, T);
  api.history.pop();
  assert.equal((await service.readPost(U, T, 1)).starter, null);
  await assert.rejects(service.readPost(U, C, 1));
  await assert.rejects(service.readPost(U, F, 1));
});

test('archived forum posts expose timestamp cursor and validate parent guild', async t => {
  const { service, api, post } = forumFixture(t);
  api.archivedList = [post(T2), { ...post(T), thread_metadata: { archived: true, archive_timestamp: '2026-10-09T01:00:00Z' } }];
  const first = await service.listPosts(U, F, true, 1);
  assert.equal(first.next_before, '2026-10-10T01:00:00Z');
  const second = await service.listPosts(U, F, true, 1, first.next_before!);
  assert.equal(second.posts[0]!.id, T);
  assert.equal(second.has_more, false);
  api.channelList.find(c => c.id === F)!.guild_id = OTHER;
  await assert.rejects(service.read(U, T, 1));
  await assert.rejects(service.listPosts(U, F, true, 1));
});
