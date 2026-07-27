# Package-owned comparator acceptance kit

**Status:** Open  
**Impact:** 4  
**Urgency:** 3  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P2  
**Systems:** Acceptance testing, Client integration, Realtime, Ephemeral state, Packaging  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0010, LLP 0012, LLP 0013, LLP 0034; `demos/_kit/harness.mjs`

Snapback has strong internal harness and provider-live conformance evidence,
but ordinary apps cannot invoke one published profile for the five properties
backend comparisons routinely need. Signal Desk copied a repository-private
six-check suite instead of declaring its generated refs and domain assertions
to a package-owned helper.

## Desired resolution

- Publish a comparator profile and command, tentatively
  `snapback accept comparator`.
- Accept generated query/mutation/presence refs plus bounded fixture callbacks
  for domain-specific before/after assertions.
- Own isolated database/server lifecycle, app provisioning, two client
  identities, native live transport, timeouts, cleanup, receipt writing, and
  capability-GAP classification.
- Require named checks for cross-client native live delivery, atomic declared
  write set, rejected mutation rollback/no visible version change, TTL plus
  disconnect presence cleanup, and ephemeral publish not advancing the durable
  version.
- Retain expected-check/non-vacuity enforcement, transport attribution,
  cleanup attestation, stable exit codes, and machine-readable receipts.

## Acceptance

- Green packaged fixture and deliberate failure fixtures exist for every named
  property, missing capability, zero/short execution, dead server, timeout,
  cleanup rejection, polling masquerading as push, and stale receipts.
- Receipt schema is Rust-owned or otherwise governed per LLP 0037 and validates
  exact target/artifact/binary identity, checks, timings, cleanup, and
  nonclaims.
- Signal Desk's Snapback acceptance becomes a thin configuration of the kit and
  keeps its six claims.
- One documented command works from a packed/public installation without
  repository-relative imports.
