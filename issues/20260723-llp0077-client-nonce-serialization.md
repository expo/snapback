# Client per-custody serialization + successor-nonce redaction and indeterminate-success handling

**Status:** Open
**Severity:** P1
**Systems:** Auth, Browser client, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 §Nonce protocol + §Browser custody + defects 5 and 7 (coupled), packages/snapback-client/index.mjs (successor nonce, redaction set, missing-nonce throw), issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, client, nonce

Closes LLP 0077 ledger **defects 5 and 7**, which the Spec states are coupled —
neither may be marked done alone. Defect 7: there is no per-custody queue, so
concurrent client calls each sign under the same generation and race the
successor-nonce compare-and-set; a committed effect can surface as a
stale-authority failure. Defect 5: the client installs the successor
`DPoP-Nonce` without adding it to the diagnostic redaction set, and parses a
successful body before failing on a missing successor nonce, so a committed
effect can be observed as failure and retried.

**Done when:**

- A per-custody serialization queue spans proof creation through
  successor-nonce commit for HTTP, refresh, logout, connection-open, and
  WebSocket initiation (one outstanding proof-bearing request per generation).
- The validated successor nonce is added to the redaction set before any
  response callback or body parse; a reflected-successor test proves it never
  escapes into a projected error.
- A missing-successor-nonce success is classified as an explicit indeterminate
  outcome: no failure reported for a possibly-committed effect, no blind retry
  of a non-idempotent act; test covers a committed non-idempotent effect whose
  successor header is absent.
- LLP 0077's defect 5 and 7 rows move to closed together.
