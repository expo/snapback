import { seed } from "snapback2";

export default seed({
  personas: ["alice", "bob", "charlie"],
  rows: {
    profiles: [
      { id: "profile-alice", principal: "dev:alice", displayName: "Alice", handle: "alice", avatarUrl: "https://example.com/alice.png", bio: "", location: "" },
      { id: "profile-bob", principal: "dev:bob", displayName: "Bob", handle: "bob", avatarUrl: "https://example.com/bob.png", bio: "", location: "" },
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
      // Keep the disjoint room first so derived invalidation probes can commit
      // the recipe's messageId-only edit/unsend mutations outside General.
      { id: "message-2", conversationId: "conversation-2", authorId: "dev:alice", body: "derived test", at: 1 },
      { id: "message-1", conversationId: "conversation-1", authorId: "dev:alice", body: "Welcome", at: 1 },
    ],
    deliveries: [
      { id: "delivery-1-alice", recipient: "dev:alice", conversationId: "conversation-1", messageId: "message-1", kind: "message", at: 1 },
      { id: "delivery-1-bob", recipient: "dev:bob", conversationId: "conversation-1", messageId: "message-1", kind: "message", at: 1 },
      { id: "delivery-2-alice", recipient: "dev:alice", conversationId: "conversation-2", messageId: "message-2", kind: "message", at: 1 },
      { id: "delivery-2-charlie", recipient: "dev:charlie", conversationId: "conversation-2", messageId: "message-2", kind: "message", at: 1 },
    ],
    posts: [
      { id: "post-alice", author: "dev:alice", body: "Hello from Alice", at: 1 },
      { id: "post-bob", author: "dev:bob", body: "Hello from Bob", at: 2 },
    ],
    follows: [
      { id: "follow-bob-alice", follower: "dev:bob", followed: "dev:alice", at: 1 },
    ],
    notifications: [
      { id: "notification-1", outboxId: "seed-outbox", effect: "notify", providerId: "seed-provider" },
    ],
  },
});
