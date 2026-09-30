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
