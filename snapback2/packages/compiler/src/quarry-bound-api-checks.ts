import { CertifiedTestStore as ClientStore } from "./quarry-check-helpers";
import { ok, equal, match, doesNotMatch, deepStrictEqual } from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { wireJson, type Context } from "../../evaluator/src/evaluator";
import { RowImage } from "../../evaluator/src/row-image";
import { apiConsumerDiagnostics } from "./quarry-check-helpers";
import { boundApiRowAliases, generateBoundApiDts } from "./quarry/bound-api";
import { bindQuarryProgram, type BoundQuarryProgram } from "./quarry/bound";
import { bindQuarrySchema } from "./quarry/bound-schema";
import { lowerBoundQuarryProgram } from "./quarry/direct";
import { prepareQuarry, type PreparedQuarry, type QuarryInput } from "./quarry/index";

const frontend = resolve(decodeURIComponent(new URL(".", import.meta.url).pathname), "..");

export function runQuarryBoundApiChecks(): void {
  const assets = fixture("quarry-assets");
  const assetApi = api(assets);
  match(assetApi, /readonly inspect: Op<\{ photo: File \| ImageAsset; clip: File \| VideoAsset \}, \{ photo: ImageAsset; width: number; clip: VideoAsset \}>;/);
  match(assetApi, /readonly echo: Op<\{ photo: ImageAsset; clip: VideoAsset \}, \{ photo: ImageAsset; clip: VideoAsset \}>;/);
  match(assetApi, /avatar\?: File \| ImageAsset \| null/);
  match(assetApi, /albums\?: \(File \| ImageAsset\)\[\] \| null/);
  match(assetApi, /readonly echoNested: Op<\{ albums\?: ImageAsset\[\] \| null \}, \{ albums: ImageAsset\[\] \| null \}>;/);
  doesNotMatch(assetApi, /\bany\b/);

  const surface = fixture("quarry-surface");
  const surfaceApi = api(surface);
  match(surfaceApi, /readonly visiblePosts: Op<\{ author: Principal \}, \{ rows: Page<PostsRow>; count: number \}>;/);
  match(surfaceApi, /readonly postsAfter: Op<\{ author: Principal; c\?: Cursor \| null \}, \(Omit<PostsRow, "author"> & \{ author: \{ name: string; role: "member" \| "admin" \} \| null; edited: number \}\)\[\]>;/);
  match(surfaceApi, /readonly ancestors: Op<\{ seed: string \}, NodesRow\[\]>;/);
  doesNotMatch(surfaceApi, /\bany\b/);

  const assetConsumer = `import { api, type Op } from "snapback2/client";
import type { ImageAsset, VideoAsset } from "snapback2";
const inspect: Op<{ photo: File | ImageAsset; clip: File | VideoAsset }, { photo: ImageAsset; width: number; clip: VideoAsset }> = api.assets.inspect;
const echo: Op<{ photo: ImageAsset; clip: VideoAsset }, { photo: ImageAsset; clip: VideoAsset }> = api.assets.echo;
// @ts-expect-error query asset arguments do not accept local File substitution
api.assets.echo satisfies Op<{ photo: File; clip: File }, unknown>;
void [inspect, echo];`;
  deepStrictEqual(apiConsumerDiagnostics(assetApi, assetConsumer), []);

  const surfaceConsumer = `import { api, type Op } from "snapback2/client";
import type { Cursor, Principal } from "snapback2";
type Result<T> = T extends Op<infer _A, infer R> ? R : never;
declare const posts: Result<typeof api.surface.postsAfter>;
const author: string | undefined = posts[0]?.author?.name;
const edited: number | undefined = posts[0]?.edited;
declare const input: { author: Principal; c?: Cursor | null };
api.surface.postsAfter satisfies Op<typeof input, unknown>;
// @ts-expect-error the inherited author field is replaced by the shaped profile
const wrong: Principal = posts[0]!.author;
void [author, edited, input, wrong];`;
  deepStrictEqual(apiConsumerDiagnostics(surfaceApi, surfaceConsumer), []);

  const collision = prepared([
    ["snapback/schema.q", `table rooms:\n  public\n\n${["typing", "presence", "op", "then", "toJSON"].map((name) =>
      `channel ${name}(room: rooms):\n  value: { typing: bool }\n  publish <- allow\n  subscribe <- allow\n  ttl 5s\n`).join("\n")}`],
    ["snapback/channels.q", "query typing():\n  return null\n"],
    ["snapback/typing.q", "query ping():\n  return rooms[] first 3 by byId { * }\n"],
  ]);
  const collisionApi = api(collision);
  match(collisionApi, /readonly typing: Op<\{\}, null> & Channel<\{ room: string \}, \{ typing: boolean \}>;/);
  match(collisionApi, /readonly ping: Op<\{\}, Page<RoomsRow>>;/);
  match(collisionApi, /^    readonly presence: Channel<\{ room: string \}, \{ typing: boolean \}>;$/m);
  for (const reserved of ["typing", "op", "then", "toJSON"]) {
    doesNotMatch(collisionApi, new RegExp(`^    readonly ${reserved}: Channel<`, "m"));
  }
  deepStrictEqual(apiConsumerDiagnostics(collisionApi, `import { api, type Channel, type Op } from "snapback2/client";
const nested: Op<{}, null> & Channel<{ room: string }, { typing: boolean }> = api.channels.typing;
const alias: Channel<{ room: string }, { typing: boolean }> = api.presence;
type Value<T> = T extends Channel<infer _A, infer V> ? V : never;
const valid: Value<typeof api.presence> = { typing: true };
// @ts-expect-error channel values carry a typed bool
const wrong: Value<typeof api.presence> = { typing: "true" };
// @ts-expect-error required value fields cannot be omitted
const missing: Value<typeof api.presence> = {};
// @ts-expect-error channel value declarations are closed records
const extra: Value<typeof api.presence> = { typing: true, extra: 1 };
// @ts-expect-error the generated reference carries its value type
const wrongRef: Channel<{ room: string }, { typing: string }> = api.presence;
void [nested, alias, valid, wrong, missing, extra, wrongRef];`), []);

  const optionalChannel = prepared([["snapback/schema.q", `table rooms:
  public

channel typing():
  value: { note: text <=20 ?, modes: [enum('typing', 'idle')] <=2 ?, amount: decimal 2 ? }
  publish <- allow
  subscribe <- allow
  ttl 4s
`]]);
  deepStrictEqual(apiConsumerDiagnostics(api(optionalChannel), `import { api, type Channel } from "snapback2/client";
type Value<T> = T extends Channel<infer _A, infer V> ? V : never;
const omitted: Value<typeof api.typing> = {};
const empty: Value<typeof api.typing> = { note: null, modes: null, amount: null };
const filled: Value<typeof api.typing> = { note: "hello", modes: ["typing"], amount: 123 };
// @ts-expect-error enum list elements keep their declared variants
const wrong: Value<typeof api.typing> = { modes: ["other"] };
void [omitted, empty, filled, wrong];`), []);

  const schedules = fixture("quarry-schedules");
  const scheduleApi = api(schedules);
  doesNotMatch(scheduleApi, /digestSweep|purgeMessage/);
  equal(scheduleApi.includes("interface Api"), true);

  const collidingRows = prepared([
    ["snapback/schema.q", "table foo_bar:\n  public\n\ntable fooBar:\n  public\n"],
    ["snapback/aliases.q", `query snake():
  return foo_bar[] first 1 by byId

query camel():
  return fooBar[] first 1 by byId

query empty():
  return []
`],
  ]);
  const rowAliases = boundApiRowAliases(collidingRows.catalog);
  const aliases = [rowAliases.get("foo_bar"), rowAliases.get("fooBar")];
  equal(new Set(aliases).size, 2, `colliding legal table names reused a declaration alias: ${aliases}`);
  const collidingApi = api(collidingRows);
  match(collidingApi, /readonly empty: Op<\{\}, never\[]>;/);
  deepStrictEqual(apiConsumerDiagnostics(collidingApi, `import { api } from "snapback2/client";
void [api.aliases.snake, api.aliases.camel, api.aliases.empty];`), []);

  const absence = prepared([
    ["snapback/schema.q", "table nodes:\n  parent: nodes ?\n  name: text <=40\n  public\n"],
    ["snapback/absence.q", `query raw(flag: bool):
  if flag:
    return nodes[] first 3 by byId
  return null

query shaped(flag: bool):
  if flag:
    return nodes[] first 3 by byId { name }
  return null

query walked(flag: bool, seed: nodes):
  if flag:
    return walk nodes[seed] up .parent depth 3
  return null

query scalar(flag: bool):
  if flag:
    return 1
  return null

query optionalFields():
  return nodes[] first 3 by byId { parent, name }

query inheritedFields():
  return nodes[] first 3 by byId { * }

query overwrittenFields(maybe: nodes ?):
  return nodes[] first 3 by byId { *, parent: maybe }

query rawPoint(seed: nodes):
  return nodes[seed]

query partialPoint(seed: nodes):
  return nodes[seed] { parent, name }
`],
  ]);
  const absenceApi = api(absence);
  match(absenceApi, /type NodesRow = \{\n  id: string;\n  parent\?: string \| null;\n  name: string;\n\};/);
  match(absenceApi, /readonly raw: Op<\{ flag: boolean \}, Page<NodesRow> \| null>;/);
  match(absenceApi, /readonly shaped: Op<\{ flag: boolean \}, \{ name: string \}\[\] \| null>;/);
  match(absenceApi, /readonly walked: Op<\{ flag: boolean; seed: string \}, NodesRow\[\] \| null>;/);
  match(absenceApi, /readonly scalar: Op<\{ flag: boolean \}, number \| null>;/);
  doesNotMatch(absenceApi, /number \| undefined/);
  match(absenceApi, /readonly optionalFields: Op<\{\}, \{ parent: string \| null; name: string \}\[]>;/);
  match(absenceApi, /readonly inheritedFields: Op<\{\}, Page<NodesRow>>;/);
  match(absenceApi, /readonly overwrittenFields: Op<\{ maybe\?: string \| null \}, \(Omit<NodesRow, "parent"> & \{ parent: string \| null \}\)\[]>;/);
  deepStrictEqual(apiConsumerDiagnostics(absenceApi, `import { api, type Op } from "snapback2/client";
type Result<T> = T extends Op<infer _A, infer R> ? R : never;
declare const raw: Result<typeof api.absence.raw>;
declare const shaped: Result<typeof api.absence.shaped>;
declare const walked: Result<typeof api.absence.walked>;
declare const scalar: Result<typeof api.absence.scalar>;
declare const optional: Result<typeof api.absence.optionalFields>;
const rawName: string | undefined = raw?.[0]?.name;
const shapedName: string | undefined = shaped?.[0]?.name;
const walkedName: string | undefined = walked?.[0]?.name;
const scalarValue: number | null = scalar;
const parent: string | null | undefined = optional[0]?.parent;
// @ts-expect-error explicit null completion is not stored-field undefined
const wrongScalar: number | undefined = scalar;
void [rawName, shapedName, walkedName, scalarValue, parent, wrongScalar];`), []);

  const directSchema = bindQuarrySchema(absence.documents, absence.catalog);
  const direct = (name: string) => lowerBoundQuarryProgram(boundPrograms(absence).find((program) => program.name === `absence.${name}`)!);
  const receipt = { rows: [{ table: "nodes", id: "child", row: { Row: {
    id: { Id: "child" }, name: { String: "Child" },
  } } }], ranges: [], absences: [], verdicts: [] };
  const context: Context = { viewer: "viewer", principal_kind: "user", auth_epoch: 1,
    args: { seed: { Id: "child" } }, now: 1, read_time: 1, new_ids: [] };
  const rawStore = new ClientStore(directSchema, receipt);
  deepStrictEqual(RowImage.wire(rawStore.rows("nodes")[0] as RowImage), { id: "child", name: "Child" },
    "authenticated raw-row custody did not preserve an omitted optional field");
  const rawResult = rawStore.reexecute(direct("rawPoint"), context).execution.result;
  deepStrictEqual(wireJson(rawResult), { id: "child", name: "Child", parent: null },
    "direct raw-row execution did not materialize its optional field");
  const partialResult = new ClientStore(directSchema, receipt).reexecute(direct("partialPoint"), context).execution.result;
  deepStrictEqual(wireJson(partialResult), { name: "Child", parent: null },
    "direct constructed shape omitted an authored optional field instead of retaining Null");
  const explicit = new ClientStore(directSchema, { ...receipt, rows: [{ ...receipt.rows[0]!, row: { Row: {
    id: { Id: "child" }, name: { String: "Child" }, parent: "Null" as const,
  } } }] });
  deepStrictEqual(RowImage.wire(explicit.rows("nodes")[0] as RowImage), { id: "child", name: "Child", parent: null },
    "authenticated raw-row custody erased an explicit optional Null");
}

function api(prepared: PreparedQuarry): string {
  return generateBoundApiDts(boundPrograms(prepared), prepared.documents, prepared.catalog);
}

function boundPrograms(prepared: PreparedQuarry): BoundQuarryProgram[] {
  return prepared.documents.flatMap((document) => document.programs.map((program) =>
    bindQuarryProgram(program, prepared.catalog, prepared.documents)));
}

function fixture(name: string): PreparedQuarry {
  const directory = resolve(frontend, `fixtures/${name}/snapback`);
  return prepared(readdirSync(directory).filter((entry) => entry.endsWith(".q")).sort()
    .map((entry) => [`snapback/${entry}`, readFileSync(join(directory, entry), "utf8")]));
}

function prepared(files: Array<[fileName: string, source: string]>): PreparedQuarry {
  const inputs: QuarryInput[] = files.map(([fileName, source]) => ({ path: resolve("/virtual", fileName), fileName, source }));
  const result = prepareQuarry(inputs);
  ok(result.ok, `bound API fixture refused: ${result.ok ? "" : JSON.stringify(result.diagnostics)}`);
  return result.prepared;
}

if (import.meta.main) {
  runQuarryBoundApiChecks();
  console.log("bound Quarry API checks passed");
}
