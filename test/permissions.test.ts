import test from 'node:test';
import assert from 'node:assert/strict';
import { P, permissionsFor, has } from '../src/permissions.js';
import { G, U, R, role, member } from './helpers.js';
const owner = '100000000000000099';
test('member overwrite takes precedence over everyone and roles', () => {
  const roles = [role(G, P.ViewChannel), role(R, P.SendMessages)];
  const p = permissionsFor(G, owner, member(), roles, [
    { id: G, type: 0, deny: String(P.ViewChannel), allow: '0' },
    { id: R, type: 0, deny: '0', allow: String(P.ViewChannel) },
    { id: U, type: 1, deny: String(P.SendMessages), allow: '0' },
  ]);
  assert.ok(has(p, P.ViewChannel)); assert.ok(!has(p, P.SendMessages));
});
test('aggregated role allows win over other role denies', () => {
  const p = permissionsFor(G, owner, member(U, [R, U]), [role(G, 0n)], [
    { id: R, type: 0, deny: String(P.ViewChannel), allow: '0' },
    { id: U, type: 0, deny: '0', allow: String(P.ViewChannel) },
  ]);
  assert.ok(has(p, P.ViewChannel));
});
test('administrator and owner bypass channel overwrites; missing everyone fails closed', () => {
  const overwrite = [{ id: G, type: 0 as const, deny: String(P.ViewChannel), allow: '0' }];
  assert.ok(has(permissionsFor(G, owner, member(), [role(G, P.Administrator)], overwrite), P.ViewChannel));
  assert.ok(has(permissionsFor(G, U, member(), [role(G, 0n)], overwrite), P.ViewChannel));
  assert.equal(permissionsFor(G, U, member(), [], overwrite), 0n);
});
