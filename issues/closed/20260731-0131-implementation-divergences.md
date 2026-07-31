# LLP 0131 implementation divergences: one delta pass owed

**Status:** Resolved
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Severity:** P1
**Systems:** Application data API, Search, Code generation, Manifest,
Diagnostics, Documentation
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-31
**Related:** LLP 0131, LLP 0073, LLP 0070,
issues/20260730-move1-structured-args-and-search-ast.md
**Marker:** parity-moves, move-1

The wave-1 lane C6 implementation of LLP 0131 landed on main
(`4ca67710`..`2bd3c4f9`, 2026-07-31) with all suites green, the
served signal-desk evidence 4/4, and the acceptance-12 benchmark
admitting the 1 MiB ceiling (p95 scalar 541 ns; 64 KiB depth-8
structured 571 µs; ~1 MiB 703 µs). The implementer recorded nine
divergences/observations against the Accepted v0.4 Spec. LLP 0131 is
Accepted, so these land as one dated amendment/delta pass over the
Spec — recording what the code actually does where it departs, and
making the two genuine rulings — rather than silent drift.

1. **Rust search grammar narrowed** (`op` → eq-only enum, `value` →
   scalar union): not Spec-mandated, but carrier agreement was
   impossible without it — the published typings were narrower than
   the deserialization grammar. Accepted-query set unchanged
   (non-eq/non-scalar were already refused semantically); the refusal
   moved to parse time under the same public code. Ruling needed:
   bless the narrowing (recommended) or widen the published typings.
2. **Explicit-null optionals:** schemars encodes `Option<T>` as
   `type:["T","null"]` not-required, so serde and the exported schema
   admit `"field": null`, but derived TS and the published typings
   spell `field?: T`, rejecting explicit null. The implementation
   codified a canonical-form projection (optional+nullable → optional
   non-null) in `search-request-schema.mjs`; the corpus deliberately
   carries no explicit-null fixture because the carriers genuinely
   disagree there. This is the one item the implementer flagged as
   NEEDS A SPEC RULING.
3. **`allowExtra` gate location:** the Spec says the manifest schema
   gate refuses `true`; the generated JSON Schema shares
   `ResultValueContract` nodes and cannot express a lane-conditional
   constraint, so the refusal is enforced at manifest load (args
   lane) instead — same fail-closed effect, different mechanism.
   Record in the Spec.
4. **Minted code not in the Spec's table:**
   `SNAPBACK_FUNCTION_ARGS_CONTRACT_INVALID` covers args-lane
   structural defects the table does not enumerate (duplicate/empty
   entry names, `allowExtra:true`, missing-hash-beside-descriptor
   pairing). Registered in the server 4xx inventory. Fold into the
   Spec's table or rename.
5. **"v2 hash without descriptor" unenforceable:** v1 and v2 hashes
   are both bare `sha256:hex` on the wire and a legacy manifest (v1
   hash, no descriptor) must keep loading, so the reverse-pairing
   refusal cannot be distinguished from legacy without a generation
   marker. Descriptor-present pairing is fully enforced. Narrow the
   Spec's claim.
6. **Replay lane 3 / acceptance 14:** no `ctx.jobs`/durable-jobs
   surface existed on the branch base, so the enqueue-side successor
   validation has no code target yet; the seam function is ready for
   the jobs lane (C2 / LLP 0070) to call. Verify the wire-up when C2
   lands, then evidence acceptance 14. **RE-CHECKED at C2's landing
   (2026-07-31, `804782a1`): DONE.** `admit_job_enqueues`
   (src/local.rs) calls `validate_function_args` per enqueue,
   pre-commit, inside the producing mutation's transaction;
   violations refuse with the existing per-lane code and no job row
   or partial write; contract-less callees keep legacy behavior.
   Pinned by `enqueue_validates_callee_args_contract_transactionally`
   (violating, conforming, and legacy-callee legs). Only items 1–5,
   7, and 9 remain for the delta pass.
7. **Acceptance rows partially evidenced:** row 8's at-bound/one-over
   matrix is covered ad hoc, not exhaustively; row 9's
   hosted-evaluator leg is inherited-by-construction (the seam runs
   host-side before evaluator dispatch), not fixture-proven per
   lane; row 13's per-lane pinned fixture table exists only as unit
   tests. Either add the fixtures or record the weaker evidence
   shape in the Spec's acceptance table.
8. **Residue, tracked not owed here:** committed demo surface dist
   bundles still embed the pre-v2 client with the old uncoded pin
   (they regenerate through the surface-build lane); the
   packaged-runtime comparator leg is environment-gated in fresh
   worktrees (pre-existing); the lockstep `@snapback/client` publish
   is a release-lane action (rides the SD-6 scope migration,
   issues/20260731-sd6-scope-migration-and-rebuild.md); Cloudflare
   advertises neither `result_contract_v1` nor `args_contract_v1`
   (unchanged posture).
9. **Cite refresh:** LLP 0131's code cites (line numbers) drifted
   when the branch landed; the delta pass refreshes them.

Exit. One dated LLP 0131 amendment lands recording items 1–5 and 7
(with the explicit-null ruling made), item 9's cites refreshed; item
6 is re-checked at C2's landing and acceptance 14 evidenced or
explicitly deferred. Item 8 needs no action here.

## Resolution (2026-07-31)

Executed as "Amendment (2026-07-31): implementation record and
rulings" in llp/0131-structured-argument-contracts.spec.md (new
Revised entry stacked; Status stays Accepted):

- **Item 1 — resolved.** Recorded; ruling made: the narrowing is
  **blessed** (`op` eq-only enum, `value` scalar union,
  src/search/types.rs:181–199) — carrier agreement required it, the
  accepted-query set is unchanged, the refusal moved to parse time
  under the same public code.
- **Item 2 — resolved.** Recorded; ruling made: the canonical-form
  projection (optional+nullable → optional non-null,
  packages/snapback-codegen/search-request-schema.mjs:22–26) is the
  Spec's; explicit null is outside the cross-carrier agreed set and
  the corpus deliberately carries no explicit-null fixture; a future
  widening needs its own dated amendment with fixtures on every
  carrier.
- **Item 3 — resolved.** Mechanism recorded: refusal at manifest load
  in the args lane (src/manifest.rs:1490–1498 via
  `ContractLane::Args`), not in the shared JSON Schema, which cannot
  express the lane-conditional constraint.
- **Item 4 — resolved.** Folded into the Spec's code table with its
  actual coverage (empty/duplicate entry names, `allowExtra: true`;
  minted manifest.rs:1196–1205; 4xx at src/server.rs:21866; inventory
  at server.rs:34975). One correction to this ticket's own record:
  missing-hash-beside-descriptor pairing refuses under
  `SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID` (manifest.rs:1581–1591),
  not under the new code as the item above states.
- **Item 5 — resolved.** Claim narrowed in the amendment:
  descriptor-present pairing fully enforced
  (manifest.rs:1581–1604); v2-hash-without-descriptor is
  indistinguishable from a legacy v1 manifest without a generation
  marker and loads as legacy (manifest.rs:1559–1563).
- **Item 7 — resolved.** Weaker evidence shapes recorded beside the
  acceptance rows (row 8 ad hoc, row 9 hosted leg
  inherited-by-construction, row 13 unit tests), plus row 12's
  admitted benchmark and row 14's C2 evidence (src/local.rs:1712 and
  1756; test src/server.rs:36546).
- **Item 9 — resolved.** Twelve present-tense cites refreshed in
  place against the current tree; baseline cites left as the recorded
  pre-implementation ground and mapped to their landed replacements
  in the amendment; acceptance 14's evidence recorded in the
  amendment's row-14 entry.

Items 6 (closed at C2's landing, above) and 8 (tracked residue owed
elsewhere) needed no further action. This ticket can move to
issues/closed/.
