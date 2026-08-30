import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("generated Api rejects typos, extra query args, and wrong channel args", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "snapback2-client-types-"));
  try {
    const sample = join(root, "sample.ts");
    const apiDts = join(root, "api.d.ts");
    await writeFile(sample, `
      import { api, browserTokenStore, createClient, type AuthTokenStore, type QueryView } from "snapback2/client";
      const tokenStore: AuthTokenStore = { load: () => null, save: (_token) => undefined };
      const client = createClient({ url: "http://127.0.0.1:3210", tokenStore });
      const ready: Promise<void> = client.ready;
      const authGeneration: number = client.snapshot.authGeneration;
      const browserStore: AuthTokenStore = browserTokenStore(localStorage);
      void ready; void authGeneration; void browserStore;
      declare const view: QueryView<string[]>;
      const isLive: boolean = view.live;
      void isLive;
      if (view.state === "capped") {
        const take: number | undefined = view.take;
        const site: string | undefined = view.site;
        void take; void site;
      }
      if (view.state === "stale") {
        const seq: number | undefined = view.seq;
        const since: number = view.since;
        void seq; void since;
      }
      if (view.state === "live") {}
      client.query(api.mesages.typo, {});
      client.query(api.messages.thread, { conversationId: "general", extra: true });
      client.channel(api.typing, { bogus: true });
      createClient({ url: "http://127.0.0.1:3210", persist: (_token: string | null) => undefined });
    `);
    await writeFile(apiDts, `
      import type { Channel, Op } from "snapback2/client";
      declare module "snapback2/client" {
        interface Api {
          messages: { thread: Op<{ conversationId: string }, unknown> };
          channels: { typing: Channel<{ conversationId: string }, unknown> };
          typing: Channel<{ conversationId: string }, unknown>;
        }
      }
      export {};
    `);
    const program = ts.createProgram({
      rootNames: [sample, apiDts],
      options: {
        baseUrl: root,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        paths: {
          snapback2: [resolve(packageRoot, "dist/index.d.ts")],
          "snapback2/client": [resolve(packageRoot, "dist/client.d.ts")],
        },
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
      },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).filter((item) => item.file?.fileName === sample);
    const rendered = diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
    assert.equal(diagnostics.length, 5, `expected five sample diagnostics:\n${rendered.join("\n")}`);
    assert.ok(rendered.some((message) => message.includes("live") && message.includes("no overlap")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("mesages") && message.includes("does not exist")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("extra") && message.includes("known properties")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("bogus") && message.includes("known properties")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("persist") && message.includes("known properties")), rendered.join("\n"));
    context.diagnostic(diagnostics.map((item, index) => `TS${item.code}: ${rendered[index]}`).join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public refusal types require family and guide", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "snapback2-refusal-types-"));
  try {
    const sample = join(root, "sample.ts");
    await writeFile(sample, `
      import type {
        ChannelPublishResult,
        MutationRejected,
        RefusalEnvelope,
        RefusedDelivery,
      } from "snapback2/client";
      const envelopeWithoutGuide: RefusalEnvelope = { code: "E_NO", family: "op", message: "no" };
      const envelopeWithoutFamily: RefusalEnvelope = { code: "E_NO", message: "no", guide: "op/no" };
      const rejectedWithoutGuide: MutationRejected = { state: "rejected", code: "E_NO", family: "op", message: "no" };
      const rejectedWithoutFamily: MutationRejected = { state: "rejected", code: "E_NO", message: "no", guide: "op/no" };
      const deliveryWithoutGuide: RefusedDelivery = { state: "refused", code: "E_NO", family: "op", message: "no" };
      const deliveryWithoutFamily: RefusedDelivery = { state: "refused", code: "E_NO", message: "no", guide: "op/no" };
      const publishWithoutGuide: ChannelPublishResult = { state: "refused", code: "E_NO", family: "op", message: "no" };
      const publishWithoutFamily: ChannelPublishResult = { state: "refused", code: "E_NO", message: "no", guide: "op/no" };
      void envelopeWithoutGuide; void envelopeWithoutFamily;
      void rejectedWithoutGuide; void rejectedWithoutFamily;
      void deliveryWithoutGuide; void deliveryWithoutFamily;
      void publishWithoutGuide; void publishWithoutFamily;
    `);
    const program = ts.createProgram({
      rootNames: [sample],
      options: {
        baseUrl: root,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        paths: {
          snapback2: [resolve(packageRoot, "dist/index.d.ts")],
          "snapback2/client": [resolve(packageRoot, "dist/client.d.ts")],
        },
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
      },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).filter((item) => item.file?.fileName === sample);
    const rendered = diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
    assert.equal(diagnostics.length, 8, `expected family/guide diagnostics for four refusal types:\n${rendered.join("\n")}`);
    assert.ok(rendered.filter((message) => message.includes("guide")).length >= 4, rendered.join("\n"));
    assert.ok(rendered.filter((message) => message.includes("family")).length >= 4, rendered.join("\n"));
    context.diagnostic(diagnostics.map((item, index) => `TS${item.code}: ${rendered[index]}`).join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
