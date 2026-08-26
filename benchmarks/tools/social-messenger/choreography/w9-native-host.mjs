#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// @ref LLP 0266#d10-acceptance-harness-direction-for-oq2 — retain a semantic
// interaction artifact from the real Exact iOS/macOS host, separate from web.
function usage() {
  return "Usage: node w9-native-host.mjs --platform <ios|mac> --out <receipt.json>";
}

function parseArgs(argv) {
  const options = { platform: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--platform") options.platform = argv[++index];
    else if (argv[index] === "--out") options.out = argv[++index];
    else if (argv[index] === "--help") return { help: true };
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!new Set(["ios", "mac"]).has(options.platform) || !options.out) throw new Error(usage());
  return { ...options, out: resolve(options.out) };
}

function compact(value) {
  return {
    ok: value?.ok === true,
    matched: value?.data?.matched ?? null,
    dispatched: value?.data?.dispatched ?? null,
    nativeReachability: value?.data?.nativeReachability ?? null,
    targetId: value?.targetId ?? null,
    registrationGeneration: value?.registrationGeneration ?? null,
  };
}

function treeText(value) {
  const tree = value?.data?.tree?.tree;
  assert.equal(typeof tree, "string", "Exact snapshot did not return a dense tree");
  return tree;
}

function treeSha256(tree) {
  return `sha256:${createHash("sha256").update(tree).digest("hex")}`;
}

function fullTreeRoot(value) {
  const root = value?.data?.tree?.root;
  assert.ok(root && typeof root === "object", "Exact snapshot did not return a full tree root");
  return root;
}

function findByTestId(root, testId, matches = []) {
  if (root?.props?.testId === testId) matches.push(root);
  for (const child of root?.children ?? []) findByTestId(child, testId, matches);
  return matches;
}

function assertSelectedTab(root, selectedTestId, unselectedTestId) {
  const selected = findByTestId(root, selectedTestId);
  const unselected = findByTestId(root, unselectedTestId);
  assert.equal(selected.length, 1, `expected one ${selectedTestId} node`);
  assert.equal(unselected.length, 1, `expected one ${unselectedTestId} node`);
  const observation = {
    selectedTestId,
    selectedValue: selected[0].props?.accessibilitySelected,
    unselectedTestId,
    unselectedValue: unselected[0].props?.accessibilitySelected,
  };
  assert.equal(observation.selectedValue, true, `${selectedTestId} was not selected`);
  assert.equal(observation.unselectedValue, false, `${unselectedTestId} remained selected`);
  return observation;
}

function serializedTree(root) {
  return JSON.stringify(root);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(`${usage()}\n`); return; }
  const origin = process.env.EXACT_DEV_URL ?? "http://127.0.0.1:5173";
  const token = process.env.EXACT_AGENT_TOKEN ?? null;
  const tokenFingerprint = token
    ? createHash("sha256").update(token).digest("hex").slice(0, 16)
    : null;
  const agentBase = `${origin}/__exact/agent`;
  const headers = {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  async function json(path, init = {}) {
    const response = await fetch(`${agentBase}${path}`, { ...init, headers: { ...headers, ...init.headers } });
    const value = await response.json();
    if (!response.ok || value.error) throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}`);
    return value;
  }

  const receipt = {
    schemaVersion: "social-messenger.w9-native-host.v1",
    platform: options.platform,
    startedAt: new Date().toISOString(),
    origin,
    tokenFingerprint,
    target: null,
    actions: [],
    tree: null,
    pass: false,
  };
  const deadline = Date.now() + Number(process.env.W9_NATIVE_DISCOVERY_TIMEOUT_MS ?? 120_000);
  let target = null;
  while (Date.now() < deadline) {
    try {
      const targets = await json("/targets");
      const candidates = (targets.targets ?? []).filter((candidate) => (
        candidate.live === true
        && candidate.platform === options.platform
        && candidate.agentUrl
        && Number.isSafeInteger(candidate.generation)
        && candidate.generation > 0
        && candidate.hostStatus?.phase === "rendered"
        && candidate.hostStatus?.load?.state === "completed"
        && candidate.tokenFingerprint === tokenFingerprint
      ));
      if (candidates.length === 1) { target = candidates[0]; break; }
    } catch {
      // The Exact relay and host register independently; discovery is bounded.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  assert.ok(target, `expected one rendered ${options.platform} Exact target at ${agentBase}`);
  receipt.target = {
    targetId: target.targetId,
    generation: target.generation,
    platform: target.platform,
    hostStatus: target.hostStatus,
  };
  const route = (path) => `${path}${path.includes("?") ? "&" : "?"}target=${encodeURIComponent(target.targetId)}&registrationGeneration=${target.generation}`;
  const post = (path, body) => json(route(path), { method: "POST", body: JSON.stringify(body) });
  const wait = async (testId) => {
    const value = await post("/wait", { condition: "viewExists", params: { testId }, timeout: 10_000 });
    assert.equal(value.data?.matched, true, `${testId} did not become visible`);
    receipt.actions.push({ action: "wait", testId, response: compact(value) });
  };
  const tap = async (testId, beforeRoot, unselectedTestId) => {
    const value = await post("/tap", {
      testId,
      observeAfter: { include: ["tree"], treeFormat: "full" },
    });
    assert.equal(value.data?.dispatched, true, `${testId} tap was not dispatched`);
    if (value.data?.nativeReachability !== undefined) {
      assert.equal(
        value.data.nativeReachability?.reachesTarget,
        true,
        `${testId} was not reachable through native hit testing`,
      );
    }
    const after = await post("/snapshot", { include: ["tree"], treeFormat: "full" });
    const afterRoot = fullTreeRoot(after);
    const selectedState = assertSelectedTab(afterRoot, testId, unselectedTestId);
    const beforeTree = serializedTree(beforeRoot);
    const afterTree = serializedTree(afterRoot);
    assert.notEqual(afterTree, beforeTree, `${testId} tap produced no semantic tree delta`);
    receipt.actions.push({
      action: "tap",
      testId,
      response: compact(value),
      treeDelta: {
        beforeSha256: treeSha256(beforeTree),
        afterSha256: treeSha256(afterTree),
        changed: afterTree !== beforeTree,
      },
      selectedState,
    });
    return afterRoot;
  };

  await wait("sm-feed-tab-following");
  await wait("sm-feed-tab-global");
  const before = await post("/snapshot", { include: ["tree", "diagnostics"], treeFormat: "dense" });
  const tree = treeText(before);
  assert.match(tree, /testId=sm-feed-tab-following/u);
  assert.match(tree, /testId=sm-feed-tab-global/u);
  const initialFull = await post("/snapshot", { include: ["tree"], treeFormat: "full" });
  let fullRoot = fullTreeRoot(initialFull);
  const initialSelectedState = assertSelectedTab(
    fullRoot,
    "sm-feed-tab-following",
    "sm-feed-tab-global",
  );
  receipt.tree = {
    initialDenseSha256: treeSha256(tree),
    initialFullSha256: treeSha256(serializedTree(fullRoot)),
    initialSelectedState,
    requiredIds: ["sm-feed-tab-following", "sm-feed-tab-global"],
  };
  fullRoot = await tap("sm-feed-tab-global", fullRoot, "sm-feed-tab-following");
  await wait("sm-feed-item");
  fullRoot = await tap("sm-feed-tab-following", fullRoot, "sm-feed-tab-global");
  await wait("sm-feed-item");
  receipt.tree.finalFullSha256 = treeSha256(serializedTree(fullRoot));
  receipt.completedAt = new Date().toISOString();
  receipt.pass = true;
  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`W9 NATIVE HOST PASS ${JSON.stringify({ platform: options.platform, receipt: options.out })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`W9 NATIVE HOST FAIL ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
