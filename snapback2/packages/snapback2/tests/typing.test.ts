import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// @ref LLP 1018.001#4-reconciliation-and-acceptance-evidence — a generated result must retain its types through the real package boundary, including Expo's skipped declaration checking.
test("built Quarry API preserves row and channel types in a packaged Expo consumer", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "snapback2-generated-consumer-"));
  try {
    const installed = join(root, "node_modules/snapback2");
    await mkdir(installed, { recursive: true });
    // Copy the shipped graph, so source files and workspace paths cannot satisfy
    // missing package declarations. Only ordinary installed dependencies link out.
    await cp(join(packageRoot, "package.json"), join(installed, "package.json"));
    await cp(join(packageRoot, "dist"), join(installed, "dist"), { recursive: true });
    for (const dependency of ["typescript", "expo", "react", "@types"]) {
      await symlink(join(packageRoot, "node_modules", dependency), join(root, "node_modules", dependency), "dir");
    }
    await writeFile(join(root, "package.json"), JSON.stringify({ private: true, type: "module" }));
    await cp(join(packageRoot, "templates/chat/expo/tsconfig.json"), join(root, "tsconfig.json"));
    await mkdir(join(root, "snapback"));
    await mkdir(join(root, ".snapback/build"), { recursive: true });
    await writeFile(join(root, "snapback/schema.q"), `table todos:
  title: text <=80
  done: bool
  ownerId: principal
  public

channel typing(todoId: todos):
  value: { typing: bool }
  publish <- allow
  subscribe <- allow
  ttl 4s
`);
    await writeFile(join(root, "snapback/todos.q"), `mutation add(done: bool ?):
  row = insert todos { title: 'typed row', done: done ?? false, ownerId: viewer }
  return { row, next: 'saved' }

query page(c: cursor ?):
  return todos[] after c first 20 by byId

query customPage(after: cursor ?):
  return todos[] after after first 20 by byId
`);
    const compiled = spawnSync(process.execPath, [join(installed, "dist/compiler.mjs"), "--project", root], {
      cwd: root, encoding: "utf8", timeout: 15_000,
    });
    assert.equal(compiled.status, 0, `${compiled.error ?? ""}\n${compiled.stderr}\n${compiled.stdout}`);
    const output = JSON.parse(compiled.stdout);
    assert.equal(output.ok, true, compiled.stdout);
    assert.equal(typeof output.apiDts, "string", "built worker did not return the generated API");
    await writeFile(join(root, ".snapback/build/api.d.ts"), output.apiDts);
    await writeFile(join(root, "App.tsx"), `import { api, createClient, type ResultOf, type ArgsOf } from "snapback2/client";
import { usePage, useQuery } from "snapback2/react-core";
const page = usePage(api.todos.page, {});
const custom = usePage(api.todos.customPage, {}, { cursor: "after" });
const title: string | undefined = page.items[0]?.title;
const customTitle: string | undefined = custom.items[0]?.title;
useQuery(api.todos.page, {});
useQuery(api.todos.page, { c: null });
// @ts-expect-error pagination requires an array result
usePage(api.todos.add, {});
// @ts-expect-error page items preserve the generated row's field types
const wrongTitle: number = page.items[0]!.title;
void [title, customTitle, wrongTitle];
type Result = ResultOf<typeof api.todos.add>;
const args: ArgsOf<typeof api.todos.add> = { done: true };
void args;
declare const result: Result;
const done: boolean = result.row.done;
// @ts-expect-error a boolean field is not a number, even with skipLibCheck
const wrong: number = result.row.done;
const client = createClient({ url: "http://typed.test" });
const typing = client.channel(api.typing, { todoId: "todo-1" });
typing.set({ typing: true });
const active: boolean | undefined = typing.getSnapshot().entries[0]?.value.typing;
// @ts-expect-error the generated value stays typed through the package boundary
typing.set({ typing: "yes" });
// @ts-expect-error the generated record is closed
client.channel(api.channels.typing, { todoId: "todo-1" }).set({ typing: true, extra: 1 });
void active;
void [done, wrong];
`);
    const config = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), {}, {
      ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => {
        assert.fail(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    });
    assert.ok(config, "Expo config did not load");
    assert.deepEqual(config.errors, []);
    assert.equal(config.options.skipLibCheck, true, "witness must retain Expo's declaration-checking setting");
    assert.equal(config.options.paths, undefined, "package exports must resolve without path substitution");
    for (const skipLibCheck of [true, false]) {
      await context.test(`skipLibCheck=${skipLibCheck}`, () => {
        const program = ts.createProgram({ rootNames: config.fileNames, options: { ...config.options, skipLibCheck } });
        const diagnostics = ts.getPreEmitDiagnostics(program);
        const rendered = ts.formatDiagnostics(diagnostics, {
          getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => "\n",
        });
        // Report the complete graph: TS2578 detects the lost negative assignment;
        // TS1038 identifies the separate ambient declaration packaging defect.
        context.diagnostic(`skipLibCheck=${skipLibCheck}: ${rendered || "no diagnostics"}`);
        assert.equal(diagnostics.length, 0, rendered);
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated Api rejects typos, extra query args, and wrong channel args", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "snapback2-client-types-"));
  try {
    const sample = join(root, "sample.ts");
    const apiDts = join(root, "api.d.ts");
    await writeFile(sample, `
      import { api, browserTokenStore, createClient, defineItems, withHistory, type AuthTokenStore, type HistorySnapshot, type ItemSnapshot, type QueryView, type Snapshot, type SnapbackClient } from "snapback2/client";
      // @ts-expect-error carrier internals are absent from the client entry
      import type { Coverage } from "snapback2/client";
      // @ts-expect-error carrier internals are absent from the client entry
      import type { HeldAnswer } from "snapback2/client";
      // @ts-expect-error carrier internals are absent from the client entry
      import type { HeldProgram } from "snapback2/client";
      // @ts-expect-error carrier internals are absent from the client entry
      import type { OverlayRow } from "snapback2/client";
      // @ts-expect-error carrier internals are absent from the client entry
      import type { StoreSwap } from "snapback2/client";
      // @ts-expect-error twin internals are absent from the client entry
      import type { LocalAnswer } from "snapback2/client";
      // @ts-expect-error twin internals are absent from the client entry
      import type { Prediction } from "snapback2/client";
      // @ts-expect-error twin internals are absent from the client entry
      import type { PartialSite } from "snapback2/client";
      const tokenStore: AuthTokenStore = { load: () => null, save: (_token) => undefined };
      const client = createClient({ url: "http://127.0.0.1:3210", tokenStore });
      // @ts-expect-error observe is the application read subscription
      client.subscribe(api.messages.thread, { conversationId: "general" }, () => {});
      // @ts-expect-error shared reader counts belong to the internal entry
      client.sharedConsumers(api.messages.thread, { conversationId: "general" });
      const ready: Promise<void> = client.ready;
      const authGeneration: number = client.snapshot.authGeneration;
      const browserStore: AuthTokenStore = browserTokenStore(localStorage, "snapback2:http://127.0.0.1:3210:auth");
      const observed = client.observe(api.messages.thread, { conversationId: "general" });
      const observedView: Snapshot<unknown> = observed.getSnapshot();
      const stopObserved: () => void = observed.subscribe(() => undefined);
      client.observe(api.messages.thread, { conversationId: "general" }, { live: false });
      void ready; void authGeneration; void browserStore; void observedView; void stopObserved;
      const threadItems = defineItems(api.messages.thread, { table: "messages", select: (delivery) => delivery.message });
      const viewItems = defineItems(api.messages.view, { table: "messages", rows: (view) => view.messages, select: (delivery) => delivery.message });
      const declared = withHistory(viewItems, { items: threadItems, args: ({ conversationId }) => ({ conversationId }) });
      const custody: HistorySnapshot<{ messages: { message: { id: string; body: string } | null }[]; count: number }, { id: string; body: string }, never, { message: { id: string; body: string } | null }[]>
        = client.observe(api.messages.view, { conversationId: "general" }, { items: declared }).getSnapshot();
      const from: "query" | "history" | "drafts" = custody.itemsFrom;
      const historyRows: { message: { id: string; body: string } | null }[] | undefined = custody.history?.data;
      if (custody.itemsFrom === "query") {
        const count: number = custody.data.count;
        const verdict: "complete" | "capped" = custody.receipt.state;
        const noHistory: undefined = custody.history;
        void [count, verdict, noHistory];
      } else {
        // @ts-expect-error history and drafts cannot assert the composite's data is present
        const count: number = custody.data.count;
        void count;
      }
      if (custody.itemsFrom === "history") {
        const rows = custody.history.data;
        void rows;
      }
      const plain: ItemSnapshot<unknown, { id: string; body: string }, never> = client.observe(api.messages.view, { conversationId: "general" }, { items: viewItems }).getSnapshot();
      // @ts-expect-error plain items publish no itemsFrom
      const missing: string = plain.itemsFrom;
      const otherItems = defineItems(api.messages.others, { table: "messages", select: (delivery) => delivery.other });
      // @ts-expect-error a history whose rows lack the declaring items' fields is not assignable
      withHistory(viewItems, { items: otherItems, args: ({ conversationId }) => ({ conversationId }) });
      // @ts-expect-error mapped arguments must be the history query's arguments
      withHistory(viewItems, { items: threadItems, args: ({ conversationId }) => ({ conversation: conversationId }) });
      const options = { items: declared, drain: false };
      const viaVariable: "query" | "history" | "drafts" = client.observe(api.messages.view, { conversationId: "general" }, options).getSnapshot().itemsFrom;
      const iface: SnapbackClient = client;
      const viaInterface: "query" | "history" | "drafts" = iface.observe(api.messages.view, { conversationId: "general" }, options).getSnapshot().itemsFrom;
      const plainOptions = { items: viewItems, drain: false };
      const plainViaVariable: ItemSnapshot<unknown, { id: string; body: string }, never> = client.observe(api.messages.view, { conversationId: "general" }, plainOptions).getSnapshot();
      void from; void historyRows; void missing; void viaVariable; void viaInterface; void plainViaVariable;
      declare const view: QueryView<string[]>;
      const isLive: boolean = view.live;
      void isLive;
      if (view.state === "capped") {
        const next: import("snapback2/client").Cursor | null = view.next;
        // @ts-expect-error capped carries no take echo
        const take: number = view.take;
        // @ts-expect-error capped carries no site
        const site: string = view.site;
        void next; void take; void site;
      }
      if (view.state === "stale") {
        const seq: number | undefined = view.seq;
        const since: number = view.since;
        void seq; void since;
      }
      if (view.state === "live") {}
      client.mutation(api.assets.send, {
        photo: { uri: "asset-library://photo", size: 10 },
        optional: null,
        gallery: [{ uri: "asset-library://gallery" }],
        clip: { uri: "asset-library://clip", type: "video/mp4" },
      });
      const room = client.channel(api.channels.typing, { conversationId: "general" });
      const state: import("snapback2/client").ChannelSnapshot<{ typing: boolean }> = room.getSnapshot();
      const writing: Promise<import("snapback2/client").ChannelWriteResult> = room.set({ typing: true });
      const clearing: Promise<import("snapback2/client").ChannelWriteResult> = room.clear();
      const watching = room.subscribe(snapshot => {
        const typing: boolean | undefined = snapshot.entries[0]?.value.typing;
        void typing;
      });
      // @ts-expect-error the value field must be a boolean
      room.set({ typing: "yes" });
      // @ts-expect-error snapshots expose no lease
      const lease = state.lease;
      // @ts-expect-error channel entries are immutable
      state.entries.push({});
      // @ts-expect-error the event-pipe method was removed
      room.publish({ typing: true });
      watching.close(); room.close();
      void writing; void clearing; void lease;
      client.query(api.mesages.typo, {});
      client.query(api.messages.thread, { conversationId: "general", extra: true });
      client.channel(api.typing, { bogus: true });
      createClient({ url: "http://127.0.0.1:3210", persist: (_token: string | null) => undefined });
      createClient({ url: "http://127.0.0.1:3210", persona: "alice", token: "bearer" });
    `);
    await writeFile(apiDts, `
      import type { ImageAsset, VideoAsset } from "snapback2";
      import type { Channel, Op } from "snapback2/client";
      declare module "snapback2/client" {
        interface Api {
          messages: {
            thread: Op<{ conversationId: string }, { message: { id: string; body: string } | null }[]>;
            view: Op<{ conversationId: string }, { messages: { message: { id: string; body: string } | null }[]; count: number }>;
            others: Op<{ conversationId: string }, { other: { id: string } | null }[]>;
          };
          assets: { send: Op<{
            photo: File | ImageAsset;
            optional: File | ImageAsset | null;
            gallery: (File | ImageAsset)[];
            clip: File | VideoAsset;
          }, unknown> };
          channels: { typing: Channel<{ conversationId: string }, { typing: boolean }> };
          typing: Channel<{ conversationId: string }, { typing: boolean }>;
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
    assert.equal(diagnostics.length, 6, `expected six sample diagnostics:\n${rendered.join("\n")}`);
    assert.ok(rendered.some((message) => message.includes("live") && message.includes("no overlap")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("mesages") && message.includes("does not exist")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("extra") && message.includes("known properties")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("bogus") && message.includes("known properties")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("persist") && message.includes("known properties")), rendered.join("\n"));
    assert.ok(rendered.some((message) => message.includes("token") && message.includes("assignable")), rendered.join("\n"));
    context.diagnostic(diagnostics.map((item, index) => `TS${item.code}: ${rendered[index]}`).join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public refusals require family and accept an optional guide", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "snapback2-refusal-types-"));
  try {
    const sample = join(root, "sample.ts");
    await writeFile(sample, `
      import type {
        ChannelWriteResult,
        MutationRejected,
        Refusal,
        RefusedDelivery,
      } from "snapback2/client";
      const envelopeWithoutGuide: Refusal = { code: "E_NO", family: "op", message: "no" };
      const envelopeWithoutFamily: Refusal = { code: "E_NO", message: "no", guide: "op/no" };
      const rejectedWithoutGuide: MutationRejected = { state: "rejected", code: "E_NO", family: "op", message: "no" };
      const rejectedWithoutFamily: MutationRejected = { state: "rejected", code: "E_NO", message: "no", guide: "op/no" };
      const deliveryWithoutGuide: RefusedDelivery = { state: "refused", code: "E_NO", family: "op", message: "no" };
      const deliveryWithoutFamily: RefusedDelivery = { state: "refused", code: "E_NO", message: "no", guide: "op/no" };
      const writeWithoutGuide: ChannelWriteResult = { state: "refused", code: "E_NO", family: "op", message: "no" };
      const writeWithoutFamily: ChannelWriteResult = { state: "refused", code: "E_NO", message: "no", guide: "op/no" };
      void envelopeWithoutGuide; void envelopeWithoutFamily;
      void rejectedWithoutGuide; void rejectedWithoutFamily;
      void deliveryWithoutGuide; void deliveryWithoutFamily;
      void writeWithoutGuide; void writeWithoutFamily;
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
    assert.equal(diagnostics.length, 4, `expected family diagnostics for four refusal types:\n${rendered.join("\n")}`);
    
    assert.ok(rendered.filter((message) => message.includes("family")).length >= 4, rendered.join("\n"));
    context.diagnostic(diagnostics.map((item, index) => `TS${item.code}: ${rendered[index]}`).join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
