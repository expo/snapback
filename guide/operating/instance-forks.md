---
title: Local instance forks
id: operating.instance-forks
order: 7
audience: agent-first
capabilities: [operating.instance-forks]
authorities: [llp/0158-instance-forking.rfc.md, src/cli.rs, src/instance_fork.rs, demos/_kit/instance-fork.mjs]
examples: [demos/todo/tests/acceptance/forked-parent.mjs, tests/acceptance/instance-fork-fleet-dogfood.2026-08-03.v1.json]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-04
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

This is a **partial, unpublished surface** while
[LLP 0158](repo:llp/0158-instance-forking.rfc.md) remains Draft. The guide
teaches the implemented source workflow; it does not claim a packaged,
hosted, promotable, or process-sandboxed capability.

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

The JSON `hostOpsResult` contains `data.readyFile`, `data.database`,
`data.receipt.lineage.forkId`, and the effective `serverUrl`. Treat the ready
file as the connection handoff. Do not infer a port, reuse the parent's admin
token, or discover a database by scanning directories.

The fork operation does all of these before it returns:

- takes a consistent local snapshot and records the exact fork point;
- scrubs copied sessions, agent credentials, and operational claims;
- rotates authorization and data-stream identities and mints fresh sidecars;
- loads the schema and functions generated in `--app-root`;
- boots cron, durable jobs, and asset maintenance inert;
- applies fail-closed `deny-all-v1` host egress; and
- records a finite expiry in the fork-root lifecycle registry.

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
finite TTL is a backstop for interruption, not a substitute for attested test
cleanup. Do not pass a seed on the fork path: replacing realistic parent state
would defeat the option's purpose.

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

## Review, list, and dispose forks

All lifecycle commands re-bind advisory registry entries to the fork's local
lineage, mint receipt, database, and ready descriptor before reading,
signalling, or deleting anything:

```sh
target/debug/snapback fork list \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root

target/debug/snapback fork diff "$FORK_ID" \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root \
  --out /absolute/path/to/fork-diff.json

target/debug/snapback fork drop "$FORK_ID" \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root

target/debug/snapback fork reap --now-ms "$PORTABLE_NOW_MS" \
  --app-root "$PWD" --fork-root /absolute/path/to/shared-fork-root
```

`drop` stops and removes exactly one verified fork. `reap` is deterministic:
the caller supplies a portable millisecond clock and the command removes only
verified forks whose finite expiry is at or before that clock. Nested forks
are refused in local v1.

## Read the diff at its real boundary

The diff receipt covers committed **application-row journal entries after the
fork point**, in commit order. It explicitly omits:

- auth and credential state;
- asset blob operations;
- captured or refused egress payloads;
- privileged or raw-SQL writes outside the app journal; and
- sidecars and telemetry.

It is a review aid, not a complete audit and not production migration
admission. A long-lived fork can also outlive its journal floor; then diff
refuses instead of returning an incomplete receipt. Use the reviewed migration
rehearsal flow for production apply decisions.

## Know what the quarantine does not promise

- Local forks protect the parent from actions routed through the fork's
  runtime. They do not contain a malicious same-user process that can open the
  parent's files or make its own network calls; that requires an OS/container
  boundary.
- The default is secret scrubbing. `--with-secrets` is an explicit high-risk
  opt-in for the config-secret sibling; it does not weaken credential minting
  or egress denial.
- Asset-bearing parents refuse rather than publish metadata whose blobs lack a
  proven fork-private same-cut copy.
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
