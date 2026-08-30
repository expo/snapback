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
const fixture = resolve(workspaceRoot, "packages/compiler/fixtures/chat");

function command(args: string[], options: { env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  return spawnSync(args[0], args.slice(1), {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    timeout: options.timeout ?? 30_000,
  });
}

async function addIntegrationOperations(root: string): Promise<void> {
  await writeFile(join(root, "snapback/integration.ts"), `
import { query, t } from "snapback2";
import { memberships, profiles } from "./schema";

export const capped = query({}, ({ db }) =>
  db.scan(profiles.byId, [], { take: 1 }),
);

export const denied = query({ conversationId: t.id() }, ({ db, ctx, args }) => {
  db.require(db.exists(memberships.byConversationPrincipal, [args.conversationId, ctx.viewer]), "MEMBERSHIP_REQUIRED");
  return true;
});

`);
}

async function exited(child: ChildProcessWithoutNullStreams, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("owner did not exit")), timeoutMs)),
  ]);
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

  static async create(): Promise<RealOwnerHarness> {
    const external = process.env.SNAPBACK_URL;
    if (external) return new RealOwnerHarness({ owned: false, url: external, mode: "external" });

    const built = command(["cargo", "build", "-p", "snapback2"]);
    assert.equal(built.status, 0, `cargo build failed\n${built.stdout}\n${built.stderr}`);
    const root = await mkdtemp(join(tmpdir(), "snapback2-client-owner-"));
    await cp(join(fixture, "snapback"), join(root, "snapback"), { recursive: true });
    await addIntegrationOperations(root);
    const checked = command([binary, "check", "--project", root], {
      env: { ...process.env, SNAPBACK2_COMPILER: compiler },
    });
    assert.equal(checked.status, 0, `snapback2 check failed\n${checked.stdout}\n${checked.stderr}`);
    assert.match(checked.stdout, /^ok /, "snapback2 check did not certify the chat fixture");
    const harness = new RealOwnerHarness({ owned: true, root, url: "", mode: "dev" });
    await harness.start(false);
    return harness;
  }

  async start(serve: boolean): Promise<void> {
    assert.ok(this.owned && this.root, "an external owner cannot be started by the harness");
    assert.equal(this.child, undefined, "owner is already running");
    const args = ["dev", "--project", this.root, "--foreground", "--port", String(this.port ?? 0)];
    if (serve) args.push("--serve");
    const child = spawn(binary, args, {
      cwd: workspaceRoot,
      env: { ...process.env, SNAPBACK2_COMPILER: compiler },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const lines = createInterface({ input: child.stdout });
    const ready = await Promise.race([
      new Promise<string>((resolveLine, reject) => {
        lines.once("line", resolveLine);
        child.once("exit", (code) => reject(new Error(`owner exited ${code}: ${stderr}`)));
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`owner readiness timed out: ${stderr}`)), 10_000)),
    ]);
    lines.close();
    assert.match(ready, /^SNAPBACK_URL=http:\/\/127\.0\.0\.1:\d+$/);
    this.url = ready.slice("SNAPBACK_URL=".length);
    const port = Number(new URL(this.url).port);
    if (this.port !== undefined) assert.equal(port, this.port, "owner restart moved off its ephemeral port");
    this.port = port;
    this.mode = serve ? "serve" : "dev";
    process.env.SNAPBACK_URL = this.url;
  }

  async stop(): Promise<void> {
    assert.ok(this.owned && this.root, "an external owner cannot be stopped by the harness");
    const child = this.child;
    assert.ok(child, "owner is not running");
    const stopped = command([binary, "dev", "--project", this.root, "--stop", "--json"]);
    assert.equal(stopped.status, 0, `snapback2 dev --stop failed\n${stopped.stdout}\n${stopped.stderr}`);
    await exited(child);
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
  active ??= await RealOwnerHarness.create();
  process.env.SNAPBACK_URL = active.url;
  process.env.SNAPBACK2_REAL_OWNER_MODE = active.owned ? "self-started" : "external";
  return active;
}

export function realOwner(): RealOwnerHarness {
  assert.ok(active, "real owner harness was not configured");
  return active;
}
