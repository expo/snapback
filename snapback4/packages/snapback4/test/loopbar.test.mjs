import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containsPath, prepareVerificationLane } from "../../../loopbar/run.mjs";

test("reverification owns a fresh copy and does not touch sibling or live stores", () => {
  const root = mkdtempSync(join(tmpdir(), "sb4-loopbar-ownership-"));
  const lane = join(root, "run-1"), sibling = join(root, "run-10");
  let directory;
  const signals = [];
  const kill = process.kill;
  process.kill = (...args) => { signals.push(args); return true; };
  try {
    for (const path of [lane, sibling]) {
      mkdirSync(join(path, ".snapback4"), { recursive: true });
      writeFileSync(join(path, ".snapback4/live.db"), "live data");
    }
    mkdirSync(join(lane, "node_modules"));
    writeFileSync(join(lane, "node_modules/dependency.txt"), "dependency");
    mkdirSync(join(lane, "app/.snapback4"), { recursive: true });
    writeFileSync(join(lane, "app/.snapback4/live.db"), "nested live data");
    writeFileSync(join(lane, "app/program.q"), "query q(): return 1");
    assert.equal(containsPath(lane, lane), true);
    assert.equal(containsPath(lane, join(lane, "app")), true);
    assert.equal(containsPath(lane, sibling), false);
    assert.equal(containsPath(lane, join(lane, "../run-10")), false);
    directory = prepareVerificationLane(lane);
    assert.equal(existsSync(join(directory, ".snapback4")), false);
    assert.equal(existsSync(join(directory, "app/.snapback4")), false);
    assert.equal(readFileSync(join(directory, "app/program.q"), "utf8"), "query q(): return 1");
    assert.equal(realpathSync(join(directory, "node_modules")), realpathSync(join(lane, "node_modules")));
    mkdirSync(join(directory, ".snapback4"));
    writeFileSync(join(directory, ".snapback4/live.db"), "independent data");
    for (const path of [lane, sibling]) assert.equal(readFileSync(join(path, ".snapback4/live.db"), "utf8"), "live data");
    assert.equal(readFileSync(join(lane, "app/.snapback4/live.db"), "utf8"), "nested live data");
    assert.deepEqual(signals, [], "copying/reverification never signals a discovered process");
  } finally {
    process.kill = kill;
    if (directory) rmSync(directory, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
