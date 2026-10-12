import type { Client, Refusal, Session } from "./contract.ts";
import type { SessionStore } from "./auth.ts";
import type { BackendJson } from "./backend.ts";
import type { PendingSend } from "./local-exit.ts";
import type { MediaStorage, AssetRetention } from "./local-assets.ts";
import { admissionCapture } from "./admission.ts";
import { deviceControl, type DeviceControlSnapshot } from "./device-control.ts";
import { deviceRestore, type RestoreFence } from "./device-restore.ts";
import { admissionOwnership, type AdmissionAuthorityContext } from "./admission-authority.ts";
import type { Queued } from "./local-types.ts";

// @ref LLP 3000.022#4 — supplementary manifests require a conditional host commit.
export const deliveryCommit = Symbol.for("snapback4.deliveryCommit");

/** One JSON call into the device: `{ op, ... }` in, `{ ok } | { denied }` out. */
export interface DeviceCore {
  [deviceControl]?: () => DeviceControlSnapshot | undefined;
  /** Withdraw read/exit authority; report identity validation even after a retry. */
  [deviceRestore]?: RestoreFence;
  /** Conditional collection CAS. Recheck current after host waits and at the
   * atomic persistence commit. A stale attempt succeeds without writing; a
   * CAS conflict returns { ok: false } for a freshly fenced retry. A host
   * without this capability omits supplementary fallback collections. */
  [deliveryCommit]?(request: Record<string, unknown>, current: () => boolean): Promise<Record<string, unknown>>;
  /** Internal web capabilities. Adapters must forward all properties (including
   * symbols) with {...core} before overriding methods. */
  [admissionCapture]?: (request: Record<string, unknown>) => Refusal | undefined;
  [admissionOwnership]?: (context: AdmissionAuthorityContext) => void;
  /** Native host instrumentation, absent on ordinary launches. Uses this client, never a second one. */
  onClient?(client: LocalClient, url: string): void | (() => void);
  readonly media?: MediaStorage;
  /** Web recovery reports committed time and entries before later device calls. */
  onOutbox?(listener: (issuedFloor: number | undefined, entries: readonly Queued[]) => void): () => void;
  /** Web hosts alone: committed unsent writes at pagehide/hidden, synchronously. */
  onSuspend?(flush: (entries: readonly PendingSend[], beginSend: () => boolean) => void): () => void;
  /** A host with fallible work after commit must synchronously expose the
   * durable reply through committed before that work. Forward this callback
   * through adapters. Hosts returning directly may omit it; the client also
   * observes the returned reply. A failed save must never invoke it. The
   * callback invalidates memory only; application delivery waits for call
   * completion (including rejection) so it cannot reenter host bookkeeping. */
  call(request: Record<string, unknown>, committed?: (reply: Record<string, unknown>) => void): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/** A first-install request must preserve a backend another owner installed. */
export type DeviceOpening = BackendJson | { initial_backend: BackendJson };

/** How a host opens its device: a store name the client derives from the
 * server and the viewer (the host decides where that lives), and the
 * backend the server sent — null to open on the one kept from last time,
 * or { initial_backend } to install only if empty and otherwise open the kept
 * backend. Hosts must preserve this envelope across their native boundary. */
export interface DeviceOpener {
  /** Actual Rust engine build, available before backend decoding. */
  engineInfo?(): Promise<import("./device-version.ts").DeviceEngine>;
  open(name: string, backend: DeviceOpening | null): Promise<DeviceCore>;
}

export interface LocalOptions {
  /** A delivery interval the server refused; queued reports do not enter onWrite. */
  readonly onDeliveryRefused?: (event: import("./delivery-state.ts").DeliveryRefused) => void;
  readonly onDeviceVersion?: (status: import("./device-version.ts").DeviceVersionStatus) => void;
  readonly url: string;
  readonly persona?: string;
  readonly session?: Session;
  readonly guest?: boolean;
  readonly sessionStore?: SessionStore;
  readonly fetch?: typeof fetch;
  /** The device: `webDevice()` on the web, `nativeDevice` from
   * `snapback4-expo`, `processDevice({ dir })` in Node. */
  readonly device: DeviceOpener;
  readonly waitSeconds?: number;
  /** Ordinary viewed media only; default is no retained bytes. */
  readonly assets?: AssetRetention;
}

export type LocalClient = Client & {
  sync(): Promise<void>;
  deviceVersion(): import("./device-version.ts").DeviceVersionStatus;
};
