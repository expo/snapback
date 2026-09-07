// @ref LLP 1018.000#8-account-sessions-and-durable-follower-admission — a browser
// follower forwards replayable mutation arguments to the one partition writer;
// the writer acknowledges only after durable outbox admission.
import { sha256 } from "../../evaluator/src/hash.js";
import { followerRefusal, SnapbackRefusal } from "./client-wire.js";
import { forwardingRequestExpiry, forwardingRequestId } from "./store/forwarding.js";
import { stableSerialize } from "./types.js";
import type { OfflineRuntime } from "./offline.js";
import type {
  MutationAdmissionUnknown,
  MutationQueued,
  MutationRecovery,
  OutboxStatus,
  RefusalEnvelope,
} from "./types.js";

const PROTOCOL = 1;
const COMMAND_LIFETIME = 5 * 60 * 1_000;
const RESPONSE_TIMEOUT = 2_000;
const LOCAL_PENDING_LIMIT = 64;

export interface ForwardingWriter {
  scope: string;
  principal: string;
  authEpoch: number;
  partitionIncarnation: string;
}

export interface ForwardingFollower {
  scope: string;
  principal: string;
  /** Bearer followers must confirm this epoch; a dev persona is already established authority. */
  authEpoch?: number;
  established: boolean;
  persona: boolean;
}

export interface ForwardingCommand {
  requestId: string;
  followerId: string;
  payloadDigest: string;
  expiresAt: number;
  scope: string;
  principal: string;
  authEpoch: number;
  partitionIncarnation: string;
  op: string;
  args: unknown;
  recovery: boolean;
}

export interface ForwardingHost {
  writer(): ForwardingWriter | undefined;
  status(op?: string, followerId?: string): Promise<OutboxStatus>;
  admit(command: ForwardingCommand): Promise<MutationQueued | undefined>;
  acknowledge(requestId: string, followerId: string, authEpoch: number, partitionIncarnation: string): Promise<void>;
  failure(error: unknown): RefusalEnvelope;
  admitted(): void;
}

type WriterAnnouncement = ForwardingWriter & {
  protocol: 1; type: "writer"; writerIncarnation: string; status: OutboxStatus;
};
type Discover = { protocol: 1; type: "discover"; followerId: string };
type StatusRequest = {
  protocol: 1; type: "status"; requestId: string; followerId: string;
  targetWriterIncarnation: string; op?: string;
};
type StatusAnswer = ForwardingWriter & {
  protocol: 1; type: "status-answer"; requestId: string; followerId: string;
  writerIncarnation: string; status: OutboxStatus;
};
type MutationRequest = ForwardingCommand & {
  protocol: 1; type: "mutation"; targetWriterIncarnation: string;
};
type MutationAnswer = ForwardingWriter & {
  protocol: 1; type: "mutation-answer"; requestId: string; followerId: string;
  writerIncarnation: string;
  result: MutationQueued | MutationAdmissionUnknown | { state: "refused"; refusal: RefusalEnvelope };
};
type ReceiptAck = {
  protocol: 1; type: "receipt-ack"; requestId: string; followerId: string;
  targetWriterIncarnation: string; authEpoch: number; partitionIncarnation: string;
};
type Message = WriterAnnouncement | Discover | StatusRequest | StatusAnswer | MutationRequest | MutationAnswer | ReceiptAck;

interface RecoveryRecord {
  protocol: 1;
  requestId: string;
  followerId: string;
  payloadDigest: string;
  expiresAt: number;
  scope: string;
  principal: string;
  authEpoch: number;
  partitionIncarnation: string;
}

interface Attempt {
  promise: Promise<MutationQueued | MutationAdmissionUnknown>;
  resolve(value: MutationQueued | MutationAdmissionUnknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  targetWriterIncarnation: string;
}

interface Pending {
  command: ForwardingCommand;
  recovery: MutationRecovery;
  generation: number;
  /** True once any transport accepted this request for delivery. */
  sent: boolean;
  timedOut: boolean;
  targetWriterIncarnation?: string;
  attempt?: Attempt;
  expiryTimer: ReturnType<typeof setTimeout>;
}

interface StatusWaiter {
  followerId: string;
  writerIncarnation: string;
  resolve(status: OutboxStatus): void;
  timer: ReturnType<typeof setTimeout>;
}

interface RecoveryPreparation {
  record: RecoveryRecord;
  outcome: Promise<MutationQueued | MutationAdmissionUnknown>;
}

interface LogicalCommand {
  key: object | string;
  pending?: Pending;
  recovery?: RecoveryPreparation;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deferred<Value>(): {
  promise: Promise<Value>; resolve(value: Value): void; reject(error: unknown): void;
} {
  let resolve!: (value: Value) => void, reject!: (error: unknown) => void;
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

function payloadDigest(op: string, args: unknown): string {
  return sha256(stableSerialize([op, args]));
}

function encode(record: RecoveryRecord): MutationRecovery {
  // Select the public recovery fields explicitly. A MutationRequest also has
  // `op` and `args`; those must never ride the opaque recovery token.
  const recovery: RecoveryRecord = {
    protocol: PROTOCOL, requestId: record.requestId, followerId: record.followerId,
    payloadDigest: record.payloadDigest, expiresAt: record.expiresAt, scope: record.scope,
    principal: record.principal, authEpoch: record.authEpoch,
    partitionIncarnation: record.partitionIncarnation,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(recovery));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `s2mr1.${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}` as MutationRecovery;
}

function decode(token: MutationRecovery): RecoveryRecord {
  if (typeof token !== "string" || !token.startsWith("s2mr1.")) throw new TypeError("invalid mutation recovery token");
  const encoded = token.slice("s2mr1.".length).replaceAll("-", "+").replaceAll("_", "/");
  let value: unknown;
  try {
    const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
    value = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0))));
  } catch { throw new TypeError("invalid mutation recovery token"); }
  if (!object(value) || value.protocol !== PROTOCOL || typeof value.requestId !== "string"
    || typeof value.followerId !== "string" || typeof value.payloadDigest !== "string"
    || !/^[0-9a-f]{64}$/.test(value.payloadDigest) || !Number.isSafeInteger(value.expiresAt)
    || typeof value.scope !== "string" || typeof value.principal !== "string"
    || !Number.isSafeInteger(value.authEpoch) || typeof value.partitionIncarnation !== "string") {
    throw new TypeError("invalid mutation recovery token");
  }
  if (forwardingRequestExpiry(value.requestId) !== value.expiresAt) throw new TypeError("invalid mutation recovery token");
  return value as unknown as RecoveryRecord;
}

function sameWriter(left: ForwardingWriter | undefined, right: ForwardingWriter | undefined): boolean {
  return left !== undefined && right !== undefined && left.scope === right.scope && left.principal === right.principal
    && left.authEpoch === right.authEpoch && left.partitionIncarnation === right.partitionIncarnation;
}

function mappedStatus(status: OutboxStatus): OutboxStatus {
  return status.ready ? status : { ...status, ready: false, reason: "writer-capacity" };
}

function validStatus(value: unknown): value is OutboxStatus {
  if (!object(value)) return false;
  return typeof value.ready === "boolean" && typeof value.reason === "string"
    && typeof value.action === "string" && Number.isSafeInteger(value.remaining)
    && (value.fence === "inside" || value.fence === "past");
}

function validResult(value: unknown): value is MutationAnswer["result"] {
  if (!object(value) || typeof value.state !== "string") return false;
  if (value.state === "queued") return typeof value.intent === "string"
    && Array.isArray(value.ids) && value.ids.every(id => typeof id === "string");
  if (value.state === "admission-unknown") return typeof value.recovery === "string";
  return value.state === "refused" && object(value.refusal) && typeof value.refusal.code === "string"
    && typeof value.refusal.family === "string" && typeof value.refusal.message === "string"
    && typeof value.refusal.guide === "string";
}

function followerStatus(reason: "follower" | "writer-discovery" | "writer-unresponsive" | "writer-capacity"): OutboxStatus {
  return { ready: false, reason, action: "none", remaining: 0, fence: "inside" };
}

/** Canonical backend + carrier + principal identity used as the BroadcastChannel name and recovery scope. */
export function mutationForwardingScope(url: string, carrier: string, principal: string): string {
  const backend = new URL(url).href.replace(/\/+$/, "");
  return `snapback2:mutation-forwarding:${stableSerialize([backend, carrier, principal])}`;
}

/** Browser-tab coordination; durable idempotency remains in OutboxLedger, not this process-local object. */
export class MutationForwarding {
  private generation = 0;
  private channel?: BroadcastChannel;
  private writerRole?: ForwardingWriter & { writerIncarnation: string };
  private followerRole?: ForwardingFollower & { followerId: string };
  private discovered?: WriterAnnouncement;
  private inbound: Promise<void> = Promise.resolve();
  /** One bounded ownership record from unsent preparation through pending/recovery release. */
  private readonly commands = new Map<object | string, LogicalCommand>();
  private readonly statusWaiters = new Map<string, StatusWaiter>();
  private readonly listeners = new Set<() => void>();
  /** Serializes discovery and send publication in one follower's invocation order. */
  private submissionTail: Promise<void> = Promise.resolve();
  private unresponsive = false;

  constructor(
    private readonly host: ForwardingHost,
    private readonly responseTimeout = RESPONSE_TIMEOUT,
  ) {}

  get available(): boolean { return typeof globalThis.BroadcastChannel === "function"; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) try { listener(); } catch { /* readiness observers are isolated */ }
  }

  writer(context: ForwardingWriter | undefined): void {
    if (!context) { this.stop(); return; }
    if (this.writerRole && sameWriter(this.writerRole, context)) { void this.announce(); return; }
    this.stop();
    if (!this.available) return;
    this.writerRole = { ...context, writerIncarnation: randomId() };
    this.open(context.scope);
    void this.announce();
  }

  follower(context: ForwardingFollower): void {
    if (this.followerRole && this.followerRole.scope === context.scope
      && this.followerRole.principal === context.principal
      && this.followerRole.authEpoch === context.authEpoch
      && this.followerRole.established === context.established
      && this.followerRole.persona === context.persona) {
      this.discovered = undefined;
      this.post({ protocol: PROTOCOL, type: "discover", followerId: this.followerRole.followerId });
      this.notify();
      return;
    }
    this.stop();
    this.followerRole = { ...context, followerId: randomId() };
    if (this.available) {
      this.open(context.scope);
      this.post({ protocol: PROTOCOL, type: "discover", followerId: this.followerRole.followerId });
    }
    this.notify();
  }

  stop(): void {
    this.generation += 1;
    this.submissionTail = Promise.resolve();
    this.channel?.close();
    this.channel = undefined;
    this.writerRole = undefined;
    this.followerRole = undefined;
    this.discovered = undefined;
    for (const waiter of this.statusWaiters.values()) { clearTimeout(waiter.timer); waiter.resolve(followerStatus("writer-discovery")); }
    this.statusWaiters.clear();
    for (const { pending: item } of this.commands.values()) {
      if (!item) continue;
      clearTimeout(item.expiryTimer);
      if (item.attempt) {
        clearTimeout(item.attempt.timer);
        item.attempt.resolve({ state: "admission-unknown", recovery: item.recovery });
      }
    }
    this.commands.clear(); this.unresponsive = false;
    this.notify();
  }

  async status(op?: string): Promise<OutboxStatus> {
    const follower = this.followerRole;
    const generation = this.generation;
    if (!follower) return followerStatus("follower");
    if (!this.available) return followerStatus("follower");
    if (this.unresponsive) return followerStatus("writer-unresponsive");
    const writer = await this.discover();
    if (!writer || !this.currentFollower(follower, generation)) return followerStatus("writer-discovery");
    if (this.commands.size >= LOCAL_PENDING_LIMIT) return followerStatus("writer-capacity");
    const requestId = randomId();
    const { promise, resolve } = deferred<OutboxStatus>();
    const timer = setTimeout(() => {
      this.statusWaiters.delete(requestId); this.unresponsive = true; this.notify();
      resolve(followerStatus("writer-unresponsive"));
    }, this.responseTimeout);
    (timer as { unref?: () => void }).unref?.();
    this.statusWaiters.set(requestId, { followerId: follower.followerId,
      writerIncarnation: writer.writerIncarnation, resolve, timer });
    this.post({ protocol: PROTOCOL, type: "status", requestId, followerId: follower.followerId,
      targetWriterIncarnation: writer.writerIncarnation, ...(op === undefined ? {} : { op }) });
    return promise;
  }

  async mutation(op: string, args: unknown, recovery?: MutationRecovery): Promise<MutationQueued | MutationAdmissionUnknown> {
    const generation = this.generation;
    const follower = this.followerRole;
    const recovered = recovery === undefined ? undefined : decode(recovery);
    let command = recovered === undefined ? undefined : this.commands.get(recovered.requestId);
    if (!command && this.commands.size >= LOCAL_PENDING_LIMIT) {
      throw new SnapbackRefusal({ code: "E_OFFLINE_FORWARDING_CAPACITY", family: "offline",
        message: "this follower already has 64 preparing or unacknowledged mutation commands", site: "client.mutation.forward",
        rewrite: "wait for acknowledgment or recover an existing command", guide: "offline" });
    }
    if (!command) {
      command = { key: recovered?.requestId ?? {} };
      this.commands.set(command.key, command);
    }
    let boundArgs: unknown, digest: string;
    try { boundArgs = structuredClone(args); digest = payloadDigest(op, boundArgs); }
    catch (error) { this.releaseCommand(command); throw error; }
    if (recovered && recovered.payloadDigest !== digest) {
      this.releaseCommand(command);
      throw new TypeError("mutation recovery token does not match the operation and arguments");
    }
    const shared = command.recovery;
    if (shared) {
      if (stableSerialize(shared.record) !== stableSerialize(recovered)) {
        throw new TypeError("mutation recovery request identity conflicts with an in-flight command");
      }
      const writer = this.host.writer();
      if (writer) this.verifyRecovery(recovered!, writer, digest);
      else if (this.currentFollower(follower, generation) && follower) this.verifyFollower(recovered!, follower, digest);
      else throw followerRefusal("client.mutation.forward");
      return shared.outcome;
    }
    const prepared = this.submissionTail.then(async () => {
      try { return await this.prepareMutation(command, op, boundArgs, digest, generation, follower, recovery, recovered); }
      finally { this.releaseCommand(command); }
    });
    this.submissionTail = prepared.then(() => undefined, () => undefined);
    const outcome = prepared.then(value => value.outcome);
    if (recovered) {
      const item = { record: recovered, outcome };
      command.recovery = item;
      void outcome.then(
        () => { if (command.recovery === item) command.recovery = undefined; this.releaseCommand(command); },
        () => { if (command.recovery === item) command.recovery = undefined; this.releaseCommand(command); },
      );
    }
    return outcome;
  }

  private async prepareMutation(
    lifecycle: LogicalCommand,
    op: string, boundArgs: unknown, digest: string, generation: number,
    invokedFollower: (ForwardingFollower & { followerId: string }) | undefined,
    recovery?: MutationRecovery, recovered?: RecoveryRecord,
  ): Promise<{ outcome: Promise<MutationQueued | MutationAdmissionUnknown> }> {
    if (!this.currentFollower(invokedFollower, generation)) {
      if (recovery !== undefined && invokedFollower && recovered) {
        this.verifyFollower(recovered, invokedFollower, digest);
        return { outcome: Promise.resolve({ state: "admission-unknown", recovery }) };
      }
      throw followerRefusal("client.mutation.forward");
    }
    const role = invokedFollower;
    let record: RecoveryRecord;
    if (recovery !== undefined) {
      record = recovered ?? decode(recovery);
      if (record.payloadDigest !== digest) throw new TypeError("mutation recovery token does not match the operation and arguments");
    } else {
      if (!role) throw followerRefusal("client.mutation.forward");
      const writer = await this.discover();
      if (!writer || !this.currentFollower(role, generation)) throw followerRefusal("client.mutation.forward");
      const expiresAt = Date.now() + COMMAND_LIFETIME;
      record = {
        protocol: PROTOCOL, requestId: forwardingRequestId(expiresAt, randomId()), followerId: role.followerId, payloadDigest: digest,
        expiresAt, scope: role.scope, principal: role.principal,
        authEpoch: writer.authEpoch, partitionIncarnation: writer.partitionIncarnation,
      };
    }
    this.bindCommand(lifecycle, record.requestId);
    const token = recovery ?? encode(record);
    const currentWriter = this.host.writer();
    if (currentWriter) {
      this.verifyRecovery(record, currentWriter, digest);
      const outcome = this.host.admit({ ...record, op, args: boundArgs, recovery: recovery !== undefined }).then(result => {
        if (!result) return { state: "admission-unknown" as const, recovery: token };
        this.host.admitted();
        return result;
      });
      return { outcome };
    }
    if (!role) throw followerRefusal("client.mutation.forward");
    this.verifyFollower(record, role, digest);
    if (!this.available) {
      if (recovery !== undefined) return { outcome: Promise.resolve({ state: "admission-unknown", recovery: token }) };
      throw followerRefusal("client.mutation.forward");
    }
    let pending = lifecycle.pending;
    if (pending && (pending.command.payloadDigest !== digest || pending.command.expiresAt !== record.expiresAt)) {
      throw new TypeError("mutation recovery request identity conflicts with an in-flight command");
    }
    const writer = await this.discover();
    if (!writer || !this.currentFollower(role, generation)) {
      if (recovery !== undefined) return { outcome: Promise.resolve({ state: "admission-unknown", recovery: token }) };
      throw followerRefusal("client.mutation.forward");
    }
    if (writer.authEpoch !== record.authEpoch || writer.partitionIncarnation !== record.partitionIncarnation) {
      throw new SnapbackRefusal({ code: "E_OFFLINE_FORWARDING_IDENTITY", family: "offline",
        message: "the mutation recovery belongs to another account session or offline partition",
        site: "client.recoverMutation", rewrite: "recover only under the original account partition", guide: "offline" });
    }
    // Discovery can outlive the prior attempt's answer or expiry. Re-read the
    // lifecycle so a successor send installs a Pending the answer can settle.
    pending = lifecycle.pending;
    if (pending && (pending.command.payloadDigest !== digest || pending.command.expiresAt !== record.expiresAt)) {
      throw new TypeError("mutation recovery request identity conflicts with an in-flight command");
    }
    const command: ForwardingCommand = { ...record, op, args: boundArgs, recovery: recovery !== undefined };
    if (!pending) {
      const expiryTimer = setTimeout(() => {
        const expired = lifecycle.pending;
        if (!expired) return;
        lifecycle.pending = undefined;
        if (expired.attempt) {
          clearTimeout(expired.attempt.timer);
          expired.attempt.resolve({ state: "admission-unknown", recovery: expired.recovery });
          expired.attempt = undefined;
        }
        this.releaseCommand(lifecycle);
        this.updateUnresponsive(); this.notify();
      }, Math.max(recovery === undefined ? 0 : this.responseTimeout, record.expiresAt - Date.now()));
      (expiryTimer as { unref?: () => void }).unref?.();
      pending = { command, recovery: token, generation: this.generation, sent: false, timedOut: false, expiryTimer };
      lifecycle.pending = pending;
    }
    else if (recovery !== undefined && !pending.command.recovery) {
      pending.command = { ...pending.command, recovery: true };
    }
    if (pending.attempt) return { outcome: pending.attempt.promise };
    return { outcome: this.send(lifecycle, pending, writer.writerIncarnation) };
  }

  private send(
    lifecycle: LogicalCommand, pending: Pending, targetWriterIncarnation: string,
  ): Promise<MutationQueued | MutationAdmissionUnknown> {
    const { promise, resolve, reject } = deferred<MutationQueued | MutationAdmissionUnknown>();
    const timer = setTimeout(() => {
      if (pending.attempt?.promise !== promise) return;
      pending.attempt = undefined; pending.timedOut = true; this.discovered = undefined;
      this.unresponsive = true; this.notify();
      resolve({ state: "admission-unknown", recovery: pending.recovery });
    }, this.responseTimeout);
    (timer as { unref?: () => void }).unref?.();
    pending.targetWriterIncarnation = targetWriterIncarnation;
    pending.attempt = { promise, resolve, reject, timer, targetWriterIncarnation };
    if (!this.post({ protocol: PROTOCOL, type: "mutation", ...pending.command, targetWriterIncarnation })) {
      clearTimeout(timer); pending.attempt = undefined;
      if (pending.sent || pending.command.recovery) {
        // This failed publication cannot disprove admission by an earlier
        // successful publication represented by the recovery identity.
        pending.timedOut = true; this.unresponsive = true; this.notify();
        resolve({ state: "admission-unknown", recovery: pending.recovery });
      } else {
        clearTimeout(pending.expiryTimer); lifecycle.pending = undefined;
        this.releaseCommand(lifecycle);
        this.updateUnresponsive(); this.notify(); reject(followerRefusal("client.mutation.forward"));
      }
    } else {
      pending.sent = true;
    }
    return promise;
  }

  private verifyFollower(record: RecoveryRecord, follower: ForwardingFollower, digest: string): void {
    const epochMatches = follower.persona || (follower.established && follower.authEpoch === record.authEpoch);
    if (record.scope !== follower.scope || record.principal !== follower.principal || record.payloadDigest !== digest || !epochMatches) {
      throw new SnapbackRefusal({ code: "E_OFFLINE_FORWARDING_IDENTITY", family: "offline",
        message: "the mutation recovery token does not match this client account session",
        site: "client.recoverMutation", rewrite: "recover with the original account and arguments", guide: "offline" });
    }
  }

  private verifyRecovery(record: RecoveryRecord, writer: ForwardingWriter, digest: string): void {
    if (record.scope !== writer.scope || record.principal !== writer.principal || record.authEpoch !== writer.authEpoch
      || record.partitionIncarnation !== writer.partitionIncarnation || record.payloadDigest !== digest) {
      throw new SnapbackRefusal({ code: "E_OFFLINE_FORWARDING_IDENTITY", family: "offline",
        message: "the mutation recovery token does not match the current writer account session",
        site: "client.recoverMutation", rewrite: "recover with the original account and partition", guide: "offline" });
    }
  }

  private async discover(): Promise<WriterAnnouncement | undefined> {
    const follower = this.followerRole;
    const generation = this.generation;
    if (!follower || !this.available || (!follower.persona && (!follower.established || follower.authEpoch === undefined))) return undefined;
    if (this.validWriter(this.discovered, follower)) return this.discovered;
    this.post({ protocol: PROTOCOL, type: "discover", followerId: follower.followerId });
    const deadline = Date.now() + this.responseTimeout;
    while (generation === this.generation && Date.now() < deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      if (generation !== this.generation || this.followerRole !== follower) return undefined;
      if (this.validWriter(this.discovered, follower)) return this.discovered;
    }
    return undefined;
  }

  private currentFollower(
    follower: (ForwardingFollower & { followerId: string }) | undefined, generation: number,
  ): boolean {
    return this.generation === generation && this.followerRole === follower;
  }

  private bindCommand(command: LogicalCommand, requestId: string): void {
    if (command.key === requestId) return;
    const existing = this.commands.get(requestId);
    if (existing && existing !== command) throw new TypeError("mutation request identity conflicts with an in-flight command");
    if (this.commands.get(command.key) === command) this.commands.delete(command.key);
    command.key = requestId; this.commands.set(requestId, command);
  }

  private releaseCommand(command: LogicalCommand): void {
    if (!command.pending && !command.recovery && this.commands.get(command.key) === command) {
      this.commands.delete(command.key);
    }
  }

  private validWriter(writer: WriterAnnouncement | undefined, follower: ForwardingFollower): writer is WriterAnnouncement {
    return writer !== undefined && writer.scope === follower.scope && writer.principal === follower.principal
      && (follower.persona || (follower.established && follower.authEpoch === writer.authEpoch));
  }

  private open(scope: string): void {
    const generation = ++this.generation;
    const channel = new BroadcastChannel(scope);
    this.channel = channel;
    channel.onmessage = ({ data }) => {
      if (generation !== this.generation || this.channel !== channel || !object(data) || data.protocol !== PROTOCOL) return;
      this.inbound = this.inbound.then(() => this.receive(data as unknown as Message)).catch(() => undefined);
    };
  }

  private post(message: Message): boolean {
    if (!this.channel) return false;
    try { this.channel.postMessage(message); return true; }
    catch { return false; /* a synchronous transport failure is known non-admission */ }
  }

  private async announce(): Promise<void> {
    const role = this.writerRole, current = this.host.writer();
    if (!role || !sameWriter(role, current)) return;
    let status: OutboxStatus;
    try { status = await this.host.status(); }
    catch { status = followerStatus("writer-capacity"); }
    if (this.writerRole !== role || !sameWriter(role, this.host.writer())) return;
    this.post({ protocol: PROTOCOL, type: "writer", ...current!, writerIncarnation: role.writerIncarnation, status });
  }

  private async receive(message: Message): Promise<void> {
    if (message.type === "discover") {
      if (typeof message.followerId === "string") await this.announce();
      return;
    }
    if (message.type === "writer") {
      const follower = this.followerRole;
      if (follower && typeof message.writerIncarnation === "string" && validStatus(message.status)
        && this.validWriter(message, follower)) {
        this.discovered = message;
        for (const [requestId, waiter] of this.statusWaiters) {
          if (waiter.writerIncarnation === message.writerIncarnation) continue;
          clearTimeout(waiter.timer); this.statusWaiters.delete(requestId);
          waiter.resolve(followerStatus("writer-discovery"));
        }
        this.updateUnresponsive(); this.notify();
      }
      return;
    }
    if (message.type === "status-answer") {
      const waiter = this.statusWaiters.get(message.requestId);
      const follower = this.followerRole;
      if (!waiter || !follower || !validStatus(message.status) || waiter.followerId !== message.followerId
        || waiter.writerIncarnation !== message.writerIncarnation || !this.validWriter({ ...message,
          type: "writer", status: message.status }, follower)) return;
      clearTimeout(waiter.timer); this.statusWaiters.delete(message.requestId);
      waiter.resolve(mappedStatus(message.status));
      if (this.updateUnresponsive()) this.notify();
      return;
    }
    if (message.type === "status") {
      const role = this.writerRole, current = this.host.writer();
      if (!role || typeof message.requestId !== "string" || typeof message.followerId !== "string"
        || (message.op !== undefined && typeof message.op !== "string")
        || message.targetWriterIncarnation !== role.writerIncarnation || !sameWriter(role, current)) return;
      try {
        const status = await this.host.status(message.op, message.followerId);
        if (this.writerRole === role && sameWriter(role, this.host.writer())) this.post({ protocol: PROTOCOL,
          type: "status-answer", ...current!, requestId: message.requestId, followerId: message.followerId,
          writerIncarnation: role.writerIncarnation, status });
      } catch { /* the follower exposes writer-unresponsive if the writer cannot answer */ }
      return;
    }
    if (message.type === "receipt-ack") {
      const role = this.writerRole, current = this.host.writer();
      if (!role || typeof message.requestId !== "string" || typeof message.followerId !== "string"
        || !Number.isSafeInteger(message.authEpoch) || typeof message.partitionIncarnation !== "string"
        || message.targetWriterIncarnation !== role.writerIncarnation || !sameWriter(role, current)
        || message.authEpoch !== current!.authEpoch || message.partitionIncarnation !== current!.partitionIncarnation) return;
      await this.host.acknowledge(message.requestId, message.followerId, message.authEpoch, message.partitionIncarnation); return;
    }
    if (message.type === "mutation") { await this.receiveMutation(message); return; }
    if (message.type === "mutation-answer") this.receiveMutationAnswer(message);
  }

  private async receiveMutation(message: MutationRequest): Promise<void> {
    const role = this.writerRole, current = this.host.writer();
    if (!role || message.targetWriterIncarnation !== role.writerIncarnation || !sameWriter(role, current)) return;
    if (typeof message.requestId !== "string" || typeof message.followerId !== "string"
      || typeof message.payloadDigest !== "string" || !Number.isSafeInteger(message.expiresAt)
      || typeof message.scope !== "string" || typeof message.principal !== "string"
      || !Number.isSafeInteger(message.authEpoch) || typeof message.partitionIncarnation !== "string"
      || typeof message.op !== "string" || typeof message.recovery !== "boolean") return;
    let result: MutationAnswer["result"];
    try {
      if (message.scope !== current!.scope || message.principal !== current!.principal
        || message.authEpoch !== current!.authEpoch || message.partitionIncarnation !== current!.partitionIncarnation
        || message.payloadDigest !== payloadDigest(message.op, message.args)) {
        throw new SnapbackRefusal({ code: "E_OFFLINE_FORWARDING_IDENTITY", family: "offline",
          message: "the forwarded mutation does not match this writer account session", site: "client.forwarding.admit",
          rewrite: "rediscover the current writer and recover the original request", guide: "offline" });
      }
      result = await this.host.admit(message) ?? { state: "admission-unknown", recovery: encode(message) };
      if (result.state === "queued") this.host.admitted();
    } catch (error) { result = { state: "refused", refusal: this.host.failure(error) }; }
    if (this.writerRole !== role || !sameWriter(role, this.host.writer())) return;
    this.post({ protocol: PROTOCOL, type: "mutation-answer", ...current!, requestId: message.requestId,
      followerId: message.followerId, writerIncarnation: role.writerIncarnation, result });
  }

  private receiveMutationAnswer(message: MutationAnswer): void {
    const lifecycle = this.commands.get(message.requestId), pending = lifecycle?.pending, follower = this.followerRole;
    if (!pending || !follower || !validResult(message.result) || pending.generation !== this.generation
      || message.followerId !== pending.command.followerId
      || message.scope !== pending.command.scope || message.principal !== pending.command.principal
      || message.authEpoch !== pending.command.authEpoch || message.partitionIncarnation !== pending.command.partitionIncarnation
      || pending.targetWriterIncarnation !== message.writerIncarnation) return;
    const attempt = pending.attempt;
    if (message.result.state === "queued") {
      this.post({ protocol: PROTOCOL, type: "receipt-ack", requestId: message.requestId,
        followerId: message.followerId, targetWriterIncarnation: message.writerIncarnation,
        authEpoch: message.authEpoch, partitionIncarnation: message.partitionIncarnation });
    }
    clearTimeout(pending.expiryTimer); lifecycle!.pending = undefined;
    if (attempt) {
      clearTimeout(attempt.timer); pending.attempt = undefined;
      if (message.result.state === "refused") attempt.reject(new SnapbackRefusal(message.result.refusal));
      else attempt.resolve(message.result);
    }
    this.releaseCommand(lifecycle!);
    this.updateUnresponsive(); this.notify();
  }

  private updateUnresponsive(): boolean {
    const next = [...this.commands.values()].some(item => item.pending?.timedOut);
    if (next === this.unresponsive) return false;
    this.unresponsive = next;
    return true;
  }
}

export interface ClientForwardingHost {
  url: string;
  runtime?: OfflineRuntime;
  closed(): boolean;
  fence(): number;
  write<Value>(run: () => Promise<Value>): Promise<Value>;
  failure(error: unknown, site: string): RefusalEnvelope;
  superseded(): SnapbackRefusal;
  admitted(): void;
}

/** Binds the transport protocol to one client's offline runtime and lifecycle fence. */
export class ClientForwarding {
  private readonly protocol: MutationForwarding;
  private readonly admissions = new Set<Promise<unknown>>();

  constructor(private readonly host: ClientForwardingHost) {
    this.protocol = new MutationForwarding({
      writer: () => this.writerContext(),
      status: (op, followerId) => this.host.runtime!.outbox.forwardingStatus(op, followerId),
      admit: command => this.admit(command),
      acknowledge: (request, follower, epoch, partition) =>
        this.host.runtime!.outbox.acknowledgeForwarded(request, follower, epoch, partition),
      failure: error => this.failure(error),
      admitted: () => this.host.admitted(),
    });
  }

  subscribe(listener: () => void): () => void { return this.protocol.subscribe(listener); }
  status(op?: string): Promise<OutboxStatus> { return this.protocol.status(op); }
  mutation(op: string, args: unknown, recovery?: MutationRecovery): Promise<MutationQueued | MutationAdmissionUnknown> {
    return this.protocol.mutation(op, args, recovery);
  }
  stop(): void { this.protocol.stop(); }

  following(principal: string, authenticated: boolean, authEpoch: number | undefined, persona: boolean): void {
    this.protocol.follower({ scope: this.scope(principal), principal, authEpoch,
      established: authenticated || persona, persona });
  }

  async activate(): Promise<void> {
    const runtime = this.host.runtime;
    if (runtime?.following) return;
    if (!runtime || !runtime.principal || runtime.authEpoch === undefined || !runtime.coordinationScope) {
      this.protocol.writer(undefined); return;
    }
    const principal = runtime.principal, epoch = runtime.authEpoch;
    await runtime.initializeForwarding(randomId());
    if (this.host.closed() || runtime.following || runtime.principal !== principal || runtime.authEpoch !== epoch) return;
    this.protocol.writer(this.writerContext());
  }

  async settled(): Promise<void> {
    while (this.admissions.size > 0) await Promise.allSettled([...this.admissions]);
  }

  private scope(principal: string): string {
    const carrier = this.host.runtime?.coordinationScope;
    if (!carrier) throw new TypeError("the offline carrier has no browser-tab coordination scope");
    return mutationForwardingScope(this.host.url, carrier, principal);
  }

  private writerContext(): ForwardingWriter | undefined {
    const runtime = this.host.runtime;
    if (!runtime || runtime.following || !runtime.principal || runtime.authEpoch === undefined
      || !runtime.partitionIncarnation || !runtime.coordinationScope) return undefined;
    return { scope: this.scope(runtime.principal), principal: runtime.principal,
      authEpoch: runtime.authEpoch, partitionIncarnation: runtime.partitionIncarnation };
  }

  private admit(command: ForwardingCommand): Promise<MutationQueued | undefined> {
    const runtime = this.host.runtime, writer = this.writerContext();
    if (!runtime || !writer || writer.scope !== command.scope || writer.principal !== command.principal
      || writer.authEpoch !== command.authEpoch || writer.partitionIncarnation !== command.partitionIncarnation) {
      return Promise.reject(new SnapbackRefusal({ code: "E_OFFLINE_FORWARDING_IDENTITY", family: "offline",
        message: "the forwarded mutation does not belong to this writer account session",
        site: "client.forwarding.admit", rewrite: "rediscover the current writer and recover the original request", guide: "offline" }));
    }
    const fence = this.host.fence();
    const current = () => !this.host.closed() && this.host.fence() === fence && this.writerContext()?.scope === writer.scope
      && this.writerContext()?.authEpoch === writer.authEpoch
      && this.writerContext()?.partitionIncarnation === writer.partitionIncarnation;
    const request = this.host.write(async () => {
      if (!current()) throw this.host.superseded();
      const admitted = await runtime.outbox.admitForwarded(
        { op: command.op, args: command.args, issuedSeq: runtime.seq }, command,
        async ids => {
          if (!current()) throw this.host.superseded();
          const prediction = await runtime.predict(command.op, command.args, ids);
          if (!current()) throw this.host.superseded();
          return prediction;
        },
        () => { if (!current()) throw this.host.superseded(); },
      );
      return admitted && { state: "queued" as const, intent: admitted.intent, ids: admitted.ids };
    });
    this.admissions.add(request);
    void request.finally(() => this.admissions.delete(request)).catch(() => undefined);
    return request;
  }

  private failure(error: unknown): RefusalEnvelope {
    const admission = error && typeof error === "object" && (error as { name?: unknown }).name === "ForwardingAdmissionError"
      ? error as Error & { reason?: "identity" | "capacity" | "expiration" | "conflict" } : undefined;
    if (!admission) return error instanceof SnapbackRefusal ? error.envelope
      : this.host.failure(error, "client.forwarding.admit");
    const code = admission.reason === "capacity" ? "E_OFFLINE_FORWARDING_CAPACITY"
      : admission.reason === "expiration" ? "E_OFFLINE_FORWARDING_EXPIRATION" : "E_OFFLINE_FORWARDING_IDENTITY";
    return { code, family: "offline", message: admission.message, site: "client.forwarding.admit",
      rewrite: admission.reason === "capacity" ? "wait for a receipt slot or recover an existing request"
        : "recover only the original request under its account session and partition", guide: "offline" };
  }
}
