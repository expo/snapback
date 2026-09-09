import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { compileJourneys, lowerProject } from "./project";

type Test = (name: string, run: () => void | Promise<void>) => void;

export function registerApiShapeChecks(
  test: Test,
  frontend: string,
  consumer: { packageRoot?: string; inspect?: (program: ts.Program) => void } = {},
): void {
  const fixtures = resolve(frontend, "fixtures");
  const snapbackTypes = resolve(frontend, "../snapback2/dist/index.d.ts");

  // @ref LLP 1002#3-the-compiler-worker-and-the-project-json — inferred result
  // names must bind in the real client augmentation, even with skipLibCheck.
  for (const [name, source, rowExpression] of [
    ["insert", `mutation probe(done: bool ?):
  row = insert todos { title: "hi", done: done! else MISSING_DONE, ownerId: viewer }
  return { row, next: new }
`, "result.row"],
    ["merge", `query probe():
  page = merge todos first 3 by byOwner:
    [viewer]
  return page
`, "result[0]!"],
  ] as const) {
    test(`generated ${name} API preserves consumer row types with the complete SDK`, async () => {
      await withProjectFiles(`snapback2-api-consumer-${name}-`, {
        "snapback/schema.q": `use identity

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by byOwner: ownerId, id
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
`,
        "snapback/todos.q": source,
        "tsconfig.json": await readFile(resolve(frontend, "../snapback2/templates/chat/expo/tsconfig.json"), "utf8"),
        "src/consumer.ts": `import { api } from "snapback2/client";
type Result = NonNullable<(typeof api.todos.probe)["__result"]>;
declare const result: Result;
const row = ${rowExpression};
const done: boolean = row.done;
// @ts-expect-error a boolean result field must not be assignable to number
const wrong: number = row.done;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const rowIsNotAny: IsAny<typeof row> = false;
void [done, wrong, rowIsNotAny];
`,
      }, undefined, async (root) => {
        const lowered = await lowerProject(root);
        assert(lowered.ok, `${name} consumer backend refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
        const apiPath = join(root, ".snapback/build/api.d.ts");
        await mkdir(dirname(apiPath), { recursive: true });
        await writeFile(apiPath, lowered.apiDts);
        await mkdir(join(root, "node_modules"));
        await symlink(consumer.packageRoot ?? resolve(frontend, "../snapback2"), join(root, "node_modules/snapback2"), "junction");
        await symlink(resolve(frontend, "../snapback2/node_modules/expo"), join(root, "node_modules/expo"), "junction");
        const configPath = join(root, "tsconfig.json");
        const config = ts.readConfigFile(configPath, ts.sys.readFile);
        assert(!config.error, ts.flattenDiagnosticMessageText(config.error?.messageText ?? "", "\n"));
        const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
        const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, configFileParsingDiagnostics: parsed.errors });
        const diagnostics = ts.getPreEmitDiagnostics(program);
        const failures = diagnostics.map((item) => ts.formatDiagnostic(item, {
          getCanonicalFileName: (file) => file, getCurrentDirectory: () => root, getNewLine: () => "\n",
        }));
        const checker = program.getTypeChecker();
        const client = program.getSourceFile(join(root, "src/consumer.ts"))!;
        const declarations = client.statements.filter(ts.isVariableStatement).flatMap((statement) => statement.declarationList.declarations);
        const row = declarations.find((item) => item.name.getText() === "row")!;
        const done = declarations.find((item) => item.name.getText() === "done")!;
        const isAny = declarations.find((item) => item.name.getText() === "rowIsNotAny")!;
        if (checker.getTypeAtLocation(row.name).flags & ts.TypeFlags.Any) failures.push("consumer row is any (including error-any)");
        if (checker.typeToString(checker.getTypeAtLocation(done.initializer!)) !== "boolean") failures.push("consumer row.done is not exactly boolean");
        // An unresolved row can make IsAny itself error-any, accepting false.
        if (checker.typeToString(checker.getTypeAtLocation(isAny.name)) !== "false") failures.push("consumer IsAny did not resolve to false");
        consumer.inspect?.(program);
        assert(failures.length === 0, `${name} generated consumer failed:\n${failures.join("\n")}\n${lowered.apiDts}`);
      });
    });
  }

  test("generated API types every Clique shaped result without any-typed fields", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-clique"));
    assert(lowered.ok, `Clique fixture refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const expected: Record<string, string> = {
      "pay.myLedger": `(LedgerRow & { counterpartyProfile: { displayName: string; handle: string } | null })[]`,
      "pay.expenseShares": `(SharesRow & { debtorProfile: { displayName: string; handle: string } | null })[]`,
      "pay.myOpenShares": `(SharesRow & { expenseRow: { description: string; payer: Principal; grand: Money<"USD", 2>; at: number } })[]`,
      "pay.convExpenses": `{ total: Money<"USD", 2>; expenses: (ExpensesRow & { payerProfile: { displayName: string; handle: string } | null })[] }`,
      "social.thread": `PostsRow & { authorProfile: { displayName: string; handle: string } | null; replies: (PostsRow & { authorProfile: { displayName: string; handle: string } | null })[] }`,
      "social.globalFeed": `{ id: string; kind: "post" | "repost"; at: number; ord: number; actor: Principal; post: string; reposter: { displayName: string; handle: string } | null; item: Omit<PostsRow, "id" | "author" | "body" | "parent" | "at" | "likeCount" | "replyCount" | "repostCount"> & { id: string; author: Principal; body: string; parent: string | null; at: number; likeCount: number; replyCount: number; repostCount: number; authorProfile: { displayName: string; handle: string } | null } | null }[]`,
      "chat.myConversations": `{ conv: string; joinedAt: number; conversation: ConversationsRow & { creatorProfile: { displayName: string; handle: string } | null } | null; peers: { user: Principal; profile: { displayName: string; handle: string } | null }[] }[]`,
      "pay.myBalance": `Money<"USD", 2>`,
      "social.profile": `UsersRow | null`,
      "social.listUsers": `Page<UsersRow>`,
    };
    const failures: string[] = [];
    if (lowered.apiDts.includes("any[]")) failures.push("Clique API retains an any[] result");
    if (lowered.apiDts.includes(": any;")) failures.push("Clique API retains an any field");
    if (lowered.apiDts.includes(", any>;")) failures.push("Clique API retains a bare any result");
    for (const [operation, result] of Object.entries(expected)) {
      const received = operationResult(lowered.apiDts, operation);
      if (received !== result) failures.push(`${operation} result differs:\nexpected ${result}\nreceived ${received}`);
    }
    const insertResult = operationResult(lowered.apiDts, "social.createProfile");
    if (!insertResult) failures.push("social.createProfile result is missing");
    else if (insertResult.includes('import("snapback2").')) failures.push(`social.createProfile retains a raw import type: ${insertResult}`);
    assert(failures.length === 0, `${failures.join("\n")}\n\n${lowered.apiDts}`);
  });

  test("generated API types surface pages, collisions, and walk results", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-surface"));
    assert(lowered.ok, `Quarry surface fixture refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const expected: Record<string, string> = {
      "surface.visiblePosts": `{ rows: Page<PostsRow>; count: number }`,
      "surface.postsAfter": `(Omit<PostsRow, "author"> & { author: { name: string; role: "member" | "admin" } | null; edited: number })[]`,
      "surface.ancestors": `NodesRow[]`,
      "surface.requiredUser": `{ name: string; role: "member" | "admin" }`,
    };
    const failures = Object.entries(expected).flatMap(([operation, result]) => {
      const received = operationResult(lowered.apiDts, operation);
      return received === result ? [] : [`${operation} result differs:\nexpected ${result}\nreceived ${received}`];
    });
    assert(failures.length === 0, `${failures.join("\n")}\n\n${lowered.apiDts}`);
  });

  test("generated API types preserve branded assets through rows and shaped pages", async () => {
    await withProjectFiles("snapback2-api-assets-", {
      "snapback/schema.q": `table media:
  photo: image <=5000000
  clip: video <=50000000
  gallery: [image <=5000000] <=4 ?
  public
`,
      "snapback/assets.q": `query rows():
  return media[] first 5 by byId

query cards():
  return media[] first 5 by byId { photo, clip, gallery }
`,
    }, undefined, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `asset shape probe refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const expected: Record<string, string> = {
        "assets.rows": "Page<MediaRow>",
        "assets.cards": "{ photo: ImageAsset; clip: VideoAsset; gallery: ImageAsset[] | null }[]",
      };
      for (const [operation, result] of Object.entries(expected)) {
        assert(operationResult(lowered.apiDts, operation) === result,
          `${operation} result differs:\nexpected ${result}\nreceived ${operationResult(lowered.apiDts, operation)}\n\n${lowered.apiDts}`);
      }
    });
  });

  test("an empty-list return arm is absorbed into its sibling array type", async () => {
    await withCliqueProbe(fixtures, `query emptyOrTokens(body: text <=100, flag: bool):
  if flag:
    return []
  return tokens(body)
`, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `empty-list probe refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const received = operationResult(lowered.apiDts, "probes.emptyOrTokens");
      assert(received === "string[]", `empty-list arm widened the array result: ${received}\n\n${lowered.apiDts}`);
    });
  });

  test("spread overrides omit every colliding row key", async () => {
    const source = `query referenceOverride():
  return feedItems[] first 5 by byOrd { *, post: .post { id, body } }

query scalarOverride():
  return posts[viewer] first 5 by byAuthor { *, id: 'replacement', likeCount: 'many' }

query convSummary(c: conversations):
  return { total: convSpend[c], creatorProfile: users[principal = viewer] { displayName, handle } }

query maybeProfile(u: users):
  found = users[u]
  if found != null:
    return found { displayName, handle }
  else:
    return null
`;
    await withCliqueProbe(fixtures, source, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `Clique collision probes refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const expected: Record<string, string> = {
        "probes.referenceOverride": `(Omit<FeedItemsRow, "post"> & { post: { id: string; body: string } | null })[]`,
        "probes.scalarOverride": `(Omit<PostsRow, "id" | "likeCount"> & { id: string; likeCount: string })[]`,
        "probes.convSummary": `{ total: Money<"USD", 2>; creatorProfile: { displayName: string; handle: string } | null }`,
        "probes.maybeProfile": `{ displayName: string; handle: string } | null`,
      };
      for (const [operation, result] of Object.entries(expected)) {
        assert(operationResult(lowered.apiDts, operation) === result,
          `${operation} result differs:\nexpected ${result}\nreceived ${operationResult(lowered.apiDts, operation)}`);
      }
    });
  });

  test("structured inference preserves exact money builtin results", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-money"));
    assert(lowered.ok, `Quarry money fixture refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const get = `{ price: Money<"USD", 2>; whole: Money<"USD", 2>; computed: Money<"USD", 2>; rate: Decimal<3>; yen: Money<"JPY", 0> | null }`;
    assert(operationResult(lowered.apiDts, "money.get") === get,
      `money.get result differs:\nexpected ${get}\nreceived ${operationResult(lowered.apiDts, "money.get")}`);

    await withProjectFiles("snapback2-api-money-", {
      "snapback/schema.q": "table values:\n  amount: money USD\n  public\n",
      "snapback/results.q": `query divmodResult(amount: money USD):
  return divmod(amount, 3)

query shareResult(amount: money USD, recipients: [principal] <=5):
  return share(amount, recipients, viewer)

query minResult(left: money USD, right: money USD):
  return min(left, right)

query maxResult(left: money USD, right: money USD):
  return max(left, right)
`,
    }, undefined, async (root) => {
      const result = await lowerProject(root);
      assert(result.ok, `money result probes refused: ${result.ok ? "" : diagnosticsText(result.diagnostics)}`);
      const expected: Record<string, string> = {
        "results.divmodResult": `{ quotient: Money<"USD", 2>; remainder: Money<"USD", 2> }`,
        "results.shareResult": `Money<"USD", 2>`,
        "results.minResult": `Money<"USD", 2>`,
        "results.maxResult": `Money<"USD", 2>`,
      };
      for (const [operation, text] of Object.entries(expected)) {
        assert(operationResult(result.apiDts, operation) === text,
          `${operation} result differs:\nexpected ${text}\nreceived ${operationResult(result.apiDts, operation)}`);
      }
    });
  });

  test("single-path inference deliberately types chat insert branches", async () => {
    const lowered = await lowerProject(resolve(frontend, "../snapback2/templates/chat"));
    assert(lowered.ok, `Quarry chat fixture refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const expected: Record<string, string> = {
      "follows.setFollow": `FollowsRow | null`,
      "profiles.createMyProfile": `ProfilesRow`,
    };
    for (const [operation, result] of Object.entries(expected)) {
      assert(operationResult(lowered.apiDts, operation) === result,
        `${operation} result differs:\nexpected ${result}\nreceived ${operationResult(lowered.apiDts, operation)}`);
    }
  });

  test("a Clique journey consumes shaped money rows with nominal result types", async () => {
    const journey = `import type { Money } from "snapback2";
import { api } from "snapback2/client";
import { journey } from "snapback2/test";

journey("typed shaped ledger", async ({ as }) => {
  const response = await as("alice").query(api.pay.myLedger, {});
  if (response.state !== "complete" && response.state !== "capped") throw new Error("missing ledger data");
  for (const row of response.data) {
    const amount: Money<"USD", 2> = row.amount;
    row.counterpartyProfile?.handle;
    amount.valueOf();
    // @ts-expect-error misspelled shaped field must not enter the client API.
    row.counterpartyProfil;
  }
});
`;
    await withCliqueJourney(fixtures, snapbackTypes, journey, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `Clique journey backend refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const checked = await compileJourneys(root, lowered.apiDts);
      assert(checked.ok, `typed shaped ledger journey refused: ${checked.ok ? "" : diagnosticsText(checked.diagnostics)}`);
    });
  });

  test("template journeys resolve real API types and expose optional partial data", async () => {
    const templates = resolve(frontend, "../snapback2/templates");
    const failures: string[] = [];
    await withCopiedProject(resolve(templates, "todos"), snapbackTypes, async (root) => {
      const lowered = await lowerProject(root);
      if (!lowered.ok) failures.push(`todos backend: ${diagnosticsText(lowered.diagnostics)}`);
      else {
        const journeys = await compileJourneys(root, lowered.apiDts);
        if (!journeys.ok) failures.push(`todos journeys: ${diagnosticsText(journeys.diagnostics)}`);
      }
    });
    for (const [name, source] of [
      ["template", resolve(templates, "chat")],
      ["fixture", resolve(fixtures, "quarry-chat")],
    ] as const) {
      await withCopiedProject(source, snapbackTypes, async (root) => {
        const journeyPath = join(root, "snapback/tests/chat.test.ts");
        const current = await readFile(journeyPath, "utf8");
        const original = current.replace("after.data?.some(", "after.data.some(");
        const edited = current.replace("after.data.some(", "after.data?.some(");
        if (original === edited) {
          failures.push(`${name} chat journey has neither expected after.data.some spelling`);
          return;
        }

        await writeFile(journeyPath, original);
        const originalLowered = await lowerProject(root);
        if (!originalLowered.ok) {
          failures.push(`${name} original chat backend: ${diagnosticsText(originalLowered.diagnostics)}`);
          return;
        }
        const originalJourneys = await compileJourneys(root, originalLowered.apiDts);
        if (originalJourneys.ok || !originalJourneys.diagnostics.some((item) => item.message.includes("'after.data' is possibly 'undefined'"))) {
          failures.push(`${name} original chat journey did not expose optional QueryPartial.data: ${originalJourneys.ok ? "passed" : diagnosticsText(originalJourneys.diagnostics)}`);
        }

        await writeFile(journeyPath, edited);
        const editedLowered = await lowerProject(root);
        if (!editedLowered.ok) {
          failures.push(`${name} edited chat backend: ${diagnosticsText(editedLowered.diagnostics)}`);
          return;
        }
        const editedJourneys = await compileJourneys(root, editedLowered.apiDts);
        if (!editedJourneys.ok) failures.push(`${name} edited chat journeys: ${diagnosticsText(editedJourneys.diagnostics)}`);
      });
    }
    assert(failures.length === 0, failures.join("\n"));
  });
}

async function withCliqueProbe<T>(fixtures: string, source: string, run: (root: string) => Promise<T>): Promise<T> {
  return withProjectFiles("snapback2-api-probes-", {
    "snapback/schema.q": await readFile(resolve(fixtures, "quarry-clique/snapback/schema.q"), "utf8"),
    "snapback/probes.q": source,
  }, undefined, run);
}

async function withCopiedProject<T>(source: string, snapbackTypes: string, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-api-template-"));
  try {
    await cp(resolve(source, "snapback"), join(root, "snapback"), { recursive: true });
    await installSnapbackTypes(root, snapbackTypes);
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withProjectFiles<T>(
  prefix: string,
  files: Record<string, string>,
  snapbackTypes: string | undefined,
  run: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    if (snapbackTypes) await installSnapbackTypes(root, snapbackTypes);
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function installSnapbackTypes(root: string, types: string): Promise<void> {
  const packageRoot = join(root, "node_modules/snapback2");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "snapback2", types: "index.d.ts" }));
  await writeFile(join(packageRoot, "index.d.ts"), await readFile(types, "utf8"));
}

function operationResult(apiDts: string, operation: string): string | undefined {
  const [moduleName, exportName] = operation.split(".");
  const source = ts.createSourceFile("api.d.ts", apiDts, ts.ScriptTarget.Latest, true);
  const augmentation = source.statements.find((node): node is ts.ModuleDeclaration =>
    ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name) && node.name.text === "snapback2/client");
  if (!augmentation?.body || !ts.isModuleBlock(augmentation.body)) return undefined;
  const api = augmentation.body.statements.find((node): node is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(node) && node.name.text === "Api");
  const member = (members: readonly ts.TypeElement[], name: string | undefined) => members.find((node): node is ts.PropertySignature =>
    ts.isPropertySignature(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === name);
  const module = api && member(api.members, moduleName)?.type;
  const result = module && ts.isTypeLiteralNode(module) && member(module.members, exportName)?.type;
  // @ref LLP 1018.003.001#3-semantic-mutation-targets — result and target metadata occupy separate Op arguments.
  return result && ts.isTypeReferenceNode(result) && result.typeName.getText(source) === "Op"
    ? result.typeArguments?.[1]?.getText(source) : undefined;
}

async function withCliqueJourney<T>(fixtures: string, snapbackTypes: string, journey: string, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-api-shapes-"));
  try {
    for (const name of ["schema.q", "cards.q", "pay.q", "social.q", "chat.q"]) {
      const path = join(root, "snapback", name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, await readFile(resolve(fixtures, "quarry-clique/snapback", name), "utf8"));
    }
    const journeyPath = join(root, "snapback/tests/api-shapes.test.ts");
    await mkdir(dirname(journeyPath), { recursive: true });
    await writeFile(journeyPath, journey);
    await installSnapbackTypes(root, snapbackTypes);
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function diagnosticsText(diagnostics: Array<{ code: string; message: string }>): string {
  return diagnostics.map((item) => `${item.code}: ${item.message}`).join("; ");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
