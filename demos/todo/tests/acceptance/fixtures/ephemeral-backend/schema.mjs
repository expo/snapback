import {
  allow,
  defineEphemeral,
  defineSchema,
  ephemeral,
  v,
} from '../../../../../_kit/define.mjs';

export default defineSchema({}, {
  ephemeral: defineEphemeral({
    boardCursors: ephemeral.collection({
      scope: { boardId: v.string() },
      routing: ['boardId'],
      key: 'connection',
      ttlMs: 5_000,
      maxTtlMs: 30_000,
      maxValueBytes: 1_024,
      publishRate: { sustainedHz: 20, burst: 8 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({
        x: v.number(),
        y: v.number(),
        color: v.optional(v.string()),
      }),
      publish: allow.roomPermission('boardMember'),
      subscribe: allow.roomPermission('boardMember'),
    }),
  }),
});
