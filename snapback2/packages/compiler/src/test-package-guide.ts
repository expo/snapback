import { mkdir, readFile, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import type { PackageBuildProof } from "./package-regression-checks";

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
  test("README mutation example typechecks with queued pending entries and an inFlight button", async () => {
    const packageRoot = resolve(crate, "packages/snapback2");
    const readme = await readFile(resolve(packageRoot, "README.md"), "utf8");
    const snippet = /```tsx\n([\s\S]*?)\n```/.exec(readme)?.[1];
    assert(snippet, "README lost its React example");
    await withProject({
      "sample.tsx": `${snippet}
        import type { OutboxEntry } from "snapback2/client";
        function MutationTypes() {
          const send = useMutation(api.messages.send);
          const pending: OutboxEntry[] = send.pending;
          const inFlight: boolean = send.inFlight;
          // @ts-expect-error Pending intents are an array, not a DOM disabled flag.
          const badButton = <button disabled={send.pending} />;
          void [pending, inFlight, badButton];
          return <button disabled={send.inFlight} />;
        }`,
      "api.d.ts": `import type { Op } from "snapback2/client";
        declare module "snapback2/client" {
          interface Api {
            messages: {
              thread: Op<{ conversationId: string; c: string | null }, unknown[]>;
              send: Op<{ conversationId: string; recipientId: string; body: string }, null>;
            };
          }
        }`,
    }, async (root) => {
      await mkdir(resolve(root, "node_modules"));
      await symlink(packageRoot, resolve(root, "node_modules/snapback2"), "dir");
      await symlink(resolve(packageRoot, "node_modules/@types"), resolve(root, "node_modules/@types"), "dir");
      const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram({
        rootNames: [resolve(root, "sample.tsx"), resolve(root, "api.d.ts")],
        options: {
          lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          jsx: ts.JsxEmit.Preserve,
          noEmit: true, skipLibCheck: true, strict: true,
          target: ts.ScriptTarget.ES2022,
          types: ["react"],
          typeRoots: [resolve(root, "node_modules/@types")],
        },
      }));
      assert(diagnostics.length === 0, diagnostics.map((item) =>
        `TS${item.code}: ${ts.flattenDiagnosticMessageText(item.messageText, "\n")}`).join("\n"));
    });
    assert(readme.includes("snapback2 guide offline"), "README recovery pointer must work in a source checkout");
  });

  test("the built keyword guide resolves grammar constructs and the README Assets and Channels topics", async () => {
    const guide = `${crate}packages/snapback2/dist/guide`;
    const grammar = await readFile(`${guide}/grammar.md`, "utf8");
    const keywords = JSON.parse(await readFile(`${guide}/keywords.json`, "utf8"));
    const entries = [...grammar.matchAll(/^- `([a-z][a-z0-9-]*)`: .+$/gm)];
    assert(entries.length === 23, "grammar must keep its 23 constructs");
    assert(Object.keys(keywords).length === entries.length + 2, "keyword index differs from grammar plus Assets and Channels");
    for (const [line, keyword] of entries) {
      const content = keywords[keyword!];
      assert(typeof content === "string" && content.includes(line.slice(2)), `${keyword}: missing grammar line`);
      assert(/\n\n## [\w-]+: [^\n]+\n\n\S/.test(content), `${keyword}: missing defining paragraph`);
    }
    const readme = await readFile(`${crate}packages/snapback2/README.md`, "utf8");
    for (const topic of ["Assets", "Channels"]) {
      const paragraph = new RegExp(`^## ${topic}\\n\\n([\\s\\S]*?)\\n\\n`, "m").exec(readme)?.[1];
      assert(paragraph, `README lost its ${topic} defining paragraph`);
      const keyword = topic.toLowerCase();
      assert(keywords[keyword] === `# \`${keyword}\`\n\n${paragraph}\n\nSee the packaged [README.md](../../README.md), section "${topic}", for the full documentation.\n`,
        `${topic} help must contain the exact README paragraph and packaged source pointer`);
    }
  });

  test("the guide spec lists the CLI's current recipes", async () => {
    const source = await readFile(resolve(crate, "crates/snapback2/src/guide.rs"), "utf8");
    const recipes = /const RECIPES:[\s\S]*?= &\[([\s\S]*?)\];/.exec(source)?.[1];
    assert(recipes, "missing recipe declaration");
    const spec = await readFile(resolve(crate, "../llp/1002-dev-loop.spec.md"), "utf8");
    const list = /<recipe>` \(([\s\S]*?) — budgeted Markdown/.exec(spec)?.[1];
    assert(list, "missing guide recipe list");
    const names = [...recipes.matchAll(/"([\w-]+)"/g)].map((match) => match[1]).sort();
    const documented = [...list.matchAll(/`([\w-]+)`/g)].map((match) => match[1]).sort();
    assert(JSON.stringify(names) === JSON.stringify(documented), `guide recipes differ: ${names} vs ${documented}`);
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
