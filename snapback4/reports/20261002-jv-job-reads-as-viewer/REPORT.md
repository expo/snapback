# JV round 0 — jobs read as their recipients

2026-10-02. Branch `sb4-intent/jv-job-reads-as-viewer`, based on
`738d45830c9d51c9c92f65180c56cbecb2f2b068`. Local commit only; no push or publication.

## Result and design

LLP 3000.007 **§21.12** extends §21.1's digest contract. A job sweep can use
`as recipient.principal:` to evaluate reads and ordinary declared Quarry queries
with the recipient's rules, audiences, field disclosure and expiry. The block
updates outer local accumulators; writes and effects happen afterward.

```quarry
    unread = 0
    as p.principal:
      for chat in all(unreadPreview(periodStart, periodEnd, null)):
        unread = unread + chat.unread
    if unread > 0:
      emit push { principal: p.principal, unread } once [p.principal, periodEnd]
```

The excerpt belongs inside a sweep and uses the complete jobs-card schema.
The jobs card now uses that UI query without a recipient membership walk in
the job; one sentence retains the intentional system-read pattern. The language
card includes the new syntax. The actions card distinguishes the new body scope
from schedule-level `as`, which still only names an action's service seat.

Persona, user, guest, application and service principals are allowed. `system`,
null and malformed identities refuse. Selection needs no login session.
Writes, emits, ID minting and guessed once-consumption calls refuse at compile
time, including expanded helpers, with “compute inside as; act outside” repair.
Reading an asset reference does not consume it; Quarry has no asset-consumption
operation. Invalid placement, nesting, escaping returns, unsupported query
calls and incomplete reads have dedicated diagnostics on `guide jobs`.

A direct query call returns `{ data, next }`. The streaming `all(query(...))`
loop verifies that the declared cursor actually owns the returned list, follows
every cursor and retains one page at a time. Start with null and exhaust the
loop for an exact total; `break` explicitly requests an early stop. Native,
held and ephemeral-table queries are not admitted. Unavailable or non-uniform
reads refuse instead of supplying a partial digest.

Ordinary server queries and job query calls use `Runner::run_server_query`,
including the ordinary server search substitution. No authorization evaluator
was added. Fresh read frames prevent viewer-cache leakage, while sharing the
chunk's rows/transaction, clock, public meter and guarded authorization work
allowance. No page resets the meter. Existing adaptive retry and parking own
over-budget recipients and roll back their effects and once keys. Embedded
bound queries/helpers participate in the existing job generation hash.

## Qualification

The final affected run is **142 passed, zero failed**:

| Target | Passed |
| --- | ---: |
| `job_viewer` | 9 |
| Entire `guide` target | 110 |
| `audience_bounds` | 10 |
| `helper_placement` | 8 |
| `intent_followup` | 5 |

Command from `snapback4/`:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test job_viewer --test guide --test audience_bounds --test helper_placement --test intent_followup
```

The deterministic randomized property test compares complete returned rows,
field presence and unread totals against ordinary client queries over the same
unchanged data snapshot and pinned clock: 24 datasets, 27 rooms each, 35 messages per room
(22,680 messages), six principals including no-access and removed-member
controls. Membership, read ordinals, sender, message time, tombstones and
expiry are varied; expiry includes one millisecond before, exactly at, and one
millisecond after the pinned clock. Both message pages and recipient chat pages
continue. Separate tests cover service-only rules, direct reads, earlier writes
in the same chunk, pinned `now`, restoring system authority, compile refusals,
forged effectful IR, cursor ownership, query-generation drift and a 17,000-row
recipient that parks at chunk size one with no effect or once key.

Two persisted-engine tests compare modern and hand-written digests across a
mid-period restart, rerun and idle period. One compiles the full archived
Calibration #28 schema/config/schedule, changing only the membership loop and
adding its UI query. It covers five chats, removed/no-access recipients,
follows/posts, expiry, tombstones, already-read and out-of-period messages.

`host-replay.mjs` additionally drives the actual native HTTP host and SDK
worker with a durable ledger. It replays Calibration #28's M8 five-person
fixture against the original archived job and its viewer-query replacement.
All application HTTP connections close before the boundary; there are no
open application clients. A SIGTERM and fresh listener restart at the
120-second period's midpoint, followed by completion and one idle period,
produce identical payloads:

| Recipient | New followers | Following posts | Unread messages | Unread chats |
| --- | ---: | ---: | ---: | ---: |
| D1 | 1 | 2 | 0 | 0 |
| D3 | 0 | 2 | 3 | 1 |
| D5 | 0 | 0 | 5 | 1 |
| D2, D4 | No digest | No digest | No digest | No digest |

Each implementation delivered 11 effects (eight message pushes and three
digests), zero duplicate worker idempotency keys, and zero idle-period digests.
The replay uses the supported development clock to advance the same periods;
it does not wait two wall-clock minutes. Logs retain listener PIDs and counts,
never service tokens.

`cargo check --workspace` passes. `./ref-check --verbose` reports:
`ref-check: ok — 525 LLP docs, 10072 refs in 31557 files, 0 errors, 0 unchecked`.

### Full suite

Ran `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
once from `snapback4/`, exit **0**. Exact summary:

```text
== 0 failure(s) in 1561 s
```

All phases pass: cargo build, wasm build, docs budget, release guard, package
typecheck/build, chat check, Rust tests, chat/Expo typechecks, fixture tests,
client tests and client models. Rust runs 284 binaries / 997 executions plus
workspace doctests. Client tests: 5,768 passed, zero failed, 10 skipped.
Models: 79 passed, zero failed, preserving 5,000 online + 5,000 local session
sequences and 3,000 online-client interleavings. Product code was frozen before
this run. Final qualification failures: **ours 0, baseline 0, environmental 0**.

See [FAILURES.md](FAILURES.md) for every development/qualification failure and
its disposition. No inherited failure is called baseline without a current-main
reproduction.

## Wasm ratchet

Locked Linux build: **2,038,385 B raw / 611,844 B gzip**. The full-suite build
confirms the standalone final measurement. The old 610,782 B cap is exceeded
by 1,062 B. The device carries the new IR codecs because backend program
serialization includes jobs, plus a fail-closed server-only execution refusal.
The viewer-query implementation itself is SQLite/server-only. Removing these
codecs would require changing the backend program format/custody beyond this
lane.

As authorized, `metrics/wasm-budget.json` raises the ratchet to **612,474 B**:
611,844 + 130 B for the stated macOS offset + 500 B headroom. macOS is estimated,
not measured here; its estimated gzip range is 611,954–611,974 B, leaving
500–520 B. Runtime meter ceilings are unchanged. The prior recorded Linux
artifact was 2,032,879 / 610,174 B; it was not rebuilt for a size comparison,
so no measured feature-only delta is claimed.

## Evidence

- [Affected tests](affected-final.log), [host replay](host-replay.log) and
  [reproducible host script](host-replay.mjs).
- [Full suite](test-sh.log), [workspace check](workspace-check.log),
  [final reference audit](ref-check-final.log), [final wasm build](wasm-final.log).
- [Failure ledger](FAILURES.md); earlier logs preserve corrected development
  failures rather than silently replacing them.
