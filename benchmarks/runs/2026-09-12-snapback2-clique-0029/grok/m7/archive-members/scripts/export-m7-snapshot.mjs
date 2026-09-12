#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, api } from "snapback2/client";
import { ownerUrl } from "./replay.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "m7/pre-snapshot");
const personas = JSON.parse(
  await readFile("/home/ccheever/clique-0029-20260912/fixtures/social-messenger/personas.json", "utf8"),
).starter;

const FIELD_MANIFEST = [
  "id",
  "conversationId",
  "senderId",
  "at",
  "type",
  "text",
  "caption",
  "media",
  "edited",
  "tombstone",
  "replyToId",
  "reactions",
  "receipt",
];

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function messageType(row) {
  if (row.oncePhoto) return "once-photo";
  if (row.clip) return "video";
  if (row.photo) return "photo";
  if (row.pollQuestion) return "poll";
  return "text";
}

function mediaRef(row) {
  if (row.oncePhoto) return { kind: "once-photo", id: row.oncePhoto.id };
  if (row.clip) return { kind: "video", id: row.clip.id, duration: row.clip.duration ?? null };
  if (row.photo) return { kind: "photo", id: row.photo.id };
  return null;
}

function reactionSummary(rows, viewer) {
  const byEmoji = new Map();
  for (const row of rows ?? []) {
    const current = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false };
    current.count += 1;
    if (row.principal === viewer) current.mine = true;
    byEmoji.set(row.emoji, current);
  }
  return [...byEmoji.values()].sort((a, b) => a.emoji.localeCompare(b.emoji));
}

function receiptState(own, receipts) {
  if (!own) return null;
  const rows = receipts ?? [];
  if (rows.length === 0) return "sent";
  if (rows.every((row) => row.received === true)) return "delivered";
  return "sent";
}

async function pageAll(client, op, args) {
  const rows = [];
  let cursor = args.c ?? null;
  for (let i = 0; i < 50; i += 1) {
    const page = await client.query(op, { ...args, c: cursor });
    if (!("data" in page) || page.data == null) break;
    const batch = Array.isArray(page.data) ? page.data : [];
    rows.push(...batch);
    if (!page.next) break;
    cursor = page.next;
  }
  return rows;
}

async function snapshotPersona(url, persona) {
  const client = createClient({ url });
  await client.auth.login({ email: persona.email, password: persona.password });
  const me = await client.auth.me();
  const viewer = me.viewer;
  if (!viewer) throw new Error(`login failed for ${persona.id}`);
  const memberships = await pageAll(client, api.groups.mine, { c: null });
  const conversations = [];
  for (const row of memberships) {
    const conversationId = row.conversationId;
    const meta = await client.query(api.groups.conversation, { conversationId });
    const history = await pageAll(client, api.messages.history, { conversationId, c: null });
    const messages = [];
    for (const item of history) {
      const message = item.message ?? item;
      if (!message?.id) continue;
      const reactions = await client.query(api.messages.reactionsOn, { messageId: message.id });
      const receipts = message.authorId === viewer
        ? await client.query(api.messages.receipts, { messageId: message.id })
        : { data: [] };
      messages.push({
        id: message.id,
        conversationId: message.conversationId ?? conversationId,
        senderId: message.authorId,
        at: message.at,
        type: messageType(message),
        text: message.body ?? null,
        caption: message.caption ?? null,
        media: mediaRef(message),
        edited: Boolean(message.editedAt),
        editedAt: message.editedAt ?? null,
        tombstone: Boolean(message.deletedAt),
        deletedAt: message.deletedAt ?? null,
        replyToId: message.quoteId ?? null,
        reactions: reactionSummary(reactions.data, viewer),
        receipt: receiptState(message.authorId === viewer, receipts.data),
      });
    }
    messages.sort((a, b) => a.id.localeCompare(b.id));
    conversations.push({
      conversationId,
      kind: row.conversation?.kind ?? meta.data?.conversation?.kind ?? null,
      title: row.conversation?.title ?? meta.data?.conversation?.title ?? null,
      role: row.role ?? null,
      messageCount: meta.data?.messageCount ?? null,
      memberCount: meta.data?.memberCount ?? null,
      messages,
    });
  }
  conversations.sort((a, b) => a.conversationId.localeCompare(b.conversationId));
  await client.close();
  return {
    persona: persona.id,
    email: persona.email,
    viewer,
    fieldManifest: FIELD_MANIFEST,
    conversations,
  };
}

const url = await ownerUrl(root);
await mkdir(outDir, { recursive: true });
const files = [];
for (const persona of personas) {
  const snapshot = stable(await snapshotPersona(url, persona));
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  const file = `${persona.id}.json`;
  await writeFile(resolve(outDir, file), body);
  files.push({
    persona: persona.id,
    file,
    sha256: sha256(body),
    conversations: snapshot.conversations.length,
    messages: snapshot.conversations.reduce((sum, row) => sum + row.messages.length, 0),
  });
  console.log(`wrote ${file} convos=${files.at(-1).conversations} messages=${files.at(-1).messages}`);
}

const manifest = `${JSON.stringify(stable({
  schemaVersion: "clique-m7-pre-snapshot.v1",
  fieldManifest: "m6-minimum-message-object",
  fields: FIELD_MANIFEST,
  ownerUrl: url,
  at: new Date().toISOString(),
  personas: files,
}), null, 2)}\n`;
await writeFile(resolve(outDir, "manifest.json"), manifest);
console.log(JSON.stringify({ ok: true, outDir, manifestSha256: sha256(manifest), files }, null, 2));
