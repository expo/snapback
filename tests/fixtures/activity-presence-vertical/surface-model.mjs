import {
  allow,
  ephemeral,
  v,
} from '@expo/snapback-codegen/define';

export const typing = ephemeral.collection({
  scope: { roomId: v.string() },
  routing: ['roomId'],
  key: 'connection',
  ttlMs: 5_000,
  maxTtlMs: 5_000,
  maxValueBytes: 256,
  publishRate: { sustainedHz: 8, burst: 16 },
  delivery: { mode: 'latest', dispatchMs: 33 },
  value: v.object({
    userHandle: v.string(),
    name: v.string(),
  }),
  publish: allow.all(),
  subscribe: allow.all(),
});
