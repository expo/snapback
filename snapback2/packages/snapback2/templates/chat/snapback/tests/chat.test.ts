import { api } from "snapback2/client";
import { journey } from "snapback2/test";

journey("alice sends bob a message", async ({ as }) => {
  const alice = as("alice");
  const before = await alice.query(api.messages.thread, { conversationId: "conversation-1" });
  if (!("data" in before) || !Array.isArray(before.data)) throw new Error("thread did not return rows");
  const sent = await alice.mutation(api.messages.send, {
    conversationId: "conversation-1",
    recipientId: "profile-bob",
    body: "hello bob",
  });
  if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
  const after = await alice.query(api.messages.thread, { conversationId: "conversation-1" });
  if (!("data" in after) || !after.data.some((row: { body?: string }) => row.body === "hello bob")) throw new Error("sent message was not readable");
});

journey("bob replies and alice's live thread updates", async ({ as }) => {
  const alice = as("alice");
  const bob = as("bob");
  const thread = alice.subscribe(
    api.messages.thread,
    { conversationId: "conversation-1" },
    () => {},
  );
  try {
    await thread.until((delivery) => delivery.state === "complete");
    const sent = await bob.mutation(api.messages.send, {
      conversationId: "conversation-1",
      recipientId: "profile-alice",
      body: "hello alice",
    });
    if (sent.state !== "committed") throw new Error(`reply was ${sent.state}`);
    await thread.until((delivery) =>
      "data" in delivery
      && Array.isArray(delivery.data)
      && delivery.data.some((row: { body?: string }) => row.body === "hello alice")
    );
  } finally {
    thread.close();
  }
});
