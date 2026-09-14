#!/usr/bin/env node
import { login, mutate, query } from "./api.mjs";

const alice = await login("alice@example.com", "Alice!Clique2026");
const token = alice.body.session.token;
const thread = await query(token, "threadMessages", { conversationId: "g-starter" });
if (thread.body?.denied) throw new Error(JSON.stringify(thread.body.denied));
const existing = (thread.body.data ?? []).find((m) => m.question && !m.tombstoned);
if (existing) {
  console.log(JSON.stringify({ ok: true, reused: existing.id, question: existing.question }));
  process.exit(0);
}
const messageId = "sm-m7-weekend-poll";
const write = await mutate(token, "createPoll", {
  messageId,
  conversationId: "g-starter",
  question: "Where should we go this weekend?",
  optionA: "Beach",
  optionB: "Mountains",
  optionC: "City",
});
if (write.body?.state === "failed") throw new Error(JSON.stringify(write.body));
console.log(JSON.stringify({ ok: true, created: messageId, state: write.body?.state }));
