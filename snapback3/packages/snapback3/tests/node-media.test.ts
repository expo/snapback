import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { qualifiedMediaHelper, SubprocessMediaValidator } from "../src/node/media.js";
import { OwnerError } from "../src/node/worker.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const debugHelper = join(repository, "snapback3/target/debug/snapback3-media");

test("helper qualification requires the exact fixture-backed protocol and format envelope", async context => {
  await access(debugHelper, constants.X_OK);
  const original = process.env.SNAPBACK3_MEDIA;
  context.after(() => {
    if (original === undefined) delete process.env.SNAPBACK3_MEDIA;
    else process.env.SNAPBACK3_MEDIA = original;
  });

  process.env.SNAPBACK3_MEDIA = debugHelper;
  assert.equal(await qualifiedMediaHelper(repository), debugHelper);

  const root = await mkdtemp(join(tmpdir(), "snapback3-media-qualification-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const stale = await helperScript(root, `
if (process.argv[2] === "capabilities") {
  process.stdout.write(JSON.stringify({ images: true, video: true }) + "\\n");
  process.exit(0);
}
process.exit(2);
`);
  process.env.SNAPBACK3_MEDIA = stale;
  assert.equal(await qualifiedMediaHelper(repository), undefined, "a stale boolean-only helper is never certified");
});

test("spawn failure settles before validator close releases custody", async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-media-spawn-error-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  await writeFile(source, "bytes");
  const validator = new SubprocessMediaValidator({ command: join(root, "missing-helper"), closeTimeoutMs: 2_000 });
  await assert.rejects(validator.validate("image", source, join(root, "output")), hasCode("S3_MEDIA_START"));
  await validator.close();
});

test("timeout retains helper and descendant custody through observed group exit", async context => {
  const boundary = await boundaryFixture(context);
  const validator = new SubprocessMediaValidator({
    command: boundary.command, timeoutMs: 500, rssSampleMs: 1_000,
    maxRssBytes: 512 * 1024 * 1024, closeTimeoutMs: 2_000,
  });
  context.after(() => validator.close());
  const source = join(boundary.root, "timeout-source");
  const destination = join(boundary.root, "timeout-output");
  await writeFile(source, "bytes");

  await assert.rejects(validator.validate("image", source, destination), hasCode("S3_MEDIA_TIMEOUT"));
  const pids = await boundaryPids(boundary.root, "timeout");
  await assertGone(pids.parent);
  await assertGone(pids.child);
  await assert.rejects(access(destination), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  console.log(`[media-boundary] timeout parent=${pids.parent} descendant=${pids.child} cleanup=observed-exit`);
});

test("direct helper exit still terminates an inherited decoder descendant", async context => {
  const boundary = await boundaryFixture(context);
  const validator = new SubprocessMediaValidator({ command: boundary.command, timeoutMs: 2_000, closeTimeoutMs: 2_000 });
  context.after(() => validator.close());
  const source = join(boundary.root, "exit-source");
  await writeFile(source, "bytes");

  await assert.rejects(
    validator.validate("image", source, join(boundary.root, "exit-output")),
    hasCode("S3_MEDIA_PROTOCOL"),
  );
  const pids = await boundaryPids(boundary.root, "exit");
  await assertGone(pids.parent);
  await assertGone(pids.child);
  console.log(`[media-boundary] direct-exit parent=${pids.parent} descendant=${pids.child} cleanup=observed-exit`);
});

test("sampled RSS breach kills the exact process group and reports the sampled boundary honestly", async context => {
  const boundary = await boundaryFixture(context);
  const validator = new SubprocessMediaValidator({
    command: boundary.command, timeoutMs: 2_000, rssSampleMs: 10,
    maxRssBytes: 128 * 1024 * 1024, closeTimeoutMs: 2_000,
  });
  context.after(() => validator.close());
  const source = join(boundary.root, "memory-source");
  await writeFile(source, "bytes");

  await assert.rejects(validator.validate("image", source, join(boundary.root, "memory-output")), hasCode("S3_MEDIA_MEMORY"));
  const pids = await boundaryPids(boundary.root, "memory");
  await assertGone(pids.parent);
  await assertGone(pids.child);
  console.log(`[media-boundary] sampled-rss parent=${pids.parent} descendant=${pids.child} cleanup=observed-exit`);
});

test("RSS monitor failure is a coded refusal and retains exact child custody", async context => {
  const boundary = await boundaryFixture(context);
  const validator = new SubprocessMediaValidator({
    command: boundary.command, timeoutMs: 2_000, rssSampleMs: 10, closeTimeoutMs: 2_000,
    sampleRss: async () => {
      await waitForFile(join(boundary.root, "monitor-pids.json"));
      throw new Error("injected sampler failure");
    },
  });
  context.after(() => validator.close());
  const source = join(boundary.root, "monitor-source");
  await writeFile(source, "bytes");

  await assert.rejects(validator.validate("image", source, join(boundary.root, "monitor-output")), hasCode("S3_MEDIA_MEMORY_POLICY"));
  const pids = await boundaryPids(boundary.root, "monitor");
  await assertGone(pids.parent);
  await assertGone(pids.child);
  console.log(`[media-boundary] rss-monitor-failure parent=${pids.parent} descendant=${pids.child} cleanup=observed-exit`);
});

test("close rejects queued validation, stops the active child, and waits for its cleanup", async context => {
  const boundary = await boundaryFixture(context);
  const validator = new SubprocessMediaValidator({
    command: boundary.command, timeoutMs: 10_000, maxConcurrent: 1, maxQueued: 1,
    rssSampleMs: 1_000, closeTimeoutMs: 2_000,
  });
  context.after(() => validator.close());
  const activeSource = join(boundary.root, "close-source");
  const queuedSource = join(boundary.root, "queued-source");
  await Promise.all([writeFile(activeSource, "bytes"), writeFile(queuedSource, "bytes")]);
  const active = validator.validate("image", activeSource, join(boundary.root, "close-output"));
  await waitForFile(join(boundary.root, "close-pids.json"));
  const queued = validator.validate("image", queuedSource, join(boundary.root, "queued-output"));
  const activeRefusal = assert.rejects(active, hasCode("S3_OWNER_CLOSED"));
  const queuedRefusal = assert.rejects(queued, hasCode("S3_OWNER_CLOSED"));
  await assert.rejects(
    validator.validate("image", queuedSource, join(boundary.root, "overflow-output")),
    hasCode("S3_OWNER_BUSY"),
  );

  await validator.close();
  await activeRefusal;
  await queuedRefusal;
  const pids = await boundaryPids(boundary.root, "close");
  await assertGone(pids.parent);
  await assertGone(pids.child);
  assert.equal(await fileExists(join(boundary.root, "queued-pids.json")), false, "queued work never spawns after the close fence");
  console.log(`[media-boundary] close parent=${pids.parent} descendant=${pids.child} cleanup=observed-exit queued=never-spawned`);
});

async function boundaryFixture(context: TestContext): Promise<{ root: string; command: string }> {
  const root = await mkdtemp(join(tmpdir(), "snapback3-media-boundary-"));
  const observed = new Set<number>();
  context.after(async () => {
    for (const name of ["timeout", "exit", "memory", "monitor", "close", "queued"]) {
      try {
        const pids = await boundaryPids(root, name);
        observed.add(pids.parent); observed.add(pids.child);
      } catch { /* This mode did not start. */ }
    }
    for (const pid of observed) terminateExact(pid);
    await rm(root, { recursive: true, force: true });
  });
  const command = await helperScript(root, `
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
if (process.argv[2] === "capabilities") {
  process.stdout.write(JSON.stringify({ protocol: "snapback3-media/1", images: true, video: true, imageTypes: ["image/jpeg", "image/png", "image/webp"], videoTypes: ["video/mp4"] }) + "\\n");
  process.exit(0);
}
const source = process.argv[4];
const destination = process.argv[5];
const mode = path.basename(source).split("-", 1)[0];
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
child.unref();
fs.writeFileSync(path.join(path.dirname(destination), mode + "-pids.json"), JSON.stringify({ parent: process.pid, child: child.pid }));
if (mode === "memory") global.payload = Buffer.alloc(256 * 1024 * 1024, 1);
if (mode === "exit") process.exit(0);
setInterval(() => {}, 1000);
`);
  return { root, command };
}

async function helperScript(root: string, body: string): Promise<string> {
  const path = join(root, `helper-${Math.random().toString(16).slice(2)}`);
  await writeFile(path, `#!${process.execPath}\n${body}`, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

async function boundaryPids(root: string, mode: string): Promise<{ parent: number; child: number }> {
  const value: unknown = JSON.parse(await readFile(join(root, `${mode}-pids.json`), "utf8"));
  assert(value && typeof value === "object" && !Array.isArray(value));
  const { parent, child } = value as Record<string, unknown>;
  assert(Number.isInteger(parent) && (parent as number) > 0);
  assert(Number.isInteger(child) && (child as number) > 0);
  return { parent: parent as number, child: child as number };
}

function hasCode(code: string): (error: unknown) => boolean {
  return error => error instanceof OwnerError && error.code === code;
}

async function assertGone(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (processExists(pid) && Date.now() < deadline) await new Promise(done => setTimeout(done, 10));
  assert.equal(processExists(pid), false, `subprocess ${pid} remained after custody settled`);
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error
      && (error as NodeJS.ErrnoException).code === "EPERM");
  }
}

function terminateExact(pid: number): void {
  try { process.kill(pid, "SIGKILL"); }
  catch { /* The exact recorded process already exited. */ }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!await fileExists(path) && Date.now() < deadline) await new Promise(done => setTimeout(done, 10));
  assert.equal(await fileExists(path), true, `timed out waiting for ${path}`);
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
