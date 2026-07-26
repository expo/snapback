# LLP 0041: Packaged developer loop

**Revised (public closure published):** 2026-07-26 (the complete decided
eight-package `@ccheever/snapback-*` closure is now public as `0.1.0` under
`latest`, built from clean Snapback main revision
`ca92d02943e72c2ced7861a0cff54b8821878d48`. The retained publication ledger
at
`demos/partiful-matrix/acceptance/evidence/step5-package-publication.json`
binds every staged tarball byte-for-byte to the artifact returned by the
official npm registry. Publication alone does not satisfy the packaged-loop
claim: the new GitHub-hosted macOS/arm64 and Linux/x64 public-install
executions and their aggregate receipt remain pending.)

**Revised (public-registry proof instrument):** 2026-07-26 (the cold-install
instrument now has an explicit fail-closed `public` mode: it accepts only a
clean successful publication ledger for the complete decided
`@ccheever/snapback-*` closure, downloads every exact registry tarball without
scripts, checks the registry bytes against ledger-bound SHA-256 identities,
and installs by public npm alias rather than local tarball path. A separate
aggregate instrument admits the packaged-loop claim only when new
GitHub-hosted `darwin-arm64` and `linux-x64` machines both return public,
clean-machine receipts for the same source revision and package closure.
Publication and those two executions remain pending, so this amendment creates
no green claim.)

**Revised (LLP 0074 doctor vertical slice):** 2026-07-22 (`snapback doctor`
now proves launch, generated bundle load, VM query, isolated-database mutation,
live subscription open/close, owned shutdown, and temporary-state cleanup with
stable per-boundary codes. Its first real run found and fixed the macOS
`/var`→`/private/var` canonical-path false mismatch in target/admin-token
fencing. The packed external proof now requires the full vertical result;
public npm and independent-machine gates remain open.)

**Type:** RFC
**Status:** Draft
**Systems:** Developer experience, Tooling, Build, Client integration, Demo apps, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-07-24 (the clean-Ubuntu lane now records platform,
architecture, kernel, Node, exact runtime package, and GitHub-hosted clean-VM
status in the cold-install receipt, then retains that receipt, the publication
ledger, and immutable tarballs through a commit-pinned artifact uploader. The
workflow remains unexecuted on this working tree). 2026-07-24 (the provider-independent Linux packaging prerequisite for LLP 0072 now has an `@snapback/runtime-linux-x64` package contract, loader-relative Hermes RUNPATH, CLI platform selection, all-runtime publication mode, and a clean-Ubuntu build/pack/cold-install proof lane. The package identity tests and macOS host-closure proof pass; the Linux binary and clean-machine receipt still require that Ubuntu lane, and nothing is publicly published). 2026-07-23 (LLP 0079 SC-2b: the dev loop gains its client arm — `snapback dev --client` runs a client surface in the same watch process after first load, with a minimum verb slice (status / force regenerate-and-reload / restart backend) surfaced both interactively (TTY keys) and machine-readably (`snapback.dev-command.v1` stdin commands over the `snapback.dev.v1` event stream); §Acceptance gains the client-arm criterion and §Watch mode gains the Exact-side client-arm seam definition); 2026-07-23 (LLP 0079 SC-3: hot-push is artifact load, not data migration — recorded as a standing constraint in §Watch mode with LLP 0078 R2 as external evidence); 2026-07-21 (the first-publication probe found that `@snapback/cli` is an unrelated public 3.x package, reopening LLP 0021's namespace decision exactly as its caveat required. The publisher's provisional `@ccheever/snapback-*` mapping passes npm dry-run as the labeled `0.1.0-llp0063.1`/`llp0063` prerelease. The cold-install proof now has distinct tarball and registry modes, refuses to describe renamed tarballs as an offline closure, and requires registry identity/version/integrity plus a successful publish ledger before registry installation. npm's interactive OTP challenge stopped the real publish before a version became visible, so public-registry, clean-machine, and multi-platform evidence remain open and Status stays Draft); 2026-07-20 (LLP 0063 Step 5 implementation checkpoint: `@snapback/cli` now owns `new`/`generate`/`dev`/`doctor`, delegates established host operations to the native CLI, and consumes the ready-file handshake with target fencing; `@snapback/runtime-darwin-arm64` carries a relocatable release binary plus Hermes framework, with Apple-silicon macOS as the first explicit platform slice; a tarball-only external proof from clean source revision `a75ddd51…` launches doctor with `DYLD_*` scrubbed, scaffolds and generates offline, starts/loads/watches/stops a managed server, seeds only a newly created database, and refuses a mismatched attach. Public npm publication and separately-provisioned clean-machine evidence remain open, so Status stays Draft); 2026-07-12 (ENG-24504/ENG-24505/ENG-24507: one exact root Bun authority and lock-installed TypeScript, with Bun as the sole root lock; earlier 2026-07-09 ENG-22564: demo/admin Exact dependency policy implemented with published packages and committed locks; earlier: 2026-07-07 cross-family review revisions, ratified by Charlie — see
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

The implemented distribution slices use source-scoped packages so
the already-occupied unscoped `snapback` registry name is irrelevant:
`@snapback/cli` exposes the `snapback` bin, and its platform-selected optional
dependency `@snapback/runtime-darwin-arm64` carries `bin/snapback` beside
`Frameworks/hermesvm.framework`. The binary carries
`@loader_path/../Frameworks` in `LC_RPATH`; contributor-checkout absolute
RPATHs may coexist but are never the packaged binary's only loader path.
The Linux x86-64 twin, `@snapback/runtime-linux-x64`, carries `bin/snapback`
beside `lib/libhermesvm.so`; the final binary carries
`$ORIGIN/../lib` in its ELF RUNPATH because a dependency build script cannot
install that link argument on Snapback's final executable. Its package
preparer validates both inputs as x86-64 ELF before staging, and a clean Ubuntu
lane must launch it with `LD_LIBRARY_PATH` absent before publication.
Unsupported host tuples fail with `SNAPBACK_IBEX_HOST_UNSUPPORTED` rather than
building Hermes during install. Additional platform packages remain required
before claiming support beyond Apple-silicon macOS and x86-64 Linux.

Unsupported host platforms are a declared capability fact, not a broken
install.

### Package boundaries

The `@snapback/*` source/import namespace is already decided (LLP 0021 / LLP
0032 P6). A live registry probe at the LLP 0074 checkpoint found
`@snapback/cli@3.0.1` occupied by an unrelated product and no project authority
over that scope. The first public distribution therefore uses the already
implemented `ccheever` publication preset: `@snapback/<name>` is staged as
`@ccheever/snapback-<name>`, and internal dependencies use npm aliases so
application imports and workspace manifests do not churn. Publication receipts
bind both names and immutable tarball digests. A future organization-owned
brand scope may replace this public alias without changing authored imports.
What exists today as private workspace members versus what is genuinely new
work:

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

**Standing constraint (2026-07-23, LLP 0079 SC-3; evidence LLP 0078 R2):**
the dev-loop hot-push is **artifact load, not data migration** — it replaces
loaded schema/function artifacts in a running server and never rewrites
persisted rows. If hot-apply ever grows into data-bearing schema migration of
a running system (Serverpod 4's headline feature, and the one most likely to
need an F2-style course correction), each applied migration must be a
**versioned commit the sync and read-set-validation machinery sees** — never
a side-channel mutation — and it stays a dev-target affordance until a
production migration story is separately accepted. LLP 0003 owns the
commit-versioning machinery this constraint binds to.

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

**Client arm and the Exact-side seam (2026-07-23, LLP 0079 SC-2b).**
`snapback dev --client <surface-dir>` (or `--client-command`) runs a client
surface in the same watch process: the client is spawned only after the
managed server is up and the first generate+load completed, its output is
wrapped into the machine-readable event stream, and teardown closes both.
The first client surface is the SC-2a-migrated Contract demo served through
`@snapback/vite` in `auto` mode. The loop's verbs — `status`, `reload`
(force regenerate-and-reload), `restart` (backend; managed child only,
refused for attached servers) — are available with or without a client arm,
interactively (TTY single keys) and machine-readably (newline-delimited
`snapback.dev-command.v1` commands on stdin, responses and states on the
`snapback.dev.v1` stdout stream).

The same contract is the **Exact-side seam** for a native Contract/Exact
client arm: an Exact surface participates by (a) being spawned as the
`--client-command` after first load, (b) discovering the backend through the
same `HostReadyDescriptor` ready-file and app-route surface the Vite plugin
consumes (never a private lifecycle dialect), and (c) reading loop state
from the `snapback.dev.v1` stream and driving the loop through
`snapback.dev-command.v1`. The Exact side owns its own dev-server/simulator
integration end to end; the CLI neither knows nor embeds it. Implementing a
native Exact arm is future work — this revision defines the seam so that
work needs no CLI changes.

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
- **Client arm (2026-07-23, LLP 0079 SC-2b):** from one command, an edit to
  `schema.mjs` or `functions.mjs` is observable in a running client surface
  (the SC-2a Contract demo through `@snapback/vite`) without restarting
  either process; the `generated-but-not-loaded` and `generation-failed`
  states surface to both the human and the machine-readable channel; and the
  minimum verb slice (status, force regenerate-and-reload, restart backend)
  is exercised by an automated test through the machine-readable channel and
  demonstrated interactively. (Met by
  `packages/snapback-cli/dev-loop.test.mjs`; interactive keys are unit-tested
  with a simulated TTY.)
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
adapter bundling all pass. The packaged doctor now executes the full disposable
runtime/storage/live vertical slice rather than only `--help`. That is not yet
the RFC exit. The public `@ccheever/snapback-*` alias set is decided and staged
from `@snapback/*` source identities, and the complete eight-package `0.1.0`
closure is now public under `latest` with a byte-bound publication ledger. The
fail-closed public-registry instrument and its two-platform clean-machine
aggregation workflow exist, but they have not yet executed against that
publication. The prior tarball proof on a development host and the
clean-Ubuntu staged-registry proof at workflow run `30215680492`, revision
`ca92d029`, remain useful checkpoints; neither substitutes for the pending
public-registry executions on new GitHub-hosted macOS/arm64 and Linux/x64
machines.
