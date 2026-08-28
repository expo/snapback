# LLP 0041: Packaged developer loop

**Type:** RFC
**Status:** Review
**Systems:** Developer experience, Tooling, Build, Client integration, Demo apps, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07

**Revised (0.1.29 published-closure catch-up):** 2026-08-28 (`newestPublished`
advances to already-published 0.1.29; `newestQualified` stays 0.1.27 because
0.1.28/0.1.29 have no holding tag and 0.1.28 shipped receiptless. The
scheduled registry canary now fails when the git record lags npm `latest`.
See §0.1.28/0.1.29.)
**Revised (final public-package receipt guard):** 2026-08-27 (0.1.28 shipped
both final runtime packages without packaged-store qualification receipts and
therefore dropped `single_table_v1`; final `public-package` assembly now
requires the receipt, while native-artifact transport, source-test/contributor
staging, and the explicit pass-one override remain receiptless.)
**Revised (0.1.27 ceremony complete):** 2026-08-24 (the fourteen-package
closure published and promoted from `98681377721e` under holding tag
`fastpath-0-1-27-98681377721e`; see §0.1.27 for the completed record and
mandatory security nonclaims.)
**Revised (0.1.26 ceremony complete):** 2026-08-24 (the fourteen-package
closure published and promoted from qualified source `118babab1647` under
holding tag `fastpath-0-1-26-118babab1647`; both platform store receipts,
registry-byte verification, and the post-promotion cold boot passed. See
§0.1.26 for the completed record and mandatory security nonclaims.)

**Revised (0.1.25 ceremony complete):** 2026-08-23 (the fourteen-package
closure published and promoted from qualified source `9d9265394953` under
holding tag `fastpath-0-1-25-9d9265394953`; the public acceptance runner
first-published, all staged and registry bytes matched, and the post-promotion
cold boot passed. See §0.1.25 for the completed record and mandatory security
nonclaims.)

**Revised (public acceptance runner joins the next closure):** 2026-08-22
(the LLP 0275 D9 author ruling publishes `@expo/snapback-acceptance` as the
fourteenth identity-preset package; the thirteen-package 0.1.24 record remains
historical, and new authority issues bind the appended full vector.)

**Revised (template script surface):** 2026-08-21 (the LLP 0196 ruling keeps
top-level `test` and `test:static`, removes the redundant template `test:live`
alias with migration to `npm test`, and makes the README/start-packet glossary
manifest-checked.)

**Revised (0.1.24 ceremony complete):** 2026-08-17 (the thirteen-package
closure published and promoted from `f8cbf3d253b5`; custody first-published;
the first-publish gate is closed; see §0.1.24 for the completed record and
its recorded smoke-harness deviation.)

**Revised (0.1.24 custody publication posture):** 2026-08-16 (author ruling:
the Experimental `@expo/snapback-expo-custody` identity joins the next
qualified closure as its thirteenth package without a legacy alias or native
durability claim; its brand-new-name publication remains held by the custody
first-publish gate until the separately authorized qualified ceremony closes;
see §0.1.24.)

**Revised (0.1.23 fast-path publication):** 2026-08-16 (the twelve-package
closure from clean revision `cc79d498537b` passed Darwin arm64 and Linux x64
store qualification, byte verification, and the published install/boot smoke;
see §0.1.23.)

**Revised (fast-path isolate worktree):** 2026-08-12 (`stage`/`release` default
to an ephemeral detached worktree at HEAD so a dirty shared checkout cannot
burn Ibex bootstrap then die on `SNAPBACK_FASTPATH_DIRTY_TREE`; `preflight` is
the first-class seconds-scale cleanliness+HEAD gate. See §The fast path is now
`scripts/snapback-fastpath-release.mjs`.)

**Revised (explicit linked-source custody):** 2026-08-12 (external-workspace consumers of
the source CLI select an identity-matched, receipt-qualified checkout release
binary without weakening or imitating the published runtime package seal; see
§Runtime distribution.)

**Revised (non-destructive runtime assembly):** 2026-08-12 (both platform
runtime preparers now validate a complete loader-relative staging tree,
including the build-matched admin snapshot and reopened package seal, before
swapping any shipped artifact; package and source-checkout refusals name
custody-correct recovery.)

**Revised (qualified 0.1.19 promotion):** 2026-08-11 (candidate
`74eeaead1410` completed exact two-platform staged qualification and leased
promotion operation `release-0.1.19-20260811-r3`, publication epoch 18;
`newestPublished` and `newestQualified` advance to 0.1.19. See §"0.1.19
(2026-08-11)".)

**Revised (first completed qualified promotion):** 2026-08-11 (0.1.18 is the
first closure to travel the full qualified ceremony end to end — frozen
candidate, EAS-provenance staged receipts, leased `latest` promotion,
post-promotion hosted proof — and `newestQualified` advances from 0.1.7 to
0.1.18; the ceremony's operational record and standing facts are in
§"0.1.18 (2026-08-11)".)

**Revised (published admin-console closure):** 2026-08-10 (the static
Contract/Exact admin snapshot is now a required, build-matched member of every
platform runtime package; runtime sealing, staged-tarball qualification, and
the external exact-version boot smoke all prove it.)

**Revised (cooperative regeneration lock):** 2026-08-10 (all codegen writers
for one canonical backend directory now share a dependency-free advisory lock,
so the managed watch loop, explicit `generateApp` calls, and separate codegen
processes cannot overlap the generated-directory replacement window; dead or
bounded-age holders are reclaimed and live waiters fail closed after a bounded
wait rather than proceeding concurrently.)

**Revised (npm naming settled):** 2026-08-10 (author ruling: the `@expo`
scope is the terminal *and* final npm naming answer; the unscoped `snapback`
registry name is not pursued — see §Amendment (2026-08-10): npm naming is
settled on the `@expo` scope.)

**Revised:** 2026-08-09 (the fast path becomes a gated two-pass script: the
packaged-store qualification receipt is minted and restaged by
`scripts/snapback-fastpath-release.mjs`, a fail-closed staged-tarball gate
refuses to publish a runtime package without it, `latest` moves only after a
post-publish smoke boots an app built from the published bytes, and 0.1.17 is
recorded as the first cut under that gate)

**Revised (promotion closure reconciled):** 2026-08-07 (the leased-promotion
vector now equals the full eleven-package publishable closure, including
`@expo/snapback-expo` and `create-snapback-app`; first-publication members use
`null` `expectedPriorVersion` rows per §First-publication `latest` bootstrap
lineage. The v4 lease width is widened in place because no v4 lease was ever
issued against the public registry.)

**Revised (closure widened to ten):** 2026-08-06 (sitting #4 ruling 2:
`@expo/snapback-expo` joins the publishable staging closure at 0.1.10 —
inventory, publish script, and closure tests now carry ten packages; the
leased-promotion vector stays nine until the 0.1.10 close-out handles the
first-publication case per §First-publication `latest` bootstrap lineage.)

**Revised (runtime package seal):** 2026-08-06 (LLP 0123 Option 3 landed:
Darwin and Linux runtime packages now carry one production-issued
`snapback.runtime-readiness.v1` seal binding binary + shipped Hermes
header/runtime digests, full build identity, source revision, and the
successful CV-2 verdict; package resolution re-verifies it. The cross-host
Linux transport sidecar is v2 and carries the header digest + verdict.)

**Revised (unattended CLI contract):** 2026-08-05 (`snapback --help` now
composes the package-owned and delegated native inventories; package command
help is data-only and declares lifecycle/output/exit/recovery; a follow-up
review closed the shallow-routing defect by giving every positional wrapper
dispatch, including each closed hosted lifecycle verb, exact non-executing
nested help; non-TTY stdin EOF closes only `snapback dev`'s optional control
channel and no longer stops the managed loop).

**Revised (live generated acceptance defaults):** 2026-08-05 (the generated
todo and React starters now map default `test` to isolated runtime acceptance
with a bounded identity/check/cleanup receipt; static scaffold coherence is
explicitly `test:static`; `test:live` was a compatibility alias at this
revision and was removed by the 2026-08-21 template script-surface ruling.)

**Revised (first-publication bootstrap lineage):** 2026-08-01 (see §First-publication `latest` bootstrap lineage: "record and move on" — no bootstrap path built; 0.1.7's npm-auto-`latest` first publish recorded as dated lineage.)

**Revised (decision-9 scope migration):** 2026-07-31 (see §Decision-9 terminal-scope migration.)

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

**Revised:** 2026-08-08 (the Linux runtime is self-contained against an
explicit host-soname baseline; see §Linux runtime self-containment —
2026-08-08). 2026-08-07 (LLP 0189 alignment sweep:
verification-cadence/claim-gating clauses re-scoped or annotated to the LLP
0189 D-3/D-6 defaults). 2026-07-30 (Diary 0039 external-adoption evidence: the rerun
ran on sibling-checkout imports three days after `0.1.0` went public; the
`demos/_kit` helpers every arm imports, and the admin client Dispatch's
acceptance imports, sit outside the nine-package closure — see the new
§Open Questions entry and LLP 0115 CV-1). 2026-07-24 (the clean-Ubuntu lane now records platform,
architecture, kernel, Node, exact runtime package, and GitHub-hosted clean-VM
status in the cold-install receipt, then retains that receipt, the publication
ledger, and immutable tarballs through a commit-pinned artifact uploader. The
workflow remains unexecuted on this working tree). 2026-07-24 (the provider-independent Linux packaging prerequisite for LLP 0072 now has an `@snapback/runtime-linux-x64` package contract, loader-relative Hermes RUNPATH, CLI platform selection, all-runtime publication mode, and a clean-Ubuntu build/pack/cold-install proof lane. The package identity tests and macOS host-closure proof pass; the Linux binary and clean-machine receipt still require that Ubuntu lane, and nothing is publicly published). 2026-07-23 (LLP 0079 SC-2b: the dev loop gains its client arm — `snapback dev --client` runs a client surface in the same watch process after first load, with a minimum verb slice (status / force regenerate-and-reload / restart backend) surfaced both interactively (TTY keys) and machine-readably (`snapback.dev-command.v1` stdin commands over the `snapback.dev.v1` event stream); §Acceptance gains the client-arm criterion and §Watch mode gains the Exact-side client-arm seam definition); 2026-07-23 (LLP 0079 SC-3: hot-push is artifact load, not data migration — recorded as a standing constraint in §Watch mode with LLP 0078 R2 as external evidence); 2026-07-21 (the first-publication probe found that `@snapback/cli` is an unrelated public 3.x package, reopening LLP 0021's namespace decision exactly as its caveat required. The publisher's provisional `@ccheever/snapback-*` mapping passes npm dry-run as the labeled `0.1.0-llp0063.1`/`llp0063` prerelease. The cold-install proof now has distinct tarball and registry modes, refuses to describe renamed tarballs as an offline closure, and requires registry identity/version/integrity plus a successful publish ledger before registry installation. npm's interactive OTP challenge stopped the real publish before a version became visible, so public-registry, clean-machine, and multi-platform evidence remain open and Status stays Draft); 2026-07-20 (LLP 0063 Step 5 implementation checkpoint: `@snapback/cli` now owns `new`/`generate`/`dev`/`doctor`, delegates established host operations to the native CLI, and consumes the ready-file handshake with target fencing; `@snapback/runtime-darwin-arm64` carries a relocatable release binary plus Hermes framework, with Apple-silicon macOS as the first explicit platform slice; a tarball-only external proof from clean source revision `a75ddd51…` launches doctor with `DYLD_*` scrubbed, scaffolds and generates offline, starts/loads/watches/stops a managed server, seeds only a newly created database, and refuses a mismatched attach. Public npm publication and separately-provisioned clean-machine evidence remain open, so Status stays Draft); 2026-07-12 (ENG-24504/ENG-24505/ENG-24507: one exact root Bun authority and lock-installed TypeScript, with Bun as the sole root lock; earlier 2026-07-09 ENG-22564: demo/admin Exact dependency policy implemented with published packages and committed locks; earlier: 2026-07-07 cross-family review revisions, ratified by Charlie — see
`reviews/0041-packaged-dev-loop.claude.md`: runtime-distribution design
section added, package/CLI surface corrected to repo reality, LLP 0030
boundary stated, ready-file attach pinned; initial same day)
**Related:** LLP 0000, LLP 0010, LLP 0012, LLP 0015, LLP 0016, LLP 0021, LLP 0023, LLP 0024, LLP 0030, LLP 0037, LLP 0038, LLP 0042

**Revised (0.1.9 fast-path publication):** 2026-08-06 (0.1.9 published
fast-path from clean main `7c16f6d0b8` to `latest` on all nine packages;
see §Fast-path pre-consumer release, 0.1.9 entry.)
**Revised (0.1.8 fast-path publication):** 2026-08-01 (author decision:
pre-consumer releases may skip the staged proofs and the candidate-tag/
leased-promotion ceremony entirely while the packages have no external
consumers; 0.1.8 published fast-path from clean main `5d5c6b71` directly to
`latest` on all nine packages. See §Fast-path pre-consumer release
(2026-08-01).)

**Revised (parallel EAS qualified staging):** 2026-08-01 (the qualified
candidate staging lane moves from GitHub Actions to the dedicated
`@expo/snapback-ci` EAS project. Linux/x64 and macOS/arm64 release runtimes now
build concurrently on large workers, restore source-authority-keyed Hermes
caches, converge at one macOS assembly job, and fan back out
into concurrent staged cold proofs. The final public `latest` proof and its
GitHub-bound promotion collection remain on GitHub; see §Qualified staging
substrate — 2026-08-01. The first retained run completed in 18m29s.)

**Revised (browser-canceled response tolerance):** 2026-07-31 (the staged
linux-x64 cold-install proof failed deterministically with `browser response
failed before complete capture: net::ERR_ABORTED` — the real-browser journey's
own navigation raced the tail of resource capture. The capture now drains
in-flight responses before proof-driven navigation and tolerates a
browser-canceled response only when all protocol-reported delivered bytes are
scanned; see §Acceptance.)

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

**Revised (resolver-propagation barrier):** 2026-07-29 (promotion run
`30480479462` proved that the official registry's direct dist-tag view can
report the complete candidate vector while fresh npm alias resolution on both
GitHub-hosted platforms still selects the prior CLI root. The promoter now
validates and freezes the closed proof plan, helper digest, clean checkout, and
HEAD before authority acquisition; after tag convergence it fences a
fresh-cache, scripts-disabled `@snapback/cli@latest` install with the complete
vector and signed acquired head on both sides. Only the exact signed prior CLI
root is retryable. Run `30481827652` then showed that one publisher-region
success can precede both fresh GitHub regions. The publisher probe therefore
remains a necessary load-shedding signal, while each authoritative macOS and
Linux proof now performs its own bounded, unique-cache selector retry. The
closed plan and retained receipts bind the signed prior CLI version, lease
digest, and publication epoch. Only a structurally valid, uniform prior
closure may wait; the candidate root with an incomplete closure, a missing or
third root, resolver error, vector/head drift, or insufficient hosted-proof
plus rollback lease budget refuses and enters the existing full rollback.
Run `30488914818` then showed both hosted regions observing a mixed vector
(`@ccheever/snapback-app-cli` still prior) roughly 15 seconds after the first
publisher-region candidate closure. Mixed vectors remain terminal. Before
dispatch, the publisher must instead prove **two** complete candidate-root
cold closures separated by 30 seconds; both observations are vector/head
fenced, and the lease budget must reserve that delay plus both probes, hosted
proof, and rollback. The barrier's v2 evidence retains the maximum attempt
ceiling, required consecutive successes, delay, probe bound, mandatory
stability reserve, and every observation. Epoch 13 consumed 187.425 seconds
from issue to its first barrier attempt. The next closed plan therefore uses a
400-second hosted dispatch bound plus 30-second verification, 120-second
rollback, and 120-second two-probe stability reserve: 670 seconds total,
leaving 230 seconds before the barrier (42.575 seconds above that measured
path). Earlier successful hosted runs completed in 163–185 seconds. Exceeding
the 230-second pre-barrier budget still refuses before a probe. The barrier
rechecks at a fresh clock after retaining each success, and the promoter
revalidates the lease and downstream reserve once more immediately before
hosted dispatch.
This is a corrective instrument and does not itself claim a completed
promotion.)

**Revised (pre-issue prior-closure qualification):** 2026-07-29 (epoch 11
proved that prior-tarball qualification inside a fixed 15-minute lease could
consume the proof and rollback reserve even after the candidate vector moved.
The requester now brackets and retains the complete official-registry prior
closure before issue. Its canonical receipt digest is signed into the v3
lease; promotion independently rehashes and re-extracts every retained
tarball, checks freshness and current checkout identity, and reopens the
official vector before acquisition. Mutation gates read vector then a fresh
challenge-bound head. The authority dual-reads retained v2 history but issues
only v3 leases.)

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

Each supported platform runtime also carries `admin/`, a closed immutable
Contract/Exact snapshot produced from the same clean source revision as the
runtime binary and its embedded Guide. Runtime preparation validates and copies
the snapshot, the runtime-readiness seal digests every member, and the CLI
validates the snapshot against that receipt before setting the server's admin
dist path. `SNAPBACK_ADMIN_DIST` remains a contributor override, not an install
step. Native artifact builders may omit the snapshot only on the explicit
intermediate-artifact seam; final package assembly cannot.

Unsupported host platforms are a declared capability fact, not a broken
install.

[observed] A repository may deliberately commit an external workspace path to
the CLI source package while co-evolving with Snapback. That topology remains
a contributor source build, not a miniature publication ceremony. The source
CLI therefore resolves the owning checkout's receipt-qualified release binary
under the LLP 0010 source-custody rules. It does not assemble the ignored
platform-package shell, accept a contributor binary as package-production, or
weaken the seal verifier. Packed and registry-installed CLIs lack the source
topology and continue to select only the sealed platform package.

#### Validate-then-swap runtime assembly (2026-08-12)

Runtime package preparation is a manufacturing operation, never an adopter
install operation. A consumer package manager must only copy/link already
assembled package bytes; it must not invoke runtime assembly or otherwise
touch the package shell.

Both platform preparers assemble `bin/`, the platform Hermes directory,
`include/`, `admin/`, and `runtime-readiness.json` beneath a private staging
root inside the package. All fallible work happens there: native/header copy,
the source-revision-matched admin snapshot install, optional packaged-store
receipt install under the mode-specific rule below, CV-2 qualification against
the final loader-relative shape,
seal issuance, and read-only seal reopening. Only a staging tree whose seal
reopens may replace the shipped entries. Entry renames retain rollback copies
for ordinary failures and land `runtime-readiness.json` last, so interruption
cannot leave a mixed layout carrying an apparently valid seal. A precondition,
copy, admin, receipt, portability, qualification, or seal failure leaves the
previous assembly untouched. `--source-test-staging` bypasses only the clean
public-package identity assertion; only `--native-artifact-staging` may omit
`admin/` for transport to a final assembler.

Recovery follows custody. An installed-package seal refusal names the exact
platform runtime package to reinstall from the consumer's lockfile; package
bytes are not requalified or rebuilt in place. A contributor/source-checkout
refusal names `scripts/assemble-runtime-package`, which refuses a dirty tree
up front and performs bootstrap, a clean production-profile build, locked admin
install and build, then staged host-package assembly. This keeps the binary,
console manifest, and package seal bound to one source revision.

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

Publication is a closed state machine (its exact-SHA/clean-checkout freezes
are ceremony-local TOCTOU guards, not completeness preconditions; the
completeness half is LLP 0189 D-6 — the most recent eligible complete
battery green on the candidate's claim-relevant gates, unrelated reds
ticketed and named in the promotion ledger):

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
   ledger. Each host must materialize its own required runtime and retain
   exactly one empty npm-tree entry at the CLI's opposite,
   platform-filtered optional-runtime edge, including that edge's tree path.
   The opposite runtime must be absent everywhere else; an empty required,
   host-runtime, unknown, duplicate, or additional Snapback entry refuses the
   proof. Failure blocks served capability publication and
   moves the CLI root back to its recorded prior tag when npm permits; if the
   root move cannot be reversed, the release receipt is failed loudly and no
   target capability carrier may reference it.

Before authority acquisition, the promoter must validate and freeze the closed
proof plan, its package-owned helper digest, the exact checkout HEAD, and a
tracked-clean checkout. It reopens that same plan and provenance immediately
before dispatch; a dirty checkout or changed plan therefore refuses before the
first mutation and also closes the local time-of-check/time-of-use window.

Direct dist-tag convergence is necessary but not sufficient to begin step 7.
After the complete promoted vector is journaled, the publisher creates a new
temporary project and a unique empty npm cache, disables lifecycle scripts,
and resolves only
`@snapback/cli: npm:@ccheever/snapback-cli@latest` from the official registry.
It validates the resulting complete npm tree with the same latest-root closure
rules as the hosted proof. A stale result is retryable only when the installed
root is exactly the lease's signed prior CLI version. A missing root, any third
version, the candidate root with stale or malformed transitive dependencies,
or any resolver error refuses immediately.

Every publisher-region resolver attempt is bracketed by a fresh
complete-vector read and a challenge-bound acquired authority head. The
attempt has one absolute process deadline and begins only while the lease
retains the closed proof-plan timeout plus an explicit reverse-transition
reserve. Those fences and a bounded attempt witness are retained under
`publicLatestRootBarrier` in the promotion receipt, separately from the nine
closed tag events. That probe is necessary but not sufficient dispatch
evidence.

The final macOS and Linux GitHub-hosted executions are authoritative for their
own resolver regions. The closed v3 proof plan carries the signed prior CLI
version, authorized lease digest, and publication epoch through the
package-owned helper and workflow inputs. Before the expensive product and
browser journey, each host retries only a successful, structurally valid npm
tree whose CLI and every installed Snapback dependency are uniformly the
signed prior version. Each attempt removes install state, uses a distinct
empty npm cache, disables lifecycle scripts, reopens the complete candidate
tag vector, and is governed by package-owned limits: a 350-second wall bound,
at most 18 attempts, a 45-second child bound, and 20 seconds between prior
observations. The closed dispatch budget is 540 seconds under a 560-second hard
cap; the promoter reserves that budget, collection verification, and rollback
before beginning the hosted proof. Resolver/process errors, missing or third roots, mixed prior
closures, tag drift, and malformed candidate closures are terminal. A
successful latest-root receipt uses schema v2 and retains the exact policy,
ordered classifications and timestamps, cache-identity digests, lease
identity, and final candidate-closure digest; the v3 GitHub collection and
v2 post-promotion ledger bind those receipts without treating self-consistent
workflow input as publication authority.

Cross-host assembly never executes a foreign native binary. The native Linux
builder launches `build-identity` itself and retains one closed
`snapback.runtime-artifact-attestation.v2` sidecar binding that exact clean
source revision and public-package identity to SHA-256 digests of the x86-64
ELF runtime, Hermes library, and compile-side Hermes header, plus the complete
successful `snapback.runtime-qualify.v1` verdict produced by executing that
native pair. The macOS assembler re-hashes all transported artifacts,
validates the closed sidecar and source revision, and only then stages the
Linux package and emits its package-owned readiness seal. ELF header checks
remain independent. A sidecar without byte equality, exact source identity,
public-package build distribution, or an identity-matched successful verdict
refuses qualification.

#### Qualified staging substrate — 2026-08-01

Qualified candidate staging is an EAS Workflow owned by the dedicated
`@expo/snapback-ci` project. It is intentionally separate from the final
public-registry proof-plan helper: staging builds and tests immutable local
tarballs, while promotion still dispatches the GitHub-hosted matrix whose
repository/run provenance is part of the signed publication evidence.

The staging graph has two independent roots. `linux_runtime` and
`darwin_runtime` check out the same workflow revision, remove checkout
authority, build public-package release binaries concurrently on EAS large
workers, and retain native artifacts. The Linux artifact keeps the existing
cross-host digest attestation. The macOS artifact is transported back to a
macOS assembler, which executes `build-identity` from that relocatable closure
and requires the exact assembly checkout revision, clean build identity,
release profile, and public-package distribution. Assembly begins only after
both roots succeed. The exact nine-tarball closure then feeds independent
macOS and Linux staged cold-proof jobs in parallel, and a final retention job
admits the release archive only when the ledger, all nine tarballs, and both
receipts are present.

Restoring a cache is not evidence and does not weaken the clean-source claim.
Hermes build/install caches are keyed by the pinned Hermes source/profile
authority (version, patch application and patch stack, builder, and Ibex
manifest). Each saved entry also carries the workflow source revision and later
revisions may only use it as a restore prefix. Cargo target caching is omitted:
on the hosted workers its compression and upload cost exceeded the reuse value.
The native build still runs the normal bootstrap, link smoke, release build,
package preparation, runtime identity check, source-clean check, and (for
transported Linux bytes) digest attestation. Those output checks, not cache
provenance alone, remain the qualification authority.

The first retained execution at revision
`87cc4ac358082e51c2781d0241c4ee761b9cd24e` completed successfully in 18m29s
([EAS run](https://expo.dev/accounts/expo/projects/snapback-ci/workflows/019fbd18-6ad1-744b-98cd-684945ae0ad7)). The independent roots overlapped:
macOS completed in 6m43s and Linux in 14m42s. Assembly completed in 1m18s;
the independent staged proofs then overlapped at 1m46s on macOS and 1m59s on
Linux; final retention took 28s and emitted the nine tarballs plus both
receipts. This verifies the graph and reduces the former roughly 90-minute
lane to 18m29s, while leaving the 15-minute target open because Linux is now
the dominant 14m42s root before the required assembly/proof tail.

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
and refuses a receipt that differs. Because the packaged green fixture's
committed generated output is inside that digested closure and local target
start regenerates it in place, fixture freshness is load-bearing:
`scripts/check-generated-artifacts` regenerates
`packages/snapback-cli/fixtures/comparator/app/snapback` and requires the
whole generated directory to reproduce byte-for-byte from the committed state.
A stale committed fixture makes the first packaged comparator run mutate the
executing closure mid-run and fail with
`SNAPBACK_COMPARATOR_RECEIPT_INVALID` (recurrences d5ad77c0, 345cb070,
ffe1cf51). The outer release validator binds the
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
That execution keeps two independently measured clean checkouts: the workflow
head supplies the current proof harness, while a detached worktree at the
candidate ledger's immutable source revision supplies demo and package
fixtures. The receipt binds both `proofHarnessCheckout` and `sourceCheckout`;
the harness must equal the dispatched GitHub head and the source checkout must
equal the candidate ledger. Running the historical candidate's older proof
code merely because its fixtures are historical is not equivalent evidence.
`scripts/snapback-github-latest-proof.mjs` dispatches that execution only after
the tag vector reaches the intended value, waits for a successful terminal run
within the publication-lease budget, downloads the exact run-id-named
`darwin-arm64` and `linux-x64` artifacts, and refuses local, stale, exact-root,
or differently correlated receipts. The publication proof plan is a closed
data object. It names the fixed repository/workflow/ref, expected workflow
HEAD, committed candidate-ledger path, release operation id, output paths, two
bounded time budgets, the SHA-256 of the package-owned helper, and the
lease-bound prior CLI version, lease digest, and publication epoch; it cannot
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

The official-registry download and alias walk occur **before lease issue**.
The requester uses a distinct empty npm cache, requires the separately
observed complete prior vector to match its fresh official-registry read, and
writes one closed receipt binding the candidate-ledger digest/tag/revision,
official registry and default tag, operation/publisher/source/helper identity,
start/completion time, identical bracketing prior vectors, ordered package
versions and rollback actions, retained tarball SHA-256/npm integrity/shasum,
manifest digest, complete normalized dependency maps, and internal aliases.
Only after that receipt validates does it read the standing-authority head and
request the fixed 15-minute v3 lease. The canonical receipt digest is a closed
member of the issue request and signed lease; the promoter recomputes it and
independently rehashes and re-extracts every retained tarball before
acquisition. The receipt must have completed no more than two minutes before
lease issue. The promoter then reopens the official complete vector before
acquisition. The receipt is not mutation authority: after acquisition, the
transition engine still reopens the complete registry vector and then a fresh
challenge-bound acquired head as its final observation before every mutation,
so drift between preflight, issue, acquisition, and mutation refuses without a
write. This ordering keeps read-only registry qualification from spending the
lease budget reserved for hosted proof and rollback.

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

Default-tag mutation requires an `AuthorizedPublicationLeaseV3` stored outside
npm in the standing release authority. The signed lease binds the publisher
instance, authority installation id, canonical HTTPS origin, pinned Ed25519 key
id, monotonically increasing `publicationEpoch`, candidate-ledger digest,
complete nine-package vector, candidate tag, default tag, exact expected prior
value or absence and intended new value for every package, issue/expiry times,
and single release operation id, plus the exact prior-default closure receipt
digest. The publisher must acquire this lease by an
expected-value transition from the release authority's prior head. An expired,
superseded, closed, differently bound, or unreachable lease refuses every
further npm mutation; a local lock or possession of npm credentials is not
publication authority.

Immediately before **and** immediately after each `npm dist-tag` add or remove,
the publisher reads the complete nine-package default-tag vector from the
official registry and the current external lease head. Before a mutation it
reads the vector first and makes a fresh challenge-bound head its final
fallible observation. The pre-mutation vector
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
The first pre-mutation read after a proven write uses the same two-vector
boundary: a cache-regressed copy of the immediately preceding checkpoint may
be retried, but no earlier or third vector may be crossed. This applies
symmetrically while advancing and reversing the dependency-first sequence.
Ordered events retain the pre-checkpoint, post-write convergence, and any
catch-reconciliation observation counts separately; a refused read is still
one attempted official-registry observation, never an uncounted gap.

Every head request supplies a fresh 256-bit challenge. The authority includes
that challenge in the v3 head signature while excluding it from the stable
state-head digest; the client requires exact equality. A recorded acquired
head therefore cannot be replayed after authority close even while the lease's
wall-clock interval remains open. Every authority client streams at most
128 KiB and aborts/cancels oversized, malformed, or 15-second-stalled success
and error bodies.

Rollback covers the full vector of successfully changed packages, including a
root move, and visits them in the reverse of their actual mutation order. For
each package it first re-reads the complete registry vector and then the
external lease head. It restores the recorded prior exact version, or removes a default tag
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
engine must still re-read the complete
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

The protocol is dual-read/single-write across this correction: validation and
durable reopen retain the v2 key set and v2 signature domain for historical
epochs, while the live issue endpoint accepts only v3 requests and emits only
v3 leases. A retained v2 history therefore cannot wedge authority startup, and
a new release cannot omit the signed prior-closure digest.

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

The packaged entry point owns a composed, non-executing help registry for
every package-dispatched command and positional subcommand path and appends the
native binary's clap-derived inventory at root help.
`snapback <package-command> [<subcommand>...] --help` selects the longest exact
registered path before dispatch and declares that path's flags,
one-shot/long-running lifecycle, machine output, exit taxonomy, and recovery
channel. Closed hosted lifecycle verbs are derived from the same exhaustive
registry that dispatch uses. Delegated native command help is still rendered
by clap; help never invokes the command body.

### Watch mode

Watch mode coalesces edits and performs:

1. source discovery;
2. codegen;
3. schema/function load into the running server;
4. stale artifact checks;
5. optional surface rebuild.

The debounce queue controls *when the managed loop asks* for regeneration; a
backend-local cooperative lock controls *which writer may publish*. Every
codegen entry point takes `.generated.regenerate.lock` beside `generated/`
before reading inputs and holds it through cache and materialized-directory
publication. This includes one-shot generation and callers outside the managed
loop, including other processes. An uncontended one-shot retains its existing
result contract and removes the lock before returning. A waiter never proceeds
unlocked: it reclaims a dead-PID, malformed-old, or bounded-age holder, and
otherwise returns a structured timeout after a bounded wait. This keeps watch
coalescing unchanged while making generated-graph atomicity a property of the
writer rather than of one scheduler instance.

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
`snapback.dev.v1` stdout stream). For non-TTY launchers, stdin is an optional
control channel rather than process-lifetime authority: EOF disables further
commands but leaves the dev loop and managed arms running. SIGINT/SIGTERM (or
TTY `q`/Ctrl-C) owns shutdown. MCP stdio commands retain their independent
EOF-terminates-server contract.

On managed sessions restart, an exact startup-pin mismatch does not weaken into
partial admission. The supervisor first observes the native structured refusal;
only when it contains both complete preflighted identities does the scriptable
loop retry with LLP 0058's explicit cold-successor activation opt-in. A valid
successor preserves the database and emits `startup-successor-activated` with
the database and from/to identities. An incomplete, incoherent, unloadable, or
storage-invalid successor remains `restart-failed`. Attached/external servers
are unchanged because this supervisor does not own their lifecycle or activation
authority.

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
services. As implemented 2026-08-05, `npm test` is the unwrapped
`acceptance.mjs` debugging path: it owns an isolated local
server/database/ready descriptor, binds the loaded artifact identity to the
generated review manifest, executes a real query and mutation through the
template's product client, refuses zero/short execution, and emits a bounded
`snapback.starter-acceptance.v1` receipt only after cleanup. It is not the
done-oracle. `bun run prove` delegates to `snapback verify` and writes the
authoritative aggregate verify receipt; only `prove` decides ordinary
completion. Static generated-file/source coherence remains available as
`test:static` and cannot satisfy the acceptance claim. The 2026-08-21 LLP 0196
script-surface ruling removed the byte-identical `test:live` compatibility
alias from all five templates; callers use `npm test` for the same raw runtime
acceptance path.

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
- That external install serves the real, build-matched admin console at
  `/_snapback/admin/` without `SNAPBACK_ADMIN_DIST` or repository files.
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
- Browser-canceled responses (`net::ERR_ABORTED` — a navigation aborting an
  in-flight request, or the page's own client canceling a fetch it has
  already consumed, as the packed starter's `/__snapback/connection/open`
  does when the delivered-versus-finished window is wide enough, which
  Linux's delivery timing makes near-deterministic) are not counterexamples
  to that completeness claim and must not fail the proof. Programmatically
  consumable responses (fetch/XHR/EventSource) are stream-captured into
  proof-owned memory as their bytes arrive (`Network.streamResourceContent`),
  so a later cancel cannot erase what the browser already read; the capture
  additionally drains cancel-vulnerable in-flight responses before
  proof-driven navigation. A cancel is then tolerated only when every byte
  the protocol reported as delivered is scanned — zero delivered bytes scan
  as an empty body, delivered bytes come from the proof-owned stream copy or
  a full protocol-buffer salvage. An unsalvageable delivered byte, and every
  non-cancel network failure, remains a fail-closed refusal.

## Open Questions

- Which Exact package-version cadence should generated templates follow once
  `snapback new` exists, and how long should old template locks remain tested?
- Schema JSON Schemas are generated from the Rust types (LLP 0037) — settled;
  what remains open is only how the external loop ships them: bundled with the
  CLI, published as a package, or served by the running server.
- Which platforms does the first prebuilt-binary matrix cover, and is a
  from-source fallback acceptable for the rest?
- **(2026-07-30, Diary 0039)** How do external acceptance consumers get the
  admin client and the test-harness helpers? Every arm's acceptance imports
  the `demos/_kit` helpers; Dispatch's acceptance additionally imports the
  admin client for authenticated cron inspection. Options per artifact:
  admit `@expo/snapback-admin-client` to the closure, fold it into the
  client/CLI, or endorse the served `/_snapback/admin/client.mjs` path for
  external use; and publish a test-helper package (server lifecycle +
  vacuous-pass-guarded harness), fold server lifecycle into the CLI, or
  endorse vendoring — the Codex pre-implementation review also proposes
  keeping the helpers a digest-pinned evaluation instrument rather than
  supported public API. Until both are decided, a clean external repository
  cannot run a workout-arm-grade acceptance suite against published
  artifacts (LLP 0115 CV-1).

## Decision-9 terminal-scope migration (2026-07-31)

The in-repo npm scope migration to the terminal `@expo/snapback-*` names
landed per LLP 0115 decision 9 / LLP 0130 SD-6, as its own serialized
landing. Every workspace package renamed — the nine publishing packages plus
three decisions this document now records:

- **Private/image-bound packages rename with the closure.** The private
  workspace packages `@expo/snapback-admin-client` and
  `@expo/snapback-publication-authority` and the image-bound
  `@expo/snapback-hosted-supervisor` renamed for workspace coherence,
  because the abandoned `@snapback/*` source dialect is a live unrelated
  third party's npm scope and any internal name left inside it is a
  registry-fallback supply-chain hazard as well as a second naming dialect
  (LLP 0122 facet 1).
- **The proof system migrated as lineage, never rewriting.** The protocol
  name table and scope pattern moved to a new v4 lease/issue-request
  generation with the v2/v3 generations still validating the recorded
  `@ccheever/snapback-*` artifacts; publish/ledger validation is keyed by
  `scopePreset` (`identity` = terminal, `ccheever` = recorded legacy —
  read-side only); an explicit `PACKAGE_NAME_LINEAGE` table binds each
  terminal name to its recorded source/published predecessors. The publish
  write-side accepts only the `identity` preset.
- **The GitHub proof repository slug moved to `expo/snapback`** for
  terminal-generation evidence — a proof-system surface decision 9's
  four-item enumeration did not name, recorded here as part of the same
  migration; legacy-generation receipts still validate against
  `ccheever/snapback`.

§Package boundaries' anticipated "future organization-owned brand scope may
replace this public alias without changing authored imports" is superseded
in one respect: decision 9 renames authored imports too, ending the
three-dialect split. Registry publication under the terminal names and
slice 5-rebuild remain open follow-ons; the `@ccheever` closure on the
registry stays the last published generation until then.

Also recorded: the hosted-supervisor counting discrepancy. This document
excludes it from the nine-package public closure while LLP 0115's 5-types
sweep counts it among the publishing packages the export-types gate covers —
both true today (it is versioned, non-private, types-swept, and unpublished),
flagged here so the GA-front-door closure decision resolves it explicitly.

## Fast-path pre-consumer release (2026-08-01)

Author ruling (Charlie, 2026-08-06, sitting #4): **LLP 0134 does not
govern npm packaging** — its evidence bar (soak windows, maturity
receipts) is struck from npm-promotion checklists, and this document owns
packaging evidence. Once the ceremony resumes, its bar is qualified
staging receipts (after the EAS-provenance validator repair,
`issues/20260806-qualified-publish-eas-provenance-blocker.md`) — no
14-day soak. Version authority: the operator supplies the version at
publish time and the publish lane must cross-check the guide fences
(`guide/published-closure.json` and page `since:` markers) before
publishing.

Author decision (Charlie, 2026-08-01): while the nine packages have no
external consumers — the only consumer is Charlie himself, and the LLP 0137
re-verification arms are the effective test — a release may skip qualified
staging, the staged platform proofs, and the candidate-tag/leased-promotion
ceremony entirely, publishing directly to `latest`. The ceremony resumes
when external consumers exist or at Charlie's call.

0.1.8 was published this way on 2026-08-01:

- Source: clean main `5d5c6b7183af160baf66cefcd9a53b9f510eb3a6`; both
  runtime binaries carry the `public-package`/clean/`release` build
  identity at that exact commit (darwin-arm64 built locally; linux-x64
  built on the `expo-build-1000` fleet host with the standard bootstrap +
  release recipe and consumed through the attested cross-host artifact
  seam — `SNAPBACK_RUNTIME_LINUX_X64_*` inputs with a validated
  `snapback.runtime-artifact-attestation.v1`).
- Staging: `scripts/snapback-publish.mjs --version 0.1.8
  --runtime-platforms all` in its default dry-run mode — correct
  version/dependency stamping, nine `dry-run-ok` rows, ledger emitted; no
  qualified ledger, no platform receipts, no candidate tag.
- Publication: the nine staged tarballs published directly with
  `npm publish --access public` under the default `latest` tag, in ledger
  order. Registry verification: all nine serve `0.1.8` with
  `latest: 0.1.8` (the immutable `bakeoff-0-1-7-fdd49db8abf1` tag still
  selects 0.1.7), and the `@expo/snapback-cli` registry tarball is
  byte-identical to the staged artifact (sha256 `6c73b261…`).
- Ledger custody: the dry-run staging ledger is retained at
  `~/snapback-release-ledgers/fastpath-ledger-0.1.8-5d5c6b7183af.json`.

The lineage gap is acknowledged and deliberate: 0.1.8 has no qualified
ledger, no platform proofs, no candidate tag, and no publication-authority
lease record — the promotion-machinery record for this version is the note
you are reading plus the retained dry-run ledger. The open leased-promotion
defects (issues/20260801-promote-v3-lease-pin-refuses-v4.md and
issues/closed/20260801-first-latest-promotion-no-distinct-prior-root.md —
the latter now closed by the bootstrap-lineage decision below) are
untouched by this decision and still gate the ceremony machinery whenever
it next runs.

### 0.1.20 (2026-08-12) — third completed qualified promotion

The eleven-package closure at candidate revision `13d72ba6d61e` (tag
`bakeoff-0-1-20-13d72ba6d61e`) was promoted to `latest` and closed at
publication epoch 25, operation `release-0.1.20-20260811-r8`
(00:53:56Z–01:02:34Z). Staged qualification ran the eight-job EAS
workflow green on the release branch; the candidate published and
byte-verified under the holding tag before any lease was requested.
Telemetry currentness was satisfied by the retained in-tree receipt
minted for 0.1.19's close (`HISTORICAL_VALID`/`CURRENT` at the
candidate: zero changed source inputs, age 8.7 h inside the 24 h
window) — a fresh branch-ref mint was also retained on the release
branch as `tests/acceptance/telemetry-phase1-evidence.v1.json`.
Promotion receipt and post-promotion ledger are retained in
`tests/acceptance/publication/`.

The ceremony took eight lease rounds across two supervisors, and the
failures are the operational evidence LLP 0233 anticipates:

- r1, r6: the fresh two-platform GitHub proof exceeded the
  publication-lease wait budget — evening macOS runner-queue latency
  (morning proofs started instantly and ran ~6 min; these queued
  5–10 min before starting).
- r2: a machine-wide process kill wave killed the promote **after**
  the tag flip, before proof and close; its receipt is retained with
  `status: running`. The prior vector was manually restored to 0.1.19
  (the exact mirror of the promote's own rollback path) before the
  next round — recorded here as the incident's durable trace.
- r4, r5: `gh workflow run` dispatch began failing
  (`unknown: undefined`); fixed by a pass-through shim translating to
  the REST dispatches API, and permanently by the two `ci(release)`
  commits landed with this close-out that move the proof matrix to an
  available arm64 macOS runner pool.
- r7: the proof run was cancelled mid-flight by supervisor
  coordination error (two concurrent sessions each treating the
  other's runs as orphans). The coordination note pattern in the
  candidate ledger directory is the mitigation of record.

No unreleased fences were pending; guide install pins advanced to
0.1.20. The 0.1.20 closure predates the auth catalog v4 landing
(`b180492e9`), which remains unpublished surface for the next cut.

### 0.1.21 (2026-08-14) — fourth completed qualified promotion; the umbrella first-publishes

The closure widened to twelve packages: `@expo/snapback` — the LLP 0253
umbrella carrying the LLP 0255 tiny-data doorways — first-published in
this cut under the author's publish-everything ruling (the path-1
resolution of `issues/closed/20260814-umbrella-first-publish-gate.md`).
Candidate revision `c10b454162f6` (tag `bakeoff-0-1-21-c10b454162f6`)
was promoted to `latest` and closed at publication epoch 28, operation
`release-0.1.21-20260814-r14` (20:11:08Z–20:21:21Z). The eight-job EAS
staging workflow ran green on the release branch; a fresh telemetry
receipt was minted at the branch ref and retained in-tree at the
candidate; all twelve packages published and byte-verified under the
holding tag before any lease was requested. Promotion receipt and
post-promotion ledger are retained in `tests/acceptance/publication/`.
This publication starts the LLP 0256 D9 evaluation clock.

**2026-08-15 disposition:** the author selected LLP 0254 D10 Withdraw. The
0.1.21 through 0.1.23 records remain historical publication facts; beginning
with 0.1.24, the Tiny doorways and their evaluation backstop are no longer part
of the live package closure. LLPs 0254–0256 are tombstoned and the frozen
benchmark retains the disposition receipt.

Operational evidence, in the LLP 0233 tradition — every failure below
was hit and fixed or dispositioned inside this one ceremony:

- npm's read path for a brand-new name lags its write path by minutes,
  not seconds: the umbrella's first publish returned eight consecutive
  E403 "cannot publish over 0.1.21" refusals (the write existed; the
  resume check's read could not see it) before resuming cleanly. npm
  also force-sets `latest` on a first publish regardless of `--tag`,
  so the observed prior vector records the umbrella at 0.1.21 while
  the eleven veterans sat at 0.1.20.
- The closure widening (`7023bd3a6`) was defective in production: it
  widened the v4 name vector in place, but the standing authority
  re-validates every recorded epoch at boot, so the deployed authority
  crash-looped over its own eleven-name history. Fixed forward as
  `TERMINAL_LEASE_WIDTHS` prefix tolerance (recorded widths validate;
  new issues must bind the full closure) with a regression test.
- `fly config save` does not capture `[[files]]` secret mounts; the
  first authority redeploy lost `/run/secrets/*` and crash-looped on
  ENOENT. The authority's `fly.toml` is now committed in the package.
- r7: a supervisor commit to the release checkout between lease and
  promote moved the checkout revision off the prior closure's bound
  `producerRevision` — the promote correctly refused. The rule of
  record: the release checkout is frozen from lease to close.
- r13: the two-platform GitHub latest-root proof exceeded the
  publication-lease wait budget (runner-queue variance, midday);
  strict reverse-order rollback held and r14 closed clean in ~10 min.

Post-promotion, `guide/published-closure.json` advances to 0.1.21 and
the published-symbols registry refresh from the candidate publication
lands with this record. The `@expo/snapback` README and the
`guide/data/promotion.md` page landed after the candidate cut and ride
the next release.

### 0.1.22 (2026-08-15) — twelve-package fast-path publication

The twelve-package closure published from clean revision
`272bea745bb00728b76297e313c5a0e58b55a4c9` under holding tag
`fastpath-0-1-22-272bea745bb0`. Darwin arm64 and Linux x64 store
qualification both passed, every registry tarball re-downloaded byte-identical
to the retained candidate ledger, and the external install/boot smoke passed
twice. The retained ledger is
`~/snapback-release-ledgers/fastpath-ledger-0.1.22-272bea745bb0.json`
(SHA-256 `9ae8172b272a8a2ba0bc546b4bff4e7209d09d8b0a2340e9ad3ec5997daf0743`).

The first `latest` readback observed npm propagation lag on nine names and
correctly left the ceremony incomplete. An idempotent resume skipped all
already-published immutable versions, re-verified their bytes, repeated the
consumer smoke, and closed with all twelve `latest` tags resolving to 0.1.22.
The same two-platform store receipts that gated the cut allow both
`newestPublished` and `newestQualified` to advance to 0.1.22.

### 0.1.23 (2026-08-16) — declarative membership admission published

The twelve-package closure published from clean revision
`cc79d498537b2e56723f290c245f9f64786f244b` under holding tag
`fastpath-0-1-23-cc79d498537b`. Darwin arm64 and Linux x64 store qualification
passed over one immutable tarball vector, every registry tarball re-downloaded
byte-identical to the retained candidate ledger, and the external
registry-installed boot smoke passed twice, including codegen, server readiness,
admin-route, capability, ensure-app, and live-query checks. The retained ledger
is `~/snapback-release-ledgers/fastpath-ledger-0.1.23-cc79d498.json` (SHA-256
`f4c3e4ba6e3f86d1f0ae569308636b9b260e10616a4c6ba3dd9383fc98cac115`).

The first `latest` readback observed npm propagation lag only for
`create-snapback-app` and correctly left the ceremony incomplete. The
idempotent resume skipped all already-published immutable versions, re-verified
their bytes, repeated the consumer smoke, and closed with all twelve `latest`
tags resolving to 0.1.23. The cut contains LLP 0240's declarative membership
handler admission and generated authority-profile reads, including the
fail-closed refusal for result contracts that cannot represent blank denial.
The closure record advances both `newestPublished` and `newestQualified` to
0.1.23.

### 0.1.24 (2026-08-16) — thirteen-package custody candidate posture

Author ruling (Charlie Cheever, 2026-08-16): the next qualified publication
closure contains thirteen packages. `@expo/snapback-expo-custody` is appended
as a terminal identity-preset package with no `LEGACY_PACKAGE_INVENTORY` alias.
It is explicitly **Experimental**: publication qualifies the package bytes and
their matched internal dependency, not native durable custody on either OS.
The package's iOS and Android adapters report their own grades, and
`single-runtime` is the only grade either adapter declares in v1. The separate
per-OS claims remain withheld behind
`issues/20260815-llp-0258-phase-2-native-custody-evidence.md`; this amendment
does not change any capability row.

The config plugin remains mandatory application configuration: an app that
uses the package lists `@expo/snapback-expo-custody` in its Expo `plugins`
array. The package is an optional native add-on and is not a dependency or
re-export of the thin `@expo/snapback` umbrella (LLP 0253 S3.1). The existing
twelve-name v4 publication records remain valid as an exact historical prefix;
new authority issues bind the complete thirteen-name vector.

Custody's first publication is held by
`issues/20260816-custody-first-publish-gate.md`, using the same arrangement as
the umbrella's first publication: repository-side admission does not itself
authorize the outward-facing mutation, and the ticket stays open through a
separately authorized qualified ceremony until all thirteen packages are
byte-verified, selected by `latest`, and pass the post-publish smoke. No new
npm tag cleanup/bootstrap mechanism is introduced. The existing generic
first-publish reconciliation applies: if npm auto-assigns `latest` to custody
under the holding tag, the exact candidate becomes an already-promoted prior
member and its promotion row is a verified no-op. Until the complete ceremony
closes, no qualified-publication claim may cite the candidate and the gate
remains open for explicit reconciliation.

**Ceremony completed 2026-08-17 (author-triggered).** The thirteen-package
closure published from clean revision
`f8cbf3d253b59d747572ec166750efc208709686` under holding tag
`fastpath-0-1-24-f8cbf3d253b5`. Darwin arm64 store qualification passed
locally; Linux x64 store and template-portfolio qualification passed on the
fleet Linux host against the exact staged closure (attested
`build-linux-runtime-release` inputs at the same revision). All thirteen
packages published, `@expo/snapback-expo-custody` first-published; every
registry tarball re-downloaded byte-identical to the retained ledger
(`~/snapback-release-ledgers/fastpath-ledger-0.1.24-f8cbf3d253b5.json`,
SHA-256 `d5254fd820c88cb67af3cc4be361cb5cfb00f1d82e49e15d0c0dae039b88fb8b`);
all thirteen `latest` tags converge on 0.1.24. The candidate carried the
2026-08-17 pre-cut gate program: the react-starter live-subscription fix, the
six-commit auth queue-store isolation program, the Expo web wasm bundling fix,
and four fixture-visibility closures, each proven by the release gate's
clean-room cold-install chain before the pin.

Operational evidence, in the LLP 0233 tradition:

- npm's read path for the brand-new custody name lagged its write path (E404
  on redownload after a successful publish), exactly as the umbrella's
  first publish did; the idempotent resume re-verified all thirteen and
  continued.
- The post-publish smoke refused its own embedded fixture's codegen with
  `SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT` — a fifth LLP 0234 G2 corpus
  straggler, in the smoke harness rather than the closure. The published
  bytes were already byte-verified and cold-install-proven at identical
  content. **Recorded deviation** (0.1.17-precedent shape): the fixture fix
  landed forward as `225cb9638`, the smoke was rerun green from the fixed
  harness against the published closure (receipt retained as
  `~/snapback-release-ledgers/smoke-0.1.24-rerun-receipt.json`, all eleven
  checks true), and `latest` promotion plus the thirteen-name readback
  (`~/snapback-release-ledgers/latest-readback-0.1.24.json`) were executed
  per the script's own final-loop semantics.
- The isolate mode of the fastpath script itself was caught silently
  no-opping (exit 0, `ok:true`) under macOS's symlinked default TMPDIR —
  filed as
  `issues/20260817-fastpath-isolated-worktree-symlink-tmpdir-false-success.md`;
  the ceremony ran `--no-isolate-worktree` from a dedicated clean worktree.

The closure record advances both `newestPublished` and `newestQualified` to
0.1.24, and `issues/closed/20260816-custody-first-publish-gate.md` records the
gate's closure.

### Post-0.1.24 amendment (2026-08-22) — public acceptance runner

The LLP 0275 D9 author ruling adds the supported
`@expo/snapback-acceptance` root entrypoint to the next qualified publication
closure. It is appended after `@expo/snapback-expo-custody`, widening the
identity-preset vector from thirteen to fourteen without a legacy alias. The
recorded eleven-, twelve-, and thirteen-name v4 leases remain admissible exact
prefixes; the standing authority issues only the full fourteen-name vector.

This amendment is package custody, not proof authority. Application-owned
journey callbacks still state product meaning, while `snapback verify` remains
the aggregate done-oracle and admits the package-owned starter receipt. The
package's supported root and v1 lifecycle/receipt compatibility contract are
specified by LLP 0275 D9. This is not a publication-completion record: the
top-level published-closure fact remains the thirteen packages actually
promoted at 0.1.24 until a separately authorized ceremony advances it.

### 0.1.25 (2026-08-23) — fourteen-package qualified fast-path publication

The fourteen-package identity-preset closure published from qualified source
revision `9d9265394953769aaa52e63c8a914464175f93ab` under holding tag
`fastpath-0-1-25-9d9265394953`. `@expo/snapback-acceptance` first-published in
this cut. The retained candidate ledger is
`~/snapback-release-ledgers/fastpath-ledger-0.1.25-9d9265394953.json`
(SHA-256 `31a6dcbb78b394f14e4773d845e7e5e8ee6da99df99907bdb63cccd8ff78d3ae`).
Every staged tarball rehashed to that ledger before publication. The
fail-closed staged-tarball gate reopened both packaged-store qualification
receipts (`darwin-arm64` SHA-256 `7f3757b72fad5184…`, `linux-x64` SHA-256
`5496274a4c288753…`), their clean `release` / `public-package` identity at the
qualified source, and the shared build-matched admin snapshot (SHA-256
`5ed4d703a5901fcc…`).

All fourteen exact versions published under the holding tag and re-downloaded
byte-identical to the ledger. The registry-installed boot smoke passed all
eleven checks before promotion. The first complete `latest` readback then
observed ordinary npm propagation lag for `@expo/snapback-codegen` alone and
correctly left the ceremony incomplete; an idempotent resume skipped all
already-published immutable versions, repeated byte verification and the boot
smoke, and closed with all fourteen `latest` tags at 0.1.25. The retained final
ceremony is
`~/snapback-release-ledgers/fastpath-ceremony-0.1.25-9d9265394953.json`
(SHA-256 `e173384ab06225a590d3462566ac9d52424fd378f87b526963661c4e1b6c81b8`).
A separate post-promotion cold boot receipt is
`~/snapback-release-ledgers/smoke-0.1.25-post-promotion-receipt.json`
(SHA-256 `8a5f65a5af2fdb05d325fe202c97668f200a11b8933eb3c87fbe420eeaddac61`),
again with all eleven checks green.

Immediately before the first npm mutation, a fresh fetch observed
`origin/main` at `2456ea437caa`, 25 descendant commits ahead of the qualified
source. LLP 0189 D-3 and this ceremony's snapshot rule preserve the qualified
source as the closure identity, so publication did not restart on the newer
tip. The fast path does not acquire a publication-authority lease or allocate
an epoch; `publicationAuthorityEpoch` is therefore `null` for this closure and
the last recorded leased epoch remains 28.

**Mandatory security nonclaims (LLP 0283 Revised (g)).** All four F-1 defect
families remain **open**. The LLP 0284 security gates remain **red by design**.
This publication claims **no adversarial-handler containment**, no F-1 closure,
and no green LLP 0284 gate state. The 0.1.25 package qualification and published
R2 input do not weaken or supersede any of those facts.

This cut gives LLP 0295 R2 a coherent published Snapback closure containing the
landed LLP 0295 W1–W5 and LLP 0294 W6/W7 repair surface. It does not claim that
R2 has run, that its instrument is validated, or that any authoring profile has
won.

### 0.1.27 (2026-08-24) — fourteen-package qualified fast-path publication

The fourteen-package identity-preset closure published from qualified source
revision `98681377721e86a836cd26f138b55e5cd2968a52` (the LLP 0307 chip-away
round's completed tip) under holding tag `fastpath-0-1-27-98681377721e`. The
retained pass-2 qualified ledger is
`~/snapback-release-ledgers/fastpath-ledger-0.1.27-98681377721e.json`
(SHA-256 `70793e11c07c7f1b38596ed524923339ef3f2974c7c251efcc63f64f8f3b3a26`);
the retained final ceremony is
`~/snapback-release-ledgers/fastpath-ceremony-0.1.27-98681377721e.json`
(SHA-256 `a7e86cd79a2325b825a066e71181565aed332db034b7b94f6e7e70b62422721a`);
the separate post-promotion cold boot receipt is
`~/snapback-release-ledgers/smoke-0.1.27-post-promotion-receipt.json`
(SHA-256 `b23abf384d46fb8c2a6dc52561612a64e21008d1720d75d7342366ab67cda332`),
all eleven checks green. Both platform store receipts minted and reopened
clean from staged bytes (Darwin `3bb1a2c1…`, Linux `7e5546eb…` on
`expo-build-1000`), all seven Linux runtime artifact SHA-256s re-verified
against the v3 attestation post-transfer, and the shared build-matched admin
snapshot (`30594f47…`) matched on both platforms. All five registered
templates scaffolded, generated, and passed static acceptance on both
platforms — now including the supervised Expo **web export** step added by
this round's qualification-gap repair, which is the published-surface check
the 0.1.26 closure lacked.

All fourteen exact versions published under the holding tag and re-downloaded
byte-identical to the ledger; the registry-installed boot smoke passed all
eleven checks before promotion. The first complete `latest` readback observed
ordinary npm propagation lag for three package names
(`SNAPBACK_FASTPATH_LATEST_PROMOTION_INCOMPLETE`, the 0.1.25/0.1.26 shape);
one idempotent scripted resume skipped the already-published immutable
versions, repeated byte verification and the boot smoke, and closed with all
fourteen `latest` tags at 0.1.27. `origin/main` was at the qualified source
at ceremony open and at the post-promotion fetch — no mid-ceremony drift.
The fast path acquires no publication-authority lease;
`publicationAuthorityEpoch` is `null` for this closure.

Surface highlights carried by this closure (the LLP 0307 round): the
`snapback replay` headless replay surface (LLP 0307.000), the supervised
Expo web-bundling repair, the supervised Metro CI/watch repair, the shared
declared-refusal projection, Familiar `defineAuth`, the W5 runtime-cost
diagnostics with their gated pull, the tri-state fixed-port probe, and the
sessions acknowledge wire repair.

Mandatory security nonclaims (LLP 0283 Revised (g)): all four F-1 defect
families remain open; the LLP 0284 security gates remain red by design; this
publication claims no adversarial-handler containment, no F-1 closure, and
no green LLP 0284 gate state. The 0.1.27 package qualification does not
weaken or supersede any of those facts.

### 0.1.28 / 0.1.29 (2026-08-27) — published without advancing the git record

0.1.28 (`2026-08-27T13:43Z`) and 0.1.29 (`2026-08-27T17:05Z`) both reached
npm `latest` for the fourteen-package identity-preset closure. Neither
carries a `fastpath-0-1-2X-*` holding tag. The isolated-worktree fast-path
ceremony was not a buildable tree at the time
(`issues/20260827-fastpath-release-isolate-not-buildable.md`); 0.1.28 also
shipped the final runtime packages without packaged-store qualification
receipts, as recorded in this document's 2026-08-27 revision. Those
closures therefore went out through a path that bypasses the holding-tag
ceremony.

`scripts/snapback-fastpath-release.mjs` still does not write
`guide/published-closure.json`. The update protocol in
`guide/conventions.md` is a post-publish git commit (the 0.1.27 shape:
advance the record, sweep unreleased fences, regenerate the guide
manifest). That commit did not happen for 0.1.28 or 0.1.29, so the
checked-in record stayed at 0.1.27 until 2026-08-28.

Catch-up: `newestPublished` / `publishedAt` advance to 0.1.29 /
2026-08-27. `newestQualified`, `closureId`, `qualifiedSourceRevision`, and
`ledgerSha256` remain the 0.1.27 ceremony identity — 0.1.28/0.1.29 have no
qualification-arm receipt of their own. `scripts/check-published-closure-registry.mjs`
now fails when `newestPublished` is not every identity-preset package's
registry `latest`, so a publish that skips the post-publish record commit
cannot drift silently again.

### 0.1.26 (2026-08-24) — fourteen-package qualified fast-path publication

The fourteen-package identity-preset closure published from qualified source
revision `118babab1647bb862e174761e37cc4e1b554b38b` under holding tag
`fastpath-0-1-26-118babab1647`. The retained candidate ledger is
`~/snapback-release-ledgers/fastpath-ledger-0.1.26-118babab1647.json`
(SHA-256 `b80b2e07a07f58d7bbf2740f81b2b1c51e7d8538afb51a9f3ad53a58e04c0da1`).
Every staged tarball rehashed to that ledger before publication. The
fail-closed staged-tarball gate reopened both packaged-store qualification
receipts (Darwin arm64 SHA-256
`6f37540d1ee43de05f880d6781b43c2ec536c26167931face102bf7bb6870aa1`, Linux
x64 SHA-256
`8aae308f7c849875df787d233d6eb99210d04c79b1e34c4265f0bf253e9a4c12`),
their clean `release` / `public-package` identity at the qualified source, and
the shared build-matched admin snapshot (SHA-256
`26a51a77c04058f821c3b1a2b6709a00ec2d6eaafbaa5e4f6f17da717fe9ae5c`).
Both platform installed-store suites passed 3/3 checks, and all five registered
templates scaffolded, generated, and passed their static acceptance on both
platforms.

Qualification found and fixed two published-bytes defects before the source
snapshot froze: compact governed `carry:*` start-packet glossary entries were
incorrectly rejected by template acceptance (`78ba9c538`), and
`@expo/snapback-cli` declared but omitted the public
`shared-development-auth.d.mts` file (`118babab1`). Neither failed attempt
mutated npm. Both runtime artifacts were then rebuilt from the final source;
the Linux host's older GitHub CLI could not verify the prebuilt Hermes
attestation, so the governed fallback built Hermes from source after verifying
all fourteen required patches rather than skipping the gate.

All fourteen exact versions published under the holding tag and re-downloaded
byte-identical to the ledger. The registry-installed boot smoke passed all
eleven checks before promotion. The first complete `latest` readback observed
ordinary npm propagation lag for the final five package names and correctly
left the ceremony incomplete; an idempotent resume skipped the already-
published immutable versions, repeated byte verification and the boot smoke,
and closed with all fourteen `latest` tags at 0.1.26. The retained final
ceremony is
`~/snapback-release-ledgers/fastpath-ceremony-0.1.26-118babab1647.json`
(SHA-256 `49707cc276a8a5d61d5ae5ec2713dba01379e9af1f0f14c252921709e2610108`).
A separate post-promotion cold boot receipt is
`~/snapback-release-ledgers/smoke-0.1.26-post-promotion-receipt.json`
(SHA-256 `5819aefed9520b6629374e41345bf5928beb19a275959322f5e4fb3256215c36`),
again with all eleven checks green.

A post-promotion fetch observed `origin/main` at `90191ec0b8ab`, two
descendant commits ahead of the qualified source. LLP 0189 D-3 and this
ceremony's snapshot rule preserve the qualified source as the closure
identity, so publication does not inherit unrelated later source. The fast
path does not acquire a publication-authority lease or allocate an epoch;
`publicationAuthorityEpoch` is therefore `null` for this closure and the last
recorded leased epoch remains 28.

**Mandatory security nonclaims (LLP 0283 Revised (g)).** All four F-1 defect
families remain **open**. The LLP 0284 security gates remain **red by design**.
This publication claims **no adversarial-handler containment**, no F-1 closure,
and no green LLP 0284 gate state. The 0.1.26 package qualification does not
weaken or supersede any of those facts.

### 0.1.16 (2026-08-09) — first cut under the rapid-publication ruling

The eleven-package closure published fast-path to `latest` from clean main
`ee21fa4a82c5486e1e4abf48e67a1745e7316e83`; retained ledger
`~/snapback-release-ledgers/fastpath-ledger-0.1.16-ee21fa4a82.json`
(SHA-256 `b448829da9654e4deceda58076bcfae01eb240eea053cdd2e30e1e296bac5182`,
written **before** the first `npm publish`, closing the 0.1.14 bookkeeping
gap). Both runtimes carry the clean `public-package`/`release` identity at
that exact commit — darwin-arm64 built locally, linux-x64 built and attested
on `expo-build-1000` and transported under
`snapback.runtime-artifact-attestation.v1` with all four artifact digests
re-verified after transfer. All eleven registry tarballs re-downloaded and
found byte-identical to the staged SHA-256 vector, and `latest` resolves to
`0.1.16` on all eleven names.

The candidate is one commit ahead of the `main` tip that opened the lane
because qualification found two **published-bytes** defects and the lane
repaired them first (`ee21fa4a8`): the CLI's packaged comparator and
push-seam fixtures had drifted from the codegen shipping beside them, and
the packaged copy of the authoring skill had drifted from its canonical
source. Both ship inside `@expo/snapback-cli`.

Per LLP 0189 D-6 this cut names its reds rather than claiming a green
battery. Claim-relevant gates re-run locally at the candidate and green:
`guide`, `client-bundle-metrology` (56 profiles), `snapback-codegen-package`,
the full `snapback-cli` suite, `package-test-inventory`, and
`agent-safe-publication`. Red and ticketed, none of them published bytes:
`generated-artifacts` and `required-surface-builds` (committed demo
artifacts stale — 29 of 33 backends regenerate clean, the other four are the
signed trusted-composition-activation demos that need a signed re-mint) and
`package-export-types` (two independent declaration-only causes). The
published closure still cannot serve the admin console
(`issues/20260809-published-runtime-omits-admin-console-bundle.md`), and the
Linux runtime still carries the ICU soname dependency
(`issues/20260808-linux-runtime-icu-dynamic-link-portability.md`); both
predate this cut and neither was repaired by it.

## First-publication `latest` bootstrap lineage (2026-08-01)

Author decision (Charlie, 2026-08-01): **record and move on.** No bootstrap
path is built into the leased-promotion machinery for the degenerate
first-publication case. The dated lineage record for the terminal scope's
first default vector is this paragraph: `latest: 0.1.7` on all nine
`@expo/snapback-*` packages was assigned by the npm registry itself at
first-ever publication (npm auto-assigns `latest` on a package's first
publish even under a non-default `--tag`; observed read-only 2026-08-01,
`issues/closed/20260801-first-latest-promotion-no-distinct-prior-root.md`),
not by any leased promotion — and the 2026-08-01 fast-path publication
above then moved `latest` to 0.1.8, so every future leased promotion under
these names has a genuine distinct prior root and the machinery's
distinct-prior-root preflight refusal stands unmodified as designed. The
degenerate case can recur only for a future brand-new package name added
to the closure; if and when that happens, the bootstrap path gets designed
then, against that publication's facts, rather than speculatively now.

## Linux runtime self-containment — 2026-08-08

The published `@expo/snapback-runtime-linux-x64@0.1.14` refused to launch on
a stock consumer host because the package required `libicuuc.so.78`, which
was available on its EAS builder but absent from the consumer. The ICU linkage
was on `lib/libhermesvm.so`, not `bin/snapback`; the executable separately
carried a dynamic `libcurl.so.4` dependency that is also not a baseline host
guarantee.

The Linux package now bundles every non-baseline shared-library dependency
discovered on the native builder into its `lib/` directory, closing the
dependency graph transitively (including `libicuuc` → `libicudata`). The final
executable uses legacy `DT_RPATH` by linking with `--disable-new-dtags` and
`$ORIGIN/../lib`. This distinction is load-bearing: the glibc loader applies
the executable's `DT_RPATH` while resolving a shared library's own
dependencies, whereas `DT_RUNPATH` does not provide that transitive search.
The Ibex `sfe-static-network` feature supplies its pinned static curl and
vendored static OpenSSL, removing the ambient `libcurl.so.4` dependency.

The only shared-library sonames the runtime may require from the host are:
`ld-linux-x86-64.so.2`, `libc.so.6`, `libm.so.6`, `libpthread.so.0`,
`libdl.so.2`, `librt.so.1`, `libresolv.so.2`, `libutil.so.1`,
`libgcc_s.so.1`, and `libstdc++.so.6`. Every other `DT_NEEDED` entry must name
an exact regular file shipped in the package's `lib/` directory.

The pure-JavaScript ELF64 gate fails closed in package preparation, the native
`scripts/build-linux-runtime-release` lane, the EAS qualified-staging build,
and `packages/snapback-runtime-linux-x64/package.test.mjs`. It also requires
the executable's transitive `DT_RPATH`, refuses `DT_RUNPATH` on the executable
or a bundled library, and admits only x86-64 ELF members.

The cross-host artifact attestation advances to
`snapback.runtime-artifact-attestation.v4`; its
`bundledLibrariesSha256` map binds each transported soname to its native
builder digest, and its `catalogBuildIdentity` binds the catalog identity
observed by executing `controls list --json` on that native builder. The
package seal enumerates every regular file under `lib/`,
so adding, removing, or changing a bundled dependency produces
`framework-drift` at consumption.

Residual exposure remains explicit: this gate constrains sonames, not glibc
or GLIBCXX symbol-version baselines. The builder's glibc therefore remains the
minimum compatible host floor until a separate symbol-version gate or older
builder baseline is adopted.

## Status

Review. As of 2026-07-31 the workspace carries the terminal
`@expo/snapback-*` names (decision 9; see §Decision-9 terminal-scope
migration above) and the registry still holds the last-published
`@ccheever/snapback-*` generation. The Apple-silicon macOS tarball closure and external-directory loop are
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

## Amendment (2026-08-08): rapid-publication posture — author ruling

Ruled by the author (Charlie Cheever, 2026-08-08), recorded here because
this document owns packaging/distribution:

**Publish to npm rapidly and often — effectively whenever `main` carries
meaningful surface changes and the qualified publication path passes.**
The default is land → publish, not land → batch.

Rationale, verbatim in substance: there are currently no users counting
on Snapback to work a certain way, so release scarcity protects no one;
to the extent users arrive, they will be agents who read all the docs,
so doc-accurate frequent releases beat rare "stable" ones. The
qualification bar itself is unchanged — publish qualified, never
broken (the LLP 0186 W0 bar and the ceremony receipts stay) — but
release *frequency* is never treated as a cost, and unpublished landed
work is treated as a liability (the run-6 series measured 0.1.15 for a
full day while its biggest papercut fix sat landed-but-unpublished on
main). Standing until users with stability expectations exist; revisit
then.

## Amendment (2026-08-09): the fast path is a script, and it is gated

The 0.1.16 cut published a closure in which no generated app could start.
Both runtime packages omitted `bin/packaged-store-qualification.receipt.json`,
so the `public-package` runtime kept `single_table_v1` as a GAP and every
generated backend exited 5 with `SNAPBACK_CAPABILITY_UNSUPPORTED`. Every gate
the lane ran was green, and the retained ledger's byte-verification claim was
true — of bytes that could not run.

The attribution is a process shape this document created. The fast-path
posture recorded above (2026-08-01) legitimately drops qualified staging, the
staged platform proofs, and the candidate-tag ceremony; what it did not say is
that the packaged-store qualification receipt is **not** part of that ceremony.
It is a generated artifact each runtime package must carry, minted by a
two-pass stage/qualify/restage procedure. `scripts/qualified-staging-assemble`
automates it for the qualified lane. The fast path performed it **by hand** for
0.1.12 through 0.1.15 — the registry receipts for those versions each bind
their own release revision and closure, so they were genuinely minted, not
inherited — and the 0.1.16 operator simply did not perform it.

An unenforced manual step in the only lane that cuts releases is not a
procedure. It is a coin flip. This amendment replaces it.

### The fast path is now `scripts/snapback-fastpath-release.mjs`

Three subcommands, replacing the hand-run
`snapback-publish.mjs` + loop-of-`npm publish` recipe described under
"Fast-path pre-consumer release (2026-08-01)":

- **`preflight`** inspects source cleanliness and `HEAD` only, and exits in
  seconds. Wrappers that used to run `scripts/bootstrap-ibex-runtime` first
  must call this (or import `preflight` / `assertCleanTree`) before any
  bootstrap or handler-VM qualification. It is the gate that cannot be skipped
  by a wrapper that bootstraps first.
- **`stage`** performs pass one into `<out>-pass1` with
  `SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS=1`, mints the **host** platform's
  receipt from that exact staged closure via
  `scripts/qualified-staging-store-qualification.mjs`, and emits the other
  platform's mint command together with the pass-1 tarball digest vector, so
  the remote mint can be proved to have consumed identical bytes.
- **`release`** requires one `--receipt <platform>=<path>` per runtime
  platform, restages with both receipts wired into package preparation, runs
  the gate below, retains the ledger **before** any publish, publishes under an
  immutable `fastpath-<version>-<sha12>` holding tag, re-downloads and
  byte-verifies every registry tarball, runs the post-publish smoke, and only
  then moves `latest`.

`latest` is no longer the tag a fast-path publish writes. It is a promotion
that a passing smoke earns.

### Isolated worktrees (2026-08-12)

The 0.1.20 fast-path attempt from the shared primary checkout
(`/Users/ccheever/projects/snapback`) burned full Ibex bootstrap and
handler-VM qualification, then died on `SNAPBACK_FASTPATH_DIRTY_TREE`. The
clean-tree gate is correct — releases must not embed uncommitted state — but
that checkout is shared by concurrent sessions and is effectively always
dirty. Operators must **not** bootstrap the shared primary checkout as a
prelude to this script.

`stage` and `release` default to `--isolate-worktree`. They record `HEAD`,
create an ephemeral detached worktree at `$TMPDIR/snapback-fastpath-*`, and
re-exec the ceremony there so bootstrap and qualification never run against
the invoking checkout. Success removes the worktree; failure leaves it and
prints the path. A dirty invoking tree is therefore not a refusal when isolate
is on — isolate is the paved path. `--no-isolate-worktree` restores the old
contract: `SNAPBACK_FASTPATH_DIRTY_TREE` is the first side-effecting check and
refuses before any publish, qualification, or bootstrap spawn. 0.1.20 later
shipped via the qualified ceremony, not this failed fast-path run.

### The gate: `scripts/publication-store-qualification-gate.mjs`

Fail-closed over staged tarball **bytes**, not over ledger metadata. For every
`@expo/snapback-runtime-*` row it opens the tarball and requires
`package/bin/packaged-store-qualification.receipt.json` with the v1 schema and
`single_table_v1`, a `binaryIdentity` matching the ledger revision and the
clean `release`/`public-package` build, and a `packageClosure` at the ledger's
own version. Codes:
`SNAPBACK_PUBLICATION_STORE_RECEIPT_MISSING`, `..._INVALID`,
`..._IDENTITY_DRIFTED`, `..._CLOSURE_DRIFTED`, `..._PLATFORM_INCOMPLETE`.
The same gate extracts each runtime package and validates its complete
`admin/` manifest and files as clean, at the ledger revision, and at the
runtime-readiness receipt revision. A missing, stale, dirty, mismatched, or
tampered console therefore refuses publication for either platform.
There is no environment opt-out; pass-one staging avoids the gate by not
invoking it. The same assertion now also guards
`scripts/snapback-publish.mjs --publish`, so the qualified lane and the fast
path refuse on identical grounds.

### The smoke: `scripts/published-closure-boot-smoke.mjs`

A byte-identity ledger cannot detect this class of failure; only running the
thing can. The smoke installs the **exact published versions** from the
registry into a temporary directory outside the repository, asserts the
installed runtime package carries a qualifying receipt, writes a minimal
backend whose generated artifact acknowledges `single_table_v1`, boots it
through the installed CLI — the CLI's `runtimeSpawnEnvironment` is what points
the runtime at both its sibling receipt and its sealed admin snapshot, so a
bare-binary boot would not discriminate — waits for readiness, fetches
`/_snapback/admin/`, and requires its bytes to equal the installed snapshot's
sealed `index.html` rather than the missing-dist diagnostic. It then requires
the served capability manifest to advertise `single_table_v1` before
`ensureApp` and one live query. Codes:
`SNAPBACK_PUBLISHED_SMOKE_INSTALL_FAILED`, `..._RECEIPT_ABSENT`,
`..._CODEGEN_FAILED`, `..._CAPABILITY_NOT_EXERCISED`, `..._BOOT_FAILED`,
`..._CAPABILITY_UNADVERTISED`.

`..._CAPABILITY_NOT_EXERCISED` is the one worth naming: if the generated
artifact stops requiring `single_table_v1`, the smoke fails rather than passing
vacuously. A green smoke that no longer tests anything is the failure mode that
would let this recur.

### Defence in depth

`installPackagedStoreQualificationReceipt` no longer returns a bare `null` when
it finds no receipt. It returns a discriminated result. Receipt absence remains
valid for `--native-artifact-staging`, which transports the pre-receipt native
closure, for `--source-test-staging` and contributor-source preparation, and
under the explicit qualification-pass-one
`SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS=1` override. These modes cannot derive
public-package `single_table_v1` authority from a receipt they do not carry.

A final assembly of a `public-package` binary — neither native-artifact nor
source-test staging — now requires the receipt and fails closed with
`SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INVALID` before the staged tree
can replace the previous assembly. This local manufacturing interlock joins,
rather than replaces, the authoritative publication gate over the bytes about
to leave the machine. The narrower fatal rule is required because 0.1.28
reached the registry receiptless and consequently withheld `single_table_v1`;
publish-time ceremony alone did not prevent that recurrence.

### 0.1.17 (2026-08-09) — the first cut under the gate, and what it caught

The eleven-package closure published fast-path from clean `main`
`0e6bf1842ab291f2e68416fbf40bd2e6debb4290` — the revision that introduced the
gate and the smoke, so the release repairing the 0.1.16 defect was itself the
first release the new machinery guarded. Retained ledger
`~/snapback-release-ledgers/fastpath-ledger-0.1.17-0e6bf1842a.json`, written
before the first `npm publish`; all eleven registry tarballs re-downloaded and
byte-identical to it. Both runtimes carry a receipt minted against the exact
pass-1 closure by running that platform's own packaged binary (darwin-arm64
locally, linux-x64 on `expo-build-1000` from a digest-verified copy of the same
closure), each suite 3 pass / 0 fail / 0 skip and each bound to
`0e6bf1842ab2` / clean / `release` / `public-package`.

**The ceremony refused to promote `latest` on its first run, and it was right
to.** All eleven published under the holding tag
`fastpath-0-1-17-0e6bf1842ab2` and byte-verified 11/11, then the post-publish
smoke failed and `latest` stayed on 0.1.15. The failure was a false alarm — npm's
read replicas still answered `ETARGET` for `@expo/snapback-cli@0.1.17` about
eight seconds after it was published — but the shape is exactly the intended
one: a closure that cannot be proved to run does not get the default tag.

Two ceremony defects follow, both fixed in the same landing:

1. The smoke installs by exact version, so it must wait for the registry read
   path to serve those versions. There is now a bounded propagation wait
   (`SNAPBACK_FASTPATH_REGISTRY_PROPAGATION_TIMEOUT`). Byte verification hits
   tarball URLs directly and passes while the packument is stale, so it cannot
   substitute for this wait.
2. Pass-2 staging ends in `npm publish --dry-run`, which npm refuses once the
   version exists — so a ceremony interrupted *after* publishing could never be
   resumed to promote `latest`. The release pass now reuses a pass-2 closure
   that binds the same exact version and source revision, and still runs the
   gate over the reused bytes.

Because landing those fixes dirties the tree and the ceremony refuses a dirty
tree, 0.1.17's own `latest` promotion was performed directly on the evidence the
ceremony had already produced. That is a one-time exception recorded here rather
than a precedent; the next cut promotes through the script.

## Amendment (2026-08-10): npm naming is settled on the `@expo` scope — author ruling

Ruled by the author (Charlie Cheever, 2026-08-10), recorded here because this
document owns packaging and publication naming (decision 9's terminal scope is
recorded in §Decision-9 terminal-scope migration).

**We are going with the `@expo` scope. The unscoped `snapback` npm name is not
pursued.** Verbatim in substance: the bare name is owned by a third party
(`snapback@0.9.0`, a DOM undo/redo library, maintainer `lohfu`); it cannot be
acquired on a fast timeline; and having *expo* in the name is good, not a
compromise.

This closes the naming question rather than deferring it. Three consequences
follow:

- **`@expo/snapback-*` is terminal and final.** §Package boundaries'
  anticipated "a future organization-owned brand scope may replace only the
  public alias" clause — already narrowed by decision 9, which renamed
  authored imports too — is now fully discharged: the terminal scope *is* the
  brand scope, and no further rename is planned or reserved.
- **No name claim, no bin shim, no ticket.** Acquiring the unscoped name,
  negotiating for it, or publishing a same-named shim package are all out of
  scope, permanently and not just for the release at hand. The closed
  guide-gap ticket
  `issues/closed/20260809-guide-gap-npx-snapback-new-resolves-wrong-package.md`
  explicitly deferred exactly this registry/ownership question to "its own
  ticket and its own owner"; that ticket is now answered in the negative and
  will not be opened.
- **`npx snapback` failing in an empty directory is a permanent fact of the
  world, and documentation owns the mitigation.** The bare `snapback` bin
  stays correct only inside a project that already depends on
  `@expo/snapback-cli`. Fresh-app instructions must carry their own package
  identity (`npm create snapback-app my-app`, or the explicitly scoped
  `npx --yes @expo/snapback-cli@latest new my-app --template expo-chat`), which
  is what `guide/clients/react-expo.md` says today and what
  `checkBootstrapResolvability` in `scripts/guide-lib.mjs` enforces. Neither
  the guide text nor that check should be softened in anticipation of ever
  owning the bare name.

Unchanged by this ruling: the in-project bin name is still `snapback`; the
source/import dialect is the same `@expo/snapback-*` names (no third dialect
returns); and the recorded `@ccheever/snapback-*` publication lineage stays
read-side valid per §Decision-9 terminal-scope migration.

## 0.1.18 (2026-08-11): the first completed qualified ceremony

The 0.1.18 closure is the first release to complete the **full qualified
ceremony** — every prior published closure either predated the ceremony
(≤ 0.1.7, the last `newestQualified` until now), shipped via the fast path
(0.1.8–0.1.13, 0.1.15–0.1.17), or was refused at promotion and rolled back
(0.1.14, the ICU refusal recorded above). All eleven packages'
`latest` now points at 0.1.18, and `guide/published-closure.json` records
`newestQualified: 0.1.18` for the first time since 0.1.7.

**The record.** Candidate revision `2d28570daa14`, frozen on
`release/qualified-0.1.18` (not an ancestor of `main`; `main` had moved on
before the ceremony finished — the fences that landed after the freeze stayed
honest as `0.1.19 unreleased`). Staged qualification ran on EAS
(`qualified-package-staging.yml@2d28570daa14`, run
`019fed99-00d6-71d4-92c3-27dd7b738664`, 8/8 green) and produced
per-platform staged receipts **with EAS provenance** (`easProof`: build id,
project id, workflow ref pinned to the candidate revision), sha256-pinned
into the committed candidate ledger
(`tests/acceptance/publication/candidate-0.1.18.json`). Both staged receipts
prove the cold-install legs end to end, including
`packedExpoChatScaffoldTypecheckStaticAndLiveAcceptance` and
`packedCreateSnapbackAppScaffoldFromCleanDirectory`. The leased promotion
closed as operation `release-0.1.18-20260811-r12` at publication epoch 15:
status `promoted-and-closed`, all eleven tag events ok, the
`promoted-installability-barrier.v2` passed, and the post-promotion hosted
proof (GitHub run 31449958810 and successor 31451683450) launched the
published closure on stock GitHub-hosted runners on both platforms against
the live `latest` vector, its latest-root receipts bound into the promotion
finalization via the authorized lease sha256. The promotion receipt and the
`snapback.package-post-promotion-ledger.v2` are retained at
`tests/acceptance/publication/promotion-receipt-0.1.18.json` and
`post-promotion-ledger-0.1.18.json` — the first ceremony's receipts are
historically significant.

**Twelve attempts (r1–r12, epochs 4–15).** The promotion lane refused eleven
times before it passed, and each refusal was a real defect in the lane, not
in the closure. The defect classes fixed along the way, so the next operator
inherits none of them:

- **Lease clock skew** — lease validity compared against the publisher's
  wall clock; skew between authority and publisher invalidated a live lease.
- **Budget double-reservation** — a retried acquisition reserved promotion
  budget twice, exhausting the epoch's allowance on its own retry.
- **Run-correlation quiet-main assumption** — correlating the hosted proof
  run to the candidate assumed no concurrent `main` pushes; the fleet's
  continuous landing rate falsified it (the standing CLAUDE.md warning about
  quiet-`main` designs, proven again).
- **Unpassable `run.path` clause** — a proof-plan clause unsatisfiable since
  2026-07-28 meant no run could ever have passed it; it had never been
  exercised until the first real ceremony reached it.
- **Self-hosted runner receipts** — receipts minted on self-hosted runners
  were refused; the proof must run github-hosted to model a consumer.
- **GH timestamp precision** — GitHub API timestamps truncate to seconds;
  strict ordering comparisons flapped on same-second events.
- **Authority autostop cold-start** — the Fly authority autostopping between
  attempts made each reopen revalidate the full epoch history from the
  volume, adding cold-start latency per attempt.

**Standing operational facts** for the next ceremony operator:

- The publication authority now runs with **autostop=off**. Reopen
  revalidation cost grows with the epoch count (the volume currently holds
  all 15 epochs), so letting the machine stop between attempts makes every
  retry slower than the last; keep it running for the ceremony's duration.
- The promotion runs **from the release branch checkout**, not `main` — the
  telemetry-currentness gate binds the receipt to the frozen candidate
  revision, and `main` has always moved by promotion time.
- The hosted-proof dispatch targets the **release-branch ref**, for the same
  reason: the workflow file and the proof harness must be the candidate's.

## 0.1.19 (2026-08-11): qualified closure and fail-closed retry record

All eleven packages were published from frozen source revision
`74eeaead1410e74ba1abe86ac7432b6aea3c3bff` under holding tag
`bakeoff-0-1-19-74eeaead1410`, then promoted together by operation
`release-0.1.19-20260811-r3` at publication epoch 18. The final hosted public
install proof is GitHub Actions run 31513524295; both darwin-arm64 and
linux-x64 passed against the live `latest` vector. The post-promotion ledger
and promotion receipt are retained under `tests/acceptance/publication/`.

Two earlier leased attempts failed closed and restored the complete 0.1.18
vector. Epoch 16 exhausted its hosted-proof wait budget after macOS runner
queueing; both platform jobs later completed green. Epoch 17 completed both
platform jobs green but hit a transient local TLS trust error while downloading
one GitHub artifact. A direct retry of the same artifact path succeeded, and
epoch 18 completed the identical package-owned proof, artifact validation, and
authority close. These are conclusively proof-transport/capacity failures, not
package failures.

The exact staging run also exposed a retention-only workflow omission: the
final `qualified_release` job invoked the checked-in retention helper without
checking out the repository. The independently downloaded immutable tarballs
and both staged receipts were retained with that same helper for this release;
the workflow now checks out before invoking it, with a structural regression
assertion. No gate or publication-authority bypass was used.
