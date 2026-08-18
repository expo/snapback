# LLP 0276 review — codex family

## Round 1 — 2026-08-17

- Reviewer: codex `gpt-5.6-sol`, reasoning effort xhigh, sandbox read-only
- Runner: `codex exec --skip-git-repo-check -m gpt-5.6-sol -c model_reasoning_effort=xhigh -s read-only`, cwd = round-1 capsule
- Target revision (sha256): `146719f4facc3c8bc3c0e745d31c0a4b00cb051c94273893fa6f582ccfc85fc5`
- Capsule hash: `9c9db94f4c11b3840de31f2657424f17fa0a40a50364bdbbfd766c8b167db1a8`
- Instruction hash: `af49d7a97f88635a720532d65ce82d8f966b3837ceec95554c53a6b848865e09`
- Blindness: structural (capsule contains no review artifacts, run journal, or orchestrator notes)
- Verdict: NOT READY

### Verbatim review

## Overall assessment

The direction is strong: making LLP 0225’s ownership boundaries physical, preserving the contract/npm/corpus surfaces, carving bottom-up, and requiring exact-commit proof during the authorized freeze are sound choices. The measured inventory is internally plausible; no stated figure needs spot-verification based on this capsule alone.

The RFC is not ready, however, because the proposed workspace does not yet enforce the architecture it claims to enforce, contains unresolved dependency contradictions, and lacks a safe authoritative freeze/rollback protocol.

## MATERIAL concerns

M1. **Cargo does not replace the ownership gate or enforce commit authority as claimed.** Cargo rejects dependency cycles, but it does not understand ranks or prohibit an acyclic sideways/upward dependency. For example, one rank-2 service can depend on another rank-2 service and compile. Nor does Cargo prevent a domain crate from adding `rusqlite`, obtaining a canonical-store handle, or bypassing typed kernel operations. Dev-, build-, optional-, and feature-gated dependencies further weaken the claim that every edge is mechanically downward. `members = ["crates/*"]` also admits new crates without assigning them an owner. Retiring the entire ownership mechanism therefore violates LLP 0189’s “coverage moves; it never vanishes” rule and leaves LLP 0225 §§2–3 weaker than before.

Resolution: replace the module analyzer with a substantially smaller workspace-topology gate over `cargo metadata`. It must bind every product crate to an owner/rank, validate an explicit allowed-dependency matrix across normal/build/dev dependency kinds, constrain product-facing external dependencies such as `rusqlite`, and fail closed on new workspace members. Canonical-store connection and transaction capabilities must also be private to the kernel, with explicit typed exceptions for telemetry’s sidecar and any legitimate search bindings. Retire only the file-level baseline/analyzer after this replacement is live and every grandfathered edge is gone.

The retirement lifecycle must also preserve governance history: the ratchet worklist is an `issues/` corpus artifact and must be resolved and moved to `issues/closed/`, not deleted. Any open ownership-gate health signatures must receive LLP 0232’s administrative registry-retirement event.

M2. **The proposed crate graph already contains forbidden or undefined edges.** `snapback-cli`, `snapback-server`, and `snapback` are all rank 3, yet the table explicitly says the façade binary consumes `snapback-cli`; LLP 0141 also requires `snapback::embed` to expose server types and reuse the CLI-owned production lifecycle. Those are rank-3-to-rank-3 dependencies, contrary to the RFC’s strict-decrease rule and LLP 0225’s prohibition on sideways owner dependencies. The same question arises for `snapback-conformance`. Meanwhile, `snapback-tools` has no rank, `snapback-conformance` has no owner, and `snapback-schemagen` appears in the generation pipeline without a declared package/bin location. The graph therefore is neither complete nor faithful to the claimed policy.

Resolution: provide the exact package/target dependency graph and reconcile every edge. Plausible designs include combining server and CLI under one transport-owner crate, extracting a shared lower-level startup composition service, or introducing and ratifying a rank-4 composition root above the transport and embed adapters. Assign or formally quarantine tools, conformance, schemagen, examples, and test-only dependencies. The graph must explicitly demonstrate how LLP 0141’s façade, production builder, examples, final binaries, and Hermes rpath custody work without a forbidden edge.

M3. **The RFC leaves central target-architecture decisions open and inconsistently records its amendments to LLP 0225.** OQ2 can still accept or reject the new auth/runtime/engine ownership map; OQ5 can change the crate decomposition; and OQ4 leaves the document’s stated language policy awaiting ratification. Those are the RFC’s subject, not implementation follow-ups. In addition, the text says there are three ownership amendments—auth, runtime, and engine—but also creates `snapback-search` as a separate rank-2 boundary without consistently declaring whether it is a new owner or merely another crate belonging to `background-services`. OQ2 and the LLP 0225 relationship section omit search.

Resolution: close OQ2, OQ4, and OQ5 in the RFC; state the canonical owner id, rank, allowed dependencies, and commit obligations of every product crate; and record every amendment consistently. Convert OQ3 and OQ6 into firm “follow-on, not in-window” decisions, since the body already chooses that disposition. OQ1 and OQ8 may be explicitly deferred.

M4. **The freeze mechanism is not authoritative enough to guarantee frozen `main`.** A tracked local pre-push hook plus an AGENTS.md banner does not constrain clones without the hook configured, `--no-verify`, GitHub/API writes, other automation, or LLP 0232’s authorized source-ticket publisher. The `[0276]` trailer authenticates a message convention, not an authorized writer. Unloading two launchd jobs covers only two known writers. Consequently, the exact-HEAD proof premise can be invalidated by a writer outside the local hook.

Resolution: define a centrally enforced freeze lease—such as a temporary repository ruleset/branch lock or an allowlist containing exactly the migration identity—and inventory every identity capable of writing `main`, including CI, bots, ticket publishers, and scheduled processes. Record acquisition and release receipts and specify the ordering for the final proof, administrative guard removal, backstop restoration, and unfreeze so no unproved commit can enter between proof and release.

M5. **The rollback procedure is destructive and does not actually describe a safe rollback of shared `main`.** `git reset --hard` only resets a local worktree; making shared `main` match the tag would require a non-fast-forward force push. That rewrites the migration commits, conflicts with the RFC’s history-preservation principle, complicates paused worktrees, and may conflict with LLP 0232’s ancestry-based health records and protected pointers.

Resolution: either perform the migration on a protected integration branch and fast-forward `main` only after final qualification, or define normal revert commits for already-landed phases. Preserve migration commits under durable refs, prohibit force-resetting shared `main`, and define how proof/health records and temporary freeze controls are reconciled after rollback.

M6. **The stopping rules contradict one another, and the proposed “legacy module” escape hatch cannot cover mixed-owner files.** The scope rule requires every file to be in its final crate and every dependency edge valid at unfreeze. The risk table instead permits lifting the freeze after Phase 1, when everything remains in a single `crates/snapback` member and none of the physical ownership map exists. Those cannot both be valid outcomes. Further, a large module can remain as `legacy` inside one crate only when all of its contents belong to that owner. The documented mixed-owner interiors of `local.rs` and `manifest.rs` must be separated before either file has an honest final owner; calling the remainder “legacy” does not solve ownership.

Resolution: distinguish mandatory owner-boundary extraction from optional within-owner file drainage. Unfreeze as “Implemented” only after every mixed-owner boundary is separated and all product dependency edges conform. If Phase 1 is retained as an emergency stopping point, define it as a partial skeleton outcome: preserve the ownership gate, keep this RFC unimplemented, file the remaining program, and do not claim the target layout is final. Otherwise extend or roll back the freeze.

M7. **The path-sensitive migration plan is incomplete and its proof argument is circular.** Phase 1 names several `src/` consumers, but Phase 3 also moves almost the entire proof/release/bootstrap script surface. The RFC does not account systematically for tracked hooks, installed launchd paths, package scripts, stable commands documented in AGENTS/guide pages, source-reading generators named by LLP 0225, Cargo/build-script relative paths, `include_bytes!`/`CARGO_MANIFEST_DIR` assumptions, claim and release scopes, Cloudflare deployment roots, or external path-dependent embed fixtures. A `grep` limited to `src/` references in scripts/workflows/JSON cannot cover those categories. The RFC itself records that some tests are absent from every inventory; therefore “the complete battery is fail-closed” cannot prove that a moved or omitted entry point still runs. Moving the proof runner and then asking that runner to validate its own complete registration compounds the problem.

Resolution: make a checked path-migration manifest and bootstrap acceptance part of the decision. It should cover all executable entry points, installed integrations, generated/frozen records, build-time embedding/link paths, documentation commands, and each standalone target/client. Preserve stable command shims where they are public operational interfaces. Validate the new proof runner independently before trusting its complete result, then run cold-clone witnesses for the Rust binary, npm closure, external/path-based embed consumer, Cloudflare target, Swift fixtures, admin UI, and website as applicable.

M8. **The final “complete battery green” condition lacks a pre-freeze entry condition.** LLP 0189 deliberately permits scheduled canonical reds to remain visible fix-forward work. The RFC nevertheless requires an entirely green exact final HEAD without first requiring the freeze-point commit to be green. An inherited unrelated red could therefore be discovered only after the fleet is stopped and turn a 72-hour layout migration into an unbounded defect-repair program.

Resolution: qualify the freeze point before acquiring the freeze: run the exact canonical inventory and require a determinate green result, or explicitly enumerate and resolve every existing red before structural work starts. Record that entry result with the freeze tag. If final success means fully green, inherited reds must not be silently admitted at exit.

## Minor concerns

m1. Integration-test consolidation is not wholly mechanical. Separate Cargo targets currently provide process isolation for environment variables, ports, working directories, globals, panic/abort behavior, and runtime initialization. Treat ≤12 as a goal, retain dedicated targets where isolation is semantic, and require an isolation audit before merging suites.

m2. The stated target of approximately 20 root entries does not match the displayed tree, which contains well over 20 actual entries once dot-directories, manifests, and corpora are counted. Either change the metric or remove the numeric target.

m3. “Committed generated artifacts always live in a `generated/` segment” conflicts with retained exceptions such as root `schemas/` and `guide/*.generated.*`. Record these as explicit stable-path exceptions and state whether all 23 fixture/registry files under `schemas/` are generated or authored.

m4. The diagnosis of `build.rs` says only Hermes rpaths naturally belong there, but the target leaves guide embedding, build identity, and rpaths together in `crates/snapback/build.rs`. The workspace does reduce their rebuild scope, which is useful, but the RFC should describe that as the resolution rather than claiming the unrelated-job problem has been split away.

m5. The language/workspace table omits the policies for `admin-ui/`, `website/`, and `targets/cloudflare/`, despite those being target-layout components containing non-Rust code. State which lockfile and install root owns each, and confirm that `packages/*` remains the only root Bun workspace membership.

m6. Until the separate LLP 0141 D6 distribution program exists, internal Rust crates should default to `publish = false`. OQ1 name reservation is not required for this rearchitecture.

m7. Phase 0’s deletion sets should be driven by an explicit reviewed manifest rather than filename classes alone. Local worktree cleanup must also audit dirty/unpushed work, not merely running processes; it should remain operational housekeeping rather than a completion dependency for the repository layout.

m8. The no-file-over-3,000-lines convention needs to say that same-owner `legacy` modules are temporary recorded exceptions. Otherwise it conflicts with the permitted post-window drainage backlog.

m9. Normalize the test naming spelling: the body uses `snake_case_v N`, while OQ8 uses `snake_case_vN`.

## Altitude-rule dispositions

- The exact file-by-file carve order, precise `legacy` filenames, detailed integration-test grouping, and exact 72-hour task schedule are implementation-phase matters. They are not MATERIAL provided the owner-boundary, dependency, isolation, and exit invariants above are decided.
- The concrete entries in the path-migration manifest are implementation work; requiring a non-circular manifest, its coverage categories, and an independently bootstrapped proof transition is MATERIAL because the current safety argument otherwise does not hold.
- Crates.io name reservation, the two test-name stragglers, and the exact root-entry count are minor or deferrable.
- Keeping inventory unification and release-state-machine consolidation out of this window is a sound scope decision. The RFC should state that disposition directly rather than leave OQ3/OQ6 nominally unresolved.

VERDICT: NOT READY
## Round 2 — 2026-08-17 (delta round)

- Reviewer: codex `gpt-5.6-sol`, reasoning effort xhigh, sandbox read-only; same runner as round 1, cwd = round-2 capsule
- Target revision (r2, sha256): `9bc91e790aa6d9c773520220e16518941669a169e4b0052241c6298d664c28e5`
- Capsule hash: `4a45ddbe1893ea0d643fc2a0443457a991a18d828a0d2a56c56557fc18792b12`
- Instruction hash: `5ce55c83baedca9a3e1d6919ac391bb97b076ab3c04a7ae7ab97e0076ea6a307`
- Blindness: structural; delta round with enumerated r1→r2 delta and IN-DELTA/PRE-EXISTING classification
- Verdict: NOT READY — all four MATERIALs IN-DELTA; reviewer states no PRE-EXISTING MATERIAL found

### Verbatim review

## Overall assessment

Revision r2 substantially strengthens the proposal, especially the crate matrix, auth substrate, gate replacement, migration ordering, freeze lease, and abort path. However, four unresolved material concerns remain. All are **IN-DELTA**; I found no **PRE-EXISTING** material concern.

## Material concerns

**M1 — IN-DELTA — Enforcement coverage lapses during Phase 2.**

The existing analyzer is only “path-remapped to `crates/**`,” while [LLP 0225](/private/tmp/claude-501/-Users-ccheever-projects-snapback/a2411b02-105f-419e-a4b8-05f1103e9714/scratchpad/0276-loop/capsule-r2/llp/0225-core-modularization.decision.md:997) describes an extractor for intra-crate `crate::`, `super::`, and `self::` references. Once a carve creates dependencies spelled as external crate paths, the RFC supplies no mechanism by which that analyzer maps them back to owners. The workspace-graph gate does not land until Phase 3. Consequently, a compilable but matrix-illegal cross-crate edge can be invisible during Phase 2, contradicting “coverage moves; it never vanishes” and the stated carve-time mitigation.

Resolve by activating the workspace-graph gate before the first crate carve—initially alongside the old analyzer—or by explicitly extending and proving the old analyzer’s cross-crate coverage. Retirement should occur only after overlapping coverage has been demonstrated.

**M2 — IN-DELTA — The auth/sync hot-path escape is not a bounded ownership rule.**

The auth row permits a policy module that cannot leave sync to remain there, supposedly “recorded in the matrix.” But the sync charter does not identify such a module or precise exception, and the replacement Cargo graph can observe only crate edges—not whether arbitrary auth policy has accumulated inside `snapback-sync`. Retiring `mixedModuleScopes` therefore turns a correctness-sensitive exception into an unenforceable, open-ended escape.

Resolve by deciding the concrete seam: name the residual module and its exact policy/evaluation responsibility, specify how auth state or compiled policy reaches the fan-out path and refreshes atomically, and record the bounded exception in a machine-checked ownership artifact. Alternatively, define a port that keeps policy in auth while allowing sync-local evaluation without a per-row cross-crate call.

**M3 — IN-DELTA — Entry qualification and exit qualification contradict each other.**

The entry condition allows a battery with enumerated inherited reds explicitly excluded from exit criteria. Phase 1 and Phase 4 nevertheless require the complete battery to be “green,” and publication is described as requiring the complete battery to have passed on the exact head. A permitted inherited red can therefore make the program impossible to finish despite having been explicitly excluded.

Choose one contract consistently:

- Require a fully green freeze point; or
- Define qualification as “no new or unexcluded reds,” with signature continuity for every inherited exclusion, and use that definition in Phases 1 and 4, cold-clone evaluation, merge, and publication.

**M4 — IN-DELTA — Phase 4 does not preserve the qualified commit through documentation and publication.**

The branch is qualified, then `main` is fast-forwarded, then documentation catch-up occurs. Any catch-up commit means the final `main` head is no longer the exact qualified branch head, contrary to the author ruling and the integration-branch contract. The sequence also releases the ruleset lease before npm publication; on this continuously moving repository, publication can then race away from the qualified rearchitecture commit unless a pinned-source protocol is stated.

Put all required documentation and implementation records on the integration branch before final qualification. Then qualify and cold-clone-test that exact head, fast-forward `main` to the identical SHA, publish the pinned closure while the lease still holds, and only afterward release the lease and reactivate writers/backstops.

## Minor concerns

**m1 — PRE-EXISTING — Required metadata is incomplete.**

[LLP 0276](/private/tmp/claude-501/-Users-ccheever-projects-snapback/a2411b02-105f-419e-a4b8-05f1103e9714/scratchpad/0276-loop/capsule-r2/llp/0276-ideal-codebase-architecture.rfc.md:1) lacks the standard `Related` header required by AGENTS.md. Add at least LLP 0000, 0141, 0189, 0225, and 0232.

**m2 — IN-DELTA — The matrix’s machine-readable projection is not identified.**

The Markdown table is called the normative and “machine-readable” projection, but no versioned policy artifact, Cargo metadata schema, or checker-owned constant is named. Specify the source the gate reads and how widening it is coupled to an RFC amendment.

**m3 — IN-DELTA — The LTO instruction is technically ambiguous.**

Cargo package overrides cannot specify `lto`, and a selected profile applies to the build’s targets. The RFC should name a custom product-release profile or exact release command rather than saying fat LTO stays “on the binary package.” See the official [Cargo profile rules](https://doc.rust-lang.org/stable/cargo/reference/profiles.html#overrides).

**m4 — IN-DELTA — The straggler gate needs an exception contract.**

“Greps for stragglers of the moved roots” does not distinguish live consumers from intentional historical text, negative fixtures, or dynamically composed paths. Define manifest categories, allowed historical/fixture exceptions, and the exact searched projections so the gate is deterministic rather than an accumulating ad hoc allowlist.

## Recommended next step

Revise M1–M4, apply the minor corrections, and run another delta round. Because every material concern is **IN-DELTA**, the pre-existing-text convergence condition is satisfied, but this revision is not yet ready.

VERDICT: NOT READY
## Round 3 — 2026-08-17 (final budgeted delta round)

- Reviewer: codex `gpt-5.6-sol`, reasoning effort xhigh, sandbox read-only; same runner, cwd = round-3 capsule
- Target revision (r3, sha256): `607bf4d64732a996ec978eddba2e8bfcb80b03b9d127fd3a26ea53a01ee8ad26`
- Capsule hash: `278292c8d6d0511947fb04e132c27a15d353c65630808c4bdfb36c89993abaa4`
- Instruction hash: `c6b8797820080b6c619f987aa1981809ebbe13cbf4b59ff60251110d718d6729`
- Blindness: structural; final delta round with enumerated r2→r3 delta
- Verdict: NOT READY — two MATERIALs (M1 qualification-vs-0189-D-6, M2 lease exclusivity), both IN-DELTA; "no PRE-EXISTING material concern"

### Verbatim review

## Overall assessment

Revision r3 substantially improves the RFC. The kernel/auth assignment now matches LLP 0225’s A2/A3 outcome; workspace/module enforcement overlaps through the carve; the committed matrix and bounded hot-path exception are coherent; and Phase 4 now qualifies, fast-forwards, and publishes the same pinned commit.

Two unresolved MATERIAL concerns remain, both IN-DELTA. I found no PRE-EXISTING material concern.

## Material concerns

**M1 — IN-DELTA (deltas 5–6): the unified qualification contract is incompatible with the governing publication contract.**

The RFC says every entry-excluded red remains admissible through Phase 4 and publication. LLP 0189 D-6 instead requires green scoped evidence and a complete battery green on every claim-relevant gate; only unrelated reds may be ticketed without blocking. LLP 0232 likewise says npm publication retains its qualified blocking protocol.

The entry application is also circular: signature continuity is defined against the entry record being created, so “no new reds” has no prior observation against which “new” is evaluated. As written, a fresh material failure could be dispositioned at entry and then remain permanently non-blocking—including for publication.

Resolve this by adding a required-green scope to the common contract:

- Anchor entry continuity to a named prior eligible battery, or explicitly define entry as baseline creation while forbidding exclusions for migration-critical gates.
- Require all cold-clone witnesses and npm claim-relevant gates to be green.
- Permit inherited/ticketed entry reds only outside the required-green scope.
- State that publication additionally satisfies LLP 0189 D-6 unless an explicit author amendment changes it.

**M2 — IN-DELTA (delta 7): enumerating bypass actors does not make the ruleset an exclusive lease.**

The freeze section claims that the server-side ruleset restricts `main` pushes to one operator, but then allows the acquisition record to identify admin/App identities that retain bypass. A retained bypass grant is still write authority; inventory makes it visible but does not enforce exclusivity. This contradicts “a server-side lease, not a convention” and can invalidate the exact-SHA/no-intervening-write premise.

The acquisition predicate must verify that effective write authority—including every ruleset bypass path—is limited to the operator for the full window. Any other bypass grant must be revoked or technically disabled, with that state included in the receipt. OQ-B may choose the operator, but it cannot leave non-operator bypass authority live while calling the lease exclusive.

## Minor concerns

**m1 — IN-DELTA (delta 1):** The `snapback-auth` row still says `src/auth/*`, although LLP 0225 assigns leaf-shaped material under that tree—such as the shapes in `auth/crypto.rs` and `auth/service_authority_contract.rs`—to the contract leaf. The “policy” qualifier suggests the correct intent, but the migration inventory should explicitly preserve those leaf assignments.

**m2 — IN-DELTA (delta 3):** The matrix requires an owner ID for every workspace member, but `snapback-conformance` and `snapback-tools` have only parenthetical role labels, and the ownership-amendment section does not define corresponding owners. Give them canonical IDs or state the explicit non-product ownership rule the gate applies.

**m3 — IN-DELTA (delta 7):** `[profile.production]` is the correct Cargo mechanism, but it does not confine `lto` and `codegen-units` to the binary package; the profile applies across the selected build graph. Replace “fat LTO on/confined to the binary package” with “fat LTO in the dedicated production build.”

**m4 — IN-DELTA (delta 7):** Exempting `llp/` and `issues/` categorically from the straggler gate is too broad. LLPs are living normative documents and open issues can contain current commands. Restrict the exemption to tombstones, closed tickets, explicitly historical sections, and named fixtures, while checking active normative text.

**m5 — PRE-EXISTING:** The Risks section permits stale `@ref` glosses to become follow-up work, while AGENTS.md requires touched annotations to be checked and updated or removed. Semantic validation of annotations on files changed by inversions and splits should be a phase obligation; only untouched-corpus auditing should defer.

The architectural direction is otherwise coherent. Fixing M1 and M2 should be followed by one narrow delta review of those corrections.

VERDICT: NOT READY