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
**Status:** Review
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

**Revised (first-publication default-tag reconciliation):** 2026-07-29 (the
`0.1.1` candidate run established that npm can assign `latest` to a brand-new
public package name even when `npm publish --tag <candidate>` is explicit.
Promotion now represents an exact prior member already equal to its candidate
version as a verified no-op: only that member's aliases bind the new vector,
ordinary prior members remain prior-vector-bound, the ordered event remains
in the post ledger, and rollback never pretends the pre-existing default tag
was changed by this operation. A preflight failure after authority acquisition
also re-observes the full vector and closes the epoch as rolled back when it
still equals the signed prior vector.)

**Revised (nine-package candidate promotion):** 2026-07-28 (the next public
closure uses immutable exact-version candidate publication, exact-registry
cold proof, dependency-safe default-tag promotion with the CLI root last, and
byte/provenance links from clean source through target and supervisor images.
The round-2 reconciliation adds a refusing preflight over the current default
closure, prior-tag inventory, ledger lineage, and verified-versus-attested
provenance edges. The amendment defines gates only; it does not claim
publication.)

**Revised (cross-host runtime attestation):** 2026-07-29 (qualification keeps
one source-bound assembly job without asking macOS to execute the transported
Linux binary: the native Linux builder retains a closed identity/digest
sidecar, and the assembler re-hashes the x86-64 runtime and Hermes bytes,
revalidates the exact source/public-package identity, and independently checks
their ELF machine before staging. The first real qualification attempt found
and fixed both a buffered 67 MB tar-entry hash and the foreign-execution
assumption; this revision does not claim a successful publication.)

**Revised (unreviewed post-round correction):** 2026-07-28 (default-tag
promotion now requires an externally authorized publication lease and epoch,
expected-value checks around every registry mutation, and reverse-order
full-vector rollback that never overwrites drift.)

**Revised (publication authority implementation):** 2026-07-28 (the
package-owned standing authority now allocates Ed25519-signed, at-most
15-minute nine-package leases from a durable monotone SQLite head; exact
issue/acquire/close replay, stale-head refusal, Bearer-authenticated closed
HTTP endpoints, a candidate-ledger request client, and package-owned closed
schemas/tests implement the previously external-only gate. No deployment or
npm mutation is claimed by this revision.)

**Revised (publication authority corrective hardening):** 2026-07-28 (the v2
protocol binds every lease to one authority installation, canonical origin,
and pinned Ed25519 key id; heads and transition receipts gain independent
domain-separated signatures. Promotion uses one lease-bound base origin and
requires a signed, current `acquired`/null-outcome head around every mutation
and rollback. A closed lease can no longer replay acquisition. Durable reopen
semantically verifies the complete retained history; secret-file-only
production inputs, owner-only SQLite permissions, and bounded HTTP handling
close the operational findings. This correction still claims no deployment or
npm mutation.)

**Revised (bounded final `latest` proof collection):** 2026-07-28 (the
existing public-package workflow now accepts an exact-vs-`latest` root
selector and an operation correlation id. Promotion-time collection dispatches
one correlated matrix run, waits within the lease budget, and downloads the
two run-id-bound GitHub-hosted receipts; the promoter still validates their
complete candidate closure. Exact-root aggregation remains the ordinary
post-publication mode. This is an instrument only; no registry mutation is
claimed by this revision.)

**Revised (final publication-proof hardening):** 2026-07-28 (the latest-root
plan is now closed data consumed only by the digest-pinned package-owned GitHub
helper; arbitrary commands and argv are no longer accepted. The retained
collection and both platform evidence rows bind repository, workflow,
workflow ref/head, run id/attempt, operation id, dispatch freshness, and
artifact ids plus API/download/receipt digests, and the helper reopens the run
and artifacts through GitHub before close. Qualified receipt producers now
measure their actual checkout HEAD/dirty state and validators require clean
GitHub-hosted provenance. Publication dependency closure covers dependencies,
optional, peer, and development dependencies and rejects direct public
Snapback keys. Rollback reconciles apply-then-lost-response outcomes from a
complete registry read, authority clients abort bounded response streams, and
every head read uses a fresh signature-bound challenge. Immediately after
final proof, the promoter reopens the complete registry vector and fresh
acquired head before constructing the post ledger and close. These are
corrective implementation details of this amendment, not a new release
claim.)

**Revised (retained comparator evidence hardening):** 2026-07-28 (the staged,
exact-public, and final-`latest` consumers now read receipt files through a
32 MiB regular-file envelope and reject excessive JSON depth, nodes,
properties, arrays, individual strings, or aggregate string bytes before
canonicalization. The nested comparator receipt has a narrower 2 MiB,
depth-16, 20,000-node/property envelope. Its outer validator binds the exact
package fixture profile/title, exact mandatory check names and semantic
witness shapes, governed nonclaim vector, release binary, and non-vacuous
executor-package shape. The executor package-file digests remain rooted in the
installed CLI's same-process comparison against its executing package graph;
the outer validator does not pretend that a self-digest independently
reconstructs installed package bytes. GitHub-hosted provenance and the retained
full-receipt digest carry that already-verified result into later release
gates. This correction claims no publication.)

**Revised (bounded browser-evidence closure):** 2026-07-28 (the packed React
browser qualification now binds the measured checkout HEAD/dirty state, the
complete selected Chromium headless-shell distribution, and the Playwright
support tree with domain-separated streaming filesystem digests. It scans all
console types and deeply serialized arguments, complete request/response and
WebSocket-handshake metadata, binary bodies/frames, worker and service-worker
readable own properties and accessors (including custom classes and functions),
Cache Storage, and IndexedDB. Forbidden markers are fixed before collection;
the proof-owned scanner hashes and searches bounded chunks without retaining
captured surfaces. Request and resource buffering use configured DevTools
protocol caps, and an omitted body or inconsistent length proof is a refusal.
Count, byte, depth, file, task, and concurrency ceilings fail closed during
proof-owned collection; retained surface rows carry content commitments but no
captured secret, origin, or filesystem value.

The byte ceilings do **not** claim to bound Chromium's internal buffers or a
CDP/Playwright event object that the browser and protocol have already
materialized before the proof handler runs (notably a WebSocket
`payloadData`). There is no per-frame CDP cap available to this instrument.
The handler performs an O(1) encoded-length refusal before copying, decoding,
or UTF-8 encoding such a value, and the receipt records this boundary
explicitly.

Nor can JavaScript apply a pre-allocation limit to a complete collection that
a proof-invoked host API materializes as its return value. The exact receipt
nonclaim covers `BrowserContext.serviceWorkers()`, `Cache.keys()`,
`CacheStorage.keys()`, `ConsoleMessage.args()`, `IDBFactory.databases()`,
`Page.workers()`, `Performance.getEntriesByType("resource")`,
`Reflect.ownKeys(browser value)`, and `Reflect.ownKeys(globalThis)`. Count,
property, byte, and depth limits apply immediately after those calls return;
an over-limit result refuses the proof, but its host-result allocation has
already happened. Proof-owned copies and encodings *after that host-return
boundary* remain bounded before allocation and are built incrementally where
necessary. Thus the claim is bounded post-host-return proof transformations
plus fail-closed completeness, not bounded host-result, browser-process, or
protocol-transport memory. This is an evidence-instrument correction and
makes no new package-publication claim.)

**Revised (public clean-machine proof complete):** 2026-07-26 (GitHub Actions
run `30216614778` installed the byte-bound public `0.1.0` closure on new
GitHub-hosted macOS/arm64 and Linux/x64 machines. Both platform receipts prove
public alias resolution, all eight registry tarball digests, the packaged
native doctor, offline local/remote codegen, CLI introspection, scaffold
acceptance, fail-closed deploy build, managed dev/watch/attach/stop, and browser
bundling without a sibling checkout. Their fail-closed aggregate has
`claimSatisfied: true` and no nonclaims at
`demos/partiful-matrix/acceptance/results/step5-packaged-loop.json`;
`STEP5.PACKAGED_LOOP` is therefore promoted. The proposal Status remains
Draft pending its normal document-acceptance decision; the executable
acceptance surface itself is implemented.)

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

### Nine-package candidate promotion — 2026-07-28

This amendment is normative for the `0.1.1` backend-bakeoff closure and later
releases unless superseded. The complete public source-to-alias inventory is:

| Source package | Public registry identity |
| --- | --- |
| `@snapback/runtime-darwin-arm64` | `@ccheever/snapback-runtime-darwin-arm64` |
| `@snapback/runtime-linux-x64` | `@ccheever/snapback-runtime-linux-x64` |
| `@snapback/contract` | `@ccheever/snapback-contract` |
| `@snapback/client` | `@ccheever/snapback-client` |
| `@snapback/codegen` | `@ccheever/snapback-codegen` |
| `@snapback/vite` | `@ccheever/snapback-vite` |
| `@snapback/react` | `@ccheever/snapback-react` |
| `@snapback/app-cli` | `@ccheever/snapback-app-cli` |
| `@snapback/cli` | `@ccheever/snapback-cli` |

`@snapback/hosted-supervisor` is not a tenth public package in this closure.
Its image is built from the same clean source revision and is independently
byte-bound in the hosted receipt. The public CLI tarball carries the Fly
driver, hosted schemas, and hosted release packer required to talk to that
standing service.

Publication is a closed state machine:

1. one clean source SHA produces all nine `0.1.1` tarballs; internal Snapback
   dependencies are rewritten to exact `npm:` aliases at `0.1.1`, never tags
   or ranges;
2. both platforms pass repository-free tarball cold installs before any
   registry mutation;
3. the nine immutable exact versions publish in dependency order under the
   non-default dist-tag `bakeoff-0-1-1-<source-sha12>`. A partial publish
   cannot change an existing package's `latest` resolution. If npm establishes
   `latest` while creating a brand-new package name, the observed exact
   candidate version becomes an explicit already-promoted member of the prior
   vector rather than an unrecorded side effect;
4. the publication ledger re-downloads every exact registry version, proves
   its tarball digest equals the locally qualified tarball, and records source
   name, public name, version, integrity, dependencies, source SHA, and
   publication order;
5. fresh macOS/arm64 and Linux/x64 machines install exact public aliases at
   `0.1.1` using only that successful candidate ledger. These are the
   pre-promotion public-registry cold receipts; they do not resolve `latest`;
6. default-tag promotion moves dependency/runtime packages first and
   `@ccheever/snapback-cli` last. The verifier reopens the entire exact closure
   after every move. Because the old CLI root pins its old exact closure, any
   failure before the final root move leaves the previous default developer
   loop intact. Candidate versions remain immutable and quarantined rather
   than being unpublished; and
7. after the CLI root moves, both platforms perform one final fresh
   `latest`-root install and prove that it resolves exactly the candidate
   ledger. Failure blocks served capability publication and moves the CLI root
   back to its recorded prior tag when npm permits; if the root move cannot be
   reversed, the release receipt is failed loudly and no target capability
   carrier may reference it.

Cross-host assembly never executes a foreign native binary. The native Linux
builder launches `build-identity` itself and retains one closed
`snapback.runtime-artifact-attestation.v1` sidecar binding that exact clean
source revision and public-package identity to SHA-256 digests of the x86-64
ELF runtime and Hermes library. The macOS assembler re-hashes both transported
artifacts, validates the closed sidecar and source revision, and only then
stages the Linux package. ELF header checks remain independent. A sidecar
without byte equality, exact source identity, or the public-package build
distribution refuses qualification.

#### Retained comparator evidence hardening

Every staged and public platform cold receipt retains the complete governed
`snapback.comparator-receipt.v1` object plus its canonical JCS SHA-256. The
outer validator binds the comparator's source commit and release binary digest
to the selected runtime package, requires the exact package-owned fixture
profile/title, exact five mandatory check names with consistent timings,
semantic live/atomic/rollback/presence/ephemeral witnesses, successful cleanup,
and the exact governed nonclaim vector. Receipt files are read as bounded
regular files; platform receipts have a 32 MiB envelope with finite structural
limits, and the nested comparator has a 2 MiB canonical/byte envelope plus
depth-16 and 20,000-node/property limits. Those limits are enforced before
recursive JCS canonicalization in every staged, exact-public, and final
`latest` consumer.

The installed CLI is the authority for `executorPackages`: it recomputes the
complete executing CLI and client package-file graph in the comparator process
and refuses a receipt that differs. The outer release validator binds the
resulting full receipt and requires exact package names/version/algorithm,
closed normalized file lists with package-owned sentinel files, and
non-vacuous distinct digest shapes. It does not describe the retained
self-digest as an independent reconstruction of installed bytes. The trusted
edge is instead `GitHub-hosted cold-proof process → installed CLI
same-process verification → retained full receipt digest`. A
`packagedComparatorProfile: true` boolean is only a summary; it is never
sufficient evidence by itself. The public aggregate retains a small projection
and the platform-receipt digest, while the full platform receipts remain the
audit source.

The two final receipts come from one correlated
`.github/workflows/public-package-proof.yml` GitHub-hosted matrix execution.
`scripts/snapback-github-latest-proof.mjs` dispatches that execution only after
the tag vector reaches the intended value, waits for a successful terminal run
within the publication-lease budget, downloads the exact run-id-named
`darwin-arm64` and `linux-x64` artifacts, and refuses local, stale, exact-root,
or differently correlated receipts. The publication proof plan is a closed
data object. It names the fixed repository/workflow/ref, expected workflow
HEAD, committed candidate-ledger path, release operation id, output paths, two
bounded time budgets, and the SHA-256 of the package-owned helper; it cannot
name an executable or arbitrary argv. The promoter invokes that helper first
to dispatch/materialize both receipts and then to reopen the retained
collection. The helper and promoter require one exact GitHub repository,
workflow path/ref/head, run id/attempt, operation id, fresh dispatch window,
and two distinct artifact ids whose API, downloaded archive, and extracted
receipt digests agree. The promoter then performs the full candidate-ledger
validation over both files before external-authority close.

The release receipt is not a bag of hashes. It proves a directed provenance
chain:

`clean source SHA → staged package file digests → registry tarball digests →
runtime binary digests → target/supervisor build contexts → OCI image
digests`.

The hosted packer records every edge and the verifier reopens it. Target and
supervisor images must name the same source SHA; declared skew is not permitted
for this release. LLP 0111's capability-publication carrier may reference only
the successful post-promotion ledger and both final `latest` cold receipts.

Before the first default-tag mutation, a refusing
`PriorDefaultClosurePreflightV1` downloads the current `latest` root and every
transitively selected Snapback tarball. It parses the retained registry bytes
and proves every internal dependency and optional dependency is an exact
`npm:` alias pin with an exact version—never a range or tag. It records every
package's prior tag state and identifies first-publish packages such as React,
for which rollback means removing the newly created default tag rather than
restoring a prior one. A missing tarball, range, alias mismatch, or unknown
prior tag fails the release receipt before any tag changes. All four package
dependency maps (`dependencies`, `optionalDependencies`, `peerDependencies`,
and `devDependencies`) participate in this closure. Internal edges use the
normative `@snapback/*` source key with an exact
`npm:@ccheever/snapback-*` alias at the selected vector version. A direct
`@ccheever/snapback-*` key, range, tag, non-normative alias key, or unknown
internal package refuses even when npm would otherwise resolve it.

When npm has already assigned the candidate version to a first-ever package's
default tag, preflight validates that package's exact aliases against the
authorized **new** vector while every other prior package remains bound to the
authorized prior vector. Promotion re-reads the full registry vector and
signed authority head, emits the package's ordered promotion event with
`alreadyAtNewVersion: true`, performs no npm mutation for that row, and does
not add it to the rollback changed set. Its immutable exact dependencies
remain resolvable even if a later failure restores the other default tags.

The post-promotion ledger is a canonical extension of the candidate ledger:
it retains the candidate-ledger digest as `previousLedgerSha256`, adds the
ordered prior/new tag observations and both final `latest` cold receipts, and
has its own content digest. Qualification names the candidate ledger; the
capability carrier names the post-promotion extension, so lineage is
mechanically reopened rather than inferred.

Registry tarball → staged file → runtime/build-context → OCI layer edges are
byte-reverified. Clean-source → compiled binary is a clean-run attestation
bound to the source SHA, builder image, toolchain digests, command transcript,
and resulting binary digest; it is not described as independently
reproducible unless a separate reproducible-build row passes.

### Unreviewed post-round correction: publication lease and rollback

Default-tag mutation requires an `AuthorizedPublicationLeaseV2` stored outside
npm in the standing release authority. The signed lease binds the publisher
instance, authority installation id, canonical HTTPS origin, pinned Ed25519 key
id, monotonically increasing `publicationEpoch`, candidate-ledger digest,
complete nine-package vector, candidate tag, default tag, exact expected prior
value or absence and intended new value for every package, issue/expiry times,
and single release operation id. The publisher must acquire this lease by an
expected-value transition from the release authority's prior head. An expired,
superseded, closed, differently bound, or unreachable lease refuses every
further npm mutation; a local lock or possession of npm credentials is not
publication authority.

Immediately before **and** immediately after each `npm dist-tag` add or remove,
the publisher reads the complete nine-package default-tag vector from the
official registry and the current external lease head. The pre-mutation vector
must equal the last journaled expected vector exactly, including absence for a
first-publish package, and the lease epoch and operation id must still equal
the authorized values. The head is independently domain-separated
Ed25519-signed and must bind the lease's installation, origin, key id,
publisher, expiry, epoch, operation, and lease digest while reporting exactly
`status: acquired` and `outcome: null`. The post-mutation vector must differ in
exactly the single intended package and must equal the newly journaled expected
vector.
Registry ambiguity, cache disagreement, lease-head drift, or any unrelated tag
change stops promotion before the next mutation. The publisher records both
registry observations, the lease observation, request result, and resulting
vector; it never treats an npm command's exit status alone as proof.
Because npm's mutation endpoint can commit before its metadata reads converge,
the post-write observation is a bounded lease-current loop. It retries only
while the complete vector is still exactly the preceding checkpoint, accepts
only the exact intended next vector, and refuses immediately if any unrelated
member differs. Forward promotion and reverse rollback use the same rule and
retain the number of official-registry observations in their ordered events.

Every head request supplies a fresh 256-bit challenge. The authority includes
that challenge in the v3 head signature while excluding it from the stable
state-head digest; the client requires exact equality. A recorded acquired
head therefore cannot be replayed after authority close even while the lease's
wall-clock interval remains open. Every authority client streams at most
128 KiB and aborts/cancels oversized, malformed, or 15-second-stalled success
and error bodies.

Rollback covers the full vector of successfully changed packages, including a
root move, and visits them in the reverse of their actual mutation order. For
each package it first re-reads the complete registry vector and external lease
head. It restores the recorded prior exact version, or removes a default tag
that was absent before first publication, only when the package still equals
this operation's intended new value and all other entries equal the preceding
rollback checkpoint. A package that contains a newer, absent, or otherwise
unexpected value is never overwritten or removed. Such drift, a lost lease, or
an ambiguous read is retained as a failed rollback step with the observed
full vector and stable failure reason; rollback continues only where the next
reverse step's full-vector expected value is still provable. The release
receipt remains failed and no capability carrier may cite it unless the final
full vector equals the recorded prior vector and the external authority closes
the exact lease epoch as rolled back.

A failure between authority acquisition and entry into the tag-transition
engine—including prior-closure preflight—must still re-read the complete
official vector. If that observation equals the signed prior vector, the
publisher closes the epoch as rolled back even though no tag event exists; an
unreadable or different vector leaves the authority acquired and requires
explicit reconciliation rather than a guessed close.

If a rollback command applies and then loses its response, the publisher reads
the complete registry vector before deciding the step. An exact intended next
vector advances the reverse checkpoint while retaining the command error; an
unreadable or different vector records both the failure and any later bounded
observation, performs no speculative overwrite, and lets earlier steps proceed
only when their complete checkpoint is independently provable.

After both GitHub-hosted latest-root proofs validate, and before constructing
the post-promotion ledger or sending close, the publisher re-reads the complete
nine-package official-registry vector and a fresh challenge-bound signed
`acquired` head. Both observations are retained in the post ledger and must
still equal the intended terminal vector and exact lease.

#### Standing publication authority as built

`@snapback/publication-authority` is the natural owner of this client/service
protocol under LLP 0037's non-Rust-artifact revisit rule. Its one shared
`protocol.mjs` module and closed package-local JSON Schemas define
`AuthorizedPublicationLeaseV2`, the issue request, challenge-bound v3 public
head, authority
transition, and transition receipt. The existing promotion engine imports
that module; it does not carry a second signature or transition definition.
Lease, head, and receipt signatures use distinct preimage domains. Heads and
receipts carry the stable installation id, exact origin, and public-key digest;
the publisher accepts one base authority origin and derives the three fixed
endpoint paths instead of accepting independently replaceable URLs.

The service exposes authenticated `issue`, `head`, `acquire`, and `close`
endpoints. `issue` accepts the expected current `publicationEpoch` and exact
head digest, then allocates the next epoch inside the durable transaction;
the requester never chooses an epoch. The retained state keeps every canonical
issue request, signed lease, acquire request/receipt, and close
request/receipt. An exact issue replay, or an exact close replay while its
record remains the current head, returns retained bytes without advancing the
authority generation. Exact acquisition replay is idempotent only while the
record remains `acquired`; terminal closure makes every later acquisition
attempt refuse. Reusing an operation id with changed bytes,
presenting a stale head/epoch, acquiring against anything except the exact
prior vector, or closing against anything except the exact promoted or
rolled-back vector refuses.

The volume adapter uses SQLite `BEGIN IMMEDIATE`, `synchronous=FULL`, a
generation compare-and-swap, and a digest over canonical state. The service
accepts signing and Bearer authority only from mounted secret files in
production and writes neither into receipts or logs. It validates the Ed25519
key and a sign/verify readiness probe before listening, forces the volume
directory to `0700` and SQLite/database-sidecar files to `0600`, and on every
reopen verifies each retained lease/receipt signature, epoch/order, request
digest, state transition, status, and generation in addition to the outer
digest. `GET /healthz` reveals readiness only; all authority state requires a
single Bearer header. Header, request, canonical body, keep-alive, and
per-socket request bounds are explicit. GET bodies plus unauthenticated or
oversized body refusals pause the readable side and close the connection after
the bounded error response rather than draining attacker-controlled bytes.
Head GETs require one exact fresh challenge, and every client response stream
is independently size- and deadline-bounded and canceled on refusal.
POST bodies are canonical JCS bytes, so duplicate, non-canonical, unknown, or
missing members cannot be silently normalized. TLS is terminated by the
private service ingress; request and promotion clients refuse cleartext except
explicit loopback test use.

`scripts/snapback-request-publication-lease.mjs` validates the successful
candidate ledger, a separately retained complete official-registry prior
vector, and the just-read authority head, then requests and locally verifies
the signed head and lease with the pinned public key without accepting a Bearer
token on argv, as an inline production environment value, or writing it to the
lease. The promoter applies the same verification to every head and transition
receipt. Deploying the authority and executing a publication remain separate
operator acts; this implementation creates neither claim by itself.

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
- The packed React browser proof launches the exact headless-shell distribution
  whose complete path/type/mode/size/content identity is retained, not an
  ambient browser. It refuses symlinks, unsupported entries, checkout
  HEAD/dirty drift, any truncated or over-limit proof-owned surface, incomplete
  request/response/console/worker/storage/WebSocket coverage, and any private
  marker found in those browser-readable bytes. The receipt retains bounded
  per-surface byte counts and domain-separated content commitments, never the
  captured values themselves. It also retains the materialization boundary:
  protocol body buffers are configured and completeness is fail-closed, while
  Chromium-internal buffers, already-created CDP event objects, and the exact
  listed proof-invoked host collection results remain outside the proof's
  pre-allocation-bound claim. Copies and encodings performed by the proof
  after those values return remain pre-allocation bounded.

## Open Questions

- Which Exact package-version cadence should generated templates follow once
  `snapback new` exists, and how long should old template locks remain tested?
- Schema JSON Schemas are generated from the Rust types (LLP 0037) — settled;
  what remains open is only how the external loop ships them: bundled with the
  CLI, published as a package, or served by the running server.
- Which platforms does the first prebuilt-binary matrix cover, and is a
  from-source fallback acceptable for the rest?

## Status

Review. The Apple-silicon macOS tarball closure and external-directory loop are
implemented and retained by
`scripts/snapback-package-cold-install.mjs`: packed runtime launch, `new`,
offline `generate`, managed `dev`, ready-file attach, watched regeneration and
load, mismatch refusal, stop cleanup, app-CLI introspection, and browser
adapter bundling all pass. The packaged doctor now executes the full disposable
runtime/storage/live vertical slice rather than only `--help`. That is not yet
the RFC exit. The public `@ccheever/snapback-*` alias set is decided and staged
from `@snapback/*` source identities, and the complete eight-package `0.1.0`
closure is now public under `latest` with a byte-bound publication ledger. The
fail-closed public-registry instrument and two-platform aggregation were first
staged without public execution; the prior development-host tarball proof and
clean-Ubuntu staged-registry workflow run `30215680492`, revision `ca92d029`,
remain those checkpoints. The later authoritative public-registry executions
completed in GitHub Actions run `30216614778` on new macOS/arm64 and Linux/x64
machines, and the retained aggregate satisfies the `0.1.0` packaged-loop claim
with no nonclaims. LLP 0041 remains Review pending the normal
document-acceptance decision. The distinct `0.1.1` candidate-promotion
amendment above remains unexecuted.
