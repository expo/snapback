# Response coverage replaces the round-1 path-only audit

The round-1 audit was incomplete: query authorization can return E_RULE and its
collector was absent. Both query execution branches now attach it; detached
reader sites are copied with the reader pool's generation, while memory queries
and writes capture sites under the writer's lock.

All JSON response helpers converge on `respond_with_sync`. In dev, a request
scope starts before route dispatch; the response hook inspects the final bytes,
after oversized-response substitution. It handles `denied.code` and `why.code`,
independent of which engine/transport branch created the envelope. The hook
records E_RULE and NOT_FOUND even with no attached collector, including replay,
action-seat/static admission and newly added paths. A raw injected E_RULE through
`respond` tests the backstop without invoking any operation or collector.
An unrelated filtered read earlier in the same request cannot supply the cause
of a later terminal refusal.

Read verdicts and allowance exhaustion record their evaluated declaration.
Query success envelopes with a rejection use FILTERED_READ locally; null/empty
answers (including composed results) without a captured cause use EMPTY_READ
and `cause not instrumented`. This conservative fallback also records ordinary
absence and optional nulls; it does not claim those imply rule denial. No new
public error codes or data fields are introduced. Other refusal codes are
outside this commission unless a future rule path deliberately expands it.

Native trace phase captures read-through exhaustion before the write wrapper
changes the public effect to insert. Missing/expired/read-denied captures still
map to the child's declaration. A query budget refusal maps to its read rule.
No rule is reevaluated, and no storage access or meter change is made for evidence.

Request IDs are process-scoped monotonic identifiers paired with the envelope's
store and instance identities, not caller arguments/row keys. The response
sequence is allocated just before sending, and persistence is handed off after
sending. The writer retains the newest 32 in sequence order, even when a later
response completes before an earlier one. The native shared-memory watermark
advances without filesystem IO on the response path. `why recent` refuses any
persisted snapshot behind that watermark; dropped evidence cannot make the
previous record appear current. Saturation still drops diagnostics, counts them,
and never stalls the request. Stale temp files are unlinked by the sole writer.

Production never starts the scope/trace/writer/watermark. CLI `run`, devices,
background jobs and system seeding do not acquire private row collectors. A dev
HTTP refusal from an uninstrumented entry still receives the response fallback.
