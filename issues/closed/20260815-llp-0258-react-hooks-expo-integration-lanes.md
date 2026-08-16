# LLP 0258 lane claim: React auth hooks (D6) + Expo provider integration (Phases 2-3)

**Status:** Closed (2026-08-15)
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** React, React/Expo, Auth, Client integration
**Date:** 2026-08-15
**Governing:** LLP 0258 D6, Phases 2-3; LLP 0253 S6.1 (auth-hook amendment); LLP 0263 (native probes)

## Coordination claim

Multiple sessions are building LLP 0258 concurrently (owner-key custody
0477fda40, Phase 1 core 450d150e6, codegen policy d42dabce3, RQS admission
fix 218b160f6 all landed same-day by different lanes). This ticket claims
the next two lanes for the orchestration session that landed 0477fda40 /
218b160f6 / LLP 0263, to avoid a third duplicate implementation (the D6
namespace was independently built twice today; one was discarded):

1. **React hooks (D6):** `useSnapbackCurrentPrincipal()` +
   `useSnapbackAuth()` in packages/snapback-react over the landed
   app-client/client.auth surface, plus the LLP 0253 S6.1 Familiar
   re-exports.
2. **Expo provider integration (Phase 2.2/3):** SnapbackExpoProvider
   delegates to createSnapbackAppClient; supervised adoption rewired
   through the coordinator (today supervised-environment.mjs constructs a
   raw external-bearer client); LLP 0181(n) boot-union amendment
   implemented in code.

If another session is already mid-flight on either lane, land first and
note it here — this claim yields to landed code, per the fleet convention.

## Exit

Close when both lanes land (or when superseded by another session's
landing, noted with the SHA).

## Resolution (2026-08-15)

Superseded by landed code per this ticket's own yield rule: `b186296fd`
landed both claimed lanes (useSnapbackCurrentPrincipal/useSnapbackAuth +
Familiar aliases, and the Expo provider first-party bootstrap integration
with supervised precedence) while the claiming session's duplicate React
lane was in review. The claiming session's parallel-lane review findings
were applied to the landed core instead (699b7f907 + 8c79faccd), and a
seeded review of b186296fd's own surface follows the same pattern.
