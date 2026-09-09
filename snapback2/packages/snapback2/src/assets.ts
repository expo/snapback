import type {
  AssetRecord,
  AssetUploadOptions,
  AssetUploadSource,
  ImageAsset,
  NativeAssetSource,
  VideoAsset,
} from "./types.js";
import { plainObject as isRecord } from "../../evaluator/src/value-runtime.js";

export class AssetInputError extends Error {
  constructor(
    readonly code: "E_ASSET_TYPE" | "E_ASSET_TOO_LARGE" | "E_ASSET_NOT_READY" | "E_ASSET_CARRIER_IMAGE" | "E_ASSET_NATIVE_FILE_API",
    message: string,
  ) {
    super(message);
    this.name = "AssetInputError";
  }
}

export interface BlobLike {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  stream(): ReadableStream<Uint8Array>;
}

type RuntimeAssetUploadSource = AssetUploadSource | BlobLike;

export interface PreparedAssetSource {
  readonly source: RuntimeAssetUploadSource;
  readonly bytes: number;
  body?: BlobLike | ReadableStream<Uint8Array>;
}

export interface AssetPlacement {
  readonly path: readonly (string | number)[];
  readonly max: number;
  readonly prepared: PreparedAssetSource;
}

type AssetKind = "image" | "video";
type PlacementCandidate = {
  readonly path: readonly (string | number)[];
  readonly max: number;
  readonly source: RuntimeAssetUploadSource;
};

export function isBrowserFile(value: unknown): value is File | Blob {
  return isBlobLike(value)
    && ((typeof globalThis.File === "function" && value instanceof globalThis.File)
      || (typeof globalThis.Blob === "function" && value instanceof globalThis.Blob));
}

export function isBlobLike(value: unknown): value is BlobLike {
  return isRecord(value)
    && typeof value.size === "number"
    && typeof value.arrayBuffer === "function"
    && typeof value.stream === "function";
}

export function isNativeAssetSource(value: unknown): value is NativeAssetSource {
  return isRecord(value) && typeof value.uri === "string" && value.uri.length > 0;
}

// This is only a cheap signal that a manifest walk may be needed. It does not
// classify a value as an upload source; only collectPlacements may do that.
export function mayNeedAssetPlanning(value: unknown, ancestors = new Set<object>()): boolean {
  if (isBlobLike(value) || isNativeAssetSource(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const found = Array.isArray(value)
    ? value.some((item) => mayNeedAssetPlanning(item, ancestors))
    : Object.values(value).some((item) => mayNeedAssetPlanning(item, ancestors));
  ancestors.delete(value);
  return found;
}

function descriptorAsset(value: unknown): { kind: AssetKind; max: number } | undefined {
  if (!isRecord(value)) return undefined;
  for (const [tag, kind] of [["Image", "image"], ["Video", "video"]] as const) {
    const tagged = value[tag];
    if (!isRecord(tagged) || Object.keys(value).length !== 1) continue;
    const max = tagged.max;
    if (typeof max === "number" && Number.isSafeInteger(max) && max > 0) return { kind, max };
  }
  return undefined;
}

// Every non-structural ArgType tag: a {uri} object arriving where one of these
// is declared is a misplaced upload source, never a record to traverse.
const scalarDescriptorTags = new Set([
  "Ref", "Text", "Bytes", "Json", "Enum", "Decimal", "Money",
  "Int", "Bool", "Time", "Id", "Principal", "Cursor", "Scalar",
]);

function isScalarDescriptor(value: unknown): boolean {
  if (typeof value === "string") return true;
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && scalarDescriptorTags.has(keys[0]!);
}

function collectPlacements(
  value: unknown,
  descriptor: unknown,
  path: readonly (string | number)[],
  output: PlacementCandidate[],
): void {
  const asset = descriptorAsset(descriptor);
  if (asset) {
    if (isBlobLike(value) || isNativeAssetSource(value)) {
      output.push({ path, max: asset.max, source: value });
    }
    return;
  }
  if (!isRecord(descriptor)) {
    if (isBlobLike(value) || isNativeAssetSource(value)) {
      throw new AssetInputError(
        "E_ASSET_TYPE",
        `asset upload source at ${path.join(".") || "<root>"} may only be used at an image or video argument`,
      );
    }
    return;
  }
  if (Object.keys(descriptor).length === 1 && "Optional" in descriptor) {
    if (value !== null && value !== undefined) collectPlacements(value, descriptor.Optional, path, output);
    return;
  }
  if (Object.keys(descriptor).length === 1 && isRecord(descriptor.List) && Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectPlacements(value[index], descriptor.List.of, [...path, index], output);
    }
    return;
  }
  if (isBlobLike(value) || (isNativeAssetSource(value) && isScalarDescriptor(descriptor))) {
    throw new AssetInputError(
      "E_ASSET_TYPE",
      `asset upload source at ${path.join(".") || "<root>"} may only be used at an image or video argument`,
    );
  }
  if (!isRecord(value)) return;
  for (const [name, child] of Object.entries(descriptor)) {
    collectPlacements(value[name], child, [...path, name], output);
  }
}

function checkedLength(value: unknown, surface: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new AssetInputError("E_ASSET_TYPE", `${surface} must have a positive integer byte length`);
  }
  return value;
}

type ExpoFile = BlobLike & { readonly uri: string };
type ExpoFileConstructor = new (uri: string) => ExpoFile;

async function expoFile(source: NativeAssetSource): Promise<ExpoFile> {
  let module: { File?: unknown };
  try {
    // The build leaves this optional native peer external, and this branch is
    // reached only for a manifest-classified native URI source.
    module = await import("expo-file-system") as { File?: unknown };
  } catch (error) {
    throw new AssetInputError(
      "E_ASSET_NOT_READY",
      `cannot open native asset URI ${source.uri} with expo-file-system: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof module.File !== "function") {
    throw new AssetInputError(
      "E_ASSET_NATIVE_FILE_API",
      "native asset URIs require expo-file-system >=19 (Expo SDK 54), whose package root exports the File constructor",
    );
  }
  try {
    return new (module.File as ExpoFileConstructor)(source.uri);
  } catch (error) {
    throw new AssetInputError(
      "E_ASSET_NOT_READY",
      `cannot open native asset URI ${source.uri} with expo-file-system: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function expoUploadFetch(): Promise<typeof globalThis.fetch> {
  try {
    const module = await import("expo/fetch") as { fetch?: unknown };
    if (typeof module.fetch !== "function") throw new TypeError("expo/fetch does not export fetch");
    return module.fetch as typeof globalThis.fetch;
  } catch (error) {
    throw new AssetInputError(
      "E_ASSET_NOT_READY",
      `native asset upload requires expo/fetch: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function fetchedNativeBody(source: NativeAssetSource): Promise<PreparedAssetSource> {
  let response: Response;
  try {
    response = await globalThis.fetch(source.uri);
  } catch (error) {
    throw new AssetInputError(
      "E_ASSET_NOT_READY",
      `cannot open native asset URI ${source.uri}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw new AssetInputError("E_ASSET_NOT_READY", `native asset URI ${source.uri} returned HTTP ${response.status}`);
  if (!response.body) throw new AssetInputError("E_ASSET_TYPE", `native asset URI ${source.uri} has no streaming body`);
  const declared = source.size ?? source.fileSize;
  const bytes = declared === undefined
    ? checkedLength(Number(response.headers.get("Content-Length")), `Content-Length for ${source.uri}`)
    : checkedLength(declared, source.size === undefined ? "native asset source.fileSize" : "native asset source.size");
  return { source, bytes, body: response.body };
}

export async function prepareAssetSource(
  source: RuntimeAssetUploadSource,
): Promise<PreparedAssetSource> {
  if (isBlobLike(source)) {
    return { source, bytes: checkedLength(source.size, "File/Blob size") };
  }
  if (!isNativeAssetSource(source)) {
    throw new AssetInputError("E_ASSET_TYPE", "asset source must be a File or { uri, size?/fileSize?, type?/mimeType? }");
  }
  if (/^(?:data|https?):/i.test(source.uri)) return fetchedNativeBody(source);
  const body = await expoFile(source);
  const declared = source.size ?? source.fileSize;
  const bytes = declared === undefined
    ? checkedLength(body.size, `expo-file-system File.size for ${source.uri}`)
    : checkedLength(declared, source.size === undefined ? "native asset source.fileSize" : "native asset source.size");
  if (body.size !== bytes) {
    throw new AssetInputError(
      "E_ASSET_TYPE",
      `native asset source declared ${bytes} bytes but expo-file-system reports ${body.size}`,
    );
  }
  return { source, bytes, body };
}

// @ref LLP 1006#10-clients — every File/URI occurrence is length-checked against
// its manifest descriptor before the first server upload starts.
export async function planAssetArguments(
  args: unknown,
  descriptor: unknown,
): Promise<AssetPlacement[]> {
  const candidates: PlacementCandidate[] = [];
  collectPlacements(args, descriptor, [], candidates);
  const prepared = await Promise.all(candidates.map(async (candidate) => ({
    ...candidate,
    prepared: await prepareAssetSource(candidate.source),
  })));
  for (const item of prepared) {
    if (item.prepared.bytes > item.max) {
      throw new AssetInputError(
        "E_ASSET_TOO_LARGE",
        `asset argument at ${item.path.join(".") || "<root>"} has ${item.prepared.bytes} bytes, over its ${item.max} byte bound`,
      );
    }
  }
  return prepared.map(({ path, max, prepared: source }) => ({ path, max, prepared: source }));
}

export async function preparedBody(
  prepared: PreparedAssetSource,
): Promise<BlobLike | ReadableStream<Uint8Array>> {
  if (isBlobLike(prepared.source)) return prepared.source;
  if (prepared.body) return prepared.body;
  const reopened = (await prepareAssetSource(prepared.source)).body;
  if (!reopened) throw new AssetInputError("E_ASSET_TYPE", `native asset URI ${prepared.source.uri} has no body`);
  return reopened;
}

export function withProgress(
  body: BlobLike | ReadableStream<Uint8Array>,
  bytes: number,
  options: AssetUploadOptions,
): BlobLike | ReadableStream<Uint8Array> {
  const callback = options.onProgress;
  if (!callback) return body;
  const source = isBlobLike(body) ? body.stream() : body;
  const reader = source.getReader();
  let loaded = 0;
  callback({ loaded, total: bytes });
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        loaded = bytes;
        callback({ loaded, total: bytes });
        controller.close();
        return;
      }
      loaded = Math.min(bytes, loaded + next.value.byteLength);
      callback({ loaded, total: bytes });
      controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function setAtPath(value: unknown, path: readonly (string | number)[], replacement: AssetRecord): unknown {
  if (path.length === 0) return replacement;
  const [head, ...tail] = path;
  if (Array.isArray(value) && typeof head === "number") {
    const copy = [...value];
    copy[head] = setAtPath(copy[head], tail, replacement);
    return copy;
  }
  if (isRecord(value) && typeof head === "string") {
    return { ...value, [head]: setAtPath(value[head], tail, replacement) };
  }
  throw new AssetInputError("E_ASSET_TYPE", `asset argument path ${path.join(".")} no longer matches its manifest descriptor`);
}

export function substituteAssetRecords(
  args: unknown,
  placements: readonly AssetPlacement[],
  records: readonly AssetRecord[],
): unknown {
  if (placements.length !== records.length) throw new AssetInputError("E_ASSET_NOT_READY", "an asset upload did not produce a record");
  return placements.reduce((value, placement, index) => setAtPath(value, placement.path, records[index]!), args);
}

function positiveInteger(record: Record<string, unknown>, field: string, surface: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new AssetInputError("E_ASSET_TYPE", `${surface}.${field} must be a positive integer`);
  }
  return value;
}

function checkedAssetRecord(value: unknown, surface: string): ImageAsset | VideoAsset {
  if (!isRecord(value)) throw new AssetInputError("E_ASSET_TYPE", `${surface} must be an asset record`);
  const keys = Object.keys(value).sort();
  const video = Object.hasOwn(value, "duration");
  const expected = (video ? ["duration", "height", "id", "width"] : ["height", "id", "width"]);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new AssetInputError("E_ASSET_TYPE", `${surface} must contain exactly ${expected.join(", ")}`);
  }
  if (typeof value.id !== "string"
    || !/^s2id-[0-9a-f]{32}-[0-9a-f]{16}$/.test(value.id)
    || /-0{16}$/.test(value.id)) {
    throw new AssetInputError("E_ASSET_TYPE", `${surface}.id must be an engine-minted id`);
  }
  const record = {
    id: value.id,
    width: positiveInteger(value, "width", surface),
    height: positiveInteger(value, "height", surface),
  };
  // The brand is type-level only; the wire record carries exactly the checked fields.
  return (video ? { ...record, duration: positiveInteger(value, "duration", surface) } : record) as ImageAsset | VideoAsset;
}

export function assetRecord(value: unknown): ImageAsset | VideoAsset {
  return checkedAssetRecord(value, "upload response");
}

export function assetPath(baseUrl: string, asset: AssetRecord, width?: number, carrier?: string): string {
  const record = checkedAssetRecord(asset, "asset URL record");
  if (width !== undefined && (!Number.isSafeInteger(width) || width <= 0)) {
    throw new AssetInputError("E_ASSET_TYPE", "asset width must be a positive integer");
  }
  const query = new URLSearchParams();
  if (width !== undefined) query.set("w", String(width));
  if (carrier !== undefined) {
    if (!("duration" in record)) {
      throw new AssetInputError("E_ASSET_CARRIER_IMAGE", "image asset URLs never carry a session token; fetch the URL with assetHeaders or assetBlob");
    }
    query.set("s", carrier);
  }
  const suffix = query.size === 0 ? "" : `?${query}`;
  return `${baseUrl}/api/asset/${encodeURIComponent(record.id)}${suffix}`;
}
