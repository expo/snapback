#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const VERSION = "0.1.0-p1";
const SEGMENTS = ["m1", "m2", "m3", "m4", "m5", "m6"];
const DEFAULT_RECEIPTS_PATH = fileURLToPath(
  new URL("./receipts.jsonl", import.meta.url),
);

// CONTRACT.md is the sole authority for test IDs. `testId()` refuses any ID
// outside this frozen set so later additions cannot silently invent selectors.
const CONTRACT_TEST_IDS = new Set([
  "sm-auth-email",
  "sm-auth-password",
  "sm-auth-submit",
  "sm-feed-tab-following",
  "sm-feed-tab-global",
  "sm-feed-item",
  "sm-post-like",
  "sm-post-repost",
  "sm-post-reply",
  "sm-compose-input",
  "sm-compose-submit",
  "sm-profile-follow",
  "sm-profile-edit",
  "sm-profile-save",
  "sm-chats-item",
  "sm-convo-input",
  "sm-convo-send",
  "sm-convo-bubble",
  "sm-convo-typing",
  "sm-convo-receipt",
  "sm-convo-reaction",
  "sm-convo-quote",
  "sm-chatsettings-color",
  "sm-chatsettings-background",
  "sm-search-input",
  "sm-search-result",
  "sm-poll-option",
  "sm-poll-tally",
]);

function usage() {
  return `Usage: node choreography.mjs [all|m1|m2|m3|m4|m5|m6|m1,m3,...] [options]

Options:
  --browser <name>       chromium, firefox, or webkit (default: chromium)
  --headed               show browser windows (default: headless)
  --receipts <path>      JSONL output (default: ./receipts.jsonl beside script)
  --suite-status <path>  JSON suite-status input used for green summaries
  --timeout <ms>         ordinary assertion timeout (default: 10000)
  --help                  show this help

Required environment:
  CHOREO_BASE_URL
  CHOREO_PASSWORD, or both CHOREO_ALICE_PASSWORD and CHOREO_BOB_PASSWORD

See README.md for every environment variable and the suite-status shape.`;
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseSegments(value) {
  if (!value || value === "all") return [...SEGMENTS];
  const requested = value.split(",").filter(Boolean);
  if (requested.length === 0 || requested.some((item) => !SEGMENTS.includes(item))) {
    throw new Error(`invalid segment selection: ${value}`);
  }
  return [...new Set(requested)];
}

function parseArgs(argv) {
  const options = {
    browser: process.env.CHOREO_BROWSER ?? "chromium",
    headed: false,
    receiptsPath: process.env.CHOREO_RECEIPTS ?? DEFAULT_RECEIPTS_PATH,
    suiteStatusPath: process.env.CHOREO_SUITE_STATUS ?? null,
    timeoutMs: Number(process.env.CHOREO_TIMEOUT_MS ?? 10_000),
    segmentArg: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
    } else if (arg === "--headed") {
      options.headed = true;
    } else if (arg === "--browser") {
      options.browser = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--receipts") {
      options.receiptsPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--suite-status") {
      options.suiteStatusPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--timeout") {
      options.timeoutMs = Number(takeValue(argv, index, arg));
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else if (options.segmentArg !== null) {
      throw new Error(`unexpected second segment argument: ${arg}`);
    } else {
      options.segmentArg = arg;
    }
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout / CHOREO_TIMEOUT_MS must be a positive integer");
  }
  if (!new Set(["chromium", "firefox", "webkit"]).has(options.browser)) {
    throw new Error(`unsupported browser: ${options.browser}`);
  }

  options.segments = parseSegments(options.segmentArg);
  options.receiptsPath = resolve(options.receiptsPath);
  if (options.suiteStatusPath) {
    options.suiteStatusPath = resolve(options.suiteStatusPath);
  }
  return options;
}

function testId(root, id) {
  if (!CONTRACT_TEST_IDS.has(id)) {
    throw new Error(`selector is not present in CONTRACT.md: ${id}`);
  }
  return root.getByTestId(id);
}

function errorText(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replaceAll(/\s+/g, " ").slice(0, 600);
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}

async function createReceiptWriter(path, runId) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", "utf8");
  return async (receipt) => {
    const complete = {
      version: VERSION,
      runId,
      recordedAt: new Date().toISOString(),
      ...receipt,
    };
    const line = JSON.stringify(complete);
    process.stdout.write(`STRUCTURED RECEIPT ${line}\n`);
    await appendFile(path, `${line}\n`, "utf8");
    return complete;
  };
}

async function loadSuiteStatuses(path) {
  if (!path) return {};
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("suite-status input must be an object keyed by m1..m6");
  }
  for (const [segment, status] of Object.entries(parsed)) {
    if (!SEGMENTS.includes(segment)) {
      throw new Error(`suite-status input has unknown segment: ${segment}`);
    }
    if (!status || typeof status !== "object" || typeof status.pass !== "boolean") {
      throw new Error(`suite-status ${segment}.pass must be boolean`);
    }
    if (
      status.receipt !== undefined &&
      status.receipt !== null &&
      typeof status.receipt !== "string"
    ) {
      throw new Error(`suite-status ${segment}.receipt must be string or null`);
    }
    if (status.pass && (typeof status.receipt !== "string" || status.receipt.length === 0)) {
      throw new Error(`suite-status ${segment}.receipt must name evidence when pass is true`);
    }
  }
  return parsed;
}

function createCheckRunner(emit) {
  const bySegment = new Map();

  async function check(
    segment,
    assertion,
    { bestOf = 1, implemented = true, reason = null } = {},
    attemptFn = null,
  ) {
    if (![1, 3].includes(bestOf)) {
      throw new Error(`${segment}/${assertion}: bestOf must be 1 or 3`);
    }

    const timings = [];
    const successful = [];
    if (implemented) {
      for (let attempt = 1; attempt <= bestOf; attempt += 1) {
        const startedAt = new Date().toISOString();
        const started = performance.now();
        try {
          const result = (await attemptFn(attempt)) ?? {};
          const pass = result.pass !== false;
          const timing = {
            attempt,
            pass,
            startedAt,
            durationMs: rounded(performance.now() - started),
            metrics: result.metrics ?? {},
          };
          if (result.note) timing.note = result.note;
          timings.push(timing);
          if (pass) successful.push({ timing, data: result.data });
        } catch (error) {
          timings.push({
            attempt,
            pass: false,
            startedAt,
            durationMs: rounded(performance.now() - started),
            metrics: {},
            error: errorText(error),
          });
        }
      }
    }

    successful.sort((left, right) => left.timing.durationMs - right.timing.durationMs);
    const selected = successful[0] ?? null;
    const receipt = await emit({
      type: "assertion",
      segment,
      assertion,
      implemented,
      pass: implemented && selected !== null,
      timings,
      bestOf,
      details: {
        selection: bestOf === 3 ? "fastest passing attempt; all three retained" : "only attempt",
        selectedAttempt: selected?.timing.attempt ?? null,
        reason,
      },
    });
    const receipts = bySegment.get(segment) ?? [];
    receipts.push(receipt);
    bySegment.set(segment, receipts);
    return { ...receipt, data: selected?.data };
  }

  return { check, bySegment };
}

async function waitForValue(locator, predicate, timeoutMs, description) {
  const started = performance.now();
  while (performance.now() - started <= timeoutMs) {
    const observed = await predicate(locator);
    if (observed?.matched) {
      return { value: observed.value, elapsedMs: rounded(performance.now() - started) };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`${description} did not become observable within ${timeoutMs}ms`);
}

async function observableState(locator) {
  return locator.evaluate((element) => {
    const attributes = ["aria-label", "title", "data-state", "data-count"]
      .map((name) => element.getAttribute(name) ?? "")
      .join("|");
    return `${element.textContent ?? ""}|${attributes}`.replace(/\s+/g, " ").trim();
  });
}

async function waitForStateChange(locator, before, timeoutMs, description) {
  return waitForValue(
    locator,
    async (target) => {
      const value = await observableState(target);
      return { matched: value !== before, value };
    },
    timeoutMs,
    description,
  );
}

async function waitForCount(locator, predicate, timeoutMs, description) {
  return waitForValue(
    locator,
    async (target) => {
      const value = await target.count();
      return { matched: predicate(value), value };
    },
    timeoutMs,
    description,
  );
}

async function visibleTexts(locator) {
  const values = [];
  for (let index = 0; index < (await locator.count()); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) values.push((await candidate.innerText()).trim());
  }
  return values;
}

async function clickVisible(locator, timeoutMs) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: timeoutMs });
  await target.click();
  return target;
}

async function login(page, baseUrl, persona, timeoutMs) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await testId(page, "sm-auth-email").fill(persona.email);
  await testId(page, "sm-auth-password").fill(persona.password);
  await testId(page, "sm-auth-submit").click();

  const authenticatedSurface = testId(page, "sm-feed-tab-following")
    .or(testId(page, "sm-feed-tab-global"))
    .or(testId(page, "sm-profile-edit"))
    .or(testId(page, "sm-chats-item"))
    .or(testId(page, "sm-convo-input"))
    .or(testId(page, "sm-search-input"));
  await authenticatedSurface.first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function openGlobalFeed(page, timeoutMs) {
  await clickVisible(testId(page, "sm-feed-tab-global"), timeoutMs);
  await testId(page, "sm-feed-item").first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function openFollowingFeed(page, timeoutMs) {
  await clickVisible(testId(page, "sm-feed-tab-following"), timeoutMs);
  await testId(page, "sm-feed-item").first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function openConversation(page, counterpart, timeoutMs) {
  const chat = testId(page, "sm-chats-item")
    .filter({ hasText: new RegExp(counterpart, "i") })
    .first();
  await chat.waitFor({ state: "visible", timeout: timeoutMs });
  await chat.click();
  await testId(page, "sm-convo-input").waitFor({ state: "visible", timeout: timeoutMs });
}

async function openAliceBobConversation(ctx) {
  await Promise.all([
    testId(ctx.alicePage, "sm-convo-input").isVisible().then((visible) =>
      visible ? undefined : openConversation(ctx.alicePage, "Bob", ctx.timeoutMs),
    ),
    testId(ctx.bobPage, "sm-convo-input").isVisible().then((visible) =>
      visible ? undefined : openConversation(ctx.bobPage, "Alice", ctx.timeoutMs),
    ),
  ]);
}

async function sendConversationText(page, text, timeoutMs) {
  const input = testId(page, "sm-convo-input");
  await input.waitFor({ state: "visible", timeout: timeoutMs });
  await input.fill(text);
  await testId(page, "sm-convo-send").click();
  const bubble = testId(page, "sm-convo-bubble").filter({ hasText: text }).last();
  await bubble.waitFor({ state: "visible", timeout: timeoutMs });
  return bubble;
}

async function m1(ctx) {
  await ctx.check(
    "m1",
    "profile-edit-live-visibility",
    {
      implemented: false,
      bestOf: 3,
      reason:
        "CONTRACT.md has edit/save IDs but no profile navigation or display-name/bio input IDs; the skeleton will not guess selectors.",
    },
  );
}

async function m2(ctx) {
  const livePost = await ctx.check(
    "m2",
    "feed-text-post-live-update",
    { bestOf: 3 },
    async (attempt) => {
      await Promise.all([
        openGlobalFeed(ctx.alicePage, ctx.timeoutMs),
        openGlobalFeed(ctx.bobPage, ctx.timeoutMs),
      ]);
      const postText = `choreo-${ctx.runId}-m2-feed-${attempt}`;
      await testId(ctx.alicePage, "sm-compose-input").fill(postText);
      const started = performance.now();
      await testId(ctx.alicePage, "sm-compose-submit").click();
      const bobCard = testId(ctx.bobPage, "sm-feed-item").filter({ hasText: postText }).first();
      await bobCard.waitFor({ state: "visible", timeout: ctx.timeoutMs });
      return {
        metrics: { visibleMs: rounded(performance.now() - started) },
        data: { postText },
      };
    },
  );

  await ctx.check("m2", "feed-image-post-live-update", {
    implemented: false,
    bestOf: 3,
    reason: "The contract exposes no media-post picker or upload test ID.",
  });
  await ctx.check("m2", "feed-video-post-live-update", {
    implemented: false,
    bestOf: 3,
    reason: "The contract exposes no media-post picker or upload test ID.",
  });
  await ctx.check("m2", "follow-unfollow-live-projection", {
    implemented: false,
    bestOf: 3,
    reason:
      "sm-profile-follow exists, but the contract exposes no deterministic way to navigate Bob to Alice's profile.",
  });

  await ctx.check(
    "m2",
    "like-unlike-live-count",
    { bestOf: 3 },
    async () => {
      if (!livePost.data?.postText) throw new Error("live-post prerequisite did not yield a post");
      await Promise.all([
        openGlobalFeed(ctx.alicePage, ctx.timeoutMs),
        openGlobalFeed(ctx.bobPage, ctx.timeoutMs),
      ]);
      const aliceCard = testId(ctx.alicePage, "sm-feed-item")
        .filter({ hasText: livePost.data.postText })
        .first();
      const bobCard = testId(ctx.bobPage, "sm-feed-item")
        .filter({ hasText: livePost.data.postText })
        .first();
      const aliceLike = testId(aliceCard, "sm-post-like");
      const bobLike = testId(bobCard, "sm-post-like");
      const before = await observableState(aliceLike);
      await bobLike.click();
      const liked = await waitForStateChange(
        aliceLike,
        before,
        ctx.timeoutMs,
        "Alice's live like count",
      );
      await bobLike.click();
      const unliked = await waitForValue(
        aliceLike,
        async (target) => {
          const value = await observableState(target);
          return { matched: value === before, value };
        },
        ctx.timeoutMs,
        "Alice's live unlike count",
      );
      return {
        metrics: {
          likeVisibleMs: rounded(liked.elapsedMs),
          unlikeVisibleMs: rounded(unliked.elapsedMs),
        },
      };
    },
  );

  await ctx.check(
    "m2",
    "repost-toggle-live-attribution",
    { bestOf: 3 },
    async () => {
      if (!livePost.data?.postText) throw new Error("live-post prerequisite did not yield a post");
      await Promise.all([
        openGlobalFeed(ctx.alicePage, ctx.timeoutMs),
        openGlobalFeed(ctx.bobPage, ctx.timeoutMs),
      ]);
      const aliceMatches = testId(ctx.alicePage, "sm-feed-item").filter({
        hasText: livePost.data.postText,
      });
      const bobCard = testId(ctx.bobPage, "sm-feed-item")
        .filter({ hasText: livePost.data.postText })
        .first();
      const repost = testId(bobCard, "sm-post-repost");
      const before = await aliceMatches.count();
      await repost.click();
      const added = await waitForCount(
        aliceMatches,
        (count) => count > before,
        ctx.timeoutMs,
        "attributed repost in Alice's feed",
      );
      const texts = await aliceMatches.allInnerTexts();
      if (!texts.some((text) => /reposted by\s+bob/i.test(text))) {
        throw new Error("repost appeared without observable 'reposted by Bob' attribution");
      }
      await repost.click();
      const removed = await waitForCount(
        aliceMatches,
        (count) => count === before,
        ctx.timeoutMs,
        "repost removal in Alice's feed",
      );
      return {
        metrics: {
          repostVisibleMs: rounded(added.elapsedMs),
          unrepostVisibleMs: rounded(removed.elapsedMs),
        },
      };
    },
  );
  await ctx.check("m2", "repost-following-feed-surface", {
    implemented: false,
    bestOf: 3,
    reason:
      "This clause depends on first establishing a followed-user edge; deterministic profile navigation is absent from the frozen test-ID contract.",
  });

  await ctx.check(
    "m2",
    "reply-live-thread-projection",
    { bestOf: 3 },
    async (attempt) => {
      if (!livePost.data?.postText) throw new Error("live-post prerequisite did not yield a post");
      await Promise.all([
        openGlobalFeed(ctx.alicePage, ctx.timeoutMs),
        openGlobalFeed(ctx.bobPage, ctx.timeoutMs),
      ]);
      const replyText = `choreo-${ctx.runId}-m2-reply-${attempt}`;
      const aliceCard = testId(ctx.alicePage, "sm-feed-item")
        .filter({ hasText: livePost.data.postText })
        .first();
      const aliceReplyState = testId(aliceCard, "sm-post-reply");
      const before = await observableState(aliceReplyState);
      const bobCard = testId(ctx.bobPage, "sm-feed-item")
        .filter({ hasText: livePost.data.postText })
        .first();
      let enteredThread = false;
      let replyCountVisibleMs = null;
      try {
        await testId(bobCard, "sm-post-reply").click();
        enteredThread = true;
        await testId(ctx.bobPage, "sm-compose-input").fill(replyText);
        await testId(ctx.bobPage, "sm-compose-submit").click();
        const changed = await waitForStateChange(
          aliceReplyState,
          before,
          ctx.timeoutMs,
          "Alice's live reply count",
        );
        const threadItems = testId(ctx.bobPage, "sm-feed-item");
        await threadItems.filter({ hasText: replyText }).first().waitFor({
          state: "visible",
          timeout: ctx.timeoutMs,
        });
        const texts = await visibleTexts(threadItems);
        const parentIndex = texts.findIndex((text) => text.includes(livePost.data.postText));
        const replyIndex = texts.findIndex((text) => text.includes(replyText));
        if (parentIndex < 0 || replyIndex <= parentIndex) {
          throw new Error("thread did not show parent followed by the direct reply");
        }
        replyCountVisibleMs = rounded(changed.elapsedMs);
      } finally {
        if (enteredThread) await ctx.bobPage.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      }
      await openGlobalFeed(ctx.bobPage, ctx.timeoutMs);
      const visibleFeedReplies = await visibleTexts(
        testId(ctx.bobPage, "sm-feed-item").filter({ hasText: replyText }),
      );
      if (visibleFeedReplies.length > 0) {
        throw new Error("direct reply appeared in the Global feed");
      }
      await openFollowingFeed(ctx.bobPage, ctx.timeoutMs);
      const visibleFollowingReplies = await visibleTexts(
        testId(ctx.bobPage, "sm-feed-item").filter({ hasText: replyText }),
      );
      if (visibleFollowingReplies.length > 0) {
        throw new Error("direct reply appeared in the Following feed");
      }
      return { metrics: { replyCountVisibleMs } };
    },
  );
}

async function m3(ctx) {
  await ctx.check(
    "m3",
    "typing-indicator-within-2s-expires-within-5s",
    { bestOf: 3 },
    async (attempt) => {
      await openAliceBobConversation(ctx);
      const bobInput = testId(ctx.bobPage, "sm-convo-input");
      const aliceIndicator = testId(ctx.alicePage, "sm-convo-typing");
      await bobInput.fill("");
      await aliceIndicator.waitFor({ state: "hidden", timeout: 5_000 });
      const typingStartedAt = performance.now();
      await bobInput.pressSequentially(`typing-${ctx.runId}-${attempt}`, { delay: 25 });
      const lastKeystrokeAt = performance.now();
      await aliceIndicator.waitFor({ state: "visible", timeout: 2_000 });
      const visibleMs = rounded(performance.now() - typingStartedAt);
      const remainingExpiryMs = Math.max(
        1,
        Math.floor(5_000 - (performance.now() - lastKeystrokeAt)),
      );
      await aliceIndicator.waitFor({ state: "hidden", timeout: remainingExpiryMs });
      const expiresMs = rounded(performance.now() - lastKeystrokeAt);
      if (visibleMs > 2_000 || expiresMs > 5_000) {
        throw new Error(`typing timing missed ceiling: visible=${visibleMs}ms expires=${expiresMs}ms`);
      }
      return { metrics: { visibleMs, expiresMs } };
    },
  );

  await ctx.check("m3", "receipt-sent-delivered-read-transitions", {
    implemented: false,
    bestOf: 3,
    reason:
      "sm-convo-receipt identifies the element, but the contract does not pin an accessible sent/delivered/read state token; glyph/color inference would fake semantic proof.",
  });

  await ctx.check(
    "m3",
    "quoted-reply-excerpt-and-jump",
    { bestOf: 3 },
    async (attempt) => {
      await openAliceBobConversation(ctx);
      const original = `choreo-${ctx.runId}-m3-original-${attempt}`;
      const reply = `choreo-${ctx.runId}-m3-quote-${attempt}`;
      await sendConversationText(ctx.alicePage, original, ctx.timeoutMs);
      const bobOriginal = testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: original }).last();
      await bobOriginal.waitFor({ state: "visible", timeout: ctx.timeoutMs });
      await testId(bobOriginal, "sm-convo-quote").click();
      await sendConversationText(ctx.bobPage, reply, ctx.timeoutMs);
      const aliceReply = testId(ctx.alicePage, "sm-convo-bubble").filter({ hasText: reply }).last();
      await aliceReply.waitFor({ state: "visible", timeout: ctx.timeoutMs });
      if (!(await aliceReply.innerText()).includes(original)) {
        throw new Error("quoted reply bubble did not render the original excerpt");
      }
      await testId(aliceReply, "sm-convo-quote").click();
      const aliceOriginal = testId(ctx.alicePage, "sm-convo-bubble")
        .filter({ hasText: original })
        .last();
      await aliceOriginal.waitFor({ state: "visible", timeout: ctx.timeoutMs });
      const inViewport = await aliceOriginal.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      });
      if (!inViewport) throw new Error("quoted-excerpt activation did not jump to the original");
      return {};
    },
  );
}

async function m4(ctx) {
  const checks = [
    ["photo-message-live-render", "The contract exposes no media-message picker/upload test ID."],
    ["video-message-live-playback", "The contract exposes no media-message picker/upload test ID."],
    [
      "reaction-live-replace-remove",
      "sm-convo-reaction identifies reaction UI, but no emoji picker/choice state IDs are pinned.",
    ],
    ["edit-live-visibility", "The contract exposes no message edit action or editor test ID."],
    ["delete-live-tombstone", "The contract exposes no delete-for-everyone action test ID."],
  ];
  for (const [assertion, reason] of checks) {
    await ctx.check("m4", assertion, {
      implemented: false,
      bestOf: assertion.includes("live") ? 3 : 1,
      reason,
    });
  }
}

async function m5(ctx) {
  await ctx.check("m5", "chat-color-background-sync", {
    implemented: false,
    bestOf: 3,
    reason:
      "Color/background IDs exist, but chat-settings navigation, selected value, and background upload semantics are not pinned.",
  });
  await ctx.check("m5", "disappearing-message-expiry-and-purge", {
    implemented: false,
    bestOf: 3,
    reason: "The contract exposes no disappearing-setting or expiry-state test ID.",
  });
  await ctx.check("m5", "view-once-single-view-and-refusal", {
    implemented: false,
    bestOf: 1,
    reason: "The contract exposes no view-once compose, open, close, or denied-state test ID.",
  });
}

async function m6(ctx) {
  await ctx.check(
    "m6",
    "offline-message-queue-flush-in-order",
    { bestOf: 1 },
    async () => {
      await openAliceBobConversation(ctx);
      const first = `choreo-${ctx.runId}-m6-offline-1`;
      const second = `choreo-${ctx.runId}-m6-offline-2`;
      await ctx.aliceContext.setOffline(true);
      let firstBubble;
      let secondBubble;
      try {
        firstBubble = await sendConversationText(ctx.alicePage, first, ctx.timeoutMs);
        secondBubble = await sendConversationText(ctx.alicePage, second, ctx.timeoutMs);
        for (const bubble of [firstBubble, secondBubble]) {
          const receipt = testId(bubble, "sm-convo-receipt");
          await receipt.waitFor({ state: "visible", timeout: ctx.timeoutMs });
          const state = await observableState(receipt);
          if (!/\bpending\b/i.test(state)) {
            throw new Error(`offline message did not expose a pending state: ${state}`);
          }
        }
      } finally {
        await ctx.aliceContext.setOffline(false);
      }

      const flushStarted = performance.now();
      const bobFirst = testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: first }).last();
      const bobSecond = testId(ctx.bobPage, "sm-convo-bubble").filter({ hasText: second }).last();
      await bobFirst.waitFor({ state: "visible", timeout: ctx.timeoutMs });
      await bobSecond.waitFor({ state: "visible", timeout: ctx.timeoutMs });
      const flushMs = rounded(performance.now() - flushStarted);
      const texts = await visibleTexts(testId(ctx.bobPage, "sm-convo-bubble"));
      const firstIndex = texts.findIndex((text) => text.includes(first));
      const secondIndex = texts.findIndex((text) => text.includes(second));
      if (firstIndex < 0 || secondIndex <= firstIndex) {
        throw new Error("queued messages did not render on Bob in send order");
      }

      for (const bubble of [firstBubble, secondBubble]) {
        const receipt = testId(bubble, "sm-convo-receipt");
        await waitForValue(
          receipt,
          async (target) => {
            const value = await observableState(target);
            return { matched: /\bread\b/i.test(value), value };
          },
          ctx.timeoutMs,
          "normal read receipt after offline flush",
        );
      }
      return { metrics: { flushMs } };
    },
  );
}

const SEGMENT_FUNCTIONS = { m1, m2, m3, m4, m5, m6 };

// @ref LLP 0201#d2--quantitative-instrument — milestone green is the
// fail-closed conjunction of suite evidence and the full choreography segment.
async function emitSegmentSummary({
  emit,
  segment,
  assertionReceipts,
  durationMs,
  suiteStatus,
}) {
  const counts = {
    total: assertionReceipts.length,
    implemented: assertionReceipts.filter((item) => item.implemented).length,
    passed: assertionReceipts.filter((item) => item.pass).length,
    failed: assertionReceipts.filter((item) => item.implemented && !item.pass).length,
    notImplemented: assertionReceipts.filter((item) => !item.implemented).length,
  };
  const browserPass = counts.total > 0 && counts.passed === counts.total;
  const requiredExternal = segment === "m6" ? ["ios-simulator-m6"] : [];
  const externalPass = requiredExternal.length === 0 ? true : null;
  const choreographyPass = browserPass && externalPass === true;
  const suite = suiteStatus
    ? { pass: suiteStatus.pass, receipt: suiteStatus.receipt ?? null }
    : { pass: null, receipt: null };
  const green = suite.pass === true && choreographyPass;

  return emit({
    type: "segment-summary",
    segment,
    assertion: "__segment__",
    implemented: counts.implemented === counts.total && externalPass !== null,
    pass: choreographyPass,
    timings: [
      {
        attempt: 1,
        pass: choreographyPass,
        startedAt: null,
        durationMs: rounded(durationMs),
        metrics: {},
      },
    ],
    bestOf: 1,
    details: {
      selection: "segment aggregate",
      selectedAttempt: choreographyPass ? 1 : null,
      reason: externalPass === null ? "required simulator receipt is not implemented in P1" : null,
    },
    assertions: counts,
    suite,
    choreography: {
      browserPass,
      requiredExternal,
      externalPass,
      pass: choreographyPass,
    },
    green,
  });
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${errorText(error)}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const baseUrl = process.env.CHOREO_BASE_URL;
  const sharedPassword = process.env.CHOREO_PASSWORD;
  const alicePassword = process.env.CHOREO_ALICE_PASSWORD ?? sharedPassword;
  const bobPassword = process.env.CHOREO_BOB_PASSWORD ?? sharedPassword;
  if (!baseUrl || !alicePassword || !bobPassword) {
    process.stderr.write(`CHOREO_BASE_URL and persona password environment variables are required.\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  let playwright;
  try {
    playwright = await import("playwright");
  } catch (error) {
    process.stderr.write(
      `Playwright is unavailable. Provision package.json dependencies before running the harness: ${errorText(error)}\n`,
    );
    process.exitCode = 2;
    return;
  }

  const runId = randomUUID();
  const emit = await createReceiptWriter(options.receiptsPath, runId);
  const suiteStatuses = await loadSuiteStatuses(options.suiteStatusPath);
  const { check, bySegment } = createCheckRunner(emit);
  const browserType = playwright[options.browser];
  const browser = await browserType.launch({ headless: !options.headed });
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  const summaries = [];

  try {
    await Promise.all([
      login(
        alicePage,
        baseUrl,
        {
          email: process.env.CHOREO_ALICE_EMAIL ?? "alice@example.com",
          password: alicePassword,
        },
        options.timeoutMs,
      ),
      login(
        bobPage,
        baseUrl,
        {
          email: process.env.CHOREO_BOB_EMAIL ?? "bob@example.com",
          password: bobPassword,
        },
        options.timeoutMs,
      ),
    ]);

    const context = {
      runId,
      baseUrl,
      timeoutMs: options.timeoutMs,
      aliceContext,
      bobContext,
      alicePage,
      bobPage,
      check,
    };

    for (const segment of options.segments) {
      const started = performance.now();
      await SEGMENT_FUNCTIONS[segment](context);
      const summary = await emitSegmentSummary({
        emit,
        segment,
        assertionReceipts: bySegment.get(segment) ?? [],
        durationMs: performance.now() - started,
        suiteStatus: suiteStatuses[segment],
      });
      summaries.push(summary);
      if (segment !== options.segments.at(-1)) {
        await Promise.allSettled([
          alicePage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs }),
          bobPage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs }),
        ]);
      }
    }
  } finally {
    await Promise.allSettled([aliceContext.close(), bobContext.close()]);
    await browser.close();
  }

  process.exitCode = summaries.every((summary) => summary.green) ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`choreography fatal: ${errorText(error)}\n`);
  process.exitCode = 2;
});
