import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, opendir, rename, rm, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { findMediaHelper, SubprocessMediaValidator, type AssetKind, type MediaFacts, type MediaValidator } from "./media.js";
import { OwnerError, type WorkerTransport } from "./worker.js";

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const MAX_ACTIVE_UPLOADS = 8;
const CARRIER_LIFETIME_MS = 10 * 60_000;
const CARRIER_REUSE_FRESH_MS = 60_000;
const MAX_CARRIERS = 1_024;
const MAX_CARRIERS_PER_PRINCIPAL = 32;
const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SCRATCH_DIRECTORY = /^request-[1-9][0-9]*-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface AssetRecord {
  id: string;
  width: number;
  height: number;
  duration?: number;
}

interface Delivery extends MediaFacts {
  kind: AssetKind;
  public: boolean;
  once: boolean;
  seq?: number;
}

export type AssetCredential =
  | { kind: "public" }
  | { kind: "header"; token: string }
  | { kind: "carrier"; token: string };

interface MediaCarrier {
  token: string;
  sessionToken: string;
  principal: string;
  authEpoch: number;
  expiresAt: number;
}

interface OwnedTask {
  kind: "upload" | "delivery";
  request: IncomingMessage;
  response?: ServerResponse;
  settled: Promise<void>;
}

export interface AssetRuntimeOptions {
  root: string;
  worker: WorkerTransport;
  validator?: MediaValidator;
  onCommit?: (details: { seq: number }) => void;
  /** Internal cadence controls used by focused lifecycle tests. */
  reclaimIntervalMs?: number;
  reclaimRetryMs?: number;
  /** Narrow durability fault boundary used by focused reclamation tests. */
  reclaimDirectorySync?: (path: string) => Promise<void>;
  /** Narrow original-stage durability seams used by lifecycle fault tests. */
  stageUnlink?: (path: string) => Promise<void>;
  stageDirectorySync?: (path: string) => Promise<void>;
  shutdownMs?: number;
  now?: () => number;
  carrierLimit?: number;
  carrierPrincipalLimit?: number;
}

export class AssetRuntime {
  private readonly mediaRoot: string;
  private readonly staging: string;
  private readonly blobs: string;
  private readonly scratch: string;
  private validator?: MediaValidator;
  private activeUploads = 0;
  private readonly activeIds = new Map<string, number>();
  private readonly tasks = new Set<OwnedTask>();
  private readonly activeScratch = new Set<string>();
  private readonly carriers = new Map<string, MediaCarrier>();
  private reclaimTimer?: ReturnType<typeof setTimeout>;
  private reclaiming?: Promise<boolean>;
  private reclaimAgain = false;
  private scratchTimer?: ReturnType<typeof setTimeout>;
  private scratchRecovering?: Promise<void>;
  private closed = false;
  private closing?: Promise<void>;

  private constructor(private readonly options: AssetRuntimeOptions) {
    this.mediaRoot = join(resolve(options.root), ".snapback3", "media");
    this.staging = join(this.mediaRoot, "staging");
    this.blobs = join(this.mediaRoot, "blobs");
    this.scratch = join(this.mediaRoot, "scratch");
    this.validator = options.validator;
  }

  static async open(options: AssetRuntimeOptions): Promise<AssetRuntime> {
    const runtime = new AssetRuntime(options);
    await secureDirectory(runtime.mediaRoot);
    await secureDirectory(runtime.staging);
    await secureDirectory(runtime.blobs);
    await secureDirectory(runtime.scratch);
    runtime.scheduleScratchRecovery(0);
    runtime.scheduleReclaim(0);
    return runtime;
  }

  // @ref LLP 1006#5-upload-one-post — the media route streams independently
  // of the bounded JSON reader and returns only after durable finalize.
  upload(request: IncomingMessage, token: string, kind: AssetKind): Promise<AssetRecord> {
    this.assertOpen();
    if (this.activeUploads >= MAX_ACTIVE_UPLOADS) {
      request.pause();
      throw new OwnerError("S3_OWNER_BUSY", "Too many media uploads are active; retry shortly.");
    }
    this.activeUploads++;
    return this.ownTask("upload", request, undefined, this.runUpload(request, token, kind));
  }

  private async runUpload(request: IncomingMessage, token: string, kind: AssetKind): Promise<AssetRecord> {
    request.setTimeout(120_000, () => request.destroy(new OwnerError("S3_ASSET_UPLOAD_TIMEOUT", "Asset upload timed out; retry from the beginning.")));
    let id: string | undefined;
    let stagePath: string | undefined;
    let rawPath: string | undefined;
    let validatedPath: string | undefined;
    let scratchPath: string | undefined;
    let finalizeUncertain = false;
    try {
      const declaredType = uploadContentType(request, kind);
      const hardMax = kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
      const declaredBytes = contentLength(request, hardMax);
      const validator = this.mediaValidator();
      let maxBytes = hardMax;
      scratchPath = await this.createScratchDirectory();

      if (declaredBytes !== undefined) {
        const begun = parseBegin(await this.options.worker.request("asset.begin", { token, kind, bytes: declaredBytes }), kind);
        id = begun.id;
        this.acquireId(id);
        maxBytes = Math.min(hardMax, begun.maxBytes);
        if (declaredBytes > maxBytes) throw new OwnerError("S3_ASSET_TOO_LARGE", `Upload exceeds the active ${maxBytes}-byte ${kind} bound.`);
        stagePath = this.stagePath(id);
        await streamUpload(request, stagePath, maxBytes, declaredBytes);
      } else {
        await this.options.worker.request("authenticate", { token });
        rawPath = join(scratchPath, "upload");
        const received = await streamUpload(request, rawPath, hardMax);
        const begun = parseBegin(await this.options.worker.request("asset.begin", { token, kind, bytes: received }), kind);
        id = begun.id;
        this.acquireId(id);
        maxBytes = Math.min(hardMax, begun.maxBytes);
        if (received > maxBytes) throw new OwnerError("S3_ASSET_TOO_LARGE", `Upload exceeds the active ${maxBytes}-byte ${kind} bound.`);
        stagePath = this.stagePath(id);
        await durableRename(rawPath, stagePath);
        rawPath = undefined;
      }

      validatedPath = join(scratchPath, "validated");
      const facts = await validator.validate(kind, stagePath, validatedPath);
      if (facts.type !== declaredType) {
        throw new OwnerError("S3_ASSET_TYPE", `Content-Type ${declaredType} does not match detected ${facts.type} bytes.`);
      }
      if (facts.bytes > maxBytes || facts.bytes > hardMax) {
        throw new OwnerError("S3_ASSET_TOO_LARGE", `Finalized media exceeds the active ${maxBytes}-byte ${kind} bound.`);
      }
      validateFacts(facts, kind);
      await this.reserveWithRecovery(token, id, facts.bytes);
      await durablePublish(validatedPath, this.blobPath(id), this.blobs);
      validatedPath = undefined;
      // Ready is not attachable until the metadata-bearing original is gone
      // and its directory entry is durable. Failure leaves the ledger row in
      // receiving/discard custody, so reclamation owns both exact paths.
      await (this.options.stageUnlink ?? unlink)(stagePath);
      await (this.options.stageDirectorySync ?? syncDirectory)(this.staging);
      stagePath = undefined;
      return await this.finalizeWithRecovery(token, id, kind, facts);
    } catch (error) {
      finalizeUncertain = error instanceof OwnerError && error.code === "S3_ASSET_FINALIZE_UNKNOWN";
      // The HTTP refusal closes an incomplete request after writing its small
      // response. Pausing here prevents an uncounted body drain while ledger
      // and scratch cleanup still own this admitted slot.
      if (!request.complete) request.pause();
      if (id && !finalizeUncertain) {
        await this.tryDiscard(token, id);
      }
      if (!finalizeUncertain) {
        await Promise.all([
          rawPath && rm(rawPath, { force: true }),
          validatedPath && rm(validatedPath, { force: true }),
        ].filter((value): value is Promise<void> => Boolean(value)));
      }
      this.scheduleReclaim(0);
      throw error;
    } finally {
      if (id) this.releaseId(id);
      if (scratchPath) await this.releaseScratchDirectory(scratchPath);
      this.activeUploads--;
    }
  }

  async status(token: string, id: string): Promise<{ state: "receiving" | "ready" } | null> {
    this.assertOpen();
    id = assetId(id);
    const value = await this.options.worker.request("asset.status", { token, id });
    if (value === null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid asset status.");
    }
    const state = (value as Record<string, unknown>).state;
    if ((value as Record<string, unknown>).id !== id || (state !== "receiving" && state !== "ready")) {
      throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid asset status.");
    }
    // Public recovery exposes only the lifecycle decision, not ledger custody,
    // accounting, timestamps, or storage facts.
    return { state };
  }

  async discard(token: string, id: string): Promise<{ discarded: boolean }> {
    this.assertOpen();
    return this.discardOwned(token, id);
  }

  private async discardOwned(token: string, id: string): Promise<{ discarded: boolean }> {
    id = assetId(id);
    const result = await this.options.worker.request<Record<string, unknown>>("asset.discard", { token, id });
    if (!result || typeof result.discarded !== "boolean") throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid asset discard result.");
    if (result.discarded) this.scheduleReclaim(0);
    return { discarded: result.discarded };
  }

  // @ref LLP 1006#2b-the-session-carrier-author-ruling-2026-09-03 — browser
  // players receive a bounded, expiring, media-route-only opaque carrier. The
  // exact application session remains only in this owner's memory.
  async createSession(token: string): Promise<{ token: string; expiresAt: number }> {
    this.assertOpen();
    const authority = parseSessionAuthority(await this.options.worker.request("authenticate", { token }));
    const now = this.now();
    this.purgeCarriers(now);
    const expiresAt = Math.min(authority.expiresAt, now + CARRIER_LIFETIME_MS);
    if (expiresAt <= now) throw new OwnerError("S3_AUTH", "Sign in again before creating a media session.");
    for (const entry of this.carriers.values()) {
      if (entry.sessionToken === token && entry.authEpoch === authority.authEpoch
        && entry.principal === authority.principal && entry.expiresAt > now + CARRIER_REUSE_FRESH_MS) {
        return { token: entry.token, expiresAt: entry.expiresAt };
      }
    }
    const globalLimit = boundedCount(this.options.carrierLimit, MAX_CARRIERS);
    const principalLimit = boundedCount(this.options.carrierPrincipalLimit, MAX_CARRIERS_PER_PRINCIPAL);
    if (this.carriers.size >= globalLimit
      || [...this.carriers.values()].filter(entry => entry.principal === authority.principal).length >= principalLimit) {
      throw new OwnerError("S3_OWNER_BUSY", "This owner has reached its bounded media-session capacity.");
    }
    let carrier: string | undefined;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = randomBytes(32).toString("base64url");
      if (!this.carriers.has(candidate)) { carrier = candidate; break; }
    }
    if (!carrier) throw new OwnerError("S3_ASSET_STORAGE", "Could not allocate a unique media-session carrier.");
    this.carriers.set(carrier, {
      token: carrier, sessionToken: token, principal: authority.principal,
      authEpoch: authority.authEpoch, expiresAt,
    });
    return { token: carrier, expiresAt };
  }

  // @ref LLP 1006#2-authority-delivery-is-by-the-row-that-holds-it — every
  // external byte read asks the worker for current row/session authorization.
  serve(request: IncomingMessage, response: ServerResponse, credential: AssetCredential, id: string): Promise<void> {
    this.assertOpen();
    return this.ownTask("delivery", request, response, this.runServe(request, response, credential, id));
  }

  private async runServe(request: IncomingMessage, response: ServerResponse, credential: AssetCredential, id: string): Promise<void> {
    id = assetId(id);
    this.acquireId(id);
    try {
      const token = credential.kind === "header"
        ? credential.token
        : credential.kind === "carrier"
          ? await this.resolveCarrier(credential.token)
          : undefined;
      const preflight = credential.kind === "public"
        ? parsePublicDelivery(await this.options.worker.request("asset.delivery.public", { id }))
        : parseDelivery(await this.options.worker.request("asset.delivery", { token, id }), false);
      const etag = `"${id}"`;
      if (request.method === "HEAD") {
        const handle = await openBlob(this.blobPath(id), preflight.bytes);
        try {
          const headers = deliveryHeaders(preflight, etag, credential.kind);
          if (!preflight.once && etagMatches(request.headers["if-none-match"], etag)) {
            response.writeHead(304, withoutBodyHeaders(headers));
          } else {
            response.writeHead(200, { ...headers, "Content-Length": preflight.bytes });
          }
          response.end();
        } finally {
          await handle.close();
        }
        return;
      }

      // Open and stat before asset.open: missing/corrupt physical bytes must not
      // burn a once view. Keep this descriptor through streaming so the path
      // cannot be replaced after the atomic authorization/consume decision.
      const handle = await openBlob(this.blobPath(id), preflight.bytes);
      try {
        const delivery = credential.kind === "public"
          ? preflight
          : parseDelivery(await this.options.worker.request("asset.open", { token, id }), true);
        if (!sameDelivery(preflight, delivery)) throw new OwnerError("S3_ASSET_BYTES_UNAVAILABLE", "Asset metadata changed while opening; retry the request.");
        if (delivery.once) this.options.onCommit?.({ seq: delivery.seq! });
        const headers = deliveryHeaders(delivery, etag, credential.kind);
        if (!delivery.once && etagMatches(request.headers["if-none-match"], etag)) {
          response.writeHead(304, withoutBodyHeaders(headers));
          response.end();
          return;
        }
        const range = delivery.once ? undefined : parseRange(request.headers.range, delivery.bytes);
        if (range === null) {
          response.writeHead(416, { ...headers, "Content-Range": `bytes */${delivery.bytes}`, "Content-Length": 0 });
          response.end();
          return;
        }
        const start = range?.start ?? 0;
        const end = range?.end ?? delivery.bytes - 1;
        const length = end - start + 1;
        response.writeHead(range ? 206 : 200, {
          ...headers,
          "Content-Length": length,
          ...(range ? { "Content-Range": `bytes ${start}-${end}/${delivery.bytes}` } : {}),
        });
        await pipeline(handle.createReadStream({ autoClose: false, start, end }), response);
      } finally {
        await handle.close();
      }
    } finally {
      this.releaseId(id);
    }
  }

  async close(): Promise<void> {
    return this.closing ??= this.closeOnce();
  }

  private async closeOnce(): Promise<void> {
    this.closed = true;
    clearTimeout(this.reclaimTimer);
    this.reclaimTimer = undefined;
    clearTimeout(this.scratchTimer);
    this.scratchTimer = undefined;
    this.carriers.clear();
    const tasks = [...this.tasks];
    for (const task of tasks) {
      const error = new OwnerError("S3_OWNER_CLOSED", "The asset owner is stopping.");
      if (task.kind === "upload") {
        task.request.pause();
        task.request.destroy(error);
      } else {
        task.response?.destroy(error);
        task.request.destroy(error);
      }
    }
    const validatorClose = this.validator?.close();
    const joined = Promise.allSettled([
      ...tasks.map(task => task.settled),
      ...(this.reclaiming ? [this.reclaiming] : []),
      ...(this.scratchRecovering ? [this.scratchRecovering] : []),
      ...(validatorClose ? [validatorClose] : []),
    ]);
    const results = await within(joined, boundedPositive(this.options.shutdownMs, 15_000));
    if (!results) {
      // An admitted ledger row and/or exact request-* scratch directory is the
      // durable cleanup obligation a successor owner will resume. Never wait
      // without a bound or pretend the cleanup completed.
      throw new OwnerError("S3_ASSET_SHUTDOWN_TIMEOUT", "Asset work did not settle before the shutdown bound; durable ledger/scratch cleanup remains for restart.");
    }
    const validatorIndex = results.length - (validatorClose ? 1 : 0);
    if (validatorClose) {
      const result = results[validatorIndex];
      if (result?.status === "rejected") throw result.reason;
    }
  }

  private mediaValidator(): MediaValidator {
    if (this.validator) return this.validator;
    this.validator = new SubprocessMediaValidator({ command: findMediaHelper(this.options.root) });
    return this.validator;
  }

  private async reserveWithRecovery(token: string, id: string, bytes: number): Promise<void> {
    const reserve = async () => parseReserve(await this.options.worker.request("asset.reserve", { token, id, bytes }), id, bytes);
    try { await reserve(); }
    catch (error) {
      if (!workerOutcomeMayBeUnknown(error)) throw error;
      try { await reserve(); return; }
      catch (retry) {
        if (!workerOutcomeMayBeUnknown(retry)) throw retry;
      }
      throw new OwnerError("S3_ASSET_RESERVE_UNKNOWN", `Finalized growth for asset ${id} may be reserved; retry cleanup or inspect status before publishing.`);
    }
  }

  private async finalizeWithRecovery(token: string, id: string, kind: AssetKind, facts: MediaFacts): Promise<AssetRecord> {
    const finalize = async () => parseAssetRecord(await this.options.worker.request("asset.finalize", { token, id, facts }), kind, id);
    try {
      return await finalize();
    } catch (error) {
      if (!workerOutcomeMayBeUnknown(error)) throw error;
      try {
        const status = await this.options.worker.request("asset.status", { token, id });
        const recovered = recordFromStatus(status, kind, id);
        if (recovered) return recovered;
        if (status && typeof status === "object" && ["receiving", "ready"].includes((status as Record<string, unknown>).state as string)) {
          // Finalize is idempotent for the same trusted facts. A ready status
          // may be the durable outcome whose response was lost.
          return await finalize();
        }
      } catch (recovery) {
        if (!workerOutcomeMayBeUnknown(recovery)) throw recovery;
      }
      throw new OwnerError("S3_ASSET_FINALIZE_UNKNOWN", `Asset ${id} may have finalized. Check its status before discarding or retrying.`);
    }
  }

  private async tryDiscard(token: string, id: string): Promise<boolean> {
    try { return (await this.discardOwned(token, id)).discarded; }
    catch { return false; }
  }

  private assertOpen(): void {
    if (this.closed) throw new OwnerError("S3_OWNER_CLOSED", "The asset runtime is closed.");
  }

  private ownTask<T>(kind: OwnedTask["kind"], request: IncomingMessage, response: ServerResponse | undefined, operation: Promise<T>): Promise<T> {
    const task = { kind, request, response, settled: operation.then(() => undefined, () => undefined) } satisfies OwnedTask;
    this.tasks.add(task);
    void task.settled.then(() => this.tasks.delete(task));
    return operation;
  }

  private async resolveCarrier(token: string): Promise<string> {
    const now = this.now();
    this.purgeCarriers(now);
    const entry = this.carriers.get(token);
    if (!entry || entry.expiresAt <= now) throw assetUnavailable();
    let authority: ReturnType<typeof parseSessionAuthority>;
    try {
      authority = parseSessionAuthority(await this.options.worker.request("authenticate", { token: entry.sessionToken }));
    } catch (error) {
      if (!(error instanceof OwnerError) || error.code !== "S3_AUTH") throw error;
      this.carriers.delete(token);
      throw assetUnavailable();
    }
    if (authority.principal !== entry.principal || authority.authEpoch !== entry.authEpoch
      || authority.expiresAt <= now) {
      this.carriers.delete(token);
      throw assetUnavailable();
    }
    return entry.sessionToken;
  }

  private purgeCarriers(now: number): void {
    for (const [token, entry] of this.carriers) if (entry.expiresAt <= now) this.carriers.delete(token);
  }

  private now(): number { return this.options.now?.() ?? Date.now(); }

  private acquireId(id: string): void {
    this.activeIds.set(id, (this.activeIds.get(id) ?? 0) + 1);
  }

  private releaseId(id: string): void {
    const remaining = (this.activeIds.get(id) ?? 1) - 1;
    if (remaining > 0) this.activeIds.set(id, remaining);
    else this.activeIds.delete(id);
    this.scheduleReclaim(0);
  }

  // @ref LLP 1006#9-lifecycle-finalize-off-the-writer-and-reclamation — the
  // durable ledger chooses bounded candidates before Node touches bytes, and
  // charge is released only after exact physical custody is confirmed gone.
  private scheduleReclaim(delay: number): void {
    if (this.closed) return;
    if (this.reclaiming) {
      if (delay === 0) this.reclaimAgain = true;
      return;
    }
    if (this.reclaimTimer) {
      if (delay !== 0) return;
      clearTimeout(this.reclaimTimer);
    }
    this.reclaimTimer = setTimeout(() => {
      this.reclaimTimer = undefined;
      void this.runReclaim();
    }, delay);
    this.reclaimTimer.unref();
  }

  private async runReclaim(): Promise<void> {
    if (this.closed || this.reclaiming) return;
    let complete = false;
    const work = this.reclaimSweep();
    this.reclaiming = work;
    try {
      complete = await work;
    } catch { /* Durable tombstones retain custody; the retry timer resumes. */ }
    finally {
      if (this.reclaiming === work) this.reclaiming = undefined;
      if (!this.closed) {
        const immediate = this.reclaimAgain;
        this.reclaimAgain = false;
        this.scheduleReclaim(immediate ? 0 : complete
          ? this.options.reclaimIntervalMs ?? 30_000
          : this.options.reclaimRetryMs ?? 1_000);
      }
    }
  }

  private async reclaimSweep(): Promise<boolean> {
    let after: string | undefined;
    while (!this.closed) {
      const page = parseReclaimPage(await this.options.worker.request("asset.reclaim", {
        ...(after === undefined ? {} : { after }), limit: 32,
      }));
      if (page.ids.length === 0) return page.next === null;
      const confirmed: string[] = [];
      let blocked = false;
      for (const id of page.ids) {
        if (this.closed || this.activeIds.has(id)) { blocked = true; continue; }
        if (await this.deleteOwnedAsset(id)) confirmed.push(id);
        else blocked = true;
      }
      if (confirmed.length) {
        parseReclaimFinish(await this.options.worker.request("asset.reclaim.finish", { ids: confirmed }), confirmed.length);
      }
      if (blocked) return false;
      if (page.next === null) return true;
      after = page.next;
      await yieldTurn();
    }
    return true;
  }

  private async deleteOwnedAsset(id: string): Promise<boolean> {
    for (const [path, directory] of [[this.stagePath(id), this.staging], [this.blobPath(id), this.blobs]] as const) {
      try {
        await unlink(path);
      } catch (error) {
        if (!isMissingFile(error)) return false;
      }
      // ENOENT may be the retry after unlink succeeded but the prior directory
      // sync failed. Confirm the parent durably in both cases before settlement.
      try { await (this.options.reclaimDirectorySync ?? syncDirectory)(directory); }
      catch { return false; }
    }
    return true;
  }

  private stagePath(id: string): string { return join(this.staging, `asset-${assetId(id)}.stage`); }
  private blobPath(id: string): string { return join(this.blobs, assetId(id)); }

  private async createScratchDirectory(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const path = join(this.scratch, `request-${process.pid}-${randomUUID()}`);
      this.activeScratch.add(path);
      try {
        await mkdir(path, { mode: 0o700 });
        return path;
      } catch (error) {
        this.activeScratch.delete(path);
        if (isExistingFile(error)) continue;
        throw error;
      }
    }
    throw new OwnerError("S3_ASSET_STORAGE", "Could not allocate an isolated media scratch directory.");
  }

  private async releaseScratchDirectory(path: string): Promise<void> {
    try {
      await rm(path, { recursive: true, force: true });
      await syncDirectory(this.scratch);
    } catch {
      // The exact request-* directory is a durable cleanup obligation. The
      // bounded scratch iterator retries it without inspecting long-lived blobs.
      this.scheduleScratchRecovery(this.options.reclaimRetryMs ?? 1_000);
    } finally { this.activeScratch.delete(path); }
  }

  private scheduleScratchRecovery(delay: number): void {
    if (this.closed || this.scratchRecovering || this.scratchTimer) return;
    this.scratchTimer = setTimeout(() => {
      this.scratchTimer = undefined;
      void this.runScratchRecovery();
    }, delay);
    this.scratchTimer.unref();
  }

  private async runScratchRecovery(): Promise<void> {
    if (this.closed || this.scratchRecovering) return;
    let retry = false;
    const work = this.recoverScratchPass();
    this.scratchRecovering = work;
    try { await work; }
    catch { retry = true; }
    finally {
      if (this.scratchRecovering === work) this.scratchRecovering = undefined;
      if (!this.closed) this.scheduleScratchRecovery(retry
        ? this.options.reclaimRetryMs ?? 1_000
        : this.options.reclaimIntervalMs ?? 30_000);
    }
  }

  private async recoverScratchPass(): Promise<void> {
    const directory = await opendir(this.scratch);
    let inspected = 0;
    for await (const entry of directory) {
      if (this.closed) break;
      if (!SCRATCH_DIRECTORY.test(entry.name)) continue;
      const path = join(this.scratch, entry.name);
      if (this.activeScratch.has(path)) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new OwnerError("S3_ASSET_STORAGE", `Owned media scratch path ${path} is not a directory.`);
      }
      await rm(path, { recursive: true, force: true });
      if (++inspected % 16 === 0) await yieldTurn();
    }
    // Also confirms a prior unlink whose first directory sync failed, even if
    // this pass finds no surviving entry.
    await syncDirectory(this.scratch);
  }
}

export function parseAssetKind(value: string | null): AssetKind {
  if (value !== "image" && value !== "video") throw new OwnerError("S3_INPUT", "Asset upload kind must be image or video.");
  return value;
}

function uploadContentType(request: IncomingMessage, kind: AssetKind): MediaFacts["type"] {
  if (request.headers["content-encoding"]) throw new OwnerError("S3_CONTENT_TYPE", "Compressed media request bodies are not accepted.");
  const raw = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  const valid = kind === "image" ? raw && IMAGE_TYPES.has(raw) : raw === "video/mp4";
  if (!valid) throw new OwnerError("S3_CONTENT_TYPE", kind === "image"
    ? "Send image/jpeg, image/png, or image/webp bytes."
    : "Send video/mp4 bytes containing H.264 video and AAC audio when present.");
  return raw as MediaFacts["type"];
}

function contentLength(request: IncomingMessage, hardMax: number): number | undefined {
  const raw = request.headers["content-length"];
  if (raw !== undefined) {
    if (Array.isArray(raw) || !/^[1-9][0-9]*$/.test(raw)) throw new OwnerError("S3_INPUT", "Content-Length must be one positive decimal integer.");
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new OwnerError("S3_ASSET_TOO_LARGE", "Asset Content-Length is too large.");
    if (value > hardMax) throw new OwnerError("S3_ASSET_TOO_LARGE", `Asset exceeds the ${hardMax}-byte kind ceiling.`);
    return value;
  }
  const encoding = request.headers["transfer-encoding"];
  if (typeof encoding !== "string" || !encoding.split(",").some(item => item.trim().toLowerCase() === "chunked")) {
    throw new OwnerError("S3_INPUT", "Asset upload requires Content-Length or chunked transfer encoding.");
  }
  return undefined;
}

async function streamUpload(request: IncomingMessage, path: string, maxBytes: number, exactBytes?: number): Promise<number> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  let bytes = 0;
  try {
    for await (const value of request) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maxBytes) throw new OwnerError("S3_ASSET_TOO_LARGE", `Asset body exceeds the ${maxBytes}-byte upload bound.`);
      let offset = 0;
      while (offset < chunk.length) offset += (await handle.write(chunk, offset)).bytesWritten;
    }
    if (bytes === 0) throw new OwnerError("S3_ASSET_TYPE", "Asset body is empty.");
    if (exactBytes !== undefined && bytes !== exactBytes) throw new OwnerError("S3_INPUT", `Content-Length declared ${exactBytes} bytes but the body supplied ${bytes}.`);
    await handle.sync();
    return bytes;
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
}

function parseBegin(value: unknown, kind: AssetKind): { id: string; maxBytes: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid asset admission result.");
  const record = value as Record<string, unknown>;
  const maxBytes = record.maxBytes;
  if (typeof record.id !== "string" || !ASSET_ID.test(record.id) || !Number.isSafeInteger(maxBytes) || (maxBytes as number) <= 0) {
    throw new OwnerError("S3_WORKER_PROTOCOL", `The worker returned invalid ${kind} admission facts.`);
  }
  return { id: record.id, maxBytes: maxBytes as number };
}

function parseReserve(value: unknown, id: string, bytes: number): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid asset growth reservation.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || record.id !== id || record.bytes !== bytes) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned the wrong asset growth reservation.");
  }
}

function parseReclaimPage(value: unknown): { ids: string[]; next: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid asset reclaim page.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "ids" && key !== "next")
    || !Array.isArray(record.ids) || record.ids.length > 32
    || (record.next !== null && typeof record.next !== "string")) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid asset reclaim page.");
  }
  if (record.ids.some(value => typeof value !== "string" || !ASSET_ID.test(value))) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned invalid asset reclaim identities.");
  }
  const ids = record.ids as string[];
  if (new Set(ids).size !== ids.length || (record.next !== null && !ASSET_ID.test(record.next))) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned invalid asset reclaim identities.");
  }
  return { ids, next: record.next as string | null };
}

function parseReclaimFinish(value: unknown, maximum: number): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid asset reclaim acknowledgement.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "finished") || !Number.isSafeInteger(record.finished)
    || (record.finished as number) < 0 || (record.finished as number) > maximum) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid asset reclaim acknowledgement.");
  }
}

function parseAssetRecord(value: unknown, kind: AssetKind, expectedId: string): AssetRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid asset record.");
  const record = value as Record<string, unknown>;
  const keys = kind === "video" ? ["id", "width", "height", "duration"] : ["id", "width", "height"];
  if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(record, key)) || record.id !== expectedId) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned the wrong asset record shape.");
  }
  const positive = (key: string) => {
    if (!Number.isSafeInteger(record[key]) || (record[key] as number) <= 0) throw new OwnerError("S3_WORKER_PROTOCOL", `Asset ${key} is invalid.`);
    return record[key] as number;
  };
  return { id: expectedId, width: positive("width"), height: positive("height"), ...(kind === "video" ? { duration: positive("duration") } : {}) };
}

function recordFromStatus(value: unknown, kind: AssetKind, id: string): AssetRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const status = value as Record<string, unknown>;
  try {
    if (status.record) return parseAssetRecord(status.record, kind, id);
    if (status.state === "ready") {
      const candidate = Object.fromEntries(Object.entries(status).filter(([key]) => ["id", "width", "height", "duration"].includes(key)));
      return parseAssetRecord(candidate, kind, id);
    }
  } catch { return undefined; }
  return undefined;
}

function validateFacts(facts: MediaFacts, kind: AssetKind): void {
  if (kind === "video" && (!facts.duration || facts.duration > 60_000)) throw new OwnerError("S3_ASSET_TOO_LARGE", "Video duration must be at most 60 seconds.");
  if (kind === "image" && facts.duration !== undefined) throw new OwnerError("S3_MEDIA_PROTOCOL", "Image validation returned a video duration.");
}

function parseDelivery(value: unknown, opened: boolean): Delivery {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned invalid asset delivery metadata.");
  const record = value as Record<string, unknown>;
  const allowed = ["kind", "type", "bytes", "width", "height", "duration", "public", "once", "seq"];
  if (Object.keys(record).some(key => !allowed.includes(key)) || !["image", "video"].includes(record.kind as string)
    || typeof record.public !== "boolean" || typeof record.once !== "boolean") {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned invalid asset delivery metadata.");
  }
  const kind = record.kind as AssetKind;
  const facts = {
    type: record.type, bytes: record.bytes, width: record.width, height: record.height,
    ...(record.duration === null || record.duration === undefined ? {} : { duration: record.duration }),
  };
  const parsed = parseFactsObject(facts, kind);
  if (record.once && kind !== "image") throw new OwnerError("S3_WORKER_PROTOCOL", "Only images may have once delivery.");
  const seq = record.seq;
  if (seq !== undefined && (!Number.isSafeInteger(seq) || (seq as number) < 0)) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "Asset delivery sequence is invalid.");
  }
  if (!opened && seq !== undefined) throw new OwnerError("S3_WORKER_PROTOCOL", "Asset preflight unexpectedly committed state.");
  if (opened && record.once && seq === undefined) throw new OwnerError("S3_WORKER_PROTOCOL", "A once-open omitted its consumption sequence.");
  return { ...parsed, kind, public: record.public, once: record.once, ...(seq === undefined ? {} : { seq: seq as number }) };
}

function parsePublicDelivery(value: unknown): Delivery {
  const delivery = parseDelivery(value, false);
  if (!delivery.public || delivery.once || delivery.seq !== undefined) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned invalid certified public delivery metadata.");
  }
  return delivery;
}

function parseSessionAuthority(value: unknown): { principal: string; authEpoch: number; expiresAt: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned invalid session authority.");
  }
  const record = value as Record<string, unknown>;
  const principal = record.principal;
  const id = principal && typeof principal === "object" && !Array.isArray(principal)
    ? (principal as Record<string, unknown>).id
    : undefined;
  if (typeof id !== "string" || id.length === 0 || Buffer.byteLength(id) > 1024
    || !Number.isSafeInteger(record.authEpoch) || (record.authEpoch as number) <= 0
    || !Number.isSafeInteger(record.expiresAt) || (record.expiresAt as number) <= 0) {
    throw new OwnerError("S3_WORKER_PROTOCOL", "The worker returned invalid session authority.");
  }
  return { principal: id, authEpoch: record.authEpoch as number, expiresAt: record.expiresAt as number };
}

function parseFactsObject(value: Record<string, unknown>, kind: AssetKind): MediaFacts {
  const positive = (key: string) => {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) <= 0) throw new OwnerError("S3_WORKER_PROTOCOL", `Delivery ${key} is invalid.`);
    return value[key] as number;
  };
  const type = value.type;
  if (typeof type !== "string" || (kind === "image" ? !IMAGE_TYPES.has(type) : type !== "video/mp4")) throw new OwnerError("S3_WORKER_PROTOCOL", "Delivery type is invalid.");
  const duration = value.duration === undefined ? undefined : positive("duration");
  if ((kind === "video") !== (duration !== undefined)) throw new OwnerError("S3_WORKER_PROTOCOL", "Delivery duration does not match its kind.");
  return { type: type as MediaFacts["type"], bytes: positive("bytes"), width: positive("width"), height: positive("height"), ...(duration === undefined ? {} : { duration }) };
}

function sameDelivery(left: Delivery, right: Delivery): boolean {
  return left.kind === right.kind && left.type === right.type && left.bytes === right.bytes
    && left.width === right.width && left.height === right.height && left.duration === right.duration
    && left.once === right.once && left.public === right.public;
}

async function openBlob(path: string, expectedBytes: number): Promise<FileHandle> {
  let handle: FileHandle;
  try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { throw new OwnerError("S3_ASSET_BYTES_UNAVAILABLE", "Asset bytes are unavailable; retry after recovery."); }
  try {
    const information = await handle.stat();
    if (!information.isFile() || information.size !== expectedBytes) throw new Error("mismatch");
    return handle;
  } catch {
    await handle.close();
    throw new OwnerError("S3_ASSET_BYTES_UNAVAILABLE", "Asset bytes do not match their durable record; retry after recovery.");
  }
}

function deliveryHeaders(delivery: Delivery, etag: string, credential: AssetCredential["kind"]): Record<string, string | number> {
  const noStore = delivery.once || credential === "carrier";
  return {
    "Content-Type": delivery.type,
    "Cache-Control": noStore ? "private, no-store" : delivery.public ? "public, immutable" : "private, no-cache",
    "Accept-Ranges": delivery.once ? "none" : "bytes",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...(delivery.once ? {} : { ETag: etag }),
  };
}

function withoutBodyHeaders(headers: Record<string, string | number>): Record<string, string | number> {
  const result = { ...headers };
  delete result["Content-Length"];
  return result;
}

function etagMatches(value: string | string[] | undefined, etag: string): boolean {
  if (typeof value !== "string") return false;
  return value.split(",").some(candidate => candidate.trim() === etag || candidate.trim() === `W/${etag}` || candidate.trim() === "*");
}

interface ByteRange { start: number; end: number }

function parseRange(value: string | undefined, total: number): ByteRange | null | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=([0-9]*)-([0-9]*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, total - suffix), end: total - 1 };
  }
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start >= total) return null;
  if (!match[2]) return { start, end: total - 1 };
  const end = Number(match[2]);
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { start, end: Math.min(end, total - 1) };
}

async function secureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const information = await lstat(path);
  if (!information.isDirectory() || information.isSymbolicLink()) throw new OwnerError("S3_ASSET_STORAGE", `Media path ${path} must be a private directory, not a link.`);
  await chmod(path, 0o700);
}

async function durableRename(source: string, destination: string): Promise<void> {
  await rename(source, destination);
  await syncDirectory(dirname(destination));
  if (dirname(source) !== dirname(destination)) await syncDirectory(dirname(source));
}

async function durablePublish(source: string, destination: string, directory: string): Promise<void> {
  const information = await lstat(source);
  if (!information.isFile() || information.size <= 0) throw new OwnerError("S3_ASSET_STORAGE", "Validated media output is not a nonempty file.");
  let published = false;
  try {
    await link(source, destination);
    published = true;
    await syncDirectory(directory);
    await unlink(source);
    await syncDirectory(dirname(source));
  } catch (error) {
    if (published) {
      try { await rm(destination, { force: true }); await syncDirectory(directory); }
      catch { /* The receiving ledger row retains exact blob cleanup custody. */ }
    }
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); }
  finally { await handle.close(); }
}

function assetId(value: string): string {
  if (!ASSET_ID.test(value)) throw new OwnerError("S3_NOT_FOUND", "Asset is unavailable.");
  return value;
}

function workerOutcomeMayBeUnknown(error: unknown): boolean {
  return error instanceof OwnerError && (error.code.startsWith("S3_WORKER") || error.code === "S3_OWNER_CLOSED" || error.code === "S3_OWNER_BUSY");
}

function assetUnavailable(): OwnerError {
  return new OwnerError("S3_ASSET_UNAVAILABLE", "Asset is unavailable.");
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

function isExistingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST");
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    promise,
    new Promise<undefined>(done => { timer = setTimeout(() => done(undefined), timeoutMs); timer.unref(); }),
  ]);
  if (timer) clearTimeout(timer);
  return result;
}

function boundedPositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) >= 1
    ? Math.min(Math.floor(value as number), 2_147_483_647)
    : fallback;
}

function boundedCount(value: number | undefined, fallback: number): number {
  return Math.min(boundedPositive(value, fallback), 65_536);
}

function yieldTurn(): Promise<void> {
  return new Promise(resolveTurn => setImmediate(resolveTurn));
}
