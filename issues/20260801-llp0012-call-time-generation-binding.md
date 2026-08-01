# Call-time generation binding on sessions targets (LLP 0012 amendment)

**Status:** Open
**Impact:** 5
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Severity:** P2
**Systems:** API, Server, Client integration
**Author:** Claude (Fable 5), 2026-08-01 triage sweep (re-filed from the
shelved app-cli program per Charlie's 2026-08-01 decision)
**Date:** 2026-08-01
**Related:** LLP 0012 (amendment vehicle), LLP 0043, LLP 0093,
issues/closed/20260717-app-cli-generation-binding.md (original),
issues/20260726-0093-mutation-wire-artifact-identity.md (sibling: the
mutation-wire artifact-identity gap this check would close for asserting
callers)
**Marker:** server, protocol

Re-filed against its real owner: this is a wire-protocol and server
correctness item, not an app-cli feature. The substantive ask, carried
over from the original ticket:

On sessions targets, a caller may assert the expected generation
(envelope/artifact) identity on any call or subscription; the server
checks the assertion against the active generation **atomically with
function selection**, so a deploy racing a call cannot pair
old-schema-validated args with a newer same-named function. Successful
responses echo the server-derived active identity in `facts`. A mismatch
is a typed refusal (machine-distinguishable generation sub-cause); the
client refetches artifacts and retries. Subscriptions pin their
generation and take the same typed refusal on deploy. The check is
**opt-in by assertion**: callers that send no identity (browser kit,
Contract, existing headless users) are unchecked and unbroken — that
clause belongs in the LLP 0012 amendment text.

Consumers today are the packaged protocol clients
(`@expo/snapback-client` and anything built on LLP 0093), not the
shelved CLI engine; the design transfers unchanged.

**Done when:**

- The wire field, atomic server check, and `facts` echo land with the
  LLP 0012 amendment text, including the absent-identity = no-check
  clause.
- Race test: deploy between discovery and dispatch refuses with the
  generation sub-cause and succeeds after refetch; subscription variant
  covered (deploy mid-watch → typed refusal → resubscribe on the new
  generation; removed function → its own typed refusal).
- Existing clients (no identity asserted) pass their suites unchanged
  against the amended server.
- The refusal sub-causes (integrity / binding / generation) are
  machine-distinguishable in diagnostics.
