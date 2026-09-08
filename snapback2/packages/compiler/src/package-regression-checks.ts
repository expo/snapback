import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

type Test = (name: string, run: () => void | Promise<void>) => void;
type Assert = (condition: unknown, message: string) => asserts condition;
export type PackageBuildProof = () => Set<string>;

type LockOwner = { pid: number; token: string };

function parseLockOwner(text: string): LockOwner | undefined {
  try {
    const value = JSON.parse(text);
    return typeof value?.token === "string" && Number.isInteger(value?.pid) && value.pid > 1
      ? { pid: value.pid, token: value.token }
      : undefined;
  } catch {
    return undefined;
  }
}

function stopOwnedProcess(pid: number): boolean {
  try {
    process.kill(pid, 9);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function removeOwnedLock(lock: string, owner: LockOwner | undefined): Promise<void> {
  if (!owner) return;
  try {
    const current = parseLockOwner(await readFile(lock, "utf8"));
    if (current?.pid === owner.pid && current.token === owner.token) await rm(lock, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function registerPackageRegressionChecks(test: Test, assert: Assert, crate: string): PackageBuildProof {
  let reclaimedPackageFiles: Set<string> | undefined;
  const pack = (): Set<string> => {
    const packed = Bun.spawnSync({
      cmd: ["npm", "pack", "--dry-run", "--json"],
      cwd: `${crate}packages/snapback2`,
      env: { ...process.env, npm_config_cache: resolve(tmpdir(), "snapback2-npm-test-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(packed.exitCode === 0, `npm pack --dry-run failed: ${new TextDecoder().decode(packed.stderr)}`);
    const report = JSON.parse(new TextDecoder().decode(packed.stdout));
    return new Set((report[0]?.files ?? []).map((item: { path: string }) => item.path));
  };
  const packWithRecovery = (): Set<string> => {
    try {
      return pack();
    } catch (failure) {
      const rebuild = () => Bun.spawnSync({
        cmd: ["node", "build.mjs"],
        cwd: `${crate}packages/snapback2`,
        stdout: "pipe",
        stderr: "pipe",
      });
      let rebuilt: ReturnType<typeof rebuild>;
      try {
        rebuilt = rebuild();
      } catch (recoveryFailure) {
        const original = failure instanceof Error ? failure.message : String(failure);
        const recovery = recoveryFailure instanceof Error ? recoveryFailure.message : String(recoveryFailure);
        throw new AggregateError(
          [failure, recoveryFailure],
          `${original}\npackage fixture recovery failed: ${recovery}`,
        );
      }
      if (rebuilt.exitCode !== 0) {
        const original = failure instanceof Error ? failure.message : String(failure);
        const recovery = `${new TextDecoder().decode(rebuilt.stdout)}${new TextDecoder().decode(rebuilt.stderr)}`;
        throw new AggregateError(
          [failure, new Error(`package fixture recovery failed: ${recovery}`)],
          `${original}\npackage fixture recovery failed: ${recovery}`,
        );
      }
      throw failure;
    }
  };

  test("a killed package builder leaves a lock that the next build reclaims", async () => {
    const lock = resolve(crate, "target/b2-package-build.lock");
    const token = randomUUID();
    let owner: LockOwner | undefined;
    let ownerStopped = false;
    const holder = Bun.spawn({
      cmd: ["node", "-e", `
        const fs = require("node:fs");
        fs.writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, token: process.argv[2] }) + "\\n", { flag: "wx" });
        setInterval(() => {}, 1000);
      `, lock, token],
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        try {
          if ((await readFile(lock, "utf8")).includes(token)) break;
        } catch {}
        await Bun.sleep(10);
      }
      const held = await readFile(lock, "utf8");
      const acquired = parseLockOwner(held);
      assert(acquired?.token === token, "lock holder did not acquire the package build lock");
      owner = acquired;
      // The holder recorded its own pid. When `node` on PATH is a shim (volta spawns the
      // real node as a child), killing the spawned pid orphans the real holder, which keeps
      // the lock alive and its stderr pipe open; kill the recorded pid too.
      ownerStopped = stopOwnedProcess(owner.pid);
      if (holder.exitCode === null) holder.kill(9);
      await holder.exited;
      await rm(resolve(crate, "packages/snapback2/dist"), { recursive: true, force: true });
      reclaimedPackageFiles = packWithRecovery();
      assert(reclaimedPackageFiles.has("dist/compiler.mjs"), "package rebuild did not produce the compiler bundle");
      let lockRemains = true;
      try { await readFile(lock); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        lockRemains = false;
      }
      assert(!lockRemains, "package rebuild did not reclaim and release the killed holder's lock");
    } finally {
      if (owner && !ownerStopped) ownerStopped = stopOwnedProcess(owner.pid);
      if (holder.exitCode === null) holder.kill(9);
      await holder.exited;
      if (ownerStopped) await removeOwnedLock(lock, owner);
    }
  });

  test("publish builds its clean package snapshot before doctor and resumes a partial pair", () => {
    const checked = Bun.spawnSync({
      cmd: ["node", "scripts/publish.mjs", "--self-test"],
      cwd: crate,
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(
      checked.exitCode === 0 && new TextDecoder().decode(checked.stdout).includes("publish self-test ok"),
      `publish self-test failed: ${new TextDecoder().decode(checked.stdout)}${new TextDecoder().decode(checked.stderr)}`,
    );
  });

  test("the package shim reports spawn errors and preserves child signals", async () => {
    if (process.platform === "win32") return;
    const directory = await mkdtemp(join(tmpdir(), "snapback2-shim-"));
    try {
      const shim = join(directory, "package/bin/snapback2.mjs");
      const platformRoot = join(directory, `package/node_modules/snapback2-${process.platform}-${process.arch}`);
      const binary = join(platformRoot, "bin/snapback2");
      await mkdir(dirname(shim), { recursive: true });
      await mkdir(dirname(binary), { recursive: true });
      await writeFile(shim, await readFile(resolve(crate, "packages/snapback2/bin/snapback2.mjs")));
      await chmod(shim, 0o755);
      await writeFile(join(platformRoot, "package.json"), JSON.stringify({ name: `snapback2-${process.platform}-${process.arch}`, version: "0.0.0" }));
      await writeFile(binary, "#!/bin/sh\nexit 0\n");
      await chmod(binary, 0o644);

      const refused = Bun.spawnSync({ cmd: ["node", shim], stdout: "pipe", stderr: "pipe" });
      const refusal = new TextDecoder().decode(refused.stderr);
      assert(refused.exitCode === 1 && refusal.includes("EACCES") && refusal.includes(binary),
        `shim suppressed the spawn error or binary path: ${refusal}`);

      await writeFile(binary, "#!/bin/sh\nkill -TERM $$\n");
      await chmod(binary, 0o755);
      const signaled = Bun.spawnSync({
        cmd: ["node", "-e", `
          const { spawnSync } = require("node:child_process");
          const result = spawnSync(process.argv[1]);
          process.stdout.write(JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message }));
        `, shim],
        stdout: "pipe",
        stderr: "pipe",
      });
      const result = JSON.parse(new TextDecoder().decode(signaled.stdout));
      assert(result.status === null && result.signal === "SIGTERM" && result.error === undefined,
        `shim converted the child signal instead of preserving it: ${JSON.stringify(result)}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  // If lock recovery failed before it reached the real package build, the
  // package-content check still runs independently and reports its own result.
  return () => reclaimedPackageFiles ?? packWithRecovery();
}
