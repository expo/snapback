# Testing

The seed is static data, applied as one system commit before derived checks and
authored journeys:

```ts
    profiles: [
      { id: "profile-alice", principal: "dev:alice", handle: "alice", name: "Alice", email: "alice@example.com" },
      { id: "profile-bob", principal: "dev:bob", handle: "bob", name: "Bob", email: "bob@example.com" },
    ],
    conversations: [
      { id: "conversation-1", title: "General", creatorId: "dev:alice" },
      { id: "conversation-2", title: "Side room", creatorId: "dev:alice" },
    ],
    memberships: [
      { id: "membership-1", conversationId: "conversation-1", userId: "dev:alice", lastReadAt: 0 },
      { id: "membership-2", conversationId: "conversation-1", userId: "dev:bob", lastReadAt: 0 },
      { id: "membership-3", conversationId: "conversation-2", userId: "dev:alice", lastReadAt: 0 },
    ],
    messages: [
      { id: "message-1", conversationId: "conversation-1", authorId: "dev:alice", body: "Welcome", at: 1 },
      { id: "message-2", conversationId: "conversation-2", authorId: "dev:alice", body: "Side note", at: 1 },
    ],
```

Here `profile-alice` is an application row id while `dev:alice` is the persona
Principal used by creator, membership, and author columns.

Write journeys with `journey(name, async ({ as, tick, url }) => …)`. The test
verb starts a fresh isolated owner, runs all six derived check families, runs
every journey through the headless wire client, removes the test store, and
writes `.snapback/receipts/<timestamp>.json`. Zero checks cannot pass. Use
`snapback2 test --blocked "reason"` for an honest blocked receipt.
