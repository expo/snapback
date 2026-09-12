import { mkdir, readFile, readdir, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import type { PackageBuildProof } from "./package-regression-checks";
import { lowerProject } from "./project";

type Test = (name: string, run: () => void | Promise<void>) => void;
type Assert = (condition: unknown, message: string) => asserts condition;
type WithProject = (files: Record<string, string>, run: (root: string) => Promise<void>) => Promise<void>;

export function registerPackageGuideChecks(
  test: Test,
  assert: Assert,
  withProject: WithProject,
  crate: string,
  packageBuildProof: PackageBuildProof,
): void {
  test("README client examples typecheck against the shipped chat's generated contract", async () => {
    const packageRoot = resolve(crate, "packages/snapback2");
    const readme = await readFile(resolve(packageRoot, "README.md"), "utf8");
    const snippet = /```tsx\n([\s\S]*?)\n```/.exec(readme)?.[1];
    assert(snippet, "README lost its React example");
    const headless = /```ts\n([\s\S]*?)\n```/.exec(readme)?.[1];
    assert(headless, "README lost its headless example");
    const lowered = await lowerProject(resolve(packageRoot, "templates/chat"));
    assert(lowered.ok, `shipped chat refused: ${JSON.stringify(lowered)}`);
    await withProject({
      "headless.ts": headless,
      "sample.tsx": `${snippet}
        import type { ArgsOf, MutationResult, ResultOf } from "snapback2/client";
        function MutationTypes() {
          const send = useMutation(api.messages.send);
          const last: MutationResult<{ id: string }> | undefined = send.last;
          const args: ArgsOf<typeof api.messages.send> = { conversationId: "conversation-1", body: "Hi", expiresAt: 1 };
          const result: ResultOf<typeof api.messages.send> = { id: "message-1" };
          // @ts-expect-error Text send fans out to members; it has no recipient argument.
          const stale: ArgsOf<typeof api.messages.send> = { ...args, recipientId: "profile-bob" };
          const inFlight: boolean = send.inFlight;
          // @ts-expect-error A mutation result is not a DOM disabled flag.
          const badButton = <button disabled={send.last} />;
          void [last, args, result, stale, inFlight, badButton];
          return <button disabled={send.inFlight} />;
        }`,
      "api.d.ts": lowered.apiDts,
    }, async (root) => {
      await mkdir(resolve(root, "node_modules"));
      await symlink(packageRoot, resolve(root, "node_modules/snapback2"), "dir");
      await symlink(resolve(packageRoot, "node_modules/@types"), resolve(root, "node_modules/@types"), "dir");
      const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram({
        rootNames: [resolve(root, "sample.tsx"), resolve(root, "headless.ts"), resolve(root, "api.d.ts")],
        options: {
          lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          jsx: ts.JsxEmit.Preserve,
          noEmit: true, skipLibCheck: true, strict: true,
          target: ts.ScriptTarget.ES2022,
          types: ["react", "node"],
          typeRoots: [resolve(root, "node_modules/@types")],
        },
      }));
      assert(diagnostics.length === 0, diagnostics.map((item) =>
        `TS${item.code}: ${ts.flattenDiagnosticMessageText(item.messageText, "\n")}`).join("\n"));
    });
    assert(!`${headless}\n${snippet}`.includes("c: null"), "README queries should omit the initial cursor");
    for (const route of ["live-query", "offline"]) {
      assert(readme.includes(`snapback2 guide ${route}`), `README ${route} pointer must work in a source checkout`);
    }
    assert(readme.includes("A transport failure without durable admission resolves a `rejected` refusal"),
      "README must qualify plain-mutation rejection as a transport failure");
    assert(readme.includes("FIFO replay after `online()`"), "README must name the public recovery method");
  });

  test("guide cards and aliases are discoverable without a fixed page list", async () => {
    const guide = `${crate}packages/snapback2/dist/guide`;
    const quarry = await readFile(`${guide}/quarry.md`, "utf8");
    const pagination = await readFile(`${guide}/pagination.md`, "utf8");
    assert(pagination.includes("One cursor-bearing page nested in a record supplies root `next`"),
      "pagination card lost the certified composite-page continuation used by chat conversationView");
    assert(!pagination.includes("without root continuation"), "pagination card still denies composite-page continuation");
    assert(pagination.includes("Objects/nested pages cannot drain"), "root next does not make a composite resumable");
    const liveQuery = (await readFile(`${guide}/live-query.md`, "utf8")).replace(/\s+/g, " ");
    assert(liveQuery.includes("Mutation calls without durable admission never resubmit automatically"),
      "the no-resubmission guarantee applies to mutations");
    assert(liveQuery.includes("`client.query()` retries retryable transport failures with backoff, up to three attempts."),
      "the three-attempt retry limit applies to imperative client.query(), not observe/useQuery");
    assert(liveQuery.includes("One-shot `observe`/`useQuery` can keep retrying retryable refusals; live observes reconnect through SSE with fresh snapshots, never Last-Event-ID replay."),
      "the guide must distinguish observed retry lifecycles from imperative query attempts");
    assert(quarry.replace(/\s+/g, " ").includes("TypeScript is only seeds, tests, and effect I/O; otherwise use Quarry."),
      "the guide must direct backend authors to Quarry outside TypeScript's harness role");
    assert(liveQuery.includes("Queued writes replay after `online()`"), "live query must name the public recovery method");
    const keywords = JSON.parse(await readFile(`${guide}/keywords.json`, "utf8"));
    const pages = (await readdir(guide)).filter(name => name.endsWith(".md") && name !== "grammar.md");
    for (const filename of pages) {
      assert(keywords[filename.slice(0, -3)] === await readFile(`${guide}/${filename}`, "utf8"),
        `${filename}: full card missing from keyword lookup`);
    }
    for (const [alias, page] of [["assets/client", "assets"], ["successor", "migrations"], ["migration", "migrations"], ["test", "testing"], ["schema", "quarry"]])
      assert(keywords[alias!] === keywords[page!], `${alias}: topic alias lost`);
    const grammar = await readFile(`${guide}/grammar.md`, "utf8");
    for (const [, keyword] of grammar.matchAll(/^- `([a-z][a-z0-9-]*)`: .+$/gm))
      assert(typeof keywords[keyword!] === "string" && keywords[keyword!].length > 80, `${keyword}: missing useful help`);
    for (const name of ["assets/client", "successor", "money", "maintain", "expiry", "bounds"]) {
      const result = Bun.spawnSync({ cmd: [`${crate}target/debug/snapback2`, "guide", name, "--json"],
        env: { ...process.env, SNAPBACK2_GUIDE: guide }, stdout: "pipe", stderr: "pipe" });
      assert(result.exitCode === 0, `${name}: CLI lookup failed: ${new TextDecoder().decode(result.stderr)}`);
      assert(JSON.parse(new TextDecoder().decode(result.stdout)).content === keywords[name], `${name}: CLI card diverged`);
    }
  });

  test("the installed global message search recipe typechecks against its generated API", async () => {
    const packageRoot = resolve(crate, "packages/snapback2");
    const recipePath = resolve(packageRoot, "dist/guide/recipes/global-message-search.ts");
    const files = packageBuildProof();
    assert(files.has("dist/guide/recipes/global-message-search.ts"),
      "npm pack omitted the global message search recipe");
    const recipe = await readFile(recipePath, "utf8");
    const fanout = await readFile(resolve(packageRoot, "dist/guide/fanout.md"), "utf8");
    assert(fanout.includes("guide/recipes/global-message-search.ts"),
      "the installed fanout card does not point to its runnable recipe");
    const lowered = await lowerProject(resolve(crate, "packages/compiler/fixtures/quarry-fanout-guide"));
    assert(lowered.ok, `fanout recipe fixture refused: ${JSON.stringify(lowered)}`);
    await withProject({ "recipe.ts": recipe, "api.d.ts": lowered.apiDts }, async (root) => {
      await mkdir(resolve(root, "node_modules"));
      await symlink(packageRoot, resolve(root, "node_modules/snapback2"), "dir");
      const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram({
        rootNames: [resolve(root, "recipe.ts"), resolve(root, "api.d.ts")],
        options: {
          lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          noEmit: true, skipLibCheck: true, strict: true,
          target: ts.ScriptTarget.ES2022,
        },
      }));
      assert(diagnostics.length === 0, diagnostics.map((item) =>
        `TS${item.code}: ${ts.flattenDiagnosticMessageText(item.messageText, "\n")}`).join("\n"));
    });
  });

  test("the installed global search recipe matches scalar ID order across chats", async () => {
    const recipePath = resolve(crate, "packages/snapback2/dist/guide/recipes/global-message-search.ts");
    const recipe = await import(`${pathToFileURL(recipePath).href}?ordering=${Date.now()}`) as {
      createGlobalMessageSearch(client: object, term: string): object;
      nextGlobalMessagePage(search: object): Promise<{
        messages: readonly { id: string }[];
        state: string;
        issues: readonly unknown[];
      }>;
    };
    const ids = {
      astral: "message-prefix-\u{10000}",
      bmp: "message-prefix-\u{e000}",
      prefix: "message-prefix-",
    };
    const rows: Record<string, { id: string; at: number }> = {
      astral: { id: ids.astral, at: 7 },
      bmp: { id: ids.bmp, at: 7 },
      prefix: { id: ids.prefix, at: 7 },
    };
    const terms: string[] = [];
    const client = { query: async (ref: { op: string }, args: { conversation?: string; term?: string }) => {
      if (ref.op === "feeds.searchScopes") return {
        state: "complete", data: Object.keys(rows).map(conversation => ({ conversation })), seq: 1, next: null,
      };
      assert(ref.op === "feeds.conversationMessageSearch" && args.conversation !== undefined,
        `recipe called an unexpected operation: ${ref.op}`);
      terms.push(args.term ?? "");
      return { state: "complete", data: [rows[args.conversation]!], seq: 1, next: null };
    } };
    const search = recipe.createGlobalMessageSearch(client, "needle");
    const page = await recipe.nextGlobalMessagePage(search);
    assert(page.state === "complete" && page.issues.length === 0,
      `recipe did not complete: ${JSON.stringify(page)}`);
    assert(JSON.stringify(page.messages.map(row => row.id)) === JSON.stringify([ids.astral, ids.bmp, ids.prefix]),
      `recipe diverged from engine/twin Unicode scalar order: ${JSON.stringify(page.messages)}`);
    assert(terms.length === 3 && terms.every(term => term === "needle"), "recipe did not capture its search term");
  });

  test("npm pack from a clean dist builds every exported module and declaration", () => {
    const files = packageBuildProof();
    for (const path of [
      "dist/compiler.mjs", "dist/compiler-core.mjs", "dist/index.mjs", "dist/client.mjs", "dist/react.mjs", "dist/test.mjs",
      "dist/test-runner.mjs", "dist/index.d.ts", "dist/authoring-lib.d.ts", "dist/client.d.ts", "dist/react.d.ts", "dist/test.d.ts",
      "dist/compiler-lib.d.ts", "expo-module.config.json", "ios/MemoryVideoSource.swift",
      "ios/SnapbackMemoryVideoModule.swift", "ios/SnapbackMemoryVideo.podspec",
      "android/build.gradle", "android/src/main/java/expo/modules/snapback2/SnapbackMemoryVideoModule.kt",
    ]) assert(files.has(path), `npm pack omitted ${path}`);
    assert(!files.has("dist/placeholder.d.ts"), "npm pack still contains the obsolete placeholder declarations");
  });

  test("client, React, and test imports typecheck against distinct real declarations", async () => {
    const packageRoot = resolve(crate, "packages/snapback2");
    await withProject({
      "surfaces.ts": `import { api, createClient } from "snapback2/client";
        import { DevOverlay, SnapbackProvider, useAuth, useChannel, useMutation, useQuery } from "snapback2/react";
        import { journey } from "snapback2/test";
        const client = createClient({ url: "http://127.0.0.1:3210" });
        journey("real declarations", ({ as }) => { const same: typeof client = as("alice"); void same; });
        void [api, DevOverlay, SnapbackProvider, useAuth, useChannel, useMutation, useQuery];`,
      "wrong-surface.ts": `import { createClient } from "snapback2/react"; void createClient;`,
    }, async (root) => {
      await mkdir(resolve(root, "node_modules"));
      await symlink(packageRoot, resolve(root, "node_modules/snapback2"), "dir");
      const options: ts.CompilerOptions = {
        baseUrl: root,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: ["react"],
      };
      const sample = resolve(root, "surfaces.ts");
      const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram({ rootNames: [sample], options }))
        .filter((item) => item.file?.fileName === sample);
      assert(diagnostics.length === 0,
        `real package declarations did not typecheck:\n${diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n")}`);

      const wrong = resolve(root, "wrong-surface.ts");
      const wrongDiagnostics = ts.getPreEmitDiagnostics(ts.createProgram({ rootNames: [wrong], options }))
        .filter((item) => item.file?.fileName === wrong);
      assert(wrongDiagnostics.some((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n").includes("no exported member 'createClient'")),
        "snapback2/react still aliases the client declaration surface");
    });
  });

}
