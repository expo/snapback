# Snapback 4: One thread per request, no socket deadline, anonymous long poll

Status: Closed
Resolved: 2026-09-13
Priority: P2
Observed: 2026-09-13
Review finding: S11
Evidence: Code-traced; R19 closed by switching to unbounded threads
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../../llp/reviews/3000-security-review-20260913.md), [closed R19](./20260912-snapback4-long-poll-worker-starvation.md)

## Problem and reproduction

`serve` spawns a thread per accepted request so idle `/changes` polls do not occupy a fixed pool (R19). There is no cap, no accept backlog policy, and tiny_http is used without read/write/idle deadlines.

`GET /changes?wait=25` is unauthenticated. An anonymous client can open tens of thousands of connections, each a thread plus a 25s wait, and Slowloris-dribble headers on others. The engine mutex is not held during the wait, but the process still pays stacks, sockets and wakeups.

Body ceilings (1 MiB JSON, 16 MiB seed, 64 MiB assets) bound payload memory per request, not concurrent requests.

## Acceptance

- Cap concurrent connections/threads and concurrent `/changes` waiters.
- Socket read/write/idle deadlines on the HTTP host.
- Unauthenticated waits, if they remain at all (see S03), must be cheaper than a thread each (evented wake, or require a session).
- Keep the R19 property: idle polls must not stall unrelated short requests.

## Implementation locations

- [crates/snapback4/src/serve.rs](../../snapback4/crates/snapback4/src/serve.rs)
- [vendor/tiny_http](../../snapback4/vendor/tiny_http/) (deadlines may need a host-side wrapper rather than a patch)

## Resolution — 2026-09-13

The HTTP host admits at most 128 connections before creating connection threads, with separate 32-request short and 32-request long-poll allowances. Idle/header/body/write deadlines are bounded; header and body budgets are absolute even under dribbling. Each connection has only one outstanding request. Unsupported HTTP versions are refused before writer ownership, and 100 Continue does not spend the final response's write budget. Anonymous changes waits are refused. Socket and pool regressions cover slow readers/writers, overload, pipelining, and progress of short requests while polls are occupied.

Validation: Linux `cargo test --workspace --no-fail-fast --quiet`, wasm build, and the full `scripts/test.sh` at `8d8c1b7c170183d6a54d7a37af8b34596410160d` passed (0 failures in 45 seconds; 71 client tests). The final audience-index selection correction at `90152c6f2` passed its affected regression. See the [remediation and review record](../../llp/reviews/3000-security-remediation-20260913.md) for review scope and follow-up integration fixes.
