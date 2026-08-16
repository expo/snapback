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
      "pathnamePattern": "/chat/:id/settings",
      "routeId": "app/chat/[id]/settings.contract",
      "owningProfile": "app"
    },
    {
      "pathnamePattern": "/chat/:id",
      "routeId": "app/chat/[id].contract",
      "owningProfile": "app"
    },
    {
      "pathnamePattern": "/media/:id",
      "routeId": "app/media/[id].contract",
      "owningProfile": "app"
    },
    {
      "pathnamePattern": "/profile/:id",
      "routeId": "app/profile/[id].contract",
      "owningProfile": "app"
    },
    {
      "pathnamePattern": "/about",
      "routeId": "app/about.contract",
      "owningProfile": "app"
    },
    {
      "pathnamePattern": "/chats",
      "routeId": "app/chats.contract",
      "owningProfile": "app"
    },
    {
      "pathnamePattern": "/insights",
      "routeId": "app/insights.contract",
      "owningProfile": "app"
    },
    {
      "pathnamePattern": "/search",
      "routeId": "app/search.contract",
      "owningProfile": "app"
    },
    {
      "pathnamePattern": "/",
      "routeId": "app/index.contract",
      "owningProfile": "app"
    }
  ],
  "zone": null,
  "digest": "sha256:c4934b3d1861c2dfec600372a6748c83b85e093f6059ccad052e5ebf6494ea6e"
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
