import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { parseDocument } from "./quarry/parser";
import {
  assert,
  compileInline,
  diagnosticsText,
  operation,
  type Test,
  withProject,
} from "./quarry-check-helpers";
import { registerJobChecks } from "./quarry-job-checks";
import { registerScheduleChecks } from "./quarry-schedule-checks";
import { registerQuarryDirectCoreChecks } from "./quarry-direct-core-checks";
import { registerQuarryDirectMutationChecks } from "./quarry-direct-mutation-checks";
import { registerQuarryDirectValidationChecks } from "./quarry-direct-validation-checks";
import { registerQuarryDirectProjectChecks } from "./quarry-direct-project-checks";
import { registerQuarryDirectArgumentChecks } from "./quarry-direct-argument-checks";
import { registerQuarryDirectContractChecks } from "./quarry-direct-contract-checks";
import { runQuarryBoundApiChecks } from "./quarry-bound-api-checks";
import { registerQuarryDirectSearchEligibilityChecks } from "./quarry-direct-search-eligibility-checks";
import { registerQuarryChatCompositionChecks } from "./quarry-chat-composition-checks";
import ts from "typescript";

export function registerQuarryChecks(test: Test, frontend: string): void {
  const fixtures = resolve(frontend, "fixtures");
  registerQuarryDirectValidationChecks(test, frontend);
  registerQuarryDirectCoreChecks(test, frontend);
  registerQuarryDirectArgumentChecks(test);
  registerQuarryDirectContractChecks(test);
  test("bound Quarry API follows direct result and custody facts", runQuarryBoundApiChecks);
  registerQuarryDirectSearchEligibilityChecks(test);
  registerQuarryDirectProjectChecks(test, frontend);
  registerQuarryChatCompositionChecks(test, frontend);
  test("removed system rule refuses in the parser with a deny rewrite", () => {
    for (const rule of [
      "system", "allow or system", "not system", "(deny or system)",
      "viewer = system", "system != viewer", "viewer != (system)", "(system) = viewer",
      "exists records[system]", "exists records[id = (system)]",
      "created records[system]", "created records[id = (system)]",
    ]) {
      const parsed = parseDocument("snapback/schema.q", `table records:\n  value: int\n  insert <- ${rule}\n`);
      const refusal = parsed.diagnostics.find((item) => item.code === "E_QUARRY_UNSUPPORTED");
      assert(refusal?.rewrite === "deny", JSON.stringify(parsed.diagnostics));
      assert(refusal?.message === "the system principal never consults rules; `deny` is what this meant", JSON.stringify(refusal));
      assert(refusal?.line === 3 && Boolean(refusal.guide), JSON.stringify(refusal));
      const compiled = compileInline([
        { fileName: "snapback/schema.q", source: `table records:\n  value: int\n  insert <- ${rule}\n` },
      ]);
      assert(!compiled.ok && compiled.diagnostics.some((item) => item.code === "E_QUARRY_UNSUPPORTED" && item.rewrite === "deny" && item.family === "quarry"), JSON.stringify(compiled));

    }
  });

  test("Quarry todos and full surface lower in memory and certify", async () => {
    for (const [name, count] of [["quarry-todos", 2], ["quarry-surface", 26]] as const) {
      const lowered = await lowerProject(resolve(fixtures, name));
      assert(lowered.ok, `${name} refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(lowered.project.programs.length === count, `${name} program count changed to ${lowered.project.programs.length}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `${name} did not certify: ${JSON.stringify(failures)}`);
      assert(!existsSync(resolve(fixtures, name, "snapback/schema.ts")), `${name} wrote generated schema.ts into the authored tree`);
      assert(!existsSync(resolve(fixtures, name, "snapback/surface.q.ts")), `${name} wrote generated .q.ts into the authored tree`);
      assert(lowered.quarry.every((item) => item.file.endsWith(".q") && item.generated.endsWith(".ir.json")
        && ["{", "["].includes(item.source.trimStart()[0] ?? "")), `${name} lost its Quarry inspection response`);
    }

  });

  test("image once is column custody, carries through lowering, and video refuses with a range repair", async () => {
    await withProject({ "snapback/schema.q": `table photos:
  photo: image <=10000000 once ?
  gallery: [image <=10000000 once] <=4
  read <- public
  insert <- allow
`, "snapback/photos.q": `mutation put(photo: image <=10000000):
  return insert photos { photo, gallery: [] }
` }, async root => {
      const result = await lowerProject(root);
      assert(result.ok, JSON.stringify(result));
      const table = (result.project.schema.tables as any).photos;
      assert(table.columns.photo.Optional.Image.once === true, JSON.stringify(table));
      assert(table.columns.gallery.List.of.Image.once === true, JSON.stringify(table));
      assert(!("once" in (result.project.programs[0]!.args.photo as any).Image), "argument acquired column custody");
      assert(rustCheck(result.project.programs, "synthetic", result.project.schema).every(item => !item.error), "once image did not certify");
    });
    const parsed = parseDocument("snapback/schema.q", "table photos:\n  clip: video <=10000000 once\n  read <- public\n");
    assert(parsed.diagnostics.some(item => /ranges.*unspecified/.test(item.message) && /image.*once/.test(item.rewrite)), JSON.stringify(parsed));
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
        && nested.includes("{ albums: ImageAsset[] | null }"),
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
        && refusal.message.includes(`${field} expects`) && refusal.message.includes(", got ")
        && refusal.message.includes(expected.includes("video") || actual.includes("video") ? "video asset" : "image asset")
        && refusal.rewrite.includes("use a ") && refusal.rewrite.includes(field),
      `${name} lost its recursive kind refusal/rewrite: ${JSON.stringify(result)}`);
    }

    const accepted = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `mutation accepted(photo: image <=5000000, photos: [image <=5000000] <=4, videos: [video <=50000000] <=4, nested: [[image <=5000000] <=4] <=3):
  return insert media { images: [], videos, optionalImages: photos, nestedImages: nested, photo, optionalPhoto: photo }

mutation nested_empty(photo: image <=5000000, images: [image <=5000000] <=4, videos: [video <=50000000] <=4):
  return insert media { images, videos, nestedImages: [[]], photo }

mutation empty_first(photo: image <=5000000, images: [image <=5000000] <=4, videos: [video <=50000000] <=4, photos: [image <=5000000] <=4):
  return insert media { images, videos, nestedImages: [[], photos], photo }

mutation empty_last(photo: image <=5000000, images: [image <=5000000] <=4, videos: [video <=50000000] <=4, photos: [image <=5000000] <=4):
  return insert media { images, videos, nestedImages: [photos, []], photo }
` },
    ]);
    assert(accepted.ok, `nested empty asset list or required-to-optional asset assignment refused: ${accepted.ok ? "" : JSON.stringify(accepted.diagnostics)}`);

    const scalarEmpty = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: "mutation scalar_empty():\n  return insert media { photo: [] }\n" },
    ]);
    assert(!scalarEmpty.ok && scalarEmpty.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
      && item.message.includes("photo expects image asset")),
    `empty list literal was accepted for scalar asset column: ${JSON.stringify(scalarEmpty)}`);

    const forge = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: "mutation forge():\n  return insert media { photo: { id: 'asset-1', width: 1, height: 1 } }\n" },
    ]);
    assert(!forge.ok && forge.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
      && item.message.includes("photo expects image asset")),
    `literal asset record forge did not remain E_QUARRY_TYPE: ${JSON.stringify(forge)}`);
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
      assert(refusal.rewrite.includes("matching decimal 2 values"),
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
        && refusal.message.includes("3 fractional digits") && refusal.rewrite.includes("at most 2 fractional digits"),
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
      && item.message.includes("fractional digits do not fit int")),
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
      && upsert.rewrite === "upsert keyedRows[owner, label] { label, value }" && upsert.guide === "quarry/types",
    `upsert mismatch lost its code/family/field site/drop-field rewrite/guide: ${JSON.stringify(upsert)}`);
    assert(update?.family === "quarry" && update.site === "snapback/ops.q:5:43"
      && update.rewrite === "update keyedRows[owner, label] { owner, value }" && update.guide === "quarry/types",
    `update mismatch lost its code/family/field site/drop-field rewrite/guide: ${JSON.stringify(update)}`);

    const repaired = operations
      .replace(badUpsert, upsert.rewrite)
      .replace(badUpdate, update.rewrite);
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
      && diagnostic.rewrite === "upsert keyedRows[owner, label] { value }",
    `authored upsert id lost its field site and drop-field rewrite: ${JSON.stringify(compiled)}`);
    const repaired = module.replace("upsert keyedRows[owner, label] { id: new, value }", diagnostic!.rewrite);
    const fixed = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/keyed.q", source: repaired },
    ]);
    assert(fixed.ok, `drop-field rewrite did not restore the absent insert branch: ${JSON.stringify(fixed)}`);
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
      assert(focused.error === null && focused.certificate?.max_output_bytes === 899_792
        && focused.certificate.max_closure_bytes === 823_750,
      `focused Clique shape did not certify at its pinned bounds: ${JSON.stringify(focused)}`);

      const spread = checked.find((item) => item.program === "row-width.spread")!;
      assert(spread.certificate === null && spread.error?.code === "E_BOUND"
        && spread.error.message.startsWith("output bytes 1983792 exceeds ceiling 1048576")
        && spread.error.rewrite.includes("widest nested collection")
        && spread.error.rewrite.includes("shares first 50")
        && spread.error.rewrite.includes("shares.expenseDescription")
        && !spread.error.rewrite.includes("return null"),
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
      assert(raised.error === null && raised.certificate?.max_output_bytes === 1_983_792
        && raised.certificate.max_closure_bytes === 1_871_650,
      `raised-ceiling Clique spread changed: ${JSON.stringify(raised)}`);
      // Four-byte text pricing makes the complete expense/share rows 1,098/1,426;
      // both 20 × 50 figures are direct pins from the real certifier.
    });
  });

  registerQuarryDirectMutationChecks(test, frontend);
  registerJobChecks(test, frontend);
  registerScheduleChecks(test, frontend);
}
