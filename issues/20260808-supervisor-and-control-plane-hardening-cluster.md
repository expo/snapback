# Hosted supervisor / control-plane hardening: arbitrary-file-read ordering, dead expiry checks, stale audit lock, verify crash

**Opened:** 2026-08-08 · **Severity:** P2 · **Area:** snapback-cli / snapback-hosted-supervisor

Four independent robustness/security gaps in the hosted control plane. Several
depend on a fail-closed lifecycle that is safe *today* but should be closed
before the hosted carrier gate is lifted.

## A) Supervisor reads a caller-supplied path before validating it (arbitrary-file-read primitive)

`packages/snapback-hosted-supervisor/service.mjs:409-417`.
`registerHostedTargetEnrollment` calls `readSecret(args.signingSeedCredentialRef)`
(a `readFileSync`) **before** `validateHostedTargetEnrollment`, which is the only
place enforcing the `/run/secrets/` prefix and `..` rejection
(`hosted-edge-admission.mjs:122-131`). An authorized mTLS control client on
`/v1/command` can set the ref to any path (`/etc/passwd`); its bytes are read
before the constraint applies. Content use needs 32-byte base64url, so it's an
error-oracle, not direct exfiltration — but the ordering defeats the guard.
*Fix:* validate the enrollment before `readSecret`.

## B) `verifyOperatorResponse` never checks wall-clock validity or a revocation floor

`packages/snapback-cli/hosted-control.mjs:285-317` (intervals), :257-259
(`revocationGeneration`). It checks issue-window shape but never compares any
timestamp to `Date.now()`, and only validates `revocationGeneration >= 1`. A
response/intermediate that expired days ago still verifies; a rolled/revoked
intermediate is accepted. Mitigated today by cert-pinned mTLS + request-digest
binding + a fail-closed upstream, so the expiry/revocation fields are currently
dead weight. *Fix:* require `notBeforeMs - skew <= now <= expiresAtMs + skew`
for response and intermediate; accept a caller-supplied minimum
`revocationGeneration`. Close before the carrier gate lifts.

## C) Stale audit `.append.lock` permanently wedges all privileged control ops

`packages/snapback-cli/deployment-control.mjs:1092-1141`.
`writeFileSync(lockPath, pid, { flag:'wx' })`; the lock is removed only in
`finally`, the PID is written but never read, and there is no age/liveness
expiry. A process killed between lock creation and `finally` leaves
`.append.lock` forever; every subsequent deploy/backup/rollback/restore/logs/
inspect (all append audit events) then fails closed with
`SNAPBACK_CONTROL_AUDIT_UNAVAILABLE` and no recovery path. *Fix:* on `EEXIST`,
`process.kill(pid, 0)` liveness (or age bound) to reclaim; name the lock path in
the diagnostic.

## D) Malformed acceptance-profile conformance crashes `runVerify` with no receipt

`packages/snapback-cli/verify.mjs:438-441, 455, 488` (called unprotected at
:684). `aggregateConformance` re-validates with `assert(...)`; `runVerify` calls
it outside any try/catch, while `runProfiles` carefully turns a throwing
`profile.run` into a failed result. A profile returning a duplicate pathId /
unregistered path / malformed report aborts the entire verify run — no receipt,
no stage verdicts. *Fix:* wrap per-profile validation so violations become a
failed `admission-and-conformance` stage, not an escaping exception.

## Confidence

High mechanics on all four; A/B are mTLS-gated (low exploitability today), C/D
are availability/robustness. Grouped because they share the hosted control-plane
owner.
