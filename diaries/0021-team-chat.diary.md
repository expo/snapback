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
