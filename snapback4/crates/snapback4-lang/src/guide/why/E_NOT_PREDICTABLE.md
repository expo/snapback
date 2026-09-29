# Prediction — E_NOT_PREDICTABLE

`predicts: eligible` requires device-readable sites and synced writes;
the call still needs its facts on this device and must fit the meter and rules.
`mutation name(args) predicts:` asserts this eligibility: `check` refuses
`E_NOT_PREDICTABLE` at the header if a server site makes it `never`, with
the reason and rewrite. It does not promise prediction on every call. Remove
the named server dependency to keep `predicts`, or remove that assertion and let the client queue
without prediction.
Every `check` summarizes mutations that never predict, insert arms that
never predict, and eligible mutations whose reads can queue without a row
past a horizon, even on an unchanged program. `check --verbose` keeps the full site lists and rewrites; plain `check` gives the verdict and summary first. `why` qualifies the heading:
`predicts: eligible except past the horizon at …`, naming each read and site.
A loss of eligibility
produces one `N_NOT_PREDICTABLE` note per mutation, listing distinct root
causes with deduplicated sites and rewrites.
Every mutation can queue on the local client; eligibility is not a promise
that every call produces a predicted row. Native reads also need their module.
Persisted writes without a valid integer prediction clock queue without rows;
their write and row IDs survive for submission to the server. Direct device
`predict` calls require an explicit integer `now`; `admit` and `enqueue` clear
prediction eligibility and predicted rows when that clock is missing or invalid.

A missing `upsert` predicts its insert when the synced group is held with no
horizon, both the key and the materialized insert image prove readability,
and the viewer-readable partition covers every secondary unique lookup and
affected cap group. The image includes key columns, patch and defaults; a
whole-table cap needs the whole public table. Left groups and unproved
conditions queue without a predicted row and still send `/m` (guide prediction).
`check` calls an upsert with an unprovable insert arm `predicts: updates only`,
and lists that arm in its summary with the first failing horizon, rule or cap
coverage proof. `insert ... if absent` reports the same insert limitation.
An id supplied to `insert ... if absent`, including a parameter or helper result,
needs the `byId` absence proof too. Only an id minted by `new` during the call
(including an omitted id) can use a covered secondary unique key instead.
`check` preserves a local's `new` fact across unrelated requires, reads, emits
and writes. A direct assignment tracks the local's new value; a branch or loop
that may assign it discards its fact. Other locals keep their mint facts.
Membership-scoped reactions with `last 500` cannot prove absence outside that
window; removing it still leaves `(messageId, principal)` unable to decide
`exists members[.conversationId, viewer]`. A viewer-keyed read rule with no
horizon and caps grouped by that viewer predicts a first write but shows only
the viewer's own reactions. Full public sync covers a per-message cap but
makes every reaction public. Membership reads can predict without a horizon
when every unique key and cap group includes `conversationId` and the device
holds the deciding membership row; that acquires all reactions in the held
conversation. None of these means complete children of just the held messages.
If no shape fits the product, this write queues until the server answers;
show its pending state using the returned write's `state` and `client.onWrite`
(guide writes). Changing `upsert` to an existence branch does not supply absence
or cap coverage.
