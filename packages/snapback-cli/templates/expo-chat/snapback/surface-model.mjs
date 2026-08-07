import { allow, ephemeral, v } from '@expo/snapback-codegen/define';

// Typing presence is ephemeral state: it never touches the durable tables and
// expires on its own lease. Connection/session authority owns presence
// identity; the authored payload is only non-authoritative display copy.
export const typing = ephemeral.collection({
  scope: { conversationId: v.id('conversations') },
  routing: ['conversationId'],
  key: 'connection',
  ttlMs: 4_000,
  maxTtlMs: 8_000,
  maxValueBytes: 128,
  publishRate: { sustainedHz: 4, burst: 8 },
  delivery: { mode: 'latest', dispatchMs: 80 },
  value: v.object({ displayName: v.string() }),
  publish: allow.all(),
  subscribe: allow.all(),
});
