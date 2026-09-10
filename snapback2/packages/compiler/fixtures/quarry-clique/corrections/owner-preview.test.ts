import { api } from "snapback2/client";
import { subscribe } from "snapback2/internal";
import { fixture, journey, type JourneyDevice } from "snapback2/test";

// Copy this file to snapback/tests/ in an isolated app, then run one case with:
// SNAPBACK2_COMPILER=/absolute/compiler.mjs \
// CLIQUE_EXPECTED_GENERATION=<64-hex-generation> \
// CLIQUE_PREVIEW_RECEIPT=/absolute/raw-case.json \
// /absolute/hermes/snapback2 test --journey "push effect executes scalars-80" --json
// Each case is separate so the existing five-second journey deadline remains
// meaningful. The receipt never contains the owner's control secret.
//
// The journey compiler intentionally exposes only browser libraries. These
// built-in imports are proof-only: they read the isolated owner's identity and
// write a caller-selected raw receipt outside the copied application.
// @ts-ignore -- executed by the Node journey runner.
import { createHash } from "node:crypto";
// @ts-ignore -- executed by the Node journey runner.
import { readFile, writeFile } from "node:fs/promises";
// @ts-ignore -- executed by the Node journey runner.
import { dirname, resolve } from "node:path";
// @ts-ignore -- executed by the Node journey runner.
import { fileURLToPath } from "node:url";

declare const process: { env: Record<string, string | undefined> };

type OwnerIdentity = {
  generation: string;
  secret: string;
};

type EffectRow = {
  attempts: number;
  effect: string;
  id: string;
  lastError: string | null;
  payload: { body?: unknown; to?: unknown };
  result: { body?: unknown; providerId?: unknown; to?: unknown } | null;
  seq: number;
  state: string;
};

type StoredPush = {
  chatId?: string;
  id?: string;
  kind?: string;
  preview?: string;
  senderDisplayName?: string;
  target?: string;
};

type PreviewEvidence = {
  effect: EffectRow;
  expected: string;
  inputScalars: number | "media";
  label: string;
  mutationSeq: number;
  stored: StoredPush;
};

const expectedTarget = "dev:bob";
const expectedChat = "conversation-1";
const expectedSender = "Alice";

function expectedGeneration(): string {
  const value = process.env.CLIQUE_EXPECTED_GENERATION;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    fail("CLIQUE_EXPECTED_GENERATION must be a 64-character lowercase hex digest", value);
  }
  return value;
}

function scalarLength(value: string): number {
  return [...value].length;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message: string, value?: unknown): never {
  throw new Error(value === undefined ? message : `${message}: ${JSON.stringify(value)}`);
}

function isolatedBuildDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

async function proofIdentity(): Promise<{
  effectSource: string;
  effectSourceSha256: string;
  externalIo: {
    basis: string;
    independentlyObservedNetworkCalls: "not-instrumented";
    providerCallCapability: "absent-from-effect-source";
    sourceUsesFetch: false;
  };
  generation: string;
  owner: OwnerIdentity;
}> {
  const build = isolatedBuildDirectory();
  const owner = JSON.parse(await readFile(resolve(build, "../owner.json"), "utf8")) as OwnerIdentity;
  const project = JSON.parse(await readFile(resolve(build, "project.json"), "utf8")) as {
    effects?: Array<{ name?: string; source?: string }>;
  };
  const declaration = project.effects?.find((item) => item.name === "delivery.notify");
  if (typeof declaration?.source !== "string") fail("compiled delivery.notify declaration was absent", project.effects);
  if (/\bfetch\s*\(/u.test(declaration.source)) fail("local proof effect unexpectedly calls fetch", declaration.source);
  if (!declaration.source.includes("providerId: meta.id")
    || !declaration.source.includes("to: payload.to")
    || !declaration.source.includes("body: payload.body")) {
    fail("local proof effect no longer returns its executed payload", declaration.source);
  }
  const expected = expectedGeneration();
  if (owner.generation !== expected) {
    fail("owner generation changed", { expected, actual: owner.generation });
  }
  return {
    effectSource: declaration.source,
    effectSourceSha256: sha256(declaration.source),
    externalIo: {
      basis: "the exact compiled effect source executed below contains no fetch call and only returns payload/meta fields; this is source-bound evidence, not a provider observation",
      independentlyObservedNetworkCalls: "not-instrumented",
      providerCallCapability: "absent-from-effect-source",
      sourceUsesFetch: false,
    },
    generation: owner.generation,
    owner,
  };
}

async function traceEffect(url: string, owner: OwnerIdentity, seq: number): Promise<EffectRow> {
  let last: unknown;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`${url}/control/trace?seq=${seq}`, {
      headers: { "x-snapback-control": owner.secret },
    });
    const trace = await response.json() as { outboxRows?: EffectRow[] };
    if (!response.ok) fail(`trace ${seq} returned HTTP ${response.status}`, trace);
    last = trace;
    const rows = trace.outboxRows ?? [];
    if (rows.length !== 1) fail(`commit ${seq} emitted ${rows.length} effect rows`, rows);
    const row = rows[0]!;
    if (row.state === "sent" && row.result !== null) return row;
    if (row.state === "failed" || row.state === "sent_unknown") {
      fail(`effect for commit ${seq} settled ${row.state}`, row);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  return fail(`effect for commit ${seq} did not settle`, last);
}

async function storedPush(
  device: JourneyDevice,
  seen: Set<string>,
  expected: string,
): Promise<StoredPush> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pushes = await device.query(api.messages.pushRecent, { c: null });
    const rows = "data" in pushes && Array.isArray(pushes.data)
      ? pushes.data as StoredPush[]
      : [];
    const row = rows.find((candidate) => typeof candidate.id === "string"
      && !seen.has(candidate.id)
      && candidate.preview === expected);
    if (row?.id) {
      seen.add(row.id);
      return row;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  return fail("stored push did not appear", { expected, seen: [...seen] });
}

async function observe(
  url: string,
  owner: OwnerIdentity,
  bob: JourneyDevice,
  seen: Set<string>,
  label: string,
  inputScalars: number | "media",
  expected: string,
  mutationSeq: number,
): Promise<PreviewEvidence> {
  const [effect, stored] = await Promise.all([
    traceEffect(url, owner, mutationSeq),
    storedPush(bob, seen, expected),
  ]);
  if (stored.kind !== "message"
    || stored.target !== expectedTarget
    || stored.chatId !== expectedChat
    || stored.senderDisplayName !== expectedSender) {
    fail(`${label} changed stored routing fields`, stored);
  }
  if (effect.effect !== "delivery.notify"
    || effect.seq !== mutationSeq
    || effect.state !== "sent"
    || effect.attempts !== 1
    || effect.lastError !== null) {
    fail(`${label} effect lifecycle differed`, effect);
  }
  if (effect.payload.to !== stored.target || effect.payload.body !== stored.preview) {
    fail(`${label} emitted arguments differ from the stored push`, { effect: effect.payload, stored });
  }
  if (effect.result?.to !== effect.payload.to
    || effect.result?.body !== effect.payload.body
    || effect.result?.providerId !== effect.id) {
    fail(`${label} executed result differs from its arguments`, { effect: effect.payload, result: effect.result });
  }
  if (stored.preview !== expected || scalarLength(stored.preview) > 80) {
    fail(`${label} stored the wrong scalar prefix`, { expected, stored: stored.preview });
  }
  return { effect, expected, inputScalars, label, mutationSeq, stored };
}

async function writeEvidence(journeyName: string, evidence: PreviewEvidence[]): Promise<void> {
  const output = process.env.CLIQUE_PREVIEW_RECEIPT;
  if (!output) return;
  const identity = await proofIdentity();
  await writeFile(output, `${JSON.stringify({
    format: "clique-owner-preview-v1",
    journey: journeyName,
    assertions: {
      argumentEquality: "pushLog.{target,preview} equals executed outbox payload.{to,body}",
      executionResult: "settled trace result echoes {to,body} and binds providerId to the outbox id",
      externalIo: identity.externalIo,
    },
    effectSource: identity.effectSource,
    effectSourceSha256: identity.effectSourceSha256,
    generation: identity.generation,
    cases: evidence,
  }, null, 2)}\n`);
}

const scalarCases = [
  { label: "scalars-0", body: "" },
  { label: "scalars-79", body: "a".repeat(79) },
  { label: "scalars-80", body: "b".repeat(80) },
  { label: "scalars-81", body: "c".repeat(81) },
  { label: "scalars-223", body: "d".repeat(223) },
  { label: "multibyte-emoji-boundary", body: `${"🙂".repeat(79)}界tail` },
];

for (const testCase of scalarCases) {
  const journeyName = `push effect executes ${testCase.label}`;
  journey(journeyName, async ({ as, url }) => {
    const identity = await proofIdentity();
    const alice = as("alice");
    const bob = as("bob");
    const seen = new Set<string>();
    try {
      const sent = await alice.mutation(api.messages.send, {
        conversationId: expectedChat,
        body: testCase.body,
        messageId: `preview-${testCase.label}`,
      });
      if (sent.state !== "committed") fail(`${testCase.label} send was ${sent.state}`, sent);
      const evidence = await observe(
        url,
        identity.owner,
        bob,
        seen,
        testCase.label,
        scalarLength(testCase.body),
        [...testCase.body].slice(0, 80).join(""),
        sent.seq,
      );
      await writeEvidence(journeyName, [evidence]);
    } finally {
      alice.close();
      bob.close();
    }
  });
}

type MediaCase = {
  expected: string;
  label: string;
  send(alice: JourneyDevice, photo: {
    uri: string;
    fileSize: number;
    mimeType: "image/jpeg";
  }): Promise<{ state: string; seq?: number }>;
};

const mediaCases: MediaCase[] = [
  {
    expected: "Photo",
    label: "photo-fallback",
    send: (alice, photo) => alice.mutation(api.messages.sendPhoto, {
      conversationId: expectedChat,
      photo,
      messageId: "preview-photo-fallback",
    }),
  },
  {
    expected: "Video",
    label: "video-fallback",
    send: async (alice) => alice.mutation(api.messages.sendClip, {
      conversationId: expectedChat,
      clip: new File([await fixture("fixtures/clip.mp4")], "preview.mp4", { type: "video/mp4" }),
      messageId: "preview-video-fallback",
    }),
  },
  {
    expected: "Photo",
    label: "view-once-hidden-body",
    send: (alice, photo) => alice.mutation(api.messages.sendOncePhoto, {
      conversationId: expectedChat,
      photo,
      body: "VIEW-ONCE-SECRET-MUST-NOT-ENTER-PUSH",
      messageId: "preview-view-once-hidden",
    }),
  },
];

for (const testCase of mediaCases) {
  const journeyName = `push effect executes ${testCase.label}`;
  journey(journeyName, async ({ as, url }) => {
    const identity = await proofIdentity();
    const alice = as("alice");
    const bob = as("bob");
    const seen = new Set<string>();
    try {
      const photoBytes = await fixture("fixtures/photo.jpg");
      const photo = {
        uri: `data:image/jpeg;base64,${btoa(String.fromCharCode(...photoBytes))}`,
        fileSize: photoBytes.byteLength,
        mimeType: "image/jpeg" as const,
      };
      const sent = await testCase.send(alice, photo);
      if (sent.state !== "committed" || typeof sent.seq !== "number") {
        fail(`${testCase.label} send was ${sent.state}`, sent);
      }
      const evidence = await observe(
        url,
        identity.owner,
        bob,
        seen,
        testCase.label,
        "media",
        testCase.expected,
        sent.seq,
      );
      if (testCase.label === "view-once-hidden-body"
        && JSON.stringify({
          stored: evidence.stored,
          payload: evidence.effect.payload,
          result: evidence.effect.result,
        }).includes("VIEW-ONCE-SECRET-MUST-NOT-ENTER-PUSH")) {
        fail("view-once hidden body entered push evidence", evidence);
      }
      await writeEvidence(journeyName, [evidence]);
    } finally {
      alice.close();
      bob.close();
    }
  });
}

journey("push response retry stays one stored row and one effect execution", async ({ as, url }) => {
  const identity = await proofIdentity();
  let alice = as("alice", { store: "file" });
  const bob = as("bob");
  const seen = new Set<string>();
  try {
    const grant = subscribe(alice, api.messages.inbox, { c: null }, () => undefined, { drain: true });
    await grant.until((value) =>
      (value.state === "complete" || value.state === "capped") && value.caughtUp === true);
    grant.close();
    await alice.offline();
    const queued = await alice.mutation(api.messages.send, {
      conversationId: expectedChat,
      body: "retry preview payload",
      messageId: "preview-response-retry",
    });
    if (queued.state !== "queued") fail(`offline preview send was ${queued.state}`, queued);
    alice = await alice.restart();
    alice.failNextResponse("/api/mutation", 503);
    await alice.online();
    await alice.settled();
    const afterFault = await alice.outbox.entries();
    if (afterFault.find((entry) => entry.intent === queued.intent)?.state !== "queued") {
      fail("injected response loss did not retain retry custody", afterFault);
    }
    await alice.outbox.drain();
    const entries = await alice.outbox.entries();
    const settled = entries.find((entry) => entry.intent === queued.intent);
    const response = settled?.response as { seq?: number; state?: string } | undefined;
    if (settled?.state !== "committed" || response?.state !== "committed" || typeof response.seq !== "number") {
      fail("retried preview did not settle committed", settled);
    }
    const observed = await observe(
      url,
      identity.owner,
      bob,
      seen,
      "response-retry-idempotency",
      scalarLength("retry preview payload"),
      "retry preview payload",
      response.seq,
    );
    const pushes = await bob.query(api.messages.pushRecent, { c: null });
    const matching = "data" in pushes && Array.isArray(pushes.data)
      ? (pushes.data as StoredPush[]).filter((row) => row.preview === "retry preview payload")
      : [];
    if (matching.length !== 1) fail("response retry created duplicate stored pushes", matching);
    await writeEvidence("push response retry stays one stored row and one effect execution", [observed]);
  } finally {
    // The journey runner owns durable clients through its mandatory
    // runOfflineDerived pass after this body returns.
    bob.close();
  }
});
