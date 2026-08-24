# LLP 0276 Phase 2 decision memo — corrections, rulings needed, and the schedule finding

**Status:** Closed 2026-08-23 — all seven rulings ratified and implemented
**Filed:** 2026-08-17
**Related:** LLP 0276, LLP 0225, LLP 0189, LLP 0232
**Blocks:** LLP 0276 Phase 2 (the carve series) cannot start until Part 3 is ruled.

<!-- path-migration: historical-begin -->

Produced during the Phase 0 execution run. Phase 0 landed in full
(`c3716cc32`..`86af99cc4`); Phase 1 is the skeleton flip; Phase 2 is blocked on
the decisions in Part 3 because the RFC's crate matrix disagrees with the
landed `ownership.manifest.json` in specific, enumerated places.

Companion tickets: `20260817-llp0276-phase0-blocked-move-rows.md` (the three
refused Phase-0 move rows) and `20260817-llp0276-rfc-reality-corrections.md`
(the measured RFC errors). This memo supersedes neither; it collects both plus
the Phase 2 rulings and proposed RFC text.

---

# LLP 0276 amendment memo — what Phase 0 found, and the decisions Phase 2 needs

**For:** Charlie Cheever (author of record, LLP 0276)
**From:** the LLP 0276 orchestration run (unattended, per in-session ruling D-c)
**Date:** 2026-08-17
**Character:** decision memo + proposed RFC amendment text. Nothing in this
memo has been applied to `llp/0276-ideal-codebase-architecture.rfc.md`; Part 5
is proposal text only. Every claim cites its source; disagreements between
sources are flagged, not smoothed.

**Sources** (all read in full):
- `llp/0276-ideal-codebase-architecture.rfc.md` (Accepted r5) — cited as "RFC L*n*" by current line number.
- `llp/0225-core-modularization.decision.md` — the ownership architecture this RFC amends.
- Survey artifacts in the run scratchpad: `phase0-deletion-manifest.md` (cited "DM"), `path-migration-manifest.md` ("PM"), `workspace-graph-gate.spec.md` ("GS", findings F1–F18), `phase2-carve-map.md` ("CM").
- `issues/20260817-llp0276-phase0-blocked-move-rows.md` (on `main` at `0cccf466e`) and `issues/20260817-llp0276-rfc-reality-corrections.md` (authored in lane commit `e53a05f67`; see Part 1 on its landing state).
- Live `origin/main` state at `d06c85e40`, verified directly where noted.

**Bottom line first.** Phase 0 landed cleanly except for three RFC move rows
refused with evidence. Phase 1 is executable once two mechanical additions
are made (`default-members`, `workspace.exclude`). Phase 2 is **not**
executable as the RFC stands: the crate matrix disagrees with the landed
`ownership.manifest.json` in specific, measured places — the auth row cannot
be carved as written — and the measured Phase 2 workload is 15–21 focused
agent-days against a days-1–3 budget. Part 3 lists the rulings needed; Part 4
gives the schedule options; Part 5 is ready-to-edit RFC text.

---

## Part 1 — What changed on the ground

Phase 0 ran as four lanes (P0-A through P0-D) under dual codex+grok review
per the run plan. Factual state as of `origin/main` @ `d06c85e40`:

**Landed on `main`:**
- **P0-B (JS hazards)** — `c3716cc32` + `1ca3b9c66`: `snapback-client`'s `@expo/snapback-contract` dep is now `workspace:*` (verified: `packages/snapback-client/package.json:282`); `snapback-hosted-supervisor` and `snapback-expo-dev-identity` carry `"private": true` (verified: both `package.json:4`); one selection-policy entry removed as a consequence; stale symbol-registry projections regenerated.
- **P0-A (root hygiene)** — `0d91f9701`, `47cb398ea`, `0cccf466e`, `d06c85e40`: 75 root debris files deleted (29 logs, 13 charters, 13 reports, 20 phase/lane/review/one-off files — DM Section A; the RFC's "~60" estimate was 75 measured), plus 2 dead scripts (`scripts/prove-template-front-door.mjs`, `scripts/land-p1.sh` — DM B.2); `docs/`, `notes-archive/`, `spike-isolated-node-action/` moved to `archive/` (59 files) with 8 link/pointer repairs; `.gitignore` gained `/*.log` and `/runs/`; the blocked-rows issue filed.
- Verified directly on `origin/main`: zero root `*.log`/charter files remain; `archive/` exists.

**Committed on lane branches, dual review dispatched, not yet on `main` at memo time:**
- **P0-C** — the `scripts/tests/` inventory gate binding the 6 previously ungated `scripts/*.test.mjs` (all six pass once bound — no hidden reds; run-plan progress log).
- **P0-D** — the committed path-migration manifest (185 rows) + deterministic straggler gate with a layout-epoch mechanism, and the `issues/20260817-llp0276-rfc-reality-corrections.md` ticket (`e53a05f67` on `lane/0276-p0d-path-manifest`). If these have landed by the time you read this, the content is as described here.

**The three refused move rows** (each verified on `origin/main`: `app.json`,
`eas.json`, and both `visibility-governance*.json` files are still at root;
no `demos/_research/` exists):

1. **Root `app.json`/`eas.json` → `website/` — refused.** Root `app.json` is the `snapback-ci` EAS project (owner `expo`, projectId `6a83ec05-…`), the anchor for `.eas/workflows/qualified-package-staging.yml` (pinned by `tests/ci_workflows_v0.mjs:547`; named normatively in LLP 0041 L178/L666); `website/app.json` already exists as a *different* project (`snapback`, owner `ccheever`) and a `git mv` would collide. (DM C.1; blocked-rows issue R1.)
2. **`visibility-governance*` → `scripts/governance/` — refused (both files kept, pending your ruling).** The G1-closure receipt path is a published-package constant (`packages/snapback-codegen/visibility-governance.mjs:48`) read **at git revisions**, not the working tree (`parseRevisionJson`, `visibility-governance.mjs:3497` — a push range straddling the move sees the receipt vanish). The config file alone is mechanically movable (3 edit sites, DM C.2) but was held with the receipt per the issue's recommendation until observer/reconciler replay of pre-move revisions is proven safe. (DM C.2; blocked-rows issue R2.)
3. **Undeclared demo dirs → `demos/_research/` — refused.** The move's own goal (a location-based declaration rule replacing `scripts/demo-catalog.mjs:21`'s existence rule) is unachievable because four of the 20 dirs cannot move: `competitive-checkpoint` and `zero-bakeoff` hold governed backend roots named at `visibility-governance.config.json:12,15` (same revision-anchored read hazard as R2); `expo-local-first-carrier` is imported by inventory-gated package tests (`packages/snapback-client/rqs-store-sqlite.test.mjs:8`, `packages/snapback-expo/expo-sqlite-carrier.test.mjs:21-22,173,247`); `coterie` is an active program (LLP 0266, LLPs 0277–0281, 5 open issues). (DM C.6 + D.4; blocked-rows issue R3.)

**Phases 1–4 have not run.** No `crates/` tree exists; the workspace flip has
not happened. The integration branch `rearchitecture/0276` currently carries
only the P0-A commits that also landed on `main`.

---

## Part 2 — Corrections to the RFC's factual claims

Each row: what the RFC states, what measurement found, which phase the error
would have broken, and a replacement sentence Part 5 folds in. "PM RvR *n*" =
`path-migration-manifest.md` "Reality vs RFC" item *n*.

| # | RFC claim (location) | Measured reality (source) | Would have broken | Proposed replacement |
| --- | --- | --- | --- | --- |
| C1 | Phase 1 is a "path-only commit series" with no mention of workspace default members (RFC L629–637) | Bare `cargo run` at the repo root is load-bearing: `demos/_kit/server-process.mjs:727-731` launches it (the LLP 0030 resolver-ladder cargo rung, asserted by `demos/_kit/tests/server-process-lifecycle.mjs:422`), and guide pages teach it. A virtual workspace root breaks every bare invocation. (PM RvR 10; corrections issue item 1) | **Phase 1** — the flip would land green on every explicit-`--bin` gate while breaking the demo harness and the documented authoring loop | Add to Phase 1: "The workspace root manifest sets `default-members = ["crates/snapback"]` and `crates/snapback` keeps `default-run = "snapback"`, so bare `cargo run`/`build`/`test` at the root keep today's meaning; this is a Phase 1 blocker, not an option." |
| C2 | The workspace is `members = crates/*` with no `exclude` stated (RFC L232, L273–284) | With `members = ["crates/*"]` and no `exclude`, Cargo promotes the vendored path deps to **implicit workspace members**, and `cargo metadata` **hard-fails on any clone whose `vendor/ibex` submodule is uninitialized** — exactly the drift-backstop revision worktrees and fresh clones. Empirically verified, cargo 1.97.0. (GS F9 + GS header) | **Phase 1** — the workspace-graph gate and every metadata consumer die on cold clones and backstop worktrees | Add to the workspace rules: "The root manifest carries `exclude = ["vendor/ibex", "vendor/celld-ltx"]` (or `vendor/*`); the gate's member-path rule (members only under `crates/`) is the tripwire if the exclusion is ever lost." |
| C3 | `targets/cloudflare/` among trees that "keep their own deliberate lockfiles and install roots" (RFC L386–389) | `cloudflare/` has **no `package.json` and no lockfile**. miniflare/workerd/wrangler live in the ROOT bun workspace and resolve from root `node_modules`; `src/workerd_exec.rs:218` and the conformance-twin bin resolve `node_modules/.bin/workerd` via `CARGO_MANIFEST_DIR`. (PM §12 + RvR 2; corrections issue item 3) | **Phase 3** — the move would either silently keep root resolution (contradicting the RFC) or break workerd resolution | Either: "`targets/cloudflare/` gains a deliberate target-local install root in the Phase 3 move series," or amend the sentence to: "`targets/cloudflare/` deliberately resolves its tooling from the root workspace install; its wrangler configs pin compat from `packages/snapback-harness/compat.json`." (Decision D-6 chooses; default = amend the sentence, defer the install root.) |
| C4 | "`tools/agent-safe-baseline-worker` → `crates/snapback-tools` — `git mv` — Phase 2" (RFC L501) | The worker is **lock-isolated by design**: own `Cargo.lock`, `[workspace]` opt-out, `snapback = { path = "../.." }`, and its exact file list + build command are pinned by a frozen receipt (`tests/acceptance/fixtures/agent-safe-storage/performance-baseline-build-recipe.v1.json:24-65`) mirrored by `src/bin/snapback-agent-safe-paired.rs:40-62`. A bare `git mv` breaks the baseline recipe. (PM §13 + RvR 9; corrections issue item 2) | **Phase 2** — the tools carve as written invalidates the agent-safe baseline receipts | Replace the row's Kind with "membership decision + reviewed receipt regeneration" and rule member-vs-`exclude` (Decision D-6). |
| C5 | Phase 0 manifest categories name "`scripts/capability-maturity.mjs` → `src/manifest.rs`" as an ordinary path consumer (RFC L613) | It reads `src/manifest.rs` **at historical commits** via git (`bytesAt(repoRoot, commit, 'src/manifest.rs')`, `capability-maturity.mjs:1057,1098`). A single string replacement breaks either pre-flip history replay or post-flip validation. (PM §9 + RvR 4; corrections issue item 4) | **Phase 1** and every complete battery after it — the gate silently or loudly loses one side of history | "Commit-path lookups select the registry path by the commit's layout epoch (pre-flip `src/manifest.rs`, post-flip the crate path); the straggler gate's epoch mechanism (P0-D) is the shared implementation." |
| C6 | "`scripts/verify-local-proof` declares 164 gates (73 with dependency edges)" (RFC L124) | **146** static `run` declarations, **64** with `--requires`, zero dynamic run lines (PM RvR 3; corrections issue item 5). **Source disagreement, flagged:** the P0-B selection receipt at `c3716cc32` reports `canonicalGateCount: 163` — the *expanded* canonical inventory — so the RFC's 164 most plausibly counted expanded gates at survey time while the survey counted shell declarations. Neither measured basis matches "164 (73)". | Bookkeeping in Phases 0/4 (entry/exit battery comparisons quote these counts) | "The canonical shell declares 146 static `run` lines (64 with `--requires`); the expanded canonical inventory resolves to ~163 gates. Counts in this document use the static-declaration basis unless stated." |
| C7 | "the 11 guide snippet transclusions from `cloudflare/**` and `tests/*.rs`" (RFC L614); "11 snippets … (9 × `cloudflare/**`, 2 × `tests/*.rs`)" (RFC L746) | Authored pages: **3** cloudflare + **2** `tests/*.rs` = **5 hand edits**. Including regenerated `guide-flat*.generated.md`: 9 + 6 = **15**. The RFC's 9 counts flats, its 2 counts authored, and 11 matches no consistent basis. (PM §10 + RvR 1; corrections issue item 6) | **Phase 3** — the move-series checklist would hunt for 11 edits and find 5, or miss the flats regeneration | "5 authored transclusions (3 × `cloudflare/**` on 2 pages, 2 × `tests/*.rs` on 2 pages) are hand-edited in the move series; the 10 mirrored occurrences in `guide-flat*.generated.md` regenerate. `check-guide` holds byte-exactness in every phase." |
| C8 | Source-reading checkers: two named — "`scripts/guide-lib.mjs` → `src/server.rs`, `scripts/capability-maturity.mjs` → `src/manifest.rs`" (RFC L613) | **Eight additional** source-reading consumers open moved paths: `guide-lib.mjs` also reads `src/admin.rs` (:652); `check-guide-shell-commands.mjs` parses `src/cli.rs` (:69); `generate-diagnostics-registry.mjs` reads `src/server/api_error.rs` + `src/server/tests.rs` (:32-33,153); `check-module-ownership.mjs` globs `src/**/*.rs` (:746); `check-rustfmt.mjs` globs `src/**` + `tests/**` (:27); `generate-control-catalog.mjs` reads `cloudflare/src/gateway.js` (:65); `tests/agent_safe_publication_checker_v1.mjs:2509` reads root `build.rs` bytes; and C5's historical-read mode. (PM §9 + RvR 4; corrections issue item 7) | **Phase 1** — six of these fail loudly, but `check-rustfmt`'s glob and the workflow `paths:` filters fail **silently** (they just stop matching) | Replace the parenthetical with a pointer: "source-reading checkers per the committed path-migration manifest §9 (ten consumers measured, two failing silently rather than loudly)". |
| C9 | "12 auxiliary `src/bin/*` bins — mapped per the Phase 0 manifest — `git mv`" (RFC L511) | Two are **not clean moves**: `snapback-telemetry-bench` drags the `telemetry-phase1-proof` feature, optional `tower` dep, the lib module `src/telemetry_bench.rs` (with a `CARGO_MANIFEST_DIR` embed of a root-tests baseline), and `verify-telemetry-phase1-proof:84`'s single two-bin build command that cannot span two packages; `snapback-agent-safe-paired` pins literal `src/` and `tools/` file lists mirrored in a frozen receipt. (PM §13 + RvR 8; corrections issue item 8) | **Phase 2** — the tools carve breaks the telemetry proof flow and the agent-safe receipts if treated as `git mv` | Amend the row: "10 bins are clean `git mv`; `snapback-telemetry-bench` and `snapback-agent-safe-paired` are coordinated semantic moves (feature/dep/module relocation, build-command split, receipt regeneration) per the manifest." |
| C10 | "`guide/published-closure.json` lags the actual 0.1.24 closure" (RFC L192–193, hazard 9) | Already false at acceptance: resolved by `5d4b02102` ("0.1.24 published"), which predates the RFC's own landing (`d234d7392`). P0-B verified the file correct and changed nothing. (`finals/p0b-final.md`) | Nothing — but the hazard list overstates Phase 0's scope | Delete the clause; the P0-B record notes it was already resolved. |
| C11 | "`snapback-client` pins `@expo/snapback-contract` by literal version **while every other internal edge is `workspace:*`**" (RFC L188–189) | Measured: 19 `workspace:*` edges, one literal internal edge (the one fixed), and **two intentional peer ranges** in `snapback-react` and `snapback-umbrella`. "Every other" was literally false, though directionally right. (`finals/p0b-final.md` audit) | Nothing operational; inventory accuracy | "…while `workspace:*` is the dominant internal form (19 edges; two deliberate peer-dependency ranges in `snapback-react`/`snapback-umbrella` are exempt)." Landed fix: the edge is now `workspace:*`. |
| C12 | The crate matrix (RFC L286–300) — count never stated; program briefs said "14" | The Accepted r5 matrix has exactly **13** rows. Downstream tasking wrote "each of the 14 crates"; the gate spec derived everything from the 13 actual rows. (GS F1; CM header note) | **Phase 2** tasking — two agents counting differently carve different workspaces | Add one sentence under the matrix: "The matrix defines exactly 13 crates; vendored crates are externals, not rows." |
| C13 | "root `app.json`/`eas.json` belonging to the website" (RFC L184, item 8); move row L504 | They are the `snapback-ci` EAS anchor for qualified-package staging; `website/app.json` is a different project and the mv would collide (Part 1, refusal 1) | **Phase 0** (executed row refused) | See Part 5 §E — the row becomes a KEEP with the load-bearing rationale. |
| C14 | `visibility-governance*.json` → `scripts/governance/` (RFC L264, L505) | The receipt path is a published-package constant with revision-anchored reads; the config alone is movable pending replay verification (Part 1, refusal 2) | **Phase 0** (executed row refused) | See Part 5 §E. |
| C15 | Undeclared demo research dirs → `demos/_research/`; declaration becomes flag-by-location (RFC L407–410, L507) | Four of 20 dirs cannot move (governance-anchored, test-imported, active program), so the rule change is unachievable; a partial move is churn without the rule (Part 1, refusal 3) | **Phase 0** (executed row refused) | See Part 5 §E. |
| C16 | Types row: "the leaf-assigned `src/auth/` modules per 0225 — `auth/identity_core.rs`, `auth/crypto.rs`, `auth/service_authority_contract.rs`" (RFC L288) | The landed manifest leaf-assigns **nine**: also `auth/descriptor.rs`, `handshake.rs`, `mod.rs`, `mode.rs`, `rehearsal.rs`, `wire.rs`. Read exhaustively, the RFC moves those six to rank-2 auth — instantly manufacturing upward edges (kernel's `storage/auth_mode.rs` consumes `auth/mode.rs`). (GS F4; CM §1.2 decision 1) | **Phase 2** — the types and auth carves | Decision D-3; Part 5 rewrites the list to all nine. |
| C17 | Kernel/types rows present four reassignments as current fact: `data_patch.rs`/`data_tier.rs` "today" kernel (leaf-owned), `seed_identity.rs` kernel (activation-owned), `schema_export.rs` types (activation-owned) (RFC L288–289) | All four are *permissible* operational reassignments under 0225 §5, but the RFC states them as today's owners, which is drift; and `schema_export.rs`'s reassignment is not executable at all (see D-2). (GS F5; CM Part 1) | **Phase 2** — carve scripts keyed to "today's" owners mis-seed | Part 5 rewords "Today:" cells to distinguish current owner from directed destination. |
| C18 | "Rank is total and every edge lands on a strictly lower rank" (RFC L284) | Four crates share rank 3 and three share rank 7 — rank is a total *function*, not a total order on crates. The consistent reading (encoded by the gate spec): all same-rank edges forbidden; rank-7 crates are pure sinks, including for dev-dependencies. (GS F2, F8) | **Phase 2/3** — an implementer reading "total" as "distinct" builds a different gate | Part 5 adds the clarifying sentence. |
| C19 | Straggler-gate exemptions: "`llp/tombstones/`, `issues/closed/`, `diaries/`, explicitly marked historical sections, and named negative fixtures" (RFC L625–627) | `llp/reviews/` (531 immutable provenance artifacts quoting `src/…` freely) is missing; without it the gate cannot run clean. (PM §14 + RvR 5; corrections issue item 9) | **Phase 0/1** — the straggler gate drowns | Add `llp/reviews/` to the category-exempt list. |
| C20 | Phase 0 manifest lists "`SNAPBACK_REPO_ROOT` consumers" as a risk category (RFC L615) | All measured `SNAPBACK_REPO_ROOT` consumers resolve only `schemas/` and `demos/` — neither moves. The dangerous idiom is Rust's `env!("CARGO_MANIFEST_DIR")`: 64 uses across 38 files, ~40 escaping the future crate root, **not compile-checked**. (PM §4d, §11 + RvR 6; corrections issue item 10) | Attention allocation in Phases 1–2 (the risk table points at the wrong family) | Reweight: "`SNAPBACK_REPO_ROOT` consumers are unaffected (verify, don't edit); the migration-sensitive root idiom is `CARGO_MANIFEST_DIR` (64 uses, ~40 escaping the crate root, runtime-resolved)." |
| C21 | (Omission) `src/` treated as source-only in the move narrative | `src/` contains **eight committed JSON publication records and two HTML assets**; the JSON carriers are path-pinned by literal `src/…` strings in three places (`scripts/check-agent-safe-publication.mjs:179-526`, the selection policy, `build.rs:575-579`). (PM §3 + RvR 7; corrections issue item 11) | **Phase 1** — three drift gates red if any literal misses the same series | Name them in the Phase 1 bullet as a called-out move family. |

Corroborations for calibration: the surveys **confirmed** the RFC's 12 aux
bins, 74 `tests/*.rs`, 242 `src/` files, 18 drift-prone gates, 12 CI
workflows, 28 `scripts/*.test.mjs`, and the ~376 KB baseline (PM RvR 11).
The errors above are specific, not a pattern of general unreliability.

---

## Part 3 — Decisions you must make before Phase 2

Phase 2 cannot start until these are ruled, because the carve scripts, the
committed `crates/allowed-dependencies.v1.json`, and the flip predicate's
seed table all need one authoritative file→crate assignment. The carve map
measures: 180 clean agreements, 36 RFC-directed overrides (executable as
directed), **6 reality-overrides** (RFC direction contradicted by the
measured graph), and **14 open DECISION rows** (CM headline table). Grouped
below into seven rulings.

### D-1 — The `snapback-auth` module list (the highest-risk ambiguity; rule first)

**Question:** Which modules constitute `snapback-auth`? The RFC's auth row is
not executable as written.

**Evidence (GS F6; CM §"snapback-auth" table):** the row's phrase
"`src/auth/*` minus its already-leaf-assigned modules … i.e. policy:
provider, sender-proof decisions, hosted-edge policy, identity/lifecycle,
rescue" claims modules that are kernel-owned or background-owned today, and
omits one entirely:

- "rescue" — `src/auth/rescue.rs` is **kernel** machinery (module doc: token-aware SQLite DDL rewriting over `LocalDatabase`; `storage/auth_rescue.rs` co-owns its catalog access). The auth-row word "rescue" is the capability, not this file.
- `src/auth/keyring.rs` (kernel-owned, referenced by `storage/auth_rehearsal.rs`) is **unmentioned by the RFC anywhere** — an unassigned module under an exhaustive glob reading.
- "identity/lifecycle" — `auth/lifecycle.rs`, `backup.rs`, `mailbox.rs` are background-services-owned today (moving them is coherent but is an ownership change the RFC does not record as one).
- "hosted-edge policy" — `auth/hosted_edge.rs` is transport-owned and its policy/transport interior split is an unnamed mixed-owner separation.
- Without a ruled list, two agents will carve two different auth crates (GS F6, verbatim).

**Options:**
(a) Rule the module list below (recommended).
(b) Keep the glob prose and let implementers interpret — rejected by the evidence above; this is how the ambiguity arose.

**Recommended ruled list — `snapback-auth` = 17 files, 37,123 lines (CM):**

*In:* `auth/provider.rs`, `auth/invocation.rs`, `auth/coordinator.rs`,
`auth/sender_proof.rs`, `auth/invalidation.rs`, `auth/admission.rs`,
`auth/service_fence.rs`, `auth/lease.rs`, `auth/logical_transfer.rs`,
`membership_rules.rs` (all sync→auth); `auth/backup.rs`, `auth/lifecycle.rs`,
`auth/mailbox.rs` (bg→auth); `auth/deployment.rs` (gac→auth);
`auth/hosted_edge.rs` (transport→auth, policy half — flag for a possible
policy/transport split at carve time); `dev_identity.rs` (transport→auth);
`auth/effective_source.rs` (transport→auth; low stakes, see D-4d).

*Explicitly NOT in auth:* `auth/session_projection.rs` → sync (RFC already
explicit, L290); `auth/throttle.rs` → kernel until the `auth_rehearsal`
call-up inverts (RFC already explicit); **`auth/keyring.rs` → kernel** (key
custody is durable substrate; kernel referrer pins it); **`auth/rescue.rs` →
kernel** (DDL machinery); **`auth/recovery.rs` → server** (its 6 refs are all
server-side: `admin.rs`, `admin_impersonation.rs`, `control_catalog.rs`,
`host_ops.rs`, `server.rs`, `server/api_error.rs` — it is the rescue *admin
surface*, distinct from `auth/rescue.rs`); **`auth/runtime.rs` → server**
(serve-time provider composition; manifest note "only server/cli compose
it"); the nine leaf modules → types (D-3); every `storage/auth_*` → kernel
(RFC already explicit).

**Reasoning:** this is the carve map's assignment, which preserves 0225's
item-3 cut (durable operations kernel, policy auth) and makes every measured
edge legal at rank 2 — the same test the RFC itself states as the auth row's
design goal. The two counter-intuitive rows (`recovery`, `runtime` staying
server) follow measured referrers, not the filename.

**Bonus finding to record with this ruling (CM A1):** after the six
session-projection value shapes move to the leaf, the live matcher makes no
per-row cross-crate call in either direction, and the production
`live_matcher → membership_rules` edge is legal downward. **On current
evidence the RFC's bounded membership exception in
`crates/allowed-dependencies.v1.json` is not needed.** Recommend the gate
artifact ships with an empty `membershipExceptions` and the RFC notes the
exception mechanism as available-but-unused.

### D-2 — The six reality-overrides (acknowledge as a family)

**Question:** In six places the RFC directs an assignment the measured edge
graph forbids or contradicts. The carve map applied "reality wins" per its
ground rules; each needs your acknowledgment because each amends RFC matrix
text (CM §1.2, REALITY-OVERRIDE table).

| File | RFC says | Reality (evidence) | Proposed ruling |
| --- | --- | --- | --- |
| `src/schema_export.rs` | `snapback-types` (types row hosts schemagen) | References **32 modules across every rank** (`server.rs`, `local.rs`, `ephemeral.rs`, nine kernel modules, …) — types placement makes the entire shape-down program a prerequisite of the *first* carve | Interim **`snapback-tools`** (only crate whose allowed set spans all ranks); burn-down ticket: migrate exported types into `snapback-types`, then move schemagen down per the RFC. The Phase 0 line "`snapback-schemagen` bin → `snapback-types`" defers with it. |
| `src/store_state.rs` | `snapback-kernel` (kernel row names it) | Only referrers are `cli.rs`/`cli/tests.rs`; it references **20 modules across every layer**. Kernel placement = ~11 pointless inversions for a CLI-only status module | **`snapback-cli`** — every edge already legal; also dissolves 0225 open items 4/5's `store_state → admin`/`auth` edges with zero inversion work. |
| `src/exec_guard.rs` | `snapback-runtime` (runtime row: "exec guards") | 18 referrers include **five kernel modules**; kernel may not depend on rank-3 runtime. The manifest's own note anticipated this ("placed on the leaf purely for dependency direction") | Stays **`snapback-types`**. The runtime row's phrase becomes "runtime-side guard *integration*"; the guard itself is leaf. |
| `src/search/rebuild.rs` | services ("rebuild jobs stay above") | Sole referrer is `search/sqlite.rs` (kernel) — this is rebuild *machinery*, not a job | Stays **kernel**. |
| `src/vector/rebuild.rs` | services (same clause) | Referrers are `storage.rs` + `vector/*` (kernel) | Stays **kernel**. There is **no separable "job" module** for the RFC's clause to move: the scheduling jobs that invoke rebuilds already live in the jobs/cron lanes assigned to services. The clause becomes descriptive, not a move instruction. |
| `src/ask.rs` | services (manifest bg; RFC services row "outbound policy") | Refs `config.rs` (activation) + `runtime.rs` — both sideways-illegal from services; sole consumers `server.rs`/tests | **`snapback-engine`** (rank 4 makes every edge legal). |

(One further trivial colocation flagged in the tables but not in the
six-row summary: `src/elevated_read_trace.rs` — zero out-edges, sole referrer
`runtime.rs` — colocates in `snapback-runtime`. No controversy.)

**Recommendation:** ratify all six as stated. Each is evidence-driven, and
five of the six *reduce* Phase 2 work. The only one with real design content
is `schema_export.rs`, where the alternative (do the full type-migration
now) would put a multi-week program inside the first carve.

### D-3 — The six leaf-assigned `src/auth/` modules: manifest or RFC glob?

**Question:** `auth/descriptor.rs`, `handshake.rs`, `mod.rs`, `mode.rs`,
`rehearsal.rs`, `wire.rs` — the landed manifest leaf-assigns all six; the
RFC types row names only three leaf files, and the auth row's
"minus its already-leaf-assigned modules" therefore textually claims these
six for rank-2 auth (GS F4; CM decision 1; 7 DECISION rows counting
`auth/mod.rs`).

**Options:**
(a) **Manifest wins — all six stay `snapback-types`** (recommended). These are wire/descriptor/grammar leaves; kernel modules import them (`storage/auth_rehearsal.rs` uses `auth/rehearsal.rs` vocabulary; `storage/auth_mode.rs` consumes `auth/mode.rs`). Moving any to rank 2 manufactures kernel→auth upward edges on day one.
(b) RFC glob wins — requires inverting every kernel import of these six first; pure cost, no benefit identified by any survey.

**Recommendation:** (a). Read the RFC's phrase "already-leaf-assigned … per
0225" as *referring to the manifest's assignments* (all nine), which makes
the RFC self-consistent; Part 5 rewrites the list explicitly. The flip
check's seed table already excludes the six from auth (GS F4).

### D-4 — The remaining assignment decisions (rule as four small families)

The other DECISION rows from CM §1.2, grouped. Recommendations are the carve
map's; none is high-stakes individually, but each must be *somewhere* before
the gate artifact is authored.

**(a) Proof/bench lane → `snapback-tools`:** `src/telemetry_bench.rs` (the
feature-gated proof lane driving `LocalSnapback` + `server::router`;
services placement carries 2 call-ups) and `src/bench_fixture.rs` (only
consumers are `bench.rs` and telemetry_bench — both tools). `telemetry.rs`
drops the `#[path]` mount; `bin/snapback-telemetry-bench` repoints. Kills 3
edges. (CM decisions 4; couples to correction C9.)

**(b) Engine colocations:** `src/local/inspection.rs` → engine (manifest bg
with an explicit "revisit" note; every referrer sits at/above engine; bg
placement carries 2 call-ups); `src/local/authorization_acceptance.rs` +
`src/local/auth_room_kick_acceptance.rs` → engine (full-`LocalSnapback`
acceptance tests, move whole). (CM decisions 5, 11.)

**(c) Contract/wire family:** `src/wire_fixtures.rs` → conformance, **gated
on the T2 wire-shape-down family** (its `ephemeral`/`auth::invalidation`/
`storage` imports are wire shapes that belong in types; conformance may not
depend on sync) — and per GS F8, the shared fixture *shapes* stay in
`snapback-types` so no lower crate ever needs a dev-dep on rank-7
conformance. `src/live_wire.rs` → types, **which makes T2 mandatory, not
optional** (5 upward refs; if T2 does not land, live_wire must ride with
sync and 9 lower-rank referrers break). (CM decisions 2, 12.)

**(d) Small singles:** `src/control_catalog.rs` → server with the E1
inversion (engine's `host_ops.rs` receives a typed `ControlSurfaceView`
instead of calling up); `src/auth/effective_source.rs` → auth (semantically
authority-source policy; low stakes either way); `src/agent_safe_publication.rs`
→ activation (manifest gac; the T1 split resolves its one types referrer —
distinct from the `build.rs` digest job, which goes to tools in Phase 3).
Also ratify: `src/auth/deployment.rs`, `admission.rs`, `invalidation.rs` →
auth (already covered by D-1's list; CM decisions 8–10 supply the per-file
evidence). (CM decisions 3, 6, 7.)

**Recommendation:** ratify all as listed. If you disagree with any single
row, the cheap veto point is before `crates/allowed-dependencies.v1.json` is
committed; after that, a change is a gate-artifact amendment.

### D-5 — `snapback-conformance`'s allowed-dependency set

**Question:** The RFC gives conformance `server, engine, kernel, auth,
types` (RFC L299). Its assigned bins plausibly need more: `snapback-sbsb2-vectors`
exercises snapshot-batch machinery (**sync**-owned), and
`snapback-conformance-twin` drives the workerd twin (**runtime**-owned).
That works only if everything needed is reachable through engine/server
public re-exports; otherwise Phase 2 hits a **widening amendment mid-carve**
— the exact event the RFC makes expensive by design. (GS F7.)

**Options:**
(a) Pre-check the two bins' import lists now (Phase 0-style measurement, hours not days) and widen the row *in this amendment* only if measurement demands it. (Recommended.)
(b) Widen preemptively to include sync + runtime — cheap, but hands the proof harness broader reach than it may need, and widening later is an RFC amendment while narrowing is operational; over-granting now is the cheaper direction to be wrong in, but grants the two crates most likely to be misused as a test back-channel.
(c) Leave as-is and accept a possible mid-carve amendment — worst option; it converts a measurement into a freeze-window interruption.

**Recommendation:** (a). One measurement closes it; Part 5 leaves a bracketed
slot in the row for the result.

### D-6 — `tools/`: workspace member or `exclude`d lock-isolated tree?

**Question:** Does `tools/agent-safe-baseline-worker` join the workspace
(losing its own `Cargo.lock` — workspace members share the root lock), or
stay lock-isolated under a root-workspace `exclude`?

**Evidence:** its isolation is deliberate and receipt-pinned (correction C4).
Joining the workspace changes the frozen build recipe
(`performance-baseline-build-recipe.v1.json`), the rpath depth in its
`build.rs:4` (4 levels → 2), and the paired-bin pinned file list
(`snapback-agent-safe-paired.rs:46-62`) — all regenerable, but each
regeneration is a reviewed change to agent-safe evidence machinery.
(PM §4a, §13.)

**Options:**
(a) **`exclude` + keep lock isolation** (recommended): `crates/snapback-tools/baseline-worker/` (or leave at `tools/`) under root `exclude`, path dep repointed. Preserves the receipt-pinned property "this worker builds with its own lock" that the baseline's reproducibility argument rests on; the receipt regeneration is a path-string update, not a semantic change to what the receipt attests.
(b) Full membership: simpler tree, one lock — but silently changes what the performance-baseline receipt attests (dependency resolution now floats with the root lock), which is a semantic weakening of the agent-safe evidence, not a tidying.

**Recommendation:** (a). The RFC's "one home per thing" principle is
satisfied either way; the receipt semantics are only preserved by (a). This
also resolves correction C3's posture: if the baseline worker keeps
deliberate isolation, `targets/cloudflare/` keeping deliberate *root*
resolution (with the sentence amended) is the consistent treatment — defer
any new install root to a follow-on.

### D-7 — Gate-spec ratifications (approve wholesale or strike individually)

The workspace-graph gate spec fixed several points the RFC left open. Each
is flagged, none is smuggled; approve as a block unless one bothers you
(GS F10–F15):

1. **Drift-check reading (F10):** "this table is drift-checked against" is implemented as *artifact-vs-cargo-metadata* in the standard D-4 registry shape; prose-table↔artifact agreement goes to the per-phase `llp-maintain` audit, not a gate that parses markdown. If you wanted the markdown table machine-checked, commission that separately.
2. **Waiver clocks (F11):** the analyzer's time-bounded waivers had deadlines and escalation; the successor `membershipExceptions` mechanism is bounded by named-module + open-ticket but has **no clock**. This is a silent weakening unless you make the schema's optional `deadline` field required. Recommend: make it required in the Phase 4 docs series. (Moot for now if D-1's finding holds and no exception is seeded.)
3. **Always-run tier (F13):** the gate joins `driftAlwaysRunGates` from Phase 1 (~0.1 s per strict push) so the analyzer's every-push posture transfers with zero lapse. Recommend keep.
4. **`publish = false` enforcement (F14):** the gate enforces D6 as rule (a).4 — an extension beyond the RFC's four named validations; note the current root manifest does **not** carry `publish = false`, so Phase 1 must add it to `crates/snapback`. Recommend keep.
5. **Engine-leftover denylist (F15):** the flip predicate's "free of leftover activation/auth/search symbols" needs a concrete symbol list; the spec seeds one from the matrix rows and scans definitions only. You review the list at Phase 3 — it is a judgment call the RFC's category language cannot mechanize.

**Recommendation:** approve 1–5 as a block; they are all in the conservative
direction.

---

## Part 4 — The schedule finding, stated plainly

**The measurement (CM headline + Part 5):** under the final assignment there
are **140 illegal edges** (call-ups plus matrix-illegal downward edges;
~18 dissolve via test-sibling splits alone). Executing the RFC's own binding
rule — invert every call-up before moving — prices Phase 2 at **15–21
focused agent-days** of critical-path work. The RFC budgets Phase 2 at
**days 1–3** of the freeze window (RFC L646, OQ-A's 72-hour budget, L781).
The estimate is roughly 5–7× the budget. This is not a padding dispute: the
per-slice table (CM Part 5) itemizes every day, and the largest items are
semantic slices with no shortcut (the `manifest.rs` split alone is 2–3 days;
109 modules import it).

**The family the RFC never names:** **K2, kernel→services, 33 production
edges** — asset/fork/push/jobs/replication/sync-predicate call-ups from
kernel files into services-owned modules, several requiring A2-scale
SQL-body relocation with that recipe's characteristic silent-read-shape
hazard (the LEFT-JOIN regression from 0225's A2 slice is the canonical
warning). It is **larger than the RFC's named `storage/*→src/auth/*`
prerequisite** (K1: 21 frozen fingerprints, 15 in production code) and sits
in front of the largest carve (kernel: 86 files, 168k lines). Estimated 3–5
days by itself. (CM §Carve 2, Part 5 risk 2.)

Two facts sharpen the constraint set:

- **The freeze has not been acquired and cannot be while you are away** (run-plan D-c: ruleset, bypass revocation, and fleet stand-down are operator actions). The program currently runs to a qualified integration branch and stops.
- **`main` is taking 136–178 commits/day.** Phase 1's pure `git mv` series survives rebases via rename detection; Phase 2's file *splits* break rename detection, so a long-lived carve branch racing a hot `main` accrues integration cost sharply (run-plan, standing constraints). A 15–21-day Phase 2 on a branch against live `main` is the worst-case configuration.

**Your options, honestly priced:**

1. **Extend the window** (OQ-A anticipates this: "the author may extend rather than abort"). A serial execution is 15–21 working days of freeze — realistically three to four calendar weeks of fleet stand-down. Cost: the suspended "`main` moves fast" doctrine stays suspended for weeks, not days; every concurrent program stops; the entry battery's meaning decays if anything must be hotfixed mid-window. Honest verdict: the pure form of this option does not survive contact with the measured number.
2. **Parallelize across disjoint inversion waves.** Waves A and B genuinely parallelize (T-, K1-, K2-, A-families touch disjoint files; CM Part 5). But local disk forces serial Rust builds in one worktree (47 GiB free; run-plan), so parallelism means the fleet (the office M1 Max is Ibex-qualified). Optimistic compression: the 15–21 days becomes perhaps 6–9 calendar days of freeze — *estimate, not measurement; treat as planning input only*. Cost: coordination overhead, and the freeze is still 2–3× the RFC's budget.
3. **Reduce Phase 2's mandatory set / re-sequence — recommended, see below.**
4. **Abort per the RFC's own clause** (RFC L697–702): `main` untouched, branch preserved, machinery never retired, RFC back to Review with the attempt recorded. Cheap and honest; Phase 0's value is already banked and Phase 1 is "independently valuable and independently abandonable" (RFC L637). Cost: the program's momentum, and the measured problems do not shrink by waiting.

**Recommendation — option 3, in a specific form: move the inversions out of
the freeze, keep the moves in it.** The decisive observation: of the 15–21
days, roughly **10–14 days are in-place semantic inversions** (waves A and
B, T1, SV1, R1, E1 — ports, shape-downs, interior splits) that **move no
files and need no freeze**. They are exactly the kind of slice LLP 0225 was
already executing incrementally on live `main` — the A1/A2/A3 slices are the
executed precedent, with their envelope discipline (identical
failing-name-sets) already proven. Inversions do not break rename detection
and land as ordinary reviewed landings under the existing analyzer +
ratchet. What genuinely needs the stationary base is the **move series**:
the carves proper (`git mv` + manifest surgery + test-sibling splits), which
the CM table prices at roughly **6–8 days once the inversions have landed**
— still over the 72-hour budget, but a single extended week rather than a
month.

Concretely: amend the RFC so "ports before moves" becomes **"ports before
the freeze"** — Phase 2 splits into Phase 2a (pre-freeze inversion waves,
ordinary landings on `main`, per-family envelopes, the K2 family named as a
first-class prerequisite alongside K1) and Phase 2b (in-freeze carve
series). Trade-offs, stated: the inversions land on hot `main` and contend
with concurrent work (0225's slices did too — that machinery exists for
this); the "one coherent series" aesthetic weakens (history will show
inversions interleaved with unrelated landings — but the RFC's own
history-preservation principle never promised aesthetic history); and the
freeze-entry battery must qualify *after* the inversions land, which is
strictly safer, not weaker. Part 5 §G contains the amendment text. If you
prefer options 1, 2, or 4 instead, everything in Parts 2–3 still applies
unchanged — the decisions and corrections are option-independent.

---

## Part 5 — Proposed RFC revision text

Apply to `llp/0276-ideal-codebase-architecture.rfc.md`. Section-scoped;
quoted text is the proposed replacement. Nothing here has been applied.

### A. Metadata header — new `Revised:` line (prepend above the 2026-08-18 acceptance line)

```
**Revised:** 2026-08-XX (r6, Phase 0 ground-truth amendments — three Phase 0
move rows withdrawn with evidence (root `app.json`/`eas.json` stay as the
`snapback-ci` EAS anchor; `visibility-governance*` stays pending a
transition-aware migration; the demo research-dir relocation and its
declaration-rule change are withdrawn); Phase 1 gains two blockers
(`default-members`, vendored `workspace.exclude`) and the layout-epoch rule
for historical source readers; measured-inventory corrections folded (proof
run-line counts, guide transclusion bases, source-reading checkers, aux-bin
caveats, install-root reality, `workspace:*` audit); the crate matrix
corrected against the landed ownership manifest — ruled `snapback-auth`
module list, nine leaf `src/auth/` modules, six reality-overrides
(`schema_export`, `store_state`, `exec_guard`, `search/rebuild`,
`vector/rebuild`, `ask`), conformance-row dependency pre-check, rank-total
clarification, 13-crate count pinned; kernel→services (K2) named a
first-class carve prerequisite beside K1; Phase 2 restructured into
pre-freeze inversion waves (2a) and the in-freeze carve series (2b) with the
budget re-based on the measured carve map [OR: budget/abort per author
ruling]; gate-spec ratifications recorded (drift-check reading, waiver
deadlines, always-run tier, `publish = false`, engine-leftover denylist).
No wire, storage, or product-surface decision changed.)
```

(Set the date; bracketed alternative if you choose a different Part 4 option.)

### B. "Current state — the measured inventory"

- Verification row (L124): replace "declares 164 gates (73 with dependency edges)" with:
  > declares 146 static `run` gates (64 with `--requires`); the expanded canonical inventory resolves to ~163 gates. Counts in this document use the static-declaration basis unless stated.
- Hazard item 9 (L187–194): replace with:
  > **Small correctness hazards** worth fixing while everything is open: `snapback-client` pinned `@expo/snapback-contract` by literal version while `workspace:*` is the dominant internal form (19 edges; two deliberate peer ranges in `snapback-react`/`snapback-umbrella` are exempt) — fixed in Phase 0; two publishable-but-unpublished packages (`snapback-hosted-supervisor`, `snapback-expo-dev-identity`) were shielded from accidental publication only by the inventory list — `"private": true` added in Phase 0. (An earlier `guide/published-closure.json` staleness claim was already resolved by the 0.1.24 closure landing before acceptance.)
- Item 8 (L180–186): delete "root `app.json`/`eas.json` belonging to the website," and after the sentence add:
  > (Root `app.json`/`eas.json` were initially classed as debris; the Phase 0 survey established they are the `snapback-ci` EAS project anchoring `.eas/workflows/qualified-package-staging.yml`, and they stay — see the move table.)

### C. "The target layout — Repository root" (L259–271, "Gone from the root")

Replace the affected clauses:

> Gone from the root: every `*.log`, `*-CHARTER.md`, `REPORT-*.md`,
> `PHASE-*`/`CODEX-*`/lane/review one-off, `land-*.sh`/`retry-*.sh` (per the
> reviewed Phase 0 deletion manifest — 75 files, executed), `ownership.*.json`
> (replaced — see the gate transition below), `examples/`
> (→ `crates/snapback/examples/`, keeping `embed::production` /
> `NativeCodePosture` as the public names), `tools/` (per the D-6 membership
> ruling: lock-isolated under root `exclude`, receipts regenerated under
> review), `spike-isolated-node-action/`, `docs/`, `notes-archive/`
> (→ `archive/`, executed), `build.rs` (per-crate now), `src/` and the root
> manifest's single-package form.
>
> **Staying at the root, load-bearing (Phase 0 evidence):** `app.json` and
> `eas.json` — the `snapback-ci` EAS project anchor for
> `.eas/workflows/qualified-package-staging.yml` (LLP 0041); moving them is
> an EAS-platform migration, not a `git mv`, and `website/app.json` is a
> different project. `visibility-governance.config.json` and
> `visibility-governance-g1-closure.json` — the receipt path is a
> published-package constant read at git revisions
> (`packages/snapback-codegen/visibility-governance.mjs:48,3497`); any
> relocation must be a dedicated transition-aware migration of the
> governance contract, out of this program's scope.

### D. The crate matrix (L286–300)

- Before the table, after "…a DAG by construction." (L284), append:
  > Rank is a total *function* (every crate has exactly one rank), not a
  > total order on crates: four crates share rank 3 and three share rank 7.
  > Every edge — normal, build, and dev — lands on a strictly lower rank;
  > all same-rank edges are forbidden; the rank-7 crates are pure sinks that
  > nothing, including each other, may depend on even as dev-dependencies
  > (shared fixture shapes therefore live in `snapback-types`, never in
  > `snapback-conformance`). The matrix defines exactly **13 crates**;
  > vendored crates are externals, not rows. In the "Today:" cells,
  > assignments that differ from the landed `ownership.manifest.json` are
  > directed reassignments under 0225 §5, not descriptions of current
  > ownership.
- **types row** (L288): replace the module list's tail with:
  > …`ids.rs`, `value_expr.rs`, wire shape structs, `exec_guard.rs` (leaf
  > per the landed manifest — every layer including the kernel calls it;
  > runtime keeps guard *integration* only), and the nine leaf-assigned
  > `src/auth/` modules per the landed manifest — `identity_core.rs`,
  > `crypto.rs`, `service_authority_contract.rs`, `descriptor.rs`,
  > `handshake.rs`, `mod.rs`, `mode.rs`, `rehearsal.rs`, `wire.rs`.
  > `schema_export.rs` is **not** here yet: it references 32 modules across
  > every rank and lands interim in `snapback-tools` with a burn-down ticket
  > (exported types migrate to the leaf, then the `snapback-schemagen` bin
  > moves down); until then the bin rides with `schema_export.rs`.
- **kernel row** (L289): remove `store_state.rs` from the module list; after the search/vector clause replace "(their rebuild jobs stay above, in services, composing kernel ops)" with:
  > (rebuild *machinery* — `search/rebuild.rs`, `vector/rebuild.rs` — is
  > kernel; the scheduling that invokes rebuilds already lives in the
  > jobs/cron lanes assigned to services, and no separable "job" module
  > exists to move); plus `auth/keyring.rs` and `auth/rescue.rs` (durable
  > key custody and DDL-rewriting machinery — the auth row's words
  > "rescue" and custody name capabilities, not these kernel files)
  and add at the end of the row:
  > `data_patch.rs`, `data_tier.rs` (leaf-owned today), and
  > `seed_identity.rs` (activation-owned today) are directed reassignments
  > into the kernel, recorded as such.
- **auth row** (L290): replace everything from "Today:" to the end of the row with:
  > Today (ruled module list, 17 files): from sync — `provider.rs`,
  > `invocation.rs`, `coordinator.rs`, `sender_proof.rs`, `invalidation.rs`,
  > `admission.rs`, `service_fence.rs`, `lease.rs`, `logical_transfer.rs`,
  > `membership_rules.rs`; from background-services — `backup.rs`,
  > `lifecycle.rs`, `mailbox.rs`; from activation — `deployment.rs`; from
  > transport — `hosted_edge.rs` (policy half; a policy/transport interior
  > split is expected at carve time), `dev_identity.rs`,
  > `effective_source.rs`. **Not** in auth: `session_projection.rs` (sync),
  > `throttle.rs` (kernel until the `auth_rehearsal` call-up inverts),
  > `keyring.rs` and `rescue.rs` (kernel — durable substrate),
  > `recovery.rs` and `runtime.rs` (server — the rescue admin surface and
  > serve-time provider composition; their referrers are exclusively
  > server-side), the nine leaf modules (types), and every `storage/auth_*`
  > (kernel).
- **sync row** (L292): replace "`rqs*.rs`, `watches.rs`," with:
  > `rqs.rs` (the engine: token envelope, MAC transcript, keyring custody —
  > `rqs_contract.rs` is leaf and stays in types),
  (deleting `watches.rs` from the row — `src/watches.rs` is leaf-owned and
  stays in types; `storage/watches.rs` is kernel).
- **services row** (L293): delete "search/vector rebuild jobs" from the charter (per the kernel-row correction) and add `ask.rs` nowhere — it moves to engine (engine row gains it).
- **runtime row** (L294): replace "exec guards," with "runtime-side guard integration (the `exec_guard.rs` leaf stays in types),". Add `elevated_read_trace.rs` to the row's module list.
- **engine row** (L295): append to "Today:": "; `host_ops.rs`, `ask.rs`, `local/inspection.rs`, and the two full-`LocalSnapback` acceptance-test modules".
- **cli row** (L297): append: "Today additionally: `store_state.rs` (CLI-only status/composition; its only referrers are `cli.rs` and its tests)".
- **conformance row** (L299): append:
  > Dependency pre-check obligation: before the gate artifact is committed,
  > measure `snapback-sbsb2-vectors` and `snapback-conformance-twin` import
  > closures; if either needs `snapback-sync` or `snapback-runtime`
  > directly, this row widens **in this amendment**, not mid-carve.
  > [Result: ___ — fill from the D-5 pre-check.]
- **tools row** (L300): append: "; interim home of `schema_export.rs` + the `snapback-schemagen` bin (burn-down ticketed), `telemetry_bench.rs`, `bench_fixture.rs`".

### E. Workspace-wide rules (after L300)

Add two bullets:

> - **Root manifest requirements:** `default-members = ["crates/snapback"]`
>   (bare `cargo run`/`build`/`test` at the root keep today's meaning — the
>   LLP 0030 resolver ladder's cargo rung and the guide's taught commands
>   depend on it; Phase 1 blocker) and
>   `exclude = ["vendor/ibex", "vendor/celld-ltx"]` (without it, Cargo
>   promotes the vendored path deps to implicit members and
>   `cargo metadata` hard-fails on any clone with an uninitialized
>   `vendor/ibex` — including the drift-backstop's revision worktrees;
>   empirically verified). `crates/snapback` carries `default-run = "snapback"`
>   and `publish = false` (the root package manifest does not carry it today).
> - **Membership exceptions ship empty.** The measured session-projection
>   cut (six value shapes to the leaf) leaves the live matcher with no
>   per-row cross-crate call in either direction; no bounded membership
>   exception is seeded. The mechanism remains defined; if one is ever
>   added, its `deadline` field is required (waiver-clock parity with the
>   analyzer it replaces).

### F. "What moves, what dies" table (L498–515)

- Row L501 (`tools/agent-safe-baseline-worker`): Kind → "membership ruling (lock-isolated under `exclude`) + reviewed receipt regeneration".
- Row L504 (`app.json`/`eas.json`): replace with "| Root `app.json`, `eas.json` | **stays** — `snapback-ci` EAS anchor (Phase 0 evidence) | keep | — |".
- Row L505 (`visibility-governance*`): replace with "| `visibility-governance*.json` | **stays** — published-path constant + revision-anchored reads; relocation requires a transition-aware governance migration | keep | — |".
- Row L507 (research dirs): replace with "| Undeclared demo research dirs | **stay**; the `demo.snapback.json` declaration rule is unchanged (four dirs are governance-anchored, test-imported, or active programs) | keep | — |".
- Row L511 (12 aux bins): append "(10 clean; `snapback-telemetry-bench` and `snapback-agent-safe-paired` are coordinated semantic moves — feature/dep/module relocation, build-command split, receipt regeneration)".

### G. Phases (L601–679)

- **Phase 0 bullet** (L601–628): replace "the 11 guide snippet transclusions from `cloudflare/**` and `tests/*.rs`" with "the 5 authored guide transclusions from `cloudflare/**` and `tests/*.rs` (15 counting regenerated flats)"; replace the two-checker parenthetical with "source-reading checkers per the committed path-migration manifest §9 (ten consumers; `check-rustfmt`'s glob and workflow `paths:` filters fail silently rather than loudly)"; add `llp/reviews/` to the category-exempt list (L626); append: "Executed 2026-08-17 with three rows refused as recorded above; the manifest and straggler gate are the plan of record — this document does not duplicate their 185-row inventory."
- **Phase 1 bullet** (L629–637): after "with no semantic edits," insert:
  > — plus the root-manifest requirements above (`default-members`,
  > `exclude`, `publish = false` on the façade crate: Phase 1 blockers),
  > the layout-epoch rule for historical readers
  > (`scripts/capability-maturity.mjs` selects `src/manifest.rs` or the
  > crate path by commit epoch), and the eight committed publication
  > records + two HTML assets inside `src/` whose literal path pins update
  > in the same series (checker, selection policy, `build.rs` cycle list) —
- **Phase 2 bullet** (L646–654): replace the heading and opening with the chosen Part 4 option. Recommended form:
  > **Phase 2a — inversion waves (pre-freeze, ordinary landings).** The
  > port-inversion work moves no files and does not require the freeze: the
  > leaf-shape wave (T2/T3/K1a/K3/A3/A4/ACT2/S1/K2f/R2), the `manifest.rs`
  > split (T1 — the program's critical path; 109 importers; its envelope is
  > name-sets plus the schemas/ diff gate plus the conformance corpora,
  > defined before the file is touched), and the behavior-down waves
  > (K1b–K1d, **K2a–K2e — the kernel→services family, 33 production edges,
  > named here as a first-class prerequisite beside K1**, SV1, R1's
  > interior split, E1). Each lands as an ordinary reviewed landing under
  > the existing analyzer + ratchet with a per-family characterization
  > envelope in 0225 §4's form (identical failing-name-sets; the A2
  > LEFT-JOIN regression is the binding cautionary precedent). Measured
  > working estimate: 10–14 focused agent-days, parallelizable across
  > disjoint families.
  >
  > **Phase 2b — carve series (in-freeze, days 1–N).** Order: types →
  > kernel → auth → activation → sync → services → runtime → engine →
  > server → cli → façade/conformance/tools. The binding rule stands: a
  > module with a call-up into its unextracted remainder is not moved until
  > that call-up is inverted — after Phase 2a, the remaining in-freeze work
  > is `git mv`, manifest surgery, and test-sibling splits (measured
  > working estimate: 6–8 focused agent-days). Each carve: `git mv`, split
  > the sibling `tests.rs` along the same lines, resolve that module's
  > grandfathered edges, compile, run affected gates. Coverage overlaps
  > throughout (gate on the crate graph, analyzer on the remainder).
  (If you instead choose extend/abort, keep the original bullet and change only the budget text and the K2 naming.)
- **OQ-A** (L781–783): replace with:
  > **OQ-A — freeze duration.** The original 72-hour budget is superseded by
  > measurement: 140 illegal edges; 15–21 focused agent-days total, of
  > which 6–8 remain in-freeze under the Phase 2a/2b split. The author
  > sizes the window against those numbers (extension remains preferred
  > over abort; the abort clause is unchanged).

### H. Gate transition paragraph (L334–367) — one ratification sentence

Append:

> Spec ratifications: the committed-artifact drift check is
> artifact-vs-`cargo metadata` (prose-table agreement is `llp-maintain`'s
> job); the gate joins `driftAlwaysRunGates` from Phase 1; it also enforces
> `publish = false` per D6; the Phase 3 engine-leftover conjunct uses an
> author-reviewed definition-only symbol denylist. Fixed names (gate id
> `workspace-graph`, artifact schema
> `snapback.workspace-allowed-dependencies.v1`, diagnostic prefixes) are as
> recorded in the Phase 1 enforcement spec.

---

## Marked uncertainties (do not treat as settled)

1. **The 164/163/146 gate-count unit** — the RFC, the P0-B selection receipt, and the path survey used three counting bases; C6's replacement names the unit but the RFC-time basis is inferred, not proven.
2. **Observer/reconciler replay** of pre-move revisions for `visibility-governance.config.json` was never proven safe or unsafe (DM D.7) — the config stays put on the conservative reading; a future move needs that verification first.
3. **The conformance bins' import closures** (D-5) are unmeasured; the row text carries a fill-in slot.
4. **`auth/hosted_edge.rs`'s policy/transport interior** is unmeasured; D-1 flags a possible split at carve time.
5. **The Phase 2a/2b day estimates** (10–14 + 6–8) partition the carve map's 15–21 by slice type; the partition is arithmetic over CM Part 5's table, not an independent measurement, and the parallelized calendar estimates in Part 4 are explicitly soft.
6. **Two S-family edges** (`local/live_protocol.rs` → `local.rs`, `local/receipt_log.rs` → `local.rs`) have no direct textual reference found and are likely re-export-resolved; CM expects them to dissolve at the local.rs split — verify with the analyzer, don't assume (CM S2).
7. **Minor internal inconsistency in the carve map:** `exec_guard.rs` is flagged YES in the types table but listed in the §1.2 REALITY-OVERRIDE summary; `elevated_read_trace.rs` the reverse. The substance (both stay/colocate as recommended) is identical either way.
8. **P0-C and P0-D landing state** — described here as of memo time (lane branches, reviews dispatched); reconfirm before citing their gates as live.

<!-- path-migration: historical-end -->

---

## Resolution (2026-08-23)

**Closed — every ruling this memo requested was ratified and implemented.**
The r5 acceptance (2026-08-18, recorded in LLP 0276's header) ratified
Decisions D-1 through D-7; the 2026-08-19 "Implemented, structurally"
revision landed the workspace on `main` at `18cb34fab`. Verified directly
against the tree on 2026-08-23:

- **D-1** — `crates/snapback-auth` exists with the ruled boundary:
  `auth/keyring.rs` and `auth/rescue.rs` in `snapback-kernel`,
  `auth/recovery.rs` in `snapback-server`, per the referrer-driven ruling.
  The bonus finding held: `crates/allowed-dependencies.v1.json` ships
  `"membershipExceptions": []`.
- **D-2** — all six reality-overrides landed (`store_state.rs` → cli,
  `exec_guard.rs` → types, `ask.rs` → engine, rebuild machinery in kernel).
  `schema_export.rs`'s interim tools placement was superseded — favorably —
  by LLP 0283 F-5: per-crate carrier registration with `snapback-tools`
  owning downward-only assembly and `snapback-schemagen`.
- **D-3/D-4** — manifest-wins leaf assignments and the four small families
  landed as recommended.
- **D-5** — the conformance row's allowed set is the original five crates
  (`auth, engine, kernel, server, types`); the pre-check passed and no
  mid-carve widening occurred.
- **D-6** — `tools/agent-safe-baseline-worker` remains lock-isolated under
  the root `exclude` (option a), alongside `vendor/ibex`/`vendor/celld-ltx`;
  `crates/snapback` carries `publish = false` and the root manifest carries
  `default-members = ["crates/snapback"]`.
- **D-7** — gate-spec ratifications landed; the waiver clock (item 2) is
  enforced in `scripts/check-workspace-graph.mjs`: every membership
  exception requires a validated, unexpired `expiresAt` plus an existing
  `issues/` burn-down ticket. The concern is closed in code, not just prose.
- **Part 4** — resolved by events beyond the memo's recommendation: the
  freeze was never acquired; Phases 1–3 ran on the `p2-integrate`
  integration branch against a moving `main` and landed by fast-forward.

Residual notes: the RFC's auth-row "Today:" cell retains pre-carve glob
prose (historical; the landed tree and the gate artifact are authoritative),
and the marked uncertainties in this memo are either resolved by the landed
state or absorbed into LLP 0283's follow-up program. Companion tickets
closed with this one. Phase 4 / security follow-ups are tracked in LLP 0283,
not here.
