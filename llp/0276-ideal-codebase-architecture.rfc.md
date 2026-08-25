# LLP 0276: The ideal codebase — target languages, layout, and the one-shot rearchitecture

**Type:** RFC
**Status:** Accepted
**Systems:** Project, Build, Packaging, Verification, Docs
**Author:** Charlie Cheever / Claude (Fable)
**Date:** 2026-08-17
**Related:** LLP 0000, LLP 0002, LLP 0010, LLP 0037, LLP 0041, LLP 0053,
LLP 0059, LLP 0061, LLP 0141, LLP 0189, LLP 0199, LLP 0225, LLP 0232,
LLP 0259, LLP 0285
**Revised:** 2026-08-25 (LLP v2: the straggler-gate `llp-tombstones`
exemption is Tombstoned-status documents, not the `llp/tombstones/` path —
path is not lifecycle.)
**Revised:** 2026-08-21 (the generated-source amendment is retired after the
embedded Guide moved from generated Rust expressions to one inert binary
artifact consumed and parsed by committed server code; the declared generated
Rust source-home set is empty again.)
**Revised:** 2026-08-20 (committed generated-source amendment: declare
`crates/snapback-server/generated/` as the server crate's generated Rust
source home in the allowed-dependencies artifact and its checked projection.
This assigns the manifest-pinned embedded Guide API artifact to its real owner
without treating generated source as authored `crates/*/src/` or temporary membership
debt.)
**Revised:** 2026-08-19 (F-1 test-confinement amendment: add the rank-7
`snapback-harness` proof crate and permit `rusqlite` in `snapback` and
`snapback-harness` strictly as dev-dependencies. This makes raw-SQL test
authority visible to the workspace-graph gate while keeping it out of
downstream normal dependency graphs; rationale and migration sequence are in
LLP 0285 §5.3.)
**Revised:** 2026-08-18 (Phase 2 security-fix round: port inversion may not
replace a compiler-enforced admission capability with a caller-asserted
public trait, enum, or constructor; commit ports retain opaque capabilities
and façade confinement, with negative compilation evidence.)
**Revised:** 2026-08-19 (Phase 3 consolidation: all five flip conjuncts
checked; module analyzer/manifest/baseline/ratchet retired; workspace graph
promoted to the drift fail-closed core; root Cloudflare target moved under
`targets/`; the measured authored transclusion count corrected from nine to
three, with generated flats regenerated)
**Revised:** 2026-08-19 (LLP 0283 F-5 schema-export follow-up: each crate owns
the registrations for its carriers; `snapback-tools` owns downward-only
assembly and `snapback-schemagen`, superseding the provisional types/activation
placement without widening the dependency matrix)
**Revised:** 2026-08-19 (LLP 0283 F-5 completion: telemetry and fork-promotion
proof composition moved from the facade to rank-7 `snapback-tools`; both use
one exact port of the facade commit/dirty build stamp and only downward crate
dependencies)
**Revised:** 2026-08-19 (**Implemented, structurally** — the workspace, the
gate transition and the Phase 3 consolidation landed on `main` at `18cb34fab`
by fast-forward, with the rollback point tagged `pre-0276-rearchitecture`.
Executed without the frozen-`main` window: Phase 0 landed as ordinary
landings and Phases 1-3 ran on the `p2-integrate` integration branch while
`main` continued to move, so the author ruling 1 freeze was never acquired.
Phase 4 is **not** complete: the complete battery and cold-clone witnesses did
not run against the final head, and **npm publication was deliberately not
performed** because the authorization model has open privilege escalations.
Follow-ups, including the blocking security work, are recorded in LLP 0283.)

**Revised:** 2026-08-18 (**Accepted by Charlie Cheever**, in-session, after
the super-refine loop converged dual-READY — codex gpt-5.6-sol xhigh and
grok-4.6 xhigh both READY in the author-authorized round 4, verdicts bound
to r4 `5649ae4c…`; the accepted text is r5, the sanctioned editorial fold
of the six non-blocking round-4 minors. Acceptance ratifies Decisions
D1–D7, the ownership-map amendments, and the supersessions recorded in
§"Relationship to LLP 0225 and LLP 0199"; the LLP 0225/0232 amendment
pointers land with the program's Phase 4 docs series.)
**Revised:** 2026-08-17 (r5, editorial only, after dual-READY convergence
bound to r4: the six non-blocking round-4 minors folded — OQ-B asks for
revoked/disabled bypass dispositions; leaf-assigned `crates/snapback/src/auth/` files named
in the types row and `throttle.rs` in the kernel row; the entry-anchor
gloss points at the LLP 0175 D2.3 complete inventory; the required-green
"migration-critical" set defined; two stale risk cells updated; Phase 3
names the exemption removal. No normative decision changed.)
**Revised:** 2026-08-17 (r4: round-3
in-delta findings applied — external confinement staged (per-member arming
with a remainder exemption ending at the flip); the qualification contract
gains a required-green scope anchored to a named prior battery, preserving
LLP 0189 D-6 for publication; the freeze lease made exclusive (bypass
grants revoked/disabled for the window, not merely listed); leaf-owned
`crates/snapback/src/auth/` modules and `SessionProjection` placement clarified; owner ids
for the rank-7 harness crates; straggler-gate exemptions narrowed; touched
`@ref` glosses made a phase obligation)
**Revised:** 2026-08-17 (r3: round-2 in-delta findings applied — the
auth/kernel module assignments corrected to preserve the item-3 cut
(durable `storage/auth_*` operations stay kernel); the workspace-graph gate
lands in Phase 1, before the first carve, overlapping the analyzer; the
hot-path escape re-recorded as a bounded membership entry with a flip
predicate; one qualification contract (no new or unexcluded reds, signature
continuity) used at entry and exit; Phase 4 reordered so docs land on the
branch before qualification and publication happens under the lease;
committed matrix artifact, production profile, confinement additions,
bypass-actor inventory, aux-bin mapping, and amendment-point supersession
recorded)
**Revised:** 2026-08-17 (r2: dual NOT READY round-1 findings applied — the
allowed-dependency matrix replaces the informal rank rule; the ownership
machinery is replaced by a workspace-graph gate rather than deleted; auth
becomes a substrate crate below the domain rank; search/vector fold into the
kernel; carve order gains the port-inversion-before-move rule; the freeze
becomes a server-side lease with an integration branch and a non-destructive
rollback model; scripts regrouping leaves the window; entry condition,
path-migration manifest, and cold-clone witnesses added; OQ2/OQ3/OQ4/OQ5/
OQ6/OQ8 closed as Decisions)
**Revised:** 2026-08-17 (super-refine loop start: Draft → Review, the one
authorized transition; reviewers codex gpt-5.6-sol xhigh + grok-4.6 xhigh,
Fable xhigh orchestrating)

## Summary

This RFC lays out the ideal physical state of the Snapback repository — which
languages are used where, the directory tree, what lives in each part of it,
and what is connected to what — and defines the **one-shot rearchitecture**
that moves the codebase from its current shape to that state during an
author-authorized frozen-`main` window.

The central move: the single 563k-line Rust crate becomes a **Cargo workspace
whose crates realize LLP 0225's ownership architecture physically**, under
the explicit allowed-dependency matrix in this document. The logical
architecture — contract leaf below storage kernel below domain services below
adapters, with the kernel as the only commit authority — carries forward,
amended as recorded here. Enforcement changes form, not coverage: Cargo makes
*absent* edges uncompilable, and a small fail-closed **workspace-graph gate**
over `cargo metadata` enforces what construction cannot express (illegal but
acyclic edges, external-dependency confinement, membership assignment),
replacing the module-level analyzer, baseline ratchet, and 376 KB frozen
graph. Around the workspace, the layout is tidied: root debris deleted, stale
trees archived, generated artifacts kept strictly separate from authored
ones, and every directory given exactly one job.

What this RFC is *not*: a redesign of Snapback's behavior, wire contracts,
storage semantics, or product surface. Handler semantics, the protocol, the
published npm surface, and the guide's teaching all come through unchanged.
The rewrite is of the codebase's *shape*, with code mended where a boundary
demands it — not a second implementation.

## Author rulings (2026-08-17)

Recorded from the author in-session; this RFC is their durable record.

1. **Frozen-`main` window.** Charlie will hold `main` quiet for a few days so
   the rearchitecture can land as one coherent series against a stationary
   base. For this program only, the standing "`main` moves fast — never
   design processes that require it quiet" doctrine (AGENTS.md; LLP 0189
   D-2's starvation rationale) is deliberately suspended. The starvation risk
   those rules guard against does not exist while the author holds the
   freeze, which is why this program may — uniquely — gate its completion on
   a complete proof battery at the exact final commit.
2. **LLP 0225's execution posture is superseded.** The clause "There is no
   rewrite, no second implementation, and no flag-day" no longer binds; the
   author has directed a flag-day restructure. Everything else in LLP 0225 —
   the ownership map (§1), dependency direction (§2), and transaction/commit
   boundaries (§3) — **carries forward** as the logical architecture this
   layout realizes, amended only where this document says so
   (§"Relationship to LLP 0225 and LLP 0199"). On acceptance, this RFC
   becomes the amendment point for repository layout and for the ownership
   map's machine-readable projection; LLP 0225 remains the authority for
   commit semantics.

## Current state — the measured inventory

Numbers from a full survey on 2026-08-17. They are the baseline the target
layout is judged against.

### Scale

| Surface | Measure |
| --- | --- |
| Rust | One crate, no workspace. 242 files under `crates/snapback/src/`, ~563k lines (~468k excluding the giant sibling `tests.rs` files); 74 integration-test files under `tests/`; 12 auxiliary bins; `Cargo.lock` resolves 548 packages. |
| God files | `local.rs` 33,787 · `server.rs` 31,697 · `manifest.rs` 20,594 · `storage.rs` 20,158 · `ephemeral.rs` 16,657 · `runtime.rs` 12,250 · `telemetry.rs` 11,851 · `cli.rs` 11,129. The five largest ≈ 26% of non-test source. Test siblings: `local/tests.rs` 33,873 · `server/tests.rs` 33,165 · `storage/tests.rs` 22,448 · `cli/tests.rs` 5,638. 51 files exceed 2,000 lines. |
| JS/TS | 20 package dirs (19 names) in a bun workspace scoped to `packages/*` only; 13 published as the 0.1.24 closure. **No build step anywhere**: hand-authored ESM `.mjs` with 126 hand-written `.d.mts`; TypeScript is a checker, not a compiler. `snapback-client` is the largest surface (57k src lines, 41 subpath exports). |
| Contract corpus | `schemas/`: 295 flat JSON files (~272 JSON Schemas + 23 fixture/registry corpora), consumed by Rust, JS, Swift, and the Cloudflare target. |
| Docs/process | `guide/` 149 authored pages (18 MB embedded into the binary by `build.rs`); `llp/` 810 files (275 numbered + 531 reviews + 4 tombstones); `issues/` 142 open + 1,126 closed; `diaries/` 102; `demos/` 51 declared demos, 6,839 tracked files. |
| Verification | `scripts/verify-local-proof` declares 164 gates (73 with dependency edges); a path→gate selection policy; an 18-gate frozen-record drift registry; 12 CI workflows whose exact filename list is itself frozen by a test; `ref-check` validates the LLP corpus and `@ref` annotations. |

### What the layout gets right (and the target keeps)

- **The four governed corpora** — `guide/` (CI-verified teaching), `llp/`
  (design record), `issues/` (filesystem tickets), `diaries/` (build
  experience) — plus the executable proof surface `demos/`. This is the
  agent-first feedback loop of LLP 0000 working as designed. Untouched.
- **The generated-vs-authored discipline where it exists**: dist trees
  gitignored; the deliberately committed generated sets (`schemas/`,
  `admin-ui/generated/contract/`, `targets/cloudflare/generated/`, `guide/*.generated.*`)
  each guarded by a diff gate. Kept and extended.
- **The npm package topology**: `@expo/snapback-contract` as a
  dependency-free root, client/codegen above it, framework bindings above
  those, the CLI as the hub, platform runtime packages at the edge. Kept.
- **The no-build JS posture**: source-is-artifact `.mjs` + hand-written
  `.d.mts`, checked not compiled. This keeps published packages exactly
  equal to what agents read and edit. Ratified as Decision D3 below.
- **The single Ibex seam**: exactly one module (`crates/snapback/src/runtime.rs`) links
  `ibex-runtime`. The target layout promotes this from a convention to a
  crate boundary with a gate-enforced external-dependency rule.
- **The proof engine's shape**: gates as data, fail-closed inventories,
  selection receipts. Kept; its deeper consolidation is a named follow-on.

### What the layout gets wrong

1. **The physical shape contradicts the decided architecture.** LLP 0225's
   owners, layer ranks, and downward-only edges are enforced by a 19k-line
   analyzer over a 376 KB frozen baseline with a ratchet worklist of
   grandfathered violations — because in a single crate every module can
   call every other. The boundaries the project already ratified are
   advisory at compile time.
2. **God files.** Five files carry a quarter of the source; each drags a
   test sibling of comparable size. `crates/snapback/src/` is flat (124 top-level entries)
   with no hierarchy above two levels. Agents pay the cost on every read:
   orientation in a 33k-line file is expensive, and `crates/snapback/src/lib.rs` plus a JSON
   manifest are the only maps.
3. **Root namespace noise.** ~60 *tracked* one-off coordination artifacts at
   the repo root: 29 `*.log` (two over 1 MB), 13 `*-CHARTER.md`, 13
   `REPORT-*.md`, phase/lane notes, review candidates, `land-*.sh` scripts.
   None are gitignored. The repo's front page is an orchestration scratchpad.
4. **`build.rs` bundles four unrelated jobs** (707 lines): embedding the
   18 MB guide corpus, stamping build identity, computing the agent-safe
   implementation digest, and emitting Hermes rpaths — coupling guide edits
   and identity concerns to every build of the whole crate.
5. **74 integration-test link targets.** Each `tests/*.rs` is its own Cargo
   binary — the direct cause of the CI disk-headroom machinery
   (`cargo-target-headroom.mjs`, measured `cargo clean` decisions).
6. **Four independent test-inventory mechanisms** (package inventories,
   `verify-local-proof` run lines, the Cloudflare suite manifest, the
   drift-registry) — each sound, but a reader consults all four to answer
   "does this test run?", and `scripts/*.test.mjs` sits in none of them
   (6 of 28 such files are gated nowhere).
7. **A ~30-script release/publication family** with five "qualification"
   entry points, four "closure" scripts, and a publish/promote/fastpath
   split — no single documented state machine.
8. **Stale trees and drift**: `docs/` (self-declared legacy),
   `notes-archive/` (superseded by `llp/reviews/`), a finished spike at the
   root (`spike-isolated-node-action/`), `examples/` (two Cargo examples,
   easily mistaken for a JS tree), root `app.json`/`eas.json` belonging to
   the website, `ownership.*.json` and `visibility-governance*.json` at the
   root. Local-only but real: 466 GB of stale agent worktrees and 55
   registered `git worktree` entries.
9. **Small correctness hazards** worth fixing while everything is open:
   `snapback-client` pins `@expo/snapback-contract` by literal version while
   every other internal edge is `workspace:*`; two publishable-but-unpublished
   packages (`snapback-hosted-supervisor`, `snapback-expo-dev-identity`) are
   shielded from accidental publication only by the inventory list, not by
   `"private": true`; `guide/published-closure.json` lags the actual 0.1.24
   closure.

## Design principles for the target layout

Derived from LLP 0000's agent-first mandate, applied to the repository
itself.

- **The tree is the architecture.** A reader (agent or human) should recover
  the system's layering from `ls` — not from a manifest, a baseline, or a
  19k-line analyzer. Where a boundary matters, make it a compilation unit.
- **Enforce by construction; gate what construction cannot express.**
  Prefer boundaries the toolchain enforces over gates that re-derive them —
  and where the toolchain cannot see a rule (an illegal but acyclic edge, an
  external dependency in the wrong crate, an unassigned new member), a
  small fail-closed gate holds it. Coverage moves; it never vanishes
  (LLP 0189 D-4).
- **One home per thing; one thing per home.** Every file is authored,
  generated, or evidence — never ambiguous — and its directory says which.
  Committed generated artifacts live behind a diff gate; the stable-path
  exceptions are named (root `schemas/`, `guide/*.generated.*`); scratch
  output never enters the tree.
- **The root is a table of contents.** Every root entry load-bearing; none
  disposable.
- **Keep the corpora sacred.** `llp/`, `guide/`, `issues/`, `diaries/`,
  `demos/` and their gates are the product's memory and proof; the
  rearchitecture must not lose a byte of them.
- **History is preserved, not rewritten.** Every move is `git mv`; deletion
  is `git rm` (history retains the bytes). No filter-branch, no force-push,
  no rewriting of shared refs — ever, including rollback.

## The target layout

### Repository root

```
snapback/
├── AGENTS.md                 # agent instructions (CLAUDE.md → symlink)
├── README.md
├── LICENSE
├── Cargo.toml                # [workspace] — members = crates/*
├── Cargo.lock
├── rust-toolchain.toml
├── package.json              # bun workspace — packages/*
├── bun.lock
├── .node-version
├── .gitignore  .gitmodules  .dockerignore  .githooks/  .github/
├── ref-check                 # LLP corpus + @ref validator (stays: part of the method)
├── crates/                   # ── Rust workspace (the 0225 map, physical)
├── packages/                 # ── npm workspace (published JS surface)
├── clients/                  # ── protocol-native non-npm clients (Swift; already at this path)
├── schemas/                  # ── the cross-language contract corpus
├── targets/                  # ── target-local implementations (targets/cloudflare/)
├── demos/                    # ── executable proof surface
├── tests/                    # ── cross-language acceptance/conformance/receipts
├── benchmarks/               # ── competitive-authoring instrument (LLP 0186)
├── scripts/                  # ── proof engine, gates, release, bootstrap
├── guide/                    # ── the agent-first product guide
├── llp/  issues/  diaries/   # ── design record, tickets, build diaries
├── admin-ui/                 # ── admin console (Exact app, own bun.lock)
├── website/                  # ── snapback.expo.app shell (owns app.json/eas.json, own lock)
├── brand/                    # ── mark + rasters
├── skills/                   # ── agent skills aggregate (+ .agents/.claude/... mirrors)
├── vendor/                   # ── ibex, celld-ltx, llp, ccheever-skills submodules
└── archive/                  # ── retired-but-kept: docs/, notes-archive/, finished spikes
```

Gone from the root: every `*.log`, `*-CHARTER.md`, `REPORT-*.md`,
`PHASE-*`/`CODEX-*`/lane/review one-off, `land-*.sh`/`retry-*.sh` (per a
reviewed Phase 0 deletion manifest, not filename classes alone),
`ownership.*.json` (replaced — see the gate transition below),
`visibility-governance*.json` (→ `scripts/governance/` beside their
checker), `app.json`/`eas.json` (→ `website/`), `examples/`
(→ `crates/snapback/examples/`, keeping `embed::production` /
`NativeCodePosture` as the public names), `tools/` (→ `crates/`),
`spike-isolated-node-action/`, `docs/`, `notes-archive/` (→ `archive/`),
`build.rs` (per-crate now), `crates/snapback/src/` and the root manifest's single-package
form. `.gitignore` gains `/*.log`, `/runs/`, and a rule that orchestration
outputs live under gitignored `runs/<date>-<slug>/` — never loose at the
root.

### `crates/` — the Rust workspace

The crate set realizes LLP 0225's ownership architecture with the
amendments recorded in §"Relationship to LLP 0225 and LLP 0199". The
normative object is the **allowed-dependency matrix** below, carried as a
**committed artifact** — `crates/allowed-dependencies.v1.json`: per-crate
owner id, rank, allowed workspace dependencies (expanded, no shorthands),
external-confinement rules, exact member-local generated source homes, and
bounded membership exceptions — which the
workspace-graph gate reads and this table is drift-checked against
(a recomputed-vs-committed record in the LLP 0189 D-4 sense). Widening the
artifact is an amendment to this RFC. Rank is total and every edge lands on
a strictly lower rank; the matrix is therefore a DAG by construction.

| Crate | Rank | Owner | May depend on (workspace) | Charter and today's principal modules |
| --- | --- | --- | --- | --- |
| `snapback-types` | 0 | `shared-contract-types-leaf` | — | Language-neutral schema/wire/id/value/generation types; `schemars` derives; owns the common schema-artifact helpers and registrations for leaf carriers. Today: `contract_types.rs`, the DTO half of `manifest.rs`, `ids.rs`, `value_expr.rs`, wire shape structs, and the leaf-assigned `crates/snapback/src/auth/` modules per 0225 — `auth/identity_core.rs`, `auth/crypto.rs`, `auth/service_authority_contract.rs`. |
| `snapback-kernel` | 1 | `storage-migration-kernel` | types | SQLite transactions — the only commit primitive for the canonical store (LLP 0059); schema lineage, migration executor, rollback artifacts, durability; **search + vector** as storage-level query machinery over the canonical store (their rebuild jobs stay above, in services, composing kernel ops). Today: `storage.rs` + **all of `storage/*` including every `storage/auth_*`** — after 0225's A2/A3 those are the kernel's typed durable operations (transaction scope + SQL), and they stay in the kernel; plus `migration*.rs`, `data_patch.rs`, `data_tier.rs`, `seed_identity.rs`, `instance_lock.rs`, `store_state.rs`, `crates/snapback/src/auth/throttle.rs` (kernel per 0225 A1 until its `auth_rehearsal` call-up inverts), `search/*`, `vector/*` (the generated `unicode17` table is a recorded generated-file exception). Any remaining `storage/* → crates/snapback/src/auth/*` call-up is an **inversion prerequisite for both the kernel and auth carves** — the fix is inverting the edge, never reassigning the calling file upward. |
| `snapback-auth` | 2 | `auth-substrate` *(new owner)* | kernel, types | The auth **substrate**: provider, session/credential/lease/custody **policy and published substrate surfaces** (durability stays kernel), revocation **publication** through the LLP 0053 leaf shapes (`SessionProjection` itself stays in `snapback-sync` per 0225's landed cut), rescue, sender-proof, identity, hosted-edge *policy*. Sits **below** the domain rank so sync, services, and transport may all consume it without sideways edges — preserving 0225's landed item-3 cut. The boundary rule: `snapback-sync` keeps witnessed delivery obligations, resync fan-out, and subscription-invalidation *delivery*; auth owns authorization policy and its published epochs/leases, carried by the leaf's existing LLP 0053 shapes (authorization versions/epochs, lease ids, terminal-cause records) — not a new undirected pile; **the live matcher makes no per-row cross-crate call on the fan-out path** (the port pattern: policy compiles/publishes in auth, sync evaluates locally against leaf-shaped state, refresh rides auth commits through sync's existing invalidation delivery — off the fan-out path). A policy module that provably cannot leave sync without a hot-path hop stays in sync as a **bounded, named membership exception in `crates/allowed-dependencies.v1.json`** with a burn-down ticket — membership, never a matrix edge exception. Today: `crates/snapback/src/auth/*` **minus its already-leaf-assigned modules** (`identity_core.rs`, `crypto.rs`, `service_authority_contract.rs` are leaf-owned files staying with `snapback-types` per 0225's assignments) and minus `throttle.rs` (kernel per 0225 A1 until the `auth_rehearsal` call-up inverts) — i.e. policy: provider, sender-proof decisions, hosted-edge policy, identity/lifecycle, rescue; plus `membership_rules.rs`, `dev_identity.rs` — **not** the durable `storage/auth_*` operations, which are kernel. |
| `snapback-activation` | 3 | `generation-activation-coordinator` | auth, kernel, types | Composes and atomically installs successor generations via kernel commits (LLP 0225 §3.2 unchanged). Today: `generation_activation.rs`, the activation logic of `local.rs`/`manifest.rs`. |
| `snapback-sync` | 3 | `sync-realtime-engine` | auth, kernel, types | Subscriptions, version streams, live matching/coalescing, RQS, cursors, outbox settlement, invalidation delivery, fan-out, ephemeral rooms. Today: `live_matcher.rs`, `live_coalesce.rs`, `rqs*.rs`, `watches.rs`, `connected_clients.rs`, `snapshot_batch_cursor*.rs`, `ephemeral.rs`, `realtime.rs`. |
| `snapback-services` | 3 | `background-services` | auth, kernel, types | Assets + media pipeline, jobs, cron, push, webhooks, outbound policy, forks/branches, replication (`celld-ltx`'s sole consumer), telemetry (its sidecar store stays its own per 0225 §3.1), error tracking, ledger/proof-checkpoint custody, search/vector rebuild jobs. |
| `snapback-runtime` | 3 | `js-execution` *(new owner — resolves 0225's `uncertainAssignments` note)* | types | JS execution: the Hermes/Ibex FFI (the **only** crate allowed `ibex-runtime`), warm-VM lifecycle + reset, exec guards, the workerd/V8 conformance twin, embedded harness JS. Host-call *implementations* live above, in the engine; runtime stays kernel-free. Emits its own Hermes rpath link args for its lib/test link units (Cargo does not propagate link args — ENG-22664). |
| `snapback-engine` | 4 | `engine-coordinator` *(the declared higher-layer coordinator, 0225 §2)* | all rank ≤ 3 | The transport-independent engine — today's `LocalSnapback` (`local.rs`): provisioning state machine, cross-service orchestration, host-op implementations, `EphemeralApi`. The one place domain crates are composed; adapters call it, it calls down. The `manifest.rs` residues do **not** default here: identity → auth, vector → kernel, push/assets → services, auth residue → auth — the engine may not inherit leftovers. |
| `snapback-server` | 5 | `transport-adapters` | engine + all lower | The axum app: routes (the 180-route contract), wire envelopes, admin console serving, hosted-edge *transport*, instance home, OAuth/MCP remotes. Owns `AppState`/`SnapbackApp` and the committed parser for its inert, build-generated embedded Guide data. |
| `snapback-cli` | 6 | `transport-adapters` | server + all lower | The clap surface (~40 command groups), guide command, MCP stdio, lifecycle commands; builds and starts the server app (hence rank above it). |
| `snapback` | 7 | `embed-facade` / composition root | cli, server + all lower | The public crate: `snapback::embed` (LLP 0141 D1's sole supported Rust surface, source-compatible — its re-exports of engine/server types are exactly why this crate sits above the adapters) and the `snapback` binary. Its `build.rs` keeps the two binary-scoped jobs (build-identity stamping and Hermes rpaths for the final binary); Guide embedding belongs solely to `snapback-server`, whose API the façade re-exports. `crates/snapback/examples/` holds the embed examples. |
| `snapback-conformance` | 7 | `proof-harness` (non-product) | server, engine, kernel, auth, types | Wire fixtures, the conformance-twin bin, sbsb vectors, cf-manifest — proof bins exercising the contract from outside. |
| `snapback-harness` | 7 | `proof-harness` (non-product) | server, engine, kernel, auth, cli | Integration tests that must inspect the canonical SQLite store directly, beginning with the store-export suite moved out of product crates. `rusqlite` is a dev-dependency only: the authority is explicit to the workspace-graph gate and does not propagate into downstream normal dependency graphs (LLP 0285 §5.3). |
| `snapback-tools` | 7 | `dev-tools` (non-product) | any lower | The agent-safe worker (absorbs `tools/`), the agent-safe digest computation (leaves `build.rs`), telemetry and fork-promotion proof orchestration, benches, and downward-only assembly of owner-local schema registrations through `snapback-schemagen`. Its build script reproduces the facade commit/dirty stamp for provenance-sensitive tool binaries. |

Workspace-wide rules:

- **Every crate is `publish = false`.** Inter-crate `pub` is not a stability
  promise; only `snapback::embed` is supported, and LLP 0141's 0.x
  compatibility posture applies to that façade alone. crates.io distribution
  remains unclaimed (LLP 0141 D6) — no name reservation is required by this
  program.
- **Committed generated Rust source homes are explicit and member-local.**
  `generatedSourceHomes` in `crates/allowed-dependencies.v1.json` names the
  exact directories whose Rust artifacts inherit their member's owner. The set
  is currently empty: the former `crates/snapback-server/generated/` home was
  retired when the embedded Guide stopped consuming generated Rust. Such homes
  are neither authored `crates/*/src/` nor expiring membership exceptions; widening the
  list is an amendment and the gate's duplicated checked projection fails
  closed on drift.
- **External-dependency confinement**, gate-enforced: `rusqlite` only in
  `snapback-kernel` and `snapback-services` for production storage ownership,
  plus `snapback` and `snapback-harness` strictly as dev-dependencies for
  tests whose physical-store assertions cannot be represented by closed
  production APIs. The latter widening makes that test authority conspicuous
  to the gate without propagating it to downstream normal graphs; it is the
  LLP 0285 §5.3 tier-2/3 confinement amendment. `ibex-runtime` only in
  `snapback-runtime`; `axum`
  only in `snapback-server`; `clap` only in `snapback-cli`; `celld-ltx`
  only in `snapback-services` (replication). Other externals are
  review-governed, not confinement-gated.
- **Profiles:** Cargo package overrides cannot carry `lto`, so the shipped
  binary uses a named custom profile — `[profile.production]` inheriting
  `release` with `lto = "fat"`, `codegen-units = 1` — built as
  `cargo build --profile production -p snapback`; the ordinary `release`
  profile stays incremental-friendly so the in-window edit loop does not
  regress. Edition 2024 is current fact, not an in-window change; no
  dependency version moves ride the window.
- **Tests:** unit tests inline per crate (`#[cfg(test)]`, keeping
  crate-private access); the giant sibling `tests.rs` files split along the
  same lines as the code they test and move with it. Integration tests
  consolidate toward **a goal of ≤ 12 workspace `[[test]]` targets** behind
  an isolation audit — a target whose separation is semantic (env vars,
  ports, process globals, panic behavior) stays separate; consolidation is
  a reviewed slice, not a mechanical sweep.
- **File-size norm:** no file over ~3,000 lines as a review convention;
  recorded exceptions are generated tables and the temporary same-owner
  `legacy` modules defined by the scope rule below.

**The gate transition (replacement with overlap, never a lapse).** The
fail-closed **workspace-graph gate** (over `cargo metadata`, reading
`crates/allowed-dependencies.v1.json`) validates: every workspace member
carries an owner/rank assignment; every normal, build, and dev dependency
edge is within the matrix; the external confinement rules hold **for every
extracted member**; an unassigned new member fails closed. **It lands in
Phase 1** — registered in the canonical proof inventory and selection
policy in the same series, so the Phase 1 battery actually runs it — and is
therefore live *before the first carve*, because the module analyzer
extracts intra-crate `crate::`/`super::` paths and structurally cannot see
a cross-crate edge: without the gate, crate-rank would be unenforced during
exactly the window when an "add the upward dep so it compiles" edge is most
tempting. **Confinement is staged by construction**: the uncarved remainder
(`crates/snapback` while it is still the monolith) necessarily links every
confined external, so it carries a **named remainder exemption** — each
confinement rule arms for a member the moment that member exists, applies
to every extracted crate immediately, and the remainder's exemption ends at
the flip, in the same change as analyzer retirement. Through Phase 2 the
two run **overlapped**: the gate holds the crate graph, the analyzer holds
the shrinking single-crate remainder (its file-path keys updated per carve
— within LLP 0225 §5's operational scope only while they describe one
crate). Phase 3 retires the analyzer, manifest, baseline, and ratchet only
behind a checked **flip predicate**: `mixedModuleScopes` empty; every
module's path inside its assigned home — where a named membership exception
*is* that module's assigned home, and any unmatched file fails closed;
`snapback-engine` free of leftover activation/auth/search symbols;
**confinement holding with no remainder exemption**; the gate promoted into
`driftFailClosedCoreGates` in the same change. Narrowing the committed
artifact (removing an allowed edge or exception) is operational; only
widening amends this RFC. The ratchet
worklist is resolved and moved to `issues/closed/` with its resolutions
recorded — never deleted; any open ownership-gate health signatures receive
LLP 0232's administrative registry-retirement events; and LLP 0232 D-3's
`module-ownership` special-case sentence is amended by pointer in the same
series (it stops being live protocol when the gate it names retires).

### `packages/` — the npm workspace

Structure unchanged — the topology is good. In-window fixes only:

- `snapback-client` → `@expo/snapback-contract` becomes `workspace:*` like
  every other internal edge.
- `snapback-hosted-supervisor` and `snapback-expo-dev-identity` gain
  `"private": true` until the day they join the publication closure (the
  inventory list stays, but stops being the only shield).
- `guide/published-closure.json` regenerated to the true newest closure.
- `packages/snapback-harness` stays where it is but its README states the
  seam explicitly: its JS is embedded into `crates/snapback-runtime` (and
  the workerd twin) via `include_bytes!`, and `compat.json` single-sources
  the Cloudflare compat pins — it is runtime substrate, not a library.

The no-build posture, the version-pinned-at-`0.1.0`-rewritten-at-pack
publication mechanics, per-package test suites, and the 13-package closure
under `snapback-publication-authority` all carry forward unchanged. The bun
workspace membership stays `packages/*` only; `admin-ui/`, `website/`,
`targets/cloudflare/`, and per-demo trees keep their own deliberate
lockfiles and install roots.

### `schemas/`, `targets/`, `demos/`, `tests/`

- **`schemas/` stays flat at the root** — a named stable-path exception to
  the `generated/`-segment rule. Considered and rejected: nesting by
  namespace; the flat dotted-name corpus is consumed by four language worlds
  and churning every consumer for aesthetics fails the "one-shot changes
  shape, not contracts" rule. The ~272 `*.schema.json` are generated
  (`snapback-schemagen`, diff-gated per LLP 0037); the 23 fixture/registry
  corpora are authored, curated conformance data — the two kinds are listed
  in the corpus README so neither is mistaken for the other.
- **`targets/cloudflare/`** (moved from the former repository-root target): the narrow proof and
  any future target-local implementation live under `targets/`, making
  LLP 0225 §2's rule legible in the tree — targets bind the generated
  contract artifacts, never the Rust crates. The 3 authored Guide transclusions
  (the earlier count of 9 included generated flat projections) that
  transclude from `targets/cloudflare/**` have their `source=` paths updated in the
  same commit series as the move (`check-guide` holds this).
- **`demos/`** unchanged in role and gates. One formalization: undeclared
  research/bakeoff dirs move under `demos/_research/`, so the inventory rule
  becomes "every `demos/*` except `_kit/` and `_research/` declares a
  `demo.snapback.json`" — flag-by-location instead of flag-by-absence.
- **`tests/`** keeps the cross-language world: `acceptance/` (+ receipts,
  maturity records), `conformance/` corpora, the proof-machinery meta-tests,
  fixtures. Rust integration suites leave for their crates; the 2 guide
  snippets transcluding from `tests/*.rs` files get their `source=` paths
  updated with that move. Naming unifies on the dominant `snake_case_vN`
  convention (Decision D7).

### `scripts/`

**In-window scope is deliberately small**: the debris deletions, a new
`scripts/tests/` inventory gate closing the "6 of 28 `.test.mjs` gated
nowhere" gap, deletion-or-binding of the provably unreferenced scripts and
tests, `visibility-governance*` moving beside its checker, and the path
updates the crate move forces. The full regrouping into
`scripts/{proof,checks,release,generate,bootstrap,governance,launchd,lib,tests}/`
remains the target layout, but it is a **named follow-on executed after the
window as ordinary landings** — relocating the proof engine's own paths
immediately before asking it for the program's final complete verdict is
the worst possible ordering, and nothing about the regroup needs the
freeze. The deeper consolidations — one inventory mechanism instead of
four, one documented release state machine instead of ~30 scripts — are
likewise firm follow-ons (Decision D5), each deserving its own reviewed
design.

**Phase 0 lane P0-C implementation note (2026-08-17).**
`scripts/check-scripts-test-inventory.mjs` now holds the exact reviewed
inventory of root `scripts/*.test.mjs` files. Each entry declares either a
runner joined back to its live mechanism or a reason plus open burn-down ticket
for an `unrun` disposition; no entry currently uses `unrun`. The checker is an
always-run canonical gate and is also part of `scripts/check-inventories.mjs`.
The six formerly unbound files execute through the Guide-freshness,
Linux-runtime-release, or publication-script fixture gates, with path selection
following their owning surfaces.

### Docs, apps, skills, vendor

`guide/`, `llp/`, `issues/`, `diaries/`, `admin-ui/`, `website/` (now owning
`app.json`/`eas.json`), `brand/`, `benchmarks/`, `skills/` + agent mirrors,
`.githooks/`, and the four `vendor/` submodules are unchanged in place and
role. `archive/` collects `docs/` (already self-declared legacy),
`notes-archive/`, and `spike-isolated-node-action/` with their READMEs
stating why they're kept.

## Language policy

| Language | Where | Rule |
| --- | --- | --- |
| **Rust** (edition 2024) | `crates/` | The server, kernel, and everything that must be one binary. Workspace-wide lints set once at the root manifest; fat LTO via the dedicated production build (`cargo build --profile production -p snapback`). |
| **JavaScript (ESM `.mjs`) + hand-written `.d.mts`** | `packages/`, `demos/`, `scripts/`, `tests/` | The published client surface and all repo tooling. No build step; TypeScript is a checker. `.ts`/`.tsx` appear only as type fixtures and shipped CLI templates. |
| **Swift / Kotlin** | `clients/swift/`, `packages/snapback-expo-custody` | Protocol-native proving client; native custody module. |
| **JSON** | `schemas/`, inventories, policies, receipts | Machine truth. Committed generated JSON always sits behind a diff gate. |
| **Markdown** | `guide/`, `llp/`, `issues/`, `diaries/` | The corpora. Guide fences carry snippet classes; byte-exact transclusion from executed sources. |
| **Shell / Python** | `scripts/`, `ref-check` | Only where a process boundary demands it; `verify-local-proof` stays shell-as-data (its parser-gate depends on that). |

Install-root ownership for the non-workspace app trees: `admin-ui/` (own
`bun.lock`, Exact deps), `website/` (own lock, EAS deploy),
`targets/cloudflare/` (wrangler configs with compat pinned from
`packages/snapback-harness/compat.json`), per-demo lockfiles by design.

## Connection map

The seams the layout must keep legible, in generation/dependency order:

1. **Type truth flows outward** (LLP 0037): carrier-owning crates register
   their own schemas → `crates/snapback-tools` assembles those registrations
   through downward dependencies —`snapback-schemagen`→ `schemas/*.json` (committed,
   drift-gated) → consumed by `packages/snapback-codegen` (validation +
   generated app APIs), `packages/snapback-client` (wire validation),
   `clients/swift` (fixtures), `targets/cloudflare` (contract binding). The
   Rust crates are never a dependency of any of these — only the generated
   artifacts are.
2. **The runtime seam**: `crates/snapback-runtime` is the only Ibex linker;
   it embeds `packages/snapback-harness` JS via `include_bytes!`.
   `vendor/ibex` is a submodule + path dependency of that one crate (the
   manifest's relative path is rewritten at the move); `scripts/`
   bootstrap prepares its Hermes artifacts; `runtime-qualify` and the
   readiness receipts bind to whichever artifact actually loads
   `hermesvm.framework`.
3. **The guide loop** (LLP 0061): `guide/` pages transclude byte-exact
   snippets from `demos/`, `tests/`, `packages/`, `targets/cloudflare/`, and
   `admin-ui/` sources that CI executes; `crates/snapback`'s `build.rs`
   embeds the corpus so `snapback guide` and `/_snapback/guide` serve it;
   `scripts/` generators project the docs site consumed by `website/` as
   immutable closures.
4. **The proof spine**: changed paths → selection policy → gate selection →
   `verify-local-proof` (164 gates, JSONL results) → CI (`local-proof.yml`)
   and the launchd backstops. Inventories fail closed at every join
   (packages, demos catalog, guide manifest, CI workflow list, and — new —
   the workspace-graph gate and `scripts/tests/` inventory).
5. **Publication**: `scripts/` release tooling packs `packages/*` (versions
   written at pack time) under the `snapback-publication-authority` closure;
   the runtime packages carry the sealed binary; `demos/bug-tracker` stays
   the installed-from-npm witness.
6. **The admin console**: `admin-ui/` (Exact app, own lockfile) → committed
   `generated/contract/` (diff-gated) → served by `crates/snapback-server`.

## What moves, what dies

| Today | Target | Kind | Phase |
| --- | --- | --- | --- |
| `crates/snapback/src/**`, `build.rs`, root `tests/*.rs` | `crates/*` per the matrix | `git mv` + carve | 1–2 |
| `tools/agent-safe-baseline-worker` | `crates/snapback-tools` | `git mv` | 2 |
| `examples/*.rs` | `crates/snapback/examples/` | `git mv` | 2 |
| former repository-root Cloudflare target | `targets/cloudflare/` (+ 3 authored Guide `source=` updates; generated flats regenerate) | `git mv` | 3 |
| Root `app.json`, `eas.json` | `website/` | `git mv` | 0 |
| `visibility-governance*.json` | beside their checker under `scripts/` | `git mv` | 0 |
| `docs/`, `notes-archive/`, `spike-isolated-node-action/` | `archive/` | `git mv` | 0 |
| Undeclared demo research dirs | `demos/_research/` | `git mv` | 0 |
| ~60 tracked root logs/charters/reports/one-off scripts | deleted per reviewed manifest (`git rm`; history retains) | delete | 0 |
| Ownership analyzer/manifest/baseline/ratchet | gate lands Phase 1 (overlap); retirement behind the flip predicate; worklist resolved → `issues/closed/`; 0232 events + D-3 pointer | replace | 1→3 |
| Provably unreferenced scripts/tests | deleted or bound to a gate | delete | 0 |
| 12 auxiliary `crates/snapback/src/bin/*` bins | mapped per the Phase 0 manifest (conformance/tools/server/types/façade) | `git mv` | 2 |
| 74 integration-test binaries | ≤ 12 consolidated targets (audited; semantic isolation retained; remainders ticket — optional scope) | reviewed slice | 3+ |
| `build.rs` agent-safe digest job | `snapback-tools` | split | 3 |
| `scripts/` flat → grouped | follow-on after the window | deferred | — |
| `clients/` | unchanged (already at its target path) | — | — |

## The one-shot migration under the frozen-main window

### The qualification contract (used at entry and exit alike)

One definition, used everywhere this document says "qualified":
**no new and no unexcluded reds** — the complete canonical proof inventory
runs, and every red is either absent or carries **signature continuity**
with a red enumerated and dispositioned (inherited, ticketed, excluded) in
the entry record. Two hard qualifiers close the loopholes this rule would
otherwise open:

- **Entry is anchored, not self-defining**: entry continuity is evaluated
  against the most recent prior eligible complete battery — the newest
  LLP 0175 D2.3 complete-inventory run, whether from the
  `com.snapback.local-proof-backstop` schedule or a newer on-demand
  complete run, per LLP 0189 D-6 eligibility — so "new at entry" has a
  real predecessor and entry cannot baptize a fresh failure as inherited.
- **A required-green scope admits no exclusions**: migration-critical
  gates — evaluated against the gates present in the battery under test:
  the path-sensitive inventories this program mutates, plus the
  workspace-graph and straggler gates from the moment they land — every
  cold-clone witness, and every publication claim-relevant gate must be
  green outright. Entry exclusions are admissible only outside this
  scope. Publication additionally satisfies LLP 0189 D-6 and LLP 0232's
  qualified publication protocol **unchanged** — nothing in this program
  weakens them.

The same contract governs the freeze point, the Phase 1 milestone, Phase
4's battery, the cold-clone witnesses, the fast-forward, and publication —
an out-of-scope exclusion granted at entry cannot re-block exit, and a red
without entry lineage always blocks.

The freeze is acquired only against a qualified point, with the entry
result (including its exclusion list and required-green scope) recorded
with the freeze tag. Without this, an unrelated inherited red surfaces only
after the fleet is stopped and turns a 72-hour layout program into an
unbounded repair program.

### Freeze mechanics — a server-side lease, not a convention

- **The freeze is enforced where writes land**: a temporary GitHub branch
  ruleset restricting `main` pushes to the single operator identity running
  this program for the window's duration. The AGENTS.md dated banner and a
  temporary pre-push hook are defense in depth — a local hook alone cannot
  bind a fleet with per-clone `core.hooksPath`, `--no-verify`, and API
  writes available.
- **Writer-identity inventory before acquisition**: every identity able to
  write `main` — fleet machines (`MACHINE_FLEET.md`), CI workflows, the
  local-proof backstop (which autonomously commits and pushes ticket state),
  the drift backstop, any ticket-publishing automation, **and every ruleset
  bypass path** (org/repo admins, installed GitHub Apps with bypass
  grants) — is enumerated, **and the acquisition predicate requires
  effective write authority reduced to the operator alone**: every
  non-operator bypass grant is revoked or technically disabled for the
  window, with that state captured in the acquisition receipt — an
  enumerated-but-live bypass is visibility, not a lease;
  both launchd backstops are unloaded for the window and reinstalled at
  release. Acquisition and release are recorded as receipts (tag +
  ruleset-change evidence).
- Tag `pre-0276-rearchitecture` at the freeze point (with the entry-condition
  record). Live worktrees are not collateral: the local worktree audit is
  operational housekeeping, runs before the freeze, must check for dirty or
  unpushed work — not merely running processes — and is **not** a completion
  dependency of this program.

### The integration branch and rollback

All phases land on a protected integration branch
(`rearchitecture/0276`), pushed continuously; `main` does not move until
final qualification, when it **fast-forwards** to the qualified branch head.
Consequences:

- **Rollback before the fast-forward** is simply not merging: `main` never
  moved. The branch is preserved under a durable ref either way.
- **Rollback after the fast-forward** is ordinary forward `revert` commits.
  Shared `main` is never force-pushed or reset — the history-preservation
  principle has no rollback exception.
- **The irreversibility point is the Phase 4 npm publication**, not the
  merge: published packages are immutable (LLP 0041). Nothing publishes
  until the fast-forward has happened and the complete battery has passed on
  the exact `main` head.

### Phases

- **Phase 0 — pre-freeze, ordinary landings.** The hygiene rows of the move
  table (per a reviewed deletion manifest); the three JS-side hazard fixes;
  the `scripts/tests/` inventory gate; and the program's key artifact: a
  **checked path-migration manifest** enumerating every path-sensitive
  consumer by category — executable entry points; installed integrations
  (launchd templates/installers, tracked hooks); generated/frozen records;
  build-time embed/link paths (`vendor/ibex` path dependency, the `guide/`
  embed walk, `include_bytes!` relatives, `CARGO_MANIFEST_DIR` assumptions,
  readiness-receipt paths); digest pathspecs (`scripts/runtime-build-inputs.txt`,
  the agent-safe tree list); selection-policy path rules; CI workflow YAML +
  `ci_workflows_v0.mjs`; documented commands in AGENTS.md and guide pages;
  source-reading checkers (`scripts/guide-lib.mjs` → `crates/snapback/src/server.rs`,
  `scripts/capability-maturity.mjs` → `crates/snapback/src/manifest.rs`); the 11 guide
  snippet transclusions from `targets/cloudflare/**` and `tests/*.rs`;
  `SNAPBACK_REPO_ROOT` consumers; per-target/client roots; and a complete
  **`[[bin]]`/`crates/snapback/src/bin/*` → crate mapping** for the 12 auxiliary bins
  (conformance-twin/sbsb-vectors/cf-manifest → `snapback-conformance`;
  agent-safe, schema-generation, and bench bins → `snapback-tools`; the
  hosted-admission bin → `snapback-server`; `snapback-local` alias → the façade)
  so none lands in the façade by
  default. Phase 1 and Phase 3 execute against this manifest, and the
  manifest is itself checked by a **deterministic straggler gate**: named
  search projections (scripts, workflow YAML, policy JSON, Cargo manifests,
  guide `source=` paths) with an explicit exception contract — exempt by
  category are Tombstoned-status LLP documents, `issues/closed/`, `diaries/`,
  explicitly marked historical sections, and named negative fixtures;
  **active normative text in `llp/` and open `issues/` is checked**, and
  there is no accumulating ad-hoc allowlist.
- **Phase 1 — skeleton (freeze day 1).** A **path-only commit series**: `git
  mv src crates/snapback/src` (plus `build.rs`, root `tests/*.rs`) with no
  semantic edits, applying the manifest's path updates in the same series —
  including remapping the ownership manifest/baseline paths to the single
  moved crate root (still one crate: within 0225 §5's operational scope) —
  and landing `crates/allowed-dependencies.v1.json` **plus the
  workspace-graph gate**, live against the single-member graph before any
  carve exists. Complete battery qualified (per the contract) on the
  branch. Independently valuable and independently abandonable.
- **Phase 2 — carve, ports before moves (days 1–3).** Order: types →
  kernel → auth → the rank-3 domain crates → engine → server → cli →
  façade/conformance/tools. The binding rule, learned from 0225's first
  slice: **a module with a call-up into its unextracted remainder is not
  moved until that call-up is inverted** — trait/port declared in the lower
  crate, implemented by the remainder (the A3 pattern) — because after
  Phase 1 the remainder *is* the top-rank crate, and `git mv` first would
  demand a rank-violating (acyclic, compilable, illegal) edge the gate must
  refuse. The recorded activation → `local.rs` frozen edge is the named
  hard prerequisite for `snapback-activation`; the remaining
  `storage/* → crates/snapback/src/auth/*` call-up family is likewise the named prerequisite
  for the kernel and auth carves (invert the edge; never reassign the
  calling file upward). **A port inversion may transport admitted facts but
  must not turn an enforced capability into an assertion:** a crate-private
  admission carrier remains opaque across the boundary, its raw constructor
  and commit primitive are not re-exported by the façade, and a public trait
  or enum may not let the caller claim that admission occurred. Where Rust's
  crate privacy requires a public inter-crate carrier, it remains confined to
  an unpublished lower crate and only the higher authorized adapter projects
  it into a reachable commit call. Each privilege-bearing carve records a
  negative compile probe for the pre-carve attack. Each carve: invert,
  `git mv`, split the sibling
  `tests.rs` along the same lines, resolve that module's grandfathered
  edges (the ratchet items die at their carve), compile, run affected gates.
  Coverage overlaps throughout: the workspace-graph gate holds the crate
  graph, the analyzer holds the shrinking remainder.
- **Phase 3 — consolidation (day 3).** The module-level machinery retires
  behind the checked flip predicate (gate already live since Phase 1), with
  the remainder-confinement exemption removed from
  `crates/allowed-dependencies.v1.json` in that same change, and the
  worklist resolution, 0232 events, and amendment pointers in the same
  series; the agent-safe digest job moves to `snapback-tools`;
  `targets/cloudflare/` move + snippet-path updates. Integration-test
  consolidation starts here behind the isolation audit but is **optional
  scope**: an audit remainder is ticketed, never a reason to extend the
  freeze or block Implemented.
- **Phase 4 — document, prove, merge, publish, then unfreeze.** Order
  matters, so the qualified commit is the exact commit that ships:
  **(1)** docs catch-up lands **on the integration branch** (AGENTS.md,
  LLP 0000 §Repository, LLP 0225 amendment record, LLP 0232 pointer, this
  RFC's implementation notes); **(2)** the complete battery qualifies that
  exact branch head, plus the **cold-clone witnesses** so the proof is not
  asked to vouch for itself: a cold clone building and qualifying the Rust
  binary, an npm closure pack + install witness, a Cloudflare deploy
  dry-run, the Swift fixture run, an admin-ui build, a website
  docs-assembly; **(3)** `main` fast-forwards to that identical SHA;
  **(4)** the npm closure publishes from that pinned SHA **while the lease
  still holds** (LLP 0041's prompt-publication posture, with no race
  window); **(5)** only then: reinstall the backstops, release the ruleset
  lease with its receipt, lift the banner. Nothing lands between
  qualification and release except the fast-forward itself.

### Scope rule — boundaries are mandatory, drainage is not

Two different obligations, previously conflated:

- **Mandatory for "Implemented"**: every crate boundary in the matrix
  exists; every **mixed-owner file is separated** (a file whose interior
  spans owners — today's `local.rs`, `manifest.rs` — cannot be anyone's
  `legacy`); every dependency edge conforms to the matrix; the flip
  predicate holds (`mixedModuleScopes` empty, membership assignment
  complete, engine leftover-free); the path-migration manifest is fully
  applied; the gate transition is done. Integration-test consolidation is
  **not** in this set (audit remainders ticket).
- **Optional, degrades to tickets**: within-owner decomposition. A large
  single-owner module may land as an honestly-named `legacy` module inside
  its owning crate, a recorded exception to the file-size norm with a filed
  burn-down ticket.
- **Abort is honest**: if the mandatory set cannot complete in the window
  (even extended), the program does not pretend. `main` has not moved; the
  freeze lifts on untouched `main`; the integration branch is kept under a
  durable ref; the ownership machinery is never retired; this RFC stays
  `Review` with the attempt recorded. A partial state is never
  fast-forwarded and never described as the target layout.

## Relationship to LLP 0225 and LLP 0199

On acceptance of this RFC:

- LLP 0225 §Decision's execution posture (incremental-only; "no rewrite, no
  second implementation, and no flag-day") is **superseded** by the author's
  2026-08-17 ruling recorded here.
- Its §1 ownership map carries forward with these amendments: **`auth-substrate`**
  (rank 2, below the domain services precisely so the item-3 policy/SQL cut
  survives without sideways edges) and **`js-execution`** become owners;
  **`engine-coordinator`** is the declared higher-layer coordinator §2
  anticipated; search/vector are assigned to the storage kernel;
  `transport-adapters` splits into two ranked crates (server below cli);
  the composition-root rank above the adapters holds the LLP 0141 façade.
- Its §2 dependency direction carries forward with
  `crates/allowed-dependencies.v1.json` as the machine-readable projection
  (the §5 role), enforced by the workspace-graph gate; §3 commit boundaries
  carry forward verbatim and remain LLP 0225's authority. **LLP 0225 §5's
  amendment-point sentence is superseded for the projection**: future
  owner/rank/edge changes amend this RFC (a pointer lands on 0225), while
  commit-semantics amendments stay 0225's. The `unassigned` bookkeeping
  owner retires with the flip — mixed-owner separation makes it empty by
  construction.
- The enforcement arm is **replaced with overlap, never a lapse**: the gate
  live from Phase 1, analyzer on the shrinking remainder through the
  carves, retirement only behind the flip predicate with the gate in
  `driftFailClosedCoreGates`, worklist resolved to `issues/closed/`, 0232
  registry-retirement events for open gate signatures plus the D-3
  special-case pointer. 0225's characterization envelopes move with the
  carved modules and remain the inversion acceptance criteria
  (identical failing-name-sets, not pass counts).
- LLP 0199's disposition (0225's OQ-A, Superseded-with-pointer) is
  unaffected; its provenance value stands.
- LLP 0189's cadence rules resume unchanged at unfreeze; the in-window
  complete-battery gates are a one-time exception justified by the freeze.

## Risks

| Risk | Mitigation |
| --- | --- |
| A path-sensitive consumer is missed (digest pathspecs, selection policy, CI, launchd, embed/link paths, `SNAPBACK_REPO_ROOT`, readiness receipts) | The Phase 0 path-migration manifest is the plan of record, checked by the deterministic straggler gate; Phase 1 lands the whole flip and qualifies (per the contract) before any carve; the battery's fail-closed inventories are the net behind the manifest. |
| `@ref` and LLP path references break en masse | `ref-check` is in `alwaysGates` and validates repo paths; run per-phase, fix in-series. Per AGENTS.md, `@ref` glosses on files a carve or inversion **touches** are checked and updated in that phase — only untouched-corpus auditing defers to `llp-maintain`. |
| Guide transclusion breaks | Three authored snippets transclude from the Cloudflare target paths (the prior count of nine included generated flat projections); their `source=` updates land in the same series as the move, generated flats regenerate, and `check-guide` runs in every phase regardless. |
| A writer lands on `main` mid-window | The exclusive ruleset lease is the enforcement (non-operator bypass revoked or disabled, receipted); hook + banner are depth; the writer inventory catches automation; `main` only ever moves by the final fast-forward. |
| The backstops push during the freeze | Both launchd jobs unloaded for the window (in the writer inventory); reinstalled at release. |
| An illegal-but-compilable crate edge appears during the carves | The workspace-graph gate is live from Phase 1 (before the first carve) and holds the crate graph; the analyzer holds the shrinking single-crate remainder; the two overlap until the flip predicate passes. Neither "Cargo will catch it" nor the module analyzer alone is the safety argument. |
| Carve-time mending introduces behavior change | Port inversions are the semantic slices; each runs its affected gates; characterization envelopes from the 0225 slices remain in force; the exit gate is the complete battery plus cold-clone witnesses. |
| Inherited red discovered after the fleet stops | The entry condition: freeze acquired only against a qualified, recorded freeze point. |
| Build-time regressions from workspace profiles | Fat LTO only in the dedicated `production` profile build; ordinary `release` stays incremental-friendly; no dependency or edition changes ride the window. |
| The window overruns | Author may extend; otherwise the abort path: `main` untouched, branch preserved, machinery unretired, RFC stays `Review`. Partial states are never merged. |

## Decisions closed by this revision

- **D1 — owner-map amendments** (was OQ2): as recorded in
  §"Relationship to LLP 0225 and LLP 0199". Acceptance of this RFC ratifies
  them.
- **D2 — gate replacement** (new): the workspace-graph gate (reading
  `crates/allowed-dependencies.v1.json`) is live from Phase 1, overlaps the
  analyzer through the carves, and the module machinery retires only behind
  the flip predicate; enforcement coverage never lapses.
- **D3 — no-build JS posture ratified** (was OQ4): `.mjs` +
  hand-written `.d.mts`, TypeScript as checker only. Future build-step
  proposals amend this RFC.
- **D4 — services stay one crate; search/vector live in the kernel**
  (was OQ5): further splits only when a boundary earns them — crates are
  cheap to split once the workspace exists.
- **D5 — firm follow-ons, out of window** (was OQ3/OQ6): the `scripts/`
  regrouping, the single-inventory unification, and the release-family
  state machine are post-window programs, each with its own reviewed
  design.
- **D6 — no crates.io claims** (was OQ1): all workspace crates
  `publish = false`; LLP 0141 D6 stays unclaimed; no name reservation.
- **D7 — `tests/` naming** (was OQ8): `snake_case_vN`; the two `.test.mjs`
  stragglers migrate post-window with their inventory entries.

## Open questions

- **OQ-A — freeze duration.** 72 hours budgeted (skeleton day 1, carves
  days 1–3, prove/merge day 3); the author may extend rather than abort.
- **OQ-B — operator identity.** Which identity holds the `main` ruleset
  lease and the integration branch's push rights for the window. The
  acquisition receipt names that operator, every bypass identity **that was
  revoked or disabled** for the window, and any residual platform role that
  cannot be disabled — per the exclusivity predicate, no non-operator
  bypass remains live.
