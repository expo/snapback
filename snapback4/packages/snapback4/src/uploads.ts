import { transportRefusal, invalidResponse } from "./http-response.ts";
import { sha256 } from "./sha256.ts";
// @ref LLP 3000.038.000#2 — one device outbox owns capture, upload and placement.
import type { Asset, Mutation, Refusal, UploadOptions, Write } from "./contract.ts";
import type { Queued } from "./local-types.ts";
import { blobArrayBuffer, uploadAsset, type Bytes } from "./assets.ts";
import { captureFile } from "./files.ts";
import { waitForCaller } from "./request-wait.ts";
import { mintId } from "./client.ts";

export type UploadIntent =
  | { readonly id: string; readonly state: "queued" | "uploading" }
  | { readonly id: string; readonly state: "cancelling"; readonly why?: Refusal }
  | { readonly id: string; readonly state: "blocked"; readonly why: Refusal }
  | { readonly id: string; readonly state: "placing"; readonly asset: Asset }
  | Exclude<Write, { state: "pending" }>;
export interface UploadAndPlaceOptions<K extends string = string> extends UploadOptions {
  readonly argument: K;
  readonly id?: string;
}
/** Internal durable representation. Bytes never enter the localStorage journal. */
export interface UploadDependency {
  bytes: string | null;
  argument: string;
  file?: NonNullable<UploadOptions["file"]>;
  store_id: string;
  original_args: unknown;
  fingerprint?: string;
  state: "queued" | "uploading" | "blocked" | "placing" | "cancelling";
  asset?: Asset | null;
  why?: Refusal | null;
}
export interface UploadClient {
  uploadAndPlace<A, R, K extends Extract<keyof A, string>>(op: Mutation<A, R>, args: Omit<A, K>, bytes: Bytes, options: UploadAndPlaceOptions<K>): Promise<UploadIntent>;
  uploads(): Promise<readonly UploadIntent[]>;
  uploadIntent(id: string): Promise<UploadIntent | undefined>;
  retryUpload(id: string): Promise<UploadIntent | undefined>;
  discardUpload(id: string): Promise<UploadIntent | undefined>;
  onUploads(listener: () => void): () => void;
  /** Connected owner-only recovery after device storage eviction. 50 entries per page. */
  serverUploads(after?: string): Promise<ServerUploads>;
  cancelServerUpload(id: string): Promise<{ ok: true } | { ok: false; why: Refusal }>;
}
export type UploadCapabilities = Partial<UploadClient>;
export function hasUploads(client: object): client is UploadClient { return "uploadAndPlace" in client && typeof client.uploadAndPlace === "function"; }
export type ServerUploads = { ok: true; intents: readonly { id: string; asset: Asset; createdAt: number }[]; next: string | null } | { ok: false; why: Refusal };
export function uploadAndPlace<A, R, K extends Extract<keyof A, string>>(client: UploadClient, op: Mutation<A, R>, args: Omit<A, K>, bytes: Bytes, options: UploadAndPlaceOptions<K>) {
  return client.uploadAndPlace(op, args, bytes, options);
}
export function uploadState(entry: Queued): UploadIntent | undefined {
  const u = entry.upload;
  if (!u) return;
  if (u.state === "blocked") return { id: entry.id, state: "blocked", why: u.why ?? { code: "E_UPLOAD", family: "asset", message: "upload is held; retry the same intent" } };
  if (u.state === "placing" && u.asset) return { id: entry.id, state: "placing", asset: u.asset };
  if(u.state==="cancelling")return {id:entry.id,state:"cancelling",...(u.why?{why:u.why}:{})};
  return { id: entry.id, state: u.state as "queued" | "uploading" };
}
interface Environment {
  base: string;
  viewer: string;
  fetch: typeof fetch;
  signal?: AbortSignal | undefined;
  current(): boolean;
  unavailable(): Refusal | null | undefined;
  storeId(): string | undefined;
  capture(): Promise<{ store_id?: string | null; backend_required?: boolean } | undefined>;
  credentials(): { headers: Record<string, string>; revision: number };
  entry(id: string, op: string, args: unknown): Queued;
  call(request: Record<string, unknown>): Promise<{ ok?: unknown; denied?: Refusal }>;
  queued(): Promise<Queued[]>;
  write(id: string): Promise<Write | undefined>;
  notify(): void;
  flush(): void;
  subscribe(listener: () => void): () => void;
}
const storeError = (error: unknown): Refusal => ({ code: "E_STORE", family: "store", message: `upload intent storage did not complete: ${String(error)}`, retryable: true });
export class DeviceUploads implements UploadClient {
  constructor(private readonly env: Environment) {}
  onUploads = (listener: () => void) => this.env.subscribe(listener);
  private async change(request: Record<string, unknown>): Promise<Queued | undefined> {
    const reply = await this.env.call(request);
    if (reply.denied) throw reply.denied;
    this.env.notify();
    return reply.ok as Queued | undefined;
  }
  async uploadAndPlace<A, R, K extends Extract<keyof A, string>>(op: Mutation<A, R>, args: Omit<A, K>, bytes: Bytes, options: UploadAndPlaceOptions<K>): Promise<UploadIntent> {
    const id = options.id ?? mintId();
    const why = this.env.unavailable();
    if (why) return { state: "failed", id, why };
    try {
    // Snapshot args/options before awaiting the host's Blob/file reader.
    const selectedArgs = JSON.parse(JSON.stringify(args)) as unknown;
    const file = options.file ? captureFile(bytes, options.file) : undefined;
    const argument = options.argument;
      const size = ArrayBuffer.isView(bytes) ? bytes.byteLength : bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.size;
      if (!size || size > 64 * 1024 * 1024) return { state: "failed", id, why: { code: "E_UPLOAD_BYTES", family: "asset", message: "select a nonempty file of at most 64 MiB" } };
      const owned = ArrayBuffer.isView(bytes) ? new Uint8Array(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
        : bytes instanceof ArrayBuffer ? new Uint8Array(bytes.slice(0)) : new Uint8Array(await blobArrayBuffer(bytes));
      if(owned.byteLength!==size)return {state:"failed",id,why:{code:"E_UPLOAD_BYTES",family:"asset",message:"the selected byte range changed while reading"}};
      const store=this.env.storeId();
      if (!store) return { state: "failed", id, why: { code: "E_ADMISSION_STORE", family: "store", message: "open this backend once online before capturing an offline upload" } };
      if (this.env.unavailable()) return { state: "failed", id, why: this.env.unavailable()! };
      // A prior terminal receipt owns this id; no second upload may be admitted.
      // The device compares retained immutable identity, including ordinary-write ownership.
      // A terminal Write alone is not proof that this media selection was ever admitted.
      const entry = this.env.entry(id, op.name, selectedArgs);
      entry.predictable = false;
      entry.upload = { bytes: hexBytes(owned), argument,
        ...(file ? { file } : {}), store_id: store, original_args: selectedArgs, state: "queued" };
      const admitted = await this.change({ op: "admit_upload", entry });
      const terminal=(admitted as Queued & {write?:Exclude<Write,{state:"pending"}>} | undefined)?.write;
      if(terminal)return terminal;
      this.env.flush();
      return uploadState(admitted!)!;
    } catch (error) { return { state: "failed", id, why: isRefusal(error) ? error : storeError(error) }; }
  }
  async uploads(): Promise<readonly UploadIntent[]> {
    if (this.env.unavailable()) return [];
    return (await this.env.queued()).filter(e => e.viewer === this.env.viewer).flatMap(e => { const state = uploadState(e); return state ? [state] : []; });
  }
  async uploadIntent(id: string): Promise<UploadIntent | undefined> {
    if (this.env.unavailable()) return;
    const entry = (await this.env.queued()).find(e => e.id === id && e.viewer === this.env.viewer);
    const write = await this.env.write(id);
    return write && write.state !== "pending" ? write : entry && uploadState(entry);
  }
  async retryUpload(id: string): Promise<UploadIntent | undefined> {
    const why = this.env.unavailable(); if (why) return { state: "failed", id, why };
    const entry = await this.change({ op: "upload_state", id, viewer: this.env.viewer, state: "queued" });
    this.env.flush();
    return entry ? uploadState(entry) : this.uploadIntent(id);
  }
  async discardUpload(id: string): Promise<UploadIntent | undefined> {
    const why = this.env.unavailable(); if (why) return { state: "failed", id, why };
    try {
      const entry = await this.change({ op: "upload_state", id, viewer: this.env.viewer, state: "cancelling" });
      this.env.flush();
      return entry ? uploadState(entry) : this.uploadIntent(id);
    } catch (error) { return { state: "blocked", id, why: isRefusal(error) ? error : storeError(error) }; }
  }
  async serverUploads(after = ""): Promise<ServerUploads> {
    const why=this.env.unavailable(); if(why)return {ok:false,why};
    try {
      const capture=await this.env.capture(); if(!capture?.store_id)return {ok:false,why:storeError("identify the backend first")};
      const credentials=this.env.credentials();
      const result=await this.request(`${this.env.base}/assets/intents?store_id=${encodeURIComponent(capture.store_id)}&after=${encodeURIComponent(after)}`,{headers:credentials.headers});
      if(!result || !this.env.current() || credentials.revision!==this.env.credentials().revision)return {ok:false,why:storeError("the owner changed during inventory")};
      if(result.json.denied)return {ok:false,why:result.json.denied as Refusal};
      return {ok:true,intents:result.json.intents as Extract<ServerUploads,{ok:true}>["intents"],next:result.json.next as string|null};
    } catch(error){return {ok:false,why:isRefusal(error)?error:storeError(error)};}
  }
  async cancelServerUpload(id: string): Promise<{ok:true}|{ok:false;why:Refusal}> {
    const why=this.env.unavailable(); if(why)return {ok:false,why};
    try {
      const capture=await this.env.capture(); if(!capture?.store_id)return {ok:false,why:storeError("identify the backend first")};
      const credentials=this.env.credentials();
      const result=await this.request(`${this.env.base}/assets/intent/${encodeURIComponent(id)}/cancel?store_id=${encodeURIComponent(capture.store_id)}`,{method:"POST",headers:credentials.headers},true);
      if(result?.ok&&result.json.ok===true)return {ok:true};
      if(!result || !this.env.current() || credentials.revision!==this.env.credentials().revision)return {ok:false,why:storeError("cancellation acknowledgement is unknown; retry the same id")};
      return result.json.ok===true?{ok:true}:{ok:false,why:result.json.denied as Refusal??storeError("invalid cancellation response")};
    } catch(error){return {ok:false,why:isRefusal(error)?error:storeError(error)};}
  }
  private async request(input: string, init: RequestInit, preserveAcknowledgement=false): Promise<{ ok: boolean; json: Record<string, unknown> } | undefined> {
    try {
      let acknowledged=false;
      const work = this.env.fetch(input, { ...init, ...(preserveAcknowledgement?{}:{signal:this.env.signal??null}) }).then(async response => {
        const json = await response.json() as unknown;
        acknowledged=response.ok&&typeof json==="object"&&json!==null&&((json as Record<string,unknown>).ok===true||["sent","failed"].includes(String((json as Record<string,unknown>).state)));
        return typeof json === "object" && json !== null && !Array.isArray(json)
          ? {ok:response.ok,json:json as Record<string,unknown>}
          : {ok:false,json:{denied:invalidResponse(response.status,"upload intent")}};
      });
      if(preserveAcknowledgement)return await work;
      return await waitForCaller(work, this.env.signal ?? new AbortController().signal,()=>acknowledged);
    } catch(error) {return {ok:false,json:{denied:transportRefusal(error)}};}
  }
  /** A terminal pre-program refusal needs a bound server receipt before releasing its pin. */
  async finish(entry: Queued, why: Refusal): Promise<Record<string, unknown> | undefined> {
    if (!entry.upload || why.retryable || !this.env.current()) return;
    const credentials = this.env.credentials();
    const result = await this.request(`${this.env.base}/assets/intent/${encodeURIComponent(entry.id)}/finish?store_id=${encodeURIComponent(entry.upload.store_id)}`, {
      method: "POST", headers: credentials.headers, body: JSON.stringify({ op: entry.op, args: entry.args, why: {code:why.code.slice(0,128),family:why.family.slice(0,128),message:why.message.slice(0,4096),retryable:false,...(why.guide?{guide:why.guide.slice(0,128)}:{})} }) });
    if (!result) return;
    const outcome = result.json;
    if (!result.ok || !this.env.current() || credentials.revision !== this.env.credentials().revision || (outcome.state !== "sent" && outcome.state !== "failed")) return;
    return outcome;
  }
  // @ref LLP 3000.038.000#3 — every dependency commit precedes begin_send and POST /m.
  async prepare(entry: Queued): Promise<{ entry: Queued } | { cancelled: true } | undefined> {
    const u = entry.upload;
    if (!u) return { entry };
    if (!this.env.current()) return;
    const capture = await this.env.capture();
    if (entry.viewer !== this.env.viewer || capture?.store_id !== u.store_id) {
      await this.change({ op: "upload_state", id: entry.id, viewer: this.env.viewer, state: "blocked", why: { code: "E_STORE_REPLACED", family: "store", message: "upload belongs to its original viewer and backend store" } });
      return;
    }
    if (u.state === "placing") return { entry };
    if(u.why?.code==="E_UPLOAD_CANCELLED")return {cancelled:true};
    if (u.state === "blocked" && !u.why?.retryable) return;
    const credentials = this.env.credentials();
    const current = () => this.env.current() && this.env.credentials().revision === credentials.revision;
    if (u.state === "cancelling") {
      const result = await this.request(`${this.env.base}/assets/intent/${encodeURIComponent(entry.id)}/cancel?store_id=${encodeURIComponent(u.store_id)}`, { method: "POST", headers: credentials.headers });
      if (result && current() && result.ok && result.json.ok === true) return { cancelled: true };
      if(result && current())await this.change({op:"upload_state",id:entry.id,viewer:this.env.viewer,state:"cancelling",why:result.json.denied??storeError("cancellation acknowledgement is unknown")});
      return;
    }
    await this.change({ op: "upload_state", id: entry.id, viewer: this.env.viewer, state: "uploading" });
    if (!current()) return;
    const bytes = Uint8Array.from(u.bytes?.match(/../g) ?? [], b => parseInt(b, 16));
    const declaration = await this.request(`${this.env.base}/assets/intent/${encodeURIComponent(entry.id)}/declare?store_id=${encodeURIComponent(u.store_id)}`, {
      method:"POST", headers:credentials.headers, body:JSON.stringify({digest:hexBytes(sha256(bytes)),placement:{op:entry.op,args:u.original_args,argument:u.argument},...(u.file?{file:u.file}:{})})});
    if(!declaration||!current())return;
    if(declaration.json.denied && (declaration.json.denied as Refusal).code==="E_UPLOAD_CANCELLED")return {cancelled:true};
    if(!declaration.ok||declaration.json.ok!==true){await this.change({op:"upload_state",id:entry.id,viewer:this.env.viewer,state:"blocked",why:declaration.json.denied??storeError("intent declaration was not accepted")});return;}
    const result = await waitForCaller(uploadAsset(this.env.base, credentials.headers, this.env.fetch, bytes, current, u.file ? { file: u.file } : undefined, { id: entry.id, store: u.store_id, signal: this.env.signal }), this.env.signal ?? new AbortController().signal);
    if (!result || !current()) return;
    if (!result.ok) {
      if(result.why.code==="E_UPLOAD_CANCELLED")return {cancelled:true};
      await this.change({ op: "upload_state", id: entry.id, viewer: this.env.viewer, state: "blocked", why: result.why });
      return;
    }
    const ready = await this.change({ op: "upload_ready", id: entry.id, viewer: this.env.viewer, store_id: u.store_id, asset: result.asset });
    if (!current() || !ready || ready.upload?.state !== "placing") return;
    return { entry: ready };
  }
}
function isRefusal(error: unknown): error is Refusal { return !!error && typeof error === "object" && "code" in error && "message" in error; }

export function hexBytes(bytes: Uint8Array): string {
  const table = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0")), chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += 8192) {
    const end = Math.min(bytes.length, at + 8192), parts: string[] = [];
    for (let i = at; i < end; i++) parts.push(table[bytes[i]!]!);
    chunks.push(parts.join(""));
  }
  return chunks.join("");
}
