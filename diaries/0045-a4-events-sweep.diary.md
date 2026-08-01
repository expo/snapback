# Diary 0045: A4 event and invitation application — LLP 0137 improvement sweep, Snapback web arm

**Program:** LLP 0137 Phase 1 (Stage 2, fourth diaried sweep arm)
**Contract:** demos/improvement-sweep/protocol/contracts/a4-event-invitation.v1.json (11 frozen checks)
**Lineage:** 0102 Partiful-shaped application (Diary 0030)
**Posture:** external npm consumer of the public `@expo/snapback-*` 0.1.7 closure; guide + public docs only
**Capsule:** demos/improvement-sweep/arms/a4-snapback-web/run-capsule.json

## 2026-08-01 — Snapback web arm, deep budget, complete

### Environment and outcome

Clean external directory (session scratchpad, outside any checkout), macOS
arm64, node 24.18.0 (volta), bun 1.3.12, public registry install of the
0.1.7 closure (runtime binary byte-identical to the prior arms'
publication), `snapback new event-app --template react`, sessions auth,
server env `SNAPBACK_OUTBOUND_ACTIONS=1` + `SNAPBACK_CRON_DISABLED=1`,
port 4291 with the prior arms' 4288/4289/4290 guard-blocked.

**All 11 frozen checks ran (expectedChecks enforced): 9 pass, 2 fail, 0
GAP, 0 Stop — both fails are platform defects with complete positive
evidence around them, not unbuilt product.** Suite wall 17.7s. Budgets:
~13 min orientation + ~47 min active build, ~120 build-phase tool calls
against the 8h/400 deep ceilings; zero posture breaks; four assistance
events (prior-arm recipes cited to their owning findings, two
packaged-bytes reads and one probe pair, each converted into findings).

The event core carried the Partiful shape end to end: seeded capacity
fixture (12 seats, 6 taken), host/cohost/guest/outsider matrix with
uniform denials, anonymous public preview with an exact field boundary,
attributed deep-link invitation entry, a two-actor capacity race that
booked the room to exactly 12/12, 41–56ms second-client live wall and
count deliveries with ephemeral presence, a real image pipeline
(renditions, strict delivery, deletion, session revocation), a
deterministic scheduled reminder with an idempotent receipted delivery,
and receipted reset-install cleanup. The two fails: **A4-07** (no
non-owner asset viewer is authorizable on 0.1.7 — the a1-f2 attach defect
chain plus newly-found unimplemented pasteable lanes) and **A4-10** (an
outbound notification effect is unauthorable — every action form fails).

### What felt good

- **Capacity contention was one honest mutation.** Recompute seats inside
  the serialized transaction, refuse over capacity — and the two-guest
  final-seats race produced exactly one commit, a deterministic loser,
  and a room booked to exactly 12/12 with an anonymous preview agreeing
  (`spotsLeft: 0`). The frozen Firebase arm needed a transaction-retry
  idiom for this; here it is the naive code being correct.
- **The invitation is atomic.** One authority-creating mutation redeems
  the code, mints the seat, and writes the attributed RSVP row (inviter,
  code, `deep-link` channel); the settlement envelope is the attribution
  receipt. Partiful's core entry flow in ~30 lines.
- **The image pipeline is real now.** In the 0102 epoch Snapback's assets
  were a wholesale GAP. On the packaged closure a strip-declared PNG
  publishes with card/thumb renditions served by key, typed media facts,
  private/no-store strict delivery, stable content digest, deletion
  denying the next request, and — the differentiator — a logged-out
  session's very next read denied 401 (per-request re-authorization,
  no cached-token window like frozen Firebase's up-to-an-hour).
- **The public preview boundary is a projection, not a policy dance.**
  `auth:'public'` + a handler-owned projection served exactly nine public
  fields; byte probes for the address, host notes, codes, and guest names
  all came back clean while members read the full row from the same
  table.
- **The deterministic scheduler seam again.** Cron disabled, suite-driven
  ticks, append-only run receipts in the tick response, and the dedupe
  unique index making idempotency provable across the scheduled, re-tick,
  and manually-invoked lanes without ever sleeping on a cadence.
- **Presence stayed ephemeral** (third consecutive arm): ten publishes,
  both guests visible, durable version advanced by zero.
- The whole loop is fast: 17.7s for the full 11-check suite including two
  reset-installs and the cron real-nominal wait; tsc + vite build green;
  the app's own EventView renders under jsdom and updates live from an
  independent client.

### What felt bad or hard

- **The outbound effect is a wall, not a gap (f1).** The actions guide
  teaches exactly one authoring shape — `js: {source, exportName}` — and
  it cannot ship: codegen refuses *every* export form
  (`BUNDLE_UNSUPPORTED_EXPORT`) while the runtime loader demands the
  export (`SNAPBACK_HANDLER_EXPORT_MISSING`; dev exits before ready). The
  undocumented inline `handler:` form (found in packaged define.mjs)
  refuses a global `fetch` at generation, and `ctx.fetch` — which the
  inline ctx exposes as a function — dies at runtime as
  `SNAPBACK_HANDLER_HOST_CALL_UNKNOWN: host.fetch`. Three lanes, all
  dead, with `SNAPBACK_OUTBOUND_ACTIONS=1` set at both boundaries. The
  0102-epoch repo-source arm passed these very effect legs, so this is a
  packaging-era regression, and it is the sweep's clearest "the guide
  describes a product the package does not contain" moment.
- **`snapback dev` failing silently (f2)** cost the arm its worst
  debugging cycle: exit 1, zero bytes of output, because the dev branch
  returns `result.ok ? 0 : 1` without printing the failed envelope. The
  underlying failure (`SNAPBACK_SEED_VERSION_REUSED` after editing seed
  bytes) has a perfectly good diagnostic — `snapback generate` prints it;
  dev eats it. I recovered it only by importing `runDev` and reading the
  return value.
- **The pasteable asset lanes are vocabulary, not routes (f3).** The
  assets guide documents `private-signed` issuance and `public-immutable`
  serving as shipped; the packaged runtime 404s both routes and its
  binary contains only the two kind names. Combined with a1-f2 (typed
  attach broken → via-references and membership sharing unreachable),
  there is literally no way to show an uploaded flyer to a guest on
  0.1.7. Uploading, rendering, and strictly delivering an image to its
  owner all work beautifully — and then the product dead-ends one step
  from the point of an event flyer.
- **The everyMs catch-up run lies about time (f4).** The first
  deterministic tick ran the job at nominal slot 0 with
  `ctx.runtime.now() === 0`, so my due-scan silently no-opped while the
  run ledger said Succeeded. The guide warns the first tick "can look
  early" but not that its trusted clock is 1970. I switched the schedule
  to a 1s everyMs scan and asserted the epoch receipt as finding
  evidence; a calendar cron expression avoids it at the cost of waiting
  out a minute boundary in tests.
- **Auth codes don't survive the action boundary (f5).** An outsider
  driving the reminder action and a guest driving the notification action
  are both refused — as `SNAPBACK_HANDLER_FAILED`. The platform's own
  `SNAPBACK_AUTH_PERMISSION_DENIED` is collapsed one hop into the action
  lane, worse than a3-f3's app-error collapse.
- **Anonymous reads are still unpaved (f6), verbatim from the 0102
  epoch.** Diary 0030's Snapback arm wrote "the arm needed a raw HTTP
  helper carrying the protocol offer without caller auth" — this arm
  wrote the same helper, because the packaged client still refuses to be
  anonymous outside a browser while the server happily serves the
  offer-only request.
- **Config shapes still undocumented (f7), also verbatim from 0030.** The
  custody behavior is excellent (status never leaks bytes; set/unset
  receipted with generations) but `{entry, value}` had to be probed out
  of 422s, one of which is a raw serde message rather than a Snapback
  diagnostic.
- Papercuts: `Date.now()` refused in handlers with an excellent
  steering diagnostic (good fail-closed moment — `ctx.runtime.now()`
  everywhere); the seed-version ledger burns a version on any byte edit
  (right behavior, brutal combined with f2's silence);
  `snapback dev --help` silently exits 1; the packaged `authLogout`
  demands AuthCoordinator custody an external-bearer client lacks, so
  server-side logout went over raw `POST /auth/logout`; membership
  removal is `removeSelf(resourceId)` — my `.remove({...})` guess died as
  an opaque `SNAPBACK_HANDLER_HOST_CALL_INVALID`; one transient empty
  frame on a single-record live handle mid-update (consistent with the
  conservative quarantine-then-snapshot behavior Diary 0030 recorded;
  handled with a defensive predicate).

### Longitudinal comparison vs the frozen 0102 Snapback arm (Diary 0030)

- **Improved:** authenticated assets went from wholesale GAP to a real
  upload/rendition/strict-delivery/deletion/revocation lifecycle (owner
  lane); the install story is now a clean public npm closure (0102's
  final confirmation ran repo-source); the dev lifecycle (ready file +
  events + stdin stop) makes suites self-contained; capacity, roles,
  attribution, and live delivery held at least as strong.
- **Repeated unchanged:** anonymous public reads unpaved (0030 filed it;
  f6 re-files against the package); config request shapes undocumented
  (f7); capacity loser surfacing generic `SNAPBACK_HANDLER_FAILED`
  (a3-f3, cited); notification machinery still application-authored
  (intent/attempt ledger).
- **Regressed:** the outbound effect lane itself — 0102's arm proved
  failure/ambiguity/retry against a fake provider because its actions
  could fetch; the packaged closure cannot author a fetching action at
  all (f1).

### Would I choose it?

For this app, today, on the public package: **no** — and for a sharper
reason than the 0102 arm's "conditional." An event product is invitations
plus a flyer plus "tell my guests": the flyer cannot be shown to guests
(a1-f2 + f3) and the notification cannot be sent (f1). Everything around
those two holes — capacity integrity, attributed entry, the preview
boundary, live wall/counts/presence, scheduled reminders, receipted
cleanup — is not just competitive but often the best version of the fact
I have seen across the sweep, which makes the two packaging-era walls the
whole verdict. Close f1 and the asset-sharing chain and this becomes the
arm I would most confidently ship.

### Lessons for Snapback

1. One shippable, documented, conformance-tested action form with egress
   is table stakes; the guide currently teaches only a broken shape.
2. `snapback dev` must never exit silently — print the envelope it
   already has.
3. Ship or explicitly nonclaim the pasteable asset lanes; the guide
   overclaims either way today.
4. Give the everyMs catch-up run a truthful trusted clock (or skip it).
5. Preserve platform auth codes through the action boundary.
6. Pave the anonymous public-read client and the config shapes — both are
   second-epoch repeats now.
7. Protect while fixing: serialized capacity correctness, atomic
   attributed invitation entry, per-request asset re-authorization,
   the exact public-projection boundary, zero-amplification presence,
   the deterministic scheduler seam, and the 17.7s full-suite loop.

## 2026-08-01 — Track B: the same contract on Expo iOS (snapback-expo arm)

**Arm:** snapback-expo, expo-ios, external consumer, public 0.1.7 closure
**Capsule/receipt:** `demos/improvement-sweep/arms/a4-snapback-expo-ios/`
**Result:** 8 pass / 3 GAP / 1 fail / 0 Stop, expectedChecks=12 enforced
(EXPO manifest, a4 applicability); android = honest not-run (JDK absence
re-verified live; the a1-expo disposition cited). Simulator receipt;
physical-device remains a separately reported production gate, not-run.

### Setup and the G3 pin

Same pin as the a1-expo arm (cited): frozen neutral-expo shell versions
(Expo SDK 57.0.9 / RN 0.86.2 / React 19.2.3), the guide's documented RN
path (Online surface, local target only), native **release** simulator
build. Clean external directory; backend (schema/functions/seed) adopted
verbatim from this diary's web arm — Track B's job is the carrier. This
time the carrier tax was mostly prepaid: the a1-expo arm's crypto
polyfill (f1), harness, session-custody module, and driver skeleton
transplanted directly, so the arm needed **one** native build and reached
a green 12-check receipt ~27 minutes after `npm install`, with the
110-second suite driving launch, on-device auth, an OS deep link, live
deliveries, offline windows, an on-device flyer upload, rotation, and
receipted cleanup.

### What felt good

- **The invitation deep link is real on this carrier.** `simctl openurl`
  delivered `sweepshell://invite?code=INV-HOST-2214` into the running
  release app; ~40 lines of consumer code (a `Linking` listener + the
  same `redeemInvite` mutation the web arm used) turned it into an
  attributed seat — one settlement carrying `{role, inviteCode,
  invitedByName, enteredVia:'deep-link'}`, the invite consumed, replay
  refused, roster attribution independently verified. Partiful's core
  entry flow, on a phone, atomically.
- **Live event facts hit the phone in ≤122ms.** Gil's wall post and his
  recomputed seat count (6/12 → 7/12) both rendered on-device ≤122ms
  after settlement, author attributed to the server principal. Heavier
  queries than A1's (the guestEventView recomputes seats server-side) and
  still an order of magnitude inside interactive tolerance.
- **The image pipeline works from the phone.** On-device raw TUS upload
  (expo/fetch + an on-device sha256 checksum via the f1 polyfill),
  async card/thumb renditions polled ready, strict no-store delivery read
  back on-device, and — the satisfying part — the RN `Image` component
  rendering the flyer straight off the per-request-authorized byte lane
  with bearer headers. The served canonical digest is byte-identical to
  the web arm's for the same fixture: cross-carrier content identity.
- **The connection axis behaved this time (f7 narrowing).** No indefinite
  ~2s cycling: one spontaneous early cycle, then a 16-second stable
  `live` hold with rows intact. This arm has no retainable public query —
  exactly the component a1-f7 suspected. Narrowing note appended to the
  ticket.
- **Cleanup composes across resource kinds from a mobile harness:** asset
  delete (200 → 404), membership self-removal, receipted reset-install
  restoring the literal 6/12 fixture, simulator shutdown — all inside the
  110s loop, all receipted.

### What felt bad or hard

- **The deep link died in silence first (new guide-gap, a4expo-f2).** The
  first receipt run timed out with zero diagnostics: iOS raises a
  one-time 'Open in "<app>"?' dialog for a custom scheme's first open,
  no headless simctl surface can tap it, and nothing in the guide's
  mobile acceptance recipe mentions the dialog or the workaround (the
  simulator's `schemeapproval` plist, written while the device is shut
  down). A screenshot was the only debugger. The Track B receipt
  *requires* a deep-link leg; the sanctioned recipe cannot drive one.
- **"Tell my guests" still has no lane, and on mobile it is doubly dead
  (new finding, a4expo-f1).** The web arm's headline (a4-f1: outbound
  effects unauthorable) still holds on the pinned 0.1.7 packages — the
  `ctx.fetch` fix (117dcae2) landed on main *after* the publication — and
  the mobile carrier stacks two more walls on top: no push-notification
  boundary anywhere (capability manifest `notifications:false`, no
  device-token/APNs/expo-notifications story in closure or guide) and no
  hosted path a production relay could run behind (a1expo-f5). The
  notifyIntents ledger this backend carries is scaffolding around a
  boundary that does not exist.
- **The flyer still cannot be shown to a guest (re-verified, cited).**
  Typed attach refuses `SNAPBACK_ASSET_REF_UNVERIFIED` from the device
  exactly as from node (a1-f2), the seated guest's strict read is 403,
  and the pasteable lanes remain unimplemented (a4-f3) — so the arm's
  beautiful on-device flyer render is owner-only theater. Same one-step-
  from-the-point dead-end the web arm recorded, now with a phone in hand.
- **Rotation still wedges the client (f4 re-verified).** Downgrade
  rotation to the seatless outsider: custody completes but rejects with
  the lifecycle-failures AggregateError, the denial never reaches the
  hook, and rotate-back never re-subscribes — connection `disconnected`,
  queries presenting `ready`/0 rows until process death. On this arm the
  wedge shape was `ready`-with-zero-rows, which is *blanked data labeled
  ready* — arguably worse than A1's `live`-labeled variant.
- **The offline queue still cannot engage (f2 re-verified)** — the
  documented opt-in surfaced the raw Expo fetch `Error` and queued
  nothing; no ghost settlement, at least, and the online refusal path
  stayed structured.
- Papercuts: the invite-replay refusal surfaces as generic
  `SNAPBACK_HANDLER_FAILED` (the a3-f3 collapse, again); renditions are
  generated asynchronously and 404 until ready with no availability hint
  on the byte lane (the web arm's poll idiom was the fix); typed-array
  generics under TypeScript 6 needed two `BufferSource`/`BodyInit` casts
  around WebCrypto and expo/fetch.

### Longitudinal vs the web A4 arm (same day, same backend)

- **Carried over intact:** the seeded capacity fixture, role matrix,
  anonymous projection boundary (address absent byte-wise from the
  preview while the member view renders it), attributed atomic invitation
  entry, live wall/count delivery, strict asset delivery with stable
  canonical digest, receipted cleanup.
- **Better here:** the deep link is an OS-level product fact, not a URL
  parse; the flyer renders in a native Image through the authorized lane.
- **Worse here:** everything the a1-expo arm already charged to the
  carrier — no durable store (f3), no engageable queue (f2), the
  rotation wedge (f4) — plus the push GAP being mobile-fatal for this
  contract's notification story.

### Would I choose it (for this app, on mobile, today)?

**No — same verdict as the web arm, with the second hole now
load-bearing.** An event product on a phone is invitations (works,
beautifully), a flyer (renders for its owner only — a1-f2/a4-f3), and
"tell my guests" (no effect lane on 0.1.7, no push boundary at all,
nothing hosted to relay through). The first of those three is the best
mobile invitation flow I have tested; the other two are walls. Close the
asset-sharing chain and the a4-f1-family egress hole (already fixed on
main), ship the durable-store arm and the rotation fix, and this carrier
becomes genuinely shippable for this contract — the data core (sessions
custody, membership, settlement envelopes, ≤122ms push, uniform denials)
already is.

### Lessons for Snapback (mobile edition)

1. The guide's mobile acceptance recipe needs a deep-link leg, including
   the iOS scheme-confirmation dialog and the headless pre-approval
   recipe (a4expo-f2).
2. A push-notification boundary — even just documented device-token +
   provider-relay scaffolding — is table stakes for any invitation-shaped
   mobile product (a4expo-f1); sequence it behind the outbound-action fix
   that already exists on main.
3. The asset byte lane could state rendition availability instead of a
   bare 404 while variants generate.
4. Protect while fixing: the atomic deep-link redemption settlement, the
   ≤122ms second-device push, cross-carrier canonical content identity,
   the uniform denial surface, and the 110-second full-receipt loop.

## 2026-08-01 — RE-VERIFICATION against 0.1.8 (fix-loop entry, not a rerun)

Packages: all @expo/snapback-* at 0.1.8 (fast-path publication from
main 5d5c6b71; ledger fastpath-ledger-0.1.8-5d5c6b7183af).
Evidence: demos/improvement-sweep/arms/reverify-0.1.8/ (capsule +
evidence + drivers).

All four A4 web fixes verified from external-consumer posture (this
arm's retained app + probe actions, local egress fixture,
SNAPBACK_OUTBOUND_ACTIONS=1):

- **a4-f1 (outbound actions unauthorable): VERIFIED, both forms.**
  Inline `ctx.fetch({url})` and a module-form action (closed-script
  `globalThis.__snapbackHandlers` registration — the refusal now names
  that recipe) both executed against the fixture, status 200
  (RV-A4-F1-INLINE, RV-A4-F1-MODULE).
- **a4-f2 (dev swallows failure envelopes): VERIFIED** — a
  reused-seedVersion dev start exited 1 WITH the structured
  `SNAPBACK_SEED_VERSION_REUSED` envelope printed (RV-A4-F2).
- **a4-f4 (epoch-0 catch-up): VERIFIED** — the first everyMs tick ran at
  the most recent slot, 253ms behind wall clock (RV-A4-F4).
- **a4-f5 (collapsed auth refusals): VERIFIED** — an outsider driving
  `runReminder` received `SNAPBACK_AUTH_PERMISSION_DENIED` through
  the action boundary (RV-A4-F5).

The web arm's "no" verdict rested on a1-f2/f3 (flyer) + f1 (notify);
with f1 fixed and verified, the remaining holes are the asset sharing
chain tickets.
