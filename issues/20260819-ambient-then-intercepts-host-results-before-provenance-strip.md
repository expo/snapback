# Ambient `.then` intercepts host results before media provenance is stripped

**Status:** Open
**Filed:** 2026-08-19
**Severity:** Medium
**Systems:** Runtime, Security/authorization, Media
**Related:** LLP 0009, LLP 0244, `bccb73724`

## Finding

`adoptHostResult` (`packages/snapback-harness/ctx-bootstrap.js:627`) reads and invokes
`value.then` on host-owned results. A handler can install `Object.prototype.then`, so
application code runs on a host-owned synchronous result *before* `adoptMedia` removes
`__snapbackMediaProvenanceV1`.

## Failure scenario

The inherited `then` reads the provenance token, constructs a clone carrying it, deletes
the poisoned method, and hands the clone to the adoption callback. The reviewer reported
a cloned media value producing a valid `media.handoff` occurrence with the stolen token.
LLP 0244 requires that copying must not preserve provenance; here it does.

## Provenance

Found by an independent codex `gpt-5.6-sol` review of `bccb73724`, which reported
reproducing the token theft. A second reviewer (grok-4.6) saw the same `.then` sites and
judged them non-exploitable for export selection — which is true and is a different
question from provenance theft. Not independently reproduced by the orchestrator; the
cited site is verified to exist.

## Acceptance

- Thenable adoption of host-owned results does not consult application-reachable
  `Object.prototype.then`, or provenance is stripped before any application code can
  observe the value.
- A regression proves a cloned media value cannot carry usable provenance.
