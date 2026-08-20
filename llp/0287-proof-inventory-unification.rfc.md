# LLP 0287: One proof inventory replacing the four test-inventory mechanisms

**Type:** RFC
**Status:** Draft
**Systems:** Verification, Build, Project, Tooling
**Author:** codex `gpt-5.6-sol` (commissioned by Claude Opus 5 orchestrating LLP 0283 F-6),
for Charlie Cheever
**Date:** 2026-08-19
**Revised:** 2026-08-19 (a — initial design)
**Related:** LLP 0283 (F-6), LLP 0276 (D5), LLP 0175, LLP 0189, LLP 0289, LLP 0288

> **Provenance.** LLP 0283 F-6 defers three programs, each "deserving its own reviewed
> design." This is one of the three. It was authored against the tree by a model family
> independent of the code it regroups, per LLP 0283's F-2 method lesson: do not let a lane
> write the design that constrains it. It is **Draft** — it has not yet been through the
> LLP 0005 review loop, and no implementation is authorized by it.

## Status and decision

Create one canonical, data-only proof inventory. Make the existing four mechanisms consumers or generated projections of it, then retire their independently authored inventories after a dual-read period.

The guide and diagnostics manifests do not become part of this test inventory. They are artifact inventories produced and checked by proof gates.

## The four mechanisms as they exist

The checked-out tree has advanced beyond LLP 0276’s 2026-08-17 measurements. The current values are:

- 173 `run` declarations and 172 stable local-proof gate IDs;
- 19 package-test inventories covering 312 test files;
- 30 Cloudflare local-suite checks;
- 19 drift-prone gates;
- 27 root script tests, all assigned a runner.

LLP 0276 recorded 164 gates, 18 drift gates, and six unowned scripts tests (`llp/0276-ideal-codebase-architecture.rfc.md:192`). The Phase 0 scripts-test bridge has since closed the last gap (`llp/0276-ideal-codebase-architecture.rfc.md:456`).

### 1. Package-test inventories

Source of truth:

- `PACKAGE_TEST_INVENTORIES` lists package roots, suffixes, package script names, and exact expected files (`scripts/check-package-test-inventory.mjs:14`).
- Package `scripts.test` commands separately enumerate the files.
- A reviewed total is separately fixed at 312 (`scripts/check-package-test-inventory.mjs:551`).

Consumers:

- the standalone package inventory gate;
- `scripts/check-inventories.mjs`;
- `verify-local-proof`, which first runs the inventory and later invokes package commands (`scripts/verify-local-proof:248`, `scripts/verify-local-proof:657`);
- the scripts-test bridge when a script test is delegated through a package inventory.

Drift mode:

A new file requires coordinated edits to the filesystem, the package command, the inventory’s `expectedFiles`, the reviewed total, and its count changelog. The checker uses a restricted regular expression over package command strings (`scripts/check-package-test-inventory.mjs:491`, `scripts/check-package-test-inventory.mjs:514`). A valid-but-unrecognized command spelling can make the inventory disagree with execution.

### 2. `verify-local-proof` run declarations

Source of truth:

The shell file is simultaneously the ordered command inventory, dependency declaration, conditional-control program, and executor. `check-local-proof-gates.mjs` parses `run ID [--requires ...] -- command` with one regular expression (`scripts/check-local-proof-gates.mjs:22`). It special-cases the duplicate `cargo-test-profile-clean` ID (`scripts/check-local-proof-gates.mjs:57`).

Consumers:

- `select-local-proof.mjs`, which parses the shell and separately reads the JSON selection policy (`scripts/select-local-proof.mjs:23`);
- `verify-local-proof` itself;
- CI and the scheduled backstops;
- the scripts-test bridge;
- the local-proof inventory fixtures.

Drift mode:

Command, stable ID, dependencies, cadence group, path triggers, workflow requirements, and frozen-record metadata are split between the shell and `local-proof-selection-policy.v1.json`. The selector must prove every shell gate appears in an always/group classification (`scripts/select-local-proof.mjs:38`, `scripts/select-local-proof.mjs:60`). The policy separately carries dependency overrides and drift metadata (`scripts/local-proof-selection-policy.v1.json:22`, `scripts/local-proof-selection-policy.v1.json:83`).

The shell parser validates syntax and a handful of required edges, but it is not a general command model (`scripts/check-local-proof-gates.mjs:63`).

### 3. Cloudflare local-suite manifest

Source of truth:

`EXPECTED_LOCAL_SUITE_IDS`, a separate count of 30, `LOCAL_SUITES`, and `TEST_FILE_CLASSIFICATIONS` live in one module (`targets/cloudflare/test/local-suite-manifest.mjs:6`, `targets/cloudflare/test/local-suite-manifest.mjs:39`, `targets/cloudflare/test/local-suite-manifest.mjs:41`, `targets/cloudflare/test/local-suite-manifest.mjs:215`).

Consumers:

- `local-suite.mjs`, which validates exact membership and runs each gate (`targets/cloudflare/test/local-suite.mjs:28`, `targets/cloudflare/test/local-suite.mjs:64`);
- `verify-local-proof` through the aggregate `cloudflare-local-suite` gate (`scripts/verify-local-proof:674`);
- the scripts-test bridge.

Drift mode:

The manifest correctly forces every local test-directory `.mjs` file to be classified and every `gate` file to be executable (`targets/cloudflare/test/local-suite.mjs:38`, `targets/cloudflare/test/local-suite.mjs:47`). But its IDs, count, classifications, commands, completion evidence, and outer local-proof gate are still independent of the other inventories.

### 4. Frozen-record drift registry

Source of truth:

`local-proof-selection-policy.v1.json` contains `driftProneGates`, records, record paths, trigger rules, regeneration commands, preparation requirements, and selected drift tiers (`scripts/select-local-proof.mjs:112`, `scripts/select-local-proof.mjs:186`).

Consumers:

- the local-proof selector;
- `drift-prone-gates.mjs` and both backstops;
- the pre-push hook;
- the scripts-test bridge’s `drift-registry` runner type (`scripts/check-scripts-test-inventory.mjs:285`).

Drift mode:

Every entry must name a gate already declared in the shell, so stable ID and command remain elsewhere. Trigger rules may overlap but need not match the ordinary proof path rules. Adding or renaming a frozen-record gate can require coordinated changes to the shell, groups, path rules, drift registry, and scripts-test inventory.

### The scripts-test bridge is not a fifth runner mechanism

`SCRIPTS_TEST_INVENTORY` is a meta-inventory. It maps every root script test to one of exactly the four mechanisms above (`scripts/check-scripts-test-inventory.mjs:250`, `scripts/check-scripts-test-inventory.mjs:259`, `scripts/check-scripts-test-inventory.mjs:277`, `scripts/check-scripts-test-inventory.mjs:285`). It currently solves only `scripts/*.test.mjs` and deliberately fails on nested tests.

It should become the generic completeness checker rather than survive as a separately authored file list.

### Guide and diagnostics manifests are adjacent, not additional test inventories

`check-inventories.mjs` aggregates several different kinds of exactness: package tests, script tests, demos, publication leaves, and Guide projections (`scripts/check-inventories.mjs:79`, `scripts/check-inventories.mjs:100`, `scripts/check-inventories.mjs:145`, `scripts/check-inventories.mjs:168`). That does not make them one semantic inventory.

The Guide manifest binds pages, snippets, symbol and diagnostics registries, and generated flat projections (`scripts/guide-lib.mjs:928`, `scripts/guide-lib.mjs:956`, `scripts/guide-lib.mjs:976`). The generator explicitly presents that manifest as the single interface for Guide consumers (`scripts/generate-guide-manifest.mjs:2`). Those remain artifact records owned by the `guide` gate. Their generated bytes and source closures are referenced from the proof inventory, not copied into it.

## Canonical proof inventory

Introduce one canonical `scripts/proof/inventory.v2.json`. It is the only authored source of truth for runnable proof.

Each stable gate record contains:

- stable gate ID and human description;
- ordered execution steps;
- command form: structured argv, named internal adapter, or narrowly scoped shell adapter;
- working directory and permitted environment inputs;
- prerequisites;
- cadence and selection groups;
- path triggers;
- workflow requirements such as native toolchain, browser, private root, or JavaScript dependencies;
- platform availability and explicit absent-platform disposition;
- owned test artifacts and helper artifacts;
- expected completion evidence;
- frozen-record metadata, if applicable;
- claim-scope tags used by LLP 0189 D-4/D-6;
- timeout and result normalization;
- whether failure blocks dependents or is report-only.

The manifest also contains exhaustive discovery domains:

- package `*.test.mjs` roots;
- `scripts/tests/`;
- every source file beneath `targets/cloudflare/test/`;
- repository `tests/`, divided into runnable tests, helpers, fixtures, corpora, and evidence;
- Cargo integration targets and workspace package test targets;
- demo acceptance-test roots;
- client-specific test roots such as Swift;
- explicitly classified remote, credentialed, benchmark, or non-gating artifacts.

A test artifact may be owned by multiple gates only when the manifest declares a primary owner and explicit additional coverage. Silent duplicate execution is an error.

### What the existing mechanisms become

- `verify-local-proof` remains the permanent operator command but becomes a thin selector/executor façade. It no longer owns the command inventory.
- `select-local-proof.mjs` consumes only `inventory.v2.json`; it no longer parses shell source.
- `local-proof-selection-policy.v1.json` becomes a generated compatibility projection during migration and then disappears.
- Package `test` scripts remain supported developer entry points, but their expected command projection is generated or checked from the manifest. They are no longer authoritative.
- `PACKAGE_TEST_INVENTORIES` becomes a generated package view and then disappears.
- The Cloudflare manifest becomes a generated view filtered from the canonical inventory. `local-suite.mjs` may remain a target-specific aggregate runner, but it cannot carry an independently authored ID or count list.
- `driftProneGates` becomes metadata on the canonical gate record. Backstops consume the filtered canonical view.
- `SCRIPTS_TEST_INVENTORY` disappears as an authored list. Its checker becomes the generic orphan/disposition audit.
- `check-inventories.mjs` remains the cheap umbrella command, delegating test exactness to the canonical proof audit and continuing to check demos, publication leaves, and Guide artifacts.

### Representing current irregularities

The new model must preserve, not wish away, the awkward cases:

- The two current declarations sharing `cargo-test-profile-clean` become two ordered steps of one stable gate. Declaration count changes from 173 to 172 while stable gate count remains 172.
- Conditional Swift execution is an explicit availability predicate with `not_selected` as its absence result, preserving `verify-local-proof:669-673`.
- Exact-dependent sections and current shell functions use named adapters until they can be represented as structured argv.
- Cloudflare completion strings remain per-child evidence.
- `unrun` remains legal only with a reason and an existing open filesystem ticket, matching the current scripts-test rule (`scripts/check-scripts-test-inventory.mjs:298`).
- Unknown changed paths continue to select the complete gate inventory (`scripts/select-local-proof.mjs:220`, `scripts/select-local-proof.mjs:238`).

## Making orphan tests mechanically impossible

A small independent `check-proof-inventory` validator runs before selection in CI, hooks, and `verify-local-proof`. It does not contain test membership; it only knows the canonical manifest path, schema, and discovery rules.

It fails when:

- a discovered test artifact has no gate owner or explicit non-gating disposition;
- a manifest member is missing;
- an executable test command names an undeclared artifact;
- a package script diverges from its generated projection;
- a Cloudflare test file is unclassified;
- a Cargo integration target is not covered by a workspace/package gate;
- a new test-bearing directory is outside every discovery domain;
- an aggregate runner’s actual child receipt set differs from its manifest membership;
- an artifact is simultaneously marked helper and runnable without an explicit relation.

The always-run validator and a frozen CI-workflow fixture make it impossible to add a conventionally recognized test file without the canonical mechanism learning about it in the same change.

The honest boundary is semantic intent: no static mechanism can prove that an innocuously named production file containing ad hoc assertions was “meant to be a test.” The repository convention therefore becomes enforceable: test artifacts must live in a declared test-bearing root or use a declared test suffix. Within that convention, unowned tests are impossible; outside it, the checker refuses new unclassified test-like paths but cannot infer human intent.

For Rust, the inventory unit is the Cargo test target or compiled module, not every individual inline `#[test]` function. `cargo test` discovers functions within the target. A source module never connected to the crate graph remains a compiler/source-graph problem, not an inventory item.

## Staged migration

### Stage 0 — freeze current truth

Capture a golden census of:

- 173 command declarations;
- 172 stable gate IDs;
- 19 package inventories and 312 files;
- 30 Cloudflare checks and their classifications/evidence;
- 19 drift-prone gates;
- 27 script tests and their runner ownership;
- complete, affected, fail-closed-full, and single-gate selection receipts.

No execution behavior changes.

### Stage 1 — shadow canonical manifest

Populate `inventory.v2.json` while all four old inventories remain authoritative.

A bidirectional equivalence gate must prove:

- every old gate ID and command has one canonical record;
- every dependency, cadence group, trigger, requirement, drift record, and regeneration command agrees;
- all 312 package files and all 30 Cloudflare checks have the same runner;
- all 27 script tests retain their current disposition;
- no canonical record exists without an old counterpart unless explicitly marked migration-only.

Any mismatch blocks the stage.

### Stage 2 — selector cutover

Make the selector consume v2 while generating the old policy as a checked projection. Run old and new selectors against a fixed corpus containing every path-rule boundary and compare:

- selected and not-selected gate sets;
- prerequisite closure;
- workflow requirements;
- drift selection;
- selection class;
- unknown-path behavior.

Receipt schema advances to v2 because its inventory digest changes. The v1 validator remains available for retained historical receipts.

### Stage 3 — executor cutover

Make `verify-local-proof` execute canonical plans while preserving its command-line interface and JSONL result contract.

First cut over fixture-only gates, then package aggregates, Cloudflare, native/build gates, and finally complex conditional sections. During each slice, compare the planned command, cwd, environment contract, dependency state, and completion evidence with the old shell.

No gate disappears during a slice: either the old or the new executor owns it, and the equivalence checker forbids ownership by neither.

### Stage 4 — generate the four compatibility views

Generate and check:

- package test scripts/inventory views;
- Cloudflare local-suite view;
- drift/backstop view;
- legacy shell/policy view.

After two consecutive complete batteries exercise the v2 inventory without an orphan or selection mismatch, mark the old views read-only generated output.

### Stage 5 — retire independent authorities

Remove the handwritten package inventory, Cloudflare ID/count list, drift registry, scripts-test list, and shell run declarations.

The permanent `verify-local-proof` façade and package `test` commands remain. Historical v1 receipt validators remain as lineage.

## Exact verification

Every stage requires:

1. schema and closed-key fixtures for the canonical manifest;
2. exhaustive discovery fixtures for package, scripts, Cloudflare, Cargo, demos, clients, helpers, remote tests, benchmarks, and evidence;
3. mutation fixtures adding, renaming, moving, duplicating, or deleting one test;
4. old/new inventory bidirectional equality;
5. selector golden comparisons over all path rules;
6. command-plan equality before executor cutover;
7. actual child-receipt membership for package and Cloudflare aggregates;
8. dependency-cycle and missing-prerequisite fixtures;
9. unknown-path fail-broad fixtures;
10. a complete battery after final cutover, on the normal LLP 0189 cadence.

Coverage moves only in a same-change overlap, following the repository rule that coverage never vanishes (`llp/0276-ideal-codebase-architecture.rfc.md:223`, `llp/0189-verification-cadence-and-claim-gating.decision.md:184`).

## Behaviors deliberately lost

- **Shell-as-authority is lost.** `verify-local-proof` stops being executable documentation of every gate. This overturns the current comment that the canonical shell remains executable documentation (`scripts/check-local-proof-gates.mjs:3`). Acceptable, provided descriptions and ordering remain visible through a deterministic inventory-render command and LLP 0276 is amended.
- **The manually reviewed package total and count changelog are lost as live control points.** Exact membership is stronger than a scalar total; Git history retains count history. Acceptable.
- **Package `scripts.test` stops being the source of truth.** The command remains available as a checked projection. Acceptable.
- **The Cloudflare manifest’s independently authored count and ID array are lost.** Per-file classification, order, and completion evidence remain in the canonical source. Acceptable.
- **The drift registry loses its separate review file.** A deterministic drift-only projection must remain available for focused review. Acceptable.
- **The root-only scripts-test constraint is lost.** This is intentional and necessary for `scripts/tests/`.
- **The special 173-declaration count becomes 172 gates with one multi-step gate.** Stable IDs and both commands remain. Acceptable.
- **Some shell chaining syntax may disappear.** It is acceptable only after command-plan and failure-semantic fixtures establish parity.

No loss is accepted for stable IDs, prerequisite closure, keep-going `FAIL`/`BLOCKED` behavior, `not_selected`, unknown-path fail-broad behavior, package commands, Cloudflare evidence, drift tiers, or LLP 0189 claim-scope bindings.

## Failure modes and honest limits

- A monolithic inventory may become large. That is preferable to hidden authority duplication, but generated filtered views are necessary for reviewability.
- Structured command data can become a bad programming language. Complex behavior stays in named adapters; the manifest selects adapters but does not embed arbitrary scripts.
- Discovery by naming cannot infer arbitrary human intent. The enforced location/naming convention is part of the guarantee.
- A bug in the canonical validator could affect all consumers. Its mutation fixtures and independently frozen CI invocation are therefore more important than any scalar test count.
- Combining cadence, drift, command, and claim metadata increases the stakes of one file. Schema review and filtered diffs are required.
- This program touches the proof machinery that currently reports expected security reds. It should begin only after F-1/F-3 establish a clean baseline, not normalize those reds into the migration.

## Sequencing recommendation

This is first of the three F-6 programs once F-1, F-3, and the blocked publication complete. It supplies the exhaustive ownership model needed by both the scripts regrouping and the release machine’s LLP 0189 D-6 gate derivation.

I agree with deferring implementation during the current security/publication blocker, but not with deferring it again after that blocker closes. It has direct coverage and comprehensibility value and should be the first ordinary follow-on.

---
