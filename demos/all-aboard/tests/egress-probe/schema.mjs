// Minimal schema for the Phase 3 egress-seam probe fixture (not part of the demo
// product surface). One dummy table so the manifest is valid.
import { defineSchema, defineTable, v } from '../../../_kit/define.mjs';

export default defineSchema({
  probe: defineTable({ note: v.string() }),
});
