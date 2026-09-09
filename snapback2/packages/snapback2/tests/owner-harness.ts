import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "../..");
const binary = resolve(workspaceRoot, "target/debug/snapback2");
const compiler = resolve(packageRoot, "dist/compiler.mjs");
const fixture = resolve(workspaceRoot, "packages/compiler/fixtures/quarry-chat");

function command(args: string[], options: { env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  return spawnSync(args[0], args.slice(1), {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    timeout: options.timeout ?? 30_000,
  });
}

async function addIntegrationOperations(root: string, withDeliveries: boolean): Promise<void> {
  if (withDeliveries) await cp(join(packageRoot, "templates/chat/snapback/deliveries.q"), join(root, "snapback/deliveries.q"));
  await writeFile(join(root, "snapback/integration.q"), `query capped():
  return profiles[] first 1 by byId

query denied(conversationId: id):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return true

query inbox(c: cursor ?):
  return deliveries[viewer] after c first 20 by byRecipientAt { id, conversationId: conversations[.conversationId] { *, creatorProfile: profiles[.creatorId] } }

query inboxHeld(c: cursor ?):
  return deliveries[viewer] after c first 20 by byRecipientAt { id, conversationId, chat: conversations[.conversationId] { *, creatorProfile: profiles[.creatorId] } }

query inboxPlain(c: cursor ?):
  return deliveries[viewer] after c first 20 by byRecipientAt

query inboxObject(after: cursor ?, label: text <=40 ?):
  return { entries: deliveries[viewer] after after first 1 by byRecipientAt { id, kind } }

query inboxProjected(after: cursor ?, label: text <=40 ?):
  return deliveries[viewer] after after first 1 by byRecipientAt { id, kind }
`);
}

async function exited(child: ChildProcessWithoutNullStreams, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const { promise, resolve: onExit, reject: onError } = Promise.withResolvers<void>();
  child.once("exit", onExit);
  child.once("error", onError);
  try {
    timer = setTimeout(() => onError(new Error("owner did not exit")), timeoutMs);
    await promise;
  } finally {
    clearTimeout(timer);
    child.off("exit", onExit);
    child.off("error", onError);
  }
}

export class RealOwnerHarness {
  readonly owned: boolean;
  readonly root?: string;
  url: string;
  mode: "external" | "dev" | "serve";
  private child?: ChildProcessWithoutNullStreams;
  private port?: number;

  private constructor(options: { owned: boolean; root?: string; url: string; mode: "external" | "dev" }) {
    this.owned = options.owned;
    this.root = options.root;
    this.url = options.url;
    this.mode = options.mode;
  }

  static async create(options: { fullChat?: boolean; withDeliveries?: boolean; fixture?: string; prepare?(root: string): Promise<void> } = {}): Promise<RealOwnerHarness> {
    const external = process.env.SNAPBACK_URL;
    if (external) return new RealOwnerHarness({ owned: false, url: external, mode: "external" });

    const built = command(["cargo", "build", "-p", "snapback2"]);
    assert.equal(built.status, 0, `cargo build failed\n${built.stdout}\n${built.stderr}`);
    const root = await mkdtemp(join(tmpdir(), "snapback2-client-owner-"));
    try {
      await cp(options.fixture ?? (options.fullChat ? join(packageRoot, "templates/chat/snapback") : join(fixture, "snapback")), join(root, "snapback"), { recursive: true });
      if (!options.fixture) await addIntegrationOperations(root, options.withDeliveries ?? false);
      await options.prepare?.(root);
      // `dev --foreground` compiles and certifies the project, loads its seed,
      // and opens the runtime before it publishes SNAPBACK_URL. A separate
      // `check` here repeats that complete startup admission in every test file.
      const harness = new RealOwnerHarness({ owned: true, root, url: "", mode: "dev" });
      await harness.start(false);
      return harness;
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  async start(serve: boolean): Promise<void> {
    assert.ok(this.owned && this.root, "an external owner cannot be started by the harness");
    assert.equal(this.child, undefined, "owner is already running");
    const args = ["dev", "--project", this.root, "--foreground", "--port", String(this.port ?? process.env.SNAPBACK2_TEST_PORT ?? 0)];
    if (serve) args.push("--serve");
    const child = spawn(binary, args, {
      cwd: workspaceRoot,
      env: { ...process.env, SNAPBACK2_COMPILER: compiler },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    if (process.env.SNAPBACK2_TEST_PORT) console.error(`test owner launched pid=${child.pid} port=${args.at(-1)} project=${this.root}`);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    const onStderr = (chunk: string) => { stderr += chunk; };
    child.stderr.on("data", onStderr);
    const lines = createInterface({ input: child.stdout });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { promise, resolve: onLine, reject: onError } = Promise.withResolvers<string>();
    const onExit = (code: number | null) => onError(new Error(`owner exited ${code}: ${stderr}`));
    lines.once("line", onLine);
    child.once("exit", onExit);
    child.once("error", onError);
    try {
      let ready: string;
      try {
        timer = setTimeout(() => onError(new Error(`owner readiness timed out: ${stderr}`)), 10_000);
        ready = await promise;
      } finally {
        clearTimeout(timer);
        lines.off("line", onLine);
        lines.close();
        child.off("exit", onExit);
        child.off("error", onError);
        child.stderr.off("data", onStderr);
      }
      assert.match(ready, /^SNAPBACK_URL=http:\/\/127\.0\.0\.1:\d+$/);
      this.url = ready.slice("SNAPBACK_URL=".length);
      const port = Number(new URL(this.url).port);
      if (this.port !== undefined) assert.equal(port, this.port, "owner restart moved off its ephemeral port");
      this.port = port;
      this.mode = serve ? "serve" : "dev";
      process.env.SNAPBACK_URL = this.url;
    } catch (error) {
      // Startup never handed this child to a caller; reap only the PID we spawned.
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited(child);
      }
      this.child = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    assert.ok(this.owned && this.root, "an external owner cannot be stopped by the harness");
    const child = this.child;
    assert.ok(child, "owner is not running");
    // Keep the JS event loop moving while the owner drains fetch keep-alive
    // sockets; a synchronous child wait can hold the very sockets it needs.
    const stopping = spawn(binary, ["dev", "--project", this.root, "--stop", "--json"], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    stopping.stdout.setEncoding("utf8");
    stopping.stderr.setEncoding("utf8");
    stopping.stdout.on("data", (chunk) => { stdout += chunk; });
    stopping.stderr.on("data", (chunk) => { stderr += chunk; });
    const status = await new Promise<number | null>((resolveExit, reject) => {
      stopping.once("error", reject);
      stopping.once("exit", resolveExit);
    });
    assert.equal(status, 0, `snapback2 dev --stop failed\n${stdout}\n${stderr}`);
    await exited(child);
    if (process.env.SNAPBACK2_TEST_PORT) console.error(`test owner stopped pid=${child.pid} port=${this.port}`);
    this.child = undefined;
  }

  async close(): Promise<void> {
    if (!this.owned) return;
    if (this.child) {
      try {
        await this.stop();
      } catch {
        this.child.kill();
        await exited(this.child).catch(() => undefined);
        this.child = undefined;
      }
    }
    if (this.root) await rm(this.root, { recursive: true, force: true });
  }
}

let active: RealOwnerHarness | undefined;

export async function configureRealOwner(): Promise<RealOwnerHarness> {
  active ??= await RealOwnerHarness.create({ withDeliveries: true });
  process.env.SNAPBACK_URL = active.url;
  process.env.SNAPBACK2_REAL_OWNER_MODE = active.owned ? "self-started" : "external";
  return active;
}

export function realOwner(): RealOwnerHarness {
  assert.ok(active, "real owner harness was not configured");
  return active;
}
