#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox } from "playwright";

import { testId } from "./choreography.mjs";

// @ref LLP 0266#d10-acceptance-harness-direction-for-oq2 — drive the real
// Coterie product in two simultaneous browser contexts and retain live proof.
function usage() {
  return "Usage: node w9-coterie-browser.mjs --browser <chromium|firefox> --base-url <url> --out <receipt.json> [--timeout <ms>]";
}

function parseArgs(argv) {
  const options = { browser: null, baseUrl: null, out: null, timeoutMs: 15_000 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--browser") options.browser = argv[++index];
    else if (argv[index] === "--base-url") options.baseUrl = argv[++index];
    else if (argv[index] === "--out") options.out = argv[++index];
    else if (argv[index] === "--timeout") options.timeoutMs = Number(argv[++index]);
    else if (argv[index] === "--help") return { help: true };
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!new Set(["chromium", "firefox"]).has(options.browser)) throw new Error(usage());
  if (!options.baseUrl || !options.out) throw new Error(usage());
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error("--timeout must be an integer >= 1000");
  }
  return {
    ...options,
    baseUrl: new URL(options.baseUrl).href,
    out: resolve(options.out),
  };
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function sourceBindings() {
  const sources = [
    ["smContract", "benchmarks/tools/social-messenger/CONTRACT.md", new URL("../CONTRACT.md", import.meta.url)],
    ["selectorAuthority", "benchmarks/tools/social-messenger/choreography/choreography.mjs", new URL("./choreography.mjs", import.meta.url)],
    ["runner", "benchmarks/tools/social-messenger/choreography/w9-coterie-browser.mjs", new URL(import.meta.url)],
    ["coteriePackage", "demos/coterie/package.json", new URL("../../../../demos/coterie/package.json", import.meta.url)],
    ["coterieWebEntry", "demos/coterie/src/main.tsx", new URL("../../../../demos/coterie/src/main.tsx", import.meta.url)],
    ["coterieFeedRoute", "demos/coterie/src/app/routes/index.contract", new URL("../../../../demos/coterie/src/app/routes/index.contract", import.meta.url)],
  ];
  return Object.fromEntries(await Promise.all(sources.map(async ([name, path, url]) => [
    name,
    { path, sha256: sha256(await readFile(url)) },
  ])));
}

async function loadPersonas() {
  const value = JSON.parse(await readFile(
    new URL("../../../fixtures/social-messenger/personas.json", import.meta.url),
    "utf8",
  ));
  return Object.fromEntries(value.starter.map((persona) => [persona.id, persona]));
}

async function signIn(page, persona, timeoutMs) {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const authSubmit = testId(page, "sm-auth-submit");
  const shell = page.getByTestId("coterie-shell");
  await Promise.any([
    authSubmit.waitFor({ state: "visible", timeout: timeoutMs }),
    shell.waitFor({ state: "visible", timeout: timeoutMs }),
  ]);
  if (await authSubmit.isVisible()) {
    await testId(page, "sm-auth-email").fill(persona.email);
    await testId(page, "sm-auth-password").fill(persona.password);
    await authSubmit.click();
  }
  await shell.waitFor({ state: "visible", timeout: timeoutMs });
  await page.getByTestId("coterie-root").waitFor({ state: "visible", timeout: timeoutMs });
}

async function selectGlobal(page, timeoutMs) {
  const tab = testId(page, "sm-feed-tab-global");
  await tab.click();
  assert.equal(await tab.getAttribute("aria-selected"), "true", "Global feed tab was not selected");
  await testId(page, "sm-feed-item").first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(`${usage()}\n`); return; }
  const engines = { chromium, firefox };
  const personas = await loadPersonas();
  const browser = await engines[options.browser].launch({ headless: true });
  const receipt = {
    schemaVersion: "social-messenger.w9-coterie-browser.v1",
    product: "Coterie",
    browser: options.browser,
    browserVersion: browser.version(),
    baseUrl: options.baseUrl,
    startedAt: new Date().toISOString(),
    sourceBindings: await sourceBindings(),
    contexts: [],
    liveJourney: null,
    pass: false,
  };
  let aliceContext;
  let bobContext;
  try {
    [aliceContext, bobContext] = await Promise.all([
      browser.newContext({ baseURL: options.baseUrl }),
      browser.newContext({ baseURL: options.baseUrl }),
    ]);
    const [alicePage, bobPage] = await Promise.all([
      aliceContext.newPage(),
      bobContext.newPage(),
    ]);
    await Promise.all([
      signIn(alicePage, personas.alice, options.timeoutMs),
      signIn(bobPage, personas.bob, options.timeoutMs),
    ]);
    await Promise.all([
      selectGlobal(alicePage, options.timeoutMs),
      selectGlobal(bobPage, options.timeoutMs),
    ]);

    const contextsAtMutation = browser.contexts();
    assert.equal(contextsAtMutation.length, 2, "expected exactly two live Playwright contexts");
    assert.equal(alicePage.isClosed(), false, "Alice page closed before the mutation");
    assert.equal(bobPage.isClosed(), false, "Bob page closed before the mutation");
    const marker = `w9-coterie-live-${Date.now()}-${process.pid}`;
    const aliceMarker = testId(alicePage, "sm-feed-item").filter({ hasText: marker });
    const bobMarker = testId(bobPage, "sm-feed-item").filter({ hasText: marker });
    const bobMarkerCountBefore = await bobMarker.count();
    assert.equal(bobMarkerCountBefore, 0, "live marker already existed in Bob's feed");
    let bobMainFrameNavigations = 0;
    bobPage.on("framenavigated", (frame) => {
      if (frame === bobPage.mainFrame()) bobMainFrameNavigations += 1;
    });
    const mutationStartedAt = new Date().toISOString();
    const mutationStartedMs = Date.now();
    await testId(alicePage, "sm-compose-input").fill(marker);
    await testId(alicePage, "sm-compose-submit").click();
    await Promise.all([
      aliceMarker.first().waitFor({ state: "visible", timeout: options.timeoutMs }),
      bobMarker.first().waitFor({ state: "visible", timeout: options.timeoutMs }),
    ]);
    const bobObservedAt = new Date().toISOString();
    const bobMarkerCountAfter = await bobMarker.count();
    assert.ok(bobMarkerCountAfter >= 1, "Bob did not observe Alice's post");
    assert.equal(bobMainFrameNavigations, 0, "Bob observed the post only after navigation/reload");
    receipt.contexts = [
      { persona: "alice", pageOpenAtMutation: !alicePage.isClosed(), url: alicePage.url() },
      { persona: "bob", pageOpenAtMutation: !bobPage.isClosed(), url: bobPage.url() },
    ];
    receipt.liveJourney = {
      mutation: "Alice creates a post; Bob observes it without navigation or reload",
      markerSha256: sha256(marker),
      observedContextCount: contextsAtMutation.length,
      mutationStartedAt,
      bobObservedAt,
      bobObservationLatencyMs: Date.now() - mutationStartedMs,
      bobMarkerCountBefore,
      bobMarkerCountAfter,
      bobMainFrameNavigations,
    };
    receipt.completedAt = new Date().toISOString();
    receipt.pass = true;
  } catch (error) {
    receipt.completedAt = new Date().toISOString();
    receipt.error = error instanceof Error ? error.message : String(error);
  } finally {
    await Promise.allSettled([aliceContext?.close(), bobContext?.close()]);
    await browser.close();
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  if (!receipt.pass) throw new Error(receipt.error ?? "Coterie browser journey failed");
  process.stdout.write(`W9 COTERIE BROWSER PASS ${JSON.stringify({
    browser: options.browser,
    receipt: options.out,
    observedContextCount: receipt.liveJourney.observedContextCount,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`W9 COTERIE BROWSER FAIL ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
