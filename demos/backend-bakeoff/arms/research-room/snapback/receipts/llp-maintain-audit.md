# LLP maintain pre-PR audit — Research Room / Snapback

- Intent: `pre-pr`
- Scope: `demos/backend-bakeoff/arms/research-room/snapback`
- Mode: propose-only; no shared LLP, guide, diary, report, or product source
  file was changed.
- Deterministic check: `./ref-check --verbose` passes with 2,226 references,
  zero errors, and zero unchecked references.
- Arm references: the authored schema points to LLP 0056's membership-table
  declaration and LLP 0076's settlement-and-retry contract. The generated
  Contract bindings retain their generator-owned LLP 0021 references.
- Drift review: the arm demonstrates a composition defect rather than changing
  product behavior. No governing LLP text should be revised to pretend the
  composition works.

## Proposals for coordinator review

1. File the supplied guide-gap draft as a repository issue: the sessions and
   bounded-streamed-action surfaces need an executable composition witness or
   an explicit composition GAP until fixed.
2. Clarify that `SNAPBACK_OUTBOUND_ACTIONS=1` is required for both generation
   and runtime, with commands shown side by side.
3. Reconcile the sessions startup capability preflight with the process-live
   capability facts used by ordinary runtime admission and `/inspect`.
4. Integrate the supplied diary-entry draft into the serialized shared diary.
5. Investigate the pre-existing Stage 0 freeze digest and artifact-inventory
   mismatch at source commit `5f31cb6174daaefa04a1e05242acbbc22c725040`;
   this worker did not alter the frozen protocol.

No LLP status change, retirement, or new design document is proposed by this
arm. If the capability-preflight repair introduces a new product-wide
composition rule rather than restoring the documented model, route that
decision through the normal LLP review process.
