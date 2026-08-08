# Client pages drifted behind main's last four days: headless inventory, react-expo 0.1.11 framing, lifecycle seam, outbox fields

**Opened:** 2026-08-08 · **Severity:** P2 (documentation staleness)

Main grew significant client surface after the client pages' 2026-08-03/07
review stamps; the two pages that make explicit completeness or
current-boundary claims are now wrong in exactly the ways those claims were
designed to prevent. One re-review pass against HEAD should close all of it.

1. **headless.md:451-478 "Complete public method inventory" is missing ten
   public methods** (its own inclusion rule: non-`__` methods) that landed
   2026-08-04..06 (commits 2ca5e7f7c, 1b4d104bc, 6ec40820d — all after
   reviewed-commit c442237de): `quarantinedMutations` (:6259),
   `reenterQuarantinedMutations` (:6288), `strandedMutations` (:6334),
   `discardStrandedMutations` (:6374), `reRecordStrandedMutation` (:6400),
   `registerQuery` (:4869), `evaluateLocalResultTransform` (:4877),
   `releaseQueryRegistration` (:4881), `storePolicyInspection` (:4816),
   `createOptimisticMutationView` (:4914) — all packages/snapback-client/index.mjs.
2. **react-expo.md:650-656 falsely claims "the provider currently has no
   app-lifecycle seam of its own"**: the React provider exposes
   `pause()`/`resume()` (packages/snapback-react/index.mjs:2478-2479,
   registry semantics :2336-2343, landed 2026-08-05 in 2b5da1ff6) and the
   Expo shell drives them from AppState
   (packages/snapback-expo/provider.mjs:305-384). react.md never documents
   the seam either, while framework-bindings.md:46-47 already references it.
3. **react-expo.md is framed around "the live 0.1.11 vector"** (:40, :47-53,
   :166-180, :191-202, :303-310), saying the EAS config-plugin root and adb
   `host-16` repairs "await a successor package" — successors 0.1.12–0.1.15
   shipped (0.1.12 npm latest 2026-08-07; 0.1.15 the current measured
   vector), and both repairs are in source
   (packages/snapback-expo/package.json:33-38;
   packages/snapback-cli/expo-dev.mjs:677). Re-verify which boundaries still
   hold and rewrite the callouts/install pins.
4. **react.md:470-472 documents `useSnapbackOutbox()` as five fields**;
   the projection carries seven — add `stranded`, `quarantined`,
   `resultGone` (packages/snapback-client/index.mjs:6212-6253,
   packages/snapback-react/index.mjs:3345-3352, :3389) and link the
   offline page's stranded/quarantine coverage.

(The freshness `'snapshot'` doc+types gap is split out as
issues/20260808-react-freshness-snapshot-missing-from-types.md because it
includes a published-types fix.)

Found by the 2026-08-08 comprehensive docs review (clients slice).

## Resolution

Fixed 2026-08-08 (docs-review execution, 1284ae8a5). All four items:
headless.md's inventory gained the ten missing methods and its
completeness claim was re-derived programmatically (94 public members
enumerated; missing-from-table now empty); react-expo.md was reframed
version-agnostically as closure-version boundaries (re-verified against
the published npm tarballs, not just source) and its false "no
app-lifecycle seam" claim replaced with the documented
`provider.pause()`/`resume()` seam (react.md documents it too);
`useSnapbackOutbox` is completed to all returned fields with
offline-page links.
