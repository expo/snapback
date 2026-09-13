import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { startProject } from "../src/node/project.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const imageFixture = join(repository, "benchmarks/fixtures/social-messenger/media/avatar-alice.png");
const videoFixture = join(repository, "benchmarks/fixtures/social-messenger/media/vid-01.mp4");
const debugWorker = join(repository, "snapback3/target/debug/snapback3-worker");
const debugMedia = join(repository, "snapback3/target/debug/snapback3-media");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const schema = `use identity

table media:
  owner: principal
  photo: image <=10485760 once ?
  clip: video <=52428800 ?
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- deny
  delete <- .owner = viewer

table publicMedia:
  photo: image <=10485760
  public
  insert <- allow
`;

const operations = `mutation attachPhoto(photo: image <=10485760):
  row = insert media { owner: viewer, photo, clip: null }
  return { id: row.id, photo: row.photo }

mutation attachVideo(clip: video <=52428800):
  row = insert media { owner: viewer, photo: null, clip }
  return { id: row.id, clip: row.clip }

mutation attachPublicPhoto(photo: image <=10485760):
  row = insert publicMedia { photo }
  return { id: row.id, photo: row.photo }

mutation remove(id: media):
  delete media[id]
  return { id }
`;

function runtimeAvailable(): boolean {
  return existsSync(debugWorker) && existsSync(debugMedia);
}

function selectBuiltRuntime(context: TestContext): void {
  const worker = process.env.SNAPBACK3_WORKER;
  const media = process.env.SNAPBACK3_MEDIA;
  process.env.SNAPBACK3_WORKER = debugWorker;
  process.env.SNAPBACK3_MEDIA = debugMedia;
  context.after(() => {
    if (worker === undefined) delete process.env.SNAPBACK3_WORKER;
    else process.env.SNAPBACK3_WORKER = worker;
    if (media === undefined) delete process.env.SNAPBACK3_MEDIA;
    else process.env.SNAPBACK3_MEDIA = media;
  });
}

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "snapback3-real-media-"));
  const authored = join(root, "snapback");
  await mkdir(authored);
  await mkdir(join(root, "public"));
  await writeFile(join(root, "public/player.html"), "<!doctype html><meta charset=utf-8><title>media playback</title>");
  await writeFile(join(authored, "schema.q"), schema);
  await writeFile(join(authored, "media.q"), operations);
  let app = await startProject({ root, dev: true, port: 0, log: () => {} });
  context.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const restart = async () => {
    await app.close();
    app = await startProject({ root, dev: true, port: 0, log: () => {} });
  };
  const call = async (path: string, body?: unknown, token?: string) => {
    const response = await fetch(app.url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Connection: "close",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, value: await response.json() as any };
  };
  const persona = async (name: string) => (await call("/api/auth/persona", { name })).value.token as string;
  const mutate = async (token: string, op: string, args: Record<string, unknown>, intent: string) => {
    const manifest = (await call("/api/manifest")).value;
    return await call("/api/mutation", {
      op, args, intent, planHash: manifest.programs[op].planHash, schemaHash: manifest.schemaHash,
    }, token);
  };
  const upload = async (token: string, path: string, kind: "image" | "video", type: string) => {
    const bytes = await readFile(path);
    return await fetch(`${app.url}/api/assets?kind=${kind}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": type, Connection: "close" }, body: bytes,
    });
  };
  return { get app() { return app; }, root, restart, call, persona, mutate, upload };
}

test("real helper, worker, and Node HTTP preserve row authority, once, restart, and Range", {
  skip: !runtimeAvailable(), timeout: 60_000,
}, async context => {
  selectBuiltRuntime(context);
  const app = await fixture(context);
  let alice = await app.persona("alice");
  const bob = await app.persona("bob");
  assert.equal((await fetch(`${app.app.url}/api/assets/asset_missing`)).status, 404);
  assert.equal((await fetch(`${app.app.url}/api/assets/asset_missing`, { method: "HEAD", headers: { Authorization: `Bearer ${alice}` } })).status, 404);

  const mismatch = await app.upload(alice, imageFixture, "image", "image/jpeg");
  assert.equal(mismatch.status, 422);

  const photoUpload = await app.upload(alice, imageFixture, "image", "image/png");
  assert.equal(photoUpload.status, 200);
  const photo = await photoUpload.json() as { id: string; width: number; height: number };
  assert.deepEqual({ width: photo.width, height: photo.height }, { width: 256, height: 256 });
  assert.equal((await fetch(`${app.app.url}/api/assets/${photo.id}`)).status, 404, "unattached uploads are not anonymous public bytes");
  assert.equal((await app.call(`/api/assets/${photo.id}/status`, undefined, bob)).value, null);
  const attachedPhoto = await app.mutate(alice, "media.attachPhoto", { photo }, "attach-real-photo");
  assert.equal(attachedPhoto.value.state, "committed");
  assert.equal((await fetch(`${app.app.url}/api/assets/${photo.id}`, { headers: { Authorization: `Bearer ${bob}` } })).status, 404);
  const opens = await Promise.all([
    fetch(`${app.app.url}/api/assets/${photo.id}`, { headers: { Authorization: `Bearer ${alice}`, Range: "bytes=0-1" } }),
    fetch(`${app.app.url}/api/assets/${photo.id}`, { headers: { Authorization: `Bearer ${alice}`, "If-None-Match": `"${photo.id}"` } }),
  ]);
  assert.equal(opens.filter(response => response.status === 200).length, 1);
  assert.equal(opens.filter(response => response.status === 410).length, 1);
  const photoBody = opens.find(response => response.status === 200)!;
  assert.equal(photoBody.headers.get("cache-control"), "private, no-store");
  assert.equal(photoBody.headers.get("content-range"), null);
  assert((await photoBody.arrayBuffer()).byteLength > 0);
  assert.equal((await fetch(`${app.app.url}/api/assets/${photo.id}`, { headers: { Authorization: `Bearer ${alice}` } })).status, 410);
  assert.equal((await fetch(`${app.app.url}/api/assets/${photo.id}`)).status, 404, "once rows remain indistinguishable to anonymous delivery");
  assert.equal((await fetch(`${app.app.url}/api/assets/${photo.id}`, { method: "HEAD", headers: { Authorization: `Bearer ${alice}` } })).status, 410);
  assert.equal((await app.mutate(alice, "media.remove", { id: attachedPhoto.value.data.id }, "remove-spent-photo")).value.state, "committed");
  assert.equal((await fetch(`${app.app.url}/api/assets/${photo.id}`, { method: "HEAD", headers: { Authorization: `Bearer ${alice}` } })).status, 404,
    "row authorization hides spent state after deletion");

  const publicUpload = await app.upload(alice, imageFixture, "image", "image/png");
  assert.equal(publicUpload.status, 200);
  const publicPhoto = await publicUpload.json() as { id: string };
  assert.equal((await app.mutate(alice, "media.attachPublicPhoto", { photo: publicPhoto }, "attach-public-photo")).value.state, "committed");
  let response = await fetch(`${app.app.url}/api/assets/${publicPhoto.id}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, immutable");
  const publicEtag = response.headers.get("etag")!;
  await response.arrayBuffer();
  response = await fetch(`${app.app.url}/api/assets/${publicPhoto.id}`, { method: "HEAD", headers: { "If-None-Match": publicEtag } });
  assert.equal(response.status, 304, "certified public authority is resolved before conditional delivery");

  const videoUpload = await app.upload(alice, videoFixture, "video", "video/mp4");
  assert.equal(videoUpload.status, 200);
  const video = await videoUpload.json() as { id: string; duration: number };
  assert(video.duration > 0 && video.duration <= 60_000);
  const attachedVideo = await app.mutate(alice, "media.attachVideo", { clip: video }, "attach-real-video");
  assert.equal(attachedVideo.value.state, "committed");
  assert.equal((await fetch(`${app.app.url}/api/assets/${video.id}`)).status, 404, "private media is anonymous 404");
  const preRestartSession = await mediaSession(app.app.url, alice);
  assert.equal((await fetch(`${app.app.url}/api/assets/${video.id}?s=${preRestartSession.token}`, { headers: { Range: "bytes=0-7" } })).status, 206);
  await app.restart();
  assert.equal((await fetch(`${app.app.url}/api/assets/${video.id}?s=${preRestartSession.token}`)).status, 404,
    "the media carrier is owner-memory-only and does not survive restart");
  alice = await app.persona("alice");
  const durable = await readFile(join(app.root, ".snapback3/media/blobs", video.id));
  response = await fetch(`${app.app.url}/api/assets/${video.id}`, {
    method: "HEAD", headers: { Authorization: `Bearer ${alice}`, Range: "bytes=4-11" },
  });
  assert.equal(response.status, 200);
  assert.equal(Number(response.headers.get("content-length")), durable.length);
  response = await fetch(`${app.app.url}/api/assets/${video.id}`, {
    headers: { Authorization: `Bearer ${alice}`, Range: "bytes=4-11" },
  });
  assert.equal(response.status, 206);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), durable.subarray(4, 12));
  const session = await mediaSession(app.app.url, alice);
  response = await fetch(`${app.app.url}/api/assets/${video.id}?s=${session.token}`, { headers: { Range: "bytes=4-11" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), durable.subarray(4, 12));
  const metadata = await browserPlayback(app.app.url, video.id, session.token);
  assert(metadata.readyState >= 3 && metadata.duration > 0 && metadata.currentTime > 0,
    `mounted video did not progress: ${JSON.stringify(metadata)}`);
  assert.equal((await app.call("/api/auth/logout", {}, alice)).response.status, 200);
  assert.equal((await fetch(`${app.app.url}/api/assets/${video.id}?s=${session.token}`)).status, 404,
    "logout revokes the current exact session behind the carrier");
  alice = await app.persona("alice");
  assert.equal((await app.mutate(alice, "media.remove", { id: attachedVideo.value.data.id }, "delete-real-video")).value.state, "committed");
  assert.equal((await fetch(`${app.app.url}/api/assets/${video.id}`, { headers: { Authorization: `Bearer ${alice}` } })).status, 404);
});

test("real helper, worker, and HTTP restore capacity after twenty discarded uploads", {
  skip: !runtimeAvailable(), timeout: 60_000,
}, async context => {
  selectBuiltRuntime(context);
  const app = await fixture(context);
  const alice = await app.persona("alice");
  const ids: string[] = [];
  for (let index = 0; index < 20; index++) {
    const response = await app.upload(alice, imageFixture, "image", "image/png");
    assert.equal(response.status, 200);
    ids.push((await response.json() as { id: string }).id);
  }
  const exhausted = await app.upload(alice, imageFixture, "image", "image/png");
  assert.equal(exhausted.status, 413, "the real ledger enforces its twenty-object admission bound");
  await exhausted.arrayBuffer();
  for (const id of ids) {
    const discarded = await app.call(`/api/assets/${id}/discard`, {}, alice);
    assert.equal(discarded.response.status, 200);
    assert.deepEqual(discarded.value, { discarded: true });
  }

  let accepted: Response | undefined;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const candidate = await app.upload(alice, imageFixture, "image", "image/png");
    if (candidate.status === 200) { accepted = candidate; break; }
    assert.equal(candidate.status, 413);
    await candidate.arrayBuffer();
    await new Promise(done => setTimeout(done, 20));
  }
  assert(accepted, "bounded autonomous reclamation should restore real object/byte capacity");
  await accepted.arrayBuffer();
  await waitForReal(async () => {
    const names = new Set(await readdir(join(app.root, ".snapback3/media/blobs")));
    return ids.every(id => !names.has(id));
  });
  app.app.server.closeAllConnections();
  await app.app.close();
});

async function waitForReal(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await predicate()) && Date.now() < deadline) await new Promise(done => setTimeout(done, 20));
  assert(await predicate(), "Timed out waiting for real media reclamation.");
}

async function mediaSession(url: string, token: string): Promise<{ token: string; expiresAt: number }> {
  const response = await fetch(`${url}/api/assets/session`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, Connection: "close" },
  });
  assert.equal(response.status, 200);
  const value = await response.json() as { token: string; expiresAt: number };
  assert.match(value.token, /^[A-Za-z0-9_-]{43}$/);
  assert(Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now());
  return value;
}

async function browserPlayback(url: string, id: string, carrier: string): Promise<{
  readyState: number; duration: number; currentTime: number; width: number; height: number;
}> {
  assert(existsSync(chrome), `required controlled browser is missing at ${chrome}`);
  const child = spawn("/opt/homebrew/bin/node", ["--input-type=module", "-e", BROWSER_RUNNER], {
    cwd: join(repository, "snapback3"), detached: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const runnerPid = child.pid;
  assert(runnerPid);
  const result = await new Promise<{ browserPid: number; metadata: { readyState: number; duration: number; currentTime: number; width: number; height: number } }>((resolveRun, rejectRun) => {
    let stdout = "", stderr = "", settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => terminateProcessGroup(runnerPid, "SIGKILL"), 2_000).unref();
      finish(new Error("controlled browser playback timed out"));
    }, 20_000);
    const finish = (error?: Error, value?: { browserPid: number; metadata: { readyState: number; duration: number; currentTime: number; width: number; height: number } }) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? rejectRun(error) : resolveRun(value!);
    };
    child.stdout.on("data", chunk => { stdout = (stdout + chunk.toString("utf8")).slice(-64 * 1024); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString("utf8")).slice(-16 * 1024); });
    child.once("error", finish);
    child.once("close", (code, signal) => {
      if (code !== 0) { finish(new Error(`controlled browser runner failed (${signal ?? code}): ${stderr.trim()}`)); return; }
      try {
        const value = JSON.parse(stdout) as { browserPid: number; metadata: { readyState: number; duration: number; currentTime: number; width: number; height: number } };
        assert(Number.isInteger(value.browserPid) && value.browserPid > 0);
        finish(undefined, value);
      } catch (error) { finish(error as Error); }
    });
    child.stdin.end(JSON.stringify({ url, id, carrier, chrome }));
  });
  await waitForPidExit(runnerPid);
  await waitForPidExit(result.browserPid);
  console.log(`[media-browser] runner=${runnerPid} chrome=${result.browserPid} cleanup=exact-handles loadedmetadata=${result.metadata.width}x${result.metadata.height} duration=${result.metadata.duration} currentTime=${result.metadata.currentTime}`);
  return result.metadata;
}

async function waitForPidExit(pid: number, timeout = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (pidExists(pid) && Date.now() < deadline) await new Promise(done => setTimeout(done, 20));
  const gone = !pidExists(pid);
  if (timeout === 5_000) assert.equal(gone, true, `controlled browser PID ${pid} remained after exact close`);
  return gone;
}

function pidExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function terminateProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); }
  catch { /* The exact controlled-browser process group already exited. */ }
}

const BROWSER_RUNNER = String.raw`
import { chromium } from "playwright-core";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { url, id, carrier, chrome } = JSON.parse(input);
let server;
const terminate = async () => {
  try { await server?.kill(); } catch {}
  process.exit(1);
};
process.once("SIGTERM", terminate);
process.once("SIGINT", terminate);
try {
  server = await chromium.launchServer({ executablePath: chrome, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  const browserPid = server.process().pid;
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(url + "/player.html");
  const metadata = await page.evaluate(async ({ id, carrier }) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = "/api/assets/" + encodeURIComponent(id) + "?s=" + encodeURIComponent(carrier);
    document.body.append(video);
    await new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error("video readiness timed out")), 10000);
      video.addEventListener("canplay", () => { clearTimeout(timer); resolveReady(); }, { once: true });
      video.addEventListener("error", () => { clearTimeout(timer); rejectReady(new Error("video error " + video.error?.code)); }, { once: true });
      video.load();
    });
    await video.play();
    const initial = video.currentTime;
    await new Promise((resolveProgress, rejectProgress) => {
      const timer = setTimeout(() => rejectProgress(new Error("video time did not progress")), 10000);
      const progressed = () => {
        if (video.currentTime <= initial + 0.1) return;
        clearTimeout(timer); video.removeEventListener("timeupdate", progressed); resolveProgress();
      };
      video.addEventListener("timeupdate", progressed);
    });
    return { readyState: video.readyState, duration: video.duration, currentTime: video.currentTime, width: video.videoWidth, height: video.videoHeight };
  }, { id, carrier });
  await browser.close();
  await server.close();
  process.stdout.write(JSON.stringify({ browserPid, metadata }));
} catch (error) {
  try { await server?.kill(); } catch {}
  const message = String(error?.stack ?? error).split(String(carrier)).join("[redacted]");
  process.stderr.write(message);
  process.exit(1);
}
`;
