export const AGENT_DIGEST_FORMAT_VERSION: 'snapback.agent-digest.v1';
export const AGENT_DIGEST_CURSOR_PREFIX: 'sbad1.';
export const DEFAULT_DIGEST_BUDGET_BYTES: 32768;
export const DEFAULT_DIGEST_BUDGET_ITEMS: 256;
export function canonicalJson(value: unknown): string;
export function parseDigestCursor(value: string, options?: { readonly nowMs?: number }): Readonly<Record<string, unknown>>;
export function buildAgentDigest(options: {
  readonly surface: Readonly<Record<string, unknown>>;
  readonly inspection?: Readonly<Record<string, unknown>> | null;
  readonly principalClass?: string;
  readonly principalSource?: string;
  readonly changedSince?: string | null;
  readonly budgetBytes?: number;
  readonly budgetItems?: number;
  readonly nowMs?: number;
}): Readonly<Record<string, unknown>>;

