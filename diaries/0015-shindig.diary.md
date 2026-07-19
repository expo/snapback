# 0015 — Shindig (Partiful-style events on Snapback)

- **Demo:** `demos/shindig/` — events, invites, RSVPs, live guest list, event
  wall; React surface with a dev-mode persona switcher.
- **Author:** Claude (agent), with ccheever
- **Date:** 2026-07-18

## 2026-07-18 — first build

Goal: a Partiful-shaped app — the first demo to exercise **resource-scoped
membership** (LLP 0056) as real product structure rather than an
authorization proof. Backend is dev-mode auth; the required headless suite
passes 13/13 and a three-window Chrome acceptance passes 7/7.

### What felt good

- **The guide's intent-first indexing worked as advertised.** Cold start →
  capability index → scoped-roles page → rbac demo sources gave me the
  complete membership authoring surface (declaration grammar, transition
  matrix, `bootstrap()`, `ctx.permissions`/`ctx.membership`) without reading
  runtime code for the happy path. The one thing the guide could not answer
  (below) I had to dig out of `src/storage.rs`.
- **Codegen fails closed and its diagnostics are trustworthy enough to design
  against.** I tried an undocumented combination — membership declarations
  under `auth: dev` (every existing fixture is sessions-mode) — expecting to
  iterate on diagnostics, and it simply worked, end to end, including the
  membership semi-join on live queries. First `codegen ok` on the first run.
- **`bootstrap()` is a genuinely nice primitive.** "Create the event and seat
  its host atomically, and the caller cannot name anyone but themselves" is
  exactly the right shape for `createEvent`; the `lastHolder: { protect:
  'host' }` declaration made host-orphaning unrepresentable for free.
- **The membership boundary being host-owned made the negative checks almost
  free.** Denials are invariant (`{ kind: 'role' }`, no existence leak), raw
  roster writes are refused below handler level, and non-member live
  subscriptions just deliver nothing. The acceptance suite's isolation checks
  passed on the first run — I didn't have to build any of that honesty.
- **Vacuous-pass protection earns its keep.** My first run declared
  `expectedChecks: 12` for 13 checks and the harness refused the pass.
- **The React arm's hand-wiring is small and honest.** One ~90-line hook
  (subscribe, snapshot-from-handle, connection axis, StrictMode-latecomer
  disposal — all straight from the guide page) carries the whole surface.
  Dev-mode `userId`-per-call made the persona switcher trivial: key the tree
  by user and every subscription re-binds under the new principal.

### What felt bad

- **The "pending invite → accept" role transition is not spellable in v1,
  and the guide's own example implies it is.** The scoped-roles page (and
  `rbac-authoring.test.mjs`) showcase `pendingRoles: ['invited']` with
  host/guest events — the obvious reading is invite-as-membership-insert,
  then promote on accept. But `setRole`/`remove`/`patch` take a `memberId`,
  and v1 membership tables are fully private to app code (no reads, no
  existence oracle, insert returns null), so **no handler can ever obtain a
  memberId**. The only reachable transitions from app code are `insert`
  (bootstrap aside). Host-side Rust tests get memberIds from admin
  `scan_table`, which apps don't have. I redesigned around it — pending
  invites live in an app-data `invites` table and the seat is created at
  first RSVP via a `by: ['none']` self-insert — and the result is arguably
  *more* Partiful-like (RSVP to unlock), but I only got there after grepping
  `storage.rs`. Filed as ENG-25263; the capability index should carry an
  explicit row for "membership row identity is not app-visible in v1".
- **A point-read JS query must return an array, and the diagnostic blames
  the wrong kind.** `getEvent` returning a single row object failed at
  runtime with `SNAPBACK_HANDLER_RESULT_INVALID: live query handler must
  return an array of rows` — for an ordinary `defineJsQuery`. Cheap fix
  (`return [event]`), but the message cost a confused minute and the guide's
  queries page doesn't state the rows-array contract for JS handlers.
- **Hand-spawning the server without a TTY fails obscurely.** `cargo run --
  --port N --memory` under `stdio: ignore` dies with "failed to emit
  impersonation capability to the controlling terminal". The kit's
  `startServer` avoids this via `--ready-file` (the capability goes to an
  owner-only sidecar), but a browser-acceptance suite that spawns its own
  fixed-port server — as cursors-web's does, and mine copied — hits it cold.
  Passing `--ready-file` fixed it; the error could hint that.

### Modeling notes (vs. React + Convex/Supabase)

- **No joins in declarative live queries pushed me to denormalize at write
  time.** The feed card needs event title/emoji/time; in Convex I'd join in
  the query function, in Supabase I'd view/RLS it. Here the `invites` row
  carries denormalized event fields written by `invite`. For an events app
  this is fine (event facts are near-immutable), and it kept every live
  query a single indexed table scan — but it's a real difference in where
  the work goes.
- **The roster/display split is a feature, not a workaround.** Supabase RLS
  tempts you to make the authorization table also the UI table; v1's hard
  privacy forced `eventMembers` (authority) and `invites` (display) apart,
  and the demo is clearer for it — the guest list is just app data *gated
  by* authority.
- **Live queries + membership semi-join beat hand-rolled realtime
  authorization.** "Grace RSVPs and Ada's guest list updates, while Eve's
  subscription stays silent" required zero client or handler code — the
  boundary does it. Getting the equivalent right with Supabase channels or
  hand-filtered websockets is exactly the kind of code I didn't write today.
- Contract/Exact were not used in this build; the surface is the hand-wired
  React arm only.

### Follow-ups

- Guide gap filed for the memberId/`setRole` reachability cliff and the
  JS-query rows-array contract (ENG-25263).
- A sessions-mode variant with a real login sheet would make Shindig an
  end-to-end auth showcase; today that story belongs to rbac/card-game.
- Ephemeral presence ("👀 3 people looking at this party") is the natural
  next feature and would exercise typed rooms from the presence recipe.

## 2026-07-18 — the Contract arm, built to compare

Rebuilt the same product as a Contract/Exact surface
(`surfaces/contract/`: `feed.contract` + `event.contract` + `data.ts`
helpers + `main.ts` boot). Same backend, same testIds, same claims; the
browser acceptance passes 8/8. Observations, Contract/Exact separated from
Snapback per the diary convention.

### Contract/Exact: what felt good

- **The volume of code that simply doesn't exist.** The React arm's
  `useLiveRows` hook — subscribe, snapshot-apply, connection axis,
  StrictMode-latecomer disposal — has no Contract equivalent because the
  generated bindings + `createSnapbackContractSurface` own all of it. My
  entire data plane is `use X from "…generated/contract/X.query.ts"` plus
  one `liveQueries:` array in boot. The adapter guide's claim ("you write no
  data-plumbing") held up literally.
- **The view language is fast to write once you have a crib sheet.** With
  todo-v2/graffiti/all-aboard open as references, both screens took about as
  long as one React view. `async … loading/error/empty/ready` is a genuinely
  better forcing function than anything in React-land: I got a designed
  loading, error, *and* locked state on the event screen because the
  language made me write branches I'd otherwise have skipped.
- **The observability lint caught a real modeling fact.** The compiler
  warned that `rsvp`/`createEvent` write `eventMembers` "but no bound query
  reads it — the mutation's UI effect cannot be observed" (LLP 0278 §5).
  That's not noise; that's the roster-privacy design surfacing in static
  analysis. A UI truly cannot observe the membership write, only its
  app-data shadow. I'd rather have this lint than not, but see the seam note
  below.
- **The `contract` block + agent surface come for free.** The dev server
  exposes an agent/MCP surface with the declared claims; the React arm has
  nothing comparable without hand-building a debug object (which the React
  demos all do, by hand, per surface).
- **`mount(app, { props })` + capabilities kept the impure edges honest.**
  URL navigation had to be declared as a `capability({ effects:
  ['device.url.open'] })` — the one impure thing the surface does is named
  in its meta, not buried in a click handler.

### Contract/Exact: what felt bad

- **Boot-bound live-query scope reshaped the product.** The multi-live
  surface establishes **one subscription per query name, args fixed at
  boot** (LLP 0034 §10.4) — so "which event am I looking at" cannot be
  component state the way it is in React. Event selection became a full
  navigation (`?event=<id>` reload). Defensible — the reload is cheap and
  the invariant is honest — but it took the deepest source-diving of the
  build (`createMultiLiveContractSurface`) to learn, and the guide states it
  only in one dense bullet.
- **Ordinary snapshot queries are unservable in multi-live mode, and the
  failure masquerades as data.** Binding `getEvent` (a `defineJsQuery`)
  compiled fine, then at runtime the unconfigured-query diagnostic surfaced
  through the binding's `error` branch — my locked-page check initially
  "passed" while actually rendering `SNAPBACK_CONTRACT_QUERY_UNCONFIGURED`.
  Everything reachable from a `.contract` view must be a configured *live*
  query. The fix was to grow the backend a membership-gated IR
  `eventDetails` live query (better product anyway — event edits stream),
  but the constraint deserves a compile-time or boot-time hard error, not an
  error-shaped cell: the manifest knows `getEvent` has `livePush: false` and
  the surface knows its configured set.
- **Contract-block claim grammar is narrower than the action grammar, and
  the parse error points at the wrong line.** `action respond mutates
  respondMut` inside the `contract` block is invalid (only `writes` claims
  parse), and the diagnostic said `expected "writes" in action clause` at a
  *view* line ~13 lines below the actual offender. Cost ten confused
  minutes.
- **Membership denial vs. empty-rows shows through differently per arm.**
  The React arm renders the JS query's invariant role denial
  (`SNAPBACK_AUTH_PERMISSION_DENIED`) as the locked page; the Contract arm
  renders the live query's empty-rows semi-join through the `empty` branch.
  Both honest, subtly different UX affordances — worth one guide paragraph
  saying "gated live queries deny by emptiness; gated point reads deny by
  diagnostic; pick your locked-page branch accordingly."

### The comparison, distilled

- **Lines of surface code:** React arm ≈ 640 (App.tsx + hook + boot);
  Contract arm ≈ 420 (.contract × 2 + data.ts + main.ts), with the
  hardest 90 lines of the React arm (subscription lifecycle) replaced by
  configuration.
- **Where the effort went:** React — wiring and lifecycle correctness;
  Contract — learning binding/scope rules and view-language grammar. React's
  cost recurs per surface; Contract's is mostly a one-time learning cost.
- **Fidelity:** the Contract arm matched every product claim, including the
  locked page, with two shape changes: persona/event selection moved to the
  URL, and the event hero reads a live query instead of a point read.
- **Verdict for a Partiful-class app:** the Contract arm is the better
  authoring experience *once the backend exposes everything as live
  queries*, which Snapback makes cheap. If I were starting Shindig over I
  would design every read as a live query from the outset and skip snapshot
  JS queries entirely for UI-facing reads.

### Follow-ups (Contract arm)

- Consider a hard boot-time refusal (or codegen lint) for binding a
  non-live query in a multi-live Contract surface, instead of the runtime
  error cell.
- Guide paragraph on denial-by-emptiness vs denial-by-diagnostic for
  membership-gated reads (fold into ENG-25263's page work).
- The contract-block claim grammar (`writes`-only) and its misleading parse
  location are worth an Exact-side note.
- Actions cannot observe mutation failure: with the backend down, pressing
  "Send it" put the transport rejection into the Vite error overlay anchored
  at the action's source line, reading like a compile error ("Load failed …
  action submitCreate"). The React arm catches the same rejection in its
  handler. Contract wants an idiomatic failure affordance for
  `mutates` actions (an error branch or a surface-level mutation-failure
  binding) — Exact-side, alongside the grammar note.

## 2026-07-18 — Structural dedupe replaces the invite scan

The `invites` table now declares a true unique compound index over
`(eventId, userId)`. The handler no longer collects every invite for an event
and scans in JavaScript; two concurrent invitations admit exactly one row.
When a duplicate reaches the settled database cut it receives
`SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`; a concurrent request can instead lose
earlier at the authorization-reservation fence, still without committing.

This is the familiar PostgreSQL/Supabase constraint shape and is materially
better than a Convex-style read-before-write convention for invariant data:
correctness does not depend on every handler remembering the scan. I did not
add upsert sugar—the product wants duplicate invite to remain a visible
conflict, and update-vs-insert result semantics deserve their own design.

## 2026-07-18 — Follow-up authoring seams closed

The platform fixes prompted by this build now make the original failures much
more legible: ordinary and live JS queries name their actual kind when a
handler returns a non-array, and a no-TTY server start points directly to
`--ready-file`. The React arm also deleted its local live-handle interface and
imports the maintained types shipped beside `_kit/client.mjs`; that removes a
small but recurring piece of glue from every TypeScript surface.

Snapback now supports host-resolved self membership transitions as well.
Shindig intentionally keeps pending invitations in app data because they are
part of the product display model, but apps that want private-roster
accept/leave/renew flows no longer need that modeling choice as a workaround.
