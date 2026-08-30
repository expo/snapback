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
      import { api, createClient, type QueryView } from "snapback2/client";
      const client = createClient({ url: "http://127.0.0.1:3210" });
      declare const view: QueryView<string[]>;
      const isLive: boolean = view.live;
      void isLive;
      if (view.state === "capped") {
        const take: number = view.take;
        const site: string = view.site;
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
    assert.equal(diagnostics.length, 4, `expected four sample diagnostics:\n${rendered.join("\n")}`);
    assert.ok(rendered.some((message) => message.includes("live") && message.includes("no overlap")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("mesages") && message.includes("does not exist")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("extra") && message.includes("known properties")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("bogus") && message.includes("known properties")), rendered.join("\n"));
    context.diagnostic(diagnostics.map((item, index) => `TS${item.code}: ${rendered[index]}`).join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
