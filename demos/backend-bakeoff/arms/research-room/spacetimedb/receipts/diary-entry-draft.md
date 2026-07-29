## 2026-07-29 — SpacetimeDB, deep round

### Environment

- Frozen product source: `5f31cb6174daaefa04a1e05242acbbc22c725040`
- Integrated arm base: `04c18b9e8f91b39bf9ba75e0a30e1a3ae1cc1b6b`
- Apartment Air, Apple M5, macOS 26.5.2
- Official standalone and TypeScript client/tool 2.7.0
- Fresh database `llp0102-research-spacetimedb-w1`
- Timed window: 31m 32.6s
- Assistance: official documentation and the completed chat/SpacetimeDB arm
  for generated-client lifecycle conventions

### Outcome

- 13 passes, 2 explicit GAPs, 0 failures
- GAPs: ordinary semantic/vector retrieval and native secret management
- No Stop-class defect
- Exact database deletion returned success; the post-delete SQL probe returned
  `No such database`/404; all assigned and diagnostic ports closed

### What felt good

Private tables plus caller-dependent public views are an unusually crisp way
to build authorization. Alice and Bob subscribe to the same named views, but
each view is evaluated with the caller identity. Mallory's caches remained
empty, and a direct subscription to the private source table was rejected.
Revocation was not needed in this workload, but the model is strong and
observable.

Inline byte arrays made the file scenario direct: the 64 KiB payload,
metadata, hash, delivery, and deletion all participated in database
transactions and subscriptions. Generated bindings omitted every private
table and exposed only the views and reducers.

Schedule tables were the standout feature. They turned each answer step into a
separate authoritative commit, so Bob received four native WebSocket inserts
before the answer's terminal update. The same mechanism cleanly supported
cancellation by deleting future jobs. A scheduled procedure handled the
external refresh and opened a transaction only after its HTTP effect.

The local standalone was fast to start, module builds were consistently around
350–400 ms, and the client SDK's `withConfirmedReads` plus subscription
barriers made the acceptance harness reliable.

### What felt bad or frustrating

The CLI has several sharp edges. `--root-dir` only worked reliably in
`--root-dir=...` form through the installed updater. `server add` rejected
`-y`, and optional-value flags such as `-c always` could consume the positional
database; attached forms (`--delete-data=always`, `--yes=all`) were safer.

The official installer put the updater at the CLI-root path, not
`bin/spacetime`, and the generated TypeScript template chose no package
manager. These are recoverable details, but they cost failed commands before
the ordinary loop became smooth.

Procedure HTTP correctly rejected localhost/private addresses. That is a good
security default, though it means a deterministic local fixture server cannot
exercise scheduled HTTP effects. The first public fixed-response endpoint
returned a non-200 response, so the harness had to use the stable public RFC
2606 text. The failed row was honestly refused rather than counted as a pass.

The security logs label expected reducer authorization errors as `PANIC`,
which looks much more alarming than an ordinary sender error. There also is no
native secret injection surface, despite procedures being designed for API
calls.

### Modeling and correctness

The module used private rooms, memberships, sources, questions, answers,
progress events, search results, refresh runs, and schedule tables. Every
client-visible surface was a caller-dependent view backed by indexed identity
and room lookups. Reducers derived actor identity from the connection.

Question retry was a unique idempotency key. Progress used four scheduled
commits plus a fifth terminal commit. Cancellation updated the terminal fence
and deleted outstanding jobs; a late-patch probe could not add progress.
Complete, failed, cancelled, timed-out, and ambiguous states remained distinct.

Keyword search is application-authored reducer glue over authoritative rows.
Embeddings were stored at the frozen 32 dimensions, but no vector search was
claimed because SpacetimeDB 2.7 has no ordinary vector index/query path.

### Realtime, auth, and operations

Realtime evidence came from generated SDK WebSocket view subscriptions and
row callbacks; there was no product poller. Three independently minted
SpacetimeAuth development identities were hashed in receipts, and raw tokens
were not persisted.

Cleanup needed extra care because closing the controlling SSH sessions did not
terminate three orphaned, arm-owned listeners. Exact command-line inspection
identified the standalone, Vite, and failed-first-run harness processes before
they were terminated. Runtime, CLI, dependency, build, and template state was
moved to an arm-specific recoverable Trash directory.

### Would I choose it?

Yes for a realtime, transaction-heavy collaboration backend when the team is
comfortable putting application logic in the database module. The combination
of reducers, generated bindings, per-caller views, subscriptions, and schedules
is coherent and powerful. I would hesitate for AI-heavy production work until
there is ordinary vector retrieval and a first-class secret store.

### Lessons for Snapback

The end result worth matching is the authorization model's clarity: private
source tables, generated clients that cannot name them, and a single
caller-dependent live view that both filters initial state and keeps the cache
correct as authority changes.

Schedule tables also set a useful bar. Durable jobs are ordinary typed rows,
progress steps become separate transactions, and cancellation can retire the
remaining schedule entries. Snapback's streamed actions are stronger for
effect settlement, but the schedule-table observability and composability are
excellent.

Finally, SpacetimeDB's generated SDK and subscription barrier make the
authoritative client cache easy to inspect in acceptance tests. Snapback should
continue making transport attribution and settled-cache inspection equally
direct.
