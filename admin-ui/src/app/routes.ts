// Route registry — the build-time unlock for LLP 0268 static platform
// manifests. exactVitePlugin's static exporter only runs inside the route-backed
// served-app build, which requires an `appRouteModules` registry next to the
// entry. This is a React-free stub (imported from @exact/router/types, NOT the
// @exact/router barrel, which would pull React into the prerender SSR): the
// console is client-rendered and still mounts via main.ts's `mount(app)`. The
// registry exists so the build emits the web HTML discovery metadata plus the
// __exact/ native artifacts for the macOS Exact shell.
//
// @ref LLP 0017#static-bundling-and-the-native-shell — route registry unlocks
// the static native-artifact export without server-rendering the Contract view.

import { defineRouteModule, defineRouteModules } from '@exact/router/types';

export const appRouteModules = defineRouteModules({
  'app/index.tsx': defineRouteModule({}, { screen: { title: 'Snapback admin' } }),
});
