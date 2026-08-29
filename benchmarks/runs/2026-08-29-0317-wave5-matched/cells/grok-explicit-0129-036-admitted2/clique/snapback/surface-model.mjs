import { allow, ephemeral, v } from '@expo/snapback-codegen/define';

export const typing = ephemeral.collection({
  scope: { chatId: v.id('chats') },
  routing: ['chatId'],
  key: 'connection',
  ttlMs: 3_500,
  maxTtlMs: 4_800,
  maxValueBytes: 128,
  publishRate: { sustainedHz: 4, burst: 8 },
  delivery: { mode: 'latest', dispatchMs: 80 },
  value: v.object({ displayName: v.string() }),
  publish: allow.all(),
  subscribe: allow.all(),
});
