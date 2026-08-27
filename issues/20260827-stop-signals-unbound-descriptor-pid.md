# `snapback stop` signals a descriptor-named pid it never bound to the live server

**Type:** Issue
**Status:** Open
**Systems:** CLI, Local server lifecycle, host-ops
**Author:** Claude (sbs-orchestrate supervisor)
**Date:** 2026-08-27
**Related:** `issues/20260825-caller-owned-devloop-papercuts.md` (F2/F3/F4 — the
same surface, but that ticket records only the DX papercuts, not this),
LLP 0184 (host-ops authority), LLP 0030 §attach (descriptor validation)

## Summary

On `main` — and on **published 0.1.27** — `snapback stop --ready-file <path>`
will signal the `pid` named in a readiness descriptor without ever binding that
pid to the process actually answering the descriptor's `serverUrl`, and will
then report success with a receipt asserting `verifiedBy: "startupNonce"`.

Reproduced by execution 2026-08-27 against a main-era binary.

## Reproduction

1. Spawn a throwaway victim process (`sleep 900`), note its pid.
2. Run a trivial loopback HTTP responder that answers `GET /health` with
   `{"ok":true,"binary":{"startupNonce":"<N>"}}`.
3. Write a 0600 readiness descriptor whose `serverUrl` points at the responder,
   whose `startupNonce` is `<N>`, and whose **`pid` is the victim** — a process
   with no relationship to the responder.
4. `snapback stop --ready-file <descriptor>`

Observed:

```text
exit 0
"data": {
  "stoppedPid": 52922,
  "serverUrl": "http://127.0.0.1:50802",
  "verifiedBy": "startupNonce"
}
```

The victim was killed. The responder received exactly one request — `GET /health`.

## Mechanism

`verify_live_descriptor_identity` (crates/snapback-cli/src/cli.rs) compares only
`binary.startupNonce` from `/health` against the descriptor's `startupNonce`.
No pid reported by the live server is compared against `descriptor.pid` —
`/health` does not publish one. `HostReadyDescriptor::validate` checks only
`pid != 0`. The signal then goes to `descriptor.pid` verbatim.

Both sides of the "verification" are caller-authored: the descriptor is written
by the caller, and the responder is run by the caller. The nonce proves the
endpoint knows a value the caller chose; it proves nothing about the pid.

## Severity — read this before triaging

This is **same-uid**. Anyone able to write the descriptor and bind a loopback
socket is already executing code as that user, so it is **not** a privilege
boundary break, and should not be triaged as a remote or cross-user hole.

The real cost is the failure mode the caller-owned dev-loop ticket was opened
about: **an agent or human points `stop` at a stale, copied, or hand-edited
descriptor, kills an unrelated process, and is told the stop succeeded.** The
receipt actively asserts an identity verification that did not verify the thing
it signaled, so the operator has no signal that anything went wrong.

Note the shipped path is the *softest* variant: it needs only a forged nonce.
(Later work in the `ws/devloop` lane refuses that case and requires pid forgery
to get through — see below.)

## A fix already exists, unlanded

The `ws/devloop` lane (local only, not on `main` at time of filing) carries a
rework that closes this: the CLI stops signalling a caller-named pid at all and
instead routes through an authenticated server-owned self-stop, then **observes**
whether the descriptor-named process actually exited (bound to the pre-stop
startup identity) before granting `ok`. `configuredUrlStoppedAnswering` remains
a stated fact and does not grant success.

That rework was certified against four forgery classes at two defence layers
(credential gate and process-identity observation), including a credentialed
same-uid forger. It is blocked on an unrelated caller-side regression
(`runDev().close()` not propagating the managed admin token), not on the
authority work.

## Expected resolution

Land the `ws/devloop` authority rework. Do **not** attempt a narrower repair
that compares a pid published on `/health`: that was tried and defeated, because
a caller-run responder can publish any pid it likes. A sound binding must come
from something only the live server can produce, or from an OS-observable fact
about a process the caller does not control.

Until it lands, `stop --ready-file` should be treated as "signals what the
descriptor says," and the `verifiedBy` field in its receipt should not be read
as an identity guarantee.
