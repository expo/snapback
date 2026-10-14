# Snapback 4 release control on macOS: accepted socket is non-blocking, so a slow client gets `Broken pipe`

**Status:** Open
**Date:** 2026-10-15
**Scope:** Snapback 4 `serve` release control (`crates/snapback4/src/release_control.rs`), macOS only
**Owner:** Unassigned

## Observation

0.4.27 Mac publication dry run 3 (`reports/20261014-publication-0.4.27/attempt-3-publication-dry-run.log.gz`,
M5 Max, default `/var/folders` TMPDIR, serial client files, load average ~15–25)
failed one test in `packages/snapback4/test/release-activation.test.mjs`:
"REL2 successful preview reports a rebuilt maintain instead of its speculative refusal".

```
rollback /var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/sb4-cli-activation-bo7OAj/deployment --to 1 --check --json
rollback: release command result is unknown: Broken pipe (os error 32); run `snapback4 releases …/deployment` to inspect database authority; the server continues admitted work. Do not automatically deploy another release
```

The same file passed alone three times (41/41) and in the neighbouring full
pools, and has never failed on Linux. It is not a test weakness: the product
returned an ambiguous-result error for a read-only `--check` against a live,
healthy `serve`.

## Cause (reproduced in isolation)

`Listener::bind` sets the listening `UnixListener` non-blocking (the accept loop
polls `stopping()` every 25 ms). On Darwin/BSD, `accept(2)` returns a socket that
**inherits `O_NONBLOCK`** from the listener; on Linux it does not. `Listener::handle`
then calls `input(stream, 5 s)`, which relies on `set_read_timeout`, but a
non-blocking socket ignores the timeout: if the client has not written yet,
`read` returns `WouldBlock` immediately, `handle` replies
`{"error":"Resource temporarily unavailable (os error 35)"}` and drops the stream.

The client (`release_control::request`) connects, then does `peer()`,
two `socket_entry` stats, sets timeouts, builds the envelope (including
`identity(&store)`) and only then `write_all`s. If the server's 25 ms poll
accepts in that window, the client's `write_all`/`shutdown` hits the closed
peer → `EPIPE` → "release command result is unknown: Broken pipe". (If the
client wins the race partially, it would instead read the EAGAIN error reply.)
Under load the window is easily hit.

Minimal Rust program (std only): bind a `UnixListener`, `set_nonblocking(true)`,
connect a client that writes nothing, accept, `set_read_timeout(5 s)`, `read`:

| Host | Result |
|---|---|
| macOS 27.0.1 (Darwin 27.0.0), M5 | `WouldBlock (os error 35)` after **2 µs** |
| Linux 6.8 (`expo-build-1000`) | `WouldBlock (os error 11)` after the full timeout (blocking socket, timeout honoured) |

## Impact

Any macOS `snapback4 deploy` / `rollback` / `releases` command that talks to a
running `serve` through release control can intermittently fail with an
ambiguous "result is unknown" error (for mutating commands it tells the user not
to redeploy automatically), more likely when the machine is loaded. Linux is
unaffected. No data loss: the server never admits a command it could not read.

## Suggested fix (not applied during publication)

After `accept`, put the accepted stream back into blocking mode
(`stream.set_nonblocking(false)`) before `peer()`/`input()`, so the existing
total input deadline governs reads on every platform. Add a regression test that
accepts before the client writes (e.g. a client that sleeps 100 ms between
connect and write) and assert the command succeeds on Darwin.

Evidence: the 0.4.27 publication records above; the 0.4.28 publication attempt
(`reports/20261015-publication-0.4.28/`, if recorded) did not reach the Mac dry run.
