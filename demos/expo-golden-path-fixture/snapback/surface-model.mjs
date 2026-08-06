import { allow, ephemeral, v } from '../../_kit/define.mjs';

// @ref LLP 0179#react-projection — typing contains presence facts only. The
// connection/session adopted by the provider owns self identity; userId is
// deliberately absent from the publish payload.
export const typing = ephemeral.collection({
  scope: { conversationId: v.id('conversations') },
  routing: ['conversationId'],
  key: 'connection',
  ttlMs: 4_000,
  maxTtlMs: 8_000,
  maxValueBytes: 64,
  publishRate: { sustainedHz: 4, burst: 8 },
  delivery: { mode: 'latest', dispatchMs: 80 },
  value: v.object({}),
  publish: allow.all(),
  subscribe: allow.all(),
});
