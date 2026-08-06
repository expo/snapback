---
title: Local instance forks
id: operating.instance-forks
order: 7
audience: agent-first
capabilities: [operating.instance-forks]
authorities: [llp/0158-instance-forking.rfc.md, src/cli.rs, src/instance_fork.rs, demos/_kit/instance-fork.mjs]
examples: [demos/todo/tests/acceptance/forked-parent.mjs, tests/instance_fork_cli_v1.rs, tests/acceptance/instance-fork-fleet-dogfood.2026-08-03.v1.json]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-05
reviewed-commit: HEAD
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

This is a **partial, unpublished surface**. The local design in
[LLP 0158](repo:llp/0158-instance-forking.rfc.md) was Accepted on 2026-08-06,
but the separate
`agent_safe_derived_deployment_fork_v1` qualification and publication gates
remain unsatisfied and its public tuple remains wholly `Missing`. The guide
teaches the implemented source workflow; it does not claim a packaged, hosted,
promotable, or process-sandboxed capability.

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
  `data.resourceAdmission`; the creation TTL itself is bounded by the same
  maximum total fork lifetime that caps renewal;
- takes a consistent local snapshot and records the exact fork point;
- scrubs copied sessions, agent credentials, and operational claims;
- rotates authorization and data-stream identities and mints fresh sidecars;
- loads the schema and functions generated in `--app-root`;
- boots cron, durable jobs, and asset maintenance inert;
- applies fail-closed `deny-all-v1` host egress; and
- records a finite expiry in the fork-root lifecycle registry; and
- starts a server that refuses boot after expiry and checks its expiry while
  serving.

Use a shared, explicit fork root when several worktrees derive from one
parent. Each `fork create` chooses a UUID-named direct child by default, so
worktrees do not share a database or port. Keep `--app-root` pointed at each
worktree: that is what lets two forks preserve the same parent rows while
loading different function bundles.

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
re-reads the renewed expiry at its old deadline and keeps serving.

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
| `SNAPBACK_FORK_PUBLICATION_PARTIAL` | Run `fork recover` on the exact sentinel-bearing destination before boot. |
| `SNAPBACK_FORK_QUARANTINED` | Treat the database as non-bootable; recover its managed publication rather than clearing stamps by hand. |
| `SNAPBACK_FORK_LINEAGE_INVALID` | Stop. Do not trust or delete the target until its local lineage provenance is understood. |
| `SNAPBACK_FORK_SIDECAR_MISSING` / `SNAPBACK_FORK_SIDECAR_MALFORMED` | Do not reuse parent credentials or invent replacements; recover if publication is partial, otherwise recreate the fork. |
| `SNAPBACK_FORK_REGISTRY_STALE` | Treat the registry as advisory and inspect the named exact path; never recursively sweep based only on the row. |
| `SNAPBACK_FORK_STOP_UNVERIFIED` | Resolve the missing/stale ready descriptor or live PID; Snapback intentionally will not signal or delete an unproved target. |
| `SNAPBACK_FORK_EXPIRED_REAP_FAILED` | Inspect the reported expired targets and restore enough evidence to stop/reap them safely before retrying create. |
| `SNAPBACK_FORK_SERVER_EXPIRED` | Expected finite-TTL enforcement: use `create` or explicit `reap` to prove the stopped process and remove the fork, or `renew` **before** expiry to extend it. |
| `SNAPBACK_FORK_RENEW_EXPIRED` | Renewal never resurrects: the fork is already past expiry — reap it and create a fresh fork. |
| `SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` | A configured bound refused deterministically; the details name the resource (`fork-count`, `fork-bytes`, `total-bytes`, `diff-work`, `renewal-lifetime`) and the observed usage. Drop forks, raise the explicit flag, or bound the request. |

## Read the diff at its real boundary

The diff receipt covers committed **application-row journal entries after the
fork point**, in commit order. It explicitly omits:

- auth and credential state;
- asset blob operations;
- captured or refused egress payloads;
- privileged or raw-SQL writes outside the app journal; and
- sidecars and telemetry.

For an exact net base-to-head receipt, create the fork with
`--retain-base` (a digest-bound immutable snapshot; doubles the fork's byte
footprint, and admission accounts for it) and run `fork diff FORK_ID --net`.
The `snapback.fork-net-diff.v1` receipt is computed by comparing the
retained base against the head directly — independent of the journal — with
pre- and post-images, a named substrate (`retained-base-v1`) and
completeness class (`journal-enumerated-v1`), and machine-readable covered/
omitted domains. Within journal retention every net change is cross-checked
against the journal; a change the journal cannot explain refuses with
`SNAPBACK_FORK_DIFF_ORACLE_MISMATCH` instead of lending it cover. Without a
retained base, `--net` refuses with `SNAPBACK_FORK_NET_DIFF_UNAVAILABLE`.

The attributed receipt is a review aid, not a complete audit and not
production migration admission. A long-lived fork can also outlive its journal floor; then diff
refuses instead of returning an incomplete receipt. The attributed span is
also work-bounded: past `--max-rows` (default 100k) diff refuses with
`SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` and the observed row count instead of
materializing an unbounded receipt. Use the reviewed migration rehearsal flow
for production apply decisions.

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
- There is no hosted fork contract or packaged capability advertisement yet.

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
