// GENERATED FILE — do not edit by hand.
// Emitted by packages/exact-devtools/src/scripts/generate-route-registries.ts
// from src/app/routes/** and src/app/routes.profiles.ts (LLP 0154 P3).
// Regenerate with `bun run generate:routes` at the project root.
// Structured route ownership + 0433 policy projections (LLP 0435 §3.1/M1).
import { classifyWebFallbackRouteOwnership as classifyOwnership } from '@exact/router/web-fallback-ownership';
import type { WebFallbackRouteOwnershipClassifier } from '@exact/router/web-fallback-ownership';
import type { WebFallbackZoneRouteArtifact } from '@exact/router/web-fallback-artifacts';

export const webFallbackRouteOwnershipClassifier =
{
  "schemaVersion": 1,
  "explicitRoutes": [
    {
      "pathnamePattern": "/about",
      "routeId": "app/about.contract",
      "owningProfile": "app"
    },
    {
      "pathnamePattern": "/",
      "routeId": "app/index.contract",
      "owningProfile": "app"
    }
  ],
  "zone": null,
  "digest": "sha256:fafc33e54c50ea7ac9d706d67d30e0b1903788ee8237010ce6f428a4e58aed61"
} as const satisfies WebFallbackRouteOwnershipClassifier;
export const webFallbackLabRouteOwnershipClassifiers: Readonly<Record<string, WebFallbackRouteOwnershipClassifier>> =
{};
export const webFallbackNavigationPolicy =
{
  "schemaVersion": 2,
  "rules": [],
  "default": "external"
} as const;
export const webFallbackNavigationPoliciesByProfile: Readonly<Record<string, unknown>> =
{};
export const webFallbackShadowRoutes =
[] as const;
export const webFallbackShadowRoutesByProfile: Readonly<Record<string, readonly WebFallbackZoneRouteArtifact[]>> =
{};

export function selectWebFallbackRouteOwnershipClassifier(profile: string | undefined) {
  return (profile ? webFallbackLabRouteOwnershipClassifiers[profile] : undefined)
    ?? webFallbackRouteOwnershipClassifier;
}
export function selectWebFallbackNavigationPolicy(profile: string | undefined) {
  return (profile ? webFallbackNavigationPoliciesByProfile[profile] : undefined)
    ?? webFallbackNavigationPolicy;
}
export function selectWebFallbackShadowRoutes(profile: string | undefined) {
  return (profile ? webFallbackShadowRoutesByProfile[profile] : undefined)
    ?? webFallbackShadowRoutes;
}
export function classifyWebFallbackRouteOwnership(urlOrPathname: string, profile?: string) {
  return classifyOwnership(selectWebFallbackRouteOwnershipClassifier(profile), urlOrPathname);
}
