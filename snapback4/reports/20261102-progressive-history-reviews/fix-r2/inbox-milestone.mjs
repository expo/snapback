// Reuse chunk 2c's scale fixture, inbox query and milestone predicate against
// the rebuilt native Rust device. This is a correctness probe, not a timing run.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createLocalClient } from "../../../packages/snapback4/dist/local.js";
import { processDevice } from "../../../packages/snapback4/dist/native.js";
import { binary, devServer, root, scaleSeed } from "../../../witness/lib.mjs";

const work = join(root, "target/progressive-history-fix-r2"); mkdirSync(work, { recursive: true });
process.env.TMPDIR = work;
const dir = mkdtempSync(join(work, "inbox-device-"));
const extraSource = `query progressiveInbox():
  return memberships[viewer] first 50 by byPrincipalConversation
    { conversationId, conversation: conversations[.conversationId] }
`;
const seed = scaleSeed({ groups: 40, messages: 500, members: 10 });
let server, client, core, milestone, paused = false;
const observations = [];
const device = () => processDevice({ binary: binary(), dir,
  spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }),
  writeFile: async (path, text) => writeFileSync(path, text) });
try {
  server = await devServer({ seed, extraSource }); assert.equal(server.seeded, 20440);
  const opener = device();
  client = await createLocalClient({ url: server.api, persona: "bob", waitSeconds: 1,
    device: { async open(...args) {
      core = await opener.open(...args); const call = core.call.bind(core);
      core.call = async (request, committed) => {
        const reply = await call(request, committed);
        if (request.op === "apply" && !reply.denied && reply.ok?.published !== false) {
          const state = (await call({ op: "sync_state", capture: false })).ok;
          const read = (await call({ op: "query", name: "media.progressiveInbox", args: {}, viewer: "dev:bob", now: Date.now() })).ok;
          observations.push({ tables: state.acquired_tables, unknown: read?.unknown, complete: read?.complete });
          if (read && !read.unknown && read.complete && Array.isArray(read.data)) {
            assert.deepEqual(state.acquired_tables, ["conversations", "memberships"]);
            assert.equal(state.acquired, false); assert.equal(state.floored_groups, 0);
            assert.deepEqual(read.data.map(r => r.conversationId), Array.from({ length: 40 }, (_, i) => `c${String(i).padStart(3, "0")}`));
            assert.ok(read.data.every(r => r.conversation.id === r.conversationId));
            milestone = { acquired: state.acquired, wholeTables: state.acquired_tables, rows: read.data.length };
            paused = true;
          }
        }
        return reply;
      };
      return core;
    } },
    fetch: async (url, init) => {
      if (new URL(url).pathname === "/sync") {
        if (paused) throw new TypeError("stop at the durable inbox milestone");
        return fetch(url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), limit: 40 }) });
      }
      return fetch(url, init);
    },
  });
  await client.sync(); assert.ok(milestone);
  assert.ok(observations.some(s => s.tables.length === 1 && s.tables[0] === "conversations" && s.unknown));
  await client.close(); client = undefined;
  client = await createLocalClient({ url: server.api, persona: "bob", device: device(),
    fetch: async () => { throw new TypeError("offline reopen"); } });
  const offline = await client.query({ kind: "query", name: "media.progressiveInbox" }, {});
  assert.equal(offline.complete, true); assert.equal(offline.fresh, false);
  assert.equal(offline.data.length, 40); assert.equal(client.acquired, false);
  console.log(JSON.stringify({ inboxMilestone: true, fixtureRows: seed.length, ...milestone, offlineReopen: true }));
} finally {
  await client?.close(); await server?.close(); rmSync(dir, { recursive: true, force: true });
}
