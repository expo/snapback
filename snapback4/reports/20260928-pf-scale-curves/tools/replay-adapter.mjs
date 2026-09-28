import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { verifyScale } from "./verify-scale.mjs";
import { signup, login } from "snapback4/auth";
import { execFileSync } from "node:child_process";
import { createClient, idFrom, read, mutate } from "./api-client.mjs";
const log = process.argv[2] || "instrument/fixtures/sample-50.log";
const directory = process.env.REPLAY_STATE || "evidence/replay-sample";
fs.mkdirSync(directory, { recursive: true });
const url = process.env.SNAPBACK_URL || "http://127.0.0.1:49360",
  web = process.env.CHOREO_BASE_URL || "http://127.0.0.1:49361";
const stateFile = path.join(directory, "state.private.json"),
  receipts = path.join(directory, "receipts.jsonl");
const state = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile))
  : { users: {}, done: {}, conversations: {} };
const save = () => {
  const { done, ...persist } = state;
  fs.writeFileSync(stateFile, JSON.stringify(persist), { mode: 0o600 });
};
state.done ??= {};
if (fs.existsSync(receipts))
  for (const line of fs
    .readFileSync(receipts, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)) {
    const r = JSON.parse(line);
    state.done[r.hash + ":" + r.line] = true;
  }
const source = fs.readFileSync(log, "utf8"),
  hash = crypto.createHash("sha256").update(source).digest("hex");
const prior =
  process.env.REPLAY_RESUME === "1"
    ? JSON.parse(fs.readFileSync(path.join(directory, "result.json")))
    : null;
if (prior && prior.actionLog.sha256 !== "sha256:" + hash)
  throw Error("Resume workload hash mismatch");
const clients = new Map();
const lines = source.trimEnd().split("\n");
const checkpoints = [...(prior?.checkpoints ?? [])];
let excludedSeconds = prior?.excludedSeconds ?? 0;
const replayCap = Number(process.env.REPLAY_CAP_SECONDS || 14400);
const client = (who) => {
  if (!clients.has(who))
    clients.set(who, createClient({ url, token: state.users[who].token }));
  return clients.get(who);
};
const cid = (label) => state.conversations[label] || idFrom(label);
async function upload(c, file) {
  const bytes = fs.readFileSync(path.join("instrument/fixtures", file));
  const r = await c.upload(
    new Blob([bytes], {
      type: file.endsWith(".mp4") ? "video/mp4" : "image/png",
    }),
  );
  if (!r.ok) throw Error(JSON.stringify(r));
  return { id: r.asset.id };
}
let settled = 0,
  failedActions = 0;
let phase = "action";
const failures = [];
const resumedAt = Date.now() / 1000;
const start = prior?.start ?? resumedAt;
if (prior)
  fs.appendFileSync(
    "run-log.md",
    `${resumedAt} scale-replay-resume originalStart=${start} prefix=${prior.settledPrefix} capSeconds=${replayCap}; diagnostic and repair wall remains charged\n`,
  );
try {
  for (const [index, line] of lines.entries()) {
    if (Date.now() / 1000 - start - excludedSeconds > replayCap)
      throw Error("Scale replay wall cap exhausted");
    if (line.startsWith("#")) {
      phase = "checkpoint";
      const stage = line.split(" ")[2],
        began = Date.now() / 1000;
      const manifest = JSON.parse(
        fs.readFileSync("instrument/fixtures/invariant-manifest-combined.json"),
      ).checkpoints[stage];
      if (settled !== manifest.scaleActionsApplied)
        throw Error("Checkpoint settled-prefix mismatch");
      const prefix = crypto
        .createHash("sha256")
        .update(lines.slice(0, index + 1).join("\n") + "\n")
        .digest("hex");
      if (prefix !== manifest.scalePrefixSha256)
        throw Error("Checkpoint prefix hash mismatch");
      const kept = checkpoints.find((c) => c.id === stage);
      if (kept) {
        if (
          kept.settledPrefix !== settled ||
          kept.prefixSha256 !== "sha256:" + prefix
        )
          throw Error("Retained checkpoint evidence mismatch");
        phase = "action";
        continue;
      }
      save();
      const proof = path.join(
        directory,
        `verification-${stage.replace("%", "pct")}.json`,
      );
      let result;
      if (prior && prior.settledPrefix === settled && fs.existsSync(proof)) {
        result = JSON.parse(fs.readFileSync(proof));
        if (!result.pass || result.stage !== stage)
          throw Error("Invalid resumed checkpoint proof");
        excludedSeconds += result.end - result.start;
      } else {
        result = await verifyScale({
          directory,
          cwd: process.env.REPLAY_BACKEND_DIR,
          url,
          stage,
        });
        excludedSeconds += Date.now() / 1000 - began;
      }
      checkpoints.push({
        id: stage,
        settledPrefix: settled,
        prefixSha256: "sha256:" + prefix,
        verification: result.pass,
      });
      console.log("Checkpoint", stage, "verified");
      execFileSync("python3", ["../snapshot.py", process.env.REPLAY_BACKEND_DIR, stage.replace("%", "pct"), directory], { stdio: "inherit" });
      if (stage === "50%") break;

      phase = "action";
      continue;
    }
    const key = hash + ":" + (index + 1);
    if (state.done[key]) {
      settled++;
      continue;
    }
    const [, who, verb, ...a] = line
      .match(/"(?:\\.|[^"\\])*"|\S+/g)
      .map((x) => (x[0] === '"' ? JSON.parse(x) : x));
    let result;
    if (verb === "register") {
      let r = await signup(url, a[0], a[1]);
      if (!r.ok) r = await login(url, a[0], a[1]);
      if (!r.ok) throw Error(JSON.stringify(r));
      state.users[who] = { token: r.session.token, principal: r.session.principal, email: a[0] };
      save();
      result = { state: "sent", operation: "real-password-signup", principal: r.session.principal };
    } else {
      const c = client(who);
      let name,
        args,
        label = key;
      if (verb === "profile-set") {
        result = await mutate(
          c,
          "saveProfile",
          {
            displayName: a[0],
            handle: a[1],
            bio: a[2],
            location: a[3],
            link: a[4],
          },
          key + ":profile",
        );
        result = await mutate(
          c,
          "placeAvatar",
          { avatar: await upload(c, a[5]) },
          key + ":avatar",
        );
        state.users[who].handle = a[1];
        save();
      } else {
        if (verb === "follow") {
          name = "setFollow";
          args = {
            principal: state.users[a[0]].principal,
            value: a[1] === "set",
          };
          label = a[2];
        } else if (verb === "post") {
          name = "publish";
          args = {
            postId: idFrom(a[0]),
            body: a[2],
            parentId: null,
            images:
              a[1] === "images"
                ? await Promise.all(a[3].split(",").map((f) => upload(c, f)))
                : null,
            video: a[1] === "video" ? await upload(c, a[3]) : null,
          };
          label = a[0];
        } else if (verb === "reply") {
          name = "publish";
          args = {
            postId: idFrom(a[0]),
            body: a[2],
            parentId: idFrom(a[1]),
            images: null,
            video: null,
          };
          label = a[0];
        } else if (verb === "like" || verb === "repost") {
          name = verb === "like" ? "setLike" : "setRepost";
          args = { postId: idFrom(a[0]), value: a[1] === "set" };
          label = a[2];
        } else if (verb === "dm-create" || verb === "group-create") {
          name = verb === "dm-create" ? "chat.createDM" : "chat.createGroup";
          args = {
            conversationId: idFrom(a[0]),
            other: state.users[a[1]].principal,
            ...(verb === "group-create"
              ? { title: a[2], description: a[3] }
              : {}),
          };
          label = a[0];
        } else if (verb === "member-add") {
          name = "chat.add";
          args = {
            conversation: cid(a[0]),
            principal: state.users[a[1]].principal,
          };
          label = a[2];
        } else if (verb === "send") {
          name = "chat.send";
          args = {
            messageId: idFrom(a[0]),
            conversation: cid(a[1]),
            text: a[2],
            quote: a[3] ? idFrom(a[3].slice(6)) : null,
          };
          label = a[0];
        } else if (verb === "send-media") {
          name = "chat.sendMedia";
          const asset = await upload(c, a[3]);
          args = {
            messageId: idFrom(a[0]),
            conversation: cid(a[1]),
            text: a[4],
            quote: null,
            photo: a[2] === "image" ? asset : null,
            video: a[2] === "video" ? asset : null,
            once: a[5] === "view-once",
          };
          label = a[0];
        } else if (verb === "react") {
          name = "chat.setReaction";
          args = {
            message: idFrom(a[0]),
            emoji: a[1] === "none" ? null : a[1],
          };
          label = a[2];
        } else throw Error("Unsupported action " + verb);
        result = await mutate(c, name, args, label);
        if (verb === "dm-create") {
          const q = await read(c, "chat.dmFor", {
            other: state.users[a[1]].principal,
          });
          state.conversations[a[0]] = q.data.conversation;
        }
      }
    }
    settled++;
    state.done[key] = true;
    fs.appendFileSync(
      receipts,
      JSON.stringify({
        line: index + 1,
        hash,
        actor: who,
        verb,
        variant: verb === "post" ? a[1] : null,
        ackMs: result.ackMs,
        state: result.state,
        writeId: result.id,
        settledAt: Date.now() / 1000,
      }) + "\n",
    );
    if (settled % 100 === 0 || lines.length < 100)
      console.log(settled, who, verb, "settled");
  }
  if (false && path.basename(log) === "scale.log") {
    phase = "final-verification";
    save();
    const began = Date.now() / 1000;
    await verifyScale({
      directory,
      cwd: process.env.REPLAY_BACKEND_DIR,
      url,
      stage: "final",
    });
    excludedSeconds += Date.now() / 1000 - began;
  }
} catch (e) {
  if (phase === "action") failedActions++;
  failures.push({ phase, error: String(e), at: Date.now() / 1000 });
  console.error(e);
  process.exitCode = 1;
} finally {
  save();
  for (const c of clients.values()) await c.close();

  fs.writeFileSync(
    path.join(directory, "result.json"),
    JSON.stringify(
      {
        version: "snapback.full-journey-scale-replay-receipt.v1",
        pass: failures.length === 0,
        actionLog: {
          sha256: "sha256:" + hash,
          actionCount: source
            .trimEnd()
            .split("\n")
            .filter((l) => !l.startsWith("#")).length,
        },
        settledPrefix: settled,
        failedActions,
        failures,
        resumedAt: prior ? resumedAt : null,
        previousAttempt: prior ? "attempt-1-result.json" : null,
        start,
        end: Date.now() / 1000,
        checkpoints,
        excludedSeconds,
        activeSeconds: Date.now() / 1000 - start - excludedSeconds,
        capSeconds: replayCap,
      },
      null,
      2,
    ),
  );
  if (prior)
    fs.appendFileSync(
      "run-log.md",
      `${Date.now() / 1000} scale-replay-resumed-end originalStart=${start} verified=${failures.length === 0} evidence=${directory}/result.json\n`,
    );
}
