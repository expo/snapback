// The asset arm of the client — uploads, delivery URLs, header credentials,
// and the byte fetch — as functions over the small host surface the client
// exposes, so `client.ts` stays under the file cap without changing behavior.
import {
  AssetInputError,
  assetPath,
  assetRecord,
  expoUploadFetch,
  isBlobLike,
  isBrowserFile,
  isNativeAssetSource,
  prepareAssetSource, mayNeedAssetPlanning, planAssetArguments, substituteAssetRecords,
  preparedBody,
  withProgress,
  type PreparedAssetSource,
} from "./assets.js";
import { assetBlobTarget, cachedAssetBlob, cachedAssetBytes, viewedAssetIds, type AssetBlobTarget } from "./client-assets.js";
import { offlineNetworkRefusal } from "./client-offline.js";
import { SnapbackRefusal, isSnapbackRefusal, responseRefusal, wireAssetSession, wireObject, wireShape, withAbort } from "./client-wire.js";
import type { AssetBytes, AssetFetchOptions, ByteCache } from "./store/byte-cache.js";
import type {
  AssetRecord, Manifest, MutationResult, UploadListing,
  AssetUploadOptions,
  AssetUploadSource,
  AssetUrlOptions,
  RefusalEnvelope,
} from "./types.js";

/** The authority snapshot every request is fenced by (LLP 1002 §9). */
export interface Authority {
  authGeneration: number;
  custodyGeneration: number;
  fence: number;
  token?: string;
}

export interface CarrierSession {
  token: string;
  expiresAt: number;
  authGeneration: number;
  custodyGeneration: number;
  fence: number;
}

/** What the client lends the asset arm; the class satisfies it structurally. */
export interface UploadHost {
  readonly url: string;
  readonly persona?: string;
  readonly assetCache?: ByteCache;
  readonly fetchImpl: typeof globalThis.fetch;
  readonly customFetch: boolean;
  carrier?: CarrierSession;
  headers(authority: Authority, stream?: boolean, hasBody?: boolean): Headers;
  json(path: string, init: RequestInit, authority: Authority): Promise<unknown>;
  ensureAuthority(authority: Authority | undefined): asserts authority is Authority;
  recordRefusal(envelope: RefusalEnvelope): void;
  validated(authority: Authority | undefined): void;
  networkRefusal(message: string): SnapbackRefusal;
  transportRefusal(message: string): SnapbackRefusal;
}

/** Recovery uses normal principal authentication, never a media session carrier. */
export async function listUploadsFor(host: UploadHost, options: { after?: string }, authority: Authority): Promise<UploadListing> {
  const query = options.after === undefined ? "" : `?after=${encodeURIComponent(options.after)}`;
  const result = wireObject(await host.json(`/api/uploads${query}`, { method: "GET" }, authority), "upload listing");
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
  for (const key of ["usage", "limits"]) {
    const usage = wireObject(result[key], `upload listing.${key}`);
    if (!count(usage.bytes) || !count(usage.objects)) throw wireShape(`upload listing.${key} must contain byte and object counts`);
  }
  if (!Array.isArray(result.uploads) || result.uploads.length > 100) throw wireShape("upload listing.uploads must contain at most 100 uploads");
  for (const value of result.uploads) {
    const upload = wireObject(value, "unclaimed upload");
    if (typeof upload.id !== "string" || !upload.id || (upload.kind !== "image" && upload.kind !== "video")
      || (upload.state !== "receiving" && upload.state !== "ready") || !count(upload.bytes)
      || !Number.isSafeInteger(upload.createdAt)) throw wireShape("invalid unclaimed upload");
  }
  if (result.next !== null && (typeof result.next !== "string" || !result.next)) throw wireShape("upload listing.next must be a cursor or null");
  return result as unknown as UploadListing;
}

export async function discardUploadFor(host: UploadHost, id: string, authority: Authority, signal?: AbortSignal): Promise<boolean> {
  const result = wireObject(await host.json("/api/uploads/discard", {
    method: "POST", body: JSON.stringify({ id }), signal,
  }, authority), "discard upload response");
  if (typeof result.discarded !== "boolean") throw wireShape("discard upload response.discarded must be a boolean");
  return result.discarded;
}

async function discardAutomaticUploads(host: UploadHost, records: readonly AssetRecord[], authority: Authority): Promise<void> {
  // Best effort with a bounded wait. Lost credentials/transport leave discoverable
  // uploads; cleanup must not replace the mutation's original result or error.
  for (const record of records) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try { await withAbort(controller.signal, () => discardUploadFor(host, record.id, authority, controller.signal)); }
    catch { /* Explicit recovery and the grace sweep remain available. */ }
    finally { clearTimeout(timer); }
  }
}

// @ref LLP 1006#10-clients — substitute under the descriptor fence and dispose
// only uploads made by this call after a definitive refusal or before submission.
export async function withMutationUploads<Result>(
  host: UploadHost, operation: string, args: unknown, authority: Authority,
  manifest: () => Promise<Manifest>,
  submit: (args: unknown, onCustody: (kind: "wire" | "outbox") => void) => Promise<MutationResult<Result>>,
): Promise<MutationResult<Result>> {
  const records: AssetRecord[] = [];
  let custody: "wire" | "outbox" | undefined;
  try {
    let mutationArgs = args;
    if (mayNeedAssetPlanning(args)) {
      const descriptorManifest = await manifest();
      const descriptor = descriptorManifest.ops[operation]?.args;
      if (descriptor === undefined) throw assetInput(host, new AssetInputError("E_ASSET_TYPE",
        `manifest generation ${descriptorManifest.generation} has no argument descriptor for ${operation}`));
      const placements = await planAssetArguments(args, descriptor)
        .catch((error) => { throw assetInput(host, error); });
      if (placements.length > 0) {
        for (const placement of placements) records.push(await uploadPrepared(host, placement.prepared, {}, authority));
        const current = await manifest();
        if (current.generation !== descriptorManifest.generation) throw assetInput(host, new AssetInputError("E_ASSET_NOT_READY",
          `descriptor generation changed from ${descriptorManifest.generation} to ${current.generation} during asset upload`));
        mutationArgs = substituteAssetRecords(args, placements, records);
      }
    }
    const result = await submit(mutationArgs, (kind) => { custody = kind; });
    if (result.state === "rejected") await discardAutomaticUploads(host, records, authority);
    return result;
  } catch (error) {
    // Admission/prediction failures precede custody. Once persistence or the
    // network is attempted, ambiguous failures retain bytes for possible replay.
    if (custody === undefined || (custody === "wire" && isSnapbackRefusal(error) && !error.retryable
      && error.code !== "E_WIRE_SHAPE" && error.status !== undefined && error.status >= 400 && error.status < 500)) {
      await discardAutomaticUploads(host, records, authority);
      if (isSnapbackRefusal(error)) host.recordRefusal(error.envelope);
    }
    throw error;
  }
}

export async function uploadAsset(
  host: UploadHost,
  source: AssetUploadSource,
  options: AssetUploadOptions,
  authority: Authority,
): Promise<AssetRecord> {
  const prepared = await prepareAssetSource(source)
    .catch((error) => { throw assetInput(host, error); });
  return uploadPrepared(host, prepared, options, authority);
}

export async function assetUrlFor(
  host: UploadHost,
  assetOrList: AssetRecord | readonly AssetRecord[] | null | undefined,
  options: AssetUrlOptions,
  authority: Authority,
): Promise<string | string[] | undefined> {
  const records = Array.isArray(assetOrList)
    ? assetOrList
    : assetOrList == null ? [] : [assetOrList as AssetRecord];
  const viewed = await viewedAssetIds(host.assetCache, records.map((asset) => asset.id));
  host.ensureAuthority(authority);
  const mintable = records.filter((asset) => !viewed.has(asset.id));
  const wantsCarrier = options.carrier === true || options.download === true;
  if (wantsCarrier && mintable.some((asset) => !("duration" in asset))) {
    throw assetInput(host, new AssetInputError(
      "E_ASSET_CARRIER_IMAGE",
      "image asset URLs never carry a session token; fetch the URL with assetHeaders or assetBlob",
    ));
  }
  let carrier: string | undefined;
  if (wantsCarrier && mintable.length > 0 && (authority.token !== undefined || host.persona !== undefined)) {
    carrier = await assetCarrier(host, authority);
  }
  try {
    if (Array.isArray(assetOrList)) {
      return mintable.map((asset) => assetPath(host.url, asset, options.width, carrier));
    }
    return assetOrList == null || viewed.has((assetOrList as AssetRecord).id)
      ? undefined
      : assetPath(host.url, assetOrList as AssetRecord, options.width, carrier);
  } catch (error) {
    throw assetInput(host, error);
  }
}

export function assetHeadersFor(host: UploadHost, authority: Authority): Record<string, string> {
  const headers: Record<string, string> = {};
  if (authority.token) headers.Authorization = `Bearer ${authority.token}`;
  if (host.persona) headers["X-Snapback-As"] = host.persona;
  return headers;
}

export async function assetBlobFor(
  host: UploadHost,
  bytes: ByteCache | undefined,
  offline: () => boolean,
  url: string,
  options: AssetFetchOptions,
  authority: Authority,
): Promise<Blob> {
  let target: AssetBlobTarget;
  try { target = assetBlobTarget(host.url, url); } catch (error) { throw assetInput(host, error); }
  return cachedAssetBlob(bytes, target, async () => {
    if (offline()) throw offlineNetworkRefusal();
    const headers = host.headers(authority);
    headers.set("Accept", "*/*");
    // Expo SDK 54 ignores RequestInit.cache but forwards these headers.
    // Private owner responses also forbid storage (LLP 1012 §9).
    headers.set("Cache-Control", "no-store");
    const response = await fetchResponse(host, url, { headers, signal: options.signal, cache: "no-store" }, authority);
    host.validated(authority);
    return response.blob();
  }, (refusal) => host.recordRefusal(refusal), () => host.ensureAuthority(authority), options.viewing);
}

export async function assetBytesFor(
  host: UploadHost, cache: ByteCache | undefined, offline: () => boolean, url: string,
  options: AssetFetchOptions, authority: Authority,
): Promise<AssetBytes> {
  let target: AssetBlobTarget;
  try { target = assetBlobTarget(host.url, url); } catch (error) { throw assetInput(host, error); }
  return cachedAssetBytes(cache, target, async () => {
    if (offline()) throw offlineNetworkRefusal();
    const headers = host.headers(authority);
    headers.set("Accept", "*/*");
    // Expo SDK 54 ignores RequestInit.cache but forwards these headers.
    // Private owner responses also forbid storage (LLP 1012 §9).
    headers.set("Cache-Control", "no-store");
    const response = await fetchResponse(host, url, { headers, signal: options.signal, cache: "no-store" }, authority);
    const bytes = new Uint8Array(await response.arrayBuffer());
    host.ensureAuthority(authority);
    host.validated(authority);
    return { bytes, type: response.headers.get("Content-Type") ?? "application/octet-stream" };
  }, (refusal) => host.recordRefusal(refusal), () => host.ensureAuthority(authority), options.viewing);
}

export async function uploadPrepared(
  host: UploadHost,
  prepared: PreparedAssetSource,
  options: AssetUploadOptions,
  authority: Authority,
): Promise<AssetRecord> {
  host.ensureAuthority(authority);
  let response: Response;
  if (options.onProgress && isBrowserFile(prepared.source) && !host.customFetch
    && typeof XMLHttpRequest === "function") {
    response = await xhrUpload(host, prepared.source, prepared.bytes, options, authority);
  } else {
    let body;
    try {
      body = await preparedBody(prepared);
    } catch (error) {
      throw assetInput(host, error);
    }
    const headers = host.headers(authority);
    headers.set("Content-Length", String(prepared.bytes));
    const nativeExpoFile = isNativeAssetSource(prepared.source)
      && !/^(?:data|https?):/i.test(prepared.source.uri)
      && isBlobLike(body);
    if (nativeExpoFile) {
      let nativeFetch: typeof globalThis.fetch;
      try {
        nativeFetch = await expoUploadFetch();
      } catch (error) {
        throw assetInput(host, error);
      }
      options.onProgress?.({ loaded: 0, total: prepared.bytes });
      response = await fetchResponse(host, `${host.url}/api/upload`, {
        method: "POST",
        headers,
        body: body as unknown as BodyInit,
      }, authority, nativeFetch);
      options.onProgress?.({ loaded: prepared.bytes, total: prepared.bytes });
    } else {
      body = withProgress(body, prepared.bytes, options);
      const stream = !isBlobLike(body);
      response = await fetchResponse(host, `${host.url}/api/upload`, {
        method: "POST",
        headers,
        body: body as unknown as BodyInit,
        ...(stream ? { duplex: "half" } as RequestInit : {}),
      }, authority);
    }
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw assetInput(host, new AssetInputError("E_ASSET_TYPE", "upload response must contain valid JSON"));
  }
  try {
    const record = assetRecord(value);
    const produced = Object.hasOwn(record, "duration") ? "video" : "image";
    if (options.kind && options.kind !== produced) {
      await discardAutomaticUploads(host, [record], authority);
      throw new AssetInputError("E_ASSET_TYPE", `upload produced ${produced === "image" ? "an image" : "a video"} asset but kind ${options.kind} was requested`);
    }
    host.validated(authority);
    return record;
  } catch (error) {
    throw assetInput(host, error);
  }
}

function xhrUpload(
  host: UploadHost,
  file: File | Blob,
  bytes: number,
  options: AssetUploadOptions,
  authority: Authority,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${host.url}/api/upload`);
    for (const [name, value] of host.headers(authority)) xhr.setRequestHeader(name, value);
    options.onProgress?.({ loaded: 0, total: bytes });
    xhr.upload.onprogress = (event) => options.onProgress?.({
      loaded: Math.min(bytes, event.loaded),
      total: bytes,
    });
    xhr.onerror = () => reject(host.networkRefusal("asset upload failed"));
    xhr.onabort = () => reject(host.networkRefusal("asset upload was aborted"));
    xhr.onload = () => {
      try {
        host.ensureAuthority(authority);
        options.onProgress?.({ loaded: bytes, total: bytes });
        resolve(new Response(xhr.responseText, {
          status: xhr.status,
          headers: { "Content-Type": xhr.getResponseHeader("Content-Type") ?? "application/json" },
        }));
      } catch (error) {
        reject(error);
      }
    };
    xhr.send(file);
  }).then(async (response) => {
    if (response.ok) return response;
    if (response.status >= 400 && response.status < 500) {
      const refusal = await responseRefusal(response);
      host.recordRefusal(refusal.envelope);
      throw refusal;
    }
    throw host.transportRefusal(`/api/upload returned HTTP ${response.status}`);
  });
}

async function fetchResponse(
  host: UploadHost,
  url: string,
  init: RequestInit,
  authority: Authority,
  fetchImpl: typeof globalThis.fetch = host.fetchImpl,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    host.ensureAuthority(authority);
    throw host.networkRefusal(error instanceof Error ? error.message : String(error));
  }
  host.ensureAuthority(authority);
  if (response.ok) return response;
  if (response.status >= 400 && response.status < 500) {
    const refusal = await responseRefusal(response);
    host.recordRefusal(refusal.envelope);
    throw refusal;
  }
  throw host.transportRefusal(`${new URL(url).pathname} returned HTTP ${response.status}`);
}

async function assetCarrier(host: UploadHost, authority: Authority): Promise<string> {
  const refreshBefore = Date.now() + 60_000;
  if (host.carrier
    && host.carrier.authGeneration === authority.authGeneration
    && host.carrier.custodyGeneration === authority.custodyGeneration
    && host.carrier.fence === authority.fence
    && host.carrier.expiresAt > refreshBefore) return host.carrier.token;
  const carrier = wireAssetSession(await host.json(
    "/api/auth/asset-session",
    { method: "POST", body: JSON.stringify({}) },
    authority,
  ));
  host.ensureAuthority(authority);
  host.carrier = {
    token: carrier.token,
    expiresAt: carrier.expiresAt,
    authGeneration: authority.authGeneration,
    custodyGeneration: authority.custodyGeneration,
    fence: authority.fence,
  };
  return carrier.token;
}

export function assetInput(host: UploadHost, error: unknown): SnapbackRefusal {
  if (isSnapbackRefusal(error)) return error;
  const input = error instanceof AssetInputError
    ? error
    : new AssetInputError("E_ASSET_TYPE", error instanceof Error ? error.message : String(error));
  const refusal = new SnapbackRefusal({
    code: input.code,
    family: "input",
    message: input.message,
    rewrite: "pass a File or { uri, size?/fileSize?, type?/mimeType? } only to a matching manifest asset argument",
    guide: "assets/client",
  });
  host.recordRefusal(refusal.envelope);
  return refusal;
}
