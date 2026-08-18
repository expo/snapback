# LLP 0010: Agent DX and acceptance suite

**Type:** Spec
**Status:** Draft
**Systems:** Developer experience, Testing, API, Runtime, Build, Sync, Client integration
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-08-15 (a missing Cargo command now has the actionable
`SNAPBACK_IBEX_CARGO_NOT_FOUND` host diagnostic; genuine exact-link probe
driver faults retain `SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED`).
**Revised:** 2026-08-12 (runtime-readiness refusal recovery is custody-aware:
installed package seals name exact-package reinstall and never an in-package
source script, while contributor checkout repair names the complete clean
runtime/admin/package assembly command).
**Revised:** 2026-08-11 (runtime capability gaps are inspectable facts, not
diagnostic occurrences by themselves; an unavailable capability emits a
stable actionable diagnostic only when an operation actually requests it,
while retired codes remain reserved in the compatibility vocabulary).
**Revised:** 2026-08-10 (prepared Hermes artifacts are gitlink-stamped and must pass an early dlopen dependency-resolution probe). 2026-08-07 (LLP 0189 re-scope: release/capability-promotion authority follows the D-6 battery form; the former declared-complete-authority clause is superseded). 2026-08-06 (LLP 0175 D2 selector: every canonical gate is
classified by a checked path authority; docs/guide can remain fast, affected
code retains Contract/Exact and admin behavior plus prerequisite closure, and
unknown/shared inputs fail broad. Push/PR receipts bind the selection while a
six-hour/manual lane retains the complete inventory). 2026-08-06 (runtime
package seal: package production now refuses with
`SNAPBACK_RUNTIME_PACKAGE_QUALIFICATION_FAILED` unless the assembled
binary/Hermes pair passes CV-2; the package-owned readiness receipt binds the
verdict and native digests, and packaged resolution re-verifies it before
returning the binary.) 2026-08-05 (generated
starter acceptance correction: todo and
React default `test` commands now own an isolated real target, execute a query
and mutation, bind loaded artifact identity, reject short/vacuous runs, and
emit a bounded cleanup-complete receipt; static coherence is separately named
and cannot claim runtime acceptance). Earlier same day (LLP 0175 first implementation tranche: canonical
proof gates are named, timed, dependency-aware, and retained as JSONL; a
failed producer blocks transitive real-server consumers while independent
gates continue; bootstrap may reuse a clean exact-revision digest-bound
readiness result, and doctor retains its full default while adding the
receipt-only proof-consumer mode). 2026-08-03 (fresh-worktree Hermes reuse now requires the
prepared receipt's authority-bound source-cache key to match the vendored Ibex
revision before copy/use; incompatible sibling artifacts are skipped for the
existing vendored download/build fallback, while Ibex `build.rs` remains the
full exact-digest authority). 2026-08-02 (the shared exact-link probe now allows fifteen
minutes for its bounded build: a clean disposable target with CI's required
single Cargo job exceeded the former five-minute ceiling even though the
checkout's cached bootstrap build succeeded; timeout termination and target
cleanup are unchanged). 2026-08-01 (CV-3 packaged-consumer custody amendment: the
installable CLI now exposes `runtime-qualify --persist` / `--verify`, keeping
the same digest-bound schema under the app-owned
`.snapback/runtime-readiness.json` path and never writing into read-only
runtime packages; live qualification remains authoritative). 2026-07-31 (CV-3 landed: the qualification verdict is now a
persisted digest-bound readiness receipt — `<binary>.runtime-readiness.json`,
`snapback.runtime-readiness.v1` — issued by every kept-target probe run and
by `verify-local-proof`, re-verified by digest recomputation on every
consumption; doctor checks the SERVED binary read-only; the demo harness's
`configured`/`prebuilt` rungs verify-or-requalify and the `reused` rung
binds `/health` identity to a coherent local receipt; one shared
`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` code joins the registry; the
harness's old `unpinned` identity verdict splits into
`pinned-binary-dirty-checkout` / `unpinned-binary` (LLP 0115 CV-15) — see
§Dated note: runtime readiness gap, "CV-3 landing");
2026-07-30 (CV-2 landed: the bootstrap smoke now runs
`snapback runtime-qualify` against the final linked binary, so
`SNAPBACK_IBEX_RUNTIME_LINK_OK` proves armed handler-VM readiness and the
incident state fails with the new `SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED`;
the artifact copy bumps changed-file mtimes so a framework refresh always
relinks; `verify-local-proof` qualifies its built binary; the persisted
readiness receipt (CV-3) and the demo-harness rung qualification remain
open — see §Dated note: runtime readiness gap. Earlier same day, the dated
gap note itself: the Diary 0039 rerun proved the bootstrap link+launch smoke
was satisfiable by a binary that cannot create the handler VM);
2026-07-27 (LLP 0108 amendment: generated review evidence covers
inline-handler admission, effective result contracts, exact client inference,
and pre-publication/pre-commit validation); 2026-07-23 (dated pointer note: LLP 0089 proposes the agent provisioning acceptance gate under this Spec's bar); 2026-07-12 (ENG-24351 isolation follow-up: an AST-resolved exact graph is evaluated as bundled bytes in a capability-empty, permission-denied child VM; computed ambient access and nondeterminism are unavailable by construction, including indirect locale-sensitive intrinsic methods; evaluated output must be strict JSON data rather than values `JSON.stringify` would silently coerce or drop; every privileged input read is an fd-attested, root-contained capability and handler paths are canonical backend-relative identities; the cache-busting generation worker pins an empty exec-argument set, repository cwd, minimal environment, disconnected data stdio, and one IPC result so caller `--eval`/preload/debug authority cannot contaminate it; node_modules package scopes stop at their boundary; canonical evaluated values join artifact identity, and every identity domain/item is byte-length-framed so source-legal NUL bytes cannot alias path/source boundaries; ENG-24378: demo helpers launch on an OS-assigned port, accept readiness only through a unique descriptor plus matching build/startup identity, return credentials explicitly, and tear down the process tree race-free; earlier ENG-24351: CommonJS/dynamic/ambiguous graphs fail closed and generated identity covers every permitted transitive input). 2026-07-03 (acceptance ladder: collaborative graffiti/whiteboard slice added between kanban and card game — shipped as `demos/graffiti/` (ENG-22219, Diary 0006) — and §Reference-App Coverage moves the whiteboard from needs-profile to covered; ladder reconciled with LLP 0015/0016 per LLP 0016 R6. Earlier same day: ENG-22595: bootstrap resolves the vendor/ibex submodule state before writing artifacts; scripts/ibex-doctor added. ENG-22660: stable diagnostic codes for the non-submodule bootstrap failure paths; ENG-22664: crates/snapback/build.rs emits the macOS Hermes LC_RPATH and bootstrap validates with a real link + launch)
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0004, LLP 0005, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0011, LLP 0012, LLP 0013, LLP 0014, LLP 0015, LLP 0024, LLP 0108, LLP 0175

## Summary

Snapback is agent-first. That is not a slogan about who types the code; it is a
requirement that the system expose stable, machine-readable facts an agent can
use to build, run, inspect, validate, and repair an app without hidden state or
human-only debugging rituals.

This Spec defines the first agent developer-experience contract and the initial
acceptance suite. The goal is to make the first implementation self-checking
from the beginning, not to add polish after the architecture exists.

## Scope

This Spec owns:

- the minimum local commands or command-equivalent tool surfaces agents need;
- machine-readable diagnostics;
- inspectable generated artifacts;
- deterministic reset and fixture behavior;
- the first reference-app acceptance ladder;
- required validation before broadening the subsystem surface.

It does not own the detailed semantics of storage, sync, auth, runtime security,
or client adapters. Those are covered by their subsystem LLPs. This Spec defines
how agents prove those contracts are working.

## Agent Contract

An agent working on a Snapback app must be able to answer:

- what schema is loaded;
- what functions are loaded;
- what generated artifacts changed;
- what target capabilities are available;
- whether the local server is ready;
- what database version and subscriptions exist;
- why codegen failed;
- why a query, mutation, permission check, or subscription failed;
- whether local optimistic execution and server execution disagree;
- what command or file should be changed next.

The system should prefer structured output over prose. Human-readable summaries
are useful, but every important diagnostic should have a stable code, target,
source span where possible, severity, and machine-readable details.

## Required Tool Surfaces

The exact CLI names are not fixed here, but the first implementation must expose
these operations:

- start the canonical local server;
- stop or restart it cleanly;
- reset the local app database deterministically;
- load or reload schema and functions;
- inspect loaded schema, functions, capabilities, database version, connected
  clients, active subscriptions, and recent errors;
- run a query or mutation as a chosen auth context;
- explain query plans, index usage, permission decisions, and capability gaps;
- run the acceptance suite.

Test helpers normally bind port zero and accept readiness only from their unique
nonce. A restart proof that must preserve one client origin may explicitly ask
the child to bind the released port; it never reuses an occupant, and the OS
bind plus nonce-attested ready file remain the authorities. This keeps
same-origin reconnect coverage without restoring a probe-then-bind adoption
race. `[confirmed — Charlie Cheever / Codex, 2026-07-12, ENG-24502]`

The concrete v0 operation ids, CLI verbs, HTTP projection, control-plane MCP
tools, and generated app-data MCP catalog are pinned in
[LLP 0024](./0024-agent-operating-surface.spec.md). Any surface exposing these
operations should share that underlying structured result schema.

## Native Runtime Bootstrap

The canonical local target depends on Ibex, and Snapback currently links the
vendored `ibex-runtime` crate directly. That means an ordinary Rust build can
fail before any Snapback code is checked if the ignored Hermes headers,
frameworks, or compiler tools are missing under `vendor/ibex`. This is an
agent-DX failure: the agent sees a native Hermes error and starts trying to build
or repair Hermes, even though most Snapback work only needs prepared runtime
artifacts.

The Snapback bootstrap contract is:

- Normal Snapback agents run `scripts/bootstrap-ibex-runtime` before `cargo
  build`, `cargo test`, or `cargo run` on a clean checkout.
- The bootstrap resolves the `vendor/ibex` submodule checkout state before it
  writes anything into that path (ENG-22595). A fresh clone or worktree that
  has not run `git submodule update --init` gets the submodule initialized
  automatically. If the submodule is uninitialized but the directory already
  holds stray files, the bootstrap still attempts the init — a retained
  submodule gitdir can check out over regenerable artifacts — and only when
  git cannot complete it refuses with `SNAPBACK_IBEX_SUBMODULE_WEDGED`,
  printing the recovery commands (move the stray directory aside, init the
  submodule, re-run the bootstrap) rather than deleting anything.
- The bootstrap then validates the vendored Ibex artifact locations expected by
  `vendor/ibex/build.rs` and prefilters their profile-provenance receipt against
  the authority-bound source-cache keys reconstructed from the vendored Ibex
  revision. This is an early compatibility check; `vendor/ibex/build.rs` still
  independently reconstructs and validates the complete reviewed identity.
- Every prepared set is stamped with the exact `vendor/ibex` gitlink pinned by
  the Snapback revision. Reuse requires that stamp to match, and an early
  `dlopen` probe must resolve the runtime library plus its transitive loader
  dependencies. A pre-stamp local set may be adopted once only when its checked
  out Ibex revision, reviewed profile receipt, and loader probe all match.
- If those are incomplete or profile-incompatible, it prefers a sibling
  `../ibex` checkout with compatible prepared Hermes artifacts and an optional
  prebuilt `ibex` binary, copying/linking those ignored artifacts into
  `vendor/ibex`. A structurally complete sibling from another reviewed-profile
  authority is skipped rather than copied.
- Agents may point at a different prepared checkout with
  `SNAPBACK_IBEX_CHECKOUT=/path/to/ibex`; it must be compatible with the
  vendored revision under the same prefilter.
- Only when no complete compatible prepared artifact set exists should it fall
  back to Ibex's platform setup scripts, which may download or build Hermes.
- Agents should not start by building Hermes from source unless their task is
  explicitly about Ibex, Hermes, or runtime packaging.

This keeps the local target honest without making every Snapback agent rediscover
Hermes packaging details. A failed bootstrap should point at the missing artifact
class, not leave the next agent to infer it from a C++ build failure.

On macOS the built `snapback` binary loads `hermesvm.framework` through an
`@rpath`-relative install name. Cargo does not propagate the vendored
`ibex-runtime` build script's `-rpath` link-arg to the final binary (only
`rustc-link-lib`/`rustc-link-search` flow through), so `crates/snapback/build.rs` in the
Snapback crate emits the matching `LC_RPATH` itself. Without it, a fresh
worktree's first `cargo run` crashed at launch (`Library not loaded:
@rpath/hermesvm.framework/...`, `Reason: no LC_RPATH's found`) because macOS SIP
strips `DYLD_*` for protected process trees, and `cargo check` — which never
links or loads the framework — could not catch it (ENG-22664). The bootstrap now
validates by building and launching the binary with `DYLD_*` scrubbed (a real
link + load), not by `cargo check` alone, so that wedge surfaces at bootstrap
time with `SNAPBACK_IBEX_RUNTIME_LOAD_FAILED` instead of at first run.

On Linux the final binary likewise carries only the public runtime package's
loader-relative `$ORIGIN/../lib` RUNPATH. An exact-link probe stages the
bootstrapped `libhermesvm.so` beside its disposable Cargo target as
`debug/../lib/libhermesvm.so` before launch. It does not set
`LD_LIBRARY_PATH` or embed a checkout-absolute search path, so the probe
exercises the same relocatable closure later assembled into the platform
package.

`scripts/ibex-doctor` is the read-only companion: it classifies the
`vendor/ibex` states an operator hits during bring-up (source missing,
submodule uninitialized, submodule wedged — with or without Ibex sources in
the directory — checkout drift, prepared Hermes artifacts missing) as
human-readable findings that reuse the stable codes, severities, and
suggested-next-checks vocabulary of the diagnostic shape below, without
writing to the tree. Once the static prerequisites pass, it builds the exact
`snapback` Cargo binary in an automatically cleaned temporary target and
launches that new binary with dynamic-loader overrides scrubbed. Success
therefore means both “the current checkout is buildable” and “the just-linked
binary is runnable”; an older runnable `target/debug/snapback` is reported
separately and never substitutes for that proof. Text and JSON modes carry the
same `snapback.runtime-recovery.v1` record: selected binary and resolver rung,
expected checkout commit/dirty state, actual binary stamp when inspectable,
automatic-reuse reason, exact producer inputs, and safe bootstrap or explicit
binary-override recovery. The shared probe remains bounded and kills its Cargo
process group before cleaning the temporary target on timeout; its fifteen-minute
deadline admits a clean serialized hosted build without accepting a stale or
cached substitute.

The full disposable-target doctor probe remains the default for interactive
diagnosis, fresh-worktree bring-up, and clean-machine lanes. Inside the
canonical proof, an explicit `--reuse-authoritative-build` mode is permitted
only after the named native bootstrap producer has built and handler-VM-
qualified the ordinary served binary. That mode still runs every source,
artifact, toolchain, loader, and digest-bound readiness-receipt check; it only
suppresses the second disposable Cargo target. Selecting it without a served
binary or coherent receipt is an error, never a skip. On a clean checkout,
bootstrap itself may return early when the exact current revision, debug build
identity, binary digest, current Hermes artifact digests, and restricted
no-eval handler-VM probe all match the persisted receipt. Dirty checkouts do
not take that shortcut because a commit id cannot identify uncommitted source
bytes. [LLP 0175](./0175-local-proof-economics.rfc.md) D3.1–D3.2 owns the
economic rationale.

[observed] A package manager path dependency whose target is
`packages/snapback-cli` is a third custody shape: it is neither a published
install nor an implicit developer-machine override. The linked CLI recognizes
that it is executing inside the owning source checkout and selects only
`target/release/snapback`. Selection requires the checkout's scoped runtime
inputs to be clean, the binary's independent stamp to match the checkout
commit and crate version with a `release` profile, and the ordinary sibling
`snapback.runtime-readiness.v1` receipt to reopen against the current binary
and Hermes artifacts. Missing or stale state emits the bootstrap, release
build, and receipt-issuance commands. It never falls through to or manufactures
a package-production seal. A CLI without that exact source topology continues
to require its platform runtime package and production seal. When an
application persists its own verify receipt for this source runtime, the
artifact root remains the checkout (including the bootstrapped Hermes inputs),
not the binary's `target/` parent.

### Bootstrap diagnostic codes

`scripts/bootstrap-ibex-runtime` fails with a stable `SNAPBACK_*` code prefix on
every failure path, and `scripts/ibex-doctor` reuses the same vocabulary, so
agents match on codes rather than prose. The submodule-state codes (ENG-22595):

- `SNAPBACK_IBEX_SOURCE_MISSING` — `vendor/ibex` has no sources and is not a
  known git submodule in this tree.
- `SNAPBACK_IBEX_SUBMODULE_UNINITIALIZED` — recorded gitlink, empty path, never
  initialized (doctor's clean-fresh-worktree finding).
- `SNAPBACK_IBEX_SUBMODULE_WEDGED` — uninitialized gitlink over stray content
  that `git submodule update --init` cannot check out; bootstrap prints the
  move-aside recovery steps.
- `SNAPBACK_IBEX_SUBMODULE_INIT_FAILED` — `git submodule update --init` failed
  (network/credentials).
- `SNAPBACK_IBEX_SUBMODULE_BROKEN` — initialized but `Cargo.toml` still missing.
- `SNAPBACK_IBEX_SUBMODULE_DRIFT` (warning) / `SNAPBACK_IBEX_SUBMODULE_CONFLICT`
  — doctor-only checkout-state findings.

The remaining (non-submodule) bootstrap failure paths carry codes too
(ENG-22660):

- `SNAPBACK_DEV_IDENTITY_CONFIG_FORBIDDEN` — a production boot found the
  per-process developer-identity sidecar on its resolved custody anchor and
  refused before binding; the operator removes that stale sidecar only after
  confirming no non-production server still owns it (LLP 0262 D1).
- `SNAPBACK_IBEX_HOST_UNSUPPORTED` — the host OS has no bootstrap/doctor artifact
  probe; use `vendor/ibex` platform setup directly.
- `SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING` — prepared Hermes
  headers/frameworks/tools are still incomplete after the copy/download attempt.
  Shared with `scripts/ibex-doctor` and `demos/_kit/server-process.mjs`, so an
  agent sees one code for this state across bootstrap, doctor, and the demo
  runner.
- `SNAPBACK_IBEX_HERMES_DOWNLOAD_FAILED` — the vendored `download-hermes.sh`
  fallback failed and no sibling Ibex artifacts were available.
- `SNAPBACK_IBEX_HERMES_ARTIFACTS_UNUSABLE` — Hermes files are present, but
  their artifact stamp does not match the pinned `vendor/ibex` gitlink or the
  host loader cannot `dlopen` the runtime and its dependencies. The bootstrap
  refuses before Cargo; `scripts/ibex-doctor` reports the same code and loader
  error read-only.
- `SNAPBACK_IBEX_CARGO_NOT_FOUND` — the exact-link probe could not find the
  Cargo command it tried to launch. Install the Rust toolchain, or put
  `~/.cargo/bin` on `PATH`.
- `SNAPBACK_IBEX_CARGO_BUILD_FAILED` — artifacts verified, but the
  Snapback/vendored-runtime build did not compile (a code error, not a missing
  artifact).
- `SNAPBACK_IBEX_RUNTIME_LINK_FAILED` — compilation reached the final consumer
  link, but its producer libraries do not provide every required symbol. The
  diagnostic names every parsed missing symbol and records the exact Cargo,
  Rust, target, feature, native environment, and artifact inputs.
- `SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT` — the disposable exact-link probe did
  not finish inside its bounded deadline; its temporary target is still
  removed.
- `SNAPBACK_IBEX_RUNTIME_LINK_INTERRUPTED` — the probe received `SIGINT` or
  `SIGTERM`, terminated its Cargo process group, and removed its temporary
  target before returning.
- `SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED` — the probe driver itself failed
  before it could emit its structured result.
- `SNAPBACK_IBEX_RUNTIME_LOAD_FAILED` — the binary links but cannot load
  `hermesvm.framework` at launch without `DYLD_*` set, i.e. it is missing the
  `LC_RPATH` that `crates/snapback/build.rs` emits (ENG-22664).
- `SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED` — the binary links and launches,
  but `snapback runtime-qualify` could not create and destroy the restricted
  no-eval handler VM (`RuntimeGuard::create`'s exact constructor, including
  the Hermes promise-rejection-checkpoint prerequisite). The recovery record
  carries the qualification verdict beside the framework digests
  (`producerInputs.nativeArtifacts`) and the binary's build identity, so an
  artifact/link-ordering incoherence is diagnosable from the record alone.
- `SNAPBACK_RUNTIME_PACKAGE_QUALIFICATION_FAILED` — runtime package production
  assembled the final loader-relative binary/Hermes layout, but its
  short-lived `runtime-qualify` process could not create the restricted
  handler VM. No package seal is issued. Cross-host Linux assembly may consume
  only a byte-bound successful verdict produced on the native Linux builder.
- `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` — the persisted runtime readiness
  receipt (`<binary>.runtime-readiness.json`,
  `snapback.runtime-readiness.v1`) for the selected binary is absent, stale,
  or incoherent: never issued since the binary was built, malformed, not
  carrying an OK qualification verdict, digest-mismatched against the binary
  (rebuilt after qualification), or digest-mismatched against the current
  Hermes artifacts (framework refreshed/swapped after issuance). One code for
  every consumer — doctor's read-only served-binary check, the demo
  harness's `configured`/`prebuilt`/`reused` rungs, and
  `scripts/verify-local-proof` — with the machine classification in
  `details.reason` and custody in `details.custody`. A source-checkout refusal
  names `packages/snapback-cli/runtime-readiness.mjs issue` for the narrow
  qualify-and-reissue operation and `scripts/assemble-runtime-package` for
  the complete clean binary/admin/package repair. A runtime-package refusal
  instead names reinstalling the exact platform package from the consumer's
  lockfile and exposes no in-package requalification command.

The bootstrap validation step links, launches, and handler-VM-qualifies the
final binary — not just `cargo check` — so the last three are caught at
bootstrap time rather than at the first real JS invocation.

Valet's local-dev orchestrator (a Vite plugin) already implemented most of this and
is worth copying: spawn the server child process, codegen-on-save with debounced
coalescing, hot-push schema/functions to a running server, a health check that
reuses an already-running server, a raw TCP probe to tell "nothing listening" from
"port owned by something else," and `SIGTERM`→`SIGKILL` teardown
(`[observed - Valet LLP 0020]`). Two corrections for an agent-first product:

The shared demo/test launcher makes that lifecycle concrete. A requested port
is only a candidate for provenance-verified reuse; a new child binds port zero
itself, then publishes the actual loopback address through a unique atomic
ready-file descriptor. The launcher accepts readiness only when `/health`
matches both that descriptor's per-process startup nonce and this checkout's
build identity. Thus an unhealthy occupant, a bind race, and a process that
exits before readiness cannot be mistaken for the child just spawned. The
launcher returns its admin credential as explicit client options rather than
mutating the parent environment, and teardown signals the whole child process
group with a bounded TERM-to-KILL sequence whose listener is installed before
the exit-state check. Teardown reports success only after the leader's close
and the platform tree proof both complete: bounded process-group `ESRCH` on
POSIX, or an awaited zero-status `taskkill /T` close on Windows. `[confirmed —
Charlie Cheever / Codex, 2026-07-12]`

The no-argument local server should also be collision-tolerant for ordinary
development: try a stable Snapback local port range beginning at the canonical
port `4287`, bind the first available port in that range, and print/report the
actual bound address through the startup log and admin runtime state. Tooling
that supplies an explicit `--port` is asking for a pinned address and should keep
getting exact bind semantics, including an error if that port is owned by another
process.

Auto-selecting a port must not allow two local servers to own the same
file-backed app database. A file-backed local server should acquire an exclusive
sidecar lock for the resolved SQLite path before opening the database, keep it
held for the server lifetime, and write enough owner metadata for a second
startup attempt to report the owning PID and bound server URL. In-memory servers
do not need this lock.

- **Never silently serve stale bindings.** Valet's plugin, if codegen failed at
  startup but old generated output existed, continued with the **stale files** —
  resilient for a human, but it silently runs a wrong model. A codegen failure must
  surface as a diagnostic and the capability/state report must mark the loaded
  bundle stale.
- **Local/offline tooling must exit cleanly.** Valet's codegen generated all files
  correctly, then returned a non-zero exit code because a configured server push
  failed offline — a false failure in an agent's validation loop
  (`[confirmed - Valet diaries, 2026-06-25]`). Treat push failure as a warning;
  provide a `--no-push`/local mode.

Deterministic reset and fixtures should include a **declarative seed that writes
directly to the replica, bypassing mutation handlers**. Valet's browser seeds ran
real mutations, which made fixtures imperative and order-sensitive against codegen
(`[confirmed - Valet diaries, 2026-06-25]`); a `seed:apply <state>` that writes
fixture data straight to storage is reproducible and inspectable.

## Diagnostic Shape

A diagnostic should include:

- stable code;
- severity: info, warning, error, fatal;
- subsystem;
- target profile;
- source file and span when applicable;
- generated artifact path when applicable;
- function, table, field, index, subscription, or capability id;
- concise message;
- machine-readable details;
- suggested next checks, when safe to infer.

Diagnostics must not require scraping logs. Logs can link to diagnostics, but
the diagnostic object is the contract.

## Generated Artifacts

Agents need inspectable generated facts, including:

- schema manifest;
- function manifest;
- generated function references;
- capability manifest;
- diagnostic schema;
- client/runtime adapter metadata;
- loaded-bundle hash;
- local target state.

Generated artifacts should be deterministic enough to diff. A schema edit that
changes one field should not rewrite unrelated generated output without reason.

**No silent drops — the single most important agent-first rule.** Anything codegen
cannot parse (a field, index, validator, sync rule, return type) must emit a
structured diagnostic with a stable code and source span, and **never** be silently
omitted. This is the worst failure mode an agent can hit, because it teaches a
*false model* of the app with no error to react to. Valet is the worked example on
both sides: its schema codegen used regex + brace-matching (not an AST) and a
field written as `lane: laneStatus` (a validator *variable* reference, which the
regex did not match) was **silently stripped from the persisted schema** — inserts
succeeded, every filter on that field returned nothing, and the bug surfaced only as
wrong UI after a seven-step debugging hunt
([LLP 0006](./0006-valet-retrospective.research.md),
`[confirmed - Valet diaries, 2026-06-25]`). Two requirements follow: prefer an
**AST parser over regex** for anything load-bearing (Valet itself moved to an AST
analyzer for its security-critical surface checks, `[observed - Valet LLP 0041]`),
and validate manifest completeness against what is actually persisted, so a field
that exists in source but not in the table is an error, not a shrug. A related
silent class: a query whose declared namespace did not match the table its handler
read left data in the database that never reached the UI — the manifest must make
the read-set / primary table explicit and checked
([LLP 0012](./0012-headless-integration-contract.spec.md)).

Generated artifacts should carry a staleness marker. Valet's manifest included an
`inputsHash` over all codegen inputs, which let a `doctor` check catch a stale
build before the app ran (`[confirmed - Valet diaries, 2026-06-25]`); adopt that as
the freshness signal behind "what generated artifacts changed."

The freshness boundary is the complete permitted static local module graph, not
only the entry files. An AST resolver admits literal relative/file edges only and
bundles exactly that graph; dynamic imports, CommonJS loaders, bare resolution,
`node:*` capabilities, query/hash-qualified specifiers, and `import.meta` fail
closed. Identity includes deterministic path/source pairs for every transitive
schema and function dependency **plus the canonical serialized schema/function
values produced by isolated evaluation**. Thus an evaluator/toolchain semantic
change cannot publish different definitions under the same content hash.
Each artifact-identity domain and each ordered identity item is byte-length
framed before hashing. Source text can legally contain NUL, so sentinel joining
would let bytes move across an adjacent path/source boundary without changing
the hash; length framing makes the complete-graph claim cryptographically
unambiguous.

The serialized value is strict JSON data before serialization: null, strings,
booleans, finite numbers other than negative zero, dense intrinsic arrays, and
plain or null-prototype objects with enumerable data properties. Known
symbol-backed definition builder markers are recognized and reified before
they are removed; the table builder is the sole accepted non-plain builder
object. `undefined`, functions,
symbols, bigint, non-finite numbers, negative zero (which `JSON.stringify`
would silently rewrite as zero), sparse/augmented arrays, accessors, hidden
properties, custom prototypes, and containers such as Map, Set, RegExp, Date,
and typed arrays fail evaluation. `JSON.stringify` coercion or omission is
never treated as validation.

Programmatic generation uses one cache-busting worker before the stricter
evaluation child. That worker starts with an empty Node exec-argument set, a
repository-root working directory, and an allowlist containing only the three
declared codegen environment inputs plus OS process-launch/temp plumbing;
`NODE_OPTIONS`, caller preloads, inspector flags, credentials, and caller cwd do
not cross the boundary. Its stdin and stdout are disconnected, stderr is only
the human diagnostic lane, and one IPC message is the structured result.

All privileged source reads (entry and transitive definition modules, governing
package manifests, handlers, seed/demo metadata, and committed codegen inputs)
resolve through a named root capability, attest a regular-file target, open the
canonical path with final-component no-follow where supported, compare the
opened device/inode to the resolved target, and hash the exact fd bytes read.
Handler source spellings are non-empty canonical forward-slash paths: absolute,
drive/URL, encoded, backslash, dot-segment, unsupported-extension, and
outside-root targets fail without replacing prior artifacts. In-root handler
symlinks resolve to the target's backend-relative POSIX identity; outside
symlinks fail. Definition graphs are limited to the canonical backend and this
repository. Physically external package-store symlinks are deliberately not an
ambient exception; supporting one later requires an explicit attested install
root rather than the old "contains node_modules" heuristic.

Definition evaluation is a capability boundary, not a token blacklist. The
bundled bytes run under Node 24 or newer in a second process whose permission
model denies filesystem, child-process, worker, addon, and inspector authority,
inside a fresh VM context with no host objects or network globals and with
string/Wasm code generation disabled. Node 24's permission model does **not**
deny network syscalls; the network boundary is the capability-empty VM, while
filesystem denial has both the VM and OS-permission layers. `process`, computed
`globalThis` access, `getBuiltinModule`, `Function`/`eval` constructor paths, and
equivalents therefore cannot recover unhashed input; a harmless local binding
named `process` remains legal. Wall clock, locale/timezone, and randomness are
also unavailable: `Date`, `Intl`, and `Math.random` are denied, and the
locale-sensitive methods on String, Number, BigInt, Date, Array, Object, and
typed-array prototypes are replaced with sealed throwing stubs before app
bytes run. Thus aliases, computed property access, and `Reflect.apply` cannot
derive different definitions from the host locale.

A `.js` or `.ts` dependency is accepted only when its nearest package scope
declares `type: module`; that governing manifest itself joins the hash. Package
scope lookup stops at every `node_modules` boundary, matching Node: a manifestless
installed package cannot inherit the consuming app's module type. CommonJS-scoped
or package-ambiguous files fail closed. Handler modules remain a
closed single-file runtime profile: imports are rejected before emission, so their
complete permitted graph is the declared handler source itself.

## First Slice Cutline

The first implementation should be a hard proof, not a broad demo. It should
include only:

- one trusted local app on the canonical Ibex + SQLite target;
- generated schema and function manifests loaded by the local server;
- one portable single-table indexed query shape;
- one restricted syncable-live query shape with an authoritative initial snapshot
  and online realtime deltas;
- one server-authoritative mutation path with one commit version per mutation and
  commit-time read-set conflict validation;
- deterministic reset and declarative seed;
- structured diagnostics for invalid schema, invalid function load, unsupported
  query form, stale generated artifacts, missing capability, and mutation
  conflict;
- one headless or React fixture consuming the generated contract.

The first slice should explicitly report these as capability gaps: offline
mutation replay, Postgres, Cloudflare, hosted/untrusted code, real external auth
providers, assets, cron, notifications, Contract/Exact Design Mode authoring,
rich text, high-frequency whiteboard fan-out, and finance-grade exact-money
invariants. A missing capability that is reported honestly is acceptable in the
first slice; a missing capability hidden behind fallback behavior is not.

## V0 Implementation Charter

Ratified on 2026-06-26: "first version of Snapback" means the first-slice proof
above, not a compressed v1. Implementation work should be reviewed against this
charter until it is replaced by a later accepted plan.

> **Superseded in practice (2026-07-01):** the implementation moved past this
> charter — cron, actions with outbound fetch, ephemeral realtime, and the
> admin console all shipped while it still said "must not claim" them. The V1
> charter below describes the current slice; it was drafted via
> [LLP 0032](./0032-decision-and-implementation-hardening.plan.md) R2 and
> **ratified 2026-07-01** (LLP 0000 ledger). V0 is preserved for the record.

V0 must include:

- the canonical local Ibex + SQLite server from LLP 0002;
- source-authored schema and handler entrypoints;
- generated schema and function manifests loaded by the local server;
- one indexed, portable, single-table query shape;
- one restricted syncable-live query shape with an authoritative initial
  snapshot and online realtime deltas;
- one server-authoritative mutation path using the accepted LLP 0003 execution
  boundary: async handler completion, buffered `ctx.db`, one commit version, and
  commit-time read-set validation;
- deterministic reset plus declarative seed that bypasses handlers;
- v0 schema/function/capability/diagnostic/runtime-state artifacts from
  LLP 0012;
- structured diagnostics for invalid schema, invalid function load, unsupported
  query form, stale generated artifacts, missing capability, and mutation
  conflict;
- one todo acceptance app, headless or React first, that proves query, mutation,
  live subscription, realtime update, conflict diagnostic, reset, and invalid
  schema/query diagnostics.

V0 must not claim:

- offline mutation replay;
- Postgres graduation;
- Cloudflare support;
- hosted or untrusted code execution;
- real external auth providers;
- assets, cron, notifications, actions, or outbound fetch;
- Contract/Exact Design Mode authoring;
- rich text or high-frequency whiteboard fan-out;
- finance-grade exact-money behavior.

## V1 Implementation Charter (ratified 2026-07-01)

Drafted via [LLP 0032](./0032-decision-and-implementation-hardening.plan.md)
R2 after the 2026-07-01 whole-repo review; ratified by Charlie 2026-07-01,
superseding the V0 charter above. "Current slice" means what ships from this
repository today.

V1 includes everything V0 included, plus:

- calendar-cron scheduled execution with run records and admin controls
  ([LLP 0028](./0028-cron-scheduled-execution.rfc.md));
- actions with outbound fetch behind `SNAPBACK_OUTBOUND_ACTIONS` — a coarse
  process-wide `network:fetch` grant, not a per-host allowlist
  ([LLP 0027](./0027-all-aboard-caltrain-demo.plan.md) recorded the corrected
  scope);
- ephemeral realtime state: declared collections, publish/subscribe, TTL and
  rate budgets, HTTP and WebSocket delivery
  ([LLP 0013](./0013-ephemeral-realtime-state.rfc.md));
- the admin console and `/_snapback/*` admin API with token/loopback gating,
  covering the v0 `/admin/*` aliases too (LLP 0032 S0;
  [LLP 0031](./0031-server-route-taxonomy.spec.md) owns the full route
  taxonomy);
- generated Contract bindings and the `snapback-contract` adapter consumed by
  the shipped demos ([LLP 0012](./0012-headless-integration-contract.spec.md),
  [LLP 0021](./0021-contract-exact-integration-hardening.plan.md)).

V1 must not claim (unchanged from V0 unless noted):

- offline mutation replay; Postgres graduation; Cloudflare support;
- hosted or untrusted code execution, or enforced CPU/wall-clock limits (the
  capability report self-declares them Missing);
- real external auth providers; assets; notifications;
- snapshot reads, read-your-writes `ctx.db`, or predicate-granularity
  read-set validation — ratified targets, not current behavior, until
  LLP 0032 Phase 2 lands (see LLP 0003 §Execution and Write Semantics status
  callout);
- client reconnect/resume or multiplexed live consumers (LLP 0032 P4);
- a packaged CLI or host-ops surface
  ([LLP 0024](./0024-agent-operating-surface.spec.md) is pinned, not built —
  LLP 0032 P6);
- rich text or high-frequency durable whiteboard fan-out; finance-grade
  exact-money behavior.

Those may appear as capability gaps and explicit TODOs. They should not appear
as hidden fallbacks, partial behavior under production names, or untested
optimistic claims.

## First Acceptance App

The first acceptance app is intentionally small: a todo app on the canonical
local target. It must prove:

- schema load;
- generated function references;
- one query;
- one mutation;
- `ctx.db` read/write behavior;
- system fields;
- one live subscription;
- one realtime update from another client or simulated client;
- one ordinary callable query that is correctly reported as not eligible for
  retained local-first sync;
- one concurrent mutation conflict where read-set validation prevents stale
  invariant commit;
- deterministic reset;
- machine-readable diagnostics for one invalid schema and one invalid query.

This app is the floor. If the todo path is not trivial for an agent to create,
run, and repair, Snapback's larger claims are not credible.

## First Contract/Exact Fixture

Once the headless artifacts from LLP 0012 exist, the first Contract/Exact
acceptance fixture should be the same todo app expressed through the current
Exact default path: a `.contract` surface with a `contract` block, stable
`testId` handles, and an agent/Design Mode edit that changes durable Snapback
source rather than hidden runtime state. The fixture should prove:

- Contract/Exact can inspect the generated Snapback schema, functions,
  diagnostics, capabilities, and runtime state;
- a Design Mode or agent edit can add one field or query, run codegen, and see
  honest diagnostics;
- a Contract/Exact surface and a React surface consume the same generated
  Snapback app with no private backend semantics;
- the Exact agent API or equivalent structured tree can validate the UI against
  the same backend facts the local doctor reports.

This does not require Snapback to define Contract/Exact. It uses the current
Exact facts as an external consumer: Contract is the native-first default
authoring model, React remains supported and production web stays React, and
Design Mode targets Contract first.

## Test Surfaces and Harness

Two complementary surfaces, both validated by Valet:

- A **deterministic, message-level sync harness** with explicit
  `flush`/`deliver`/`sync` controls and fault injection (`disconnect`,
  `dropNextMessage`, `reorderMessages`), asserting properties like convergence,
  causal ordering, no ghost docs, offline durability, and deterministic replay.
  Carry over two cheap disciplines: **ban `setTimeout`/sleep in tests** (if a test
  needs to sleep, the harness is missing a capability) and use **fixed id pools to
  force collisions** that random ids would miss (`[observed - Valet LLP 0007]`).
- **Multi-client browser smoke tests** — the surface that actually caught Valet's
  hardest bugs. A two-client cursor-sync test exposed a server-auth mismatch no
  single-client test could; smoke tests also caught an unsupported `withIndex` and a
  namespace mismatch (`[confirmed - Valet diaries, 2026-06-25]`). For agents, a
  structured host-ops/inspection tree is "a better test surface than a DOM." Note
  the gotcha: a UI that re-creates nodes per render fights Playwright actionability,
  needing `force`/direct dispatch.

**Make the protocol-vs-handler-replay boundary explicit.** Valet's harness applied
mutations as snapshots, **not** by re-executing handler functions — so handler-based
replay, the hardest correctness surface (the thing that makes `position = count + 1`
produce 5 not 4 on rebase), was never tested by the harness and slipped to slower
e2e suites (`[observed - Valet LLP 0007/0048]`). Snapback should make handler replay
first-class in the harness from the start, and state which suite proves which
contract so an agent is not misled about coverage.

## Acceptance Ladder

After the todo app, add reference-app slices in this order:

1. **Messaging slice:** partial local retention, reconnect, and live delivery.
2. **Kanban slice:** optimistic multi-row mutation and realtime reorder.
3. **Collaborative graffiti/whiteboard slice:** durable committed marks plus
   ephemeral cursors or active-stroke presence, proving the LLP 0013 carrier,
   fan-out measurements, and durable-lane separation under cursor pressure
   (shipped 2026-07-03 — `demos/graffiti/`, ENG-22219, Diary 0006).
4. **Card-game slice:** authorization-aware sync where different clients see
   different rows from the same underlying game state.
5. **Task-tracker slice:** index-first query and cursor pagination over a larger
   local dataset.
6. **Party slice:** RSVP live update and notification stub once notifications
   exist.
7. **Asset slice:** upload metadata and processed-media state once assets exist.

The full reference-app list in LLP 0000 remains the north star. This ladder is
the build order for minimal acceptance slices, not a claim that these apps are
feature complete.

A collaborative rich-text pad should be added as a stretch acceptance slice once
the sync/realtime model is stable enough to evaluate editor-specific
collaboration. Passing that slice means Snapback supports at least one explicit
rich-text strategy with cursor/selection presence, offline replay, and convergent
multi-client edits across more than one client platform. It is not a v1 blocker
and should not be interpreted as a requirement to support every CRDT, OT, or
editor storage model.

## Reference-App Coverage

Every LLP 0000 reference app should eventually map to an acceptance profile before
Snapback uses it as evidence for product or scale claims. The first ladder above
covers todo, messaging, kanban, collaborative graffiti/whiteboard, card game,
task tracker, party, and assets. The remaining examples need explicit profiles:

- e-commerce: inventory/order atomicity, payment-integration boundary, product
  media assets;
- collaborative rich-text pad: one chosen CRDT/OT/block strategy, not generic
  row-sync hand-waving;
- Notion-like workspace: desktop-scale local store, mixed structured/freeform
  data, large result pagination;
- team chat/community hub: channel fan-out, presence, retained history, and
  notification stubs;
- social/video app: asset processing, feed read fan-out, and the CDN-scale
  non-goal line;
- blog: read-heavy web consumption and image assets;
- finance app: exact decimals, sensitive-data auth, external market-data
  boundary, and money-grade write invariants;
- fantasy sports picker: cron-driven locks/scoring, realtime leaderboards, and
  v2 data-gateway dependency.

Each profile should state data volume, local-store size, mutation rate,
subscription count, fan-out pattern, target capabilities, and acceptable
degradation. Without those numbers, the app is a demo shape, not a scale claim.

## Capability Reports

Every target should report capabilities rather than pretending all Snapback
features are present everywhere. Capability reports should include at least:

- storage engine;
- runtime engine;
- live subscriptions;
- syncable-live query subset;
- online-only or replace-only query modes;
- offline retention;
- optimistic replay;
- mutation read-set validation and whether conflict retry is automatic;
- auth impersonation;
- permission diagnostics;
- asset upload;
- outbound fetch/actions;
- cron;
- notifications;
- local reset;
- supported query forms;
- portability opt-outs.

Adapters and tests must fail or degrade explicitly when a capability is missing.

A passive capability gap is an inspectable target fact, not a diagnostic
occurrence by itself. Runtime diagnostics record events that need attention:
when an operation actually requests an unavailable capability, that operation
must refuse with one stable, actionable diagnostic. Merely constructing a
healthy target or reloading a generation must not turn the same missing optional
capability into repeated notices. Retired diagnostic codes remain reserved in
the compatibility vocabulary so older clients can continue to parse retained
or historical records.

Encode known **local-vs-server parity** divergences as capability flags or
diagnostics rather than leaving them as tribal knowledge — the agent contract above
already asks "whether local optimistic execution and server execution disagree."
Valet's recurring parity footguns make the list concrete (`[observed - Valet LLP
0024/0005]`, `[confirmed - Valet diaries, 2026-06-25]`): `Date.now()` is patched for
replay but `new Date()` is not; query builders are mutable so a reused builder /
double `.collect()` accumulates filters; a filter on a misspelled field silently
matches no rows; table-name-from-id parsing diverged between client and server on
malformed ids; an indexed `withIndex` query worked server-side but threw in the
browser-local handler. Each is a "works by accident" trap an agent should be able to
see in a capability/diagnostic report.

## Local-Server State Inspection

The local server from LLP 0003 should expose:

- schema hash and loaded time;
- function bundle hash and loaded time;
- app database path or target id;
- current database version;
- recent changeset ids;
- active subscriptions and their query references;
- connected clients;
- recent dispatch errors;
- runtime engine and isolation mode;
- resource-limit settings.

This is not a production observability replacement. It is the minimum local
feedback loop for agents.

## CI and Review Gates

Before a subsystem LLP moves beyond `Draft`, it should name the acceptance tests
that prove its contract. Before implementation PRs merge, CI should run:

- `./ref-check --verbose` for the LLP corpus;
- unit tests for generated manifests and diagnostics;
- local acceptance tests for the affected subsystem;
- the todo acceptance app once the local core exists.

The canonical proof is an inventory, not a sample. Package-owned test commands
must name every maintained package test, the Cloudflare local corpus must have
an explicit non-vacuous suite manifest, and required web surfaces must declare
their build target in the demo manifest independently of filesystem artifacts.
CI requires the Contract/Exact and admin behavior lanes; missing dependencies
are failures there, never automatic skips.

The canonical runner additionally gives every command a stable gate id and an
explicit prerequisite set. Its terminal vocabulary is `PASS | FAIL | BLOCKED |
NOT_SELECTED`: keep-going continues independent gates after a root `FAIL`, but
does not execute a transitive dependent; a selected `BLOCKED` result still
makes the proof red. The runner writes one JSONL result per gate with command,
prerequisites, timestamps, duration, exit status, and causal blockers, and CI
retains that artifact even on failure. The dependency inventory rejects an
unknown prerequisite, duplicate stable id, or a newly added direct
`startServer` gate that omits current-binary readiness.

Per-change execution is now selected by the checked
`scripts/local-proof-selection-policy.v1.json` authority. Every canonical gate
is classified; selected dependents close transitively over their producers;
the Contract/Exact and admin behavior lanes remain mandatory for every
affected code selection; and shared authority, selector machinery, or an
unknown path selects the complete inventory. Explicit LLP/issue/diary docs and
guide-only changes retain a fast static lane. CI binds the base/head diff,
policy digest, exact gate inventory, chosen/not-chosen gates, and tool
requirements in `local-proof-selection.json`, reopens that receipt before
execution, and uploads it beside the JSONL results. Pull requests and `main`
pushes use this affected selection. A six-hour/manual, non-cancelling
latest-main run retains the complete inventory and coalesces pending heads.
When Exact/admin behavior is required, the clean runner enters the selected
frozen surface-install gates before consulting ignored local `node_modules`;
preexisting surface dependencies are only an optional-local optimization.
Affected evidence is per-change attribution only. Release and capability
promotion require green scoped evidence for exactly what they claim plus the
most recent eligible complete battery green on the claim-relevant gates,
with unrelated reds ticketed and named rather than blocking (LLP 0189 D-6,
2026-08-07, re-scoping the former "declared complete/release authority"
clause); per-claim exact-commit strictness exists only by explicit author
ruling (LLP 0189 D-7). This sits on the landed D1/D2 boundary of
[LLP 0175](./0175-local-proof-economics.rfc.md).

CI also computes the Cargo target headroom verdict before cleaning the test
profile. A measured `preserve` keeps reusable test/dependency artifacts for the
final binary and filtered historical witnesses; `clean` or an unmeasurable
verdict performs the fail-safe profile clean and logs that choice. Cleanup no
longer manufactures its own apparent headroom before the decision.

Proof inputs are repository facts: an exact root Bun authority and single Bun
lock, an exact Rust toolchain coordinated with vendored Ibex, lock-installed
exact TypeScript, and immutable full-SHA GitHub Actions. Checkout credentials
must be removed before repository code executes and workflow permissions stay
explicitly read-only. Resource guards query Cargo's effective target directory
rather than assuming it shares the repository filesystem. `[confirmed —
Charlie Cheever / Codex, 2026-07-12, ENG-24497/ENG-24502–ENG-24508]`

The Node runtime that executes package tests and proof scripts is the same
kind of fact: `.node-version` pins one exact release, every Node-using
workflow consumes it through `node-version-file`, and the toolchain authority
check asserts the active runtime matches it before the canonical build.
Upgrades change `.node-version` in one commit and re-run the canonical proof;
workflows never name a Node version themselves. Package `engines` ranges
remain compatibility declarations the authority must satisfy, never the CI
authority. `[confirmed — Charlie Cheever / Claude, 2026-07-14, ENG-24513]`

When a behavior is not yet implemented, the capability report should say so and
the tests should assert the reported gap rather than silently skipping it.

**Cloudflare inventory as built (ENG-24498, 2026-07-12).**
`cloudflare/test/local-suite-manifest.mjs` is the canonical non-remote
inventory. Its runner asserts the exact suite ids and 18-check total, verifies
per-suite completion evidence, and classifies every other test file as remote,
helper, benchmark, or child protocol. A new file is therefore a failing
inventory change until its gate or explicit non-gate role is declared; deleting
or renaming a gate cannot reduce the proof silently.

The portability and cross-engine story should be backed by a **machine-readable
conformance corpus** expressed as product artifacts (`schema`, `functions`, portable
seed) rather than implementation-internal tests. Adopt the contract Valet designed
(`[observed - Valet LLP 0035]`): every case declares `required_capabilities`; a
runner reports `skipped:capability_missing` or `skipped:corpus_version_too_new`
(soft skip, not silent); a fixed placeholder table (`$NOW`, `$TOKEN`, `$ID:<name>`)
makes cases deterministic; results are a stable, diffable schema; and engine drift
is a release blocker, not a footnote. Sequence the corpus so the **replay and wire
runners come first** — Valet built four of nine case kinds and the ones it skipped
were `wire` and `mutation_replay`, exactly the runners that prove a local-first
product is not a thin online wrapper, plus the cross-engine matrix CI that would
have made "portable" more than an assertion (`[observed - Valet LLP 0035/0083/0048]`).
The hardest, most valuable acceptance pieces are the ones most likely to be deferred
under pressure; gate honestly when they are not yet built.

## Dated note: provisioning acceptance gate (2026-07-23)

[LLP 0089](./0089-agent-provisioning-surface.rfc.md) (Draft, authored under
LLP 0086 §CC-1) proposes the agent **provisioning** surface — create-app,
push-schema/permissions/code, version selection and rollback — and defines
its acceptance gate under this Spec's bar: an agent holding only credentials
and the surface endpoint provisions a working app on the local/trusted-local
target (schema, permissions, and code loaded; one generated function
invocation succeeding), with structured envelopes and diagnostics
throughout, plus fetch-checked `.md` docs URLs and a skills-package
scenario. That gate is specified in LLP 0089; this Spec's contract and
ladder are unchanged by it.

## Dated acceptance profile: inline handlers and results (2026-07-27)

The codegen review surface records handler form, source-linked admission
diagnostics in local custody, implementation/argument/result hashes, effective
result-contract kind, and degraded-unknown counts. The public/provider surface
never contains executable source or private paths. Failed inline extraction or
result-contract generation leaves the preceding complete artifact set intact.

Acceptance exercises all four inline operation kinds plus the legacy module
lane; rejects mixed, indirect, free-capturing, class, dynamic-import, and
eval-like handlers; proves byte-identical regeneration and identity changes;
checks exact generated headless and React inference; and covers valid/invalid
document, record-array, document, and direct-value egress. Mutation evidence
must prove invalid output rolls back its writes and settlement, while
query/live/action evidence proves invalid output is not published. The
maintained backend bakeoff is the repository fixture for deleting the separate
handler registry without restoring casts at its client boundary.

## Dated note: runtime readiness gap (2026-07-30)

The Diary 0039 rerun exposed the boundary of this Spec's bootstrap contract:
`SNAPBACK_IBEX_RUNTIME_LINK_OK` proves compile, final link, launch with
`DYLD_*` scrubbed, and dyld load of `hermesvm.framework` — but the smoke
never executes JavaScript, and the handler VM is created only at first
invocation (`RuntimeGuard::create` → `ex_hermes_create_no_eval()`), whose
promise-rejection-checkpoint prerequisite is an ABI/behavior contract dyld
symbol resolution does not test. In the incident, doctor and bootstrap were
both green while every JS invocation failed with
`SNAPBACK_RUNTIME_CREATE_FAILED`
(`issues/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md` has
the mechanism trace, including the `rsync -a` mtime-preservation candidate
root cause for the missed relink).

Three standing facts this note records for the coming amendment (LLP 0115
CV-2/CV-3):

- **Doctor's fresh-disposable-target design is structurally blind to a stale
  served binary** — its from-scratch build is coherent with the current
  framework precisely when `target/debug/snapback` is not. This Spec
  documents that behavior as deliberate; the incident prices it.
- **The three tools already share** one probe module
  (`scripts/runtime-link-smoke.mjs`), this Spec's diagnostic registry, and
  the `snapback.runtime-recovery.v1` record — but nothing is persisted, the
  captured framework/binary digests are never compared, the harness probe
  runs only on its `cargo` rung, and `scripts/verify-local-proof` disables
  the smoke by default (`SNAPBACK_BOOTSTRAP_CHECK=0`).
- **Receipt prior art exists in-tree**: the recovery record's
  `producerInputs` digests, and
  `packages/snapback-runtime-linux-x64/artifact-attestation.mjs`
  (`snapback.runtime-artifact-attestation.v1`), a complete binary+Hermes
  digest attestation with validate-against-actual-files checking, currently
  Linux-packaging-only. `bench_runtime_create_us` already creates and
  destroys handler VMs in-process.

The contract change itself (VM creation and one trivial execution after
final framework selection, digest-bound readiness receipt, new bootstrap
diagnostic code, invalidation on framework refresh) lands with the CV-2
amendment, not this note.

**CV-2 landing (2026-07-30).** The bootstrap contract now includes the
qualification: `snapback runtime-qualify` creates and destroys the
restricted no-eval handler VM twice (creation is the incident's exact
failure point; the no-eval constructor admits no trivial execution beyond
it) and prints a `snapback.runtime-qualify.v1` verdict.
`scripts/runtime-link-smoke.mjs` runs it against the binary it just linked
with loader overrides scrubbed, so `SNAPBACK_IBEX_RUNTIME_LINK_OK` now
implies armed handler-VM readiness and the reproduced incident state fails
with `SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED` (acceptance:
`tests/runtime_link_smoke_v0.mjs`). The qualification verdict rides the
`snapback.runtime-recovery.v1` record beside the framework digests and
binary identity. The missed-relink root cause is closed at the source:
bootstrap's artifact copy no longer preserves source mtimes for changed
files (`rsync --out-format` + touch), so a framework refresh always
invalidates the `rerun-if-changed` fingerprint and relinks before the
qualification runs. `scripts/verify-local-proof` qualifies its freshly
built binary directly, closing its `SNAPBACK_BOOTSTRAP_CHECK=0` blind spot.
Still open, deliberately: a persisted digest-bound readiness receipt
(digests are captured and compared-by-record, not stored), and the demo
harness's `configured`/`prebuilt`/`reused` rungs remain presence +
`/health`-identity gates
(issues/closed/20260730-kit-rungs-skip-handler-vm-qualification.md).

**CV-3 landing (2026-07-31).** Both residues above are closed. The
qualification is now persisted: `packages/snapback-cli/runtime-readiness.mjs`
issues a `snapback.runtime-readiness.v1` receipt at
`<binary>.runtime-readiness.json` — custody by colocation, so the receipt
shares the binary's lifecycle — binding the binary's sha256, the current
Hermes artifact digests (the same candidate set as
`producerInputs.nativeArtifacts`, root-relative), the binary build identity,
and the `snapback.runtime-qualify.v1` verdict. Trust never derives from
presence: every consumption recomputes both digest sides, so a rebuild after
qualification (`binary-drift`) or a framework refresh after issuance
(`framework-drift`) invalidates the receipt with no bookkeeping, and a
receipt is never issued for a failed qualification. Issuers: the
runtime-link probe for every kept target (bootstrap's smoke and the demo
harness's `cargo` rung), and `scripts/verify-local-proof` directly (before
its doctor step and after its final `cargo build`). Consumers, one shared
code (`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID`, registry above):
`scripts/ibex-doctor` verifies the SERVED binary
(`SNAPBACK_SERVER_BINARY`, else `target/debug/snapback`) read-only —
closing its documented structural blindness to a stale served binary — and
names both recoveries; the demo harness's `configured`/`prebuilt` rungs
verify before spawning and self-heal an invalid receipt by re-qualifying
the exact resolved binary (a binary that cannot qualify fails with
`SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED`; prebuilt falls back to the
`cargo` rung, configured is a hard coded error); the `reused` rung — which
cannot re-qualify a running process — binds the live `/health` identity to
a locally receipted, digest-coherent runtime or refuses reuse. Acceptance:
`tests/runtime_readiness_receipt_v0.mjs`, the receipt/tamper/rung fixtures
in `tests/runtime_link_smoke_v0.mjs` and
`demos/_kit/tests/server-process-lifecycle.mjs`, and the LLP 0123
posture-neutrality regression `crates/snapback/tests/runtime_qualify_posture_v0.rs`
(external qualification leaves serving-process enforcement fail-closed;
the landed subcommand shape is posture-neutral by process isolation —
LLP 0123's 2026-07-31 note has the finding, and the standing
first-VM-only-Enforce fact stays with LLP 0009 via
issues/20260731-first-vm-only-strict-host-context.md).

**CV-3 packaged-consumer custody amendment (2026-08-01).** The installable
CLI now exposes `snapback runtime-qualify --persist` and `--verify`. It keeps
the same schema and live-qualification authority but stores the receipt at
the app-owned `.snapback/runtime-readiness.json` path rather than beside the
read-only packaged binary. The artifact set is the selected package's binary
and Hermes framework/library; verification recomputes both and refuses drift.
An explicit `--receipt` path remains app-owned. Acceptance:
`packages/snapback-cli/package.test.mjs`.

**CV-3 custody-aware repair amendment (2026-08-12).** Read-only package-seal
verification and source-checkout receipt verification retain the shared
diagnostic code and reason taxonomy, but recovery is now selected by explicit
custody. Installed package bytes are immutable consumer artifacts: repair is
exact runtime-package reinstall, and the diagnostic does not pretend a source
bootstrap or sibling receipt can rewrite the package-owned seal. Contributor
repair is `scripts/assemble-runtime-package`, whose clean-tree four-stage path
rebuilds the runtime and source-matched admin snapshot before non-destructive
package assembly. Trust remains digest recomputation, never file presence.

## Open Questions

- What package boundaries should carry the pinned CLI/MCP implementation?
- LLP 0024 answers the surface-shape question for v0: CLI, HTTP, and MCP are
  all projections of one internal host-ops core.
- Which diagnostic codes are stable enough for v1?
- How much generated output should be committed versus built on demand?
- Which pieces of the first Contract/Exact fixture depend on a stable external
  Contract/Exact definition versus the current Exact default-path facts?

## Status

Draft. The Valet DX record ([LLP 0006](./0006-valet-retrospective.research.md)) is
folded in — the no-silent-drops rule, the harness and conformance-corpus contracts,
the orchestrator surface, and the parity-divergence flags all come from what Valet
shipped or missed. This Spec should be revised alongside the first local server and
treated as a required part of implementation, not downstream polish.
