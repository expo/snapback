import {
  resolveSnapbackTargetProfile,
  snapbackClientOptionsForTarget,
  snapbackWebBaseUrlForTarget,
} from './target-profile';

// @ref LLP 0030#proxy-surface — the web adapter deliberately avoids a
// /snapback* module URL because Vite's legacy /snapback API relay is a prefix
// match. Native keeps the build-folded snapback-target.ts adapter separately.
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
