# LLP maintenance audit — Chat / Convex arm

**Intent:** pre-pr
**Scope:** `demos/backend-bakeoff/arms/chat/convex/`
**Mode:** propose-only; no LLP, status, ref, diary, or report edit applied

## Findings

- Deterministic reference/metadata check: `ref-check: ok — 103 LLP docs,
  2179 refs in 2952 files, 0 errors, 0 unchecked`.
- The arm conforms to LLP 0102's frozen Chat scenario ids, expected check
  count, native-provider rule, performance repetitions, failed-attempt
  retention, target identity, and exact cleanup requirements. The capsule
  verifier passes.
- No existing `@ref` in the arm became broken, stale, orphaned, superseded, or
  tombstoned.
- No Snapback subsystem implementation was changed. The provider-specific demo
  and evidence harness do not introduce a new Snapback design decision that
  requires a corpus status or design update.
- The diary entry is a coordinator-owned shared artifact. This worker produced
  `diary-entry-draft.md` and did not edit the frozen diary prefix.
- The original CHAT-12 Stop candidate is preserved and explicitly reconciled
  as a harness false positive. The corrected acceptance does not weaken LLP
  0102's Stop boundary.

## Proposals

- No LLP content or status change proposed.
- During serialized integration, append the diary draft to the Chat bakeoff
  diary and retain the raw logout erratum exactly as written.
- The coordinator should rerun the full Stage 0 verifier in the primary
  checkout, where the five coordinator-owned frozen diary files exist. This
  isolated worker checkout passed all 29 underlying protocol tests but cannot
  validate missing shared diary prefixes.
