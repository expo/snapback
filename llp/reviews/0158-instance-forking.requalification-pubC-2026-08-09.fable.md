# Review: derived-fork requalification publication delta, commit 866f5d025

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-09
**Reviewed commit (publication C):**
`866f5d025645ce20a9149d8ea20032bd2f31c9b0`
**Implementation tree SHA-256 (v3 scoped):**
`sha256:98aa92d6651e405fda750d84bd510c4db6fcccd29213b13bb0436607a39a06d0`
**Digest version:** `snapback:agent-safe-implementation-tree:v3` (scope
unchanged: roots `src`; files `.gitmodules`, `Cargo.lock`, `Cargo.toml`,
`build.rs`, `scripts/check-agent-safe-publication.mjs`,
`scripts/generated-artifact-policy.mjs`, `vendor/ibex`)

**Method:** declared **delta round** on my prior heads (rounds 1–3, final
`772c00649`, closing `7b590a169`, all READY). No codex review was read. I
read the decoupling commit (`866f5d025`) in full, enumerated all 16 scoped
fleet commits in `7b590a169..866f5d025` and reviewed their src deltas, and
attacked the custody transfer per my own closing-round N-1 standard. Node
checks executed here; Rust execution is supervisor-supplied.

**Execution evidence produced in this worktree:** digest recomputed with
this C's own checker = `sha256:98aa92d6…06d0`, matching the commission
exactly; checker unit suite **101/101 pass** (was 99; the two new tests are
this commit's sibling-regeneration-stands and own-gate-refuses fixtures);
clean-tree checker run exits 0 with both records `withheld`; all three
sibling conformance suites executed here and **exit 0**
(`tests/conformance/local-persistent-store-publication-v1.mjs`,
`relation-activity-publication-v1.mjs`,
`sequence-allocation-publication-v1.mjs`); and a live
`selectDriftProneGates` probe routes **each of the four sibling paths** to
its registered owner gate (anchor → `local-store-publication`, carrier →
`local-store-publication`, relation-activity →
`relation-activity-publication`, sequence-allocation →
`sequence-allocation-publication`).

**Reliance statement.** This commit touches zero Rust; the fleet delta does
touch Rust (jobs facade, server routes, CLI machine mode). All Rust
execution is outside this worktree's reach; my verdict relies on the
supervisor-supplied execution evidence at exactly `866f5d025` for claims of
that class.

---

## 1. The decoupling — N-1's defect, fixed at the root

My closing review's N-1 flagged the sibling carriers churning inside the
fork digest on unrelated cycles. The defect was in fact worse than the
noise I predicted, and this range contains its live proof: the god-file
split fix-forward (`fdb0d9b04`) **structurally re-keyed**
`executorSourceSha256` in all sibling carriers (e.g. `src/local.rs` →
seven `src/local/*.rs` entries). Under the old code a published fork would
have hard-refused on that landing twice over: (a)
`validateLocalStorePublicationTransform` ran for *every* published record
(the pre-image loop is visible in the diff), binding the store
carrier/anchor to the *fork's* C via a digest-only-substitution rule a
structural regeneration cannot satisfy; and (b) the store pair was
`PUBLICATION_CYCLE_ALLOWLIST`-excluded from the snapshot while remaining
*in* the digest (`implementationDigestAt` walks all scope entries with no
allowlist exclusion — verified), so even a legitimate digest-only carrier
refresh rotated P's digest with zero visible scoped change, tripping the
"none detected between C and P (receipt or digest scope is inconsistent)"
refusal. The fix makes classification consistent with the digest.

**Attack (1): can a tampered sibling carrier ride under a published fork
claim uncaught by its own gate? No.** Three layers, all verified here:

- **Visibility:** for the derived record only, `publicationCycleEvolutionPaths
  = DERIVED_FORK_SIBLING_CHAIN_PATHS` overrides the allowlist in
  `evaluateClaimSnapshot`, so post-C changes to all four files surface as
  scoped changes → typed `requalificationDue` naming each path, with the
  unconditional `PUBLISHED_REQUALIFICATION_DUE` warning. The new fixture
  proves a four-file structural regeneration leaves the claim `published`/
  `stands` with exactly those four `{status:'M', path}` entries and
  `since = C`. Never silent.
- **Trigger rules:** live probe (above) confirms all four paths select
  their registered owner gates — including the anchor, which the commit's
  own test does not cover (it pins only the carrier path).
- **Structural validation:** I read all three conformance checkers. Each
  byte-pins its carrier to a hard-coded sha256 inside the gate file
  (frozen-record co-rotation), recomputes `qualificationReceiptSha256`
  against live receipt bytes, and recomputes every
  executor/schema(/client) source digest against the actual files — so a
  tamper without co-rotating the gate refuses at the byte pin, and a
  co-rotated lie about source digests refuses at the drift assertions. The
  store checker additionally deep-equals the anchor with
  `carrierSha256: sha256(carrierBytes)` recomputed live. The commit's
  `spawnSync` test proves refusal end-to-end for a structurally tampered
  store carrier. Gate bypass on push remains the documented loud
  `SNAPBACK_DRIFT_GATES_BYPASS` + backstop-ticket model — pre-existing
  LLP 0175 custody, not weakened here.

**Attack (2): storage transform byte-identical? Yes.** For
`agent_safe_storage_v1` both call sites pass `allowRequalificationDue:
false` and `publicationCycleEvolutionPaths: []`; the filter reduces to
exactly the old predicate (`!allowlist.has(path) || false`), and
`validatePublishedResultCustody` invokes
`validateLocalStorePublicationTransform(root, result.commit)` with the
same arguments in the same runChecker position. New parameters default
everywhere else. All pre-existing transform fixtures (digest-only-exact,
extra-edit-refusal) pass unchanged in the 101.

**Attack (3): fork-chain integrity bindings survive.** The fork's own
anchor/carrier/receipt/evidence validation in `validatePublicationRecord`
is untouched by this commit; the tamper-with-due-pending fixture, evidence
byte bindings, C-ancestry, canonical-scope equality, selection-policy pin,
frozen prose, and withheld short-circuit all run in the green 101. The
only removed check is the store-transform-at-fork-C borrow, whose custody
demonstrably lands on the registered gates. Redundant inclusion of the two
non-allowlisted carriers in `DERIVED_FORK_SIBLING_CHAIN_PATHS` is a no-op
today and correct future-proofing if they are ever allowlisted.

The LLP 0189 D-4 amendment and the issue-file mechanics entry record the
author ruling (coverage moves, never vanishes; four named owner gates) —
the @ref on `validatePublishedResultCustody` matches them.

## 2. The scoped fleet delta (16 commits)

`instance_fork.rs`, `fork_promotion.rs`, `write_authority.rs`,
`instance_lock.rs`, and `src/cli/fork.rs` have **empty diffs** across the
range. Claim anchors re-verified at this C: both fail-closed
`for_derived_host_op` dispatch sites (`src/local.rs:3271`,
`src/server.rs:1412`), `deny-all-v1` posture strings, `promotable: false`,
nested-fork refusal, `install_app_root_identity_sync` (`:233`, `:1404`),
atomic `replace_bytes_sync` (`:1494`). The rest of the delta: the
jobs/cron typed-facade refactor (`d9f3d4046` — mechanical
`db.X` → `db.jobs().X` delegation, read in full for `local.rs`), guide/
catalog/diagnostics/MCP surface work (new build-bound
`/_snapback/guide/http.routes.v1.json` route, catalog-sourced refusal
`next` hints, `SNAPBACK_ROUTE_UNKNOWN` suggestions — hosted operator
surface correctly short-circuits to the uniform disabled response before
any route enumeration), auth/admin refusal-projection improvements, CLI
machine mode, manifest/schema-export projections, and the frozen-record
carrier fix-forward (`fdb0d9b04`, gates green per `510689ec1`). Nothing
touches a claim invariant.

## Findings (non-blocking)

**F-1 — Low.** The new gate-selection pin test covers only the store
carrier path; anchor, relation-activity, and sequence-allocation routing
is verified live here but not machine-pinned. A future selector-registry
edit dropping one of those triggers would not fail this test — mitigated
by selector-authority FAIL_CLOSED_FULL on policy edits, but a three-line
test extension at the next legitimate checker rotation would close it.

**Carried:** R3-1/R3-2/R3-3 papercuts and closing-round N-2 (wiring the
due warning into battery-red ticket automation) remain open and unchanged.
N-1 is **closed by this commit**.

---

## Verdict

This is the correct fix for the defect my closing N-1 predicted, and it
fixes the deeper inconsistency underneath it: the fork claim's digest and
its snapshot classification now agree about the four sibling files, the
storage record's own transform is provably byte-identical, custody lands
on registered gates whose triggers and structural validation I verified by
probe, execution, and code reading, and every fork-chain binding from five
prior READY rounds still runs green (101/101; three conformance suites
exit 0; digest exact). The fleet delta leaves the fork surface untouched.
Conditional on the supervisor-supplied execution evidence green at exactly
`866f5d025645ce20a9149d8ea20032bd2f31c9b0`:

**Verdict: READY** — no blocking findings; F-1 and the carried items are
record-level papercuts for the next legitimate checker rotation.
