# Handler runtime errors surface as bare SNAPBACK_HANDLER_FAILED with no underlying-error detail

**Status:** Open
**Severity:** P3 (DX; the one 30-grade error class in an otherwise 90-grade diagnostic surface)
**Systems:** Handler runtime, Diagnostics
**Date:** 2026-08-09
**Related:** LLP 0193 (errors-as-docs completeness — this is a concrete
case for the no-refusal failure layer LLP 0207's dissolution routed
there), LLP 0178 (the generate-time standard to match), LLP 0208
(pilot evidence)

## Problem

When a JS handler throws at runtime — e.g. calling a property that
doesn't exist, as in `ctx.runtime.newId()` (a guessable typo for
`ctx.runtime.id()`) — the client sees only:

```
SNAPBACK_HANDLER_FAILED
```

No underlying message, no property name, no position. The LLP 0201 P2
pilot hit this in M2 and called it "markedly worse than everything
around it": the *generate-time* analyzer names file/line/column and the
violated profile and fails closed with the old functions still serving,
while the *runtime* path reduces a `TypeError: ctx.runtime.newId is not
a function` to an opaque code, costing a debugging loop both sessions'
records mention.

The refusal path is the platform's best-scored diagnostic surface;
this is the gap directly beside it.

## Done when

- A handler runtime failure carries the underlying JS error detail —
  message, and where resolvable the property/callee name and handler
  source position — through to the developer-facing surface, at least
  under the dev supervisor (production redaction can stay
  conservative; decide and document the split).
- `ctx.runtime.newId()` (or any missing-member call on a ctx surface)
  reproduces as a test asserting the enriched diagnostic.
- The errors reference (LLP 0193 scope) documents
  `SNAPBACK_HANDLER_FAILED` with its enriched dev form.
