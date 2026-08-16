# Demo devserver dies on restart when HEAD outruns the prebuilt binary

**Status:** Closed
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 4
**Systems:** Demos, Bootstrap, Runtime
**Date:** 2026-08-11
**Related:** LLP 0030 ("command-resolver ladder"), LLP 0031 ("server binary
identity on health"), LLP 0010 ("Bootstrap diagnostic codes"),
`demos/_kit/server-process.mjs`, `scripts/runtime-link-smoke.mjs`

## Summary

A demo devserver that started fine minutes ago refuses to start again, with a
~250-line diagnostic dump and an uncaught Node stack trace. Observed on
`demos/eas-payments/devserver.mjs`, branch `eas-payments-slice`, 2026-08-11.

The first start succeeded. After `^C`, the next start printed:

```
PREBUILT SNAPBACK REJECTED (target/debug/snapback): binary identity is
stamp-mismatch (health commit 3aa3caaf186e... does not match checkout
7b112c45da9e...); stamp 3aa3caaf186e, checkout 7b112c45da9e
Falling back to the source-tree `cargo run` rung (LLP 0030 command-resolver ladder).
RUNTIME RECOVERY: {…~120 lines of JSON…}

Error: SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED: the exact-link probe could not
launch Cargo: spawn cargo ENOENT
    at proveCargoFallback (demos/_kit/server-process.mjs:466:19)
{…the same recovery record printed a second time by Node…}
```

Three separate things combine here.

**1. The trigger is a moving HEAD, not `^C`.** Both commits in the message are
real commits on this branch: the binary was stamped at `3aa3caaf1` (slice 9)
while the checkout had advanced to `7b112c45d` (slice 11). The prebuilt rung
compares the binary's `/health` stamp against `readCheckoutBinaryIdentity()`,
so every new commit invalidates `target/debug/snapback` until it is rebuilt.
The check only re-runs at startup, so a restart is simply when the accumulated
drift becomes visible. From the operator's seat that reads as "intermittent
after `^C`". This branch takes several commits a day, so the failure recurs.

**2. The `cargo run` fallback is not available in this environment.** `cargo`
lives only at `~/.cargo/bin/cargo` on this machine, and that directory is not
on `PATH` in the shell that ran the devserver (`spawn cargo ENOENT`); it is
also absent from the `PATH` an agent shell in this repo sees. So the ladder's
last rung cannot run, and the ladder has no rung left.

**3. Neither the classification nor the presentation is actionable.**

- `spawn cargo ENOENT` is classified as
  `SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED`
  (`scripts/runtime-link-smoke.mjs`, the `result.spawnError` branch). LLP 0010
  defines that code as "the probe driver itself failed before it could emit
  its structured result" — an internal-fault code. "The Rust toolchain is not
  installed or not on `PATH`" is a host-environment condition with a one-line
  remedy, and it is not distinguishable by code today.
- The recovery record already holds the answer —
  `recovery.overrideCommand: SNAPBACK_SERVER_BINARY="…/target/debug/snapback"`
  and `recovery.repairCommand: scripts/bootstrap-ibex-runtime` — but it is
  buried at the end of a JSON blob that is printed **twice**: once by
  `server-process.mjs:347` (`RUNTIME RECOVERY:`) and again by Node's uncaught
  exception printer, which serializes `error.runtimeRecovery` and
  `error.diagnostic.details.producerInputs` in full.
- `demos/eas-payments/devserver.mjs` does not catch the failure, so the
  operator gets a stack trace where a two-line "run this" would do.

The record also states `currentCheckout.runnable: true` and
`reuse.reason: "…prior binary is runnable but requires explicit selection"`.
The existing binary would have worked; the operator just has no cheap way to
say so.

## Why it matters

The devserver is the demo's human-facing entry point — the thing a person runs
to drive the purchase → entitlement loop by hand. Its failure mode is
currently indistinguishable from a broken checkout, and the wall of JSON reads
as "something deep is wrong" rather than "your binary is four commits old".
The cost is entirely in interpretation: two of the three fixes are printing
changes.

Note the identity gate itself is working as designed (LLP 0031): refusing a
binary that is not this checkout's is correct, and this ticket does not
propose weakening it.

## Proposed fix

1. **Give "no Rust toolchain" its own code.** In
   `scripts/runtime-link-smoke.mjs`, split the `spawnError` branch: when the
   spawn failure is `ENOENT` on the cargo command, emit a distinct
   `SNAPBACK_*` code (e.g. `SNAPBACK_IBEX_CARGO_NOT_FOUND`) whose message
   names the command it tried and the remedy (install the toolchain, or put
   `~/.cargo/bin` on `PATH`). Add the code to LLP 0010's list. Keep
   `SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED` for genuine driver faults, as
   LLP 0010 already defines it.
2. **Print the remedy, not the record.** When the ladder exhausts its rungs,
   emit a short block first — the reason, the `repairCommand`, and the
   `overrideCommand`, each on its own line — and put the full recovery JSON
   behind a flag or env opt-in (or write it to a file and print the path).
   Also stop printing it twice: the demo entry points should catch the error,
   print the block, and exit non-zero rather than letting Node serialize the
   whole object.
3. **Consider an explicit "reuse the stale binary" affordance for demo
   drivers.** `SNAPBACK_SERVER_BINARY=…` already exists and is the documented
   escape hatch; the gap is discoverability, which fix 2 mostly closes. If
   that proves insufficient in practice, a devserver-only opt-in flag that
   makes the stale-but-runnable choice once, loudly, is the next step — still
   explicit, never automatic.

An alternative to (2) worth weighing: have the demo devserver rebuild
automatically when the stamp is stale, and only fail when the rebuild fails.
That trades a fast failure for a multi-minute debug build of a 338 MB binary,
so it should not be the default.

## Repro

1. Build `target/debug/snapback` at some commit.
2. Commit anything that changes `readCheckoutBinaryIdentity()`'s HEAD read
   (any commit) without rebuilding.
3. Run `node demos/eas-payments/devserver.mjs` from a shell with no `cargo` on
   `PATH`.

Expected: a short message saying the prebuilt binary is stale and how to fix
it. Actual: the prebuilt rejection line, a 120-line recovery record, an
uncaught `SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED`, and the same record again.

## Resolution

2026-08-15: Proposed-fix items 1 and 2 landed. A missing Cargo command now
emits `SNAPBACK_IBEX_CARGO_NOT_FOUND`, while other probe-driver faults retain
`SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED`. Exhausted command resolution now
prints the reason, repair command, and explicit binary override first; full
recovery JSON requires `SNAPBACK_RUNTIME_RECOVERY_JSON=1`, and the shared demo
launcher exits non-zero without exposing the attached error object to Node's
uncaught-exception serializer.

Proposed-fix item 3 — a new explicit stale-binary reuse affordance — was
deliberately not taken. `SNAPBACK_SERVER_BINARY` remains the existing explicit
selection mechanism, and the LLP 0031 server-binary identity gate remains
unchanged.
