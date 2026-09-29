# Search — E_QUERY_HELD

The newest form below merges the viewer's rooms by `at` and `id`, with
one verdict per scope when its prefix decides the rule. Its uniform lane
source runs under the examined meter: `check --cost` prints `lanes ≤ meter`;
an explicit `first N` above 50 still emits N_WIDE_MERGE. Use the grouped form,
which pages memberships and includes each chat's hits, when opening all rooms
cannot fit.
A pinned conjunct such as `exists members[.roomId, viewer]` can deny a scope
before word discovery even when another conjunct needs each row. Admitted
non-uniform scopes keep per-row costs and remain incomplete; hidden rows
there still spend the query-wide examined/index-entry budget. The admitted non-uniform scope's 32-word
bound records a word cut without cutting later lanes; operator
results name it in `word_cut_at`, separately from a meter cut in `capped_at`.
Device reads and uniform server reads expose `cut: 'words'` or `cut: 'meter'`
beside `complete`; `meter` wins if both limits cut. Non-uniform server reads
report `cut: null`: their reason is withheld, with `complete: false` still truthful.
`null` means "not disclosed here", not "not cut". Render "Results may be incomplete"
for `complete: false` with `cut: null`, even when empty; never "no matches".
The precise reason remains in development-only `Read.meter.cut`; `serve` never
returns that meter. If the server cannot answer the query, declare `query … held:`
to answer from the device; the server refuses it with E_QUERY_HELD. Call a held
query through a local client over acquired partitions; it has no server fallback. Use the grouped
membership read for a server answer.
Uniform word expansion is bounded by the meter. A cut during discovery or
opening returns `complete: false, cut: 'meter'` with no continuation.
Heap exhaustion clears the page: `data: null`, `complete: false`,
`cut: 'meter'`, no `next`.
Merged pages return no `next` for a non-uniform answer, an opening cut or a
word-limit cut. A resumable read-meter cut while an owning uniform lazy merge drains established heads
can carry `next` after its last fully shaped emitted row (§5.6), subject to final-answer eligibility, with `complete: false, cut: 'meter'`.
Heap exhaustion clears the whole page even during the drain; step exhaustion aborts and output exhaustion can refuse after materialisation.
A terminal full page need not carry `next`.
Following that cursor does not clear the earlier page's incompleteness in `usePage`. Reads inside
`where` use their own rules and search terms. Even an empty matching result
past a device horizon is incomplete; a held group can fall back to the server.

Declare `query name(..) held:` for a device-only answer. `check --verbose` prints
`runs: device (held; server refuses E_QUERY_HELD; no server fallback)`.
`dev`, `serve` and `run` refuse it with E_QUERY_HELD and a guide search rewrite;
the local clients answer from held rows, online or offline, without server
fallback even at a horizon or cut. With horizon-free sources, `check --verbose` reports
horizon-free source coverage. Answer completeness still depends on runtime
authorization and limits; the marker does not acquire rows.
An unscoped search through expiring memberships can remain non-uniform and
incomplete below every limit. A full `first 1` page is complete without a cursor. Read `complete` on each answer; a held query with an
online-only source or no read sites gets no source-coverage line.
Sources include reads nested in expressions such as the search text after `matching`.
For full server history beyond holdings, use the grouped or newest form on the search card.
