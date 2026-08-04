# EAS Phase 0: Workers for Platforms enablement needed on the Cloudflare account

**Status:** RESOLVED 2026-08-03 — WfP access enabled and live namespace API proven

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

---

**Author decision (Charlie, 2026-08-01, verbatim):** "Expo-org
Cloudflare account from day one. We're focusing on EAS hosting for
this, not general cloudflare hosting on cloudflare free plans, though
maybe we can think about that later."

Consequences: this ticket's resolution path is Expo-org account
provisioning (org account + WfP purchase + fleet credential custody in
the established APIKeys/agent-local-secrets pattern), not enablement on
the personal account. The general-Cloudflare free-plan hosting posture
is explicitly deferred as a maybe-later, which also descopes free-plan
pricing facts from Phase-0 gates. Phase 0's live WfP spikes (P0.1
namespace run, P0.2, P0.3) remain blocked on the org account existing;
the workerd-emulated P0.1 half stays runnable meanwhile.

---

## Resolution — 2026-08-03

Charlie purchased the Workers for Platforms add-on and the read-only namespace
probe succeeded. The entitlement evidence is retained at
`demos/eas-phase0/receipts/p0-access-wfp-enabled.json`.

P0.1 then ran against the dedicated disposable namespace
`eas-p0-spike-20260803`. The retained receipt is
`demos/eas-phase0/receipts/p0.1-wfp-dispatch-namespace.json`; it records eight
user Workers (two apps × two releases × handler/action), the exact requested
`HOST`-only multipart binding metadata and authoritative bindings-endpoint
read-back, 21 passing adversarial checks, two failing native-limit checks, and
successful cleanup. A separate read-only post-run check confirmed the namespace
and all three ordinary disposable Workers return HTTP 404.

This closes the entitlement/access gap only. P0.1 does **not** pass: the account
accepted documented dynamic-dispatch limits `{ cpuMs: 20, subRequests: 5 }`,
but a 20-million-iteration CPU probe and twelve allowlisted external
subrequests both completed successfully. That blocker continues in
`issues/20260803-eas-phase0-wfp-custom-limits-not-enforced.md`. Rapid
Workers.dev activation also returned intermittent Cloudflare 404 pages under
concurrent probes; P0.2 owns that follow-up in
`issues/20260803-eas-phase0-workers-dev-activation-instability.md`.

Production Expo-org account and credential custody remain a Gate-0 concern;
this resolution makes no production-custody claim.
