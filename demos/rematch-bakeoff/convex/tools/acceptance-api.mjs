// API-level acceptance checks against the local Convex backend.
// Usage: node acceptance-api.mjs [convexUrl]
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const url = process.argv[2] ?? "http://127.0.0.1:3212";
const client = new ConvexHttpClient(url, { skipConvexDeploymentUrlCheck: true });
const api = anyApi;

let pass = 0;
let fail = 0;
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

// 1. Seeded data present
const users = await client.query(api.chat.listUsers, {});
check("seed: 4 users", users.length === 4, `got ${users.length}`);
const amara = users.find((u) => u.handle === "amara");
const ben = users.find((u) => u.handle === "ben");
const convos = await client.query(api.chat.listConversations, {
  userId: amara._id,
});
check(
  "seed: amara has 2 DMs + 1 group",
  convos.length === 3 && convos.filter((c) => c.kind === "group").length === 1,
  `got ${convos.length} convos`
);
const group = convos.find((c) => c.kind === "group");
check("seed: group titled 'Weekend Trip'", group?.title === "Weekend Trip");
const seededMsgs = await client.query(api.chat.listMessages, {
  conversationId: group._id,
});
check("seed: group has messages", seededMsgs.length >= 5, `got ${seededMsgs.length}`);
check(
  "seed: reply pointers resolved",
  seededMsgs.some((m) => m.replyTo && m.replyTo.authorName && m.replyTo.preview)
);
check(
  "seed: reactions aggregated",
  seededMsgs.some((m) => (m.reactions.find((r) => r.emoji === "🎉")?.count ?? 0) >= 2)
);

// 2. Send text message
const sentId = await client.mutation(api.chat.sendMessage, {
  conversationId: group._id,
  authorId: amara._id,
  text: "acceptance: hello from the API check",
});
let msgs = await client.query(api.chat.listMessages, {
  conversationId: group._id,
});
const sent = msgs.find((m) => m._id === sentId);
check("text message sent and readable", sent?.text?.includes("acceptance"));

// 3. Reply pointer
const replyId = await client.mutation(api.chat.sendMessage, {
  conversationId: group._id,
  authorId: ben._id,
  text: "acceptance: replying to you",
  replyToId: sentId,
});
msgs = await client.query(api.chat.listMessages, { conversationId: group._id });
const reply = msgs.find((m) => m._id === replyId);
check(
  "reply pointer resolves to quoted preview",
  reply?.replyTo?.preview?.includes("hello from the API check") &&
    reply?.replyTo?.authorName === "Amara"
);

// 4. Reaction toggle on/off
await client.mutation(api.chat.toggleReaction, {
  messageId: sentId,
  userId: ben._id,
  emoji: "❤️",
});
msgs = await client.query(api.chat.listMessages, { conversationId: group._id });
check(
  "reaction toggles on",
  msgs.find((m) => m._id === sentId)?.reactions.find((r) => r.emoji === "❤️")?.count === 1
);
await client.mutation(api.chat.toggleReaction, {
  messageId: sentId,
  userId: ben._id,
  emoji: "❤️",
});
msgs = await client.query(api.chat.listMessages, { conversationId: group._id });
check(
  "reaction toggles off",
  !msgs.find((m) => m._id === sentId)?.reactions.find((r) => r.emoji === "❤️")
);

// 5. Typing set / clear / cleared-by-send
await client.mutation(api.chat.setTyping, {
  conversationId: group._id,
  userId: ben._id,
  isTyping: true,
});
let typers = await client.query(api.chat.listTyping, {
  conversationId: group._id,
});
check(
  "typing: set visible",
  typers.some((t) => t.name === "Ben" && Date.now() - t.updatedAt < 5000)
);
await client.mutation(api.chat.sendMessage, {
  conversationId: group._id,
  authorId: ben._id,
  text: "acceptance: done typing",
});
typers = await client.query(api.chat.listTyping, { conversationId: group._id });
check(
  "typing: cleared by sending a message",
  !typers.some((t) => t.name === "Ben")
);

// 6. Image upload end-to-end (upload URL -> storage -> message -> served URL)
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z8Dwn4EIwESMolFFlAIAo/gDBRw5UT0AAAAASUVORK5CYII=",
  "base64"
);
const uploadUrl = await client.mutation(api.chat.generateUploadUrl, {});
const uploadResp = await fetch(uploadUrl, {
  method: "POST",
  headers: { "Content-Type": "image/png" },
  body: png,
});
check("image: upload URL accepts POST", uploadResp.ok, `status ${uploadResp.status}`);
const { storageId } = await uploadResp.json();
const imgMsgId = await client.mutation(api.chat.sendMessage, {
  conversationId: group._id,
  authorId: amara._id,
  imageStorageId: storageId,
  text: "acceptance: image caption",
});
msgs = await client.query(api.chat.listMessages, { conversationId: group._id });
const imgMsg = msgs.find((m) => m._id === imgMsgId);
check("image: message has kind=image and URL", imgMsg?.kind === "image" && !!imgMsg?.imageUrl);
const served = await fetch(imgMsg.imageUrl);
const servedBytes = Buffer.from(await served.arrayBuffer());
check(
  "image: served bytes round-trip",
  served.ok && servedBytes.equals(png),
  `status ${served.status}, ${servedBytes.length} bytes`
);

// 7. Conversation list preview updates
const convosAfter = await client.query(api.chat.listConversations, {
  userId: ben._id,
});
const groupAfter = convosAfter.find((c) => c.kind === "group");
check(
  "conversation list: last-message preview reflects image",
  groupAfter?.lastMessage?.text?.startsWith("📷"),
  groupAfter?.lastMessage?.text ?? "none"
);

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail === 0 ? 0 : 1);
