#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { constants, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signDeveloperId, signingIdentity } from "./signing.mjs";

export const usage = "Usage: node scripts/measure-launch.mjs <binary> [--n N] [--load WORKERS] [--timeout-ms MS]\nDefaults: --n 20 --load 0 --timeout-ms 60000. macOS; SNAPBACK4_SIGN_IDENTITY selects the Developer ID identity.";

export function parseArgs(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return { help: true };
  const options = { n: 20, load: 0, timeoutMs: 60000 };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      const name = { "--n": "n", "--load": "load", "--timeout-ms": "timeoutMs" }[arg];
      if (!name) throw new Error(`unknown option ${arg}`);
      if (seen.has(name)) throw new Error(`duplicate option ${arg}`);
      seen.add(name);
      const raw = args[++i];
      const value = Number(raw);
      if (!/^\d+$/.test(raw ?? "") || !Number.isSafeInteger(value) || value < (name === "load" ? 0 : 1))
        throw new Error(`${arg} needs ${name === "load" ? "a nonnegative" : "a positive"} integer`);
      options[name] = value;
    } else {
      if (options.binary) throw new Error("expected one binary path");
      options.binary = resolve(arg);
    }
  }
  if (!options.binary) throw new Error("a binary path is required");
  return options;
}

async function cpuLoad(count) {
  const workers = [];
  const stop = async () => {
    await Promise.all(workers.map(({ child, exited }) => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      return exited;
    }));
  };
  try {
    for (let i = 0; i < count; i++) {
      const child = spawn(process.execPath, ["-e", 'process.stdout.write("ready\\n", () => { while (true) Math.sqrt(Math.random()); });'], { stdio: ["ignore", "pipe", "inherit"] });
      const exited = new Promise(resolveExit => { child.once("exit", resolveExit); child.once("error", resolveExit); });
      workers.push({ child, exited });
      await new Promise((ready, reject) => {
        const timer = setTimeout(() => reject(new Error("CPU load worker did not start within 30 seconds")), 30000);
        const finish = (error) => { clearTimeout(timer); error ? reject(error) : ready(); };
        child.stdout.once("data", () => finish());
        child.once("error", finish);
        child.once("exit", () => finish(new Error("CPU load worker exited before measurement")));
      });
    }
    return stop;
  } catch (error) {
    await stop();
    throw error;
  }
}

function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = p => sorted[Math.ceil(sorted.length * p) - 1];
  return { n: samples.length, p50_ms: percentile(0.5), p95_ms: percentile(0.95), max_ms: sorted.at(-1), samples_ms: samples };
}

// The injected command boundary lets tests exercise real fresh files without
// reaching the keychain or presenting synthetic numbers as launch evidence.
export async function measureLaunch(options, { run = execFileSync, sign = signDeveloperId, identity = signingIdentity, startLoad = cpuLoad, now = () => performance.now() } = {}) {
  const { binary, n, load, timeoutMs } = options;
  if (!statSync(binary).isFile()) throw new Error(`binary is not a regular file: ${binary}`);
  const work = mkdtempSync(join(tmpdir(), "snapback4-launch-"));
  let stopLoad;
  try {
    const seeds = { adhoc: join(work, "adhoc"), developerId: join(work, "developer-id") };
    for (const path of Object.values(seeds)) copyFileSync(binary, path, constants.COPYFILE_EXCL);
    run("codesign", ["--force", "--sign", "-", seeds.adhoc], { stdio: ["ignore", "pipe", "pipe"] });
    run("codesign", ["--verify", "--strict", "--verbose=2", seeds.adhoc], { stdio: ["ignore", "pipe", "pipe"] });
    const signature = sign(seeds.developerId, identity());
    stopLoad = await startLoad(load);
    const samples = { adhoc: [], developerId: [] };
    let version;
    for (let i = 0; i < n; i++) {
      // Alternate order to avoid giving one variant every first launch.
      for (const variant of i % 2 ? ["developerId", "adhoc"] : ["adhoc", "developerId"]) {
        const dir = join(work, `${variant}-${i}`);
        mkdirSync(dir);
        const fresh = join(dir, "snapback4");
        // Each sample has a new inode/path; copy/sign time is outside the timer.
        // This probes fresh-file assessment, not a purge of all macOS caches.
        copyFileSync(seeds[variant], fresh, constants.COPYFILE_EXCL);
        const started = now();
        let result;
        try {
          result = run(fresh, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, killSignal: "SIGKILL" }).trim();
        } catch (error) {
          throw new Error(`${variant} sample ${i + 1} failed: ${error.stderr?.toString().trim() || error.message}`, { cause: error });
        }
        samples[variant].push(+(now() - started).toFixed(3));
        if (!result || (version !== undefined && result !== version)) throw new Error(`${variant} sample ${i + 1} returned an inconsistent --version`);
        version = result;
      }
    }
    return { binary, version, n, loadWorkers: load, timeoutMs, unit: "ms", percentile: "nearest-rank", freshCopyPerLaunch: true, ...signature, variants: { adhoc: summary(samples.adhoc), developerId: summary(samples.developerId) } };
  } finally {
    try { if (stopLoad) await stopLoad(); } finally { rmSync(work, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage);
    else {
      if (process.platform !== "darwin") throw new Error("launch signing measurement requires macOS");
      console.log(JSON.stringify(await measureLaunch(options)));
    }
  } catch (error) {
    console.error(`measure-launch: ${error.message}\n${usage}`);
    process.exitCode = 1;
  }
}
