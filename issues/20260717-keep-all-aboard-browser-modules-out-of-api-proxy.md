# Keep All Aboard browser modules out of the API proxy

**Status:** In Progress
**Severity:** P1
**Systems:** All Aboard demo, Contract/Exact, Vite, Acceptance testing, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0030 §Proxy surface; LLP 0058 §Kit ordering
**Marker:** all-aboard, browser, cold-clone, vite, proxy

The All Aboard web entry imported the root module `/snapback-target.ts` while
the committed Vite configuration used the ordinary string proxy key
`/snapback`. Vite treats that key as a prefix, so a clean Linux checkout sent
the module request to the Snapback API as `/-target.ts`. The HTML shell loaded,
but the app entry never evaluated: `window.allAboard` and every rendered board
affordance remained absent. The cold-clone browser lane consequently ran only
1/34 checks successfully.

An existing uncommitted Vite configuration edit narrowed the proxy match and
made local verification pass, but that user-owned edit was intentionally not
staged. The committed checkout therefore needed an independent repair.

**Done when:**

- The web module graph no longer requests a root `/snapback*` source module.
- Target selection still happens before network probing, per LLP 0058.
- Native/static builds retain their build-time target folding.
- A focused source-routing regression and the 34-check browser lane pass.
- The true cold-clone workflow passes from the pushed commit.

## Implemented; remote verification pending

Target-independent URL and client-option selection now lives in
`target-profile.ts`. The browser entry imports a safely named `web-target.ts`
adapter, while the native entry keeps its existing
`snapback-target.ts` wrapper, so Exact's pre-transform static-native collection
continues to receive the folded target constant without changing the Vite
configuration. The startup and built-client regressions refuse any future
direct web-entry import whose root module name would fall under the broad
`/snapback` proxy and execute both target adapters under local and Cloudflare
profiles.

Keep this ticket open until the replacement cold-clone workflow proves the
committed broad-prefix configuration from a clean checkout.
