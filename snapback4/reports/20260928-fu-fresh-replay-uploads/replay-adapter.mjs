import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, idFrom } from "snapback4/client";
import { login, signup } from "snapback4/auth";

const mut = (name) => ({ kind: "mutation", name });
const api = {
  saveProfile: mut("saveProfile"),
  placeAvatar: mut("placeAvatar"),
  setFollow: mut("setFollow"),
  createPost: mut("createPost"),
  createImagePost: mut("createImagePost"),
  createVideoPost: mut("createVideoPost"),
  setLike: mut("setLike"),
  setRepost: mut("setRepost"),
  replyToPost: mut("replyToPost"),
  createDm: mut("createDm"),
  createGroup: mut("createGroup"),
  addMember: mut("addMember"),
  send: mut("send"),
  sendPhoto: mut("sendPhoto"),
  sendVideo: mut("sendVideo"),
  setReaction: mut("setReaction"),
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_URL = process.env.SNAPBACK_URL ?? process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:56400";
export const FIXTURES = resolve(root, "fixtures");
const personas = JSON.parse(await readFile(resolve(FIXTURES, "personas.json"), "utf8"));
const personaById = new Map(personas.starter.map((p) => [p.id, p]));

function tokenize(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (/\s/.test(line[i])) { i += 1; continue; }
    if (line[i] === '"') {
      let j = i + 1;
      let s = "";
      while (j < line.length) {
        if (line[j] === "\\") { s += line[j + 1]; j += 2; continue; }
        if (line[j] === '"') break;
        s += line[j];
        j += 1;
      }
      out.push(s);
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < line.length && !/\s/.test(line[j])) j += 1;
    out.push(line.slice(i, j));
    i = j;
  }
  return out;
}

export function parseLine(line) {
  if (!line || line.startsWith("#")) return { kind: "marker", line };
  const tokens = tokenize(line);
  const [timestamp, actor, verb, ...args] = tokens;
  return { kind: "action", timestamp, actor, verb, args, line };
}

export async function loadLog(path) {
  const text = await readFile(path, "utf8");
  return text.split("\n").filter((l) => l.length > 0).map(parseLine);
}

function fid(label) {
  return idFrom(`clique:${label}`);
}

const WAIT = Number(process.env.SNAPBACK_REPLAY_WAIT ?? 120);
const ADMIT_PENDING = process.env.SNAPBACK_REPLAY_ADMIT_PENDING === "1";

async function settle(write, context) {
  if (!write) throw new Error(`no write receipt (${context})`);
  if (write.state === "failed") {
    const code = write.why?.code ?? "";
    if (code === "E_ID_REUSED" || code === "HANDLE_TAKEN" || code === "E_WRITE_ID_REUSE") {
      return write;
    }
    throw new Error(`${context} refused ${write.why.code}: ${write.why.message}`);
  }
  if (write.state === "pending" && ADMIT_PENDING) return write;
  if (write.state !== "sent") {
    throw new Error(`${context} did not settle: ${write.state}`);
  }
  return write;
}

async function ensureUser(url, actor, email, password, sessions) {
  if (sessions.has(actor)) return sessions.get(actor);
  let result = await signup(url, email, password);
  if (!result.ok) result = await login(url, email, password);
  if (!result.ok) throw new Error(`auth ${actor}: ${result.why.message}`);
  const client = createClient({ url, session: result.session });
  const record = { session: result.session, principal: result.session.principal, client, email, password };
  sessions.set(actor, record);
  return record;
}

async function uploadFile(client, rel) {
  const path = resolve(FIXTURES, rel);
  const bytes = await readFile(path);
  let last = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const uploaded = await client.upload(bytes);
    if (uploaded.ok) return { id: uploaded.asset.id };
    last = uploaded;
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  throw new Error(`upload ${rel}: ${last?.why?.message ?? "upload failed"}`);
}

export async function replayLines(lines, {
  url = DEFAULT_URL,
  sessions = new Map(),
  onCheckpoint,
} = {}) {
  let n = 0;
  for (const item of lines) {
    if (item.kind === "marker") {
      if (onCheckpoint && item.line.startsWith("# checkpoint")) await onCheckpoint(item.line, n);
      continue;
    }
    const { actor, verb, args } = item;
    n += 1;
    if (verb === "register") {
      const [email, password] = args;
      await ensureUser(url, actor, email, password, sessions);
      continue;
    }
    let user = sessions.get(actor);
    if (!user) {
      const persona = personaById.get(actor);
      if (persona) user = await ensureUser(url, actor, persona.email, persona.password, sessions);
    }
    if (!user && /^u\d{4}$/.test(actor)) {
      user = await ensureUser(url, actor, `${actor}@example.com`, "CliqueScale!20260808", sessions);
    }
    if (!user) throw new Error(`unknown actor ${actor} for ${verb}`);
    const { client } = user;
    const principalOf = async (handle) => {
      let rec = sessions.get(handle);
      if (!rec) {
        const persona = personaById.get(handle);
        if (persona) rec = await ensureUser(url, handle, persona.email, persona.password, sessions);
        else if (/^u\d{4}$/.test(handle)) rec = await ensureUser(url, handle, `${handle}@example.com`, "CliqueScale!20260808", sessions);
      }
      if (!rec) throw new Error(`unknown handle ${handle}`);
      return rec.principal;
    };
    if (verb === "profile-set") {
      const [displayName, handle, bio, location, link, avatarPng] = args;
      await settle(await client.mutate(api.saveProfile, {
        displayName,
        handle,
        bio: bio || null,
        location: location || null,
        link: link || null,
      }, { id: fid(`profile:${actor}`), waitSeconds: WAIT }), item.line);
      if (avatarPng) {
        const avatar = await uploadFile(client, avatarPng);
        await settle(await client.mutate(api.placeAvatar, { avatar }, { id: fid(`avatar:${actor}`), waitSeconds: WAIT }), item.line);
      }
      continue;
    }
    if (verb === "follow") {
      const [target, mode, mutationId] = args;
      await settle(await client.mutate(api.setFollow, {
        target: await principalOf(target),
        following: mode === "set",
      }, { id: fid(mutationId), waitSeconds: WAIT }), item.line);
      continue;
    }
    if (verb === "post") {
      const [postId, kind, text, media] = args;
      const id = fid(postId);
      if (kind === "text") {
        await settle(await client.mutate(api.createPost, { postId: id, body: text }, { id, waitSeconds: WAIT }), item.line);
      } else if (kind === "images") {
        const images = [];
        for (const rel of media.split(",")) images.push(await uploadFile(client, rel));
        await settle(await client.mutate(api.createImagePost, { postId: id, body: text || null, images }, { id, waitSeconds: WAIT }), item.line);
      } else if (kind === "video") {
        const video = await uploadFile(client, media);
        await settle(await client.mutate(api.createVideoPost, { postId: id, body: text || null, video }, { id, waitSeconds: WAIT }), item.line);
      } else throw new Error(`unknown post kind ${kind}`);
      continue;
    }
    if (verb === "like") {
      const [postId, mode, mutationId] = args;
      await settle(await client.mutate(api.setLike, {
        postId: fid(postId),
        liked: mode === "set",
      }, { id: fid(mutationId), waitSeconds: WAIT }), item.line);
      continue;
    }
    if (verb === "repost") {
      const [postId, mode, mutationId] = args;
      await settle(await client.mutate(api.setRepost, {
        postId: fid(postId),
        reposted: mode === "set",
      }, { id: fid(mutationId), waitSeconds: WAIT }), item.line);
      continue;
    }
    if (verb === "reply") {
      const [replyId, parentPostId, text] = args;
      const id = fid(replyId);
      await settle(await client.mutate(api.replyToPost, {
        replyId: id,
        parentId: fid(parentPostId),
        body: text,
      }, { id, waitSeconds: WAIT }), item.line);
      continue;
    }
    if (verb === "dm-create") {
      const [conversationId, other] = args;
      const id = fid(conversationId);
      await settle(await client.mutate(api.createDm, {
        conversationId: id,
        other: await principalOf(other),
      }, { id, waitSeconds: WAIT }), item.line);
      continue;
    }
    if (verb === "group-create") {
      const [conversationId, other, name, description] = args;
      const id = fid(conversationId);
      await settle(await client.mutate(api.createGroup, {
        conversationId: id,
        other: await principalOf(other),
        name,
        description: description || null,
      }, { id, waitSeconds: WAIT }), item.line);
      continue;
    }
    if (verb === "member-add") {
      const [conversationId, member, mutationId] = args;
      await settle(await client.mutate(api.addMember, {
        conversation: fid(conversationId),
        principal: await principalOf(member),
      }, { id: fid(mutationId), waitSeconds: WAIT }), item.line);
      continue;
    }
    if (verb === "send") {
      const [messageId, conversationId, text, maybeQuote] = args;
      const id = fid(messageId);
      let quote = null;
      if (maybeQuote && maybeQuote.startsWith("quote=")) quote = fid(maybeQuote.slice(6));
      await settle(await client.mutate(api.send, {
        conversation: fid(conversationId),
        messageId: id,
        text,
        quote,
      }, { id, waitSeconds: WAIT }), item.line);
      continue;
    }
    if (verb === "send-media") {
      const [messageId, conversationId, kind, mediaPath, caption, mode] = args;
      const id = fid(messageId);
      const asset = await uploadFile(client, mediaPath);
      if (kind === "image") {
        await settle(await client.mutate(api.sendPhoto, {
          conversation: fid(conversationId),
          messageId: id,
          photo: asset,
          caption: caption || null,
          viewOnce: mode === "view-once",
        }, { id, waitSeconds: WAIT }), item.line);
      } else {
        await settle(await client.mutate(api.sendVideo, {
          conversation: fid(conversationId),
          messageId: id,
          video: asset,
          caption: caption || null,
        }, { id, waitSeconds: WAIT }), item.line);
      }
      continue;
    }
    if (verb === "react") {
      const [messageId, emoji, mutationId] = args;
      await settle(await client.mutate(api.setReaction, {
        messageId: fid(messageId),
        emoji: emoji === "none" ? null : emoji,
      }, { id: fid(mutationId), waitSeconds: WAIT }), item.line);
      continue;
    }
    throw new Error(`unsupported verb ${verb}`);
  }
  return { actions: n, sessions };
}

export async function replayFile(path, options) {
  const lines = await loadLog(path);
  return replayLines(lines, options);
}
