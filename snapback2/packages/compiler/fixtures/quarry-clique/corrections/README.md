# Grok app corrections

`grok-app.patch` is the bounded source delta reproduced from the 2026-09-09
Clique benchmark evidence. It intentionally contains only application source
and seed changes: no grader, credentials, generated output, database state, or
provider configuration.

The evidence snapshot used the immediately preceding Quarry declaration
spelling. Before semantic checks, the reproduction applied the mechanical V2
adapter (`fn`/`maintain` colon headers, job parentheses, inline schedule target
calls). The unadapted snapshot produced 28 syntax diagnostics (6 in
`access.q`, 3 in `admin.q`, 1 in `messages.q`, and 18 in `schema.q`); after the
adapter and the corrections in this patch, the copied app compiled and
certified 65 operations. The executable, current-spelling recipe proofs live in
`fixtures/quarry-schedules` and their owning compiler checks.

The first atomic digest used the full follow rows and measured 4,464,679 bytes
against the 4 MiB closure ceiling. Persisting partial totals would have made
authorization stale between chunks. The retained patch instead keeps a compact
500-row digest-follow mirror equal to the public follow relation in the same
follow/unfollow transaction; current 50-row memberships and maintained period
counts remain in the one profile transaction that admits the unique digest,
log and effect. Post creation never loops over followers.

On an isolated owner, the adapted pre-correction copy failed the focused
journeys with `stored expiry was null` and a full 84-scalar preview. The patched
copy passed both journeys (47 ms and 40 ms respectively). Its local effect
returns a deterministic result without calling `fetch`; no provider request
was made.
