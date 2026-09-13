# Same-UID lifecycle HTTP responder identity is not independently verifiable

**Status:** Open — inherent local trust limitation
**Opened:** 2026-08-26
**Systems:** CLI, Local server lifecycle, Security, Receipts
**Related:** LLP 0024 §Dated amendment: server-owned stop;
`issues/closed/20260825-caller-owned-devloop-papercuts.md`

## Limitation

`snapback stop` and the stop leg of `snapback restart` obtain their descriptor,
administrator credential, health response, and served result within one
same-UID local trust domain. That principal can reproduce the target, startup
nonce, exact declared lifecycle authority, and exact served success result. The
CLI therefore has no independent root from which to prove which process served
HTTP or validated the credential.

Adding a served PID, echoed nonce, or signature derived from inputs available
to the same UID would not close this limitation. It would only make the receipt
look more responder-identity-bound than the verifier can establish. A sound
closure needs a separately protected identity root and a protocol binding the
ready descriptor and response to it.

## Current honest posture

The served `host.stop` implementation remains AdminWrite-gated, validates its
own startup nonce, and requests its own process-local shutdown. Before sending
that request, the CLI verifies the descriptor's PID/startupNonce against health
and captures the PID's OS process-table start time. After the typed result it
records configured-URL health loss and polls signal-0 existence plus that start
time. `ESRCH`, or the PID reappearing with a different start time, proves the
original descriptor-named process identity gone without delivering a signal.

The CLI success receipt has `authority: null` and exactly:

```json
{
  "credentialedHostOpResultAccepted": true,
  "configuredUrlStoppedAnswering": true,
  "processIdentityVerified": true
}
```

Top-level `ok` is granted if and only if `processIdentityVerified` is true. The
field claims only that the descriptor-named, pre-stop PID/start-time identity
is gone; it does not claim that identity served HTTP or validated the
credential. `configuredUrlStoppedAnswering` is separately factual and cannot
grant success. The forge-envelope-then-close regression now has accepted-result
and URL-loss facts true but `processIdentityVerified: false`, top-level
`ok: false`, and the unrelated live PID untouched. The false-success bypass is
closed.

## Closure condition

Keep this limitation open unless a reviewed design introduces an independent
responder-identity trust root that a same-UID responder cannot replace or
reproduce, and the CLI verifies the served response against that root. The
current OS exit observation already soundly grounds stop/restart success;
receipt-only PID/nonce additions do not close the narrower responder-attestation
limit.
