import { cloudflareClientOptions } from '../../../../cloudflare/client-options.mjs';
import { snapbackBaseUrlForTarget } from '../../../_kit/target-origin.mjs';

export function resolveSnapbackTargetProfile(configuredProfile: string | undefined): string {
  return configuredProfile ?? 'local-dev-sqlite-ibex';
}

export function snapbackClientOptionsForTarget(
  targetProfile: string,
): Record<string, unknown> {
  // @ref LLP 0058#kit-ordering — auth probing is selected by target, never by a failed network probe.
  return targetProfile === 'cloudflare-do-sqlite-v8'
    ? cloudflareClientOptions()
    : {};
}

export function snapbackWebBaseUrlForTarget(
  targetProfile: string,
  configuredOrigin: string | undefined,
  serverOrigin: string | undefined,
): string {
  return snapbackBaseUrlForTarget({
    configuredOrigin,
    serverOrigin,
    surface: 'web',
    targetProfile,
  });
}

export function snapbackNativeBaseUrlForTarget(
  targetProfile: string,
  configuredOrigin: string | undefined,
  serverOrigin: string | undefined,
): string {
  return snapbackBaseUrlForTarget({
    configuredOrigin,
    serverOrigin,
    surface: 'native',
    targetProfile,
  });
}
