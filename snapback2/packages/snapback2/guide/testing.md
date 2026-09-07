# Testing

The static seed is one system commit before derived checks and journeys:

```ts
    profiles: [
      { id: "profile-alice", principal: "dev:alice", displayName: "Alice", handle: "alice", avatarUrl: "https://example.com/alice.png", bio: "", location: "", link: null },
      { id: "profile-bob", principal: "dev:bob", displayName: "Bob", handle: "bob", avatarUrl: "https://example.com/bob.png", bio: "", location: "", link: null },
    ],
    conversations: [
      { id: "conversation-1", title: "General", creatorId: "dev:alice" },
      { id: "conversation-2", title: "Side room", creatorId: "dev:alice" },
    ],
    memberships: [
      { id: "membership-1", conversationId: "conversation-1", principal: "dev:alice", role: "admin", joinedAt: 0 },
      { id: "membership-2", conversationId: "conversation-1", principal: "dev:bob", role: "member", joinedAt: 0 },
      { id: "membership-3", conversationId: "conversation-2", principal: "dev:alice", role: "admin", joinedAt: 0 },
      { id: "membership-4", conversationId: "conversation-2", principal: "dev:charlie", role: "member", joinedAt: 0 },
    ],
    messages: [
      { id: "message-1", conversationId: "conversation-1", authorId: "dev:alice", body: "Welcome", at: 1 },
      { id: "message-2", conversationId: "conversation-2", authorId: "dev:alice", body: "Side note", at: 1 },
    ],
```

Here `profile-alice` is an application row id while `dev:alice` is the persona
Principal used by creator, membership, and author columns. Identity email and
password hashes are deliberately absent from application seed rows. These
`avatarUrl` strings are external URLs, not uploads; asset values are deliberately
absent because seeds cannot mint asset ledger rows (LLP 1006 §2a). The chat
fixture also keeps `charlie` as an account/persona without a profile so the
idempotent post-auth profile-creation path has a real absent-row proof.

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
as the acceptance result.

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
