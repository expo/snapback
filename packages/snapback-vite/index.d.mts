export type SnapbackViteLifecycleMode =
  | 'off'
  | 'external'
  | 'attach'
  | 'managed'
  | 'auto';

export interface SnapbackDevSetupOptions {
  /** Backend source directory whose generated graph is owned by snapback dev. */
  backendDirectory: string;
  schema?: string;
  functions?: string;
  seed?: string;
  reset?: 'if-new' | 'always' | 'never';
}

export interface SnapbackDevOptions {
  route?: string;
  projectRoot?: string;
  generatedRoots?: readonly string[];
  allowNonLoopbackHost?: boolean;
  server?: {
    mode?: SnapbackViteLifecycleMode;
    url?: string;
    readyFile?: string;
    applicationReadyFile?: string;
    database?: string;
    backendDirectory?: string;
    /** Fixed Snapback backend port. Defaults to 3210 in managed/auto mode. */
    port?: number;
    runtimeBinary?: string;
    qualifiedRuntimeBinary?: string;
    stdio?: 'ignore' | 'inherit' | number | readonly unknown[];
  };
  setup?: SnapbackDevSetupOptions | false | null;
  env?: Readonly<Record<string, string | undefined>>;
  logJson?: boolean;
  onEvent?: (event: SnapbackDevDiagnosticEvent) => void;
  onDiagnostic?: (diagnostic: Readonly<Record<string, unknown>>) => void;
}

// Deliberately structural: @expo/snapback-vite supports multiple Vite majors and
// must not leak the package build's peer copy into an application's config
// type graph.
export function snapbackDev(options?: SnapbackDevOptions): {
  readonly name: 'snapback-dev';
  readonly [hook: string]: any;
};

export const VIRTUAL_MODULE_ID: 'virtual:snapback/dev';
export const LIFECYCLE_MODES: readonly SnapbackViteLifecycleMode[];

export function resolveGeneratedImport(id: string, importer: string): string | null;
export function renderVirtualModule(input: {
  base: string;
  state?: Readonly<Record<string, unknown>>;
  binding?: Readonly<Record<string, unknown>> | null;
}): string;

export default snapbackDev;

// Runtime re-exports from the declared subpath modules.
export { APP_ROUTE_ALLOWLIST, matchAppRoute } from './allowlist.mjs';
export type { AppRouteAllowlistEntry } from './allowlist.mjs';
export { matchManifestRoute } from './channel-a-core.mjs';
export { snapbackChannelA } from './channel-a.mjs';
export type { ChannelAEvent, SnapbackChannelAOptions } from './channel-a.mjs';
export { htmlSafeJsonSerialize, serializeBootPayload } from './rqs-serializer.mjs';

// Lifecycle + relay helpers (lifecycle.mjs / proxy.mjs internals re-exported
// at the package root).
export interface SnapbackDevDiagnosticEvent {
  readonly schemaVersion: 'snapback.vite-dev.v1';
  readonly subsystem: 'vite-plugin';
  readonly [key: string]: unknown;
}

export interface SnapbackDiagnosticsChannel {
  emit(event: Readonly<Record<string, unknown>>): SnapbackDevDiagnosticEvent;
}

export function createDiagnosticsChannel(options?: {
  readonly onEvent?: ((event: SnapbackDevDiagnosticEvent) => void) | null;
  readonly logJson?: boolean;
}): SnapbackDiagnosticsChannel;

export interface SnapbackDevLifecycleState {
  readonly mode: SnapbackViteLifecycleMode;
  readonly shape: string | null;
  readonly ready: boolean;
  readonly managed: boolean;
  readonly serverUrl: string | null;
  readonly pid: number | null;
}

export interface SnapbackViteLifecycle {
  readonly mode: SnapbackViteLifecycleMode;
  readonly projectRoot: string;
  readonly database: string;
  readonly readyFile: string;
  readonly applicationReadyFile: string;
  start(): Promise<SnapbackDevLifecycleState>;
  close(): Promise<void>;
  /** Re-resolve the backend target from the ready file; null when no live
   * verified target exists. */
  refreshTarget(): Promise<SnapbackDevLifecycleState | null>;
  /** Read the current process-custodied relay capability; never projected by
   * the browser-visible virtual module. */
  readDevIdentityCapability(): string | null;
  /** Receipt-issued binding consumed by the server-side virtual-module projection. */
  binding(): Readonly<Record<string, unknown>> | null;
  state(): SnapbackDevLifecycleState;
}

export function createSnapbackViteLifecycle(options?: {
  readonly mode?: SnapbackViteLifecycleMode;
  readonly projectRoot?: string;
  readonly database?: string;
  readonly readyFile?: string;
  readonly applicationReadyFile?: string;
  readonly url?: string | null;
  readonly port?: number;
  readonly clientOrigin?: string | null;
  readonly runtimeBinary?: string;
  readonly qualifiedRuntimeBinary?: string;
  readonly serverStdio?: 'ignore' | 'inherit' | number | readonly unknown[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly readyTimeoutMs?: number;
  readonly channel?: SnapbackDiagnosticsChannel;
  readonly setup?: Readonly<Record<string, unknown>> | false | null;
  readonly onBindingRefresh?: ((binding: Readonly<Record<string, unknown>>) => void) | null;
  readonly onEvent?: ((event: SnapbackDevDiagnosticEvent) => void) | null;
  readonly logJson?: boolean;
}): SnapbackViteLifecycle;

export interface SnapbackProxyDiagnostic {
  code: string;
  severity: 'error';
  subsystem: 'vite-plugin';
  message: string;
  details: Record<string, unknown>;
}

export function refusalDiagnostic(input: {
  readonly method?: string;
  readonly path?: string | null;
  readonly route?: string;
  readonly mode?: string;
}): SnapbackProxyDiagnostic;

export function unreachableDiagnostic(input: {
  readonly path?: string | null;
  readonly route?: string;
  readonly mode?: string;
  readonly serverUrl?: string | null;
  readonly cause?: unknown;
}): SnapbackProxyDiagnostic;

/** Connect-style middleware pair for the /__snapback relay; `req`/`res`/
 * `socket` are host HTTP objects, typed opaquely so this declaration does
 * not require Node types. */
export interface SnapbackDevProxy {
  handleRequest(req: unknown, res: unknown, next: (error?: unknown) => void): unknown;
  handleUpgrade(req: unknown, socket: unknown, head: unknown): void;
}

export function createSnapbackProxy(options: {
  readonly base: string;
  readonly mode: SnapbackViteLifecycleMode;
  readonly getState: () => SnapbackDevLifecycleState;
  readonly channel?: SnapbackDiagnosticsChannel | null;
  readonly refreshTarget?: (() => Promise<SnapbackDevLifecycleState | null>) | null;
  readonly getDevIdentityCapability?: (() => string | null) | null;
}): SnapbackDevProxy;
