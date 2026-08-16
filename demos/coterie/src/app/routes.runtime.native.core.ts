// GENERATED FILE — do not edit by hand.
// Emitted by packages/exact-devtools/src/scripts/generate-route-registries.ts
// from src/app/routes/** and src/app/routes.profiles.ts (LLP 0154 P3).
// Regenerate with `bun run generate:routes` at the project root.
import type { RouteModuleMap } from '@exact/router/types';

import { defineContractRouteModule } from './contract-route-module.js';

const aboutRoute = defineContractRouteModule(() => import('./routes/about.contract'), { screen: { title: "About" } as const, head: { title: "About" } });
const chatIdRoute = defineContractRouteModule(() => import('./routes/chat/[id].contract'), { screen: { title: "Id" } as const, head: { title: "Id" }, agentCapabilities: { canRead: true } });
const chatIdSettingsRoute = defineContractRouteModule(() => import('./routes/chat/[id]/settings.contract'), { screen: { title: "Settings" } as const, head: { title: "Settings" }, agentCapabilities: { canRead: true } });
const chatsRoute = defineContractRouteModule(() => import('./routes/chats.contract'), { screen: { title: "Chats" } as const, head: { title: "Chats" }, agentCapabilities: { canRead: true } });
const indexRoute = defineContractRouteModule(() => import('./routes/index.contract'), { screen: { title: "Index" } as const, head: { title: "Index" }, agentCapabilities: { canRead: true } });
const insightsRoute = defineContractRouteModule(() => import('./routes/insights.contract'), { screen: { title: "Insights" } as const, head: { title: "Insights" }, agentCapabilities: { canRead: true } });
const mediaIdRoute = defineContractRouteModule(() => import('./routes/media/[id].contract'), { screen: { title: "Id" } as const, head: { title: "Id" }, agentCapabilities: { canRead: true } });
const profileIdRoute = defineContractRouteModule(() => import('./routes/profile/[id].contract'), { screen: { title: "Id" } as const, head: { title: "Id" }, agentCapabilities: { canRead: true } });
const searchRoute = defineContractRouteModule(() => import('./routes/search.contract'), { screen: { title: "Search" } as const, head: { title: "Search" }, agentCapabilities: { canRead: true } });

export const appRouteModules = {
  'app/about.contract': aboutRoute,
  'app/chat/[id].contract': chatIdRoute,
  'app/chat/[id]/settings.contract': chatIdSettingsRoute,
  'app/chats.contract': chatsRoute,
  'app/index.contract': indexRoute,
  'app/insights.contract': insightsRoute,
  'app/media/[id].contract': mediaIdRoute,
  'app/profile/[id].contract': profileIdRoute,
  'app/search.contract': searchRoute,
} satisfies RouteModuleMap;
