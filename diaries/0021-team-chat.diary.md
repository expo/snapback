# 0021 — team-chat: the Step 6 chat pressure kernel

## 2026-07-26 — local admission checkpoint

The existing `chat-matrix` is broad evidence for client surfaces, provider
loops, and streamed AI replies, but it is not the Slack/Discord product named
by LLP 0063. Treating it as `STEP6.CHAT` would hide every pressure that matters:
protected rooms, membership churn, unread state, channel history, search,
attachments, notifications, and moderation.

I started a separate `team-chat` product kernel and froze its honest boundary
in `demos/team-chat/pressure-profile.v1.json`. The first slice exercises room
bootstrap, invitation/accept/leave, bounded recipient fan-out, unread state,
and recipient-owned keyset pagination on the local SQLite/Ibex target. It
deliberately cannot promote the roadmap claim.

### What felt good

- LLP 0056's atomic membership bootstrap is exactly the right primitive for
  room creation: the room cannot exist without its owner seat.
- Keeping the private `roomMembers` table separate from displayable
  `roomParticipants` makes the authority boundary reviewable. The handler may
  enumerate participants for fan-out, but every protected read and write still
  consults the host-owned membership declaration.
- The generated owner-keyset helper gives each recipient an opaque, authority-
  bound inbox cursor without authoring cursor cryptography or accepting a raw
  row boundary from the client.
- Trusted `ctx.runtime.now()` and `ctx.runtime.id()` keep message timestamps and
  continuation keys out of public mutation arguments.

### What remains awkward or missing

- The current private-roster surface is excellent for self-service transitions,
  but an owner cannot remove another member without an application-reachable
  private membership row id. The local app therefore proves self-leave, not a
  moderator kick. This is a real product gap, not something to work around by
  treating the display roster as authority.
- The safe generated keyset helper is owner-scoped. It pages a recipient inbox,
  not one room's history. A room-scoped, membership-gated opaque continuation
  remains open.
- Fan-out is intentionally bounded to 64 active recipients and the acceptance
  cohort is 32. Room history is capped at 256 messages so the atomic read/leave
  path can always settle within its declared application bound. Those are
  useful single-process pressure witnesses, not scale or horizontal-realtime
  claims.
- Search and moderation are blocked on Draft LLPs 0073 and 0071. Local string
  filtering or ad hoc flags would be implementation theater, so they remain
  visibly red.
- The headless kernel is not a complete product. React/Contract UI, attachments,
  notification delivery, sessions-mode hosted auth, and the full control-plane
  drill are still absent.

Compared with React plus Convex or Supabase, the pleasant part is that
membership invalidation and cursor authority are platform contracts rather
than app conventions. The cost is the narrowness of those contracts: once the
product needs host-initiated removal or room-scoped history cursors, there is
no honest escape hatch yet.

## 2026-07-26 — local React product surface

The second slice puts the admitted kernel behind a small React product surface.
Three independent browser windows act as the owner, invited member, and
unrelated outsider. The acceptance path creates a room, accepts an invitation,
exchanges messages, clears unread state, leaves, re-invites, and proves that
old inbox rows do not reappear after rejoining.

### What felt good

- The official React external-store adapter made live queries compose like
  ordinary hooks. Room membership, messages, and unread state updated without
  app-authored polling or cache reconciliation.
- Generated API references kept the forms aligned with the admitted function
  arguments. The browser witness could concentrate on authority transitions
  instead of reconstructing request names and shapes.
- Revocation was visible at the product boundary: self-leave closed the room
  view, and re-invitation restored access with an empty recipient inbox.

### What remains awkward or missing

- A standalone Vite package cannot install Snapback's source packages through
  their `workspace:*` development dependencies. This repository-local surface
  therefore imports both official packages from their workspace source paths.
  Published-package consumer installation still needs a separate hosted-app
  witness.
- The persona switcher is useful local acceptance scaffolding, not sessions
  authentication. A hosted surface must replace it with the auth work governed
  by LLP 0072.
- The React surface does not make the product complete. Contract, search,
  attachments, notifications, moderation/audit, host removal, room-history
  pagination, and hosted operations remain red in the pressure profile.

Relative to React plus Convex, the view code is similarly compact once the
generated API and provider exist. Snapback's advantage is that leave-time
revocation and recipient cursor authority are tested platform behavior; the
tradeoff is that the local package boundary is still less polished than a
normal registry-installed frontend dependency.

## 2026-07-26 — local Contract product surface

The third slice renders the same admitted kernel through compiled Contract.
Its three-window browser witness repeats the owner/member/outsider authority
path with polling fallback disabled: create and open a room, invite and
self-accept, exchange live messages, clear recipient-owned unread state,
self-leave, re-invite, and prove that the outsider remains empty.

### What felt good

- Generated Contract query and mutation links let the view name the same
  operations as the React surface without rebuilding an app-local provider.
  Explicit mutation result branches also kept denied actions visible instead
  of swallowing them.
- Boot-scoped route identity was a clean fit for the published adapter. A room
  URL freezes `roomId`, binds exactly `roomDetails`, `roomMessages`, and
  `unreadDeliveries`, and remounts on navigation. No dynamic query args or
  retained-scope behavior are implied.
- Revocation was especially legible in Contract. After self-leave, the live
  protected query became empty and the room rendered its locked state before
  the user navigated back to the `left` membership card.
- The same eight product checks passed in real Chrome through compiled actions,
  including post-rejoin delivery and an empty unrelated-authority window.

### What remains awkward or missing

- Exact 0.1.6 exposes internal TypeScript sources at the consumer package
  boundary. A normal strict app typecheck therefore walks optional peers and
  unrelated package implementation files. This surface uses a narrow typed
  runtime facade so its typecheck covers authored consumer code while Bun
  still executes the published packages in development and production builds.
- `@ccheever/exact-facet-contract` is not in the published registry closure.
  The surface consequently uses raw Contract layout/style primitives rather
  than pretending to prove a published Facet authoring path.
- Navigation from an async mutation continuation was not a dependable product
  transition in this slice. Acceptance is stronger and clearer when accept
  first becomes a live `member` card and leave first becomes a locked room;
  the user then performs an explicit navigation action.
- The production bundle is about 545 KB minified / 149 KB gzip before any
  application-specific optimization. This is a local pressure witness, not a
  new bundle-budget receipt or evidence that the remaining Step 4 Contract
  architecture problem is solved.
- Search, attachments, notifications, moderation/audit, host removal,
  room-history continuation, real sessions auth, deployment, and operational
  drills are still absent. The pressure ledger stays red and claim-ineligible.

Compared with React plus Convex or Supabase, Contract removes more component
runtime plumbing and makes observable action/state contracts explicit. The
tradeoff is a rougher published-package boundary and less forgiving control
flow around asynchronous actions. The local kernel is convincing; the hosted
and package-consumer story still needs its own evidence.

## 2026-07-26 — semantic-gap proposal

The next pass did not patch either remaining Team Chat authoring gap into the
application. Reading LLP 0053, LLP 0056, LLP 0065, and the guide confirmed that
both boundaries are deliberate: private membership rows expose no other-
principal id, and the generated keyset helper authorizes only owner-partitioned
rows.

Draft LLP 0100 now proposes the narrow platform extensions. Principal-addressed
removal is opt-in and non-oracular: only a total other-principal remove policy
can generate the command, target lookup stays host-private, and present/absent
success returns the same `null`. Membership-scoped pages execute the membership
predicate per page and bind the opaque continuation to the room arguments,
authority epoch, exact plan/index/order, activation/target, and instance
keyring.

This is useful progress but not product evidence. No Team Chat source or
generated artifact uses the proposal; both pressure-profile rows remain partial
and the two filesystem issues stay open pending independent review,
ratification, implementation, and product receipts.

## 2026-08-01 — LLP 0100 product adoption

Team Chat now uses both accepted LLP 0100 surfaces. `roomMembers` explicitly
opts into total owner removal of another principal, and the product mutation
uses `removePrincipal` without exposing the private membership row. Room
history is a generated membership-scoped keyset pair over
`by_room_page_key`, with a ten-row page bound. The headless, React, and
Contract receipts each traverse three pages, reject cross-user/cross-room and
post-removal cursors, and prove that owner removal drops the room, seat,
retained history, send authority, and later delivery at the same product cut.

### What felt good

- The removal command is the right product primitive: the app supplies the
  public principal it already knows, while private-row lookup, non-oracular
  absence, provenance, and authorization invalidation remain host-owned.
- The page helper made the safe path shorter than an app-authored cursor. Its
  generated query references work unchanged in headless and React, and the
  refusal code stays identical across cross-user, cross-room, and stale-seat
  probes.
- `_snapback.myMemberships` is a crisp product receipt for the authority cut.
  It let every surface assert the seat loss alongside visible room/history
  loss instead of inferring revocation from one query alone.

### Friction and surprises

- The current React provider carried a prepared local-dev identity into live
  reads but not mutations. The UI therefore looked correctly scoped while
  every authenticated form write failed. Adoption fixed the provider so the
  admitted dev identity binds reads and writes consistently, and the browser
  receipt now guards that path.
- The headless client documented `_snapback.myMemberships` as a supported
  system query but its function-name admission allowed only asset records.
  The receipt exposed and fixed that mismatch.
- Contract's generated data adapter covers live queries and mutations, while
  callable-only page queries still need the ordinary Snapback client. The
  product keeps compiled Contract for the live room and actions and mounts a
  small history control around the generated callable references. This is a
  real authoring seam, now captured as a guide-gap ticket rather than hidden.

Compared with React plus Convex or Supabase, Snapback asks for more explicit
authority setup, but removal invalidation and cursor custody arrive as one
platform contract instead of coordinated cache and policy conventions. The
local receipts are substantially stronger now; search, attachments,
notifications, moderation, sessions/hosted operation, and the complete
`STEP6.CHAT` claim remain deliberately red.

## 2026-08-16 — owner-write pressure exposes the fan-out gap

LLP 0264 Phase 1a made an important mismatch impossible to ignore: the inbox
is recipient-owned, but `sendMessage` wrote rows into other principals' owner
slices and moderator removal deleted them. The local, explicitly non-claiming
kernel now writes only the sender's host-stamped delivery and performs no
cross-owner inbox cleanup. Room messages and the display roster retain their
pre-0264 runtime behavior behind visible migration-pending facts.

This is intentionally a loss of demo capability, not a covert widening of the
owner policy. Restoring bounded recipient fan-out and moderator cleanup needs
an explicit IR sibling with cross-principal write authority; the Phase 1b
migration ticket owns that dependency. Compared with Convex or Supabase, this
is more ceremony, but the failure is honest: application code cannot borrow a
recipient's read identity as write authority merely because the fan-out is
useful.
