# LLP maintenance audit — Chat / Firebase arm

Intent: `audit` (propose-only)
Scope: `demos/backend-bakeoff/arms/chat/firebase/` plus the governing
LLP 0102 and LLP 0016 diary boundary.

## Deterministic result

- `./ref-check --verbose`: OK — 103 LLP documents, 2,179 refs in 2,954
  files, 0 errors, 0 unchecked.
- The backend-bakeoff Node test suite passed all 29 tests. The chained Stage 0
  verifier then failed only because this intentionally isolated worker
  worktree does not contain the five shared diary files; workers were forbidden
  to edit/copy those shared files. Re-run Stage 0 from the coordinator tree
  after serialized integration.

## Findings and proposals

1. **No LLP drift found in this arm.** The implementation preserves
   LLP 0102's provider-native rule, exact 15-scenario manifest, direct
   authority/transport evidence, failed attempts, frozen commit, exact cleanup,
   and explicit hosted nonclaim. No LLP status or content change is proposed.
2. **No `@ref` repair is proposed.** Arm-local Firebase source has no existing
   `@ref`; it is a provider fixture rather than Snapback subsystem
   implementation. Adding mechanical LLP comments to every harness file would
   not tell a reader anything the arm path and capsule do not already say.
3. **Integrate the diary draft serially.** Append
   `diary-entry-draft.md` to the shared Chat diary without rewriting its frozen
   prefix (LLP 0102#diary-protocol; LLP 0016#demo-implications).
4. **Preserve the timing caveat.** The final harness monotonic timings are
   direct, but the first provider-command timestamp was reconstructed rather
   than persisted. Do not upgrade end-to-end authoring-timing confidence in the
   shared report.
5. **Preserve the hosted evidence boundary.** Local identity and cleanup are
   direct; hosted deployment, region, operations, cost, and production
   performance remain unavailable-credential evidence and must not be inferred
   from emulators.
6. **No Guide-gap ticket is proposed.** This worker used Firebase official
   docs and did not build on Snapback. Firebase documentation friction belongs
   in the comparative diary, not Snapback's Guide issue queue.

Hand-off: coordinator `llp-maintain` pre-land audit after merging the arm and
appending the shared diary.
