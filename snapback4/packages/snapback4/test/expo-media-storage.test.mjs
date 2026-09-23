import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("Expo native media storage migrates MP4 filenames, decodes their URIs, and preserves cache lifecycle", {
  skip: process.platform !== "darwin" ? "requires macOS Foundation and AVFoundation" : false,
  timeout: 60_000,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "snapback4-media-files-"));
  try {
    const binary = join(directory, "media-files-test");
    const helper = fileURLToPath(new URL("../../snapback4-expo/ios/MediaFiles.swift", import.meta.url));
    const harness = fileURLToPath(new URL("../../snapback4-expo/test/MediaFilesTests.swift", import.meta.url));
    const architecture = process.arch === "arm64" ? "arm64" : "x86_64";
    const build = spawnSync("xcrun", ["swiftc", "-swift-version", "5", "-target", `${architecture}-apple-macosx13.0`, helper, harness, "-o", binary], { encoding: "utf8", timeout: 40_000 });
    assert.equal(build.status, 0, `native helper compile failed: ${build.error ?? ""}\n${build.stdout}\n${build.stderr}`);
    const run = spawnSync(binary, [directory], { encoding: "utf8", timeout: 15_000 });
    assert.equal(run.status, 0, `native helper checks failed: ${run.error ?? ""}\n${run.stdout}\n${run.stderr}`);
    assert.equal(run.stdout.split("\n").filter(line => line.startsWith("PASS ")).length, 7, run.stdout);
    process.stdout.write(run.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
