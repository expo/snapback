import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ClientStore, type ClosureReceipt, type Context } from "../../evaluator/src/evaluator";
import type { FrontendDiagnostic, Program } from "./ir";
import { lowerSource } from "./compiler";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { compileQuarry, type QuarryInput } from "./quarry/index";
import { expandDocuments } from "./quarry/expand";
import { parseDocument } from "./quarry/parser";
import { quarryExpression, quarryShapeDeclaration } from "./quarry/program";
import ts from "typescript";

type Test = (name: string, run: () => void | Promise<void>) => void;

export function registerQuarryChecks(test: Test, frontend: string): void {
  const fixtures = resolve(frontend, "fixtures");
  const packageRoot = resolve(frontend, "../snapback2");

  test("Quarry todos and full surface lower in memory and certify", async () => {
    for (const [name, count] of [["quarry-todos", 2], ["quarry-surface", 26]] as const) {
      const lowered = await lowerProject(resolve(fixtures, name));
      assert(lowered.ok, `${name} refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(lowered.project.programs.length === count, `${name} program count changed to ${lowered.project.programs.length}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `${name} did not certify: ${JSON.stringify(failures)}`);
      assert(!existsSync(resolve(fixtures, name, "snapback/schema.ts")), `${name} wrote generated schema.ts into the authored tree`);
      assert(!existsSync(resolve(fixtures, name, "snapback/surface.q.ts")), `${name} wrote generated .q.ts into the authored tree`);
      assert(lowered.quarry.every((item) => item.file.endsWith(".q") && item.generated.endsWith(".ts")
        && item.source.startsWith("// GENERATED")), `${name} lost its Quarry inspection response`);
    }

    const compiled = compileFixture(fixtures, "quarry-surface", ["schema", "surface"]);
    assert(compiled.ok, `surface front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const text = `${compiled.schema.source}\n${compiled.modules[0]!.source}`;
    for (const spelling of [
      "rule.and(", "rule.or(", "rule.not(", "rule.exists(", "channel({", "t.optional(", "t.enum(",
      "t.principal()", "t.id()", "t.json(2048)", "t.bytes(1024)", "db.upsert(", "orderedPair(",
      "mentionTokens(", "recurse(", "after:", "__q_matchResult", "db.get(users",
    ]) assert(text.includes(spelling), `Quarry full-surface lowering lost ${spelling}`);
    for (const line of text.split("\n").filter((line) => line.trim())) {
      assert(/\/\/ q:.+:\d+:\d+$/.test(line), `generated Quarry line lacks file:line:column provenance: ${line}`);
    }
  });

  test("Quarry named shapes expand in every use position and print as authored", async () => {
    const schema = `table profiles:
  displayName: text <=80
  handle: text <=40
  by byDisplayName: displayName, id
  public

table posts:
  author: profiles
  body: text <=500
  public
`;
    const module = `shape card = { displayName, handle }
shape labeledCard = { ...card, label: .displayName }
shape postCard = { body, author: profiles[.author] card }

query direct(id: profiles):
  return profiles[id] card

query boundRow(id: profiles):
  row = profiles[id]! else MISSING
  return row labeledCard

query boundPage():
  page = profiles[] first 2 by byDisplayName
  return page card

query nested(id: posts):
  return posts[id] postCard
`;
    const parsed = parseDocument("snapback/cards.q", module);
    assert(parsed.diagnostics.length === 0, `named-shape source did not parse: ${JSON.stringify(parsed.diagnostics)}`);
    const expanded = expandDocuments([parsed.document]);
    const direct = expanded.documents[0]!.programs.find((program) => program.name === "direct")!.body[0]!;
    assert(direct.kind === "return" && quarryExpression(direct.value) === "(profiles[id]) card",
      `expanded use did not print the authored shape name: ${direct.kind === "return" ? quarryExpression(direct.value) : direct.kind}`);
    assert(quarryShapeDeclaration(parsed.document.shapes[1]!) === "shape labeledCard = { ...card, label: .displayName }",
      "shape declaration printer did not preserve the authored declaration");

    await withProject({ "snapback/schema.q": schema, "snapback/cards.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `named shapes refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `expanded shapes did not certify: ${JSON.stringify(failures)}`);
      for (const name of ["cards.direct", "cards.boundRow", "cards.boundPage", "cards.nested"]) {
        const serialized = JSON.stringify(operation(lowered.project.programs, name));
        assert(serialized.includes("displayName"), `${name} lost the named projection: ${serialized}`);
      }
    });
  });

  test("Quarry named shapes refuse placement, cycles, depth, and carry definition plus use sites", () => {
    const schema = "table profiles:\n  displayName: text <=80\n  public\n";
    const placement = compileInline([
      { fileName: "snapback/schema.q", source: `${schema}\nshape card = { displayName }\n` },
      { fileName: "snapback/ops.q", source: "query one():\n  return null\n" },
    ]);
    assert(!placement.ok && placement.diagnostics.some((item) => item.code === "E_QUARRY_PLACEMENT"),
      `schema shape did not receive a placement refusal: ${JSON.stringify(placement)}`);

    for (const [name, declarations] of [
      ["direct", "shape a = { ...a }"],
      ["indirect", "shape a = { ...b }\nshape b = { ...a }"],
    ] as const) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: `snapback/${name}.q`, source: `${declarations}\nquery use(id: profiles):\n  return profiles[id] a\n` },
      ]);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_QUARRY_UNSUPPORTED" && item.message.includes("shape cycle")),
        `${name} shape cycle compiled: ${JSON.stringify(result)}`);
    }

    const chain = Array.from({ length: 9 }, (_, offset) =>
      `shape s${offset + 1} = { ${offset === 8 ? "displayName" : `...s${offset + 2}`} }`).join("\n");
    const deep = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/deep.q", source: `${chain}\nquery use(id: profiles):\n  return profiles[id] s1\n` },
    ]);
    assert(!deep.ok && deep.diagnostics.some((item) => item.code === "E_QUARRY_UNSUPPORTED" && item.message.includes("depth 8")),
      `nine-deep shape compiled: ${JSON.stringify(deep)}`);

    const bad = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/bad.q", source: "shape broken = { missing }\nquery use(id: profiles):\n  return profiles[id] broken\n" },
    ]);
    const refusal = bad.ok ? undefined : bad.diagnostics.find((item) => item.code === "E_QUARRY_UNKNOWN");
    assert(refusal?.site === "snapback/bad.q:1:18" && refusal.message.includes("used at snapback/bad.q:3:"),
      `expanded diagnostic lost its definition and use sites: ${JSON.stringify(bad)}`);

    for (const keyword of ["shape", "fn", "cursor"]) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/reserved.q", source: `query bad(${keyword}: int):\n  return ${keyword}\n` },
      ]);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_QUARRY_UNKNOWN" && item.message.includes("reserved")),
        `${keyword} was not reserved as a binding: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry accepts word writes and refuses every write sigil with the word forms", () => {
    const sigils = ["+", "~", ["+", "~"].join(""), "-"];
    const forms = [
      `${sigils[0]}items { value: 1 }`,
      `${sigils[1]}items[id] { value: 2 }`,
      `${sigils[2]}items[id] { value: 3 }`,
      `${sigils[3]}items[id]`,
    ];
    const parsed = parseDocument("snapback/ops.q", `mutation oldWrites(id: items):\n${forms.map((form) => `  ${form}`).join("\n")}\n`);
    const refusals = parsed.diagnostics.filter((item) => item.code === "E_QUARRY_SYNTAX" && item.message.startsWith("write sigils"));
    assert(refusals.length === 4, `write sigils did not each refuse: ${JSON.stringify(parsed.diagnostics)}`);
    for (const refusal of refusals) {
      assert(["insert", "update", "upsert", "delete"].every((word) => refusal.message.includes(word)),
        `write-sigil refusal did not name all four words: ${refusal.message}`);
      assert(!/[~+-].*items/.test(refusal.rewrite), `write-sigil refusal pasted a compatibility rewrite: ${refusal.rewrite}`);
    }
  });

  test("Quarry image/video spellings lower as closed records through IR, manifest descriptors, and API types", async () => {
    const projectRoot = resolve(fixtures, "quarry-assets");
    const compiled = compileFixture(fixtures, "quarry-assets", ["schema", "assets"]);
    assert(compiled.ok, `asset spellings did not parse: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const generated = `${compiled.schema.source}\n${compiled.modules[0]!.source}`;
    for (const spelling of [
      "t.image(5000000)", "t.optional(t.image(5000000))", "t.video(50000000)", "t.optional(t.video(50000000))",
      "t.list(t.image(12000000), { max: 4 })", "t.list(t.video(50000000), { max: 2 })",
      "args.clip.duration", "args.photo.width",
    ]) assert(generated.includes(spelling), `asset Quarry lowering lost ${spelling}:\n${generated}`);

    const lowered = await lowerProject(projectRoot);
      assert(lowered.ok, `asset project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const columns = (lowered.project.schema.tables.media as any).columns;
      assert(JSON.stringify(columns.photo) === JSON.stringify({ Image: { max: 5_000_000 } })
        && JSON.stringify(columns.avatar) === JSON.stringify({ Optional: { Image: { max: 5_000_000 } } })
        && JSON.stringify(columns.clip) === JSON.stringify({ Video: { max: 50_000_000 } })
        && JSON.stringify(columns.trailer) === JSON.stringify({ Optional: { Video: { max: 50_000_000 } } })
        && JSON.stringify(columns.gallery) === JSON.stringify({ List: { of: { Image: { max: 12_000_000 } }, max: 4 } })
        && JSON.stringify(columns.albums) === JSON.stringify({ Optional: { List: { of: { Image: { max: 12_000_000 } }, max: 4 } } })
        && JSON.stringify(columns.reels) === JSON.stringify({ List: { of: { Video: { max: 50_000_000 } }, max: 2 } }),
      `asset columns did not use the exact externally tagged JSON: ${JSON.stringify(columns)}`);
      const inspect = operation(lowered.project.programs, "assets.inspect");
      const args = inspect.args as any;
      assert(JSON.stringify(args.photo) === JSON.stringify({ Image: { max: 5_000_000 } })
        && JSON.stringify(args.clip) === JSON.stringify({ Video: { max: 50_000_000 } }),
      `asset operation/manifest descriptors changed: ${JSON.stringify(inspect.args)}`);
      const allArgs = operation(lowered.project.programs, "assets.acceptAll").args as any;
      assert(JSON.stringify(allArgs.avatar) === JSON.stringify({ Optional: { Image: { max: 5_000_000 } } })
        && JSON.stringify(allArgs.trailer) === JSON.stringify({ Optional: { Video: { max: 50_000_000 } } })
        && JSON.stringify(allArgs.gallery) === JSON.stringify({ List: { of: { Image: { max: 12_000_000 } }, max: 4 } })
        && JSON.stringify(allArgs.albums) === JSON.stringify({ Optional: { List: { of: { Image: { max: 12_000_000 } }, max: 4 } } })
        && JSON.stringify(allArgs.reels) === JSON.stringify({ List: { of: { Video: { max: 50_000_000 } }, max: 2 } }),
      `nested asset operation/manifest descriptors changed: ${JSON.stringify(allArgs)}`);
      const body = JSON.stringify(inspect.body);
      assert(body.includes('"Field":{"base":{"Variable":"clip"},"name":"duration"}')
        && body.includes('"Field":{"base":{"Variable":"photo"},"name":"width"}'),
      `asset member selection did not lower to ordinary Field IR: ${body}`);
      assert(lowered.apiDts.includes("photo: File | ImageAsset")
        && lowered.apiDts.includes("avatar?: File | ImageAsset | null")
        && lowered.apiDts.includes("clip: File | VideoAsset")
        && lowered.apiDts.includes("trailer?: File | VideoAsset | null")
        && lowered.apiDts.includes("gallery: (File | ImageAsset)[]")
        && lowered.apiDts.includes("albums?: (File | ImageAsset)[] | null")
        && lowered.apiDts.includes("reels: (File | VideoAsset)[]"),
      `mutation API args lost recursive File unions:\n${lowered.apiDts}`);
      const query = lowered.apiDts.match(/readonly echo: Op<([^\n]+)>;/)?.[1] ?? "";
      assert(query.includes("photo: ImageAsset") && query.includes("clip: VideoAsset") && !query.includes("File"),
        `query args/results admitted File or lost asset records: ${query}`);
      const mutation = lowered.apiDts.match(/readonly inspect: Op<([^\n]+)>;/)?.[1] ?? "";
      const resultStart = mutation.indexOf("}, {");
      const result = mutation.slice(resultStart);
      assert(resultStart > 0 && !result.includes("File")
        && result.includes("photo: ImageAsset") && result.includes("clip: VideoAsset"),
      `mutation result did not remain asset-record-only: ${mutation}`);

      const nested = lowered.apiDts.match(/readonly echoNested: Op<([^\n]+)>;/)?.[1] ?? "";
      assert(nested.includes("albums?: ImageAsset[] | null")
        && nested.includes("{ albums: ImageAsset[] | undefined }"),
      `optional(list(asset)) did not survive query args/results: ${nested}`);

      await withProject({
        "snapback2.d.ts": readFileSync(resolve(frontend, "lib.d.ts"), "utf8"),
        "client.d.ts": `declare module "snapback2/client" {
          export interface Op<Args, Result> { readonly __args?: (args: Args) => void; readonly __result?: Result }
          export interface Channel<Args, Payload = unknown> { readonly __args?: Args; readonly __payload?: Payload }
          export interface Api {}
        }`,
        "api.d.ts": lowered.apiDts,
        "asset-declarations.ts": `import type { ImageAsset, VideoAsset } from "snapback2";
          import type { Api, Op } from "snapback2/client";
          type ResultOf<T> = T extends Op<any, infer Result> ? Result : never;
          type Echo = ResultOf<Api["assets"]["echo"]>;
          declare const echo: Echo;
          declare const image: ImageAsset;
          declare const anotherImage: ImageAsset;
          declare const video: VideoAsset;
          const sameKind: ImageAsset = anotherImage;
          const fromQueryResult: ImageAsset = echo.photo;
          const runtimeJsonShape: { id: string; width: number; height: number } = echo.photo;
          // @ts-expect-error VideoAsset is nominally distinct from ImageAsset despite its superset shape.
          const videoAsImage: ImageAsset = video;
          // @ts-expect-error ImageAsset is nominally distinct from VideoAsset.
          const imageAsVideo: VideoAsset = image;
          // @ts-expect-error A literal object cannot forge the phantom image brand.
          const forged: ImageAsset = { id: "asset-1", width: 1, height: 1 };
          void [sameKind, fromQueryResult, runtimeJsonShape, videoAsImage, imageAsVideo, forged];`,
      }, async (root) => {
        const sample = resolve(root, "asset-declarations.ts");
        const program = ts.createProgram({
          rootNames: [
            resolve(root, "snapback2.d.ts"),
            resolve(root, "client.d.ts"),
            resolve(root, "api.d.ts"),
            sample,
          ],
          options: {
            lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            noEmit: true,
            strict: true,
            target: ts.ScriptTarget.ES2022,
          },
        });
        const diagnostics = ts.getPreEmitDiagnostics(program)
          .filter((item) => item.file?.fileName === sample || item.file?.fileName === resolve(root, "api.d.ts"));
        assert(diagnostics.length === 0,
          `asset nominal declaration proof failed:\n${diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n")}`);
      });
  });

  test("asset IR rustCheck round trip — SKIP while lane A rejects Image", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-assets"));
    assert(lowered.ok, `asset project refused before rustCheck: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema)
      .filter((item) => item.error);
    const laneABlocked = failures.some((item) => item.error?.code === "E_CHECK_IR_UNSUPPORTED"
      && item.error.message.includes("unknown variant `Image`"));
    if (laneABlocked) {
      assert(failures.every((item) => item.error?.code === "E_CHECK_IR_UNSUPPORTED"
        && /unknown variant `(Image|Video)`/.test(item.error.message)),
      `asset IR rustCheck skip encountered a non-lane-A failure: ${JSON.stringify(failures)}`);
      return;
    }
    assert(failures.length === 0, `asset IR did not round-trip through rustCheck: ${JSON.stringify(failures)}`);
  });

  test("asset index and maintain.by matrices refuse scalar, video, optional, and list forms", async () => {
    await withProject({
      "snapback/schema.q": `table media:
  photo: image <=5000000
  avatar: image <=5000000 ?
  gallery: [image <=5000000] <=4
  clip: video <=50000000
  unique photo
  by avatar
  by gallery
  by clip
  public
`,
      "snapback/media.q": "query one():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      const refusals = result.ok ? [] : result.diagnostics.filter((item) => item.code === "E_SCHEMA_INDEX_COLUMN");
      assert(refusals.length === 4 && refusals.every((item) => item.family === "schema")
        && ["photo", "avatar", "gallery", "clip"].every((field) => refusals.some((item) => item.message.includes(`column ${field}`))),
      `asset index matrix did not return four E_SCHEMA_INDEX_COLUMN refusals: ${JSON.stringify(result)}`);
    });

    await withProject({
      "snapback/schema.q": `table events:
  photo: image <=5000000
  public

maintain totals = count events by photo:
  read <- public
`,
      "snapback/events.q": "query one():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      const refusal = result.ok ? undefined : result.diagnostics.find((item) => item.code === "E_SCHEMA_ASSET_MAINTAIN");
      assert(!result.ok && result.diagnostics.length === 1 && refusal?.family === "schema"
        && refusal.message.includes("events.photo") && refusal.site.startsWith("snapback/schema.q:"),
      `asset maintain.by did not return one source-sited E_SCHEMA_ASSET_MAINTAIN: ${JSON.stringify(result)}`);
    });

    await withProject({
      "snapback/schema.q": `table events:
  avatar: image <=5000000 ?
  gallery: [image <=5000000] <=4
  clip: video <=50000000
  public

maintain avatarTotals = count events by avatar:
  read <- public

maintain galleryTotals = count events by gallery:
  read <- public

maintain clipTotals = count events by clip:
  read <- public
`,
      "snapback/events.q": "query one():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      const refusals = result.ok ? [] : result.diagnostics.filter((item) => item.code === "E_SCHEMA_ASSET_MAINTAIN");
      assert(!result.ok && result.diagnostics.length === 3 && refusals.length === 3
        && ["events.avatar", "events.gallery", "events.clip"].every((field) => refusals.some((item) => item.message.includes(field))),
      `asset maintain.by nested/video matrix did not return only dedicated refusals: ${JSON.stringify(result)}`);
    });
  });

  test("Quarry recursively rejects image/video assignment mismatches and literal record forges", () => {
    const schema = `table media:
  images: [image <=5000000] <=4
  videos: [video <=50000000] <=4
  optionalImages: [image <=5000000] <=4 ?
  nestedImages: [[image <=5000000] <=4] <=3
  photo: image <=5000000
  optionalPhoto: image <=5000000 ?
  public
`;
    const cases = [
      ["scalar-video-to-image", "clip: video <=50000000", "photo: clip", "photo", "image asset", "video asset"],
      ["list-video-to-image", "videos: [video <=50000000] <=4", "images: videos", "images", "image asset", "video asset"],
      ["list-image-to-video", "images: [image <=5000000] <=4", "videos: images", "videos", "video asset", "image asset"],
      ["optional-list", "videos: [video <=50000000] <=4 ?", "optionalImages: videos", "optionalImages", "image asset", "video asset"],
      ["nested-list", "videos: [[video <=50000000] <=4] <=3", "nestedImages: videos", "nestedImages", "image asset", "video asset"],
      ["list-to-scalar", "photos: [image <=5000000] <=4", "photo: photos", "photo", "image asset", "[image asset]"],
      ["scalar-to-list", "photo: image <=5000000", "images: photo", "images", "[image asset]", "image asset"],
      ["shallow-to-nested", "photos: [image <=5000000] <=4", "nestedImages: photos", "nestedImages", "[[image asset]]", "[image asset]"],
      ["nested-to-shallow", "photos: [[image <=5000000] <=4] <=3", "images: photos", "images", "[image asset]", "[[image asset]]"],
      ["optional-to-required", "photo: image <=5000000 ?", "photo: photo", "photo", "image asset", "image asset or null"],
      ["optional-list-to-required", "photos: [image <=5000000] <=4 ?", "images: photos", "images", "[image asset]", "[image asset] or null"],
    ] as const;
    for (const [name, argument, assignment, field, expected, actual] of cases) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: `mutation ${name.replaceAll("-", "_")}(${argument}):\n  return insert media { ${assignment} }\n` },
      ]);
      const refusal = result.ok ? undefined : result.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
      assert(refusal?.family === "quarry" && refusal.site.startsWith("snapback/ops.q:2:")
        && refusal.message.includes(field) && refusal.message.includes(expected) && refusal.message.includes(actual)
        && refusal.rewrite.includes(`use a ${expected} value for ${field}`),
      `${name} lost its recursive kind refusal/rewrite: ${JSON.stringify(result)}`);
    }

    const accepted = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `mutation accepted(photo: image <=5000000, photos: [image <=5000000] <=4):
  return insert media { images: [], optionalImages: photos, optionalPhoto: photo }

mutation nested_empty():
  return insert media { nestedImages: [[]] }

mutation empty_first(photos: [image <=5000000] <=4):
  return insert media { nestedImages: [[], photos] }

mutation empty_last(photos: [image <=5000000] <=4):
  return insert media { nestedImages: [photos, []] }
` },
    ]);
    assert(accepted.ok, `nested empty asset list or required-to-optional asset assignment refused: ${accepted.ok ? "" : JSON.stringify(accepted.diagnostics)}`);

    const scalarEmpty = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: "mutation scalar_empty():\n  return insert media { photo: [] }\n" },
    ]);
    assert(!scalarEmpty.ok && scalarEmpty.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
      && item.message.includes("photo requires image asset")),
    `empty list literal was accepted for scalar asset column: ${JSON.stringify(scalarEmpty)}`);

    const forge = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: "mutation forge():\n  return insert media { photo: { id: 'asset-1', width: 1, height: 1 } }\n" },
    ]);
    assert(!forge.ok && forge.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
      && item.message.includes("photo requires image asset")),
    `literal asset record forge did not remain E_QUARRY_TYPE: ${JSON.stringify(forge)}`);
  });

  test("the TypeScript lowering twin diagnoses missing asset fields and preserves descriptor/API shapes", async () => {
    const fixture = resolve(fixtures, "assets");
    const lowered = await lowerProject(fixture, { authoring: "any" });
    assert(lowered.ok, `TS-authored asset fixture refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const columns = (lowered.project.schema.tables.media as any).columns;
    assert(JSON.stringify(columns.photo) === JSON.stringify({ Image: { max: 5_000_000 } })
      && JSON.stringify(columns.albums) === JSON.stringify({ Optional: { List: { of: { Image: { max: 12_000_000 } }, max: 4 } } }),
    `TS-authored asset descriptors changed: ${JSON.stringify(columns)}`);
    assert(lowered.apiDts.includes("photo: File | ImageAsset")
      && lowered.apiDts.includes("albums?: (File | ImageAsset)[] | null")
      && lowered.apiDts.includes("readonly echo: Op<{ photo: ImageAsset }, ImageAsset>")
      && lowered.apiDts.includes("{ photo: ImageAsset; width: number; clip: VideoAsset")
      && lowered.apiDts.includes("duration: number"),
    `TS-authored asset fixture lost File unions or result types:\n${lowered.apiDts}`);

    const invalidSource = readFileSync(resolve(fixture, "snapback/photo-duration.invalid.ts.fixture"), "utf8");
    const invalid = lowerSource(invalidSource, "snapback/photo-duration.ts");
    const refusal = invalid.ok ? undefined : invalid.diagnostics.find((item) => item.code === "E_ARGS_TYPE");
    assert(refusal?.message.includes("image asset has no field duration")
      && refusal.site.startsWith("snapback/photo-duration.ts:")
      && refusal.rewrite.includes("args.photo.width"),
    `TS twin returned unknown instead of a sited missing-field refusal: ${JSON.stringify(invalid)}`);
  });

  test("seed assets use E_SCHEMA_ASSET_SEED recursively while optional null remains allowed", async () => {
    await withProject({
      "snapback/schema.q": `table media:
  photo: image <=5000000
  clip: video <=50000000
  gallery: [image <=5000000] <=4
  reels: [video <=50000000] <=4 ?
  avatar: image <=5000000 ?
  public
`,
      "snapback/seed.ts": `import { seed } from "snapback2";
        export default seed({ personas: [], rows: { media: [{
          id: "media-1",
          photo: { id: "image-1", width: 10, height: 10 },
          clip: { id: "video-1", width: 10, height: 10, duration: 1000 },
          gallery: [{ id: "image-2", width: 10, height: 10 }],
          reels: [{ id: "video-2", width: 10, height: 10, duration: 1000 }],
          avatar: null,
        }] } });`,
    }, async (root) => {
      const result = await (await import("./project")).lowerSeed(root);
      const refusals = result.ok ? [] : result.diagnostics.filter((item) => item.code === "E_SCHEMA_ASSET_SEED");
      assert(!result.ok && result.diagnostics.length === 4 && refusals.length === 4
        && refusals.every((item) => item.family === "schema"
          && item.site.startsWith("snapback/seed.ts:")
          && item.message.includes("seeds cannot mint ledger rows")
          && item.rewrite === "upload through the app; seeds cannot mint ledger rows"),
      `seed assets did not use the dedicated recursive refusal/null exception: ${JSON.stringify(result)}`);
    });
  });

  test("asset records reject unknown fields with a typed Quarry rewrite and have no legacy URL compatibility", () => {
    const nullable = compileInline([
      { fileName: "snapback/schema.q", source: "table media:\n  photo: image <=5000000 ?\n  public\n" },
      { fileName: "snapback/media.q", source: "mutation clear():\n  return insert media { photo: null }\n" },
    ]);
    assert(nullable.ok, `optional asset column refused null: ${nullable.ok ? "" : diagnosticsText(nullable.diagnostics)}`);
    const unknown = compileInline([
      { fileName: "snapback/schema.q", source: "table media:\n  photo: image <=5000000\n  public\n" },
      { fileName: "snapback/media.q", source: "query bad(photo: image <=5000000):\n  return photo.duration\n" },
    ]);
    const refusal = unknown.ok ? undefined : unknown.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
    assert(refusal?.message.includes("image asset has no field duration") && refusal.rewrite?.includes("photo.width"),
      `unknown asset field lost its typed rewrite: ${JSON.stringify(unknown)}`);

    const useAssets = parseDocument("snapback/schema.q", "use assets\n");
    assert(useAssets.diagnostics.length === 1 && useAssets.diagnostics[0]?.code === "E_QUARRY_UNSUPPORTED"
      && !/url/i.test(`${useAssets.diagnostics[0]?.message} ${useAssets.diagnostics[0]?.rewrite}`),
    `use assets did not stay on the generic non-URL refusal path: ${JSON.stringify(useAssets.diagnostics)}`);
    for (const source of ["use assets\n", "table media:\n  photo: asset <=5000000\n  public\n"]) {
      const legacy = parseDocument("snapback/schema.q", source);
      assert(legacy.diagnostics.length > 0 && legacy.diagnostics.every((item) => !/url/i.test(`${item.message} ${item.rewrite}`)),
        `legacy asset spelling retained URL compatibility advice: ${JSON.stringify(legacy.diagnostics)}`);
    }
    for (const source of [
      "table media:\n  photo: image <=1.5\n  public\n",
      "table media:\n  clip: video <=0\n  public\n",
      "table media:\n  photo: image <=4294967296\n  public\n",
    ]) {
      const invalid = compileInline([{ fileName: "snapback/schema.q", source }]);
      assert(!invalid.ok && invalid.diagnostics.some((item) => /integer literal|positive integers/.test(item.message)),
        `non-integer/non-positive asset bound compiled: ${JSON.stringify(invalid)}`);
    }
  });

  test("Quarry money and decimal spellings preserve scale through IR and API types", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-money"));
    assert(lowered.ok, `quarry-money refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const schema = JSON.stringify(lowered.project.schema);
    assert(schema.includes('"Money":{"currency":"USD","scale":2}')
      && schema.includes('"Decimal":{"scale":3}'), `Quarry descriptors changed: ${schema}`);
    const add = JSON.stringify(operation(lowered.project.programs, "money.add"));
    assert(add.includes('"Int":250') && add.includes('"Int":1000'),
      `whole-unit Quarry literals did not lower to minor units: ${add}`);
    assert(add.includes('"op":"Add"') && add.includes('"op":"Sub"')
      && add.includes('"op":"Mul"') && add.includes('"builtin":"Min"'),
      `matching money/decimal arithmetic did not reach IR: ${add}`);
    assert(lowered.apiDts.includes('price: Money<"USD", 2>')
      && lowered.apiDts.includes("rate: Decimal<3>")
      && lowered.apiDts.includes('yen?: Money<"JPY", 0>')
      && lowered.apiDts.includes('/** money USD 2 — minor units */ amount: number')
      && lowered.apiDts.includes('/** decimal 3 — minor units */ rate: number'),
    `Quarry branded API types are missing:\n${lowered.apiDts}`);
    const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
    assert(failures.length === 0, `quarry-money did not certify: ${JSON.stringify(failures)}`);

    const compiled = compileFixture(fixtures, "quarry-money", ["schema", "money"]);
    assert(compiled.ok, `quarry-money front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const generated = `${compiled.schema.source}\n${compiled.modules[0]!.source}`;
    assert(generated.includes('t.money("USD")') && generated.includes('t.money("JPY", 0)')
      && generated.includes("t.decimal(3)")
      && generated.includes("price: 2.50") && generated.includes("+ 1.000"),
    `Quarry lowering lost a descriptor or authored literal spelling:\n${generated}`);
  });

  test("Quarry money and decimal refusals are nominal, exact-scale, and sited", async () => {
    const schema = `table values:
  cents: decimal 2
  mills: decimal 3
  amount: money USD
  count: int
  public
  insert <- public
`;
    await withProject({
      "snapback/schema.q": schema,
      "snapback/mixed.q": "query mixed(id: values):\n  row = values[id]! else MISSING\n  return row.cents + row.mills\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok, "mixed Quarry Decimal scales compiled");
      const refusal = result.diagnostics.find((item) => item.code === "E_DECIMAL_SCALE");
      assert(refusal, `mixed-scale refusal was not E_DECIMAL_SCALE: ${JSON.stringify(result)}`);
      assert(refusal.site.startsWith("snapback/mixed.q:") && !refusal.site.includes(".ts:"),
        `mixed-scale refusal did not map to Quarry: ${JSON.stringify(result)}`);
      assert(refusal.rewrite.includes("row.cents + row.mills") && refusal.rewrite.includes("--"),
        `mixed-scale refusal lost its Quarry rewrite: ${refusal.rewrite}`);
    });

    await withProject({
      "snapback/schema.q": schema,
      "snapback/literal.q": "mutation bad():\n  return insert values { cents: 1.234, mills: 1.000, amount: 2.50, count: 1 }\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok, "over-precise Quarry Decimal literal compiled");
      const refusal = result.diagnostics.find((item) => item.code === "E_DECIMAL_SCALE");
      assert(refusal?.site.startsWith("snapback/literal.q:")
        && refusal.rewrite.includes("cents: 1.234") && refusal.rewrite.includes("--"),
      `literal scale refusal lost its Quarry site/rewrite: ${JSON.stringify(result)}`);
    });

    const nominal = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/nominal.q", source: "query bad(amount: money USD, count: int):\n  return amount = count\n" },
    ]);
    assert(!nominal.ok && nominal.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
      && item.message.includes("money USD 2") && item.message.includes("int")),
    `int/money comparison lost its nominal refusal: ${JSON.stringify(nominal)}`);

    const fractionalInt = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/int.q", source: "mutation bad():\n  return insert values { cents: 1.00, mills: 1.000, amount: 2, count: 2.50 }\n" },
    ]);
    assert(!fractionalInt.ok && fractionalInt.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
      && item.message === "int positions take integer literals"),
    `decimal literal entered an int position: ${JSON.stringify(fractionalInt)}`);

    for (const operator of ["/", "%"]) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/divmod.q", source: `query bad(left: money USD, right: money USD):\n  return left ${operator} right\n` },
      ]);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
        && item.message.includes(`does not admit ${operator}`)),
      `Quarry admitted money ${operator}: ${JSON.stringify(result)}`);
    }

    const syntax = compileInline([{ fileName: "snapback/schema.q", source: "table invalid:\n  lower: money usd\n  huge: decimal 19\n  public\n" }]);
    assert(!syntax.ok && syntax.diagnostics.filter((item) => item.code === "E_QUARRY_SYNTAX").length === 2,
      `money currency/decimal scale syntax did not report both refusals: ${JSON.stringify(syntax)}`);
  });

  test("Quarry composite unique-key writes lower through row identity and certify", async () => {
    const compiled = compileFixture(fixtures, "quarry-surface", ["schema", "surface"]);
    assert(compiled.ok, `composite write front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const source = compiled.modules[0]!.source;
    const update = generatedOperation(source, "updateKeyedRow");
    const upsert = generatedOperation(source, "upsertKeyedRow");
    const authored = generatedOperation(source, "upsertKeyedRowWithId");
    const remove = generatedOperation(source, "deleteKeyedRow");
    const updateKeys = writeKeyNames(update);
    const upsertKeys = writeKeyNames(upsert);
    assert(updateKeys && update.includes(`db.get(keyedRows.byOwnerLabel, [${updateKeys[0]}, ${updateKeys[1]}])`)
      && update.includes('db.require(__q_writeRow_')
      && update.includes("db.update(keyedRows, __q_writeRow_")
      && update.includes("{ value: args.value }")
      && occurrences(update, "args.owner") === 1 && occurrences(update, "args.label") === 1,
    `composite update did not bind its address once, elide same-key fields, and write by row id:\n${update}`);
    assert(upsertKeys && upsert.includes(`db.get(keyedRows.byOwnerLabel, [${upsertKeys[0]}, ${upsertKeys[1]}])`)
      && upsert.includes("?.id ?? ctx.newId()")
      && upsert.includes("db.upsert(keyedRows, __q_upsertKey_")
      && upsert.includes(`owner: ${upsertKeys[0]}, label: ${upsertKeys[1]}`)
      && occurrences(upsert, "args.owner") === 1 && occurrences(upsert, "args.label") === 1,
    `composite upsert did not bind/inject its key columns into the platform scalar db.upsert row:\n${upsert}`);
    assert(authored.includes("?.id ?? ctx.newId()")
      && authored.includes("db.upsert(keyedRows, __q_upsertKey_")
      && !authored.includes("UPSERT_ID_"),
    `migrated alternate upsert did not keep the present id or mint on absence:\n${authored}`);
    assert(remove.includes("db.get(keyedRows.byOwnerLabel, [__q_writeKey1_")
      && remove.includes('db.require(__q_writeRow_')
      && remove.includes("db.delete(keyedRows, __q_writeRow_"),
    `composite delete did not resolve and write by row id:\n${remove}`);
    for (const line of source.split("\n").filter((line) => line.includes("__q_writeRow_") || line.includes("__q_upsertKey_") || line.includes("__q_writeKey"))) {
      assert(/\/\/ q:snapback\/surface\.q:\d+:\d+$/.test(line), `generated indexed-write statement lost its .q site: ${line}`);
    }

    const lowered = await lowerProject(resolve(fixtures, "quarry-surface"));
    assert(lowered.ok, `composite write project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const names = [
      "surface.updateKeyedRow", "surface.upsertKeyedRow", "surface.upsertKeyedRowWithId",
      "surface.deleteKeyedRow", "surface.updateKeyedRowById", "surface.deleteKeyedRowById",
    ];
    const failures = rustCheck(names.map((name) => operation(lowered.project.programs, name)), "synthetic", lowered.project.schema)
      .filter((item) => item.error);
    assert(failures.length === 0, `composite writes did not certify: ${JSON.stringify(failures)}`);
  });

  test("Quarry addressed key columns refuse disagreement and paste drop-field rewrites", async () => {
    const schema = "table keyedRows:\n  owner: principal\n  label: text <=40\n  value: int\n  unique owner, label\n  public\n";
    const badUpsert = "upsert keyedRows[owner, label] { owner: viewer, label, value }";
    const badUpdate = "update keyedRows[owner, label] { owner, label: 'other', value }";
    const operations = `mutation upsertMismatch(owner: principal, label: text <=40, value: int):
  ${badUpsert}

mutation updateMismatch(owner: principal, label: text <=40, value: int):
  ${badUpdate}
`;
    const refused = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: operations },
    ]);
    assert(!refused.ok, "disagreeing addressed key fields compiled");
    const diagnostics = refused.diagnostics.filter((item) => item.code === "E_QUARRY_TYPE");
    assert(diagnostics.length === 2, `addressed-key check did not report both failures: ${JSON.stringify(refused)}`);
    const upsert = diagnostics.find((item) => item.message.startsWith("upsert may not"));
    const update = diagnostics.find((item) => item.message.startsWith("update may not"));
    assert(upsert?.family === "quarry" && upsert.site === "snapback/ops.q:2:36"
      && upsert.rewrite === "-- upsert keyedRows[owner, label] { label, value }" && upsert.guide === "quarry/types",
    `upsert mismatch lost its code/family/field site/drop-field rewrite/guide: ${JSON.stringify(upsert)}`);
    assert(update?.family === "quarry" && update.site === "snapback/ops.q:5:43"
      && update.rewrite === "-- update keyedRows[owner, label] { owner, value }" && update.guide === "quarry/types",
    `update mismatch lost its code/family/field site/drop-field rewrite/guide: ${JSON.stringify(update)}`);

    const repaired = operations
      .replace(badUpsert, upsert.rewrite.slice(3))
      .replace(badUpdate, update.rewrite.slice(3));
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": repaired }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `addressed-key rewrites did not paste/lower: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `addressed-key rewrites did not certify: ${JSON.stringify(failures)}`);
    });
  });

  test("Quarry upsert rows refuse every authored id with a drop-field rewrite", async () => {
    const schema = "table keyedRows:\n  owner: principal\n  label: text <=40\n  value: int\n  unique owner, label\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n";
    const module = "mutation bump(owner: principal, label: text <=40, value: int):\n  upsert keyedRows[owner, label] { id: new, value }\n  return true\n";
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/keyed.q", source: module },
    ]);
    assert(!compiled.ok, "id: new upsert compiled");
    const diagnostic = compiled.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
    assert(diagnostic?.site === "snapback/keyed.q:2:36"
      && diagnostic.message.includes("upsert rows may not name id")
      && diagnostic.rewrite === "-- upsert keyedRows[owner, label] { value }",
    `authored upsert id lost its field site and drop-field rewrite: ${JSON.stringify(compiled)}`);
    const repaired = module.replace("upsert keyedRows[owner, label] { id: new, value }", diagnostic!.rewrite.slice(3));
    const fixed = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/keyed.q", source: repaired },
    ]);
    assert(fixed.ok && fixed.modules[0]!.source.includes("?.id ?? ctx.newId()"),
      `drop-field rewrite did not restore the absent insert branch: ${JSON.stringify(fixed)}`);
  });

  test("Quarry Clique M1-M3 plus Pay regression fixture lowers and certifies all 38 operations", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-clique"));
    assert(lowered.ok, `Quarry Clique refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    assert(lowered.project.programs.length === 38,
      `Quarry Clique program count changed to ${lowered.project.programs.length}`);
    assert(JSON.stringify(lowered.project.programs.map((program) => program.name).sort()) === JSON.stringify([
      "chat.addMember", "chat.chatThread", "chat.convMembers",
      "chat.conversation", "chat.createGroup", "chat.leaveGroup", "chat.markDelivered",
      "chat.markRead", "chat.myConversations", "chat.promoteAdmin", "chat.removeMember",
      "chat.send", "chat.startDm", "social.createPost", "social.createProfile",
      "pay.addExpense", "pay.convExpenses", "pay.expenseShares", "pay.myBalance", "pay.myLedger",
      "pay.myOpenShares", "pay.sendMoney", "pay.settleShare",
      "social.createReply", "social.followingFeed", "social.globalFeed", "social.listUsers",
      "social.me", "social.myFeedMarks",
      "social.myFollowing", "social.myLikes", "social.profile", "social.profileByHandle",
      "social.thread", "social.toggleFollow", "social.toggleLike", "social.toggleRepost",
      "social.updateProfile",
    ].sort()), "Quarry Clique operation inventory changed");
    const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema)
      .filter((item) => item.error);
    assert(failures.length === 0, `Quarry Clique did not certify: ${JSON.stringify(failures)}`);
  });

  test("Quarry Clique nested row shapes use selected column widths", async () => {
    const schema = readFileSync(resolve(fixtures, "quarry-clique/snapback/schema.q"), "utf8");
    const operations = `query focused(c: conversations):
  require exists members[c, viewer] else NOT_MEMBER
  return expenses[c] last 20 by byConv { *, payerProfile: users[principal = .payer] { displayName, handle }, shares: shares[c, .id] first 50 by byConvExpense { id, debtor, amount, settled, settledAt, debtorProfile: users[principal = .debtor] { displayName, handle } } }

query spread(c: conversations):
  require exists members[c, viewer] else NOT_MEMBER
  return expenses[c] last 20 by byConv { *, payerProfile: users[principal = .payer] { displayName, handle }, shares: shares[c, .id] first 50 by byConvExpense { *, debtorProfile: users[principal = .debtor] { displayName, handle } } }
`;
    await withProject({ "snapback/schema.q": schema, "snapback/row-width.q": operations }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `Clique row-width scratch project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
      const focused = checked.find((item) => item.program === "row-width.focused")!;
      assert(focused.error === null && focused.certificate?.max_output_bytes === 822_692
        && focused.certificate.max_closure_bytes === 821_450,
      `focused Clique shape did not certify at its pinned bounds: ${JSON.stringify(focused)}`);

      const spread = checked.find((item) => item.program === "row-width.spread")!;
      assert(spread.certificate === null && spread.error?.code === "E_BOUND"
        && spread.error.message.startsWith("output bytes 1820692 exceeds ceiling 1048576")
        && spread.error.rewrite.includes("shares: []"),
      `Clique spread did not retain its pinned output refusal: ${JSON.stringify(spread)}`);

      const raised = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema, {
        examined: 10_240,
        index_entries: 10_240,
        rule_probes: 10_240,
        steps: 1_000_000,
        heap_bytes: 8 * 1024 * 1024,
        output_bytes: 32 * 1024 * 1024,
        closure_bytes: 4 * 1024 * 1024,
        write_rows: 2_048,
      }).find((item) => item.program === "row-width.spread")!;
      assert(raised.error === null && raised.certificate?.max_output_bytes === 1_820_692
        && raised.certificate.max_closure_bytes === 1_879_850,
      `raised-ceiling Clique spread changed: ${JSON.stringify(raised)}`);
      // Four-byte text pricing makes the complete expense/share rows 1,098/1,426;
      // both 20 × 50 figures are direct pins from the real certifier.
    });
  });

  test("Quarry effects, maintains, aggregate sugar, returns, objects, and count reach IR", async () => {
    const chat = await lowerProject(resolve(fixtures, "quarry-chat"));
    const surface = await lowerProject(resolve(fixtures, "quarry-surface"));
    assert(chat.ok && surface.ok, "Quarry feature fixtures refused");
    const send = operation(chat.project.programs, "messages.send");
    assert(deepKey(send.body, "Emit") && JSON.stringify(send.body).includes('"effect":"delivery.notify"'), "effect/emit did not lower with its qualified effect");
    assert(chat.project.effects[0]?.then === "notifications.recordNotified", "effect then did not resolve the virtual Quarry mutation");
    const countMaintain = chat.project.schema.maintains[0] as any;
    assert(countMaintain.kind === "Count" && countMaintain.source === "messages" && countMaintain.target === "messageCounts", "count maintain changed");
    const sumMaintain = surface.project.schema.maintains[0] as any;
    assert(sumMaintain.kind?.Sum?.of === "value" && sumMaintain.readable, "sum/readable maintain changed");
    assert(deepKey(operation(surface.project.programs, "surface.counterTotal").body, "Get"), "#maintain did not lower to a target-table get");
    assert(deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "Object"), "object literal did not reach IR");
    assert(deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "Builtin")
      && JSON.stringify(operation(surface.project.programs, "surface.visiblePosts")).includes('"builtin":"Len"'), "count(page) did not lower through bounded Len policy");
    for (const name of ["surface.postsAfter", "surface.ensureUser", "surface.firstPositive"]) {
      assert(deepKey(operation(surface.project.programs, name).body, "Return"), `${name} lost a nested explicit return`);
    }
  });

  test("Quarry cursor arguments lower as opaque values and certify a result-page site", async () => {
    const schema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at, id\n  public\n";
    const module = `query page(author: principal, c: cursor ?):
  return posts[author] after c first 3 by byAuthorAt

query aliased(author: principal, c: cursor ?):
  position = c
  return posts[author] after position first 3 by byAuthorAt
`;
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: module },
    ]);
    assert(compiled.ok, `opaque cursor front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const source = compiled.modules[0]!.source;
    assert(source.includes("c: t.optional(t.cursor())") && source.includes("after: args.c")
      && source.includes("opaqueCursor: true"), `cursor did not preserve its opaque lowering:\n${source}`);

    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `opaque cursor project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const program = operation(lowered.project.programs, "ops.page");
      const aliased = operation(lowered.project.programs, "ops.aliased");
      assert(JSON.stringify(program.args.c) === JSON.stringify({ Optional: "Cursor" })
        && program.result_page_site === "ops.page.0", `cursor IR/certificate provenance changed: ${JSON.stringify(program)}`);
      const checked = rustCheck([program, aliased], "synthetic", lowered.project.schema);
      assert(checked.every((item) => !item.error)
        && (checked[0]!.certificate as any).result_page_site?.site === "ops.page.0",
      `opaque pages did not certify: ${JSON.stringify(checked)}`);
      assert(JSON.stringify(aliased.body).includes('"Variable":"position"'),
        `cursor expression alias was not preserved for preflight: ${JSON.stringify(aliased)}`);
    });
  });

  test("Quarry range modifiers refuse permutations and repeats with the complete canonical read", () => {
    const schema = "table posts:\n  at: time\n  by byAt: at, id\n  public\n";
    const cases = [
      {
        name: "permutation",
        source: "query page(at: time, c: cursor):\n  return posts[at] by byAt after c first 3\n",
        rewrite: "-- posts[at] after c first 3 by byAt",
      },
      {
        name: "double by",
        source: "query page(at: time):\n  return posts[at] first 3 by byAt by byId\n",
        rewrite: "-- posts[at] first 3 by byAt",
      },
    ];
    for (const item of cases) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: item.source },
      ]);
      const refusal = !result.ok && result.diagnostics.find((diagnostic) => diagnostic.code === "E_QUARRY_SYNTAX");
      assert(refusal && refusal.rewrite === item.rewrite,
        `${item.name} did not receive its canonical read rewrite: ${JSON.stringify(result)}`);
      const repaired = item.source.replace(item.source.split("\n")[1]!.trim().slice("return ".length), refusal.rewrite.slice(3));
      const fixed = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: repaired },
      ]);
      assert(fixed.ok, `${item.name} canonical rewrite did not compile: ${fixed.ok ? "" : diagnosticsText(fixed.diagnostics)}`);
    }
  });

  test("Quarry refuses before with a forward after rewrite", () => {
    const schema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at, id\n  public\n";
    const scalar = "query page(author: principal, c: cursor ?):\n  return posts[author] before c last 3 by byAuthorAt\n";
    const refused = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: scalar },
    ]);
    assert(!refused.ok, "before remained in the Quarry grammar");
    const diagnostic = refused.diagnostics.find((item) => item.code === "E_QUARRY_UNSUPPORTED");
    assert(diagnostic?.family === "quarry" && diagnostic.site.startsWith("snapback/ops.q:2:")
      && diagnostic.rewrite.includes("use after c"), `before refusal lost site/rewrite: ${JSON.stringify(refused)}`);
  });

  test("Quarry result-page provenance covers bindings, shapes, merges, nesting, branches, and consumers", async () => {
    const schema = "table posts:\n  author: principal\n  at: time\n  by byAt: at, id\n  by byAuthorAt: author, at, id\n  public\n";
    const operations = `query direct(c: cursor ?):
  page = posts[] after c first 3 by byAt
  return page

query shaped(c: cursor ?):
  return posts[] after c first 3 by byAt { id, at }

query merged(c: cursor ?, other: principal):
  return merge posts after c first 3 by byAuthorAt:
    [viewer]
    [other]

query nested(c: cursor ?):
  page = posts[] after c first 3 by byAt
  return { rows: page }

query branched(which: bool, c: cursor ?):
  if which:
    return posts[] after c first 3 by byAt
  return posts[] after c first 3 by byAt

query consumed(c: cursor ?):
  page = posts[] after c first 3 by byAt
  for post in page:
    require post.id = post.id else NEVER
  return []
`;
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": operations }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `page provenance fixture was refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `page provenance failed certification: ${JSON.stringify(failures)}`);
      for (const name of ["ops.direct", "ops.shaped", "ops.merged"])
        assert(operation(lowered.project.programs, name).result_page_site, `${name} lost result-page provenance`);
      for (const name of ["ops.nested", "ops.branched", "ops.consumed"])
        assert(!operation(lowered.project.programs, name).result_page_site, `${name} incorrectly gained result-page provenance`);
      const merged = rustCheck([operation(lowered.project.programs, "ops.merged")], "synthetic", lowered.project.schema)[0]!;
      assert((merged.certificate as any)?.result_page_site?.merge === true, `merge provenance did not name its merge: ${JSON.stringify(merged)}`);
    });
  });

  test("Quarry merge lowers bounded lanes, records its certificate site, and refuses malformed lanes", async () => {
    const chat = await lowerProject(resolve(fixtures, "quarry-chat"));
    assert(chat.ok, `Quarry chat merge refused: ${chat.ok ? "" : diagnosticsText(chat.diagnostics)}`);
    const following = operation(chat.project.programs, "feeds.followingFeed");
    const body = JSON.stringify(following.body);
    assert(body.includes('"DedupeById"') && body.includes('"Sort"') && body.includes('"Slice"'), `merge composition changed: ${body}`);
    const checked = rustCheck(
      [following],
      "synthetic",
      chat.project.schema,
      undefined,
      chat.project.effects as unknown as Array<Record<string, unknown>>,
    );
    assert(checked.length === 1 && !checked[0]!.error, `chat merge did not certify: ${JSON.stringify(checked)}`);
    const certificate = checked[0]!.certificate as any;
    assert(certificate.merge_sites?.length === 1
      && certificate.merge_sites[0].lane_sites.length === 2
      && certificate.merge_sites[0].take === 20,
    `merge certificate site changed: ${JSON.stringify(certificate.merge_sites)}`);
    const beforeShapes = certificate.read_sites
      .filter((site: any) => site.table !== "profiles")
      .reduce((total: number, site: any) => total + (site.take + 2) * site.max_calls, 0);
    assert(beforeShapes === 1174, `following feed examined ${beforeShapes} before shaped point reads, expected 1174`);

    const schema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at, id\n  public\n";
    const cases = [
      ["empty", "query q():\n  return merge posts first 3 by byAuthorAt:\n", "E_QUARRY_SYNTAX"],
      ["unequal", "query q():\n  return merge posts first 3 by byAuthorAt:\n    [viewer]\n    [viewer, now]\n", "E_QUARRY_TYPE"],
      ["duplicate", "query q():\n  return merge posts first 3 by byAuthorAt:\n    [viewer]\n    [viewer]\n", "E_QUARRY_TYPE"],
      ["missing by", "query q():\n  return merge posts first 3:\n    [viewer]\n", "E_QUARRY_SYNTAX"],
    ] as const;
    for (const [name, source, code] of cases) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source },
      ]);
      assert(!result.ok && result.diagnostics.some((item) => item.code === code), `${name} merge compiled: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry cursors require a total index and pageable merges end in id", () => {
    const nonTotalSchema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at\n  public\n";
    const nonTotalOps = "query page(c: cursor ?):\n  return posts[] after c first 3 by byAuthorAt\n";
    const nonTotal = compileInline([
      { fileName: "snapback/schema.q", source: nonTotalSchema },
      { fileName: "snapback/ops.q", source: nonTotalOps },
    ]);
    assert(!nonTotal.ok, "cursor on a non-total Quarry index compiled");
    const indexRefusals = nonTotal.diagnostics.filter((item) => item.code === "E_QUARRY_TYPE");
    assert(indexRefusals.length === 1 && indexRefusals[0]!.site.startsWith("snapback/schema.q:")
      && indexRefusals[0]!.message.includes("snapback/ops.q:2:")
      && indexRefusals[0]!.rewrite === "-- by byAuthorAt: author, at, id",
    `non-total cursor lost its exact Quarry rewrite: ${JSON.stringify(nonTotal)}`);
    assert(nonTotal.diagnostics.every((item) => item.code !== "E_ARGS_CURSOR_INDEX"),
      `platform cursor-index refusal leaked through Quarry: ${JSON.stringify(nonTotal)}`);
    const totalSchemaRepair = nonTotalSchema.replace("by byAuthorAt: author, at", indexRefusals[0]!.rewrite.slice(3));
    const afterIndexRepair = compileInline([
      { fileName: "snapback/schema.q", source: totalSchemaRepair },
      { fileName: "snapback/ops.q", source: nonTotalOps },
    ]);
    assert(afterIndexRepair.ok, `total-index cursor repair did not compile: ${JSON.stringify(afterIndexRepair)}`);
    const mergeSchema = "table posts:\n  author: principal\n  kind: text <=20\n  unique byActorKind: author, kind\n  public\n";
    const merge = compileInline([
      { fileName: "snapback/schema.q", source: mergeSchema },
      { fileName: "snapback/ops.q", source: "query feed(c: cursor ?):\n  return merge posts after c first 3 by byActorKind:\n    [viewer]\n" },
    ]);
    const mergeRefusal = merge.ok ? undefined : merge.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
    assert(mergeRefusal !== undefined && mergeRefusal.site.startsWith("snapback/schema.q:")
      && mergeRefusal.rewrite.includes("author, kind, id"), `merge id refusal lost site/rewrite: ${JSON.stringify(merge)}`);
  });

  test("Quarry alternate-key unreadable updates are NOT_FOUND while direct-id updates are E_RULE", async () => {
    const qSchema = `table secrets:
  owner: principal
  label: text <=40
  unique byOwner: owner
  read <- .owner = viewer
  insert <- allow
  update <- .owner = viewer
`;
    const operations = `mutation alternate(owner: principal, label: text <=40):
  update secrets[owner] { label }
  return true

mutation direct(id: secrets, label: text <=40):
  update secrets[id] { label }
  return true
`;
    await withProject({
      "snapback/schema.q": qSchema,
      "snapback/ops.q": operations,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `unreadable update pair did not lower: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error),
        "unreadable update pair did not certify");
      const receipt: ClosureReceipt = {
        rows: [{ table: "secrets", id: "secret-1", row: { Row: {
          id: { Id: "secret-1" }, owner: { Id: "owner-1" }, label: { String: "hidden" },
        } } }],
        ranges: [], absences: [], verdicts: [],
      };
      const context = (args: Context["args"]): Context => ({
        viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args, now: 1, new_ids: [], read_time: 1,
      });
      const executeCode = (program: Program, args: Context["args"]): string => {
        const store = new ClientStore(lowered.project.schema, receipt);
        try {
          store.applyMutation(program, context(args));
          return "green";
        } catch (error) {
          const refusal = error as { code?: string; authoredCode?: string | null };
          return refusal.authoredCode ? `${refusal.code}:${refusal.authoredCode}` : refusal.code ?? "unknown";
        }
      };
      assert(executeCode(operation(lowered.project.programs, "ops.alternate"), {
        owner: { Id: "owner-1" }, label: { String: "changed" },
      }) === "E_REQUIRE:NOT_FOUND", "alternate-key unreadable update did not produce E_REQUIRE:NOT_FOUND");
      assert(executeCode(operation(lowered.project.programs, "ops.direct"), {
        id: { Id: "secret-1" }, label: { String: "changed" },
      }) === "E_RULE", "direct-id unreadable update did not produce E_RULE");
    });
  });

  test("Quarry alternate-key update and upsert id fields are front-end refusals", async () => {
    const compiled = compileFixture(fixtures, "quarry-update-id", ["schema", "update"]);
    assert(!compiled.ok, "alternate-key update naming id compiled");
    const compileDiagnostics = compiled.diagnostics.filter((item) => item.code === "E_QUARRY_TYPE");
    assert(compileDiagnostics.length === 2
      && compileDiagnostics.some((item) => item.site.startsWith("snapback/update.q:")
        && item.rewrite === '-- update keyedRows[owner] { label: "changed" }')
      && compileDiagnostics.some((item) => item.site.startsWith("snapback/update.q:")
        && item.rewrite === '-- upsert keyedRows[owner] { label: "changed" }'),
    `update id front-end refusal changed: ${JSON.stringify(compiled)}`);

    const lowered = await lowerProject(resolve(fixtures, "quarry-update-id"));
    assert(!lowered.ok, "alternate-key update naming id lowered");
    assert(lowered.diagnostics.length === 2 && lowered.diagnostics.every((item) => item.code === "E_QUARRY_TYPE"),
    `update id leaked platform diagnostics: ${JSON.stringify(lowered)}`);
    assert(lowered.diagnostics.every((item) => item.code !== "E_SCHEMA_ID_RESERVED" && item.code !== "E_OPAQUE"),
      `update id retained platform leakage: ${JSON.stringify(lowered)}`);
  });

  test("Quarry maps platform refusals and operation source sites back to .q", async () => {
    const qSchema = readFileSync(resolve(fixtures, "quarry-chat/snapback/schema.q"), "utf8");
    const effect = readFileSync(resolve(fixtures, "quarry-chat/snapback/delivery.ts"), "utf8");
    const bad = `effect notify from delivery\n\nquery bad():\n  emit notify { to: 'somebody', body: 'hello' }\n  return null\n`;
    await withProject({
      "snapback/schema.q": qSchema,
      "snapback/delivery.ts": effect,
      "snapback/bad.q": bad,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(!lowered.ok, "emit in a Quarry query unexpectedly lowered");
      const refusal = lowered.diagnostics.find((item) => item.code === "E_EMIT_IN_QUERY");
      assert(refusal?.site === "snapback/bad.q:4:3", `generated refusal site was not mapped to the emit: ${refusal?.site}`);
      assert(refusal.rewrite === bad, "generated refusal rewrite was not Quarry source");
    });

    const chat = await lowerProject(resolve(fixtures, "quarry-chat"));
    assert(chat.ok && chat.sources["messages.send"]?.file === "snapback/messages.q", "certification source map did not point at messages.q");
    assert((chat.sources["messages.send"]?.col ?? 0) > 0, "certification source map lost the Quarry column");
  });

  test("Quarry parser recovers and every refusal envelope is complete", () => {
    const syntax = compileFixture(fixtures, "quarry-invalid", ["schema", "syntax"]);
    assert(!syntax.ok, "invalid syntax fixture unexpectedly compiled");
    assert(syntax.diagnostics.filter((item) => item.code === "E_QUARRY_SYNTAX").length >= 3,
      `parser stopped before reporting all syntax defects: ${diagnosticsText(syntax.diagnostics)}`);

    const cases: Array<[string, string]> = [
      ["syntax", "E_QUARRY_SYNTAX"],
      ["unknown", "E_QUARRY_UNKNOWN"],
      ["ambiguous", "E_QUARRY_AMBIGUOUS"],
      ["unsupported", "E_QUARRY_UNSUPPORTED"],
      ["placement", "E_QUARRY_PLACEMENT"],
    ];
    for (const [file, code] of cases) {
      const result = compileFixture(fixtures, "quarry-invalid", ["schema", file]);
      assert(!result.ok, `${file} unexpectedly compiled`);
      const matching = result.diagnostics.filter((diagnostic) => diagnostic.code === code);
      const item = matching[0];
      assert(item, `${file} did not report ${code}: ${diagnosticsText(result.diagnostics)}`);
      const minimum = code === "E_QUARRY_AMBIGUOUS" ? 1 : 2;
      assert(matching.length >= minimum, `${file} stopped before ${minimum} ${code} refusals: ${diagnosticsText(result.diagnostics)}`);
      assert(item.family === "quarry" && item.site.includes(`/${file}.q:`), `${code} lost Quarry family/site`);
      assert(item.rewrite.startsWith("-- ") && item.guide.startsWith("quarry/"), `${code} lost Quarry rewrite/guide`);
      if (code === "E_QUARRY_UNSUPPORTED") assert(item.message.includes("not part of the Snapback 2 platform"), "unsupported wording drifted back to subset language");
      if (code === "E_QUARRY_AMBIGUOUS") assert(item.rewrite.includes(" by "), `ambiguous rewrite lost its explicit-index repair: ${item.rewrite}`);
    }
  });

  test("Quarry conditions require Boolean operands and null is an explicit presence test", async () => {
    const schema = "table rows:\n  value: int\n  seenAt: time ?\n  public\n";
    for (const condition of ["value", "seenAt"]) {
      const refused = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: `query bad(${condition}: ${condition === "value" ? "int" : "time ?"}):\n  if ${condition}:\n    return true\n  return false\n` },
      ]);
      assert(!refused.ok && refused.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"),
        `non-Boolean if condition compiled: ${JSON.stringify(refused)}`);
      if (condition === "seenAt") assert(refused.diagnostics.some((item) => item.rewrite.includes("seenAt != null")),
        `optional condition lost its presence-test rewrite: ${JSON.stringify(refused)}`);
    }
    const accepted = await withProject({
      "snapback/schema.q": schema,
      "snapback/ops.q": "query present(seenAt: time ?):\n  if seenAt != null:\n    return true\n  return false\n\nquery field(rowId: rows):\n  row = rows[rowId]! else MISSING\n  return row.seenAt != null\n",
    }, (root) => lowerProject(root));
    assert(accepted.ok, `presence tests refused: ${accepted.ok ? "" : diagnosticsText(accepted.diagnostics)}`);
  });

  test("Quarry optional-column equality and inequality execute with total semantics", async () => {
    const schema = "table rows:\n  value: int ?\n  public\n";
    const module = `query equal(left: rows, right: rows):
  a = rows[left]! else LEFT_MISSING
  b = rows[right]! else RIGHT_MISSING
  return a.value = b.value

query different(left: rows, right: rows):
  a = rows[left]! else LEFT_MISSING
  b = rows[right]! else RIGHT_MISSING
  return a.value != b.value
`;
    await withProject({ "snapback/schema.q": schema, "snapback/compare.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `total-equality project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error),
        "total-equality programs did not certify through the Rust checker");
      const receipt: ClosureReceipt = {
        rows: [
          { table: "rows", id: "absent-a", row: { Row: { id: { Id: "absent-a" } } } },
          { table: "rows", id: "absent-b", row: { Row: { id: { Id: "absent-b" } } } },
          { table: "rows", id: "present-a", row: { Row: { id: { Id: "present-a" }, value: { Int: 7 } } } },
          { table: "rows", id: "present-b", row: { Row: { id: { Id: "present-b" }, value: { Int: 7 } } } },
        ],
        ranges: [], absences: [], verdicts: [],
      };
      const context = (left: string, right: string): Context => ({
        viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args: { left: { Id: left }, right: { Id: right } }, now: 1, new_ids: [], read_time: 1,
      });
      const cases: Array<[string, string, boolean]> = [
        ["absent-a", "absent-b", true],
        ["absent-a", "present-a", false],
        ["present-a", "absent-a", false],
        ["present-a", "present-b", true],
      ];
      for (const [left, right, equal] of cases) {
        const store = new ClientStore(lowered.project.schema, receipt);
        const actualEqual = store.reexecute(operation(lowered.project.programs, "compare.equal"), context(left, right)).execution.result;
        const actualDifferent = store.reexecute(operation(lowered.project.programs, "compare.different"), context(left, right)).execution.result;
        assert(JSON.stringify(actualEqual) === JSON.stringify({ Bool: equal }),
          `${left} = ${right} returned ${JSON.stringify(actualEqual)} instead of ${equal}`);
        assert(JSON.stringify(actualDifferent) === JSON.stringify({ Bool: !equal }),
          `${left} != ${right} returned ${JSON.stringify(actualDifferent)} instead of ${!equal}`);
      }
    });
  });

  test("Quarry ordered comparison refuses an optional operand with an assertion rewrite", () => {
    const source = "query older(id: rows, cutoff: time):\n  row = rows[id]! else MISSING\n  return row.seenAt < cutoff\n";
    const result = compileInline([
      { fileName: "snapback/schema.q", source: "table rows:\n  seenAt: time ?\n  public\n" },
      { fileName: "snapback/ops.q", source },
    ]);
    const refusal = result.ok ? undefined : result.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
    assert(refusal?.rewrite === "-- row.seenAt! < cutoff" && refusal.site === "snapback/ops.q:3:21",
      `optional ordered comparison lost its exact rewrite/site: ${JSON.stringify(result)}`);
  });

  test("Quarry if presence tests narrow only the then-branch binding identity", async () => {
    const schema = "table members:\n  lastReadAt: time ?\n  public\n";
    const watermark = `query reached(id: members, upTo: time):
  m = members[id]! else NOT_MEMBER
  if m.lastReadAt != null:
    if m.lastReadAt >= upTo:
      return true
  return false

query direct(value: time ?, upTo: time):
  if value != null:
    return value >= upTo
  return false
`;
    await withProject({ "snapback/schema.q": schema, "snapback/watermark.q": watermark }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `narrowed watermark refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const program = operation(lowered.project.programs, "watermark.reached");
      const generated = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/watermark.q", source: watermark },
      ]);
      assert(generated.ok && occurrences(generated.modules[0]!.source, "db.require(") === 1
        && !generated.modules[0]!.source.includes("lastReadAt!") && !generated.modules[0]!.source.includes("args.value!"),
        `if narrowing emitted an assertion: ${JSON.stringify(generated)}`);
      const store = new ClientStore(lowered.project.schema, {
        rows: [{ table: "members", id: "m1", row: { Row: { id: { Id: "m1" }, lastReadAt: { Int: 12 } } } }],
        ranges: [], absences: [], verdicts: [],
      });
      const execution = store.reexecute(program, {
        viewer: "viewer", principal_kind: "user", auth_epoch: 1,
        args: { id: { Id: "m1" }, upTo: { Int: 10 } }, now: 1, new_ids: [], read_time: 1,
      });
      assert(JSON.stringify(execution.execution.result) === JSON.stringify({ Bool: true }),
        `narrowed watermark did not execute: ${JSON.stringify(execution)}`);
      const directExecution = store.reexecute(operation(lowered.project.programs, "watermark.direct"), {
        viewer: "viewer", principal_kind: "user", auth_epoch: 1,
        args: { value: { Int: 12 }, upTo: { Int: 10 } }, now: 1, new_ids: [], read_time: 1,
      });
      assert(JSON.stringify(directExecution.execution.result) === JSON.stringify({ Bool: true }),
        `narrowed bound name did not execute: ${JSON.stringify(directExecution)}`);
    });

    const refusing = [
      ["shadow", "query bad(x: time ?, y: time, z: time ?):\n  if x != null:\n    x = z\n    return x >= y\n  return false\n"],
      ["else", "query bad(x: time ?, y: time):\n  if x != null:\n    return true\n  else:\n    return x >= y\n"],
      ["conjunction", "query bad(x: time ?, y: time):\n  return x != null and x >= y\n"],
    ] as const;
    for (const [name, source] of refusing) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: `snapback/${name}.q`, source },
      ]);
      const diagnostic = result.ok ? undefined : result.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
      assert(diagnostic?.rewrite.includes("x)! >= y"), `${name} unexpectedly retained narrowing: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry where emits the schema index and indexed-prefix repairs", () => {
    const result = compileInline([
      { fileName: "snapback/schema.q", source: "table posts:\n  author: principal\n  visible: bool\n  at: time\n  by byAuthorAt: author, at, id\n  public\n" },
      { fileName: "snapback/posts.q", source: "query byAuthor():\n  return posts[viewer] first 5 by byAuthorAt where .visible = true\n" },
    ]);
    const refusals = result.ok ? [] : result.diagnostics.filter((item) => item.code === "E_QUARRY_UNSUPPORTED");
    assert(refusals.length === 2
      && refusals.some((item) => item.site.startsWith("snapback/schema.q:")
        && item.rewrite === "-- by byAuthorVisibleAt: author, visible, at, id")
      && refusals.some((item) => item.site.startsWith("snapback/posts.q:")
        && item.rewrite === "-- posts[viewer, true] first 5 by byAuthorVisibleAt"),
    `where did not produce its two sited repairs: ${JSON.stringify(result)}`);

    const reused = compileInline([
      { fileName: "snapback/schema.q", source: "table posts:\n  author: principal\n  visible: bool\n  at: time\n  by byAuthorAt: author, at, id\n  by byAuthorVisibleAt: author, visible, at, id\n  public\n" },
      { fileName: "snapback/posts.q", source: "query byAuthor():\n  return posts[viewer] first 5 by byAuthorAt where .visible = true\n" },
    ]);
    const reusedRefusals = reused.ok ? [] : reused.diagnostics.filter((item) => item.code === "E_QUARRY_UNSUPPORTED");
    assert(reusedRefusals.length === 2
      && reusedRefusals.some((item) => item.message.includes("reuses posts.byAuthorVisibleAt"))
      && reusedRefusals.some((item) => item.rewrite === "-- posts[viewer, true] first 5 by byAuthorVisibleAt"),
    `where did not reuse a compatible index: ${JSON.stringify(reused)}`);

    const fallbacks = [
      [
        "non-conjunction",
        "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at, id\n  public\n",
        "return posts[viewer] first 5 by byAuthorAt where .author != viewer",
      ],
      [
        "non-indexable",
        "table posts:\n  author: principal\n  metadata: json <=100\n  at: time\n  by byAuthorAt: author, at, id\n  public\n",
        "return posts[viewer] first 5 by byAuthorAt where .metadata = {}",
      ],
      [
        "uncertain index",
        "table posts:\n  author: principal\n  visible: bool\n  at: time\n  by byAuthorAt: author, at, id\n  by byAuthorVisibleAt: author, visible, at, id\n  public\n",
        "return posts[viewer] first 5 where .visible = true",
      ],
    ] as const;
    for (const [name, fallbackSchema, statement] of fallbacks) {
      const fallback = compileInline([
        { fileName: "snapback/schema.q", source: fallbackSchema },
        { fileName: "snapback/posts.q", source: `query byAuthor():\n  ${statement}\n` },
      ]);
      const refusal = fallback.ok ? undefined : fallback.diagnostics.find((item) => item.code === "E_QUARRY_UNSUPPORTED");
      assert(refusal?.rewrite.includes("index whose prefix pins the predicate")
        && refusal.rewrite.includes("table invariant (after insert <- exists ...)")
        && refusal.rewrite.includes("merge for a fan-in feed"),
      `${name} where lost its honest refusal: ${JSON.stringify(fallback)}`);
    }
  });

  test("Quarry rule binders use focal dot and two-binding updates retain row images", async () => {
    for (const rule of ["read (r, extra) <- allow", "insert (r, extra) <- allow", "delete (r, extra) <- allow", "update (old, next, extra) <- allow"]) {
      const result = compileInline([{ fileName: "snapback/schema.q", source: `table rows:\n  value: int\n  ${rule}\n` }]);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_QUARRY_SYNTAX" && item.message.includes("named bindings")),
        `invalid rule arity compiled: ${rule}: ${JSON.stringify(result)}`);
    }
    const named = compileInline([{
      fileName: "snapback/schema.q",
      source: "table rows:\n  value: int\n  update next <- next.value = 1\n",
    }]);
    const namedRefusal = named.ok ? undefined : named.diagnostics.find((item) => item.code === "E_QUARRY_SYNTAX");
    assert(namedRefusal?.rewrite === "-- update <- (.value = 1)",
      `named single-row rule lost its dot rewrite: ${JSON.stringify(named)}`);
    const oneRow = compileInline([{
      fileName: "snapback/schema.q",
      source: "table rows:\n  value: int\n  update <- .value = 1\n",
    }]);
    assert(oneRow.ok, `focal one-row update refused: ${oneRow.ok ? "" : diagnosticsText(oneRow.diagnostics)}`);
    await withProject({
      "snapback/schema.q": "table rows:\n  value: int\n  read <- allow\n  update (old, next) <- old.value != next.value\n",
      "snapback/rows.q": "query one(id: rows):\n  return rows[id]\n",
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `two-binding update refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const rule = JSON.stringify((lowered.project.schema.tables.rows as any).rules.update);
      assert(rule.includes("OldField") && rule.includes("NextField"), `update row images were not retained: ${rule}`);
    });
  });

  test("Quarry maintain readable rules are typed against the materialized target", () => {
    const accepted = compileInline([{ fileName: "snapback/schema.q", source: "table source:\n  group: text <=20\n  body: text <=50\n  public\n\nmaintain totals = count source by group:\n  read <- allow\n  readable <- .value = 0\n" }]);
    assert(accepted.ok, `target value readable rule refused: ${accepted.ok ? "" : diagnosticsText(accepted.diagnostics)}`);
    const refused = compileInline([{ fileName: "snapback/schema.q", source: "table source:\n  group: text <=20\n  body: text <=50\n  public\n\nmaintain totals = count source by group:\n  read <- allow\n  readable <- .body = ''\n" }]);
    assert(!refused.ok && refused.diagnostics.some((item) => item.message.includes("body")),
      `source-only readable field compiled: ${JSON.stringify(refused)}`);
  });

  test("Quarry result annotations are refused because results are inferred", () => {
    const result = compileInline([
      { fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n" },
      { fileName: "snapback/ops.q", source: "query wrong() -> int:\n  return 'x'\n" },
    ]);
    assert(!result.ok && result.diagnostics.some((item) => item.code === "E_QUARRY_UNSUPPORTED"
      && item.rewrite.includes("results are inferred; remove the annotation")),
    `result annotation compiled or lost its rewrite: ${JSON.stringify(result)}`);
  });

  test("Quarry channel properties recover per line", () => {
    const result = compileInline([{ fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n\nchannel updates():\n  broken one\n  alsoBroken two\n  publish <- public\n  subscribe <- public\n  ttl 1s\n" }]);
    assert(!result.ok && result.diagnostics.filter((item) => item.code === "E_QUARRY_SYNTAX"
      && item.message.includes("unknown channel property")).length === 2,
    `channel parsing stopped before both defects: ${JSON.stringify(result)}`);
  });

  test("Quarry index inference prefers an exact-length probe over a longer prefix", async () => {
    await withProject({
      "snapback/schema.q": `table owners:\n  name: text <=20\n  public\n\ntable items:\n  owner: owners\n  label: text <=20\n  by owner\n  by byOwnerLabel: owner, label\n  public\n`,
      "snapback/items.q": `query exact(owner: owners):\n  return exists items[owner]\n`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `exact-length inference refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    });
  });

  test("Quarry index inference matches known reference tables", async () => {
    await withProject({
      "snapback/schema.q": `table owners:\n  name: text <=20\n  public\n\ntable otherOwners:\n  name: text <=20\n  public\n\ntable lookups:\n  owner: owners\n  otherOwner: otherOwners\n  unique owner\n  unique otherOwner\n  public\n`,
      "snapback/lookups.q": `query byOwner(owner: owners):\n  return lookups[owner]\n`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `ref-table inference refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    });
  });

  test("Quarry refuses every reserved generated binding with a sited rename rewrite", () => {
    const cases = [
      {
        name: "table",
        inputs: [{ fileName: "snapback/schema.q", source: "table delete:\n  value: int\n  public\n" }],
        site: "snapback/schema.q:1:7",
      },
      {
        name: "channel",
        inputs: [{ fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n\nchannel delete():\n  publish <- public\n  subscribe <- public\n  ttl 1s\n" }],
        site: "snapback/schema.q:5:9",
      },
      {
        name: "effect",
        inputs: [
          { fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n" },
          { fileName: "snapback/ops.q", source: "effect delete from notifications\n\nquery okay():\n  null\n" },
        ],
        site: "snapback/ops.q:1:8",
      },
      {
        name: "operation",
        inputs: [
          { fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n" },
          { fileName: "snapback/ops.q", source: "query delete():\n  null\n" },
        ],
        site: "snapback/ops.q:1:7",
      },
    ];
    for (const item of cases) {
      const result = compileInline(item.inputs);
      assert(!result.ok, `reserved ${item.name} binding compiled`);
      const refusal = result.diagnostics.find((diagnostic) => diagnostic.message.includes("reserved"));
      assert(refusal?.site === item.site, `reserved ${item.name} refusal site changed: ${JSON.stringify(result)}`);
      assert(refusal.rewrite.includes("rename") && refusal.rewrite.includes("delete"),
        `reserved ${item.name} refusal lost its rename rewrite: ${refusal.rewrite}`);
    }
    for (const word of ["insert", "update", "upsert"]) {
      const result = compileInline([{ fileName: "snapback/schema.q", source: `table ${word}:\n  value: int\n  public\n` }]);
      const refusal = result.ok ? undefined : result.diagnostics.find((diagnostic) => diagnostic.message.includes("reserved"));
      assert(refusal?.site === "snapback/schema.q:1:7" && refusal.rewrite.includes(word),
        `reserved write word ${word} compiled or lost its rename rewrite: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry validates compound and range keys against the selected index types", () => {
    const schema = "table items:\n  done: bool\n  rank: int\n  public\n  unique done, rank\n  by ranked: done, rank\n";
    const modules = [
      "query wrongCompound():\n  items[true, 'high'] by byDoneRank\n",
      "query wrongRange():\n  items[true, 'high'] first 5 by ranked\n",
    ];
    for (const module of modules) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: module },
      ]);
      assert(!result.ok && result.diagnostics.some((item) => item.message.includes("expects int for rank, got text")),
        `selected-index key mismatch compiled: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry reference-table identity rejects named, inferred, and ranged cross-table keys", () => {
    const schema = "table users:\n  public\n\ntable posts:\n  public\n\ntable todos:\n  owner: users\n  public\n  unique owner\n";
    const operations = [
      "query named(post: posts):\n  todos[owner = post]\n",
      "query inferred(post: posts):\n  todos[post]\n",
      "query ranged(post: posts):\n  todos[post] first 5 by byOwner\n",
    ];
    for (const operation of operations) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: operation },
      ]);
      assert(!result.ok, `cross-table reference key compiled: ${operation}`);
      assert(result.diagnostics.some((item) => item.message.includes("reference to posts") || item.message.includes("no unique index")),
        `cross-table refusal lost its actual type: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry focal detection covers every expression container used by patches", () => {
    const schema = "table users:\n  name: text <=50\n  public\n  by byName: name, id\n\ntable nodes:\n  parent: nodes?\n  public\n\ntable posts:\n  author: users\n  node: nodes\n  authorName: text <=50\n  payload: json <=2048\n  related: logs?\n  flag: bool\n  public\n\ntable logs:\n  post: posts\n  public\n";
    const cases: Array<[string, string, string]> = [
      ["read", "authorName: users[.author].name", "db.get(users"],
      ["array", "payload: [.author]", ".author"],
      ["exists", "flag: exists users[.author]", "db.exists(users"],
      ["walk", "payload: walk nodes[.node] up .parent depth 2", "recurse("],
      ["nested write", "related: insert logs { post: .id }", "db.insert(logs"],
      ["object literal", "payload: { author: .author }", "author:"],
    ];
    for (const [name, field, emitted] of cases) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: `mutation refresh(id: posts):\n  update posts[id] { ${field} }\n` },
      ]);
      assert(result.ok, `${name} focal container was refused: ${result.ok ? "" : diagnosticsText(result.diagnostics)}`);
      const source = result.modules[0]!.source;
      const callback = source.indexOf("(__q_old_");
      assert(callback >= 0 && source.indexOf(emitted, callback) > callback,
        `${name} focal container did not take the row callback path:\n${source}`);
    }
  });

  test("Quarry focal patch preludes remain callback-local and preserve field order", () => {
    const result = compileInline([
      { fileName: "snapback/schema.q", source: "table users:\n  name: text <=50\n  public\n\ntable posts:\n  author: users\n  authorName: text <=50\n  payload: json <=2048\n  public\n" },
      { fileName: "snapback/ops.q", source: "mutation refresh(id: posts):\n  update posts[id] { authorName: users[.author].name, payload: { author: .author } }\n" },
    ]);
    assert(result.ok, `focal patch refused: ${result.ok ? "" : diagnosticsText(result.diagnostics)}`);
    const source = result.modules[0]!.source;
    const callback = source.indexOf("(__q_old_");
    const dereference = source.indexOf("db.get(users", callback);
    const firstField = source.indexOf("const __q_patch_", callback);
    const secondField = source.indexOf("const __q_patch_", firstField + 1);
    const returned = source.indexOf("return {", callback);
    assert(callback >= 0 && firstField > callback && dereference > firstField
      && secondField > firstField && returned > secondField,
    `focal patch evaluation escaped or reordered its callback:\n${source}`);
  });

  test("Quarry shaped pages retain spread/override field types and reference identity", async () => {
    const schema = "table authors:\n  name: text <=50\n  public\n\ntable posts:\n  author: authors\n  public\n  by author\n\ntable copies:\n  name: text <=50\n  public\n";
    const unsafe = "mutation copy():\n  for post in posts[] first 5 by byAuthor { *, author: .author }:\n    insert copies { name: post.author.name }\n  null\n";
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": unsafe }, async (root) => {
      const compiled = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: unsafe },
      ]);
      assert(compiled.ok && compiled.modules[0]!.source.includes("db.get(authors"),
        `shaped reference field was not auto-dereferenced: ${compiled.ok ? compiled.modules[0]!.source : diagnosticsText(compiled.diagnostics)}`);
      const refused = await lowerProject(root);
      assert(!refused.ok && refused.diagnostics.some((item) => item.message.includes("undefined")
        && item.rewrite.includes("! else CODE")),
      `possibly absent shaped read was not refused with a Quarry assertion rewrite: ${JSON.stringify(refused)}`);

      await writeFile(join(root, "snapback/ops.q"), unsafe.replace("post.author.name", "post.author.name! else AUTHOR_MISSING"));
      const asserted = await lowerProject(root);
      assert(asserted.ok, `asserted shaped read refused: ${asserted.ok ? "" : diagnosticsText(asserted.diagnostics)}`);
      assert(JSON.stringify(asserted.project.programs).includes('"table":"authors"'),
        "asserted shaped-page operation lost its authors read site");
    });
  });

  test("Quarry walked rows and shaped page rows stay row/object values", async () => {
    const schema = "table nodes:\n  parent: nodes?\n  name: text <=50\n  public\n  by name\n\ntable copies:\n  name: text <=50\n  public\n";
    const module = "mutation copyWalk(seed: nodes):\n  for ancestor in walk nodes[seed] up .parent depth 3:\n    name = ancestor.name\n  null\n\nmutation copyPage():\n  for node in nodes[] first 3 by byName { * }:\n    name = node.name\n  null\n";
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: module },
    ]);
    assert(compiled.ok, `walk/page front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const source = compiled.modules[0]!.source;
    assert(!source.includes("db.get(nodes, ancestor)") && !source.includes("db.get(nodes, node)"),
      `walked or shaped row was treated as a reference:\n${source}`);
    assert(source.includes("ancestor.name") && source.includes("node.name"), `row fields were not selected directly:\n${source}`);
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `walk/page project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error),
        "walk/page project did not certify");
    });
  });

  test("Quarry mid-body matches discard arm values and accept write-only arms", async () => {
    const schema = "table todos:\n  title: text <=50\n  public\n";
    const module = "mutation touch(id: todos):\n  match todos[id]:\n    some todo:\n      todo.title\n    none:\n      'missing'\n  update todos[id] { title: 'touched' }\n\nmutation ensure(id: todos):\n  match todos[id]:\n    some todo:\n      update todos[id] { title: 'found' }\n    none:\n      insert todos { title: 'made' }\n  return null\n";
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `mid-body match refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error),
        "mid-body match project did not certify");
    });
  });

  test("every Quarry diagnostic family rewrite is fenced parseable Quarry", () => {
    const families = JSON.parse(readFileSync(resolve(packageRoot, "guide/families.source.json"), "utf8")) as Array<Record<string, string>>;
    const quarry = families.filter((item) => item.family === "quarry");
    const expected = new Set(["E_QUARRY_SYNTAX", "E_QUARRY_UNKNOWN", "E_QUARRY_AMBIGUOUS", "E_QUARRY_UNSUPPORTED", "E_QUARRY_PLACEMENT", "E_QUARRY_TYPE", "E_QUARRY_ONLY"]);
    assert(quarry.length === expected.size, `Quarry family entry count changed: ${quarry.length}`);
    for (const item of quarry) {
      assert(expected.delete(item.code), `unexpected/duplicate Quarry family code ${item.code}`);
      const match = item.right.match(/^```q\n([\s\S]+)\n```$/);
      assert(match, `${item.code} right rewrite is not fenced Quarry`);
      const parsed = parseDocument("right.q", match[1]!);
      assert(parsed.diagnostics.length === 0, `${item.code} right rewrite does not parse: ${parsed.diagnostics.map((entry) => entry.message).join("; ")}`);
    }
    assert(expected.size === 0, `missing Quarry family entries: ${[...expected].join(", ")}`);
  });

  test("principal remains nominal in Quarry rules and program values", () => {
    const source = `use identity\n\ntable users:\n  name: text <=40\n  public\n\ntable items:\n  owner: users\n  read <- .owner = viewer\n`;
    const compiled = compileQuarry([{ path: "/virtual/schema.q", fileName: "snapback/schema.q", source }]);
    assert(!compiled.ok, "a table ref compared with viewer was accepted");
    const refusal = compiled.diagnostics[0]!;
    assert(refusal.code === "E_QUARRY_UNKNOWN" && refusal.family === "quarry" && refusal.site === "snapback/schema.q:9:18",
      `nominal refusal was not a sited Quarry diagnostic: ${JSON.stringify(refusal)}`);
    assert(refusal.message.includes("fields compared with viewer must be principal"), `nominal refusal message changed: ${refusal.message}`);
  });

  test("db.insert row expressions are bound once and share the returned variable", async () => {
    await withProject({
      "snapback/schema.ts": `import { rule, schema, table, t } from "snapback2";\nexport const items = table({ columns: { owner: t.principal() }, rules: { read: rule.allow(), insert: rule.allow() } });\nexport default schema({ auth: { password: true, guests: true }, tables: { items } });\n`,
      "snapback/items.ts": `import { mutation } from "snapback2";\nimport { items } from "./schema";\nexport const add = mutation({}, ({ db, ctx }) => {\n  return db.insert(items, { id: ctx.newId(), owner: ctx.viewer });\n});\n`,
    }, async (root) => {
      const lowered = await lowerProject(root, { authoring: "any" });
      assert(lowered.ok, `inline insert fixture refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const body = operation(lowered.project.programs, "items.add").body as any[];
      const letStmt = body.find((item) => item.Let?.name?.startsWith("__insertRow"));
      const insert = body.find((item) => item.Insert);
      const returned = body.find((item) => item.Return);
      assert(letStmt && insert?.Insert?.row?.Variable === letStmt.Let.name && returned?.Return?.Variable === letStmt.Let.name,
        `insert/storage/return do not share one temporary: ${JSON.stringify(body)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error), "single-evaluation insert IR did not certify");
    });
  });

  test("Quarry mutually exclusive branch writes share the certifier/runtime bound", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-surface"));
    assert(lowered.ok, "Quarry branch-write fixture refused");
    const program = operation(lowered.project.programs, "surface.branchWrite");
    const checked = rustCheck([program], "synthetic", lowered.project.schema)[0]!;
    assert(!checked.error, `branch write did not certify: ${JSON.stringify(checked.error)}`);
    const sites = checked.certificate?.write_sites as Array<{ table: string; max_rows: number }>;
    assert(sites?.some((site) => site.table === "counters" && site.max_rows === 1), `branch write bound is not one: ${JSON.stringify(sites)}`);
  });

  test("Quarry-only authoring and module placement are exact", async () => {
    await withProject({
      "snapback/schema.q": "table items:\n  value: int\n  public\n",
      "snapback/schema.ts": "export default {};\n",
      "snapback/items.q": "query list():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics[0]?.code === "E_QUARRY_ONLY" && result.diagnostics[0].site === "snapback/schema.ts:1:1",
        "TypeScript schema did not receive the Quarry-only refusal");
    });
    await withProject({
      "snapback/schema.ts": "export default {};\n",
      "snapback/items.q": "query list():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics[0]?.code === "E_QUARRY_ONLY", "TypeScript schema was not refused");
    });
    await withProject({
      "snapback/schema.q": "table items:\n  value: int\n  public\n",
      "snapback/items.q": "query fromQuarry():\n  return null\n",
      "snapback/items.ts": "import { effect } from 'snapback2'; export const notify = effect({ grants: ['https://api.example.com'], run: async () => null });\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_OP_MODULE_BASENAME"), "same-stem Quarry/effect modules were not refused");
    });
  });
}

function compileFixture(fixtures: string, name: string, stems: string[]) {
  const directory = resolve(fixtures, name, "snapback");
  const inputs: QuarryInput[] = stems.map((stem) => {
    const path = resolve(directory, `${stem}.q`);
    return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
  });
  return compileQuarry(inputs);
}

function compileInline(inputs: Array<{ fileName: string; source: string }>) {
  return compileQuarry(inputs.map((input) => ({
    ...input,
    path: resolve("/virtual", input.fileName),
  })));
}

async function withProject<T>(files: Record<string, string>, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-quarry-check-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = resolve(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function operation(programs: Program[], name: string): Program {
  const program = programs.find((item) => item.name === name);
  assert(program, `missing operation ${name}`);
  return program;
}
function generatedOperation(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  assert(start >= 0, `missing generated operation ${name}`);
  const end = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}
function writeKeyNames(source: string): [string, string] | undefined {
  const first = source.match(/const (__q_writeKey1_[A-Za-z0-9_]+) = args\.owner;/)?.[1];
  const second = source.match(/const (__q_writeKey2_[A-Za-z0-9_]+) = args\.label;/)?.[1];
  return first && second ? [first, second] : undefined;
}
function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}
function deepKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => deepKey(item, key));
  if (!value || typeof value !== "object") return false;
  return key in value || Object.values(value).some((item) => deepKey(item, key));
}
function diagnosticsText(diagnostics: FrontendDiagnostic[]): string {
  return diagnostics.map((item) => `${item.code}@${item.site}: ${item.message}`).join("; ");
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
