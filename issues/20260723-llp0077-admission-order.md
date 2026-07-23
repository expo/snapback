# Admission ordering: D3 throttle before proof; forbidden-field before credential; client URI rejection

**Status:** Open
**Severity:** P2
**Systems:** Auth, HTTP, Browser client, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 §HTTP binding (verification order) + defect 12 and defect 11 (URI half), LLP 0060 D3 (shared throttle), LLP 0058 (forbidden-authority-field precedence), src/auth/deployment.rs, src/server.rs (SessionAuth vs forbidden-field), packages/snapback-client/index.mjs (canonicalSenderUri), issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, admission, canonicalization

Closes LLP 0077 ledger **defect 12** and the URI half of **defect 11**.

Defect 12: the LLP 0060 D3 shared-throttle charge is not performed before proof
processing (the hosted serving authority holds only admission and origin), and
the shipped code resolves `SessionAuth` before the forbidden-authority-field
body check rather than in the specified route-scoped order. Bounded carrier
classification/family lookup may precede the single limiter transaction, but
proof verification and body polling stay after it.

Defect 11 (URI half): the browser client canonicalizes with WHATWG
`new URL(path, origin)`, which **resolves** dot-segments and normalizes rather
than **rejecting** `%`/backslash/doubled-slash/`.`/`..` paths, and uses
character/length regexes rather than decode-and-re-encode canonicality.

**Done when:**

- A shared D3 authority charges all applicable buckets atomically (including on
  denial) at the pinned point in the admission order; denial-charge tests cover
  malformed proof, unknown carrier, refresh, and connection-open.
- The forbidden-authority-field check runs after sender admission and before
  credential resolution, per the LLP 0058 route-scoped reorder; a
  proof × bearer × forbidden-field precedence test lands.
- The client rejects (never resolves) `%`/backslash/doubled-slash/dot-segment
  paths and uses decode-and-re-encode canonicality; a shared cross-language URI
  negative corpus covers every prohibited form.
- LLP 0077's defect 12 row and the URI half of defect 11 move to closed.
