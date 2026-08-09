# Review: derived-fork requalification custody-binding delta, commit 04332ab8b

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-09
**Reviewed commit (candidate C):**
`04332ab8b73799bd3279b3150dbd8598df275530`
**Implementation tree SHA-256 (v3 scoped):**
`sha256:42d8fdccbe42ed3699da014f1c3ec68aa8fd05ca99de423310b6a6885190708f`
**Digest version:** `snapback:agent-safe-implementation-tree:v3` (scope
unchanged)

**Method:** declared **delta round** on my prior READY heads (through
`866f5d025`, where I filed F-1 Low — the prose-only custody gap the codex
family sharpened into its NOT READY). No codex review was read. I read the
binding commit (`04332ab8b`) in full, enumerated the `866f5d025..04332ab8b`
scoped delta (two commits), and attacked the mechanical binding along the
three commissioned axes plus my own.

**Execution evidence produced in this worktree:** digest recomputed with
this C's own checker = `sha256:42d8fdcc…708f`, matching the commission
exactly; checker unit suite **104/104 pass** (was 101; +2 custody
negatives, +1 real-HEAD positive split out); all three sibling conformance
suites exit 0 (`local-persistent-store-publication-v1`,
`relation-activity-publication-v1`, `sequence-allocation-publication-v1`);
clean-tree checker run exits 0 with both records `withheld`.

**Reliance statement.** The binding commit touches zero Rust; the one fleet
commit does. All Rust execution relies on supervisor-supplied evidence at
exactly `04332ab8b`.

---

## 1. The mechanical binding — meets the coverage-moves-never-vanishes bar

The concern was legitimate and my F-1 understated it: at `866f5d025` the
four-gate custody transfer existed only in an @ref comment and one
selection-pin test; nothing required the gates to exist *at C* with their
reviewed definitions. `04332ab8b` closes it with the same machinery that
already guards the nine departing wave transfers:

- **Frozen definitions in-checker.** `DERIVED_FORK_ADMITTED_COVERAGE_GATES`
  gains full reviewed copies of all four sibling gates
  (`local-store-publication`, `local-store-carrier-receipt`,
  `relation-activity-publication`, `sequence-allocation-publication`):
  records, recordPaths, complete triggerRules (files + prefixes), and
  regenerateCommand. The checker file is inside the digest scope, so
  editing the frozen copies rotates the claim digest.
- **Same C-bound read.** `assertSiblingChainCustodyTransfers` runs inside
  `validateDerivedForkCoverageTransfers`, consuming the **same parsed
  policy object** as the wave-transfer validation — the bytes of
  `scripts/local-proof-selection-policy.v1.json` read at qualification C
  via git and verified against the receipt's `selectionPolicySha256`
  content pin (F1 custody, untouched). Not a second, divergent read. The
  retained ignores-post-C-working-tree fixture proves live policy
  divergence stays inert.
- **Exact-set coupling.** The transfer ledger's paths must set-equal
  `DERIVED_FORK_SIBLING_CHAIN_PATHS` — the very list that classifies
  sibling evolution into `requalificationDue`. The evolution class cannot
  be widened without a custody row; both constants are in-checker and
  in-digest ("sibling custody moved without a frozen-record gate" refusal
  names missing/extra).
- **Per-path trigger coverage + per-gate exact admission.** Each transfer
  requires `gateTriggerMatchesPath` (files/prefixes/suffixes — same rule
  shapes the live selector applies) against the C policy's metadata; each
  of the four gates must additionally pass `admittedCoverageGateAtCommit`:
  present in the C policy, **canonically equal** to the frozen admitted
  copy, and its record paths present as regular blobs at C. The
  carrier-receipt gate is enforced as a required chain owner even without
  a direct path row.

**Silent-drift attack, both directions, refused.** (a) Post-C live policy
evolution: inert by the C-pin — cannot alter the verdict, cannot erode
custody retroactively; post-C continuity remains battery-owned, the
layering already accepted in my final round. (b) Frozen-vs-real drift at a
future C: a policy whose gate definition differs from the frozen copy in
*any* way fails canonical equality, forcing a same-change checker update
that rotates the digest into requalification. (c) Coordinated erosion —
frozen copy *and* policy both edited to drop a sibling trigger — still
refuses at the per-transfer trigger check, because the transfer rows and
path list are independent in-scope constants; coverage genuinely cannot
vanish short of editing the reviewed transfer ledger itself, which is the
digest-rotating, review-visible act the design demands.

**The negatives bite.** I verified the mutations are real: the missing-gate
negative deletes each of the four gates from the fixture's C-committed
policy and asserts refusal through the full `validatePublicationRecord`
(exercising both refusal arms — transfer-uncovered for direct owners,
exact-definition for the receipt chain owner, gate name asserted in the
message). The trigger-removal negative strips exactly the mapped path from
the gate's `files` — and the remaining prefixes (`src/storage/`,
`scripts/finalize-…`) do not cover the `src/*.json` paths, so the match
genuinely fails rather than falling through to a prefix. The real-HEAD
positive runs the full C-bound validation against the actual repository
policy at HEAD, proving the frozen copies are accurate captures of the
live registry with record blobs present — not aspirational prose.

## 2. F-1 closed

The gate-selection pin test now iterates **all four**
`DERIVED_FORK_SIBLING_CUSTODY_TRANSFERS` rows against the real selector
(`selectDriftProneGates` + `loadSelectionContext`), asserting each path
selects its owning gate — exactly the three-line extension F-1 asked for,
plus the C-bound admission it did not. Closed.

## 3. The scoped fleet delta

Two scoped commits. Besides the binding commit, only `96d50a742` (0199
owner #2 slice 2): the asset-maintenance typed-facade extraction —
mechanical `self.db.X` → `self.db.asset_maintenance().X` delegation moving
~559 lines from `src/local.rs` into `src/storage/asset_maintenance.rs`,
same pattern as the reviewed jobs facade. `instance_fork.rs`,
`fork_promotion.rs`, `write_authority.rs`, `instance_lock.rs`, and
`src/cli/fork.rs` have **empty diffs**; both fail-closed
`for_derived_host_op` dispatch sites verified present
(`src/local.rs:3271`, `src/server.rs:1412`). The four carrier deltas in
the range are pure digest re-pins for the touched sources (`local.rs`,
`storage.rs`) plus the anchor's recomputed `carrierSha256` — the
digest-only refresh class, co-rotated with their byte-pinned gates, and
all three conformance suites pass at this C. No claim invariant touched.

## Note (non-blocking)

The trigger-removal negative's bite depends on no prefix rule covering
`src/` — true of the current definitions and self-correcting (any prefix
addition is itself a definitional change failing canonical equality), so I
record it as an observation, not a finding. Carried R3-1/R3-2/R3-3 and
closing-round N-2 remain open and unchanged.

---

## Verdict

The codex objection was correct and this is the right closure: the custody
transfer my previous round accepted on prose and one pin test is now a
claim-scoped ledger enforced at qualification C by the same
exact-admission machinery as the wave transfers — frozen reviewed
definitions, C-pinned policy read, exact path-set coupling to the
evolution classifier, per-path trigger coverage, per-gate canonical
equality with blob presence — with negatives that demonstrably bite and a
real-HEAD positive proving the frozen copies are true. My F-1 is closed
stronger than filed. The fleet delta is one mechanical facade extraction
plus digest-only carrier re-pins. Digest exact; 104/104; conformance
suites green; clean-tree checker green. Conditional on supervisor-supplied
Rust execution evidence at exactly
`04332ab8b73799bd3279b3150dbd8598df275530`:

**Verdict: READY** — no blocking findings.
