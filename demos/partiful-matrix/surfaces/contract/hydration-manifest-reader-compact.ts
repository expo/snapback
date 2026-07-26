import {
  readContractHydrationManifestValue,
  type ContractHydrationManifest,
} from '@exact/contract/runtime';

export function readPartitimeHydrationManifest(
  value: unknown,
): ContractHydrationManifest | null {
  return readContractHydrationManifestValue(value);
}
