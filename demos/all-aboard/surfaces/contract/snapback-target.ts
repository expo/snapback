import { cloudflareClientOptions } from '../../../../cloudflare/client-options.mjs';
import { snapbackBaseUrlForTarget } from '../../../_kit/target-origin.mjs';

// Build-time target identity injected by vite.config.ts. Local/native builds
// keep the auth-capable client default; the Cloudflare proof opts out because
// its manifest explicitly declares external auth unavailable.
// @ref LLP 0058#kit-ordering — auth probing is selected by target, never by a failed network probe.
declare const __SNAPBACK_TARGET_PROFILE__: string | undefined;

function currentTargetProfile(): string {
  return typeof __SNAPBACK_TARGET_PROFILE__ === 'string'
    ? __SNAPBACK_TARGET_PROFILE__
    : 'local-dev-sqlite-ibex';
}

export function snapbackTargetClientOptions(): Record<string, unknown> {
  return currentTargetProfile() === 'cloudflare-do-sqlite-v8'
    ? cloudflareClientOptions()
    : {};
}

export function snapbackWebBaseUrl(
  configuredOrigin: string | undefined,
  serverOrigin: string | undefined,
): string {
  return snapbackBaseUrlForTarget({
    configuredOrigin,
    serverOrigin,
    surface: 'web',
    targetProfile: currentTargetProfile(),
  });
}

export function snapbackNativeBaseUrl(
  configuredOrigin: string | undefined,
  serverOrigin: string | undefined,
): string {
  return snapbackBaseUrlForTarget({
    configuredOrigin,
    serverOrigin,
    surface: 'native',
    targetProfile: currentTargetProfile(),
  });
}
