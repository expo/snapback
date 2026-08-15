# Diary 0083: Clique 0.1.21 Snapback Explicit exploratory lane

**Date:** 2026-08-14

**Run:** Clique 0.1.21 exploratory sweep on the Durand M4 Pro Mac mini

**Raw lane artifacts:** `/Users/ccheever/clique-0121-20260814/lanes/sol-snapback-explicit/`

**Lane:** `sol-snapback-explicit`

**Model:** GPT-5.6 Sol, high effort

**Backend:** Snapback Explicit 0.1.21

This diary is N=1 exploratory calibration evidence. It is not scored, claim-eligible, or a promotion/default decision.

## M1 — accounts and profiles

Built password signup/signin, server-derived user identity, unique handles and emails, own/other profile views, profile editing, live cross-client profile updates, persistent sessions, and durable logout. The frozen presentational kit remains the source of forms and test IDs. Web custody is transactional IndexedDB; iOS and Android custody is serialized through the canonical coordinator and persisted in SecureStore.

The explicit schema and exact generated function references were pleasant once their shape was understood. The served Guide's auth, principal, relational-query, React, and acceptance pages saved substantial time. The frozen choreography was especially useful because it exposed session lifecycle behavior that a data-only suite would have missed.

The most resistance came from the client authority seam. The scaffold's supervised Expo client held an external bearer and could not perform password signin/logout. A custom `adoptAuthority` retained supervised binding admission but instantiated an app-owned `AuthCoordinator` client. Two 0.1.21 package edges then surfaced: generated explicit descriptors include `authoringProfile`, while the Expo admission validator rejects that extra key; and a recently completed authority transition could still leave logout seeing `SNAPBACK_CLIENT_AUTHORITY_CLEARING`. The workarounds were a narrow descriptor projection at the Expo admission seam and a bounded logout retry while the coordinator finished its prior barrier. Auth-driven query consumers also needed an intentional remount after signin/logout.

Tooling friction was smaller but real: Metro retained the scaffold entry until the supervised process was restarted, the first harness command omitted persona password variables, and the in-app browser capability was unavailable, so diagnostics used the frozen Playwright dependency. No second backend or tiny-data doorway was introduced. M1 finished green in 1,871 seconds with acceptance 7/7 and choreography 3/3, and the iOS export is verified Hermes bytecode version 98.

## M2 — posts and follow graph

Built text, one-to-four-image, and single-video composition; attachment picking, previews, and removal; Following and Global feeds; live follows, likes, reposts, and reply counts; attributed repost events; threads; URL linking without previews; incremental feed rendering; and authored-post lists on profiles. The full starter graph and media fixtures seed idempotently. The final acceptance pass was 22/22 and the browser harness passed all seven implemented required checks. The harness also recorded two non-required skips for image/video live creation because its frozen composer driver is explicitly text-only; there were no required-unimplemented checks.

The explicit mutation/query model remained straightforward, and live table read sets gave useful cross-client behavior without adding a second subscription layer. Exact references made it hard to accidentally call an undeclared function. The full acceptance fixture log was a strong oracle for follow/repost edge cases, self projection, thread isolation, and pagination.

Most friction was integration-shaped. A shared feed row helper originally discarded replies even on the thread surface. React Native Web's `FlatList` retained the initial empty projection even after the Snapback hook exposed 41 ready rows, so the feed moved to a `ScrollView` with an incremental render window. The frozen follow choreography assumes feed tabs remain reachable from a profile; the app shell now provides those tabs there. The profile-name observation also assumes the first contracted profile line is the display name, while the frozen own-profile component puts its Edit action first, so the shell supplies a visible profile heading and keeps all kit IDs intact.

Backend-specific friction recurred at package boundaries. Hot-loading a changed function file regenerated the descriptor identity but did not remint the supervised Expo binding; each final function digest required an exact supervisor restart. Offering authorized leases from the canonical client caused the backend to reject every ordinary non-retainable live query, so that optional protocol offer is omitted. The reduced run stores fixture media as data URLs in Snapback records rather than introducing forbidden external storage; this is honest and portable for the tiny fixtures but is not the media architecture I would choose for large production uploads.

Progress instrumentation in the acceptance entry point paid off after one silent run stalled. A bounded rerun exposed a transient auth timeout, then an M1 diagnostic passed cleanly and subsequent full M2 runs were stable. One consequence is that the preserved M1 receipt is a later equivalent 7/7 rerun rather than the exact file originally present at its boundary. M2 finished green in 1,414 seconds, including the final product-surface regression and a Hermes bytecode version 98 export.

## M3 — core messaging

Built idempotent one-to-one conversations, named/described groups, member add/remove/promote/leave controls, full-history membership, 2,000-character text messages, live delivery, quoted replies with jump-to-original, sent/delivered/read aggregation, and connection-owned typing presence. Chat-list previews react to both new messages and typing. The final acceptance suite passed all seven suite-required assertions. The frozen browser harness passed all three checks it can implement: three-attempt DM delivery, typing visible within two seconds and gone within five, and quoted-reply excerpt/jump. It honestly skipped four non-required checks whose test-ID contract cannot observe sender avatars or semantic receipt state and cannot drive group membership; required-unimplemented remained zero.

Messaging fit the explicit backend model well. Durable messages, memberships, and per-member receipt rows were ordinary transactional tables; the typing signal mapped cleanly to the generated connection-owned ephemeral collection. Declared read and write sets made authority review concrete. Server-derived principals and role checks kept group administration out of client claims, and the group receipt computation snapshots the active member set at send time so later membership changes do not rewrite history.

The sharpest ownership friction was again at the generated client boundary. Memoizing the presence options widened Snapback's unique `skip` sentinel to a generic symbol until the options were constrained from the exact ephemeral reference signature. The browser driver also expects the reply affordance to be a descendant of the contracted bubble node; composing the frozen `MessageBubble` inside a test-ID wrapper preserved the kit while satisfying both the action and rendered-quote paths. One final harness pass was structurally successful but reported non-green because I had omitted its `--suite-status` linkage; the suite-linked retry then hit a transient surface-readiness timeout, and the next unchanged rerun completed green.

The most important product caveat is removed-member history. Snapback correctly rejects subsequent conversation reads and live delivery after removal, but this reduced Expo client does not yet maintain a separate encrypted local transcript cache to keep old history visible after authority is revoked. The acceptance assertion verifies server cutoff, and the frozen choreography cannot drive the scenario. That is a client-storage gap rather than an escape to another backend, and it should be treated as capability incompleteness outside the suite-required/implemented gate rather than silently claimed complete.

M3 finished green in 675 seconds with acceptance 7/7, choreography 3/3 implemented checks, four non-required structural skips, and a Hermes bytecode version 98 export. No M4–M8 work or scale replay was attempted.
