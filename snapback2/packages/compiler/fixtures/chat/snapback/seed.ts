import { seed } from "snapback2";

export default seed({
  personas: ["alice", "bob"],
  rows: {
    profiles: [
      { id: "dev:alice", handle: "alice", name: "Alice", email: "alice@example.com" },
      { id: "dev:bob", handle: "bob", name: "Bob", email: "bob@example.com" },
    ],
    conversations: [{ id: "conversation-1", title: "General", creatorId: "dev:alice" }],
    memberships: [
      { id: "membership-1", conversationId: "conversation-1", userId: "dev:alice", lastReadAt: 0 },
      { id: "membership-2", conversationId: "conversation-1", userId: "dev:bob", lastReadAt: 0 },
    ],
    messages: [],
    messageCounts: [],
    notifications: [],
  },
});
