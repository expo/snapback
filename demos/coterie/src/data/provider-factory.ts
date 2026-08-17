import type { ContractDataProvider } from '@exact/contract/runtime';

import { configureFromProvider } from './generated/coterie.bindings.ts';
import {
  createCoterieMemoryHarness,
  createCoterieMemoryProvider,
} from './memory-provider.ts';
import { createCoterieSnapbackProvider } from './snapback-provider.ts';

type ProviderFactory = () => ContractDataProvider;

// @ref LLP 0266#d8-provider-selection-at-boot — provider identity is consumed
// once, here; every registry entry configures the same generated bindings.
export const coterieProviderRegistry = {
  memory: createCoterieMemoryProvider,
  snapback: createCoterieSnapbackProvider,
} satisfies Record<string, ProviderFactory>;

export type CoterieProviderName = keyof typeof coterieProviderRegistry;

export const COTERIE_PROVIDER_NAMES = Object.freeze(
  Object.keys(coterieProviderRegistry).sort() as CoterieProviderName[],
);

export interface CoterieProviderBoot {
  provider: ContractDataProvider;
  advanceClock?: (ms: number) => void;
  dispose(): void;
}

export function resolveCoterieProviderName(
  requested: string | null | undefined,
): CoterieProviderName {
  const selected = requested ?? 'memory';
  if (Object.hasOwn(coterieProviderRegistry, selected)) {
    return selected as CoterieProviderName;
  }
  throw new Error(
    `Unknown COTERIE_PROVIDER "${selected}"; valid values: ${COTERIE_PROVIDER_NAMES.join(', ')}`,
  );
}

export function bootCoterieProvider(
  requested?: string | null,
): CoterieProviderBoot {
  const selected = resolveCoterieProviderName(requested);
  const memoryHarness = selected === 'memory' ? createCoterieMemoryHarness() : null;
  const provider = memoryHarness?.provider ?? coterieProviderRegistry[selected]();
  const projection = configureFromProvider(provider);
  return {
    provider,
    ...(memoryHarness ? { advanceClock: (ms: number) => memoryHarness.advanceClock(ms) } : {}),
    dispose: () => {
      projection.dispose();
      if ('dispose' in provider && typeof provider.dispose === 'function') {
        provider.dispose();
      }
    },
  };
}
