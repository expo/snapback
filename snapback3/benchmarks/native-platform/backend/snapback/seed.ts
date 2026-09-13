import { seed } from "snapback3";

export default seed({
  personas: ["alice", "bob"],
  rows: {
    conversations: [{ id: "native-room", title: "Native persistence", updatedAt: 1789257600000 }],
    memberships: [
      { id: "native-member-alice", conversationId: "native-room", principal: "dev:alice", displayName: "Alice" },
      { id: "native-member-bob", conversationId: "native-room", principal: "dev:bob", displayName: "Bob" },
    ],
    messages: [
      { id: "native-known-1", conversationId: "native-room", author: "dev:alice",
        body: "Known durable row one", clientTag: "seed-one", ordinal: 1, at: 1789257600000 },
      { id: "native-known-2", conversationId: "native-room", author: "dev:bob",
        body: "Known durable row two", clientTag: "seed-two", ordinal: 2, at: 1789257660000 },
    ],
  },
});
