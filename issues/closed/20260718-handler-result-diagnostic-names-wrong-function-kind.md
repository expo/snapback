# SNAPBACK_HANDLER_RESULT_INVALID blames "live query handler" for ordinary queries

**Status:** Closed
**Severity:** P3
**Systems:** Runtime, Diagnostics
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-18
**Related:** guide/backend/queries.md; demos/shindig (diary 0015); ENG-25263
**Marker:** diagnostics, defineJsQuery, rows-array, message-accuracy

A `defineJsQuery` handler that returns a single object (a natural shape for a
point read like `getEvent`) fails at runtime with:

    SNAPBACK_HANDLER_RESULT_INVALID: live query handler must return an array of rows

The contract is correct — JS query handlers return row arrays — but the
message names the wrong function kind for an ordinary `Query`, which sends
the author hunting in live-query land. The rows-array contract is also not
stated on the guide's queries page (that half is ENG-25263).

**Done when:**

- The diagnostic message names the actual function kind (`query handler` /
  `live query handler` / etc.) or drops the kind qualifier entirely, and
  ideally names the offending function.
- A codegen or load-time hint is considered for JS `Query` definitions (cheap
  static case: handler `return` of an object literal), though runtime
  accuracy alone closes this ticket.
- An acceptance or unit test pins the message shape for both kinds.

## Resolution

Closed 2026-07-18. `SNAPBACK_HANDLER_RESULT_INVALID` now derives the label from
the declared function kind and includes the function id. One runtime test
pins both `query handler` and `live query handler`, and the query guide states
the row-array result contract for point reads.
