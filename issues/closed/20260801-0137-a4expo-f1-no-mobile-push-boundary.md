# A4 Expo sweep: no push-notification boundary exists for a mobile Snapback app on 0.1.7

**Opened:** 2026-08-01
**Systems:** Actions, Notifications, React/Expo, Deployment
**Related:** LLP 0137 (Track B A4 Expo iOS arm), LLP 0045, demos/improvement-sweep/arms/a4-snapback-expo-ios/findings/0137-a4expo-f1-no-mobile-push-notification-boundary.json, issues/20260728-guide-gap-assets-and-notifications-capability-rows.md

The EXPO-09 receipt check asks for a push-notification boundary or an
explicit GAP; this is the explicit GAP, pinned mobile-specifically. On the
public 0.1.7 closure there is no device-token registration surface, no
APNs/FCM or expo-notifications integration (or mention) anywhere in the
guide, and the generated capability manifest ships `notifications: false`.
The generic first-class-notifications gap is already owned (capability index
`backend.notifications`, design-only, LLP 0045); the mobile carrier adds two
compounding blockers:

1. even the app-authored bridge — an action posting to a push provider — is
   unauthorable on packaged 0.1.7 (0137-a4-f1; the plain `ctx.fetch` fix at
   `117dcae2` landed on main after the 0.1.7 publication and is not in the
   pinned packages); and
2. with no hosted mobile path (0137-a1expo-f5) there is nowhere a production
   push relay could run.

An event product's "tell my guests" moment therefore has no product lane at
all on mobile. Firebase Cloud Messaging (token registration + delivery +
send APIs as documented core mobile features) is the reference bar.

Fix shape, sequenced behind the owners: the outbound action lane on the
packaged closure first (a4-f1, already fixed on main), then a documented
device-token + provider-relay recipe (expo-notifications or raw APNs/FCM) on
the guide's mobile pages, with LLP 0045's first-class notifications
capability as the eventual product boundary.

Witness: an Expo simulator app registers a push token through a documented
Snapback path and an RSVP change produces one inspectable delivery attempt
at a push-provider boundary (simulator receipts may stub APNs; the boundary
and the ledger are the witnessed facts).

## Resolution (2026-08-01)

RESOLVED as designed-and-owned. The author decided the boundary
(2026-08-01 ballot item 5): push is an INTEGRATION SEAM to Expo's
push service, not a first-class Snapback delivery capability. The
owning design landed as LLP 0143 ("Expo push-notification seam",
Draft): token custody, the ctx.push.send action lane over the
landed egress seam, the handed-to-Expo receipt ledger with the
normative never-claims list, capability id and per-target
availability (hosted stays Missing per the a1expo-f5 gate), the A4
EXPO-09 acceptance fit, and the no-op posture. Implementation and
the review loop proceed under LLP 0143; this ticket's ask — that
the boundary exist as an explicit decision rather than a silent
GAP — is discharged.
