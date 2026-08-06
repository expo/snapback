import { defineEphemeral, defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
import { fixturePresence } from './surface-model.mjs';

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
      fixturePresence,
    }),
  },
);
