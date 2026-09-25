import { appendFile, mkdir } from "node:fs/promises";
import { createClient, mintId } from "snapback4/client";
import { runWorker } from "snapback4/worker";

const url = process.env.SNAPBACK_URL;
const token = process.env.SNAPBACK_SERVICE_TOKEN;
if (!url || !token) {
  console.error("worker missing SNAPBACK_URL or SNAPBACK_SERVICE_TOKEN");
  process.exit(1);
}

const logPush = { kind: "mutation", name: "logPush", predicts: "eligible" };

async function record(kind, payload) {
  await mkdir("data", { recursive: true });
  const line = JSON.stringify({ kind, payload, at: Date.now() }) + "\n";
  await appendFile("data/push.jsonl", line);
  const client = createClient({ url, token });
  try {
    await client.mutate(logPush, {
      targetUserId: payload.targetUserId,
      chatId: payload.chatId ?? null,
      senderDisplayName: String(payload.senderDisplayName ?? ""),
      preview: String(payload.preview ?? "").slice(0, 80),
      kind: kind === "digest" ? "digest" : "message",
      periodStart: payload.periodStart ?? null,
      periodEnd: payload.periodEnd ?? null,
      newFollowers: payload.newFollowers ?? null,
      newPostsInFollowing: payload.newPostsInFollowing ?? null,
      unreadMessages: payload.unreadMessages ?? payload.unread ?? null,
      unreadChats: payload.unreadChats ?? payload.chats ?? null,
    }, { id: mintId() });
  } finally {
    await client.close();
  }
}

runWorker({
  url,
  token,
  effects: {
    notify: async (payload) => {
      await record("message", payload);
      return { providerId: "log" };
    },
    digestPush: async (payload) => {
      await record("digest", payload);
      return { providerId: "log" };
    },
  },
});
