import { allow, ephemeral, v } from '@expo/snapback-codegen/define';

export const fixturePresence = ephemeral.collection({
  scope: { roomId: v.string() },
  routing: ['roomId'],
  key: 'connection',
  ttlMs: 5_000,
  maxTtlMs: 30_000,
  value: v.object({ state: v.string() }),
  publish: allow.all(),
  subscribe: allow.all(),
});
