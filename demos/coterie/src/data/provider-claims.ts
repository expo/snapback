import declarationJson from './coterie.provider.json';
import type { ProviderClaim } from './generated/coterie.types.ts';

type OperationKind = 'mutation' | 'query';

interface ClaimSelection {
  queries: readonly string[];
  mutations: readonly string[];
}

const declaration = declarationJson as {
  queries: Array<{ name: string; compatibilityToken: string }>;
  mutations: Array<{ name: string }>;
  extensions: Record<string, unknown>;
};

const queryTokens = new Map(
  declaration.queries.map((query) => [query.name, query.compatibilityToken]),
);
const mutationNames = new Set(declaration.mutations.map((mutation) => mutation.name));
const mutationTokens = new Map<string, string>();

for (const [extensionName, extensionValue] of Object.entries(declaration.extensions)) {
  if (!extensionName.endsWith('CompatibilityTokens') || !isRecord(extensionValue)) continue;
  for (const [operationName, token] of Object.entries(extensionValue)) {
    if (mutationNames.has(operationName) && typeof token === 'string') {
      mutationTokens.set(operationName, token);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function claim(name: string, kind: OperationKind): ProviderClaim {
  const token = kind === 'query'
    ? queryTokens.get(name)
    : mutationTokens.get(name) ?? '1';
  if (!token) {
    throw new Error(`Coterie provider claim ${kind} ${name} has no compatibility token`);
  }
  return { name, kind, token };
}

/**
 * Provider qualification stays behind the shared declaration seam. Query
 * tokens come from the core declaration; mutation tokens use the milestone
 * extensions until Exact grows a first-class mutation token field.
 *
 * @ref LLP 0266#d8-provider-selection-at-boot — the UI observes operation
 * claims, never the selected provider's identity.
 */
export function coterieProviderClaims(selection: ClaimSelection): ProviderClaim[] {
  return [
    ...selection.queries.map((name) => claim(name, 'query')),
    ...selection.mutations.map((name) => claim(name, 'mutation')),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

export function allCoterieProviderClaims(): ProviderClaim[] {
  return coterieProviderClaims({
    queries: declaration.queries.map((query) => query.name),
    mutations: declaration.mutations.map((mutation) => mutation.name),
  });
}

