# `/auth/agents/token/release` does not consume its terminal gate

Status: open
Date: 2026-08-25
Systems: snapback-kernel, snapback-server
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260824-test-support-tiering.md

## Finding

`/auth/agents/token/release` acquires a service-authority terminal gate, but **its storage release
cut does not consume that gate through the service-terminal transaction path.**

Consequence: the route can return **204** while the process publication **reopens or remains
current**. The caller is told the token was released; the durable effect the gate was guarding did
not happen in the way the gate implies.

## Why it matters

This is the acquire-without-consume shape. A gate that is taken and then not consumed by the
transaction it guards provides ordering theatre rather than a control — the same family as
LLP 0303 revision (k), where a durable record consulted only at acquisition turns out to be a cache,
and the F112 root finding, where `acquire_gate` **borrows** rather than consumes its plan so the plan
survives its own use.

A 204 on a release path is a particularly bad place for it, because callers reasonably treat that as
"the credential is gone."

## Provenance

Found incidentally by the test-support harness migration lane while converting service-terminal
tests to production ceremonies. Fixing the kernel path was outside that lane's scope, so its
migrated server tests instead use the working `/auth/agents/revoke-self` ceremony and explicitly
observe `DurableDelete` — a deliberate choice to avoid asserting against a broken path, and worth
noting because a lane that had quietly written its test against `token/release` would have baked the
defect into the suite as expected behaviour.

## What a fix needs

The release cut must run through the service-terminal transaction path so the gate is consumed by
the same transaction that performs the release, and the route must not report success unless that
transaction committed the intended durable effect.

Check the sibling release/revocation routes for the same shape before closing — this programme's
consistent finding is that a correct path sits next to an incorrect one (LLP 0303 revision (n)).
