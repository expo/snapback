# LLP 0276 review — grok family

## Round 1 — 2026-08-17

- Reviewer: `grok-4.6` (served as grok-4.6-build), reasoning effort xhigh
- Runner: `grok -p … -m grok-4.6 --reasoning-effort xhigh --output-format plain --disable-web-search --permission-mode auto --max-turns 200`, cwd = round-1 capsule
- Target revision (sha256): `146719f4facc3c8bc3c0e745d31c0a4b00cb051c94273893fa6f582ccfc85fc5`
- Capsule hash: `9c9db94f4c11b3840de31f2657424f17fa0a40a50364bdbbfd766c8b167db1a8`
- Instruction hash: `af49d7a97f88635a720532d65ce82d8f966b3837ceec95554c53a6b848865e09`
- Blindness: structural (capsule contains no review artifacts, run journal, or orchestrator notes)
- Note: the first paragraph of the body is the runner's tool-narration preamble, preserved verbatim.
- Verdict: NOT READY

### Verbatim review

I'll start by reading `CAPSULE.md` and the review document it names so I follow the capsule instructions exactly.Next I’ll read the RFC and every listed context document so the review is grounded in the capsule, not the live repo.The RFC is in, and I’ll now read the context LLPs so I can check crate fidelity, freeze mechanics, and consistency against the existing decisions.0225 is long; I’ll finish that Decision and then read 0189, 0232, and AGENTS.md for the freeze and verification constraints.I have enough to judge the crate graph, freeze plan, and 0225 fidelity. Drafting the review against those constraints next.

# Review of LLP 0276 (round 1)

The target *shape* is the right program: make LLP 0225’s map physical, keep the four corpora and the npm/schema seams still, and use a real freeze so a flag-day can exist. The document is not ready. The crate ranks and owner cuts, as written, are not a representable 0225 §2 graph; the Phase 2 sequence cannot compile under the RFC’s own rank rule; and the ownership-gate / freeze-control stories do not do the jobs the RFC assigns them.

Altitude rule applied throughout: demands for a per-file map, god-file split recipes, or a 72-hour hour-by-hour runbook are listed as minor or in the altitude dispositions, not as MATERIAL.

## MATERIAL concerns

### M1. The rank-3 adapter cluster cannot express the composition root or the LLP 0141 façade

The RFC’s own rule is that rank strictly decreases on every dependency edge, so Cargo will “enforce §2 of LLP 0225 mechanically.” LLP 0225 §2 already forbids same-rank owner edges: adapters may depend on domain services, the kernel, and the leaf — not on each other. `allowedDependencies` is validated so every allowed edge strictly decreases rank.

The crate table then places `snapback` (embed-façade **and** the `snapback` binary), `snapback-server`, `snapback-cli`, and `snapback-conformance` all at rank 3, and gives `snapback-tools` no rank at all.

Required edges the rest of the document asserts:

- “Library consumed by the façade bin” = `snapback` → `snapback-cli` (3 → 3).
- LLP 0141’s implemented `snapback::embed` surface re-exports `LocalSnapback`, `AppState`, `server::app`, and the bound app types. After the carve those live in engine/server. Source compatibility therefore requires `snapback` → `snapback-server` and `snapback` → `snapback-engine` (3 → 3 for server).
- Conformance bins that “exercise the contract from outside” will need the façade or the server (3 → 3).
- `snapback-tools` with rank “—” is outside the “every edge decreases rank” claim entirely: nothing states what it may depend on or who may depend on it.

Same-owner splits (`snapback-server` / `snapback-cli`, both `transport-adapters`) are not a 0225 violation *if* intra-owner edges are allowed; the RFC’s rank rule forbids them anyway. Cross-owner edges (`embed-facade` → `transport-adapters`) are a 0225 violation today and become an uncompilable Cargo edge tomorrow. Mixing the embed library and the bin in one crate also collapses owners 5 and 6 into a single package, which is the mixed-owner residue the workspace was supposed to eliminate.

**Resolution.** Introduce an explicit composition-root rank above the adapters (e.g. rank 4 for the `snapback` package: `snapback::embed` re-exports + the binary), or introduce an adapter-core crate *below* both façade and server that owns `AppState` / `SnapbackApp` so neither adapter crate depends on the other. Give `snapback-cli` / `snapback-server` / `snapback-conformance` / `snapback-tools` declared ranks and an `allowedDependencies` table in this RFC — the machine-readable projection 0225 §5 requires — and state that only `snapback::embed` is the supported Rust surface (0141 D1). Do not claim “an upward edge no longer compiles” until that table is a valid DAG.

### M2. The rank-2 cut is not a valid 0225 partition, and as drawn it undoes the landed auth split

0225 §2 is carried forward “verbatim”: domain services may depend only on the kernel and the leaf, **not on each other**. The table then places six crates at rank 2 — `snapback-activation`, `snapback-sync`, `snapback-auth`, `snapback-services`, `snapback-search`, `snapback-runtime` — so the workspace makes every current edge among those owners unrepresentable.

That is a real amendment only if those crossing edges do not exist, or each has a named inversion that is *not* a second request-path implementation. The document provides neither.

The load-bearing case is auth.

- 0225’s landed item-3 ruling put **policy in sync** (`src/auth/provider.rs`, `SessionProjection`, sender-proof admission) and **SQL in the kernel**, specifically so the kernel never calls up and so authorization-aware sync can see session/authority behavior without a sideways hop. A2/A3 exist because that cut is hard and already misfired once (the guest `LEFT JOIN` regression).
- This RFC assigns “Today: `src/auth/*` (30 files)” plus “invalidation” to a new rank-2 `snapback-auth`, while `snapback-sync`’s charter also lists “invalidation.”
- If `src/auth/*` moves as a block, `SessionProjection`, provider classification, and sender-proof policy leave sync. Sync must then depend on auth (forbidden) or the engine must mediate every authorized subscribe/match/reauth (a new orchestration API on the hot path — the “second implementation” the Summary disclaims).
- If those modules *stay* in sync, `snapback-auth` is not the auth domain and OQ2’s “new owner” is a name without a charter.

The same hole exists, smaller, for `snapback-search` “carved from services” while OQ5 recommends *not* splitting services until a boundary earns it. Search’s “rebuild machinery” is the obvious jobs/services edge; it is not analyzed.

OQ2 then asks whether to ratify these owners at all, while “Relationship to LLP 0225” already states that on acceptance they *are* owners. That is not an author-ratification leftover; it is two contradictory decision states for the one thing the freeze is supposed to land.

**Resolution.** Before acceptance, publish the remaining frozen-edge matrix **by proposed crate pair** (the 0225 baseline already is that graph). Then pick a representable map and close OQ2 as that map:

- keep auth policy inside `snapback-sync` (0225 as-built), or
- put a narrow auth *library* at a rank sync may depend on (between kernel and domain), with query-invalidation staying in sync and session-revocation named so it is not the same word as sync invalidation, or
- specify the engine-mediated inversion per crossing call (and admit that this is a semantic slice with a characterization envelope, not a `git mv`).

Apply the same test to search ↔ services. If a pair cannot be inverted without rewriting behavior, it is not two crates in this window. The Relationship section may announce amendments only after this cut is shown to be a DAG.

### M3. Phase 2 “extract, then mend” cannot compile under the rank rule

Phase 2 carves bottom-up: types, kernel, rank-2 crates (including activation), *then* engine. Each carve is “`git mv` the modules, split the sibling `tests.rs`, resolve that module’s grandfathered upward edges, compile.”

0225’s first slice already records the existence proof that this order fails at crate granularity: `generation_activation.rs` still holds a frozen edge to `src/local.rs`, with the named inversion “a coordinator-owned narrow port implemented *above* the service.” Above the service is the engine, which has not been carved yet. Extracting `snapback-activation` while it still names `LocalSnapback` requires `snapback-activation` → remainder crate. After Phase 1 that remainder *is* `crates/snapback` (rank 3 façade-to-be). That is a rank 2 → 3 Cargo dependency — exactly the edge the workspace is supposed to make unrepresentable. It is not a cycle; Cargo will accept it if listed, and the RFC’s language (“surviving as a Cargo dependency cycle”) misses the actual hazard.

This is why 0225 rejected a big-bang N-crate split and inverted *inside one crate*. The flag-day is authorized; this *sequence* is still wrong. `git mv` then mend produces either a forbidden Cargo edge or a non-compiling crate. The scope rule (legacy module *inside* the owning crate) does not help: the caller has already left.

**Resolution.** Invert remainder call-ups *before* extract: trait/port in the lower crate, `impl` on the still-unextracted remainder (the A3 pattern). Only then `git mv`. Alternatively invert the phase order: extract `snapback-engine` first as the wide remainder and drain downward. State that an unresolved remainder call-up blocks that crate’s extraction, not that “cycles” are the thing to prevent. Name the activation→`local.rs` port as a hard prerequisite to having both crates.

### M4. The ownership gate is unworkable in-window and is retired without replacing what construction cannot express

Three defects, one story.

1. **Phase 1 breaks the gate.** `ownership.manifest.json` / `ownership.baseline.json` / `check-module-ownership.mjs` are file-path-keyed on `src/**/*.rs` (0225 §5–§6). Phase 1 is `git mv src crates/snapback/src` plus a consumer list that does **not** include those files. 0225 §5: the gate reds “entries naming absent modules.” Phase 1 then “run[s] the complete battery.” That battery includes this gate (`driftAlwaysRunGates` / `driftFailClosedCoreGates`). The independently-valuable Phase 1 milestone is red by construction unless the manifest is remapped or the gate is excluded — neither is specified.

2. **Phase 2 still needs the analyzer.** Until the last carve, mixed residue remains in one crate. Cargo cannot see intra-crate upward edges. Retiring the gate in Phase 3 means the window’s carves are unenforced at the exact moment new forbidden edges are most likely (the A2 guest-join class).

3. **Retirement at the flip overclaims construction.** Cargo makes *missing* deps fail to compile. It does not make an *illegal but acyclic* `snapback-auth = { path = "..." }` in `snapback-sync` fail to compile. 0225 built a 19k-line always-run gate because review is not enough. This RFC’s own principle is “gates remain for what construction cannot express.” Allowed-dependency policy is exactly that. Deleting the arm with no workspace-allowlist replacement is a silent enforcement regression, and the RFC’s sentence that grandfathered edges die because “the workspace makes the violation unrepresentable” is false for acyclic illegal edges.

**Resolution.** Phase 1 remaps ownership paths (0225 already treats assignment/path updates as operational). Keep the analyzer alive through Phase 2 on `crates/**`. At the flip, retire the module-level baseline/ratchet/worklist, and replace them with a small fail-closed check: workspace `Cargo.toml` edges ⊆ this RFC’s amended `allowedDependencies`. That check is the 0225 §5 amendment projection; it belongs in `driftFailClosedCoreGates`. Do not delete `check-module-ownership.mjs` from inventories until that replacement is registered in the same change (0189 D-4: coverage moves, it never vanishes).

### M5. The freeze control cannot bind this fleet

The threat model is correct: many autonomous sessions, a social freeze will not hold, and the local-proof backstop commits and pushes ticket state to `main`. Unloading both launchd backstops is the right call. The tag-as-rollback-anchor is the right call *until* Phase 4 publishes.

The positive control is not. A temporary pre-push guard requiring a `[0276]` trailer is a *local* hook. Standing doctrine in `AGENTS.md`: hooks run only if `core.hooksPath` is set per clone/worktree; `SNAPBACK_DRIFT_GATES_BYPASS=1` is an accepted loud spelling; `git push --no-verify` exists. The RFC itself counts 55 registered worktrees plus fleet machines. A hook that is not installed is a banner with extra steps.

**Resolution.** Make the freeze a server-side write lock (GitHub ruleset / temporary removal of non-operator push rights on `main`), with the hook and AGENTS.md banner as defense in depth. State who may push `[0276]` commits. State that Phase 4’s npm publish — not the tag — is the irreversibility point (0041 packages are immutable; `git reset --hard` after publish desyncs `main` from the closure). Mention fleet clones (`MACHINE_FLEET.md`) in the pre-freeze audit next to the 55 worktrees.

## Minor concerns

### m1. Path-sensitive checklist is thinner than 0225 §6

Phase 1 lists digest pathspecs, selection policy, CI workflow YAML, `ci_workflows_v0.mjs`, `ref-check` roots, AGENTS.md. 0225 §6 already named load-bearing file-path consumers that must co-migrate: `scripts/guide-lib.mjs` (`src/server.rs`), `scripts/capability-maturity.mjs` (`src/manifest.rs`), file-path `@ref`s, and the ownership files (M4). Also missing from the written list: `vendor/ibex` path rewrite after `crates/snapback/` (0141: bare `path = "vendor/ibex"`), `build.rs` relative `guide/` embed path, `SNAPBACK_REPO_ROOT` clients, packaged-runtime / readiness-receipt paths, launchd installer paths after the Phase 3 scripts move. The complete battery is the stated net — keep it; extend the checklist so the first red is a planned rewrite, not an emergency.

### m2. Ibex/Hermes link custody after the runtime carve

0141 / ENG-22664: Cargo does not propagate a dependency’s `rustc-link-arg`. Putting Hermes rpaths only on `crates/snapback/build.rs` is correct for the façade *binary* and wrong for `snapback-runtime`’s own test/lib links. Bootstrap, `ibex-doctor`, `runtime-qualify`, and `*.runtime-readiness.json` are today bound to “the `snapback` binary.” Say that `snapback-runtime` emits rpaths for its own link units, the façade bin still emits them (non-propagation), and qualification targets whichever artifact actually loads `hermesvm.framework`.

### m3. Internal number slips

The drawn root is ~34 load-bearing entries, not “~20.” Scale claims “four giant sibling `tests.rs`” and then lists three. Summary says the seven-owner architecture carries forward “unchanged” and then amends the owner set. None of these break the design; they tax trust in the inventory.

### m4. `snapback-search` vs OQ5 vs `generated/`

OQ5’s recommendation (one services crate, split later) contradicts the already-proposed search crate. If generated `unicode17` tables are the reason, say so and put them under a `generated/` segment with a diff gate — the RFC’s own “one home per thing” rule.

### m5. OQ2 is not an open question if Relationship-on-acceptance already answers it

Pick one. If the crate table is the proposal, delete OQ2 and let acceptance ratify the table (after M2). If the owner set is still open, the Relationship section must not speak in the future perfect.

### m6. Scripts regrouping is a second path flip in the worst phase

Phase 3 moves `verify-local-proof` and friends after the carves, then Phase 4 needs a green complete battery. That is optional layout work (OQ3/OQ6 already defer the deep consolidation). Do it in Phase 0 with path updates, or leave `scripts/` flat until a follow-on.

### m7. 0141 visibility policy is unstated

`pub(crate)` does not cross crates. The split will create a lot of `pub`. State: workspace members are unpublished; inter-crate `pub` is not a stability promise; only `snapback::embed` is supported; 0.x patch compatibility (0141 OQ16) still applies to that façade. `examples/embedded_todo.rs` moving to `crates/snapback/examples/` is correct; say that `embed::production` / `NativeCodePosture::SelfHostedSingleTenant` remain the public names.

### m8. Manifest residues and the scope-rule junk drawer

0225 already assigned `manifest.rs` residue to identity / vector / push / assets / auth services. This RFC places only “the DTO half” and “activation logic.” Under the scope rule, everything leftover can land as `legacy` in engine and become blessed misplacement. Name those residues’ owning crates so “layout final” cannot mean “engine owns the leftovers.”

### m9. Several moves have no phase

`tools/` → `snapback-tools`, `examples/` → `crates/snapback/examples/`, and `snapback-schemagen` (named in the connection map, absent from the crate table) are in “What moves” but not in Phases 0–4. `clients/` appears in the target tree; current Swift/Kotlin paths never appear in the move table. Add a row or an explicit “already at this path.”

### m10. 74 → ≤12 test targets is not a mechanical rewrite

Sibling `src/*/tests.rs` files have crate-private access. Integration targets under `tests/` do not. Collapsing 74 processes into 12 also drops process isolation that some tests may assume. Treat the split as a visibility-and-isolation slice with the same characterization discipline as a 0225 inversion, and allow leftover private tests to stay `#[cfg(test)]` in the owning crate rather than forcing them into `[[test]]`.

### m11. Workspace fat LTO and edition policy

“Workspace-wide … fat LTO release” on ~14 crates can make the in-window edit loop worse than today’s single crate. Keep fat LTO on the binary package; let library crates inherit incremental-friendly release settings for the window. Pin “edition 2024” as current fact, not an in-window change (same hard rule as lockfile versions).

### m12. Hosted-edge named twice

`snapback-auth` gets “hosted-edge posture”; `snapback-server` gets “hosted edge.” If this is policy vs transport, say so. If it is the same code, it has two homes.

### m13. Phase 1 “zero code edits” vs the path series

The intent is clear (no semantic carve). The wording fights “fix every path-sensitive consumer in the same series.” Call Phase 1 a path-only commit series.

## Altitude-rule dispositions

These were considered and **not** raised as MATERIAL. They are implementation-phase work once the decisions above exist:

- A 242-file assignment table and a recipe for physically splitting each god file.
- Hour-by-hour occupancy of the 72-hour budget (OQ7 stays an operational question; the author may extend).
- Transcribing the full ratchet worklist into this RFC (the *crate-pair summary* is M2; the itemized list is a Phase 0 artifact).
- Designing one inventory mechanism (OQ3) or the release state machine (OQ6).
- Exact identities of the ≤12 `[[test]]` targets.
- A complete `grep -r 'src/'` census (m1 extends the named list; the battery remains the net).
- How to name every `legacy` module and the burn-down ticket template.
- crates.io reservation (OQ1) and no-build JS ratification (OQ4) — already decided in substance; recording them can wait.
- Intra-crate lint/size norms beyond the ~3,000-line review guideline.

## Verdict

The layout principles, the corpora/schema/npm non-goals, Phase 0 hygiene, Phase 1 as an independently revertible path flip, unloading the backstops, and “layout final / drainage ticketed” are sound. The crate DAG, the carve sequence, the ownership-gate replacement, and the freeze’s actual lockout are not. Those have to be decided in this document; they will not become true at implementation time.

VERDICT: NOT READY

## Round 2 — 2026-08-17 (delta round)

- Reviewer: `grok-4.6`, reasoning effort xhigh; same runner as round 1, cwd = round-2 capsule
- Target revision (r2, sha256): `9bc91e790aa6d9c773520220e16518941669a169e4b0052241c6298d664c28e5`
- Capsule hash: `4a45ddbe1893ea0d643fc2a0443457a991a18d828a0d2a56c56557fc18792b12`
- Instruction hash: `5ce55c83baedca9a3e1d6919ac391bb97b076ab3c04a7ae7ab97e0076ea6a307`
- Blindness: structural; delta round with enumerated r1→r2 delta and IN-DELTA/PRE-EXISTING classification
- Note: the first paragraph of the body is the runner's tool-narration preamble, preserved verbatim.
- Verdict: NOT READY — both MATERIALs IN-DELTA; reviewer states no PRE-EXISTING MATERIAL remains

### Verbatim review

I'll start by reading CAPSULE.md and the review document so I can follow the delta-round instructions exactly.I'll load the RFC and the context documents next, then classify every concern as IN-DELTA or PRE-EXISTING.I'll read the governing context LLPs next so I can judge this revision against the settled architecture rather than the flag-day itself.The first pass left 0225 truncated and 0000 unread; I'll finish those and then check AGENTS.md for the constraints this RFC must respect.I have enough context to write the full review: the r2 architecture is the right shape, but two IN-DELTA holes still block READY.

# LLP 0276 r2 review — ideal codebase architecture

**Document:** `llp/0276-ideal-codebase-architecture.rfc.md` (r2, Status: Review)  
**Reviewer:** grok-4.6 (independent capsule reviewer)  
**Date:** 2026-08-17  
**Round:** delta (r1 → r2). Author rulings on the frozen window and on superseding LLP 0225’s execution posture are taken as settled.

## Overall assessment

Revision r2 is a real redesign, not a gloss. The allowed-dependency matrix, auth-as-substrate, replacement-not-deletion of the ownership arm, port-inversion-before-move, server-side freeze lease plus integration branch, mandatory/optional scope split, and the D1–D7 closures are the right objects. The logical architecture still matches LLP 0225 §§1–3 as amended, LLP 0141’s façade, LLP 0189 D-4/D-7, and LLP 0232’s registry-retirement rule.

Two IN-DELTA decisions are still defective. The auth/kernel module sketch contradicts the item-3 cut and §3.1 / rusqlite confinement in the same document. The Phase 2 safety story claims the module analyzer will catch illegal-but-compilable crate edges; as specified, it cannot. Both are design holes, not nits.

No PRE-EXISTING MATERIAL concern remains. The inventory table is internally consistent (272+23=295; 275+531+4=810; five largest ≈ 26% of ~468k). I am not requesting spot-verification.

**Because the remaining MATERIAL concerns are IN-DELTA, the verdict is NOT READY.** That is the loop’s in-delta continue rule, not a judgment that r2 failed to move.

## Strengths

- **Matrix as the normative object.** Rank 0–7 plus a crate-level allowed-dependency table is what LLP 0225 §5 asked a machine-readable projection to be. Shared ranks (the four rank-3 domain crates; the three rank-7 roots) correctly imply no sideways edges. `snapback-runtime` depending only on `types` shows the matrix is stricter than rank, which is right.
- **Auth substrate at rank 2.** Putting auth below domain so sync, services, activation, and transport can consume it without sideways edges is the correct resolution of 0225’s “domain services may not depend on each other” once auth is a shared policy/state service. Keeping SQL in the kernel and shapes in types is the landed item-3 shape.
- **`snapback` at rank 7.** LLP 0141 D4 really does run `embed::production` through `cli::run_embedded`. The façade must sit above cli and server; `publish = false` plus “only `snapback::embed` is supported” is the right visibility story.
- **Replacement, not deletion.** Same-change membership in `driftFailClosedCoreGates`, analyzer alive (path-remapped) through the carves, worklist → `issues/closed/`, LLP 0232 administrative signature retirement — this is LLP 0189 D-4 (“coverage moves; it never vanishes”) applied honestly.
- **Port-inversion-before-move.** After Phase 1 the remainder is the top-rank crate, so `git mv` first would demand a compilable illegal edge. Naming the activation → `local.rs` frozen edge as the worked prerequisite is the 0225 first-slice lesson encoded as a rule.
- **Freeze control plane.** Server-side ruleset, writer-identity inventory, unloaded backstops, integration branch, fast-forward only, non-destructive rollback, npm as the irreversibility point — this matches how this fleet actually writes `main`.
- **Scope and abort.** Mandatory crate boundaries and mixed-owner splits versus ticketed within-owner `legacy` is the distinction r1 needed. Abort leaving `main` untouched and the RFC at Review is honest.
- **Right things left the window.** `scripts/` regrouping after the proof engine has given the final verdict (D5) is the correct ordering. D3/D4/D6/D7 close questions that were blocking design, not scheduling.

## MATERIAL concerns

### M1 — IN-DELTA — Auth/kernel module sketch undoes the item-3 cut the charter claims to preserve

**Where.** Crate table, `snapback-kernel` and `snapback-auth` “today’s principal modules”; external-dependency confinement; Relationship to LLP 0225 (§3 carries forward verbatim).

**Defect.** Kernel is assigned `storage.rs` + `storage/*` with “auth *behavior* excepted.” Auth is assigned `src/auth/*`, **`storage/auth_*` behavior**, `membership_rules.rs`, `dev_identity.rs`. After 0225 stages A2/A3, `storage/auth_catalog_ops.rs` and `storage/auth_sender.rs` *are* the kernel durable operations (transaction scope + SQL). `provider.rs` has zero connection-taking functions. Calling those kernel files “auth behavior” is the exact misread 0225 revision (n) ruled out.

If an implementer follows the module list:

1. Durable SQL/transaction code lands in `snapback-auth`.
2. That crate then needs `rusqlite`, which this RFC confines to `snapback-kernel` and the services telemetry sidecar.
3. Auth would own canonical-store transactions, which 0225 §3.1 — carried forward *verbatim* — forbids.

The other escape (kernel depends on auth because `storage/auth.rs` still names fence traits) is also illegal: kernel is rank 1, auth is rank 2. Remaining `storage/* → src/auth/*` edges must be inverted, not resolved by moving kernel files up or by adding an upward crate edge.

The charters are right. The assignment list fights them. On a flag-day this table is the move list.

**Resolve.** Rewrite the two “today” lists so they cannot be read as moving durable auth ops out of the kernel:

- **Kernel keeps** every `storage/auth_*` (and `storage/hosted_admission` etc.) that opens the canonical connection or runs SQL — the A2/A3 typed operations.
- **Auth takes** `src/auth/*` policy (provider, sender-proof decisions, hosted-edge *policy*, identity/lifecycle, throttle/rescue as policy), plus `membership_rules.rs` / `dev_identity.rs` if those are policy.
- **Types already hold** the published invalidation/epoch shapes.
- State explicitly: leftover `kernel → auth` edges are inversion prerequisites for *both* carves, not a reason to reassign the caller.

Until the table and the confinement/§3.1/item-3 claims describe the same cut, this decision is not implementable without violating another normative clause.

### M2 — IN-DELTA — Phase 2 crate-edge coverage is claimed and not actually provided

**Where.** Gate transition; Phase 1–3; Risks row “An illegal-but-compilable crate edge appears during the carves.”

**Defect.** The RFC’s safety argument is: the module analyzer is alive through Phase 2, the workspace-graph gate from Phase 3, and “Cargo will catch it” is *explicitly not* the argument.

The analyzer, per LLP 0225 §5, extracts `crate::` / `super::` / `self::` in a single-crate, file-path-keyed graph. That still works in Phase 1 (`src` → `crates/snapback/src`). It does not, as specified, see `snapback_auth::…` or a newly added `[dependencies] snapback = { path = "…" }` on a lower crate.

The illegal-but-compilable case is exactly “carve first, add the upward/sideways Cargo dep so it builds.” After the first real member besides `snapback` exists:

- `crate::` edges to extracted modules disappear from the remainder graph (imports were rewritten).
- A naive `crates/**` remap merges several crate roots and mis-resolves `crate::`.
- Per-crate runs only see same-owner interiors.

So crate-rank is unenforced for the whole carve window — the window in which those edges are most tempting. The workspace-graph gate arrives in the same change that *retires* the analyzer. Coverage at crate grain therefore lapses for days, then appears as a pile of Phase 3 refusals, which is the opposite of “coverage never vanishes.”

Path-remapping to `crates/**` is not an LLP 0225 §5 operational update once there are multiple crate roots. §5/§6 operational path updates assume one crate and file-path keys.

**Resolve.** Do one of the following, and delete the false risk mitigation:

1. **Preferred:** land a thin fail-closed `cargo metadata` ⊆ matrix check at the first multi-member workspace (end of Phase 1 / first Phase 2 carve). Keep the module analyzer on the shrinking remainder for `crate::` call-ups. Phase 3 still replaces the module analyzer and promotes the crate gate into `driftFailClosedCoreGates`.
2. Or extend the analyzer, before the first carve, to extract workspace package names and Cargo normal/build/dev edges, with fixtures for an upward dep added “to make it compile.”

Port-inversion-before-move is a good process rule. It is not a gate. This RFC already refused to treat process-plus-Cargo as sufficient; it should not then rely on an analyzer that cannot see the edges in question.

## Minor concerns

### m1 — IN-DELTA — The “machine-readable projection” is still a Markdown table

D2 says the matrix is what the workspace-graph gate validates. The only representation is a prose table with shorthands (“all rank ≤ 3”, “any lower”). LLP 0225’s projection was a committed JSON manifest. Specify a committed artifact (JSON/TOML) the gate reads, and that the RFC table is generated from it or drift-checked against it. Without that, Phase 3 invents a schema and 0189 D-4’s “recomputed value vs committed frozen record” bar is hand-waved.

### m2 — IN-DELTA — The hot-path escape is recorded on the wrong object

“A policy module that cannot leave sync … stays in sync, recorded in the matrix (the `mixedModuleScopes` spirit).” The matrix is crate-to-crate edges. The escape is *membership* (the module remains in `snapback-sync`). The replacement gate cannot express `mixedModuleScopes`. Say: stays in sync, listed in the path-migration / membership assignment, never a matrix exception.

### m3 — IN-DELTA — Flip does not require `mixedModuleScopes` to be empty

Mandatory Implemented includes “every mixed-owner file is separated.” The only tool that can see mixed interiors retires in the same change as the crate-level gate, which cannot see them. State a flip precondition, checked before retirement: `mixedModuleScopes` empty; every path sits in its owner crate; engine has no leftover activation/auth/search symbols. Otherwise “engine may not inherit leftovers” becomes unenforceable the moment it starts to matter.

### m4 — IN-DELTA — Only one carve prerequisite is named

Activation → `local.rs` is named; the general inversion rule covers the rest. The kernel carve is blocked on the remaining `storage/* → src/auth/*` (and kernel → sync/services) family — the reason item 3 existed. Name that set as the kernel/auth prerequisite the same way the activation edge is named, so Phase 2 does not discover it mid-window.

### m5 — IN-DELTA — Amendment authority is split without superseding 0225 §5’s sentence

0225 §5: this Decision is the amendment point for the owner set, ranks, and `allowedDependencies`. r2: 0276 becomes the amendment point for the projection; 0225 keeps §3. Say explicitly that 0225 §5’s amendment-point sentence is superseded for the projection, and that future crate/edge/owner changes amend 0276 (and record a pointer on 0225). Otherwise the next owner lands in the wrong document.

### m6 — IN-DELTA — Phase 3 work vs the mandatory set

Integration-test consolidation (≤ 12 `[[test]]` targets) is Phase 3 work in the move table but is not in the mandatory Implemented list. Either move it to the optional/ticketed set (with the isolation audit) or say a failed audit tickets the remainder and does not block Implemented / does not trigger abort.

### m7 — IN-DELTA — External confinement is incomplete relative to the crate table

`celld-ltx` is “services’ sole consumer” in prose but is not on the gate-enforced list (rusqlite / ibex-runtime / axum / clap). Add it, or say only those four are confinement-gated and celld-ltx is review-only.

### m8 — IN-DELTA — Writer inventory should name ruleset bypass actors

The lease is a GitHub ruleset. Org/repo admins and GitHub Apps often bypass required signatures / restrictions. Enumerate bypass actors in the writer inventory (alongside fleet, CI, both backstops, ticket publishers). Otherwise the inventory can be complete on paper and the freeze still porous.

### m9 — IN-DELTA — 0232’s module-ownership special case is not on the flip amendment list

0232 D-3: `module-ownership` keeps the set-based predecessor protocol and never enters generic Boolean inherited-red. At replacement, that sentence is false. Phase 4 already lists an 0225 amendment record; add a 0232 pointer so the special case is retired with the gate, not left as live protocol.

### m10 — PRE-EXISTING — Twelve auxiliary bins are still unmapped

The inventory counts 12 auxiliary bins. The move table places schemagen, conformance, tools, and examples, but not the rest. A Phase 0 manifest category (“every `[[bin]]` / `src/bin/*` → crate”) would close it; today they can land in the façade by default and blur the rank-7 charters.

## Suggestions (non-blocking)

- Cite LLP 0053 / the published epoch shapes (`AuthorizationStreamIncarnation`, terminal-cause records, lease/epoch ids already on the leaf) as the invalidation vocabulary, so “types-level shapes” is not a new undirected pile.
- State that 0225 characterization envelopes move with the carved modules and remain the inversion acceptance (byte-identical failing-name-set, not pass counts) — the Risks table already implies this.
- Retire the `unassigned` bookkeeping owner in the 0225 amendment list; it is implied by mixed-owner separation and is worth saying.
- For `snapback-conformance`, allow a direct `kernel` (and maybe `auth`) dep if fixtures name those types rather than hoping for re-exports.

## Open questions

OQ-A (duration) and OQ-B (operator identity) are correctly open. Neither is MATERIAL. OQ-B should include who holds integration-branch push rights and who is a ruleset bypass actor (see m8), but naming the person is an author ruling, not a missing design.

## What I am not asking you to reopen

- Whether there should be a flag-day.
- Auth-at-rank-2 as “laundering” sideways coupling — it is the right extra layer.
- Search/vector in the kernel with rebuild jobs in services (D4).
- Dropping intra-crate module analysis after a clean flip (crate = owner), provided m3’s flip predicate exists.
- Deferring `scripts/` regrouping (D5).
- Exact-commit complete batteries inside the freeze (author ruling + 0189 D-7).

## Recommended next step

Revise to r3 addressing M1 and M2 (and folding m1/m3 into the gate contract if cheap). Stay at **Review**. Do not accept on this text.

The MATERIAL concerns are entirely IN-DELTA. Under the capsule’s convergence rule that is still not READY.

VERDICT: NOT READY

## Round 3 — 2026-08-17 (final budgeted delta round)

- Reviewer: `grok-4.6`, reasoning effort xhigh; same runner, cwd = round-3 capsule
- Target revision (r3, sha256): `607bf4d64732a996ec978eddba2e8bfcb80b03b9d127fd3a26ea53a01ee8ad26`
- Capsule hash: `278292c8d6d0511947fb04e132c27a15d353c65630808c4bdfb36c89993abaa4`
- Instruction hash: `c6b8797820080b6c619f987aa1981809ebbe13cbf4b59ff60251110d718d6729`
- Blindness: structural; final delta round with enumerated r2→r3 delta
- Note: the first paragraph of the body is the runner's tool-narration preamble, preserved verbatim.
- Verdict: NOT READY — one MATERIAL (M1), IN-DELTA (Phase-1 confinement unimplementable); minors m1–m5 IN-DELTA, m6 PRE-EXISTING (minor)

### Verbatim review

I'll start by reading CAPSULE.md and the review-related skills so I follow the final-delta instructions exactly.CAPSULE.md is the review brief. Next I’ll load the RFC, the listed context LLPs, and the LLP 0005 review format so the classification stays exact.The capsule is a standalone review, not an artifact write. I’ll read the RFC and every listed context document in full.The RFC is loaded. I’ll now read the context LLPs and AGENTS.md and check the RFC against the enumerated r2→r3 delta.0225’s enforcement section was cut off; I’ll finish that, then read LLP 0000 and AGENTS.md for the remaining constraints.I have enough to judge the r3 overlap design against 0225, 0189, and 0232. One specification contradiction in the Phase 1 gate looks material; I’m writing the full classified review now.

# Review of LLP 0276 r3 — Ideal codebase architecture

**Document:** `llp/0276-ideal-codebase-architecture.rfc.md` (revision r3 only)
**Context (not under review):** `AGENTS.md`, LLP 0000, 0141, 0189, 0225, 0232
**Round:** final delta round. Author rulings (frozen-`main` window; supersession of LLP 0225’s execution posture) are treated as settled. Inventory figures of 2026-08-17 are treated as given.

## Overall assessment

r3 does the job a last delta is supposed to do. The r2 skeleton — physical crates for the 0225 map, invert-before-move, server-side freeze, integration branch, honest abort — is still the right program. The r3 patches are mostly the right patches: durable `storage/auth_*` stays in the kernel; the workspace-graph gate is live before the first carve; the matrix is a committed artifact; the auth/sync hot path is a membership exception plus a port pattern rather than a matrix hole; one qualification contract is used at entry and exit; Phase 4 qualifies the exact commit that ships.

Those repairs are real. They also introduced one specification contradiction that an implementer cannot execute as written. The headline r3 mechanism (full workspace-graph gate live from Phase 1, including external-dependency confinement) is incompatible with carving a monolith outward. Until that is resolved, the overlap design is not implementable without an unstated exemption, which is exactly the class of coverage lapse r3 exists to prevent.

## Strengths

- **Item-3 cut preserved, not relabeled.** The kernel row keeps every `storage/auth_*` file as typed durable operations (transaction scope + SQL). Auth takes `src/auth/*` policy plus `membership_rules.rs` / `dev_identity.rs`. Remaining `storage/* → src/auth/*` edges are named inversion prerequisites for *both* carves, with the binding rule “invert the edge, never reassign the calling file upward.” That matches LLP 0225’s A2/A3 finding (`auth_catalog_ops` is the scoping half; SQL that is a commit primitive moves down; policy stays up) instead of undoing it by moving calling files into `snapback-auth`.
- **Coverage overlap is the right shape.** Cargo cannot express illegal-but-acyclic crate edges; the module analyzer cannot see `snapback_auth` once a file has left the remainder. Putting the gate on the single-member graph *before* the first carve, keeping the analyzer on the shrinking remainder, and retiring it only behind a checked flip predicate is the correct replacement-with-overlap story (LLP 0189 D-4: coverage moves, it never vanishes). The risk row that used to claim the analyzer would cover Phase 2 crate edges is gone.
- **Matrix is a real projection.** `crates/allowed-dependencies.v1.json` (owner, rank, expanded edges, confinement, membership exceptions) is what the gate reads; the RFC table is drift-checked against it; widening amends this RFC. That is the 0225 §5 projection role, moved here as the r3 supersession states, while §3 commit authority stays on 0225.
- **Hot path is bounded.** Sync→auth is already a legal downward edge, so a matrix exception would have been the wrong instrument. The port pattern (compile/publish in auth, evaluate locally against LLP 0053 leaf shapes, refresh off the fan-out path via existing invalidation delivery) plus a *named* membership exception with a burn-down ticket is the right pair of target and escape.
- **One qualification contract.** “No new and no unexcluded reds, with signature continuity to the entry record” is used at freeze, Phase 1, Phase 4, witnesses, fast-forward, and publication. That is the 0189 D-1 / 0232 signature discipline applied to a freeze, and it is what stops an inherited red from turning a 72-hour layout program into an unbounded repair program.
- **Phase 4 order is now the one that can claim an exact SHA.** Docs land on `rearchitecture/0276` *before* the battery; the battery qualifies that head; `main` fast-forwards to the identical SHA; npm publishes from that SHA while the lease still holds; backstops and lease release only afterward. The irreversibility point remains publication (LLP 0041), not the fast-forward, and shared `main` is still never rewritten.
- **Smaller r3 items landed cleanly.** `Related:` restored; `celld-ltx` confined to services; `[profile.production]` instead of a package-level `lto` (which Cargo cannot carry); straggler-gate exceptions by category rather than an accumulating allowlist; ruleset bypass actors in the writer inventory; aux-bin destinations named; integration-test consolidation explicitly optional; conformance may depend on kernel and auth; `unassigned` retires at the flip; 0232 D-3’s `module-ownership` special case is amended by pointer when the gate it names retires; 0225 characterization envelopes (identical failing *name-sets*) remain inversion acceptance.
- **Scope rule stays honest.** Boundaries and mixed-owner splits are mandatory; within-owner drainage is tickets; abort never fast-forwards a partial tree and never retires the ownership arm. That is compatible with LLP 0141 (façade re-exports, `publish = false`, D6 still unclaimed) and with the settled flag-day ruling.

## Concerns

### MATERIAL

**M1 — IN-DELTA — External confinement as specified cannot be live on the Phase 1/Phase 2 remainder.**

The r3 gate contract is one object with four checks, landed in Phase 1 against a *single* member:

> validates: every workspace member carries an owner/rank assignment; every normal, build, and dev dependency edge is within the matrix; **the external confinement list holds**; an unassigned new member fails closed. **It lands in Phase 1 — validating the then-trivial single-member graph.**

Confinement is exclusive: `rusqlite` only in `snapback-kernel` and `snapback-services`; `ibex-runtime` only in `snapback-runtime`; `axum` only in `snapback-server`; `clap` only in `snapback-cli`; `celld-ltx` only in `snapback-services`.

Phase 1 is `git mv src crates/snapback/src` — one member, the future façade, still linking all of those externals. A fail-closed reading of “the external confinement list holds” is red on day 1. That red has no entry-record lineage (the gate does not exist at freeze), so the new qualification contract *also* refuses Phase 1.

The contradiction continues through Phase 2. The remainder stays `snapback` until the last confined crate is extracted (`clap` leaves only when `snapback-cli` is carved, after server). The moment `snapback-kernel` exists, “`rusqlite` only in kernel and services” fails as long as the remainder still carries telemetry’s `rusqlite` (services not yet carved) or any leftover kernel link. So this is not a Phase 1 vacuity nit. It is the carve-from-monolith strategy versus exclusive confinement, created by moving the *full* gate left into Phase 1.

“Trivial single-member graph” is true of *workspace edges*. It is false of confinement. The risk table now says the gate “holds the crate graph”; the normative validation list still includes confinement with no remainder exemption and no staging.

This is not a detail demand on an otherwise executable decision. As written, the r3 overlap either cannot land green or must silently drop confinement — the same class of unstated coverage hole r3 set out to close.

**Resolution (one of, stated in the gate-transition and Phase 1/2 paragraphs):**

1. **Stage the checks.** Phase 1 enables assignment + workspace-edge validation only. Confinement arms per extracted member as that member appears, and applies to the façade only at the flip.
2. **Name a remainder exemption.** Confinement is enforced for every extracted member from the moment it exists; the uncarved remainder is exempt until the flip predicate, at which point the exemption ends and the façade must be clean.
3. **Split the artifact.** Edge matrix and confinement rules are separate inputs with separate activation predicates; the RFC says so.

The flip predicate must then include “confinement holds with no remainder exemption.” Until one of these is written, implementers cannot satisfy both “gate live from Phase 1” and “confinement list holds.”

### minor

**m1 — IN-DELTA — `src/auth/*` is path-coarse against 0225’s leaf-owned files under that tree.**

Auth’s “Today” line assigns `src/auth/*` to `snapback-auth`. LLP 0225 already placed `src/auth/identity_core.rs`, the step-up shapes in `src/auth/crypto.rs`, and `src/auth/service_authority_contract.rs` on the contract leaf, and placed `src/auth/throttle.rs` on the kernel so `auth_rehearsal → throttle` would stay kernel→kernel. The types-crate principal-module list does not name those files.

The invert-before-move rule still saves the architecture if followed (a `storage/* → src/auth/*` import inverts downward into `snapback-types` or stays in kernel; the calling file is never reassigned up). That is why this is not MATERIAL. An implementer who treats the Today line as a directory move will first create illegal kernel→auth edges, then have to undo them.

**Resolution:** In the types and auth rows, name the already-leaf `src/auth/*` modules as types, and say whether `throttle.rs` stays kernel (0225 A1) or moves to auth *after* the `auth_rehearsal` call-up is inverted. Do not leave “`src/auth/*`” unqualified.

**m2 — IN-DELTA — Flip predicate vs named membership exceptions.**

The flip requires “every module’s path inside its owner crate per the membership assignment.” The hot-path escape is a file that *does not* live in its charter owner’s crate. These two r3 features fit if “membership assignment” includes the JSON exceptions. They conflict if “owner crate” is read as `auth-substrate`.

**Resolution:** One clause: a named membership exception *is* that module’s assigned home for the flip; the flip fails closed on any unmatched file, including an exception that was not named.

**m3 — IN-DELTA — Auth charter still says it owns “state.”**

The same r3 sentence that correctly keeps durable `storage/auth_*` in the kernel still opens with “session/credential/lease/custody state.” Kernel owns the durable operations; auth owns policy, epochs/leases as published through leaf shapes, and substrate behavior. The Today line and the item-3 gloss already say this. The charter line can still be read as putting the store in auth.

**Resolution:** Replace “state” with “policy and published substrate surfaces”; keep durability in the kernel row.

**m4 — IN-DELTA — Language-policy table was not updated with the LTO repair.**

Workspace rules correctly require `[profile.production]` because package overrides cannot carry `lto`. The language-policy table still says “fat LTO on the binary package only,” which is the instruction r3 just retired.

**Resolution:** Point that cell at `cargo build --profile production -p snapback`.

**m5 — IN-DELTA — When the new gate joins which registries.**

The gate “lands” in Phase 1 but joins `driftFailClosedCoreGates` only at the flip. That split is reasonable (analyzer remains the fail-closed *core* member during overlap). It is not said whether Phase 1 also registers the gate in the canonical inventory / selection policy so the Phase 1 complete battery actually runs it. A gate that exists in-tree but is not selected is not “live” in the sense the risk table needs.

**Resolution:** Phase 1 registers the gate as a selected canonical/drift member; Phase 3 only *promotes* it into `driftFailClosedCoreGates` in the same change that retires the analyzer.

**m6 — PRE-EXISTING — “Session-revocation projection” can be read as moving `SessionProjection`.**

0225 left `SessionProjection` (36 methods) in the sync engine on purpose. Auth’s charter “session-revocation projection” is almost certainly the 0053 publication (epochs, lease ids, terminal-cause records), which the port-pattern sentence describes correctly. The names collide.

**Resolution:** Use “revocation publication” / “0053 leaf shapes,” and say `SessionProjection` stays in `snapback-sync`.

## Suggestions (non-blocking)

- Generate the Phase 1 baseline remap as a single prefix-relocation of the 0225 complete-graph fingerprints, each naming its predecessor path and retaining the owner pair. §2 already allows relocation re-keys; revision (v) is fail-closed on owner-reassignment re-keys. A naive search-replace will look like 1,704 new edges under the set-based protocol. This is implementation protocol, not a missing decision.
- At flip, state that the remainder confinement exemption (M1) ends in the same change as analyzer retirement and `driftFailClosedCoreGates` promotion.
- Narrowing the JSON (removing an allowed edge) can stay operational; only widening needs an RFC amendment. Worth one sentence so Phase 2 does not treat every matrix edit as a mid-window RFC revision.

## Open questions

OQ-A (freeze duration) and OQ-B (operator and bypass identities named in the acquisition receipt) are the right things to leave open. They are operational parameters of an authorized freeze, not missing architecture.

No additional open question is required for READY after M1. The remainder/confinement rule is a decision the RFC must make, not an author question.

## Recommended next step

Revise r3 for **M1** (and fold m1–m5 if cheap). Stay in `Review`. Do not accept on this text. m6 can ride the same pass or a later pointer.

The rest of the r3 delta is in good shape: the item-3 assignment, invert-never-reassign, committed matrix, membership-not-edge hot-path escape, single qualification contract, and Phase 4 lease-held publish order are the right closures. One unimplementable sentence in the overlap contract is what keeps this off READY.

VERDICT: NOT READY
