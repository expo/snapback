# `snapback dev --json` control verbs are undeliverable when stdin is `/dev/null`

**Filed:** 2026-08-25
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-explicit`
**Systems:** CLI, Local server lifecycle, Agent experience
**Owner:** LLP 0310.000 Track E — straightforward

## Problem

The explicit lane launched `snapback dev` via setsid with stdin `/dev/null`
(`/proc/<pid>/fd/0`). After the M2 successor, reload/restart could not be
sent on the JSON control channel. The Clique prompt forbids `pkill`. The
supervisor claims to own Metro but cannot be told to recook it from an
agent launch.

## Evidence

- `benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-explicit/run-log.md`
  (1787659000)
- LLP 0310 F7 / P2

## Direction

Accept control verbs from a unix socket or a well-known fifo next to the
ready file, in addition to stdin. `/dev/null` stdin is a legal agent
launch. Keep stdin for interactive humans.

## Resolution (2026-08-25)

Implemented LLP 0310.000 Track E (in review) across the packaged supervisor's
three control carriers. Packaged stdin keeps the interactive/JSON lifecycle
verbs. The managed-admin-token-gated `POST /_snapback/expo/v1/control` route
now admits `reload-metro` and `stop-children` alongside `dev-fresh`, preserving
its unauthorized and unknown-verb refusals; it echoes request IDs, proves
Metro replacement by PID, and admits `stop-children` to the same serialized
dispatcher before beginning teardown only after the correlated HTTP
acknowledgement flushes.
`snapback dev --expo --json` also publishes an owner-bound
`.snapback/.dc-sock` descriptor for `reload-metro` and `stop-children`, emits
request-id-correlated acknowledgement and settled-result records, enforces
owner UID/incarnation/lifecycle-receipt checks, creates the endpoint mode
`0600`, registers its exact inode with the instance cleanup lease, and removes
it on owner shutdown or death. The socket covers the case where the managed
ready descriptor has no admin-token file and the HTTP plane therefore has no
bearer, while the owner-only pathname gate remains usable. A same-UID dead leftover is
reclaimed under the directory lock only after a bounded `connect()` returns
`ECONNREFUSED`, the inode remains unchanged, and a present valid owner record
matches its inode/incarnation. Publication is ordered binding marker → private
cleanup lease → `listen()` on `.d<random>` → no-replace `link(2)` at the
well-known endpoint → private-name removal → bound record with the exact public
inode → active public cleanup lease. An occupied well-known name makes
`link(2)` return `EEXIST`, which refuses as `SNAPBACK_DEV_CONTROL_FOREIGN_OWNER`.
Linux portability evidence was recorded on 2026-08-26 on an Ubuntu 25.10 host
(Linux `7.0.0-30-generic`, Node `v24.18.0`): `/tmp` (tmpfs), `/dev/shm`
(tmpfs), and `$HOME` (ext4) each allowed the first `linkSync` with link count
two, accepted `connect()` through the linked pathname, and returned `EEXIST`
from a second `linkSync`. This evidence makes no claim about other filesystems.
The private transient socket is recorded before `listen()` and reaped after a
matching reservation-owner death if SIGKILL lands before its normal removal.
An absent or unreadable/corrupt record and a present valid mismatch therefore
refuse with `SNAPBACK_DEV_CONTROL_FOREIGN_OWNER`; recovery
requires the operator to inspect and explicitly remove both artifacts or choose
a different owner-only `--ready-file` directory. Probe timeout, a live listener,
and an other-UID endpoint also refuse. A reserved pre-activation cleanup lease
may remove only its matching `phase: "binding"` marker; it preserves ambiguous
socket residue for explicit recovery. The active reaper's deletion rule is the
separate stricter exact cleanup-lease inode/incarnation match plus a bounded
dead-endpoint probe, and removes the matching bound owner marker with the
socket. No FIFO or client
`recook` verb was added. The detached planes have an exact precedence:
authenticated HTTP with the managed admin-token file, then the owner-bound
socket, then interactive or newline-delimited JSON stdin. The socket is
required only when both stdin and authenticated HTTP are unavailable. A
non-empty regular-file stdin redirect may carry JSON commands; `/dev/null`, a
closed pipe, and an empty regular file are unavailable. Startup refuses with
`SNAPBACK_DEV_CONTROL_CHANNEL_UNAVAILABLE` only when no managed token makes the
HTTP route usable, the socket cannot publish, and stdin cannot carry a command.
A group-writable project therefore remains ready with `controlSocket: null`
when its managed-token HTTP route is usable; the socket-unavailable diagnostic
advertises that fallback. The Guide classifies the artifacts as transient
instance-local state and names the owner-only state directory plus descriptor
as the cross-UID gate; AF_UNIX inode mode is not trusted on Darwin and the
command's JSON UID remains advisory. A non-owner-only state directory or a
non-root-owned/hostile symlink emits
`SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE`; a chain-admission message names the
exact failing component and reason and directs the operator to put
`--ready-file` inside a `0700` owner-only tree or fix that directory mode. A
mode-`0775` project root remains ineligible for default socket publication even
when its `.snapback/` leaf is `0700`, because another group member could rename
the leaf. A mode-`0755` victim project beneath a non-sticky mode-`0777` parent is
also ineligible even when the caller supplies the project itself as the chain
root, because the parent can replace the whole project; an external owner-only
ready-file tree with secure ancestry is the supported recovery.
Bind failures and a failed prepublication `connect()` of the advertised path
follow the same authenticated-HTTP or usable-stdin fallback, and refuse only
when neither remains. The required-channel message calls out bind/publication
versus advertised-path
probe and preserves the underlying cause rather than describing either as
directory-chain admission. Thus a state directory beyond the platform's
Unix-socket path budget reports its bind cause and cannot publish an unreachable
descriptor; every branch retains the `--ready-file` recovery text. The short `.dc-sock`
well-known basename stays within the `.dc-*` coordination budget; live or
occupied endpoints remain fail-closed refusals. Explicit external ready-file
directories are resolved before every canonical ancestor is validated through
`/`, including parents of a caller-proposed project or state-directory trust
anchor. Root-owned non-group/other-writable components, same-UID
non-group/other-writable components, and root-owned mode-`1777` sticky system
directories are admitted; a non-sticky group/other-writable parent refuses
socket publication. The complete lexical spelling is
checked separately and admits a symlink only when the link is root-owned and
resolves to a trusted or root-owned sticky system directory. Thus Darwin's
`/tmp` spelling is admitted through the root-owned `/tmp` → `/private/tmp`
symlink, and the descriptor publishes the canonical
`/private/tmp/.../.dc-sock` path;
non-root-owned/hostile symlinks still refuse. The lexical and canonical
component identities, including the leaf, are rechecked before private bind and
before `link(2)` publication. After a settled result is flushed, the supervisor
destroys the one-request connection so a client that leaves its writable half
open cannot retain a supervisor file descriptor; the endpoint remains available
for subsequent commands. A standard client may half-close after sending a
complete request with `socket.end(request)`: the server retains its writable
half until both the acknowledgement and asynchronous settled result flush.

Carrier commands preserve the public artifact contract separately from Track
E's private supervisor state. For both web and native carriers, `{artifacts}`
expands exactly to the directory named by `--artifacts`, so a custom v1 command
writing `{artifacts}/proof.json` leaves that file in the caller-visible
directory beside logs and `director-log.json`. `{supervisorState}` expands to
the owner-only `{artifacts}/.snapback-carrier-state` child. The shipped Expo web
carrier uses `{supervisorState}` for its `--ready-file` and
`expo-supervisor.json`, and the structured-readiness declaration requires that
private placeholder. Ordinary artifacts are never silently redirected into
supervisor state.

The focused `expo-dev-loop.test.mjs --control-socket-only` regression includes
the HTTP E1 slice (also runnable alone as `--http-control-only`): bad-token and
unknown-verb refusals, request correlation, Metro PID replacement, and an HTTP
`stop-children` acknowledgement that flushes before teardown starts. The
backend and Metro process groups then disappear while the owner,
bootstrap/front listeners, and control socket survive; `reload-metro` on that
same owner respawns Metro. It also includes a `--json` launch using the default
control-socket posture, with stdin ignored and test-only fixture paths/ports,
that acknowledges and settles `reload-metro`. It overlaps acknowledged
`reload-metro` with `stop-children`, asserts both settled results, then proves
the packaged owner and socket remain live until SIGTERM and a later
`reload-metro` respawns Metro.
It also proves stale/foreign/other-UID requests return one result and no
acknowledgement; queues `stop-children` behind an injected replacement-Metro
launch failure and requires the stop result before critical owner exit; and
submits stdin `restart` after the stop acknowledgement to prove the shared
stopping latch refuses it without spawning a backend. A pipe-backed launch
also proves `snapback.dev-command.v1` `reload` remains available. Before the
first implementation the suite failed with `actual undefined`, expected
`snapback.dev-control.v1`; before the review fixes the successful overlap
returned only the reload acknowledgement and no settled result; before the
round-4 fix the failed-reload overlap timed out waiting for
`stop-after-failed-reload`; before the round-17 fix the literal `/tmp` external
ready-file regression again failed with `actual undefined`, expected
`snapback.dev-control.v1`; before the round-18 fix the mode-`0775` project with
stdin `/dev/null` reached `ready` instead of the expected coded startup refusal.
The repaired regression also proves that the same project publishes a live
socket when `--ready-file` moves into an external `0700` owner-only tree.

`expo-dev-control.test.mjs` binds a socket in a child, kills the holder with
`SIGKILL`, and proves a relaunch reclaims the exact stale endpoint only when its
bound owner marker matches. It separately proves missing/corrupt/mismatched
owner-state refusal with operator-explicit recovery, live-owner and simulated
other-UID refusal, owner-directory stdin-only degradation, EOF and idle-deadline
cleanup, complete-request EOF delivery of both acknowledgement and settled
result, settled half-open-client destruction with a subsequent successful
command, and cleanup-lease reaping after owner death. Before the round-18 fix,
the complete-request EOF regression received only the acknowledgement. The
suite also changes a secure ancestor before private bind and before `link(2)`;
before the round-18 fix both barriers published successfully instead of
refusing the changed chain. The crash before
`expo-supervisor.json` publication reclaims through the already-published bound
marker. Further coverage includes a bounded-probe timeout, death while replacing
stale `.dc-lock` through `.dc-reclaim`, death after the stale-generation claim
but before `.dc-reclaim` replacement, and death after private bind, `link(2)`
publication, and exact public-inode lease activation. The pre-activation
SIGKILL regression proves
reserved cleanup preserves the well-known socket, removes only the binding
marker, and makes a racing successor refuse until explicit recovery. The
reserved reaper-versus-bind clone proves a live successor inode survives a
stale reservation. A separate private-bind SIGKILL regression proves the
pre-listen lease reaps `.d<random>` after reservation-owner death. External
chain regressions refuse a mode-`0777` non-sticky parent without publishing an
endpoint, admit the literal Darwin `/tmp` spelling through its root-owned
symlink, and require the descriptor to publish the canonical socket path.
The internal-chain regression places a mode-`0755` victim project under a
non-sticky mode-`0777` parent outside `pathChainRoot` and requires refusal with
that canonical parent named. Another fault injection SIGKILLs immediately after
opening a `.dc-c-<pid>-<token>` publication candidate; after the minimum stale
age, the next publication removes it only after same-UID, one-link, dead-owner,
and unchanged-inode/bytes checks, leaving no `.dc-c-*` residue.
Generation claims record PID/start-time owner identity; a
dead claimant is recoverable through a next-generation atomic-link election,
two racing successors still admit exactly one winner, and the winner removes
the claim chain once its live `.dc-lock` is published. The live suite
concurrently submits stdin and socket `reload-metro`, while the failed-reload
case submits stdin `restart` during the transient `stop-children` latch. The
latch refuses work only while teardown is pending; after the settled result,
the same owner accepts `reload-metro` again. The implementation routes all four
lifecycle-mutating stdin verbs through the same serialized queue.

LLP 0310.000 OQ8 remains open: the no-admin-token pathname-authority case is
now documented and covered, but the RFC still owns the broader product question
of which concrete callers require the socket rather than the ordinary HTTP
route.
