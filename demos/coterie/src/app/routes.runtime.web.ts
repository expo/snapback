// GENERATED FILE — do not edit by hand.
// Emitted by packages/exact-devtools/src/scripts/generate-route-registries.ts
// from src/app/routes/** and src/app/routes.profiles.ts (LLP 0154 P3).
// Regenerate with `bun run generate:routes` at the project root.
import type { RouteModuleMap } from '@exact/router/types';

import { defineContractRouteModule } from './contract-route-module.js';

const aboutRoute = defineContractRouteModule(() => import('./routes/about.contract'), { screen: { title: "About" } as const, head: { title: "About" } });
const indexRoute = defineContractRouteModule(() => import('./routes/index.contract'), { screen: { title: "Index" } as const, head: { title: "Index" }, agentCapabilities: { canRead: true } });

export const appRouteModules = {
  'app/about.contract': aboutRoute,
  'app/index.contract': indexRoute,
} satisfies RouteModuleMap;
