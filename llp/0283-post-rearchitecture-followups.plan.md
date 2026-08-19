# LLP 0283: Post-rearchitecture follow-ups — what LLP 0276 left open

**Type:** Plan
**Status:** Draft
**Systems:** Project, Build, Security/authorization, Verification, Packaging
**Author:** Charlie Cheever / Claude (Opus 5, orchestrating codex gpt-5.6-sol + grok-4.6)
**Date:** 2026-08-19
**Revised:** 2026-08-19 (b — record follow-up dispatch: F-1 designed in
LLP 0285, F-2 specified in LLP 0284, F-4 fixed; author rulings of 2026-08-19)
**Related:** LLP 0276, LLP 0225, LLP 0189, LLP 0232, LLP 0041, LLP 0214, LLP 0264, LLP 0010,
LLP 0284 (F-2 threat model), LLP 0285 (F-1 closure design)

## Summary

LLP 0276's structural rearchitecture landed on `main` at `18cb34fab` — the single
563k-line crate is now a 13-crate Cargo workspace realizing LLP 0225's ownership
map physically. This plan records what is **not** finished, in priority order, so
the remaining work is picked up deliberately rather than rediscovered.

The headline: **the crate structure is real and enforced; the authorization model
is not.** Three privilege escalations survived two rounds of fixes, and the gates
that reported them closed were written by the same lane whose work they were
meant to constrain.

## What landed

| Property | State at `18cb34fab` |
| --- | --- |
| Workspace | 13 crates, 419 Rust modules under gate enforcement, 5 named membership exceptions |
| Ownership enforcement | `scripts/check-workspace-graph.mjs` over `cargo metadata`, fail-closed |
| Old enforcement arm | Retired: analyzer, `ownership.manifest.json`, `ownership.baseline.json`, ratchet |
| Ratchet worklist | All 13 items resolved with recorded resolutions, moved to `issues/closed/` |
| Layout | `targets/cloudflare/` moved (94 files); straggler gate at `epoch=phase-3`, 0 findings |
| Wire contracts | **Zero `schemas/` drift across all thirteen carves** |
| Gates green at cutover | workspace-graph, security-boundaries, kernel-raw-sql-api, cross-crate-path-includes, path-migration-stragglers, local-proof-gates, guide, ref-check, `cargo check --all-targets` |

Rollback point: tag `pre-0276-rearchitecture` at `c66d8ea6f`. History was never
rewritten; rollback is ordinary forward `revert` commits per LLP 0276.

**npm publication was deliberately NOT performed.** Published packages are
immutable (LLP 0041) and the runtime packages carry the sealed binary, so
publication must wait until F-1 below is closed.

## Status of this plan (revised 2026-08-19b)

| Item | State |
| --- | --- |
| F-1 | **Designed, not implemented — and now FOUR defects, not three.** Two independent blind designs commissioned; synthesized as **LLP 0285**. Author approved the two LLP 0225 ownership moves the closure requires. Implementation runs as its own reviewed program. Publication remains blocked. |
| F-2 | **Specified as LLP 0284**, independently authored by a model family that wrote neither the code nor the original gates. Gate rewrite in progress. |
| F-3 | Not started; blocked behind F-1. Battery maps to `scripts/verify-local-proof --complete` (36 gates, already covering cloudflare/admin/swift-client/native-runtime/guide) plus `scripts/cold-clone-check.sh` and the npm closure/cold-install witnesses. |
| F-4 | **Fixed.** `caught_denial_with_unrelated_failure_is_not_restored` triaged **pre-existing** (traced to `7437e6e07`; redaction landed in `a8787cb53`; reproduced at `pre-0276-rearchitecture`). The `auth_invocation_v1` refusal-precedence divergence was ruled a defect by the author and the JS-path ordering was fixed. Fixture drift repaired. |
| F-5 | Unchanged backlog; all three burn-down tickets exist under `issues/`. |
| F-6 | Unchanged; still correct to defer. |

**A FOURTH escalation was found** (defect 4 below) — forgeable privileged
membership writes, reachable from a shared borrow. It was surfaced by the blind
review of LLP 0285 and re-verified against the tree. Neither the original review
round nor either independent design caught it, which is itself evidence for
LLP 0283's own F-2 thesis: the checks were too weak to find what was there.

**Three further findings that make F-1 worse than described
below** (all verified against `ede899a20`, detailed in LLP 0285 §4):
`ResolvedAppAuthority` is a `pub` enum with `pub` variants, so
`ResolvedAppAuthority::System` is freely constructible; the comment at
`crates/snapback-engine/src/push.rs:27` asserts an invariant that is false in
both halves; and defect 3 spans **four** launderer crates and ~33 sites, not two.

Two F-2 evasions were also **proved empirically** with controls, rather than
left as assertions: a by-value `-> rusqlite::Connection` return planted in the
kernel passes `check-kernel-raw-sql-api` (rc=0), and
`#[path = r"..."]` (raw string) passes `check-cross-crate-path-includes` while
the identical plain-string spelling is caught.

## F-1 — The authorization model is not closed (BLOCKING publication)

Two independent blind reviewers found three privilege escalations after the
carve. Two rounds of fixes **moved** the escalation rather than closing it. The
third round (`7d8ffe524`) was reviewed and returned **BLOCK**. Current defects,
with evidence:

1. **The authority root is publicly claimable.** Any direct dependent can open a
   `LocalDatabase`, call public `claim_kernel_commit_authority()`
   (`crates/snapback-kernel/src/storage.rs:2158`), then call
   `admit_system_push()` (`push.rs:43`) or
   `admit_protected_record_erasure(...)` (`proof_checkpoint.rs:769`) with
   arbitrary strings, or mint and submit any pending-effect command
   (`storage/pending_effects.rs:210`). `snapback-auth` additionally re-exports
   the entire storage module publicly (`crates/snapback-auth/src/lib.rs:9`),
   reproducing the earlier non-façade attack. The registry provides take-once
   ordering, **not authorization**. The root and the erasure/push carriers are
   also `Clone`, contradicting the stated non-clonability requirement.

2. **Self-implementable capability traits became public arbitrary-closure
   factories.** A caller holding the claimable root can build
   `AuthorizationCommitReservation` and `PreparedAuthorizationCommit` from
   arbitrary callbacks (`storage.rs:745`), or construct a
   `ServiceAuthorityCommitInterlock` whose terminal always reports success
   (`auth/service_fence.rs:41,98`) and install it (`storage.rs:2294`). This is
   behaviorally equivalent to implementing the traits that were retired.

3. **A caller-selectable Cargo feature exposes writable raw SQLite above the
   kernel.** Any crate can enable `snapback-services/remainder-tests`, import
   `snapback_services::test_support::rusqlite::Connection`
   (`crates/snapback-services/src/lib.rs:38`,
   `crates/snapback-services/Cargo.toml:18`), open the canonical database, begin
   a transaction and commit. Cargo features are public and caller-controlled;
   `#[doc(hidden)]` and "intended for tests" provide no confinement.

4. **Privileged membership provenance is forgeable (added 2026-08-19b, revised
   2026-08-19c after a second independent review).** `MembershipWriter`
   (`crates/snapback-kernel/src/storage.rs:13520`) is a `pub` enum with `pub`
   variants; `plan_privileged_membership_insert` and `commit_membership_plan`
   are `pub` on the handles returned by `LocalDatabase::membership_plans()`
   (`storage.rs:1741`). The plan-time authority check is only
   `writer.is_privileged_noninvocation()`
   (`storage/membership_plans.rs:388`) — the caller-selected enum. Commit-time
   revalidation re-checks resource existence and protected-role eligibility but
   **does not re-derive the writer class**, and provenance is then recorded from
   the caller's own enum (`Admin` → `"hostOps:dataEdit"`, `storage.rs:13688`).

   This is an **Attacker C** defect, not an Attacker A one: because
   `LocalDatabase::memory()`/`open()` are themselves `pub`, obtaining write
   access was never the barrier. The defect is that a module inside an
   already-trusted crate can make the kernel **durably record an authority fact
   it never verified** — a membership row whose receipt lies about who
   authorized it. That is exactly the property LLP 0285 §3 identifies as the one
   that matters most. Missed by the original review round, by both independent
   designs, and mis-classified by the first draft of this entry. Closure design:
   LLP 0285 §5.4.

**Direction for the fix (do not repeat the previous three attempts).** Each
attempt narrowed *where* the capability could be obtained without removing the
ability to obtain it. The reviewers' converged guidance:

- Do not expose a universal claim/mint root across a crate boundary at all.
  Co-locate admission verification with the kernel operation, or require a
  kernel-verifiable **durable or cryptographic proof** rather than a caller
  projection of authority.
- Keep real fence implementations behind closed concrete types with **no public
  callback constructor**.
- Remove wholesale `pub use` of kernel storage from every crate.
- Remove `Clone`/`Default`/`Deserialize` from privilege-bearing roots and
  carriers unless duplicability is explicitly safe.
- Remove raw-SQL re-exports from feature-gated library APIs; put those tests in
  dedicated harness/integration crates with their own dev-dependency.

**Behavior was not regressed by the attempts.** The review explicitly confirmed
the moved scrub/mint transaction preserves audit queries and transactional SQL
statement order with no JOIN or read-shape change, and `schemas/` drift is zero.
The problem is surface, not semantics.

## F-2 — The security gates are weak, and were written by the implementer

This is the methodological finding, and it generalizes beyond this program.
Each gate was authored by the same lane whose work it was meant to constrain, so
it encoded that lane's assumptions instead of the threat model, and reported PASS
against live escalations.

- `check-security-boundaries` proves **six spellings, not closure**. All six
  fixtures attack the kernel's *old* APIs, so the new claim/mint root, the
  closure factories, the public feature, and clone/default/deserialize paths are
  invisible to it. `snapback-conformance` is named in metadata but is absent from
  actual dependencies. An unrelated compiler error containing the expected regex
  satisfies a fixture.
- `check-kernel-raw-sql-api` scans only kernel `pub fn` text and **passed despite
  finding 3**. A planted `pub fn leak() -> rusqlite::Connection` evades it,
  because a by-value return is unmatched. Re-exports, fields, aliases, traits,
  and other crates are outside its scan.
- `check-cross-crate-path-includes` is bypassed by
  `#[path = r"../../other/src/lib.rs"]` — a valid raw string Rust accepts and the
  regex misses. Symlinked sources are checked lexically, not by resolved target.

**Action:** rewrite these three gates from an independently-authored threat model,
by someone other than the implementer of the code they constrain. Derive the
crate inventory from workspace metadata and compare against actual dependency
keys; inspect rustdoc JSON or parsed Rust rather than text; assert diagnostic
spans point at the intended fixture expression; cover a feature matrix.

## F-3 — Verification the RFC requires but that never ran

LLP 0276 §"Phase 4" gates completion on a complete battery **plus cold-clone
witnesses** at the exact final commit. None of this ran against `18cb34fab`:

- the complete canonical proof inventory (LLP 0175 D2.3);
- a cold clone building and qualifying the Rust binary;
- an npm closure pack + install witness;
- a Cloudflare deploy dry-run;
- the Swift fixture run;
- an admin-ui build; a website docs-assembly.

A partial precedent exists and is worth reusing: during Phase 1 the workspace was
built and runtime-qualified from a **cold checkout** on a machine that had never
seen it (`SNAPBACK_IBEX_RUNTIME_LINK_OK`, handler-VM qualification passed), which
is the shape the Phase 4 witness needs.

## F-4 — Known test failures

- `caught_denial_with_unrelated_failure_is_not_restored` — surfaced by the final
  `cargo test --workspace` run; not yet attributed. **Triage first**: determine
  whether it is pre-existing or introduced by the hardening.
- Vector decimal halfway witness — pre-existing and unrelated;
  `issues/20260819-vector-decimal-halfway-witness.md`.
- `auth_invocation_v1` refusal-precedence — **RESOLVED 2026-08-19.** Author
  ruled "fix the ordering." The three JS generic-write sites now share
  `prepare_generic_write_target`, which runs the identity-binding seal, then
  permission-backing specialization, then generic write-policy resolution, so
  LLP 0214 §5.9's policy-independent refusal is no longer preempted and the JS
  and HostPlan paths agree. Original description follows.

- `auth_invocation_v1` refusal-precedence — a real product bug found when a
  36-hour compile hole was repaired. On the JS handler path `ctx.db.insert`
  resolves generic write policy before the identity-binding seal, so LLP 0214
  §5.9's policy-independent refusal is preempted; the HostPlan path orders it
  correctly, so the two paths disagree. **Needs an author ruling**: fix the
  ordering, or ratify current behavior and amend LLP 0214.
  `issues/20260817-auth-invocation-v1-write-policy-fixtures.md`.

## F-5 — Named exceptions with burn-down tickets

Three modules could not reach their assigned owner and are recorded as named
membership exceptions rather than silently misplaced:

- `schema-export-facade-integration` — `schema_export.rs` + `snapback-schemagen`;
  cross-rank schema aggregation still needs façade/server carriers.
- `telemetry-proof-private-composition` — `telemetry_bench.rs` + its binary.
- `fork-promotion-benchmark-composition` — build provenance comes from the façade
  build script.

## F-6 — Deferred by LLP 0276 D5 (unchanged, still correct to defer)

The `scripts/` regrouping, unifying the four test-inventory mechanisms, and the
release-family state machine remain post-window programs, each deserving its own
reviewed design.

## Method lessons worth keeping

1. **Capability downgrade is the dominant failure mode of a carve.** Inverting a
   call-up by introducing a port repeatedly turned a compiler-enforced invariant
   into an assertable one. If a port parameter represents authority, admission or
   a capability, its type must be opaque and unconstructable outside the
   authorizing adapter — never a public enum, a self-implementable trait, a
   public closure factory, or a claimable root.
2. **Rust's inherent-impl rule constrains owner-based carving.** An inherent
   `impl Type` must live in the crate defining `Type`, so a module cannot always
   follow its assigned owner. Measured: 26 conflicts, 22 first breaking at the
   *first* carve. See `issues/20260818-inherent-impl-blocks-owner-based-carves.md`.
3. **Do not let a lane write the gate that constrains it.** See F-2.
4. **Compile-first, repair-with-the-compiler works** for structure. The four
   god-file splits (manifest.rs 20.6k, local.rs 33.8k, runtime.rs, instance_fork.rs)
   completed in ~40 minutes in parallel against a carve-map estimate of 2–3 days
   for `manifest.rs` alone, by splitting in place with parent re-exports so no
   call site changed. It does **not** work for security surface, which has no
   compiler check.
5. **Zero `schemas/` drift is a strong, cheap invariant.** It caught a wire
   contract regression (dropped required fields on a public schema) that no other
   gate noticed.

## Sequencing

F-1 and F-2 together, by an author independent of the previous attempts, then
F-4's triage, then F-3's battery, and only then publication. F-5 and F-6 are
ordinary backlog.

**Revised sequencing (author ruling 2026-08-19).** F-4 and F-2's gate rewrite
land first, alongside F-1's design (LLP 0285); F-1's implementation then runs as
its own reviewed program, followed by F-3's battery and publication. The
independence requirement was met by commissioning the F-2 threat model and both
F-1 designs from authors that wrote neither the constrained code nor the
original gates.
