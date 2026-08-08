# guide-gap: the framework-neutral client seam layer consistently escapes coverage

**Opened:** 2026-08-08 · **Severity:** P2 (documentation)

The 2026-08-08 docs review found a consistent pattern: framework-neutral
twins and utility admissions escape guide coverage because no page owns
"the seam layer". Items (all verified as public exports with zero guide
matches):

1. **The compiled Micro profile** — three published subpath entries
   (`./micro`, `./micro/core`, `./micro/live`;
   packages/snapback-client/package.json:114-124, micro.mjs, LLP 0147) with
   no guide paragraph and no capability-index row. When to pick `./micro`
   vs `./online` vs root is undocumented.
2. **`createCommandClient` / `SnapbackCommandClient`** — the LLP 0180
   command owner works over a bare `SnapbackClient`
   (packages/snapback-client/index.mjs:52, commands.mjs:544-560, 641-643),
   but the guide documents commands only through React
   (`useSnapbackCommand`) or a React provider (`provider.surface(...)`).
   One paragraph on headless.md or surfaces.md's non-React section.
3. **`admitSnapbackId(table, value)`** — the documented-in-source way to
   admit an untyped external id (route param, deep-link token) into a
   generated branded id type (index.mjs:488-493). react.md:315-321 tells
   readers TypeScript "refuses a forged provisional ID" and
   react-expo.md:616-641 walks a deep-link flow delivering exactly such an
   untyped id; neither names the admission helper.
4. **React adapter seams** — `useEphemeralRepublisher`,
   `observeSnapbackPresence` (react.md names the outbox observer twin but
   not this one), `invokeSnapbackMutation`/`invokeSnapbackCommand`
   (packages/snapback-react/index.mjs:2802, 2850, 3324, 3332). One line
   each beside the hooks they twin.
5. **Contract render-first boot** — `createRenderFirstSnapbackContractSurface`,
   `createDeferredContractLinks` (ENG-23736), `mountSnapbackContractHeadless`
   (packages/snapback-contract/index.mjs:95-98, :489); a short "boot order
   variants" note in contract-adapter.md's Boot section.
6. **app-cli library exports** — guide/clients/app-cli.md:247-250 omits
   `startAppFunctionLive` and `loadAppArtifacts`
   (packages/snapback-app-cli/index.mjs:53, 220).

Ask: a one-line-per-seam sweep across headless.md / react.md / surfaces.md /
contract-adapter.md / app-cli.md, plus a Micro-profile row (or GAP row) in
the capability index. Consider giving framework-bindings.md explicit
ownership of "the seam layer" so future twins have a home.

Found by the 2026-08-08 comprehensive docs review (clients slice).
