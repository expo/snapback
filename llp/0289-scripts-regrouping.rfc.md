# LLP 0289: Regrouping `scripts/` without breaking the reference graph

**Type:** RFC
**Status:** Draft
**Systems:** Project, Build, Verification, Tooling
**Author:** codex `gpt-5.6-sol` (commissioned by Claude Opus 5 orchestrating LLP 0283 F-6),
for Charlie Cheever
**Date:** 2026-08-19
**Revised:** 2026-08-19 (a — initial design)
**Related:** LLP 0283 (F-6), LLP 0276 (D5), LLP 0225, LLP 0189, LLP 0287, LLP 0288

> **Provenance.** LLP 0283 F-6 defers three programs, each "deserving its own reviewed
> design." This is one of the three. It was authored against the tree by a model family
> independent of the code it regroups, per LLP 0283's F-2 method lesson: do not let a lane
> write the design that constrains it. It is **Draft** — it has not yet been through the
> LLP 0005 review loop, and no implementation is authorized by it.

## Status and decision

Adopt the target `scripts/{proof,checks,release,generate,bootstrap,governance,launchd,lib,tests}/` layout from LLP 0276, but migrate through a checked compatibility layer. Do not perform a hard cutover.

The regrouping should happen after the proof-inventory unification in Design 2. Moving first would require teaching four inventories about temporary paths and would collide with the current scripts-test checker, which explicitly rejects nested `scripts/**/*.test.mjs` files (`scripts/check-scripts-test-inventory.mjs:181`, `scripts/check-scripts-test-inventory.mjs:194`).

## The problem in the current tree

### Census and role classification

The current checkout contains 173 tracked artifacts beneath `scripts/`:

| Shape | Count |
|---|---:|
| Root-level files | 150 |
| Root shebang-bearing commands | 101 |
| Root `*.test.mjs` files | 27 |
| Root support modules, manifests, data, and documentation | 22 |
| Nested files | 23 |
| Total | 173 |

The nested set is 14 fixtures, two retained G2 receipts, two launchd templates, two library files, and three files for the Rust security-gate helper. One nested library, `scripts/lib/proof-runner.sh`, is itself executable.

Role counts overlap because a release test may also be a proof gate and a CI entry point. That overlap is part of the design problem:

| Role facet | Measured surface |
|---|---|
| Proof gates | 58 distinct `scripts/` targets are named directly by `run` declarations in `verify-local-proof`; the proof entry point, selector, policy, inventory parser, and runner add five control artifacts. |
| Generators/migrations | 14 obvious generation, update, refresh, finalization, or migration artifacts, including two generator tests. |
| Bootstrap/setup/build/install | 18 commands, including Ibex bootstrap, runtime assembly, package installation, demo setup, schedule installation, and qualified-staging preparation. |
| Backstops/schedules | Six artifacts: two runners, two installers, and two plist templates. |
| Release/publication | A conservative filename-family cut contains 43 artifacts: 27 implementations/support modules and 16 tests. This is the live form of LLP 0276’s “~30-script” implementation family (`llp/0276-ideal-codebase-architecture.rfc.md:197`). |
| CI entry points | 19 distinct scripts are directly named by the 12 workflows. |
| Manual/one-shot candidates | Nine obvious maintenance, migration, drill, or local-install commands. “One-shot” is not assumed to mean deletable; every one still needs a reviewed disposition. |
| Root script tests | 27, all currently registered as run; no `unrun` disposition exists (`scripts/check-scripts-test-inventory.mjs:345`). |

The directory already tries to present a smaller public surface: its README says most files are proof internals and lists the intended operator entry points (`scripts/README.md:3`, `scripts/README.md:8`). The physical tree does not express that distinction.

### The reference graph

An exact-literal scan of tracked text files found 1,663 file-to-script reference pairs:

| Consumer stratum | Distinct script targets | Reference pairs | Consumer files |
|---|---:|---:|---:|
| GitHub workflows | 19 | 34 | 12 |
| launchd templates | 2 | 2 | 2 |
| Git hooks | 3 | 4 | 3 |
| `AGENTS.md` and `CLAUDE.md` | 10 | 20 | 2 |
| Other scripts | 131 | 326 | 50 |
| Active numbered LLPs | 61 | 143 | 57 |
| Other tracked files | 136 | 1,134 | 621 |

This is a lower bound: it finds literal `scripts/foo` strings but not paths assembled from fragments.

The high-risk edges are real:

- `CLAUDE.md` names the skill sync, drift runner, two schedule installers, bootstrap, doctor, inventory checker, and proof entry point as operational commands (`CLAUDE.md:111`, `CLAUDE.md:129`, `CLAUDE.md:133`, `CLAUDE.md:139`, `CLAUDE.md:155`, `CLAUDE.md:220`).
- The pre-push hook checks for and invokes two exact root paths (`.githooks/pre-push:5`, `.githooks/pre-push:40`, `.githooks/pre-push:45`).
- Checkout hooks require `scripts/sync-agent-skills` to remain executable (`.githooks/post-checkout:9`, `.githooks/post-checkout:14`).
- Installed launchd jobs contain absolute paths to the two backstop runners (`scripts/launchd/com.snapback.drift-backstop.plist.template:10`, `scripts/launchd/com.snapback.local-proof-backstop.plist.template:10`).
- CI directly invokes the proof entry point (`.github/workflows/local-proof.yml:218`) and publication scripts (`.github/workflows/linux-runtime-package.yml:110`).
- `verify-local-proof` embeds its gate commands as executable data (`scripts/verify-local-proof:227`, `scripts/verify-local-proof:248`, `scripts/verify-local-proof:678`).
- Many Node scripts assume they are exactly one level below the repository root. The existing migration manifest records that shared `resolve(import.meta.dirname, '..')` assumption across dozens of files (`scripts/path-migration-manifest.v1.json:3635`, `scripts/path-migration-manifest.v1.json:3694`). Blindly moving those files changes their repository root.
- LLP 0225 already requires path moves to co-migrate selectors, frozen-record gates, source-reading generators, and `@ref` annotations (`llp/0225-core-modularization.decision.md:1052`, `llp/0225-core-modularization.decision.md:1059`).

The existing path-migration checker is useful precedent but not sufficient. Its own header says it is lexical, misses composed paths, and is not a completeness proof (`scripts/check-path-migration-stragglers.mjs:7`). Its manifest is specifically the completed LLP 0276 Phase 0 record at `epoch=phase-3`, not a reusable redirects database (`scripts/path-migration-manifest.v1.json:2`, `scripts/path-migration-manifest.v1.json:10`).

## Proposed layout

The canonical implementation locations become:

| Directory | Ownership |
|---|---|
| `scripts/proof/` | Proof CLI implementation, selector, gate executor, cadence and receipt logic, drift/backstop proof logic. |
| `scripts/checks/` | Individually runnable repository checks and their non-test support. |
| `scripts/release/` | Package assembly, qualification, candidate publication, promotion, release evidence, runtime package manufacturing. |
| `scripts/generate/` | Deterministic generators and explicit update/migration commands. |
| `scripts/bootstrap/` | Runtime bootstrap, setup, installation, environment preparation, and build helpers. |
| `scripts/governance/` | Inventory governance, visibility governance, diary/capability/process checks. |
| `scripts/launchd/` | Plist templates plus canonical schedule installers and runners. |
| `scripts/lib/` | Shared non-entry-point libraries. |
| `scripts/tests/` | All script-owned tests, arranged by the same role families. |
| `scripts/fixtures/` | Existing fixtures, subdivided only where ownership is unambiguous. |
| `scripts/evidence/` | Retained receipts such as the current G2 evidence. |

A file has one primary owner even if it participates in several gates. “CI entry point” and “proof gate” are reachability facets in the layout manifest, not competing directory owners.

### Stable façades

A small set of root paths remains permanently stable as façades. At minimum it includes:

- every operator entry point documented in `scripts/README.md:12-23`;
- the two paths embedded in installed launchd plists;
- hook-facing commands;
- release commands documented as operator interfaces, including the eventual unified release CLI.

A shell façade must `exec` the canonical command so exit status, signals, standard streams, working directory, and argument boundaries are preserved. A Node façade must re-export the canonical module for importers and delegate CLI invocation without re-parsing arguments. It may not contain business logic.

This yields a deliberately shallow public namespace at `scripts/` while the implementation is grouped beneath it.

### Temporary compatibility aliases

Every moved internal path receives a temporary checked alias during migration. Tracked consumers then migrate to the canonical path. A temporary alias may be removed only when the graph checker reports:

1. no tracked source, workflow, plist, hook, package script, generated input, active LLP command, or Guide snippet still references it;
2. it is not classified `public` or `installed`;
3. its canonical target exists;
4. its removal does not change the proof inventory or selector output.

This guarantee covers every inventoried repository or installed integration path. It cannot guarantee compatibility for unknowable paths stored in someone’s shell history. That is why every currently documented operator path is permanent rather than temporary.

### Script-layout manifest

Introduce one reviewed `scripts/script-layout.v1.json` manifest. Every tracked artifact beneath `scripts/` must have exactly one row containing:

- stable artifact ID;
- old path and canonical path;
- primary role;
- `command`, `test`, `library`, `manifest`, `fixture`, `evidence`, or `template` kind;
- compatibility class: `public`, `installed`, `tracked-internal`, or `private`;
- façade type and retirement eligibility;
- proof gate IDs and test membership;
- known consumer categories;
- source-root behavior;
- generated/evidence status.

The manifest is a migration and ownership record, not runtime dispatch configuration. Runtime code must import canonical paths directly.

## Reference migration and stale-reference detection

A new always-run layout checker owns the graph. It must use format-aware scanners for the known edge types:

- JavaScript: static imports, dynamic imports with literals, `new URL`, `join`/`resolve` calls rooted at known repository variables, and child-process argv.
- Shell: sourced files, direct commands, quoted `$root/scripts/...` forms, and arrays used as argv.
- Workflow YAML: `run`, path filters, artifact paths, and script arguments.
- plist XML: `ProgramArguments`.
- JSON: policy paths, frozen-record paths, and manifest references.
- Rust/Cargo: `include_*`, build-script inputs, and repository-relative path constants.
- Markdown: fenced and inline command paths in active Guide, LLP, README, `AGENTS.md`, and `CLAUDE.md`.
- Package scripts and EAS workflow commands.

The checker compares each reference with the layout manifest:

- a canonical reference passes;
- an approved permanent façade passes;
- a temporary alias passes only during its declared migration stage;
- an old path after its retirement stage fails with a stable stale-reference diagnostic;
- an unregistered `scripts/` artifact fails;
- a façade whose target is absent or whose shape contains logic fails.

Known dynamically composed paths receive explicit manifest rows and targeted fixtures. The checker must retain the existing path-migration checker’s honest limitation: no lexical or AST scanner proves the absence of every runtime-composed string. Negative fixtures should cover each supported composition idiom; unknown idioms fail review rather than being silently classified.

Before moving any Node implementation, repository-root discovery is centralized in the stable `scripts/lib/` location. This removes the current assumption that every script is one directory below the root.

## Staged migration

### Stage 0 — census and graph only

Add the layout manifest, graph checker, and fixtures without moving files. Freeze the measured 173-artifact inventory and the current tracked reference graph.

Exit criteria:

- every artifact has one role and compatibility class;
- all 1,663 literal reference pairs are classified;
- deliberately stale JS, shell, YAML, plist, JSON, Rust, and Markdown fixtures fail;
- current invocation paths behave unchanged;
- the existing path-migration and local-proof inventory gates still pass.

### Stage 1 — eliminate directory-depth assumptions

Move repository-root resolution into stable shared helpers and migrate scripts to use them while all files remain at their old paths.

Exit criteria:

- every affected command produces the same root from the repository root, a subdirectory, and a detached worktree;
- bootstrap, qualification, generated-artifact, and release fixtures prove that outputs remain under the same repository-relative locations;
- the graph has no remaining unclassified “one level up” assumption.

### Stage 2 — move low-risk leaf families

Move generators, bootstrap/setup helpers, libraries, fixtures, and evidence first. Install permanent façades for public paths and temporary aliases for internal ones.

Exit criteria:

- old and canonical command paths have parity for help, argument forwarding, exit status, and failure diagnostics;
- generators produce byte-identical outputs from the same fixture;
- no proof gate ID, prerequisite edge, or selection receipt changes merely because of the move;
- temporary aliases have an explicit remaining-consumer count.

### Stage 3 — move release and governance families

Move the release implementation only after Design 3 supplies one documented state-machine boundary. Until then, moving the current 43-artifact family would merely make its fragmentation prettier.

Move governance/inventory files with their records in the same commits. Do not separate a checker from the manifest it owns.

Exit criteria:

- all publication and promotion fixture suites pass through both façade and canonical paths;
- the package inventory and release package vector remain identical;
- no real registry mutation is part of migration verification;
- hooks and launchd templates pass exact argv fixtures.

### Stage 4 — move checks and script-owned tests

Move the 27 root tests beneath `scripts/tests/` only after Design 2’s generic test inventory is authoritative.

Exit criteria:

- all 27 artifacts remain owned by a gate;
- no `unrun` disposition is introduced;
- the test count and actual executed child receipts remain identical;
- the old root-only scripts-test inventory has become a generated compatibility projection or has been retired.

### Stage 5 — move the proof implementation last

Keep `scripts/verify-local-proof` as a permanent façade. Move its implementation, selector, policy, and runner only after the unified inventory is authoritative.

Exit criteria:

- canonical stable gate IDs remain 172;
- the former 173 command declarations project to the intended 172 gates, including the current special duplicate;
- complete, affected, fail-closed-full, and single-gate selection fixtures are byte-identical apart from an explicitly versioned inventory digest;
- CI and both backstops reopen the new selection receipt;
- temporary aliases are removed only after zero-reference proof.

## Exact verification

Each landing runs:

1. the new layout-manifest and reference-graph fixtures;
2. `check-local-proof-gates` or its Design 2 successor;
3. proof-selection golden fixtures over a corpus covering every path rule;
4. scripts-test and package-test inventory checks;
5. CI workflow frozen-list fixtures;
6. hook fixtures with synthetic ref-update streams;
7. launchd template rendering and non-mutating `--status` checks;
8. generator byte-diff checks for moved generators;
9. release state-machine fixtures for moved release files;
10. `./ref-check --verbose`;
11. the affected proof selected by the changed paths.

A complete battery is not required at the exact landing commit. The normal LLP 0189 schedule remains authoritative (`llp/0189-verification-cadence-and-claim-gating.decision.md:96`, `llp/0189-verification-cadence-and-claim-gating.decision.md:131`). Any release-facing move additionally waits for the newest eligible claim-relevant battery before the next publication, per LLP 0189 D-6.

## Failure modes and honest limits

- Permanent façades preserve documented paths but leave some root files. That is intentional: a perfectly empty root is less important than not breaking installed jobs.
- A compatibility wrapper can accidentally change signal or exit behavior. Wrapper-shape checks and argv fixtures are mandatory.
- Static reference scanning cannot prove that arbitrary string construction is absent. Explicit dynamic-path rows and fail-closed fixtures reduce but do not erase that limit.
- Active LLPs are historical and normative records. Most command examples should migrate, but historical evidence that intentionally names an old path should be classified rather than rewritten blindly.
- Moving release scripts before defining their common state boundary would conceal duplication rather than remove it.
- The current tree has expected-red security gates while F-1 remains open (`llp/0283-post-rearchitecture-followups.plan.md:48`). The regrouping should not begin until that program and F-3 restore the intended green publication baseline.

## Sequencing recommendation

This is third of the three programs:

1. unify the test/proof inventory;
2. establish the release-family state machine;
3. regroup `scripts/`.

I agree with LLP 0283 that regrouping is still correct to defer now (`llp/0283-post-rearchitecture-followups.plan.md:245`). It is mostly navigational value with a very large path-sensitive blast radius. It becomes substantially safer after the other two designs replace the mechanisms whose current paths are most fragile.

---
