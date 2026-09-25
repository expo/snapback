import type { Client, Refusal, Session } from "./contract.ts";
import type { SessionStore } from "./auth.ts";
import type { BackendJson } from "./backend.ts";
import type { PendingSend } from "./local-exit.ts";
import type { MediaStorage, AssetRetention } from "./local-assets.ts";
import { admissionCapture } from "./admission.ts";
import { admissionOwnership, type AdmissionAuthorityContext } from "./admission-authority.ts";

/** One JSON call into the device: `{ op, ... }` in, `{ ok } | { denied }` out. */
export interface DeviceCore {
  /** Internal web capabilities. Adapters must forward all properties (including
   * symbols) with {...core} before overriding methods. */
  [admissionCapture]?: (request: Record<string, unknown>) => Refusal | undefined;
  [admissionOwnership]?: (context: AdmissionAuthorityContext) => void;
  /** Native host instrumentation, absent on ordinary launches. Uses this client, never a second one. */
  onClient?(client: LocalClient, url: string): void | (() => void);
  readonly media?: MediaStorage;
  /** Web recovery may acquire an orphan outbox without a backend change. */
  onOutbox?(listener: () => void): () => void;
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
  open(name: string, backend: DeviceOpening | null): Promise<DeviceCore>;
}

export interface LocalOptions {
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
};
