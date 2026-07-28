import {
  allow,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
  v,
} from '@snapback/codegen/define';

const valueTable = () => defineTable({ value: v.string() }).sync();

export default defineSchema(
  {
    liveRows: defineTable({ body: v.string() }).sync(),
    primaryRows: valueTable(),
    activityRows: valueTable(),
    rejectionRows: valueTable(),
  },
  {
    ephemeral: defineEphemeral({
      fixturePresence: ephemeral.collection({
        scope: { roomId: v.string() },
        routing: ['roomId'],
        key: 'connection',
        ttlMs: 5_000,
        maxTtlMs: 30_000,
        value: v.object({ state: v.string() }),
        publish: allow.all(),
        subscribe: allow.all(),
      }),
    }),
  },
);
