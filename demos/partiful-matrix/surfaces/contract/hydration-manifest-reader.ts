import {
  validateContractHydrationManifest,
  type ContractHydrationManifest,
} from '@exact/contract/runtime';

/**
 * Published Exact 0.1.5 compatibility reader. The Vite config capability-
 * selects the compact current-Exact implementation when it is available.
 */
export function readPartitimeHydrationManifest(
  value: unknown,
): ContractHydrationManifest | null {
  const validation = validateContractHydrationManifest(value);
  return validation.ok ? validation.manifest : null;
}
