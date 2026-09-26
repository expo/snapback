import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

async function runHelper(binary, directory) {
  return new Promise(resolve => {
    const child = spawn(binary, [directory], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", error, entered = false;
    const stop = phase => {
      error = new Error(`native helper timed out during ${phase}`);
      child.kill("SIGKILL");
    };
    let timer = setTimeout(() => stop("process launch"), 120_000);
    child.stdout.on("data", bytes => { stdout += bytes; });
    child.stderr.on("data", bytes => {
      stderr += bytes;
      if (!entered && stderr.split("\n").includes("SNAPBACK4_TEST_MAIN_REACHED")) {
        entered = true;
        clearTimeout(timer);
        // Preserve the original execution bound after Swift main is reached.
        timer = setTimeout(() => stop("execution"), 15_000);
      }
    });
    child.on("error", failure => { error = failure; });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (!entered) error ??= new Error("native helper exited without reaching main");
      resolve({ status, signal, stdout, stderr, error });
    });
  });
}

test("Expo native media storage migrates MP4 filenames, decodes their URIs, and preserves cache lifecycle", {
  skip: process.platform !== "darwin" ? "requires macOS Foundation and AVFoundation" : false,
  timeout: 180_000, // compilation (40 s), OS launch (120 s), execution (15 s)
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "snapback4-media-files-"));
  try {
    const binary = join(directory, "media-files-test");
    const helper = fileURLToPath(new URL("../../snapback4-expo/ios/MediaFiles.swift", import.meta.url));
    const harness = fileURLToPath(new URL("../../snapback4-expo/test/MediaFilesTests.swift", import.meta.url));
    const architecture = process.arch === "arm64" ? "arm64" : "x86_64";
    const build = spawnSync("xcrun", ["swiftc", "-swift-version", "5", "-target", `${architecture}-apple-macosx13.0`, helper, harness, "-o", binary], { encoding: "utf8", timeout: 40_000 });
    assert.equal(build.status, 0, `native helper compile failed: ${build.error ?? ""}\n${build.stdout}\n${build.stderr}`);
    const run = await runHelper(binary, directory);
    assert.equal(run.error, undefined, `${run.error ?? ""}\n${run.stdout}\n${run.stderr}`);
    assert.equal(run.status, 0, `native helper checks failed: ${run.error ?? ""}\n${run.stdout}\n${run.stderr}`);
    assert.equal(run.stdout.split("\n").filter(line => line.startsWith("PASS ")).length, 7, run.stdout);
    process.stdout.write(run.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
