# A3 sweep: application refusals collapse to SNAPBACK_HANDLER_FAILED; clients must parse message prose

**Opened:** 2026-08-01
**Systems:** Runtime, Client protocol
**Related:** LLP 0137 (A3 arm), LLP 0108, demos/improvement-sweep/arms/a3-snapback-web/findings/0137-a3-f3-no-structured-app-refusal-codes.json

Every handler-raised semantic refusal surfaces as the one generic code
`SNAPBACK_HANDLER_FAILED`. The A3 arm's documented conflict semantics
("stale move: revision 2, expected 1"), a consumed invite, and a validation
error are indistinguishable at the code level; the reconciliation branch in
the acceptance client had to key on message text. Host refusals are
exemplary coded vocabulary; app semantics get none. (Convex: developer-
defined ConvexError with structured data.)

Fix shape: a declared refusal channel — handlers throw a typed refusal from
a declared closed set with a JSON-safe details payload validated like a
result contract, carried as `diagnostic.appCode` beside the existing generic
code. Host denials stay terminal and unmaskable. Witness: declared
`STALE_MOVE` observable as `appCode`; undeclared throws stay generic.
