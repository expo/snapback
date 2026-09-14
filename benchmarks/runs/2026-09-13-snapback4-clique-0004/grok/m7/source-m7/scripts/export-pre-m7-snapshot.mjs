#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { login, query, SNAPBACK_URL } from "./api.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = resolve(root, "m7/pre-snapshot");

const M6_MESSAGE_FIELDS = [
  "id",
  "conversationId",
  "authorId",
  "at",
  "body",
  "caption",
  "photo",
  "photoOnce",
  "clip",
  "editedAt",
  "tombstoned",
  "quoteId",
  "myReaction",
  "pending",
];

function stable(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stable);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
  return out;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function mediaRef(value) {
  if (!value || typeof value !== "object") return value ?? null;
  return { id: value.id };
}

function projectMessage(row) {
  const reaction = row.myReaction
    ? { emoji: row.myReaction.emoji, principal: row.myReaction.principal, messageId: row.myReaction.messageId }
    : null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    authorId: row.authorId,
    at: row.at,
    body: row.body ?? null,
    caption: row.caption ?? null,
    photo: mediaRef(row.photo),
    photoOnce: mediaRef(row.photoOnce),
    clip: mediaRef(row.clip),
    editedAt: row.editedAt ?? null,
    tombstoned: !!row.tombstoned,
    quoteId: row.quoteId ?? null,
    myReaction: reaction,
    pending: row.pending ?? false,
  };
}

async function pageQuery(token, name, args = {}) {
  const rows = [];
  let c = args.c ?? null;
  for (let i = 0; i < 50; i += 1) {
    const res = await query(token, name, { ...args, c });
    if (res.body?.denied) throw new Error(`${name} denied ${JSON.stringify(res.body.denied)}`);
    const data = res.body?.data;
    if (Array.isArray(data)) rows.push(...data);
    else if (data != null && i === 0) return { rows: data, raw: res.body };
    const next = res.body?.next ?? null;
    if (!next) break;
    c = next;
  }
  return { rows };
}

async function snapshotPersona(persona) {
  const auth = await login(persona.email, persona.password);
  if (!auth.body?.session) throw new Error(`login failed ${persona.id}: ${JSON.stringify(auth.body)}`);
  const token = auth.body.session.token;
  const principal = auth.body.session.principal;
  const me = await query(token, "me", {});
  const inbox = await pageQuery(token, "inbox", {});
  const conversations = [];
  for (const row of inbox.rows) {
    const conversationId = row.conversationId;
    const conv = await query(token, "conversationOf", { conversationId });
    const thread = await pageQuery(token, "threadMessages", { conversationId });
    const receipts = await query(token, "convReceipts", { conversationId });
    const reactions = await query(token, "convReactions", { conversationId });
    const recipients = await query(token, "convRecipients", { conversationId });
    conversations.push({
      conversationId,
      membership: {
        role: row.role,
        joinedAt: row.joinedAt,
        unread: row.unread ? { count: row.unread.count } : null,
      },
      conversation: conv.body?.data
        ? {
            id: conv.body.data.id,
            kind: conv.body.data.kind,
            name: conv.body.data.name ?? null,
            description: conv.body.data.description ?? null,
            color: conv.body.data.color,
            disappearing: conv.body.data.disappearing,
            background: mediaRef(conv.body.data.background),
            creatorId: conv.body.data.creatorId,
            createdAt: conv.body.data.createdAt,
          }
        : null,
      messages: thread.rows.map(projectMessage),
      receipts: (receipts.body?.data ?? []).map((r) => ({
        messageId: r.messageId,
        conversationId: r.conversationId,
        principal: r.principal,
        state: r.state,
        at: r.at,
      })),
      reactions: (reactions.body?.data ?? []).map((r) => ({
        messageId: r.messageId,
        conversationId: r.conversationId,
        principal: r.principal,
        emoji: r.emoji,
      })),
      recipients: (recipients.body?.data ?? []).map((r) => ({
        messageId: r.messageId,
        conversationId: r.conversationId,
        principal: r.principal,
      })),
    });
  }
  return {
    persona: persona.id,
    email: persona.email,
    principal,
    me: me.body?.data
      ? {
          principal: me.body.data.principal,
          displayName: me.body.data.displayName,
          handle: me.body.data.handle,
          bio: me.body.data.bio,
          avatar: mediaRef(me.body.data.avatar),
        }
      : null,
    conversations,
  };
}

const personas = JSON.parse(await readFile(resolve(root, "fixtures/personas.json"), "utf8")).starter;
await mkdir(outDir, { recursive: true });
const files = [];
for (const persona of personas) {
  const snap = await snapshotPersona(persona);
  const json = `${JSON.stringify(stable(snap), null, 2)}\n`;
  const name = `${persona.id}.json`;
  const path = resolve(outDir, name);
  await writeFile(path, json);
  files.push({
    persona: persona.id,
    file: name,
    sha256: sha256(json),
    bytes: Buffer.byteLength(json),
    conversations: snap.conversations.length,
    messages: snap.conversations.reduce((n, c) => n + c.messages.length, 0),
    receipts: snap.conversations.reduce((n, c) => n + c.receipts.length, 0),
    reactions: snap.conversations.reduce((n, c) => n + c.reactions.length, 0),
    mediaMessages: snap.conversations.reduce(
      (n, c) => n + c.messages.filter((m) => m.photo || m.photoOnce || m.clip).length,
      0,
    ),
  });
  console.log(`wrote ${name} messages=${files.at(-1).messages} receipts=${files.at(-1).receipts} reactions=${files.at(-1).reactions}`);
  await new Promise((r) => setTimeout(r, 250));
}

const card = await fetch(`${SNAPBACK_URL}/`).then((r) => r.json());
const manifest = {
  format: "clique-m7-pre-snapshot.v1",
  exportedAt: new Date().toISOString(),
  backend: SNAPBACK_URL,
  fieldManifest: "M6",
  messageFields: M6_MESSAGE_FIELDS,
  sources: {
    inbox: "query inbox",
    conversation: "query conversationOf",
    messages: "query threadMessages (paged)",
    receipts: "query convReceipts",
    reactions: "query convReactions",
    recipients: "query convRecipients",
    profile: "query me",
  },
  server: {
    snapback4: card.snapback4 ?? null,
    generation: card.generation ?? null,
    tables: (card.tables ?? []).map((t) => t.name),
    ops: (card.ops ?? []).map((o) => o.name),
  },
  files,
};
const manifestJson = `${JSON.stringify(stable(manifest), null, 2)}\n`;
await writeFile(resolve(outDir, "manifest.json"), manifestJson);
manifest.manifestSha256 = sha256(manifestJson);
await writeFile(resolve(outDir, "manifest.json"), `${JSON.stringify(stable(manifest), null, 2)}\n`);
console.log(JSON.stringify({ ok: true, files: files.length, manifest: "m7/pre-snapshot/manifest.json" }, null, 2));
