# Call-time generation binding on sessions targets

**Status:** Shelved
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Call-time generation binding on sessions targets” shows the issue reaches a security, correctness, release, or core product boundary; delay compounds an active rollout, reliability, or verification risk, while the fix requires a few coordinated implementation and test surfaces, with specific cited code, progress, or acceptance criteria.
**Severity:** P2
**Systems:** API, Server, Client integration
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §1, LLP 0012 (amendment vehicle)
**Marker:** app-cli, sub-stage-b, server

On sessions targets, every engine call and subscription asserts the
expected envelope identity; the server checks it against the active
generation **atomically with function selection**, so a deploy racing
a call cannot pair old-schema-validated args with a newer same-named
function. Successful responses carry the server-derived active
identity in `facts`. Mismatch is a typed refusal (exit 7, generation
sub-cause); the engine refetches artifacts and the caller retries.
Subscriptions pin their generation and take the same typed refusal on
deploy. The check
is **opt-in by assertion**: callers that send no identity (browser
kit, Contract, existing headless users) are unchecked and unbroken —
this clause belongs in the LLP 0012 amendment. Dev targets are
explicitly out of scope (accepted residual, LLP 0062 §1).

**Done when:**

- The wire field, server check, and `facts` echo land with the
  LLP 0012 amendment text, including the absent-identity =
  no-check clause.
- Race test: deploy between discovery and dispatch refuses with the
  generation sub-cause and succeeds after refetch; subscription
  variant covered (deploy mid-watch → typed refusal → resubscribe on
  the new generation; removed function → exit 4).
- Existing clients (no identity asserted) pass their suites unchanged
  against the amended server.
- Exit 7's three sub-causes (integrity / binding / generation) are
  machine-distinguishable in diagnostics.

## Shelved (2026-08-01, author decision) — ask re-filed

Temporarily shelved per Charlie's 2026-08-01 decision on the
triage-sweep recommendation: the app-cli program is paused. The
substantive ask outlives the program and is RE-FILED against its real
owner:
issues/20260801-llp0012-call-time-generation-binding.md (LLP 0012
amendment vehicle; consumers are the packaged protocol clients). This
original stays as the app-cli-era record. Reopening condition for the
program: LLP 0062 leaves Review or is recommissioned.
