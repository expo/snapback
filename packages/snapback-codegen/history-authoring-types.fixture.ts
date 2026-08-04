import {
  defineTable,
  v,
  type HistoryRetentionSpec,
} from '@expo/snapback-codegen/define';

const policy: HistoryRetentionSpec = {
  retainMs: 60_000,
  maxVersionsPerRecord: 12,
};

defineTable({ title: v.string() }).history(policy).sync();

// @ts-expect-error maxVersionsPerRecord is mandatory schema authority
defineTable({ title: v.string() }).history({ retainMs: 60_000 });

defineTable({ title: v.string() }).history({
  retainMs: 60_000,
  maxVersionsPerRecord: 12,
  // @ts-expect-error the history declaration is a closed typed object
  unbounded: true,
});
