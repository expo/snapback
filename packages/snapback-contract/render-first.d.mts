import type { SnapbackProviderDiagnostic } from './diagnostics.mjs';
import type {
  ContractRuntimeLike,
  CreateSnapbackContractSurfaceOptions,
  SnapbackContractSurface,
} from './index.mjs';

export type DeferredContractLinkFunction = (args?: Record<string, unknown>) => unknown;

export interface DeferredContractLinks {
  readonly links: Readonly<Record<string, DeferredContractLinkFunction>>;
  readonly attached: boolean;
  readonly pendingAttachCount: number;
  attach(real: Readonly<Record<string, DeferredContractLinkFunction>>): void;
  onFirstDelivery(callback: () => void): void;
  dispose(): void;
}

/**
 * Forwarding Contract links that stay silent until the real links attach:
 * query/ephemeral handles hold 'pending', mutation and publish links queue.
 */
export function createDeferredContractLinks(options?: {
  queries?: readonly string[];
  mutations?: readonly string[];
  ephemerals?: readonly string[];
}): DeferredContractLinks;

export interface CreateRenderFirstSnapbackContractSurfaceOptions
  extends Omit<Partial<CreateSnapbackContractSurfaceOptions>, 'runtime'> {
  /** May be the runtime namespace or a promise of one. */
  runtime?: ContractRuntimeLike | PromiseLike<ContractRuntimeLike>;
  connect?:
    | ((context: Readonly<{ client: unknown; attempt: number }>) => unknown)
    | null;
  onRetry?:
    | ((error: unknown, info: Readonly<{ attempt: number; delayMs: number }>) => void)
    | null;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

export interface RenderFirstSnapbackContractSurface {
  readonly links: Readonly<Record<string, DeferredContractLinkFunction>>;
  /** Resolves with the real surface once the background connect loop attaches. */
  readonly attached: Promise<SnapbackContractSurface>;
  surface(): SnapbackContractSurface | null;
  readonly diagnostics: SnapbackProviderDiagnostic[];
  onFirstDelivery(callback: () => void): void;
  dispose(): void;
}

/**
 * Render-before-connect surface (ENG-23736): links return synchronously with
 * every binding pending; connection, ensure, and subscription establishment
 * run behind the mounted app and bindings go live in place on attach.
 */
export function createRenderFirstSnapbackContractSurface(
  options?: CreateRenderFirstSnapbackContractSurfaceOptions,
): RenderFirstSnapbackContractSurface;
