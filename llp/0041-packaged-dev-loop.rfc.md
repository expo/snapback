# LLP 0041: Packaged developer loop

**Type:** RFC
**Status:** Draft
**Systems:** Developer experience, Tooling, Build, Client integration, Demo apps, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-07-21 (the first-publication probe found that `@snapback/cli` is an unrelated public 3.x package, reopening LLP 0021's namespace decision exactly as its caveat required. The publisher's provisional `@ccheever/snapback-*` mapping passes npm dry-run as the labeled `0.1.0-llp0063.1`/`llp0063` prerelease. The cold-install proof now has distinct tarball and registry modes, refuses to describe renamed tarballs as an offline closure, and requires registry identity/version/integrity plus a successful publish ledger before registry installation. npm's interactive OTP challenge stopped the real publish before a version became visible, so public-registry, clean-machine, and multi-platform evidence remain open and Status stays Draft); 2026-07-20 (LLP 0063 Step 5 implementation checkpoint: `@snapback/cli` now owns `new`/`generate`/`dev`/`doctor`, delegates established host operations to the native CLI, and consumes the ready-file handshake with target fencing; `@snapback/runtime-darwin-arm64` carries a relocatable release binary plus Hermes framework, with Apple-silicon macOS as the first explicit platform slice; a tarball-only external proof from clean source revision `a75ddd51…` launches doctor with `DYLD_*` scrubbed, scaffolds and generates offline, starts/loads/watches/stops a managed server, seeds only a newly created database, and refuses a mismatched attach. Public npm publication and separately-provisioned clean-machine evidence remain open, so Status stays Draft); 2026-07-12 (ENG-24504/ENG-24505/ENG-24507: one exact root Bun authority and lock-installed TypeScript, with Bun as the sole root lock; earlier 2026-07-09 ENG-22564: demo/admin Exact dependency policy implemented with published packages and committed locks; earlier: 2026-07-07 cross-family review revisions, ratified by Charlie — see
`reviews/0041-packaged-dev-loop.claude.md`: runtime-distribution design
section added, package/CLI surface corrected to repo reality, LLP 0030
boundary stated, ready-file attach pinned; initial same day)
**Related:** LLP 0000, LLP 0010, LLP 0012, LLP 0015, LLP 0016, LLP 0021, LLP 0023, LLP 0024, LLP 0030, LLP 0037, LLP 0038, LLP 0042

## Summary

This RFC turns Snapback's repo-local development experience into an installable
developer loop. It covers runtime distribution, package boundaries,
scaffolding, watch mode, and demo dependency pinning. It deliberately does not
define MCP; that is [LLP 0042](./0042-agent-mcp-surface.rfc.md).

The first packaged loop should provide:

- a distributable `snapback` server binary with its native Hermes runtime —
  the hard problem, addressed first below;
- versioned `@snapback/*` packages;
- a `snapback` CLI usable outside this monorepo;
- `snapback new`;
- `snapback dev` watch mode;
- generated artifacts with stale-artifact diagnostics;
- demos that depend on pinned packages rather than sibling checkout HEADs.

## Motivation

The current loop is strong for an agent already inside the Snapback repository
with Exact and Ibex arranged correctly. It is weak as an offering: there is no
clean install path, no scaffold command, no watch mode, and some demos still
depend on private or sibling repository state.

This blocks external validation. A first outside consumer should not need to
learn the repository topology before learning Snapback.

## Design

### Runtime distribution

The prerequisite everything else stands on: the `snapback` binary embeds Hermes
via the vendored Ibex runtime. On macOS it needs `hermesvm.framework` resolved
at an `LC_RPATH`-relative path, and today only `scripts/bootstrap-ibex-runtime`
produces a runnable layout. "A clean directory outside the monorepo" is
unbuildable until an external user can obtain a working server without that
script.

The intended shape:

- prebuilt per-platform `snapback` binaries with the Hermes
  framework/libraries laid out relative to the binary, fetched on install;
- installation via an npm wrapper package (postinstall fetch) and/or direct
  download; `cargo install` remains a from-source path for contributors, not
  the paved road;
- every fetch/layout failure path reports the existing stable codes —
  `SNAPBACK_IBEX_HERMES_DOWNLOAD_FAILED`, `SNAPBACK_IBEX_HOST_UNSUPPORTED` —
  extended per platform as needed;
- `snapback doctor` (below) validates the installed layout the same way
  bootstrap validates the repo layout: by launching the binary, not just
  checking files.

The first implemented distribution slice uses two scoped packages so the
already-occupied unscoped `snapback` registry name is irrelevant:
`@snapback/cli` exposes the `snapback` bin, and its platform-selected optional
dependency `@snapback/runtime-darwin-arm64` carries `bin/snapback` beside
`Frameworks/hermesvm.framework`. The binary carries
`@loader_path/../Frameworks` in `LC_RPATH`; contributor-checkout absolute
RPATHs may coexist but are never the packaged binary's only loader path.
Unsupported host tuples fail with `SNAPBACK_IBEX_HOST_UNSUPPORTED` rather than
building Hermes during install. Additional platform packages remain required
before a broader host-support claim.

Unsupported host platforms are a declared capability fact, not a broken
install.

### Package boundaries

The source/import namespace is `@snapback/*`. LLP 0021's deferred registry
probe reopened the public-name decision on 2026-07-21 because
`@snapback/cli` is an unrelated public package. Until durable names are
ratified, publication uses clearly labeled `@ccheever/snapback-*`
prereleases; npm aliases preserve the source/import names. What exists today
as private workspace members versus what is genuinely new work:

- `@snapback/codegen` — exists; needs versioned publishing.
- `@snapback/contract` — exists (the Contract adapter, which is also the
  shared runtime helper — no separate `runtime-links` package is needed;
  runtime links are generated per-app modules emitted by codegen).
- `@snapback/admin-client` — exists.
- `@snapback/client` — **new work**: promote the headless client currently
  living at `demos/_kit/client.mjs` into a real package.
- `snapback` CLI/binary distribution — **new work**, per Runtime distribution.

The first implementation realizes that last row as `@snapback/cli` plus the
platform runtime package above. `@snapback/app-cli` remains the distinct
artifact-driven application/agent command; it is not renamed into the
developer-loop CLI.

The packages may initially be private or prerelease, but demos must consume
versioned artifacts instead of sibling-at-HEAD paths.

### CLI commands

The CLI already projects the host-ops verbs as top-level subcommands (`start`,
`stop`, `inspect`, `reset`, `load`, `run`) emitting `hostOpsResult` envelopes —
that surface stays as-is; there is no separate `host-ops` verb to add. The new
commands:

- `snapback new <name>` creates an app from a template.
- `snapback dev` runs codegen, starts or attaches to the local server, and
  watches schema/functions/surface files.
- `snapback generate` runs codegen only.
- `snapback doctor` checks the installed runtime/package state — wrapping and
  extending the existing `scripts/ibex-doctor` read-only coded diagnosis, not
  inventing a parallel one.

Commands return structured diagnostics and stable exit codes. Human text is
rendered from the structured result.

### Watch mode

Watch mode coalesces edits and performs:

1. source discovery;
2. codegen;
3. schema/function load into the running server;
4. stale artifact checks;
5. optional surface rebuild.

A failed push to a running server must not make offline codegen fail. The result
should distinguish "generated but not loaded" from "generation failed."

`snapback dev`'s attach path consumes the readiness handshake that already
shipped: `snapback start --ready-file` writes a `HostReadyDescriptor`
(`schemas/host-ready.schema.json`); dev attaches via the descriptor — never by
log parsing — and refuses a mismatched server with a
`SNAPBACK_DEV_SERVER_TARGET_MISMATCH`-style structured diagnostic, using
LLP 0030's vocabulary.

**Boundary with LLP 0030:** the `@snapback/vite` plugin and this CLI are two
projections of the same host-ops core, per 0030's rule that no consumer grows
a private lifecycle dialect. The CLI owns watch/codegen orchestration; the
Vite plugin owns the frontend dev-server integration and attaches to a
CLI-managed (or self-managed) server through the same ready-file/host-ops
surface. Neither embeds the other's logic.

### Templates

The first templates:

- `todo-contract` — first, because its client surface exists today;
- `todo-react` — requires the React hooks package that does not yet exist;
  that package is named, scoped work under this RFC, not an assumed
  dependency;
- `ephemeral-cursors`;
- a minimal headless test fixture.

Each template includes a small acceptance script that can run without external
services.

### Demo dependency policy

Repository demos should exercise the same packages the external loop would use.
ENG-22564 implemented that policy for the Contract corpus: every demo surface
and `admin-ui` consumes published `@ccheever/exact-*` packages through stable
`@exact/*` aliases, owns a committed `bun.lock`, and runs its own Vite binary.
The old `exact.pin.json`, source-alias, patch, native-asset bridge, and
`cd ../../exact` paths are gone. `scripts/check-required-surface-builds.mjs`
hard-fails on a missing lock or surviving pin and production-builds required
surfaces from frozen registry installs. The capability resolver still accepts
an explicit/local Exact checkout before packages for unpublished Exact
development, but ordinary demo/admin builds never reach into sibling source.

That is the standing policy: demos consume a recorded package version (or a
pinned vendored/tarball snapshot when registry publication is impossible),
never sibling checkout HEAD. Local unpublished Exact work uses uncommitted
tarball/link overrides and restores the committed registry lock before landing.

The repository root likewise has one dependency authority: the exact
`packageManager` Bun version plus `bun.lock`. Root npm/yarn/pnpm installs fail
closed rather than creating a second graph. TypeScript and other proof tools are
resolved from that lock; they are never fetched ad hoc during a gate. Demo
subprojects may retain their own declared package-manager locks because they are
outside the root workspace and exercise independent consumer setups.

## Non-goals

- Hosted deployments.
- MCP server implementation.
- A full package registry release policy.
- Supporting every frontend framework in the first template set.
- Hiding the need for `scripts/bootstrap-ibex-runtime` in Snapback **core**
  work — contributors building Snapback itself still bootstrap; only app
  authors get the prebuilt path.

## Acceptance

- A clean machine (not just a clean directory) can install the `snapback`
  binary with its runtime, and `snapback doctor` validates the layout by
  launching it.
- A clean directory outside the monorepo can run `snapback new todo-contract`,
  `snapback dev`, and the generated acceptance test.
- `snapback dev` attaches to an already-running server via the ready-file
  descriptor and refuses a mismatched target with a structured diagnostic.
- An edit to schema or functions under `snapback dev` produces regenerated
  artifacts and either a hot-pushed server load or a distinguishable
  "generated but not loaded" state.
- Codegen can run offline and reports server-load failure as a warning when
  source generation succeeded.
- Demos no longer consume sibling-checkout paths; a check fails on any sibling
  reach-through.
- `snapback doctor` catches missing runtime setup with stable diagnostic codes.
- CI runs at least one template from a packed or published package artifact.

## Open Questions

- Which Exact package-version cadence should generated templates follow once
  `snapback new` exists, and how long should old template locks remain tested?
- Schema JSON Schemas are generated from the Rust types (LLP 0037) — settled;
  what remains open is only how the external loop ships them: bundled with the
  CLI, published as a package, or served by the running server.
- Which platforms does the first prebuilt-binary matrix cover, and is a
  from-source fallback acceptable for the rest?

## Status

Draft. The Apple-silicon macOS tarball closure and external-directory loop are
implemented and retained by
`scripts/snapback-package-cold-install.mjs`: packed runtime launch, `new`,
offline `generate`, managed `dev`, ready-file attach, watched regeneration and
load, mismatch refusal, stop cleanup, app-CLI introspection, and browser
adapter bundling all pass. The same proof now has a fail-closed registry mode
for the provisional `@ccheever/snapback-*` npm aliases. That is not yet the RFC
exit: npm authentication exists, but the first real publish stopped at npm's
interactive OTP challenge and no version is publicly visible. The proof is a
clean directory rather than an independently provisioned clean machine, and no
non-darwin-arm64 runtime package exists.
