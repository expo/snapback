import {
  resolveSnapbackTargetProfile,
  snapbackClientOptionsForTarget,
  snapbackNativeBaseUrlForTarget,
  snapbackWebBaseUrlForTarget,
} from './target-profile';

// Build-time target identity injected by vite.config.ts. Local/native builds
// keep the auth-capable client default; the Cloudflare proof opts out because
// its manifest explicitly declares external auth unavailable.
declare const __SNAPBACK_TARGET_PROFILE__: string | undefined;

function currentTargetProfile(): string {
  return resolveSnapbackTargetProfile(
    typeof __SNAPBACK_TARGET_PROFILE__ === 'string'
      ? __SNAPBACK_TARGET_PROFILE__
      : undefined,
  );
}

export function snapbackTargetClientOptions(): Record<string, unknown> {
  return snapbackClientOptionsForTarget(currentTargetProfile());
}

export function snapbackWebBaseUrl(
  configuredOrigin: string | undefined,
  serverOrigin: string | undefined,
): string {
  return snapbackWebBaseUrlForTarget(
    currentTargetProfile(),
    configuredOrigin,
    serverOrigin,
  );
}

export function snapbackNativeBaseUrl(
  configuredOrigin: string | undefined,
  serverOrigin: string | undefined,
): string {
  return snapbackNativeBaseUrlForTarget(
    currentTargetProfile(),
    configuredOrigin,
    serverOrigin,
  );
}
