import { api } from "snapback2/client";
import { journey } from "snapback2/test";

journey("alice sends bob a message", async ({ as }) => {
  const alice = as("alice");
  const before = await alice.query(api.messages.thread, { conversationId: "conversation-1" });
  if (!Array.isArray(before.data)) throw new Error("thread did not return rows");
  const sent = await alice.mutation(api.messages.send, {
    conversationId: "conversation-1",
    recipientId: "dev:bob",
    body: "hello bob",
  });
  if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
  const after = await alice.query(api.messages.thread, { conversationId: "conversation-1" });
  if (!after.data.some((row: { body?: string }) => row.body === "hello bob")) throw new Error("sent message was not readable");
});
