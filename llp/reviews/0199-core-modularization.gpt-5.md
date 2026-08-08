# LLP 0199 — GPT-family review artifact

Provenance and per-round verbatim reviews for the GPT model family (reviewer:
gpt-5.6-sol @ xhigh, via codex exec — independent of the reviser/author session).

---

## Round 1 — 2026-08-08

- **Target:** `llp/0199-core-modularization.decision.md`
- **Revision (git blob):** `a517a7508b8afdc1db96712667dc2e74ecf5af8b`
- **Capsule sha256:** `f5dbf6a185f9bb2e16db4231db3822af8e97fea94ddbf00a943531500cabce86`
- **Topology:** single target, independent loop (no cluster)
- **Reviewer:** gpt-5.6-sol @ xhigh (codex exec; blind to the Claude review and to orchestrator/author notes)
- **Blindness basis:** structural — no review artifacts existed at launch (round 1); reviewer received only the target + repo read access.
- **Verdict:** NOT READY

### Verbatim review

LLP 0199 is not ready. The no-rewrite decision and preserved invariants are sound, but three material defects remain.

Quantitative verification: at introducing commit `22674b8`, `git show <commit>:<file> | wc -l` confirms 59,297 / 50,573 / 36,359 / 16,633 lines. The main test modules begin at 31,346 and 26,566, confirming 31,345 and 26,565 preceding lines. The 192 / 122 / 104 coupling figures reproduce with path-limited, non-merge `git log --name-only`; an unsimplified patch census gives 192 / 123 / 104. These metrics need a pinned commit and method—current HEAD `68fbbb6` had already grown to 59,575 / 50,633 / 36,398 / 16,633.

1. **The P0 is assigned to the wrong boundary.** The projection-digest P1 genuinely belongs to function-generation activation: historical `src/local.rs:5001` rebuilds projections before installing the manifest, while `src/storage.rs:9186` commits their digests independently. But the P0 was caused by migration admission failing to persist predecessor-manifest bytes and rollback trusting `self.schema` (`git show 22674b8:src/storage/migration_executor.rs`, admission around 574/1715 and rollback around 2399). Commit `172a9a3` confirms the distinction: P1 compensation changed activation code; P0 was fixed within the migration journal/rollback executor. LLP 0081 §§2, 4, and 6 already assign this durable state to the migration/storage owner. OQ2 is therefore misframed: these are distinct boundaries, not alternative owners for the same P0.

2. **The ownership and atomicity model is ambiguous.** “Transport → domain services → kernel” is directionally sound, but the six owners are not assigned to those layers, embedding appears in both owners 5 and 6, and owners 1 and 2 both claim publication. Cloudflare also cannot literally consume Rust domain modules; shared language-neutral contracts and target-local implementations must be distinguished. More importantly, activation currently spans separate SQLite commits, durable auth/deployment state, in-memory manifests, telemetry, routes, cron/config, and deferred callbacks. The Decision must settle which generation is atomic, which durable fact controls crash recovery, and whether the coordinator gets one composite kernel commit or uses a journaled/compensating protocol. This is the missing load-bearing author decision. OQ4 cannot select an enforcement mechanism before that graph exists, and “advisory” conflicts with Acceptance’s requirement to prevent collapse.

3. **The “cosmetic, non-gated” split is unsafe as written.** Although `scripts/runtime-build-inputs.txt` covers all of `src`, [local-proof-selection-policy.v1.json](/Users/ccheever/projects/snapback/scripts/local-proof-selection-policy.v1.json:251) names exact god-file paths, [guide-lib.mjs](/Users/ccheever/projects/snapback/scripts/guide-lib.mjs:548) reads `src/server.rs`, and `capability-maturity.mjs` directly reads `src/manifest.rs`. Moving responsibilities into sibling modules without transferring those triggers can detach domain-specific gates from their governed code, contrary to LLP 0189 D-4. OQ3 must require same-change migration of selectors, frozen-record gates, source-reading generators, and live citations; it cannot offer blanket “non-gated background work.”

The strangler strategy remains feasible, generation activation may still be the right first function-level slice, and the server-authority/single-writer/wire-contract/capability-honesty invariants are preserved correctly. The review artifact is recorded at [0199-core-modularization.codex.md](/Users/ccheever/projects/snapback-runs/review-fixes-20260808/refine0199/llp/reviews/0199-core-modularization.codex.md); `./ref-check --verbose` passes.

VERDICT: NOT READY
---

## Round 2 (VOID — split-revision) — 2026-08-08

- **Void reason:** the two families reviewed **different revisions** — orchestrator directory error. The GPT reviewer ran with `-C` into the refine worktree and correctly reviewed the **revised** doc (capsule `009bb5e080a83c77c9efda58d6e866eb8218a917c78a7ba21feb28cdcb017719`, blob `eb715129acf4e1b417dd4ce056687a9ca0a6cb12`); the Claude reviewer was pointed at the primary checkout and reviewed the **original committed Draft**. Reviews not on a common capsule → round void, per LLP 0010 §2. Recorded for provenance; not counted toward convergence.
- **This (GPT) review — valid, on the revised doc. Verdict:** NOT READY (2 concerns, both IN-DELTA; explicitly "no MATERIAL concern in PRE-EXISTING text").

### Verbatim review (GPT, on revised doc)

Reviewed the full current document at SHA-256 `009bb5e080a83c77c9efda58d6e866eb8218a917c78a7ba21feb28cdcb017719`. I found no MATERIAL concern in PRE-EXISTING text.

1. **IN-DELTA — MATERIAL: the activation transaction is both decided and explicitly undecided.** The ownership map mandates installation through “one kernel transaction” and prohibits projection, sequence, or auth publication from committing independently. The First-slice section and OQ3 then leave open whether installation uses one composite commit or a journaled/compensating protocol, and even which transitions belong to the atomic set. These yield incompatible implementation contracts. Either make owner #1 protocol-neutral pending OQ3, or decide the composite commit now and precisely limit it to facts sharing the kernel’s transaction domain.

2. **IN-DELTA — MATERIAL: `manifest.rs` cannot “stay” the asserted leaf under the documented ownership graph.** The current module depends directly on auth, ephemeral, push, assets, storage, completeness, search, vector, identity, and other higher-level subsystems; it also contains more than domain types. Leaving it unowned while calling it a leaf makes the target dependency direction and blocking structural check underdetermined. The Decision should either require decomposing it into a genuine shared contract/types leaf while assigning the residue to owners, or assign the existing module an owner. The accompanying “contract/wire leaf in Sequencing” reference also has no corresponding passage.

Both material findings are confined to round-1 revision text; they do not reopen pre-existing text.

VERDICT: NOT READY
---

## Round 3 (real; both families on the worktree revision) — 2026-08-08

- **Target revision (git blob):** `0530bc263092b5ae54064c37ec9e4663774aa0b7`
- **Capsule sha256:** `aaff94c26986b4fa11ee225ee62195fe637869378e63d2d065db65780ea8170c`
- **Topology:** single target, independent loop; both reviewers on the same worktree revision (round-2 directory error corrected).
- **Blindness basis:** structural — review artifacts moved out of the worktree during the round.
- **Reviewer:** gpt-5.6-sol @ xhigh (codex exec).
- **Verdict:** READY ("No MATERIAL concerns remain"). 4 non-material dispositionable notes (3 IN-DELTA minor/trivial, 1 PRE-EXISTING minor).

### Verbatim review (GPT, round 3)

No MATERIAL concerns remain. Repository claims checked were consistent, and `./ref-check --verbose` passes.

1. **IN-DELTA — MINOR:** Owner #1 names a mandatory atomic set, then OQ3 defers “exactly which transitions” belong to it. Clarify that the named transitions are the minimum invariant and OQ3 may refine/add boundaries and choose the mechanism, not weaken that minimum.

2. **IN-DELTA — MINOR:** The shared contract/types leaf slightly blurs code and artifact dependencies. Cloudflare cannot consume the Rust leaf directly; clarify that Rust owners consume its types while Cloudflare binds generated language-neutral schemas, fixtures, or equivalent artifacts from the same canonical source.

3. **PRE-EXISTING — MINOR:** The Context says “three god-object modules” but lists four, while cosmetic sequencing again says three without naming them. State “four” or enumerate the intended cosmetic-split targets.

4. **IN-DELTA — TRIVIAL:** Cosmetic sequencing first says preserved Rust module paths keep the `@ref` corpus stable, then correctly requires file-path `@ref`s to migrate. Distinguish module/symbol references from file-path references.

VERDICT: READY