import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

type Test = (name: string, run: () => void | Promise<void>) => void;
type Assert = (condition: unknown, message: string) => asserts condition;
export type PackageBuildProof = () => Set<string>;

function killLockHolder(pid: unknown): void {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) return;
  try { process.kill(pid, 9); } catch {}
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

  test("a killed package builder leaves a lock that the next build reclaims", async () => {
    const lock = resolve(crate, "target/b2-package-build.lock");
    await rm(lock, { force: true });
    const holder = Bun.spawn({
      cmd: ["node", "-e", `
        const fs = require("node:fs");
        fs.writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, token: "killed-builder" }) + "\\n", { flag: "wx" });
        setInterval(() => {}, 1000);
      `, lock],
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        try {
          if ((await readFile(lock, "utf8")).includes("killed-builder")) break;
        } catch {}
        await Bun.sleep(10);
      }
      const held = await readFile(lock, "utf8");
      assert(held.includes("killed-builder"), "lock holder did not acquire the package build lock");
      // The holder recorded its own pid. When `node` on PATH is a shim (volta spawns the
      // real node as a child), killing the spawned pid orphans the real holder, which keeps
      // the lock alive and its stderr pipe open; kill the recorded pid too.
      killLockHolder(JSON.parse(held.trim()).pid);
      holder.kill(9);
      await holder.exited;
      await rm(resolve(crate, "packages/snapback2/dist"), { recursive: true, force: true });
      reclaimedPackageFiles = pack();
      assert(reclaimedPackageFiles.has("dist/compiler.mjs"), "package rebuild did not produce the compiler bundle");
      let lockRemains = true;
      try { await readFile(lock); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        lockRemains = false;
      }
      assert(!lockRemains, "package rebuild did not reclaim and release the killed holder's lock");
    } finally {
      try { killLockHolder(JSON.parse((await readFile(lock, "utf8")).trim()).pid); } catch {}
      if (holder.exitCode === null) holder.kill(9);
      await holder.exited;
      await rm(lock, { force: true });
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
  return () => reclaimedPackageFiles ?? pack();
}
