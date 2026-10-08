import { signalChild, spawnTracked as spawn } from '../../../../scripts/test-signals.mjs';
import { captureStdout } from './server-output.mjs';
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, mintId } from "../../dist/client.js";
import { signup } from "../../dist/auth.js";
import { binary, until } from "./app-server.mjs";

export const png = readFileSync(new URL("../fixtures/cal26-avatar.png", import.meta.url));
export const query = name => ({ kind: "query", name });
export const mutation = name => ({ kind: "mutation", name });
export async function avatarFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-cal26-avatars-"));
  cpSync(new URL("../fixtures/cal26-avatars/", import.meta.url), join(dir, "snapback"), { recursive: true });
  let log = "";
  const host = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(host);
  host.stdout.on("data", b => { log += b; }); host.stderr.on("data", b => { log += b; });
  const clients = [];
  t.after(async () => {
    for (const c of clients) await c.close();
    if (host.exitCode === null && host.signalCode === null) { const done = new Promise(resolve => host.once("exit", resolve)); await signalChild(host); await done; }
    rmSync(dir, { recursive: true, force: true });
  });
  const url = await until(() => { assert.equal(host.exitCode, null, log); return readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; }, "calibration server");
  const users = {};
  const write = async (client, name, args) => {
    const result = await client.mutate(mutation(name), args);
    assert.equal(result.state, "sent", JSON.stringify({ name, result }));
    return result.result;
  };
  const upload = async client => {
    const result = await client.upload(png); assert.equal(result.ok, true, JSON.stringify(result)); return result.asset;
  };
  for (const name of ["alice", "bob", "carol"]) {
    const login = await signup(url, `${name}@avatars.test`, "password-avatars"); assert.equal(login.ok, true, JSON.stringify(login));
    const client = createClient({ url, session: login.session }); clients.push(client);
    await write(client, "saveProfile", { displayName: name, handle: name, bio: "", location: "", link: null });
    const avatar = await upload(client); await write(client, "placeAvatar", { avatar: { id: avatar.id } });
    users[name] = { client, session: login.session, avatar };
  }
  const { alice, bob, carol } = users;
  const dm = await write(alice.client, "messaging.createDM", { id: mintId(), other: bob.session.principal });
  const group = await write(alice.client, "messaging.createGroup", { id: mintId(), other: bob.session.principal, title: "Avatar group", description: "" });
  await write(alice.client, "messaging.add", { conversation: group, principal: carol.session.principal });
  for (let i = 0; i < 20; i++) {
    const author = i % 2 ? carol : alice;
    await write(alice.client, "messaging.send", { conversation: dm, id: mintId(), text: `DM ${i}`, quote: null, photo: null, video: null, oncePhoto: null });
    await write(author.client, "messaging.send", { conversation: group, id: mintId(), text: `Group ${i}`, quote: null, photo: null, video: null, oncePhoto: null });
    await write(author.client, "social.publish", { id: mintId(), body: `Post ${i}`, parentId: null, images: null, video: null });
  }
  return { url, dir, users, dm, group, write, upload };
}
