# LLP 0289: Regrouping `scripts/` without breaking the reference graph

**Type:** RFC
**Status:** Draft
**Systems:** Project, Build, Verification, Tooling
**Author:** codex `gpt-5.6-sol` (commissioned by Claude Opus 5 orchestrating LLP 0283 F-6),
for Charlie Cheever
**Date:** 2026-08-19
**Revised:** 2026-08-20 (b — answers the LLP 0005 NEEDS REVISION review:
re-measures 174 tracked artifacts and 1,696 exact-literal reference pairs,
records the same-day 1,663 → 1,695 → 1,696 drift as proof that design-time
freezing is structurally wrong, requires an implementation-time generated and
digest-pinned census, adds an all-tracked-text reference fallback, strengthens
Node/shell façade and importer parity, expands loss accounting, and records the
agreed sequence and deferral). 2026-08-19 (a — initial design)
**Related:** LLP 0283 (F-6), LLP 0276 (D5), LLP 0225, LLP 0189, LLP 0287, LLP 0288

> **Provenance.** LLP 0283 F-6 defers three programs, each "deserving its own reviewed
> design." This is one of the three. It was authored against the tree by a model family
> independent of the code it regroups, per LLP 0283's F-2 method lesson: do not let a lane
> write the design that constrains it. The supplied same-family LLP 0005 review
> returned **NEEDS REVISION**; revision (b) answers those
> findings without treating that review as independent cross-family approval.
> It remains **Draft**. No implementation or acceptance is authorized by it.

## Status and decision

Adopt the target `scripts/{proof,checks,release,generate,bootstrap,governance,launchd,lib,tests}/` layout from LLP 0276, but migrate through a checked compatibility layer. Do not perform a hard cutover, and do not treat the measurements in this Draft as an implementation baseline.

The regrouping should happen after the proof-inventory unification in LLP 0287.
Moving first would require teaching four runner mechanisms plus the scripts-test
meta-inventory about temporary paths and would collide with the current
scripts-test checker, which explicitly rejects nested `scripts/**/*.test.mjs`
files (`scripts/check-scripts-test-inventory.mjs:181`,
`scripts/check-scripts-test-inventory.mjs:194`).

## The problem in the current tree

### Census and role classification

Revision (b)'s handed-off re-measurement contains 174 tracked artifacts beneath
`scripts/`:

| Shape | Count |
|---|---:|
| Root-level files | 151 |
| Root shebang-bearing commands | 102 |
| Root `*.test.mjs` files | 27 |
| Root support modules, manifests, data, and documentation | 22 |
| Nested files | 23 |
| Total | 174 |

The additional root command is
`scripts/generate-local-database-shared-borrow-census.mjs`, added during F-1
work (`scripts/generate-local-database-shared-borrow-census.mjs:1-13`). The
nested set remains 14 fixtures, two retained G2 receipts, two launchd templates,
two library files, and three files for the Rust security-gate helper. One nested
library, `scripts/lib/proof-runner.sh`, is itself executable.

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

Using the Draft's exact-literal, self-excluding file-to-script pair method, the
handed-off current-tree measurement is 1,696 pairs:

| Consumer stratum | Reference pairs |
|---|---:|
| GitHub workflows | 34 |
| launchd templates | 2 |
| Git hooks | 4 |
| `AGENTS.md` and `CLAUDE.md` | 20 |
| Other scripts | 327 |
| Active numbered LLPs | 165 |
| Other tracked files | 1,144 |
| **Total** | **1,696** |

This is a lower bound: it finds literal `scripts/foo` strings but not paths assembled from fragments.

More importantly, the number is not a design pin. The same census moved three
times in one day: the initial Draft measured 1,663; the LLP 0005 review snapshot
`7106a58ea023eda26204db3743c4193c06f19e14` measured 1,695; and the handed-off
post-review measurement reached 1,696. The final pair came from the newly
landed F-3 ticket's `scripts/cold-clone-check.sh` reference
(`issues/20260820-all-aboard-offline-boot-chrome.md:6`). The first change was
partly produced by these three designs; the second by this same follow-up
program. This repository explicitly warns that `main` moves continuously
(`CLAUDE.md:163-172`). A census frozen while designing against `main` is
therefore structurally stale on arrival; Stage 0 must refresh and pin the
implementation inputs instead.

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

Façade type is explicit; executable aliases and sourced-shell aliases are not
interchangeable:

- A standalone shell-command façade contains only setup needed to locate the
  repository plus `exec canonical "$@"`. It preserves the caller's cwd,
  byte-for-byte stdout/stderr, empty/whitespace/newline/Unicode/leading-dash
  arguments, `--` boundaries, exit status, and termination by signal. Both the
  façade and canonical command retain the required tracked executable mode.
- A sourced-shell alias must not `exec`. It either remains a permanent thin
  `.`/`source` façade with fixtures for caller-shell variables, functions,
  positional parameters, return status, `$0`, and source-stack behavior, or all
  sourced consumers migrate in the same change. It may not be represented by a
  standalone command façade while claiming parity.
- A Node CLI façade imports and `await`s an exported canonical `main` in the
  same process; it does not spawn Node, install signal handlers, rewrite argv,
  catch/reformat a rejection, or call `process.exit`. `process.argv[1]` remains
  the invoked façade path. The canonical module receives any needed entry URL
  explicitly and may not infer CLI invocation from its own `import.meta.url`.
  Any stack/path-dependent stderr difference must be normalized in the
  canonical implementation or the move is blocked.
- An importable Node façade re-exports the exact default and named export set
  with value identity preserved. Importing either old or canonical path must
  have the same side effects, rejection behavior, and API. A dual-use file must
  satisfy both the same-process CLI and importer contracts.

No façade contains business logic. Parity means byte-exact stdout/stderr, cwd,
signals, executable mode, unusual argv boundaries, and importer behavior—not
merely similar help text and status codes.

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
- invocation class (`standalone-executable`, `sourced-shell`, `node-import`, or
  an explicit valid combination), executable mode, export-surface digest, and
  entry-identity treatment;
- proof gate IDs and test membership;
- known consumer categories;
- source-root behavior;
- generated/evidence status.

The manifest is a migration and ownership record, not runtime dispatch configuration. Runtime code must import canonical paths directly.

## Reference migration and stale-reference detection

A new always-run layout checker owns the graph. Its completeness floor is an
all-tracked-text exact-literal fallback:

- enumerate every `git ls-files` path, classify text versus binary
  deterministically, and scan every tracked text file for every old, canonical,
  permanent-façade, and temporary-alias literal;
- self-exclude only the generated census bytes and named negative fixtures;
- require explicit manifest dispositions for binary files and for historical or
  retained-evidence text that intentionally preserves an old path; each
  exemption names its category, reason, owner, and permanent/expiry rule;
- fail if an unsupported text format contains an unclassified old or canonical
  `scripts/` path.

This fallback covers the majority “other tracked files” stratum—currently
1,144 pairs—rather than silently omitting it. Format-aware scanners layer on top
to recover semantic and dynamically composed edges for the known types:

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

Known dynamically composed paths receive explicit manifest rows and targeted fixtures. The checker must retain the existing path-migration checker’s honest limitation: no lexical or AST scanner proves the absence of every runtime-composed string. Negative fixtures should cover each supported composition idiom; unknown idioms fail review rather than being silently classified. That limitation applies only to non-literal composition; the all-tracked-text fallback makes literal coverage exhaustive over classified text inputs.

Before moving any Node implementation, repository-root discovery is centralized in the stable `scripts/lib/` location. This removes the current assumption that every script is one directory below the root.

## Staged migration

### Stage 0 — refresh, generate, and pin the implementation census

The 174/1,696 values above are review observations, not exit criteria. After
LLP 0287, LLP 0288, F-1, F-3, and the next qualified publication have completed,
select the actual implementation base and run a committed deterministic census
generator there. Without moving files, add the layout manifest, graph checker,
fixtures, and a generated census record containing:

- the selected source revision and a digest over every tracked census input,
  self-excluding the generated record;
- census algorithm/schema version and generator digest;
- the complete artifact rows and role classifications;
- the complete exact-literal reference-pair rows and consumer strata;
- explicit text/binary and historical/evidence dispositions;
- the measured scalar summaries, derived from those rows rather than authored.

If integration/rebase changes any census input before Stage 0 lands, regenerate
against the new tree; a stale source revision or input digest blocks. Once the
checker lands, every later artifact/reference change updates the live generated
projection in the same change, while the implementation-base record remains an
immutable epoch for migration-delta accounting. This refresh-and-pin protocol,
not any count written in this Draft, defines implementation truth.

Exit criteria:

- every artifact has one role and compatibility class;
- every generated implementation-time literal reference pair is classified,
  with scalar totals recomputed from the pinned rows;
- an all-tracked-text fallback proves that unsupported text formats cannot hide
  literal stale paths, and every binary/historical/evidence exemption is
  explicit;
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

- old and canonical command paths have byte-exact stdout/stderr and cwd parity;
- standalone façades preserve empty strings, whitespace, newlines, Unicode,
  leading dashes, `--`, exit status, executable mode, and termination by signal;
- sourced-shell aliases preserve caller-shell/return semantics and are never
  substituted by an executable façade;
- Node CLI façades run in-process with unchanged `process.argv[1]`, rejection,
  and signal behavior, while importers see identical default/named exports,
  value identity, and import side effects;
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
- the former 173 command declarations project to the intended 172 gates, with
  `cargo-test-profile-clean` preserving its mutually exclusive clean/unknown/
  preserve/non-CI outcomes through one conditional adapter rather than a
  duplicate or multi-step gate;
- complete, affected, fail-closed-full, and single-gate selection fixtures are byte-identical apart from an explicitly versioned inventory digest;
- CI and both backstops reopen the new selection receipt;
- temporary aliases are removed only after zero-reference proof.

## Exact verification

Each landing runs:

1. the new layout-manifest, implementation-pin, all-tracked-text fallback, and
   reference-graph fixtures;
2. `check-local-proof-gates` or its Design 2 successor;
3. proof-selection golden fixtures over a corpus covering every path rule;
4. scripts-test and package-test inventory checks;
5. CI workflow frozen-list fixtures;
6. hook fixtures with synthetic ref-update streams;
7. launchd template rendering and non-mutating `--status` checks;
8. generator byte-diff checks for moved generators;
9. façade parity fixtures covering byte-exact streams, cwd, unusual argv,
   executable mode, signals, same-process Node rejection behavior, exact
   default/named exports, and sourced-shell semantics;
10. release state-machine fixtures for moved release files;
11. `./ref-check --verbose`;
12. the affected proof selected by the changed paths.

A complete battery is not required at the exact landing commit. The normal LLP 0189 schedule remains authoritative (`llp/0189-verification-cadence-and-claim-gating.decision.md:96`, `llp/0189-verification-cadence-and-claim-gating.decision.md:131`). Any release-facing move additionally waits for the newest eligible claim-relevant battery before the next publication, per LLP 0189 D-6.

## Failure modes and honest limits

- Permanent façades preserve documented paths but leave some root files. That is intentional: a perfectly empty root is less important than not breaking installed jobs.
- A compatibility wrapper can accidentally change signals, exit/rejection
  behavior, stream bytes, argv, cwd, export identity, or source semantics.
  Wrapper-shape and full parity fixtures are mandatory; “re-export and
  delegate” alone is not a contract.
- Static reference scanning cannot prove that arbitrary string construction is absent. Explicit dynamic-path rows and fail-closed fixtures reduce but do not erase that limit.
- Active LLPs are historical and normative records. Most command examples should migrate, but historical evidence that intentionally names an old path should be classified rather than rewritten blindly.
- Moving release scripts before defining their common state boundary would conceal duplication rather than remove it.
- The current tree has expected-red security gates while F-1 remains open (`llp/0283-post-rearchitecture-followups.plan.md:48`). The regrouping should not begin until that program and F-3 restore the intended green publication baseline.

## Behaviors deliberately lost

- Removing a temporary internal alias can break untracked automation, editor
  tasks, installed copies not covered by the installed-path inventory, and
  external repositories. Zero tracked references is not proof those consumers
  do not exist. Permanent documented/installed façades and a declared
  compatibility interval reduce this loss; they cannot erase it.
- Direct invocation of a new canonical path intentionally observes that path in
  `$0`, `process.argv[1]`, and `import.meta.url`. Invocation through a permanent
  façade preserves the old entry identity under the contracts above. Any
  business behavior keyed accidentally to the canonical module URL must be
  removed before the move; raw identity equality between old and new canonical
  locations is impossible and is not claimed.
- Flat `scripts/*` globbing and root-level discoverability are lost as internal
  implementations move into role directories. The generated layout inventory,
  shallow permanent command namespace, and `scripts/README.md` become the
  replacement discovery surfaces.
- Shell history is only one unknowable consumer. The same honest limitation
  applies to ad hoc cron, local IDE configuration, copied commands, and
  downstream automation outside the tracked/installed graph.

## Sequencing recommendation

Revision (b) records agreement with the LLP 0005 review on both order and
deferral. This is third of the three programs:

1. unify the test/proof inventory;
2. establish the release-family state machine;
3. regroup `scripts/`.

Implementation remains deferred until F-1 closes, F-3 closes, and the next
qualified publication restores the baseline
(`llp/0283-post-rearchitecture-followups.plan.md:47-57`). It then follows LLP
0287 and the LLP 0288 reconciliation into LLP 0233: the first supplies one proof
inventory to relocate, and the second supplies one release protocol to move.
Regrouping remains mostly navigational value with a very large path-sensitive
blast radius. This revision stays Draft; the author decides whether it receives
re-review or acceptance.

---
