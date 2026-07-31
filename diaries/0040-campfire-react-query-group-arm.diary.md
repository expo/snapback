# Diary 0040: Campfire React query-group rerun arm

**Application:** Campfire (in-repo rerun arm), Snapback only
**Date:** 2026-07-31
**Code:** `demos/campfire`
**Prior diaries:** 0025 (matrix Campfire), 0034 (current-main rerun)
**Systems:** React bindings, generated query groups, registered bundle boot,
codegen, sessions auth, acceptance testing

## Why this arm

LLP 0115 §Sequencing 5's measurement correction: the Diary 0032–0039 rerun
method drives the provider's headless client, so the LLP 0112/0114
React/query-group work was structurally invisible to it. This build is
measurement prep only — the Campfire contract (rooms, monotonic sequences,
newest-first exclusive-cursor pagination, reactions, live delivery) rebuilt
so that every product read renders through `useSnapbackQueries` over a
registered generated group, with acceptance that fails if the arm stops
using the React surface or the registered group. No capability claims
change; no live search; the option 1a pre-registration stays watch-gated.

## What felt good

- **The registered group is genuinely less code than the Diary 0025/0034
  client wiring.** `defineRoutes` → codegen emits a typed group reference →
  `prepareQueryGroup(groups['/rooms/:roomId'], { roomId })` →
  `createSnapbackReactProvider(binding, { preparedGroup })` →
  `useSnapbackQueries(group)` in the component. There is no
  prime/subscribe sequencing, no per-query subscription glue, and the boot
  provenance (`room.boot.source === 'registered-bundle'`, one commit
  version) is a rendered fact the acceptance can pin from the tree itself.
  Convex gives reactive queries by default but has no equivalent of "both
  feeds adopted at one named durable commit, visible to the app."
- **`fallbackToLive` omitted is a real pin.** Preparation refuses if the
  target stops advertising `registered_bundle_boot_v1`, so the arm cannot
  silently degrade to ordinary live boot. Capability honesty as a test
  primitive worked exactly as LLP 0112 describes.
- **The signal-desk suites were a paved path.** Sessions provisioning,
  mailbox code capture, versioned seed reset-install, and the
  receipt-gated kit server harness copied over with almost no thought. The
  `startServer` provenance/receipt machinery meant the suite runs against
  this worktree's own qualified binary on an OS-assigned port with zero
  port coordination.
- **Provider inspection is a good acceptance surface.** `consumers`,
  `preparedRegistrations`, `preparedGroupSource`, and the zero-resource
  disposal sweep let the suite prove "the React render is the consumer"
  and "nothing leaked" without reaching into private state.

## What felt bad

- **Codegen and the server disagree about register eligibility.** The first
  route used the JS live queries from the Diary 0034 arm (`v.id` args,
  primitive string), and codegen happily emitted
  `registerGroupEligible: true` — then `ensureApp` refused the manifest:
  the served admission derives `$param` types only from declarative
  HostPlan filters (`function_route_arg_types`), never from JS argument
  schemas. The author finds out at provision time, not generation time.
  Filed as `issues/20260731-0112-register-eligibility-js-param-seam.md`;
  the workaround (declarative `defineLiveQuery` children with
  `eq('roomId', arg('roomId'))`) is fine for Campfire but means a computed
  live summary cannot sit behind a route param today, so the arm assembles
  its live summary client-side from the two live children — coincidentally
  the same composition shape the paired Convex arm uses.
- **`auth: { mode: 'sessions' }` is easy to miss.** Without it codegen
  emits dev-flavored artifacts and sessions provisioning refuses with
  `SNAPBACK_REQUEST_JSON_INVALID` plus a buried detail string
  (`app.ensure Sessions provision requires schemaVersion snapback.v1`).
  The top-level code says "invalid JSON" for what is really a
  schema-flavor mismatch; the detail should be the headline.
- **React 19 + test renderer needs the act environment.** Without
  `IS_REACT_ACT_ENVIRONMENT` the initial mount never flushes and the root
  reports "unmounted" — no error, just an empty renderer. The package
  suites had the answer, but nothing demo-facing documents the pattern for
  rendering a real server-backed provider tree in Node. Real-socket live
  deltas also cannot all be act-wrapped, so the suite flushes them in
  act-wrapped time slices and silences exactly the known advisory.
- **Fresh demo installs cannot resolve workspace deps.** `bun install` in
  a new demo with `file:` deps fails on the packages' internal
  `workspace:*` edges (signal-desk installs only because its committed
  `bun.lock` already carries the mapping). The arm sidesteps node_modules
  entirely with relative imports into `packages/*` and the root React
  install — fine for an in-repo arm, but a real external consumer would
  hit the published-registry path instead, so this is invisible to CV-1.
- **`client.query(ref, { args })` vs hook ergonomics.** The headless
  parity checks initially passed args directly (`{ roomId }`) and got
  "args.roomId is required". The React surface takes bare args; the
  headless client wants them nested under `args:`. Small, but it is
  exactly the kind of seam the React surface exists to remove.

## Comparison note for the successor rerun

Diary 0034 scored Campfire a slight Convex edge mostly on authoring and
discoverability. This arm does not re-score anything, but it changes what a
rerun CAN score: subscription glue, boot consistency, and typed group
consumption are now measurable on the Snapback side through the React
surface. The honest remaining gaps for a rerun to examine: reactive-by-
default (Campfire's summary had to become client-side composition because a
JS live query cannot sit behind a route param), and the register cliff
(one ordinary `Query` child in a route would silently drop group
generation — LLP 0115's watch item still stands).

## Receipts

`demos/campfire/acceptance/results/react-arm.v1.json` — 7/7 checks against
this checkout's qualified binary: register-eligible group parity, registered
boot rendered through React, live mutation and reaction re-renders, shared
pagination/summary contracts, the React-surface structural pin, and
zero-resource disposal.
