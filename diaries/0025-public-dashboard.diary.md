# 0025 — Public Dashboard snapshot-bundle workout

## 2026-07-27 — anonymous one-commit deep-link boot

Public Dashboard maps `/dashboards/:dashboardId` to one explicitly public,
authority-independent, `publicInline` live query. Acceptance provisions the
route manifest, fetches anonymous read-mode bundles for two route parameters,
checks resume tokens and commit identity, and refuses an undeclared route.

### What felt good

- `defineRoutes` made the page's data inventory explicit and prevented callers
  from choosing arbitrary functions.
- One request returned route-bound rows at one commit with a resumable-query
  token. The app authored no boot coordinator.
- Codegen made the three anonymous-disclosure facts inspectable in the function
  manifest.

### What felt bad or surprising

- The capability index advertised snapshot bundles but marked the guide as a
  GAP. Building the smallest correct app required reading LLP 0092 and existing
  rollout fixtures.
- Response details such as `commitVersion`, `entry.resume.token`, the seed
  outcome spelling, and the unknown-route diagnostic were discoverable in code
  but not in an intent-oriented page.

The new `guide/realtime/snapshot-bundles.md` teaches route declaration,
read-mode fetch, response shape, register-mode adoption, target limits, and
anti-patterns from this executable demo.

## 2026-08-08 — structured route-group context

Public Dashboard now has a second route whose `dashboardId` binding sits
inside a `context` object beside a nullable cursor, a literal-union sort, and
an array of literal tags. Acceptance checks both the lowered manifest and the
rows selected by that nested binding, so the example proves the context is
operational rather than decorative.

### What felt good

- `routeParam()` composes directly with ordinary object-shaped query inputs;
  the route did not need a primitive wrapper argument or a server-side merge.
- The generated manifest makes the full nested mapping and register-group
  eligibility inspectable before a bundle is served.

### What felt bad or surprising

- The existing guide showed only top-level scalar bindings, so source reading
  was still required to discover both the supported structured literals and
  the deliberately refused shapes.
- This surface is newer than the published 0.1.15 package closure. The guide
  now says so explicitly instead of letting a package consumer infer support
  from a contributor-source example.

## 2026-08-16 — public-exact retention becomes the default

`metricsFeed` is now the demo's positive offline-retention witness precisely
because it carries no `authorityIndependent` or `retainable` declaration. The
closed public single-table plan gives codegen and the local host enough owner
evidence to admit it. The former “omitting the flag refuses retention” lesson
was therefore backwards after the derivation changed.

The replacement negative fixture, `protectedMetricsFeed`, is an anonymously
callable opaque JavaScript live query. That keeps the acceptance focused on
the retention boundary: it reaches live execution, but codegen cannot certify
the exact plan, so the host mints no RQS proof and the durable store remains
empty. This is a cleaner teaching pair than two byte-near-identical public
plans differentiated by a configuration switch.

Compared with a React plus Supabase-style cache, the pleasant part is that the
application owns no cache policy or identity key. The uncomfortable part was
evidence migration: changing an admission default invalidated the demo's
named negative fixture and the guide snippet at the same time. Keeping those
snippets sourced from the acceptance made the contradiction mechanically
visible once the fixture moved.

Codegen succeeded locally. The Node acceptance could not execute in this
sandbox because binding its loopback server failed with `listen EPERM`; no
acceptance report was fabricated or hand-edited.

## 2026-08-25 — offline outbox capability custody

The offline acceptance now observes the local target's positive
`offline_mutation_replay` advertisement before disconnecting, queues its two
generic mutations while transport is unavailable, and relaunches the durable
client after the dev server restarts so the per-boot identity capability is
current. The pending records then drain in order and the settlement ledger
returns the original result for a duplicate delivery.

### What felt good

- The online mutation probe settled normally, which quickly ruled out the
  public-read table posture as the cause despite the codegen migration warning.
- The durable store kept both intents across client shutdown, and the ordinary
  default drain replayed them after relaunch without demo-authored retry code.
- The target guide made both safety boundaries explicit: positive settlement-
  ledger evidence admits custody, while dev-identity credentials rotate per
  server boot.

### What felt bad or surprising

- The client correctly recognized `fetch failed` as connectivity loss, but its
  follow-up capability probe used the same unavailable transport and discarded
  a positive manifest already observed from that server. The resulting
  `SNAPBACK_CLIENT_REFUSED` made a capability-evidence loss look like mutation
  failure classification.
- Once enqueue worked, the old acceptance's same-client restart path exposed a
  second, independent mismatch: the client retained the previous boot's dev
  identity capability. A direct/headless client must relaunch from the current
  server kit; supervised app clients have the live rotation seam.

Compared with a hand-built React cache or a Supabase offline queue, Snapback's
positive target gate and settlement ledger add ceremony but prevent unsafe
replay against a target that cannot deduplicate. The useful ergonomic payoff is
that the intent, ordering, and exactly-once result survive the relaunch without
application-managed queue tables or reconciliation code.
