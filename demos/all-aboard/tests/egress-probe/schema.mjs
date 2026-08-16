// Minimal schema for the Phase 3 egress-seam probe fixture (not part of the demo
// product surface). `probe` keeps the manifest valid; `deliveries` receives the
// committed response of the 0137 a4-f1 end-to-end fetching-action witness.
import { defineSchema, defineTable, v } from '../../../_kit/define.mjs';

export default defineSchema({
  probe: defineTable({ note: v.string() }).visibility({ kind: 'public-read' }),
  deliveries: defineTable({ url: v.string(), body: v.string() })
    .visibility({ kind: 'public-read' }),
});
