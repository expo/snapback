---
title: Local instance forks
id: operating.instance-forks
order: 7
audience: agent-first
capabilities: [operating.instance-forks]
authorities: [llp/0158-instance-forking.rfc.md, crates/snapback-cli/src/cli.rs, crates/snapback/src/instance_fork.rs, demos/_kit/instance-fork.mjs]
examples: [demos/todo/tests/acceptance/forked-parent.mjs, crates/snapback/tests/instance_fork_cli_v1.rs, tests/acceptance/instance-fork-fleet-dogfood.2026-08-03.v1.json]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-06
reviewed-authorities-digest: sha256:e111ece9828fd85ebb3493ac42dc0901b77a579a80c5f9287b74c89b673db916
---

# Local instance forks

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The source CLI can give one worktree a finite-lived, independent backend that
starts from a consistent copy of an existing file-backed local app. Use it for
schema- or function-divergent development against realistic rows. The fork has
the same logical `appId`, but fresh instance, authorization-stream,
data-stream, admin-token, and resume-keyring identities.

This is a **partial contributor-source local surface**, published for exactly
the two measured release platforms, `macos/aarch64` and `linux/x86_64`, by the
[source anchor](repo:crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json)
and its
[dated digest-bound receipt](repo:tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json).
The claim is a qualification-C snapshot under LLP 0189 scoped-digest custody:
post-C evolution of scoped source stays explicit as
`PUBLISHED_REQUALIFICATION_DUE` until the next natural cycle, while any
inconsistency in the frozen scope, digest, evidence, review, or acceptance
chain refuses publication. The separate
`agent_safe_derived_deployment_fork_v1` target-manifest tuple remains wholly
`Missing` by the author's ruling; the capability-index row is the narrow claim
carrier. The guide teaches the implemented source-checkout workflow.
Released-binary/npm parity and the Phase 6 normal-installation exit remain
open. This claim includes no public package, hosted/Cloudflare/remote target,
promotion or merge-back, or process sandbox.

## Give a worktree its own backend

Bootstrap this checkout first so `target/debug/snapback` is the qualified
binary for these exact source bytes. A parent may be a cold SQLite database or
a live server's ready file. Run creation from the worktree whose generated
schema and functions the fork should load:

```sh
scripts/bootstrap-ibex-runtime
target/debug/snapback fork create \
  --from /absolute/path/to/parent.ready.json \
  --ttl 2h \
  --app-root "$PWD" \
  --fork-root /absolute/path/to/shared-fork-root
```

The default JSON `hostOpsResult` contains `data.readyFile`, `data.database`,
`data.receipt.lineage.forkId`, and the effective `serverUrl`. Treat the ready
file as the connection handoff. Do not infer a port, reuse the parent's admin
token, or discover a database by scanning directories. For a shell that needs
exactly one value, add `--format url`, `fork-id`, `database-path`,
`ready-path`, or `admin-token-path`; JSON remains the primary automation
contract.

The fork operation does all of these before it returns:

- sweeps already-expired, safely verifiable forks in the selected fork root,
  completes any stale registry bookkeeping whose fork directory is already
  gone (reported as `data.automaticReap.clearedStaleRegistryIds`), or refuses
  creation if any expired target cannot be proved safe to remove;
- checks resource admission and refuses deterministically with
  `SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` when the managed fork count, the
  source database's estimated bytes, or the fork root's total byte budget
  would exceed the configured limits (`--max-forks`, `--max-fork-bytes`,
  `--max-total-bytes`), reporting the admitted usage as
  `data.resourceAdmission`; a fork-root lock keeps the count/byte observation,
  registry intent, and publication one atomic admission interval even when
  creates race at a boundary; lock acquisition has a 30-second monotonic
  deadline and refuses with `SNAPBACK_FORK_ADMISSION_TIMEOUT` rather than
  waiting without bound; the creation TTL itself is bounded by the same maximum
  total fork lifetime that caps renewal;
- treats those byte checks as admission-time estimates, not a live disk
  quota: fork-local writes and uploads can grow after creation until finite
  TTL/reap cleanup, so use a filesystem/container quota when runtime growth
  itself must be contained;
- takes a consistent local snapshot and records the exact fork point;
- records the canonical invoking app root plus logical app id in registry and
  fork-local digest-bound evidence before publication, independently of
  whether a server is ever launched;
- scrubs copied sessions, agent credentials, and operational claims;
- rotates authorization and data-stream identities and mints fresh sidecars;
- when both generated manifests exist, admits the complete schema/function
  pair through an owner-only fork-local cold-start carrier, then arms the
  derived fork's generated-writer/SQLite-authorizer app-row coverage before
  listener bind; `data.writerCoverageReceipt` names the fork-point-bound
  manifest;
- preserves the historical post-bind schema/function loader only for a
  partial dev-manifest layout; that path returns
  `data.writerCoverageReceipt: null` and makes no whole-window coverage claim;
- boots cron, durable jobs, and asset maintenance inert;
- applies fail-closed `deny-all-v1` host egress; and
- records a finite expiry in the fork-root lifecycle registry; and
- starts a server that refuses boot after expiry and checks its expiry while
  serving.

Use a shared, explicit fork root when several worktrees derive from one
parent. Each `fork create` chooses a UUID-named direct child by default, so
worktrees do not share a database or port. Keep `--app-root` pointed at each
worktree: create records its canonical path and logical app id in registry and
fork-local digest-bound evidence. Every list, inspect, diff, renew, drop, reap,
and recover selection rechecks that identity before projecting paths or
credentials or mutating state. Consequently, even two worktrees with the same
`appId` cannot select one another through a shared `--fork-root`; a legacy row
without this binding fails closed rather than acting as a wildcard.

Library callers have the same contract without a launch step. Establish or
load the app root with `ensure_expected_app(app_root, app_id)` or
`load_expected_app(app_root)`, then pass the returned opaque
`ExpectedForkAppV1` to `publish_managed` or
`publish_managed_with_base`. Those APIs revalidate the canonical app-root
identity and persist it during mint; they never infer authority from the
destination's parent fork root. A fork minted this way can be inspected or
diffed immediately with the owning CLI `--app-root`. The low-level `publish`
crash-corpus primitive is deliberately unmanaged and cannot be selected by
managed lifecycle commands.

That root identity is a deliberate one-app pin. If a worktree must change to a
different logical app id, first use its current identity to list and drop (or
reap) every managed fork it owns. Then remove only
`.snapback/instance-fork-app-identity.v1.json`; the next `fork create` records
the new app id. Do not remove the identity while owned forks remain: doing so
makes them fail closed under managed lifecycle commands and does not transfer
their authority to the new app id.

## Fork instead of seeding an acceptance suite

Suites using `openHeadlessApp` opt in with `forkFrom`. The ordinary call still
starts a blank in-memory server and installs the demo seed. The fork-aware call
preserves parent rows, loads the current worktree's generated artifacts, and
makes `close()` perform an exact registry-bound `fork drop`:

```js source=demos/todo/tests/acceptance/forked-parent.mjs
  const app = await openHeadlessApp(import.meta.url, {
    appId: 'todo',
    forkFrom: parentDb,
    forkRoot,
    forkTtl: '10m',
    serverBinary,
  });
  cleanups.push(() => app.close());
```

Register `close()` with the shared acceptance cleanup stack immediately. The
finite TTL is an automatically enforced backstop for interruption, not a
substitute for attested test cleanup. Do not pass a seed on the fork path:
replacing realistic parent state would defeat the option's purpose.

After the suite writes, retain the bounded review receipt before cleanup:

```js source=demos/todo/tests/acceptance/forked-parent.mjs
    const receipt = await app.fork.diff();
    assertEqual(receipt.rows.length, 1, 'one fork-only app-row mutation');
    assertEqual(receipt.rows[0].postImage.title, forkOnlyTitle, 'diff post-image');
    assert(receipt.omissions.includes('auth and credential state'), 'diff must retain explicit omissions');
```

`app.fork.createEnvelope` retains the creation facts, including worker,
egress, secret, expiry, and lineage posture. `app.fork.diff()` returns the
journal-derived app-row receipt. The maintained Todo proof starts from a
parent-only edge-case row, mutates the fork, checks the receipt, and verifies
the live parent never sees the fork-only row.

## Own forks per worktree, per agent run, and per suite lane

The acceptance kit layers deterministic ownership over the CLI lifecycle
(`demos/_kit/instance-fork.mjs`). `startWorktreeFork` binds a fork to the
exact canonical git-worktree toplevel; `startAgentFork` binds one to an
explicit `ownerId`/`runId` pair. Both write a non-secret
`snapback.fork-owner.v1` record into the fork directory and return
shell-friendly `envExports` (fork id, URL, ready path). Discovery and
cleanup then bind to that exact recorded identity — never a guessed
directory — and every deletion still goes through registry-bound
`fork drop`:

```js fragment reason="illustrative composition; the CI-verified consumer is demos/todo/tests/acceptance/fork-parallel-dispositions.mjs"
import {
  startAgentFork, discoverOwnedForks, dropOwnedForks,
} from './demos/_kit/instance-fork.mjs';

const fork = await startAgentFork({
  ownerId: 'my-fleet-lane', runId: process.env.RUN_ID,
  from: parentDb, appRoot, repoRoot, forkRoot, ttl: '30m',
});
// … if this run dies without fork.stop(), a later sweep cleans up exactly:
await dropOwnedForks({ repoRoot, appRoot, forkRoot,
  match: { ownerId: 'my-fleet-lane', runId: process.env.RUN_ID } });
```

Parallel suites share one expensive prepared parent while each lane gets an
isolated derived instance on its own OS-assigned port. An interrupted run
settles into one of three named dispositions, each CI-proven in
`demos/todo/tests/acceptance/fork-parallel-dispositions.mjs`: a fully
cleaned state; an unexpired orphan swept later by its exact owner/run
record; or a quarantined incomplete publication repaired through
`fork recover`. Automatic reap separately handles the fourth shape — an
expired fork nobody swept.

## Inspect, review, and dispose forks

`list` is the deliberately advisory registry projection. Safety-sensitive
`inspect`, `diff`, `drop`, and `reap` re-bind each selected entry to the fork's
local lineage, mint receipt, database, and ready descriptor before reading,
signalling, or deleting anything:

```sh
target/debug/snapback fork list \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root

target/debug/snapback fork inspect "$FORK_ID" \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root

target/debug/snapback fork diff "$FORK_ID" \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root \
  --out /absolute/path/to/fork-diff.json

target/debug/snapback fork renew "$FORK_ID" --ttl 2h \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root

target/debug/snapback fork drop "$FORK_ID" \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root

target/debug/snapback fork reap --now-ms "$PORTABLE_NOW_MS" \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root
```

`inspect` is the bounded status projection: fork and parent identity, fork
point and expiry, process health, database/ready/admin-token paths,
scrubbed-or-copied secret disposition, inert cron/jobs/assets posture,
`deny-all-v1` egress, and a diff count/coverage summary without full rows. Its
five `--format` scalar values match `create`, so a script can write, for
example, `FORK_URL=$(... fork inspect "$FORK_ID" --format url ...)` without
parsing display text.

`renew` extends one fork's finite expiry from now by `--ttl`, bounded by a
configured maximum total lifetime from creation. It re-binds the exact
registry identity first, refuses to shorten or clear the expiry, refuses an
already-expired fork outright (`SNAPBACK_FORK_RENEW_EXPIRED` — reap and
recreate instead), and emits a durable `snapback.fork-renew.v1` receipt both
in the envelope and beside the fork database. A renewal that crashes mid-way
is completed by `fork recover` from its durable intent; a running fork server
re-reads the renewed expiry at its old deadline and keeps serving. On an armed
fork the lifecycle token permits the exact checkpoint before the lineage
transaction. An ordinary later failure compensates database lineage, mint
receipt, and registry to the previous expiry and refuses cleanly; an injected
or real crash preserves the sentinel/intent so `fork recover` can finish the
same sequence.

`drop` stops and removes exactly one verified fork; concurrent drop/reap of
the same fork settles with one winner and `SNAPBACK_FORK_NOT_FOUND` for the
rest, never a torn teardown. Explicit `reap` is a deterministic test and
operations surface: the caller supplies a portable millisecond clock and the
command removes only verified forks whose finite expiry is at or before that
clock, and additionally completes stale registry entries whose fork
directory is already gone (`data.clearedStaleRegistryIds`). `list` binds
every entry it can and reports the rest under `data.unboundRegistry` with
warning diagnostics instead of failing wholesale; it also projects
`data.resourceUsage` (fork count, total bytes, default limits). Normal
creation needs no injected clock: it uses the system clock to sweep the same
fork-root scope first and reports the reaped IDs in `data.automaticReap`. If
that sweep cannot safely remove every expired fork, creation fails closed
with `SNAPBACK_FORK_EXPIRED_REAP_FAILED`.

A derived server independently reads its recorded expiry. It refuses an
already-expired boot, then checks at least once per second while serving and
exits with `SNAPBACK_FORK_SERVER_EXPIRED` when the deadline arrives. That
expiry exit deliberately retains the non-secret ready descriptor: a later
`create`, `drop`, or `reap` can bind the recorded PID to the exact fork and
prove it gone before deleting storage. Nested forks are refused in local v1.

## Recover interrupted publication

Creation publishes through private staging and an advisory registry. If a
crash leaves an incomplete direct child, recover by its exact destination —
not by scanning a root or trusting a possibly stale registry row:

```sh
target/debug/snapback fork recover /absolute/path/to/shared-fork-root/FORK_UUID \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root
```

For pre-publication S0–S3 state, recovery removes disposable staging and
best-effort registry intent. For a published-but-unreconciled S4 destination,
it verifies local database lineage and minted evidence, reconciles the
registry when possible, and removes the publication sentinel. The JSON result
identifies the recovery disposition and registry outcome. Registry repair is
advisory: complete local evidence governs boot safety. The command refuses
unbounded lineage and does not start a process; after recovery, inspect or
dispose the repaired managed state explicitly.

## Act on fork diagnostics

Fork failures use stable `SNAPBACK_FORK_*` codes. Preserve the code and
details object in automation; the message is for people.

| Diagnostic | Action |
| --- | --- |
| `SNAPBACK_FORK_APP_BINDING_MISMATCH` | The selected fork belongs to another canonical app root or logical app identity, or the invoking app-root identity was replaced after it was loaded. Invoke from the owning `--app-root`; library callers should reload the opaque identity; never use the shared fork root as authority. |
| `SNAPBACK_FORK_APP_BINDING_REQUIRED` | The entry predates mint-time app binding, came from the unmanaged low-level primitive, or lost that evidence. It is deliberately unselectable; a managed fork does not enter this class merely because it was never launched. Legacy bytes still count against root admission. Stop and identify the exact legacy process/directory from independent provenance, then remove only that UUID's registry row and direct-child directory out of band; there is no wildcard/recursive unbound reap. |
| `SNAPBACK_FORK_PUBLICATION_PARTIAL` | Run `fork recover` on the exact sentinel-bearing destination before boot. |
| `SNAPBACK_FORK_QUARANTINED` | Treat the database as non-bootable; recover its managed publication rather than clearing stamps by hand. |
| `SNAPBACK_FORK_LINEAGE_INVALID` | Stop. Do not trust or delete the target until its local lineage provenance is understood. |
| `SNAPBACK_FORK_SIDECAR_MISSING` / `SNAPBACK_FORK_SIDECAR_MALFORMED` | Do not reuse parent credentials or invent replacements; recover if publication is partial, otherwise recreate the fork. |
| `SNAPBACK_FORK_REGISTRY_STALE` | Treat the registry as advisory and inspect the named exact path; never recursively sweep based only on the row. |
| `SNAPBACK_FORK_STOP_UNVERIFIED` | Resolve the missing/stale ready descriptor or live PID; Snapback intentionally will not signal or delete an unproved target. |
| `SNAPBACK_FORK_EXPIRED_REAP_FAILED` | Inspect the reported expired targets and restore enough evidence to stop/reap them safely before retrying create. |
| `SNAPBACK_FORK_ADMISSION_TIMEOUT` | Another creator did not finish its atomic admission/publication interval within 30 seconds. Inspect that creator and its exact staging/publication state; retry only after it exits or recovery resolves its destination. |
| `SNAPBACK_FORK_SERVER_EXPIRED` | Expected finite-TTL enforcement: use `create` or explicit `reap` to prove the stopped process and remove the fork, or `renew` **before** expiry to extend it. |
| `SNAPBACK_FORK_RENEW_EXPIRED` | Renewal never resurrects: the fork is already past expiry — reap it and create a fresh fork. |
| `SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` | A configured bound refused deterministically; the details name the resource (`fork-count`, `fork-bytes`, `total-bytes`, `diff-work`, `renewal-lifetime`) and the observed usage. Net diff additionally reports its streaming `phase`, `limitKind`, journal/scanned rows, and bytes. Drop forks, raise the explicit flag, or bound the request. |
| `SNAPBACK_FORK_WRITER_COVERAGE_INVALID` | Do not treat the fork as whole-window covered. Its durable fork-point receipt is partial, tampered, late, or no longer matches the active stream/manifest; recreate it through `fork create`. |
| `SNAPBACK_FORK_WRITER_COVERAGE_GAP` | A registered writer observed a missing or contradictory boundary after coverage had armed. Snapback records the discontinuity in the database and `fork-app-row-coverage-gap.v1.json`; restoring a manifest cannot regain the class. Recreate the fork. |

## Read the diff at its real boundary

The default `snapback.fork-journal-diff.v3` receipt covers committed
**application-row journal entries in `(base, head]`**, in commit order. Its
stream-qualified `base` and `head` identify the data-version stream, commit
version, and exclusive/inclusive boundary. It says
`attribution: "absent-v1"`: row `operation` is insert/update/delete, not an LLP
0163 operation or principal identity. It explicitly omits:

- auth and credential state;
- asset blob operations;
- captured or refused egress payloads;
- privileged or raw-SQL writes outside the app journal; and
- sidecars and telemetry.

For an exact net base-to-head receipt, create the fork with
`--retain-base` (a digest-bound immutable snapshot; doubles the fork's byte
footprint, and admission accounts for it) and run `fork diff FORK_ID --net`.
The `snapback.fork-net-diff.v3` receipt is computed by comparing the
retained base against the head directly — independent of the journal — with
pre- and post-images, a named substrate (`retained-base-v1`) and
machine-readable covered/omitted domains. Both v3 receipt types carry
`receiptDigest`, a domain-separated SHA-256 digest over the JCS-canonical form
of every other emitted fact, so approval can bind the exact receipt. To verify
one, remove the top-level `receiptDigest`, serialize the remaining object with
JCS, prefix those bytes with
`snapback:fork-journal-diff-receipt:v3\n` or
`snapback:fork-net-diff-receipt:v3\n` according to `schemaVersion`, compute
SHA-256 over the concatenation, and compare the lowercase
`sha256:<64-hex>` spelling. A fork
created through the complete cold-start carrier path can advertise
`registered-connection-defensive-app-rows-v1` only
when its digest-bound coverage receipt proves the two app-row writer lanes
were armed at the fork point and the journal cross-check verifies through the
observed head. The active manifest and its per-stream continuity row are
protected carriers. Every registered writable connection must reconstruct the
matching database/file receipts, stream, manifest, and `continuous` row before
receiving a token. If one observes a gap, the continuity row becomes `broken`
and the sibling gap file is created; neither can be re-armed or erased by an
exact manifest restore. A partial generated layout remains
`journal-enumerated-v1` because its historical schema load occurs after bind.
Read
`writerCoverage.coverageWindow`, `manifestDigest`, `coveredLanes`, and
`uncoveredLanes` as separate facts. Uncovered app-effective writer families
are refused while the profile is armed; all non-app-row domains remain omitted.
The covered lane names are `derivedForkOrdinaryAppRowJournal` and
`derivedForkHostChildAppRowJournal`. They name the fork's generated-writer plus
journal boundary, not LLP 0163 operation-envelope coverage.
The receipt also says `attribution: "absent-v1"`: operation attribution is not
implemented by this net view. Any other unarmed or late-armed fork and a
retention gap remain `journal-enumerated-v1`. A change the journal cannot explain refuses
with `SNAPBACK_FORK_DIFF_ORACLE_MISMATCH`; on the armed path, the same refusal
applies when a row's latest journal post-image disagrees with the independently
scanned head. Static receipt/fork-point contradictions refuse with
`SNAPBACK_FORK_WRITER_COVERAGE_INVALID`; a discontinuity observed by a
registered writer refuses with `SNAPBACK_FORK_WRITER_COVERAGE_GAP`, instead of
lending either condition cover. Without a retained base, `--net` refuses with
`SNAPBACK_FORK_NET_DIFF_UNAVAILABLE`.

The journal receipt is a review aid, not a complete audit and not production
migration admission. A long-lived fork can also outlive its journal floor;
then diff refuses instead of returning an incomplete receipt. The default
journal receipt pre-counts and bounds rows before materialization; it does not
have a byte-work budget. Net diff separately bounds journal rows, base/head
scanned rows, WAL validation bytes, and streamed bytes. Before converting a
scanned row to an owned document, it charges borrowed SQLite value lengths for
text escaping, blob hex expansion, JSON parsing, vector decoding, and bounded
serialization, so one oversized value refuses before proportional expansion.
Past `--max-rows` (default 100k), or past the fixed byte budget on net diff,
the operation refuses with
`SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` and observed usage instead of
materializing an unbounded receipt. Use the
[reviewed migration rehearsal flow](../backend/migrations.md#rehearse-against-a-restore-derived-instance)
for production apply decisions.

The upgraded completeness class covers only Snapback-registered writable
connections with verified SQLite defensive mode and the shared default-deny
authorizer. The net receipt validates the raw WAL header and cumulative frame
checksums within its byte budget and detects/refuses ordinary raw WAL/app-row
divergence and direct page corruption, but it is not an OS/file-integrity
boundary. A same-user
process that bypasses the connection factory and coherently forges app data,
the version, and a matching journal entry is outside the claim; use an
OS/container/filesystem authority boundary for that threat.

## Know what the quarantine does not promise

- Local forks protect the parent from actions routed through the fork's
  runtime. They do not contain a malicious same-user process that can open the
  parent's files or make its own network calls; that requires an OS/container
  boundary.
- **Workloads containing arbitrary native code need an OS isolation boundary
  you provide.** The fork's `deny-all-v1` gate mediates Snapback-owned egress
  and custody surfaces only. If the app under test loads native modules,
  shells out, or executes untrusted code, run the fork server inside an OS
  containment tier — a dedicated OS user, a container (the fork directory and
  ready file are self-contained and bind-mountable), or a VM — and treat the
  fork root as inside that boundary. Snapback does not ship an integrated
  sandbox tier today; if one is added later it will be advertised as a
  separate containment tier, not folded into the runtime quarantine claim.
- The default is secret scrubbing. `--with-secrets` is an explicit high-risk
  opt-in for the config-secret sibling; it does not weaken credential minting
  or egress denial.
- Asset-bearing parents fork with **same-cut fork-private custody**: every
  blob the metadata cut names is copied into the fork's own store,
  digest- and length-verified, or publication refuses
  (`SNAPBACK_FORK_ASSET_CUT_INCOMPLETE`) — never a metadata-only success.
  Unknown stores and digest algorithms fail closed
  (`SNAPBACK_FORK_ASSET_CUT_UNSUPPORTED`); parent-signed URLs never
  validate in the fork (fresh signing keys); creation admission counts the
  blob tree in the fork's byte estimate; `create`/`inspect` report the
  custody fact (`fork-private-same-cut` or `no-assets`).
- Manual cron tick and forced job-drain routes refuse in a fork under the
  deny-all posture; autonomous workers are also inert.
- There is no fork promotion or merge-back. Move conclusions or app-level
  changes, not fork storage, into the parent.
- There is no current derived-fork capability publication, hosted fork
  contract, released-binary/npm parity, normal-installation proof, or
  public-package claim. The withdrawn publication and required
  requalification are tracked in
  [`issues/closed/20260807-derived-fork-publication-wave-drift-requalification.md`](repo:issues/closed/20260807-derived-fork-publication-wave-drift-requalification.md).

## Anti-patterns

- **Do not copy SQLite and boot it by hand.** That bypasses credential
  scrub-and-mint, publication crash safety, fresh sidecars, and quarantine.
- **Do not share one fork across worktrees.** One worktree, one ready file, one
  finite-TTL fork keeps code, data, and cleanup ownership aligned.
- **Do not hand-kill a recorded PID or recursively delete a fork root.** Use
  `fork drop` or injected-clock `fork reap`; both prove the exact target first.
- **Do not present a diff receipt as “everything the agent did.”** Preserve its
  coverage and omissions wherever the receipt is reviewed or aggregated.
- **Do not enable secrets or external effects just to make a test pass.** Use
  deterministic provider doubles, or keep the missing external behavior an
  explicit acceptance nonclaim.
