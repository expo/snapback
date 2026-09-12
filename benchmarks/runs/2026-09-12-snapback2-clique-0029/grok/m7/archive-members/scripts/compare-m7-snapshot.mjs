#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, api } from "snapback2/client";
import { ownerUrl } from "./replay.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preDir = resolve(root, "m7/pre-snapshot");
const personas = JSON.parse(
  await readFile("/home/ccheever/clique-0029-20260912/fixtures/social-messenger/personas.json", "utf8"),
).starter;

function messageType(row) {
  if (row.oncePhoto) return "once-photo";
  if (row.clip) return "video";
  if (row.photo) return "photo";
  if (row.pollQuestion) return "poll";
  return "text";
}

function mediaRef(row) {
  if (row.oncePhoto) return { kind: "once-photo", id: row.oncePhoto.id };
  if (row.clip) return { kind: "video", id: row.clip.id };
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

async function pageAll(client, op, args) {
  const rows = [];
  let cursor = args.c ?? null;
  for (let i = 0; i < 50; i += 1) {
    const page = await client.query(op, { ...args, c: cursor });
    if (!("data" in page) || page.data == null) break;
    rows.push(...(Array.isArray(page.data) ? page.data : []));
    if (!page.next) break;
    cursor = page.next;
  }
  return rows;
}

function indexMessages(snapshot) {
  const map = new Map();
  for (const convo of snapshot.conversations) {
    for (const message of convo.messages) {
      map.set(message.id, { conversationId: convo.conversationId, message });
    }
  }
  return map;
}

const url = await ownerUrl(root);
const mismatches = [];
for (const persona of personas) {
  const pre = JSON.parse(await readFile(resolve(preDir, `${persona.id}.json`), "utf8"));
  const client = createClient({ url });
  await client.auth.login({ email: persona.email, password: persona.password });
  const me = await client.auth.me();
  const memberships = await pageAll(client, api.groups.mine, { c: null });
  const current = new Map();
  for (const row of memberships) {
    const history = await pageAll(client, api.messages.history, { conversationId: row.conversationId, c: null });
    for (const item of history) {
      if (item == null) continue;
      const message = item.message ?? item;
      if (!message?.id) continue;
      const reactions = await client.query(api.messages.reactionsOn, { messageId: message.id });
      current.set(message.id, {
        id: message.id,
        conversationId: message.conversationId ?? row.conversationId,
        senderId: message.authorId,
        type: messageType(message),
        text: message.body ?? null,
        caption: message.caption ?? null,
        media: mediaRef(message),
        edited: Boolean(message.editedAt),
        tombstone: Boolean(message.deletedAt),
        replyToId: message.quoteId ?? null,
        reactions: reactionSummary(reactions.data, me.viewer),
      });
    }
  }
  await client.close();
  const previous = indexMessages(pre);
  for (const [id, { message }] of previous) {
    const now = current.get(id);
    if (!now) {
      mismatches.push({ persona: persona.id, id, reason: "missing-after-migration" });
      continue;
    }
    for (const field of ["conversationId", "senderId", "type", "text", "caption", "edited", "tombstone", "replyToId"]) {
      if (now[field] !== message[field]) {
        mismatches.push({ persona: persona.id, id, field, before: message[field], after: now[field] });
      }
    }
    const beforeMedia = message.media?.id ?? null;
    const afterMedia = now.media?.id ?? null;
    if (beforeMedia !== afterMedia) {
      mismatches.push({ persona: persona.id, id, field: "media", before: beforeMedia, after: afterMedia });
    }
    const beforeReact = JSON.stringify(message.reactions);
    const afterReact = JSON.stringify(now.reactions);
    if (beforeReact !== afterReact) {
      mismatches.push({ persona: persona.id, id, field: "reactions", before: message.reactions, after: now.reactions });
    }
  }
}

const report = {
  ok: mismatches.length === 0,
  comparedPersonas: personas.length,
  mismatches,
};
await writeFile(resolve(root, "m7/snapshot-compare.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, mismatches: mismatches.length }, null, 2));
if (!report.ok) process.exit(1);
