import type { APIGuildMember, APIRole, APIOverwrite } from 'discord-api-types/v10';
import { PermissionFlagsBits as P } from 'discord-api-types/v10';
export { P };
export function permissionsFor(guildId: string, ownerId: string, member: APIGuildMember, roles: APIRole[], overwrites: APIOverwrite[] = []): bigint {
  const everyone = roles.find(r => r.id === guildId);
  if (!everyone || !member.user) return 0n;
  let bits = BigInt(everyone.permissions);
  for (const r of roles) if (member.roles.includes(r.id)) bits |= BigInt(r.permissions);
  if (member.user.id === ownerId || (bits & P.Administrator)) return (1n << 64n) - 1n;
  const apply = (deny: bigint, allow: bigint) => { bits = (bits & ~deny) | allow; };
  const base = overwrites.find(o => o.type === 0 && o.id === guildId);
  if (base) apply(BigInt(base.deny), BigInt(base.allow));
  let deny = 0n, allow = 0n;
  for (const o of overwrites) if (o.type === 0 && member.roles.includes(o.id)) { deny |= BigInt(o.deny); allow |= BigInt(o.allow); }
  apply(deny, allow);
  const personal = overwrites.find(o => o.type === 1 && o.id === member.user.id);
  if (personal) apply(BigInt(personal.deny), BigInt(personal.allow));
  return bits;
}
export const has = (bits: bigint, required: bigint) => (bits & required) === required;
