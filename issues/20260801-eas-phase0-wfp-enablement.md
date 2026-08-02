# EAS Phase 0: Workers for Platforms enablement needed on the Cloudflare account

**Status:** OPEN — access gap, blocks the WfP-bound half of LLP 0105 Phase 0

Probe receipt: `demos/eas-phase0/receipts/p0-access-wfp.json` (2026-08-01).
The account (`ccheever@expo.io account`, type standard) lacks the
Workers for Platforms add-on: dispatch-namespace API returns error
10121 (purchase-gated). Blocked spikes: P0.1's real dispatch-namespace
run (the workerd-emulated half proceeds separately), P0.2 ingress/WS
routing, and the WfP items of Gate 0.

Enablement recipe (interactive; needs the account owner):
1. Purchase Workers for Platforms in the dashboard
   (`dash.cloudflare.com → Workers for Platforms`, $25/mo per the dated
   pricing facts) — or, if the real EAS integration will run under an
   Expo-owned Cloudflare org instead of this proof account, record THAT
   account's entitlement and credentials custody first (the eas-hosting
   repo's provisioning owns production custody per LLP 0105 §Work
   ownership).
2. Re-run the probe: the namespaces list endpoint must return success.
3. Then execute P0.1 against a dedicated disposable namespace
   (`eas-p0-spike-<date>`), record the multipart binding metadata
   receipt 0105 P0.1 requires, and run the LLP 0009/0047 adversarial
   suites with two apps × two releases.

Until then, P0.1 proceeds in its emulated posture (workerd twin) with
the honest evidence-confidence downgrade per LLP 0102's amendment rule.
