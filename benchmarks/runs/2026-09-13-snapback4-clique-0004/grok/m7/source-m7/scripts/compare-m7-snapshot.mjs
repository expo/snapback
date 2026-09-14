#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { login, query } from "./api.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const preDir = resolve(root, "m7/pre-snapshot");

function mediaId(value) {
  return value?.id ?? null;
}

function projectMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    authorId: row.authorId,
    at: row.at,
    body: row.body ?? null,
    caption: row.caption ?? null,
    photo: mediaId(row.photo),
    photoOnce: mediaId(row.photoOnce),
    clip: mediaId(row.clip),
    editedAt: row.editedAt ?? null,
    tombstoned: !!row.tombstoned,
    quoteId: row.quoteId ?? null,
    myReaction: row.myReaction
      ? { emoji: row.myReaction.emoji, principal: row.myReaction.principal, messageId: row.myReaction.messageId }
      : null,
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
    const next = res.body?.next ?? null;
    if (!next) break;
    c = next;
  }
  return rows;
}

function indexBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) map.set(keyFn(row), row);
  return map;
}

function receiptKey(r) {
  return `${r.messageId}|${r.principal}|${r.state}`;
}
function reactionKey(r) {
  return `${r.messageId}|${r.principal}|${r.emoji}`;
}

const personas = JSON.parse(await readFile(resolve(root, "fixtures/personas.json"), "utf8")).starter;
const mismatches = [];
const perPersona = [];

for (const persona of personas) {
  const pre = JSON.parse(await readFile(resolve(preDir, `${persona.id}.json`), "utf8"));
  const auth = await login(persona.email, persona.password);
  if (!auth.body?.session) throw new Error(`login failed ${persona.id}`);
  const token = auth.body.session.token;
  const inbox = await pageQuery(token, "inbox", {});
  const convIds = new Set(inbox.map((r) => r.conversationId));
  for (const conv of pre.conversations) {
    if (!convIds.has(conv.conversationId)) {
      mismatches.push(`${persona.id} missing conversation ${conv.conversationId}`);
      continue;
    }
    const thread = (await pageQuery(token, "threadMessages", { conversationId: conv.conversationId })).map(projectMessage);
    const byId = indexBy(thread, (m) => m.id);
    for (const msg of conv.messages) {
      const now = byId.get(msg.id);
      if (!now) {
        mismatches.push(`${persona.id} missing message ${msg.id}`);
        continue;
      }
      const checks = [
        ["conversationId", msg.conversationId, now.conversationId],
        ["authorId", msg.authorId, now.authorId],
        ["at", msg.at, now.at],
        ["body", msg.body, now.body],
        ["caption", msg.caption, now.caption],
        ["photo", mediaId(msg.photo), now.photo],
        ["photoOnce", mediaId(msg.photoOnce), now.photoOnce],
        ["clip", mediaId(msg.clip), now.clip],
        ["editedAt", msg.editedAt, now.editedAt],
        ["tombstoned", msg.tombstoned, now.tombstoned],
        ["quoteId", msg.quoteId, now.quoteId],
      ];
      for (const [field, a, b] of checks) {
        if (a !== b) mismatches.push(`${persona.id} ${msg.id}.${field} ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      }
    }
    const receipts = await query(token, "convReceipts", { conversationId: conv.conversationId });
    const reactions = await query(token, "convReactions", { conversationId: conv.conversationId });
    const nowReceipts = new Set((receipts.body?.data ?? []).map(receiptKey));
    const nowReactions = new Set((reactions.body?.data ?? []).map(reactionKey));
    for (const r of conv.receipts) {
      if (!nowReceipts.has(receiptKey(r))) mismatches.push(`${persona.id} missing receipt ${receiptKey(r)}`);
    }
    for (const r of conv.reactions) {
      if (!nowReactions.has(reactionKey(r))) mismatches.push(`${persona.id} missing reaction ${reactionKey(r)}`);
    }
  }
  perPersona.push({
    persona: persona.id,
    preConversations: pre.conversations.length,
    preMessages: pre.conversations.reduce((n, c) => n + c.messages.length, 0),
  });
  await new Promise((r) => setTimeout(r, 200));
}

const result = {
  ok: mismatches.length === 0,
  mismatches,
  perPersona,
  comparedAt: new Date().toISOString(),
};
await mkdir(resolve(root, "m7"), { recursive: true });
await writeFile(resolve(root, "m7/snapshot-compare.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ok: result.ok, mismatches: mismatches.length, sample: mismatches.slice(0, 10) }, null, 2));
if (!result.ok) process.exitCode = 1;
