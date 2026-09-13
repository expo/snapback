# A1 Expo sweep: hosted mobile availability GAP — no hosted sessions/native-auth path exists for an Expo app on 0.1.7

**Opened:** 2026-08-01
**Systems:** Auth, Deployment, React/Expo
**Related:** LLP 0137 (Track B A1 Expo iOS arm), LLP 0045, LLP 0072, LLP 0129, demos/improvement-sweep/arms/a1-snapback-expo-ios/findings/0137-a1expo-f5-hosted-mobile-availability-gap.json

guide/auth/native-apps.md: the Cloudflare arm exposes no sessions routes, the
capture mailbox and `auth.mintSession` are non-production, and
clients/react-expo.md is local-target-only. A mobile Snapback app therefore
has no hosted story at all on the public 0.1.7 closure. Recorded per the
frozen Track B rule as an explicit GAP (the arm used the supported local
bridge from the simulator; `receipt.hostedAvailability` references this
finding). Firebase's hosted-by-default mobile SDKs are the reference bar.

Fix shape: hosted sessions routes + a production delivery/broker path
reachable from mobile clients (existing LLP 0045/0072/0129 lines), then a
hosted leg for the Expo receipt.

Witness: an Expo simulator app signs in through a documented hosted path and
passes the EXPO-04 realtime check against a hosted target.

**2026-08-01 (EAS Phase 0 cross-reference):** LLP 0105's Phase 0 was
authorized today; its P0.5 spike (hosted auth and product security)
depends on exactly this ticket's fix shape — hosted sessions routes +
a production challenge-delivery path. The Phase-0 §Status ledger in
LLP 0105 names this dependency; receipts under
`demos/eas-phase0/receipts/`. Fixing this ticket is the substrate
critical path for the EAS-hosted lane, not just the mobile story.

## Triage (2026-08-26 leftover sweep)

Still open. `guide/auth/native-apps.md` and `guide/clients/react-expo.md` remain `targets: [local]` (reviewed 2026-08-25). The 0.1.7 pin in the title is a filing snapshot; the hosted Expo sessions/native-auth path is still missing on current published closures.

