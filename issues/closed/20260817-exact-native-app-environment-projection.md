# Exact: native shared-host module pipeline has no app-environment projection

**Opened:** 2026-08-17
**Source:** Coterie M1 provider freeze (Diary 0086); LLP 0279 item 12

## Gap

Web provider selection was a small Vite `envPrefix` change, but the native
shared-host module pipeline has no documented app-environment projection, so
Coterie's native entry hard-codes a build-time `memory` constant rather than
pretending an ambient environment variable exists on device. Any boot-time
configuration (provider selection, endpoints) has the same gap on native.

## Ask

Provide a documented build-time app-environment projection for the native
module pipeline (the moral equivalent of `envPrefix`), so web and native
entries can configure from the same declared environment surface.
Acceptance: Coterie's hard-coded native constant becomes an environment
read matching its web entry. External (Exact repo) fix; graduate to Linear
(Exact project) when picked up.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-native-app-environment-projection.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.
