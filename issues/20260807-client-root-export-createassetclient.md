# createAssetClient declared in root .d.mts but not exported by root .mjs

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 5
**Confidence:** 5
**Systems:** Client packages, Types
**Date:** 2026-08-07
**Related:** Diary 0068 (four-lane measurement, 0.1.13)

`@expo/snapback-client`'s root type declarations declare
`createAssetClient`, but the root `.mjs` does not export it — consumers get
a runtime undefined that the types said exists (the exact "typecheck lies"
class LLP 0186 flags as maximally expensive for agents). The subpath
`@expo/snapback-client/assets` works. Export it from the root or remove the
root declaration; add the export-parity check to whatever test pins
type/runtime export agreement.

- **Claimed 2026-08-08:** session 86767887 (the diary-0068 orchestrator) is executing this ticket now; sibling sessions should not duplicate.
