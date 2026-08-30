import { seed } from "snapback2";

export default seed({
  personas: ["alice", "bob"],
  rows: {
    profiles: [
      { id: "dev:alice", handle: "alice", name: "Alice", email: "alice@example.com" },
      { id: "dev:bob", handle: "bob", name: "Bob", email: "bob@example.com" },
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
    messageCounts: [],
    notifications: [
      { id: "notification-1", outboxId: "seed-outbox", effect: "notify", providerId: "seed-provider" },
    ],
  },
});
