# Testing

The static seed is one system commit before derived checks and journeys:
maintained targets need no empty seed arrays.

```ts
    profiles: [
      { id: "profile-alice", principal: "dev:alice", displayName: "Alice", handle: "alice", avatarUrl: "https://example.com/alice.png", bio: "", location: "" },
      { id: "profile-bob", principal: "dev:bob", displayName: "Bob", handle: "bob", avatarUrl: "https://example.com/bob.png", bio: "", location: "" },
    ],
```

Here `profile-alice` is an application row id while `dev:alice` is the persona
Principal used by creator, membership, and author columns. Identity email and
password hashes are deliberately absent from application seed rows. These
`avatarUrl` strings are external URLs, not uploads; asset values are deliberately
absent because seeds cannot mint asset ledger rows (LLP 1006 §2a). The chat
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
Literals: `--journey=--help` or `--journey=-h`, not just quotes.
Duplicates run; scope is `scope.journey`. Focused processes compare
names/body source/order/count; registration drift fails before a wrong body.
Keep captured state stable: source identity cannot inspect it. Unsuccessful
runner exits fail. Skips other journeys and top-level derived checks;
embedded offline checks remain. Unknown names fail with available names;
compile/load failures remain. Five-second deadlines and isolation remain.
Cannot combine with `--derived-only` or `--blocked` or infer affected coverage.
Plain `snapback2 test` runs the full suite.

Projects with scoped memberships also run the canonical `live-revocation`,
`successor-policy-fence`, and `grant-incarnation-aba` authorization proofs.
They bind revocation delivery, active-generation policy, and immutable grant
incarnation to the served loop rather than treating lower-level unit coverage
as the acceptance result. Projected policy probes require IR-proved carrier
fields plus complete protected rows; mixed scalar/array/nested projections block.
Receipts count retained carrier rows separately from protected and nulled images.

Derived checks use a small representative seed, not a load-test dataset.
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
