# Testing

The seed is one system commit before checks and journeys; maintained targets
need no empty seed arrays.

```ts
    profiles: [
      { id: "profile-alice", principal: "dev:alice", displayName: "Alice", handle: "alice_dev", avatarUrl: "https://example.com/alice.png", bio: "", location: "" },
      { id: "profile-bob", principal: "dev:bob", displayName: "Bob", handle: "bob_dev", avatarUrl: "https://example.com/bob.png", bio: "", location: "" },
    ],
```

`profile-alice` is a row id; `dev:alice` is the persona Principal used in
creator, membership and author columns. Seed rows contain no identity email
or password hashes. `avatarUrl` strings are external URLs; seeds cannot mint
asset ledger rows (LLP 1006 §2a). The chat
fixture also keeps `charlie` as an account/persona without a profile so the
idempotent post-auth profile-creation path has a real absent-row proof.

`fixture("fixtures/photo.jpg")` from `snapback2/test` reads bytes relative to
the authored test file, even after compilation; commit media under `tests/fixtures/`.

Write journeys with `journey(name, async ({ as, tick, url }) => …)`. The test
verb starts a fresh isolated owner, runs all six derived check families, runs
every journey through the headless wire client, removes the test store, and
writes `.snapback/receipts/<timestamp>.json`. Zero checks cannot pass. Use
`snapback2 test --blocked "reason"` for an honest blocked receipt.

Select: `snapback2 test --journey "todos round trip"`.
Literal flags: `--journey=--help` / `--journey=-h`; quotes alone do not escape.
Duplicates run; `scope.journey` records scope. Name/body/order/count registration drift
fails before execution. Keep captured state stable: source identity cannot
inspect it. Unsuccessful exits fail. Skips other journeys/top-level derived
checks; embedded offline checks remain. Unknown names fail with available names;
compile/load failures remain. Five-second deadlines and isolation remain.
Cannot combine with `--derived-only` or `--blocked` or infer affected coverage.

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
Receipts count retained carrier rows separately from protected and nulled images.
Journeys share the owner; isolate disposable writes from later inboxes and await
client closes. The chat count probe compares usable inbox arrays and uses its own conversation and personas.

Derived checks use representative seeds, not load-test datasets. Rules compare
all stored rows for each seed persona within 16,384 probes; oversized tables
block with counts and a smaller-seed rewrite. Invalidation witnesses each query's
certificate-intersection groups and concrete-disjoint silence; receipts name
candidate groups and physical attempts. Mutation search uses the first two scopes
and six personas; no committing witness within that limit blocks. Replay covers
every generic mutation independently. Put operation-specific and larger scenarios
in journeys; place useful admitted/excluded personas and scopes near the seed's start.

`dev --stop` stops new effect claims and joins for at most the budget + 1 s,
then logs `outbox.engine: detached` with running IDs. Detachment does not prove
execution stopped; the next boot marks those rows `sent_unknown`.

`reset` reports seed row/persona counts; `reset --empty` skips the seed and stays
empty after restart. Sessions survive either form (`guide operator`).
