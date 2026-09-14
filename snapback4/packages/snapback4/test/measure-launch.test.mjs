import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measureLaunch, parseArgs } from "../../../scripts/measure-launch.mjs";

test("launch arguments accept a binary, sample count and optional load", () => {
  assert.deepEqual(parseArgs(["./binary"]), { binary: resolve("binary"), n: 20, load: 0, timeoutMs: 60000 });
  assert.deepEqual(parseArgs(["--n", "3", "./binary", "--load", "2", "--timeout-ms", "500"]), { binary: resolve("binary"), n: 3, load: 2, timeoutMs: 500 });
  assert.deepEqual(parseArgs(["--help"]), { help: true });
  for (const args of [[], ["a", "b"], ["a", "--wat"], ["a", "--n"], ["a", "--n", "0"], ["a", "--n", "1.5"], ["a", "--n", "1e2"], ["a", "--n", "9007199254740992"], ["a", "--load", "-1"], ["a", "--timeout-ms", "0"], ["a", "--n", "1", "--n", "2"]])
    assert.throws(() => parseArgs(args), Error, JSON.stringify(args));
});

test("launch CLI help and argument refusals do not sign", () => {
  const script = fileURLToPath(new URL("../../../scripts/measure-launch.mjs", import.meta.url));
  const help = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:.*--n N.*--load WORKERS/);
  const invalid = spawnSync(process.execPath, [script, "binary", "--n", "0"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--n needs a positive integer/);
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "snapback4-measure-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binary = join(dir, "binary");
  writeFileSync(binary, "original");
  return { binary, n: 3, load: 2, timeoutMs: 500 };
}

test("launch JSON reports per-variant percentiles over fresh files, with copy and signing outside the timer", async (t) => {
  const options = fixture(t), paths = [], inodes = [], signs = [];
  const times = [0, 5, 100, 102, 200, 206, 300, 320, 400, 410, 500, 504];
  let stopped = 0;
  const record = await measureLaunch(options, {
    identity: () => "chosen",
    sign: (path, identity) => { assert.equal(identity, "chosen"); signs.push(path); appendFileSync(path, "-developer"); return { signingAuthority: "test authority", signingTeamId: "TEST" }; },
    startLoad: async count => { assert.equal(count, 2); return async () => { stopped++; }; },
    now: () => times.shift(),
    run: (cmd, args, opts) => {
      if (cmd === "codesign") {
        if (args.includes("--sign")) { assert.equal(args[2], "-"); signs.push(args.at(-1)); appendFileSync(args.at(-1), "-adhoc"); }
        return "";
      }
      paths.push(cmd); inodes.push(statSync(cmd).ino);
      assert.equal(readFileSync(cmd, "utf8"), cmd.includes("developerId") ? "original-developer" : "original-adhoc");
      assert.deepEqual(args, ["--version"]);
      assert.equal(opts.timeout, 500);
      return "snapback4 test\n";
    },
  });
  assert.equal(stopped, 1);
  assert.equal(signs.length, 2);
  assert.equal(new Set(paths).size, 6);
  assert.equal(new Set(inodes).size, 6);
  assert.equal(readFileSync(options.binary, "utf8"), "original");
  assert.equal(existsSync(dirname(signs[0])), false, "scratch files removed");
  assert.deepEqual(JSON.parse(JSON.stringify(record)), {
    binary: options.binary, version: "snapback4 test", n: 3, loadWorkers: 2, timeoutMs: 500, unit: "ms", percentile: "nearest-rank", freshCopyPerLaunch: true,
    signingAuthority: "test authority", signingTeamId: "TEST",
    variants: {
      adhoc: { n: 3, p50_ms: 10, p95_ms: 20, max_ms: 20, samples_ms: [5, 20, 10] },
      developerId: { n: 3, p50_ms: 4, p95_ms: 6, max_ms: 6, samples_ms: [2, 6, 4] },
    },
  });
});

test("a failed launch stops load workers, removes copies and refuses partial numbers", async (t) => {
  const options = fixture(t);
  let seed, stopped = false;
  await assert.rejects(measureLaunch(options, {
    identity: () => "chosen", sign: path => { seed = path; return {}; },
    startLoad: async () => async () => { stopped = true; },
    run: (cmd) => { if (cmd !== "codesign") throw Error("launch timed out"); },
  }), /adhoc sample 1 failed: launch timed out/);
  assert.equal(stopped, true);
  assert.equal(existsSync(dirname(seed)), false);
});

test("the optional CPU load worker starts and exits without signing in the test", { timeout: 10000 }, async (t) => {
  const options = { ...fixture(t), n: 1, load: 1 };
  const record = await measureLaunch(options, {
    identity: () => "chosen", sign: () => ({}),
    run: (cmd) => cmd === "codesign" ? "" : "snapback4 test\n",
  });
  assert.equal(record.loadWorkers, 1);
  assert.equal(record.variants.adhoc.n, 1);
  assert.equal(record.variants.developerId.n, 1);
});
