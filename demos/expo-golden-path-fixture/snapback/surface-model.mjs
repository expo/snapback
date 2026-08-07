import { allow, ephemeral, v } from '../../_kit/define.mjs';

// @ref LLP 0179#react-projection — connection/session authority owns presence
// identity. The authored payload is only non-authoritative display copy.
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
