import { allow, ephemeral, v } from '@expo/snapback-codegen/define';

export const typing = ephemeral.collection({
  scope: { conversationKey: v.string() },
  routing: ['conversationKey'],
  key: 'connection',
  ttlMs: 4_500,
  maxTtlMs: 5_000,
  maxValueBytes: 160,
  publishRate: { sustainedHz: 4, burst: 8 },
  delivery: { mode: 'latest', dispatchMs: 80 },
  value: v.object({ displayName: v.string(), handle: v.string() }),
  publish: allow.all(),
  subscribe: allow.all(),
});
