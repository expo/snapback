# Testing

The static seed is one system commit before derived checks and journeys:
maintained targets need no empty seed arrays.

```ts
    profiles: [
      { id: "profile-alice", principal: "dev:alice", displayName: "Alice", handle: "alice_dev", avatarUrl: "https://example.com/alice.png", bio: "", location: "" },
      { id: "profile-bob", principal: "dev:bob", displayName: "Bob", handle: "bob_dev", avatarUrl: "https://example.com/bob.png", bio: "", location: "" },
    ],
```

Seed ids such as `profile-alice` are application ids; `dev:alice` is a
Principal. Seeds omit identity credentials and assets, which require uploads.
The chat fixture keeps `charlie` without a profile to test profile creation.

`fixture("fixtures/photo.jpg")` from `snapback2/test` reads bytes relative to
the authored test file, even after compilation; commit media under `tests/fixtures/`.

Write journeys with `journey(name, async ({ as, tick, effects, url }) => …)`. The test
verb starts a fresh isolated owner, runs all six derived check families, runs
every journey through the headless wire client, removes the test store, and
writes `.snapback/receipts/<timestamp>.json`. Zero checks cannot pass. Use
`snapback2 test --blocked "reason"` for an honest blocked receipt.

Select: `snapback2 test --journey "todos round trip"`.
Use `--journey=--help` or `--journey=-h` for literal names. Duplicates run; selection records `scope.journey`, and skips unrelated journeys and
upper-level derived checks; embedded offline checks remain. Unknown names,
registration drift and unsuccessful runner exits fail. Five-second deadlines
and owner isolation remain. Cannot combine with `--derived-only` or `--blocked`.
Plain `snapback2 test` runs the full suite.

Journey `effects.rows({ state, after, limit })` pages the server outbox by
`(seq, id)`, up to 200 rows; pass the returned `after` until null.
`effects.settle({ upTo: sent.seq, budgetMs: 1000 })` runs a due background turn
and waits for those emissions, including `then`. Check `settled`, `rows`, and
`remaining`: backoff (with `nextAt`), then_pending, running, engine:none, budget.
`tick(ms)` advances retry eligibility. Results over 16 KiB carry `resultCapped`;
`guide effects` defines receipts and limits. Without an engine, `effects.settle`
still pumps a pending `then` and waits out a backoff that would land inside its
budget; it returns at once only when nothing ≤ `upTo` can move. The run is
`blocked: effects:no-engine`, even if the journey throws on unsettled work;
after `effects.settle` a queued row cannot pass. The derived effects check also
remains `blocked: no engine in this build`.

Projects with scoped memberships also run the canonical `live-revocation`,
`successor-policy-fence`, and `grant-incarnation-aba` authorization proofs.
They bind revocation delivery, active-generation policy, and immutable grant
incarnation to the served loop rather than treating lower-level unit coverage
as the acceptance result. Projected policy probes require IR-proved carrier
fields plus complete protected rows; mixed scalar/array/nested projections block.
Guards must be independent of the denied table: only literals, arguments, viewer and
self-readable membership existence with stable keys are proved. Unproved terminal control
flow blocks, including merges anywhere in expressions; `detail.candidates` names
each rejected query and its reason.
Journeys share the owner; isolate disposable writes from later inboxes and await
client closes.

Derived checks use a small seed.
Rules compare every stored row for every seed persona, within a 16,384-probe
budget; oversized tables block with the counts and a smaller-seed rewrite.
Invalidation witnesses each query's distinct certificate-intersection groups
and concrete-disjoint silence, rather than testing every query/mutation pair.
The receipt names the candidate groups and actual physical attempts. Mutation
search uses the first two scopes and six personas; if no committing witness is
found within the limit, the check blocks. Replay still covers every generic
mutation independently. Put operation-specific behavior and larger scenarios
in authored journeys, and keep useful admitted and excluded personas and scopes
near the start of the seed.

`dev --stop` admits no new effect claims and joins the runner for at most the
budget + 1 s; only if the thread is still running does it log
`outbox.engine: detached` with the running ids. Detachment does not prove
execution stopped; the next boot marks those rows `sent_unknown`.

`reset` reports seed row and persona counts; `reset --empty` skips the seed
and stays empty after restart. Sessions survive either form (`guide operator`).
