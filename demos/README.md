# Demo catalog

**Checked projection.** This table is compiled by reading each
`demos/*/demo.snapback.json` (the machine-readable demo manifest). The uniform
selection contract lives in [`catalog.v1.json`](./catalog.v1.json): purpose,
clients, targets, maturity, canonical run/proof commands, expected evidence,
and README contract/waiver status. `scripts/check-inventories.mjs` joins the
registered IDs, manifests, this table, that structured catalog, README files,
evidence paths, and `guide/capabilities.md`; add or reshape all affected records
together.

Directories without a `demo.snapback.json` (research arms, bakeoff harnesses,
fixtures such as `zero-bakeoff/`, `zerobugs/`, `chat-matrix/`,
`expo-golden-path-fixture/`) are deliberately outside the
declared inventory; their own directories document them.

Per-demo columns: what it demonstrates (from the manifest `description`),
the declared surfaces with their requirement labels (each surface names its
runner/proof command in the manifest), and whether a local README exists.
Manifests also carry `capabilityGaps`/`notClaiming`. Every nonempty gap list has
a dated `capabilityGapsBoundary`: `frozen` and `current-demo-scope` entries are
explicit demo nonclaims, while `current-platform` entries must resolve to GAP
rows in `guide/capabilities.md`, the current capability truth.

| Demo | What it demonstrates | Surfaces (requirement) | README |
| --- | --- | --- | --- |
| `access-desk` | Resource bootstrap, membership admission, protected notes, permission-enforced writes | headless (required) | yes |
| `all-aboard` | Caltrain next-train app: cron, real 511.org data through server-side actions, routed ETAs, Contract UI, native arm | headless/cron/egress/real-data/contract/update-economy (required), native (commit-pinned), react-control (control arm) | yes |
| `backend-bakeoff` | Signal Desk: one incident-response React product on Snapback, Convex, and Supabase for honest comparison | react three-backend product + native acceptances (required / comparison arms) | yes |
| `browser-auth` | Local product-shaped browser sign-in: verified external assertion seam, immutable identity binding, protected app rows, IndexedDB reload custody, and logout | browser-auth-witness (integration) | yes |
| `browser-local-first` | Real-Chrome witness for public authority-independent IndexedDB retention and queued replay | browser-public-witness (integration) | yes |
| `campfire` | Campfire chat contract rebuilt on the first-class React surface and a registered generated bundle (query-group rerun arm) | reactQueryGroupArm (required-local-nonclaim) | yes |
| `card-game` | Sessions-mode hidden-hand isolation, two-axis queue custody, live logout blanking, lease-bounded offline retention | sessionAuthProof (required) | yes |
| `catalog-lens` | Owner-scoped books joined to a public publisher dimension through a bounded relational query | headless (required) | yes |
| `chirp` | Expo SDK 57 universal social timeline (posts, likes, profiles) over live queries and mutations | expo (ios/android/web), headless acceptance | yes |
| `cursors-web` | Web cursor presence over ephemeral realtime: pure Contract surface plus a hand-wired React control arm | contract (required), react (control arm) | yes |
| `dispatch-board` | Incident intake with server-authored IDs and time, atomic audit writes, owner-scoped live reads | headless (required) | yes |
| `file-drop` | Local asset pipeline: upload progress, trusted image finalization, typed attachment, live gallery, public delivery | headless (required), react (integration) | yes |
| `fleet-observatory-move1` | One mixed snapshot-batch.v2 composite route over 250,000 protected events | none declared (web app + `tests/`; workload-manifest.2026-08-06.v1.json) | yes |
| `graffiti` | Shared pixel wall: durable last-writer-wins marks over live queries plus TTL ephemeral cursor presence | headless/widget (required), contract (optional), macosNative (blocked), react (absent — historical scoping) | yes |
| `latency-kanban` | Generated-IR optimistic paint, Lane-L settlement, observer convergence, loss-free retained replay | none declared (web app + `tests/`) | yes |
| `media-happy-post` | Owner-scoped Expo avatar and ordered image/video posts through generated media commands and delivery hooks | expo (ios/android integration) | yes |
| `messaging-snapback` | Expo Router messaging app: DMs, groups, text/image messages, reactions, reply previews, live typing | expo (ios/android/web), headless acceptance | yes |
| `partiful-matrix` | Partitime: one event/RSVP/wall contract as a 3×4 matrix across React/Contract/vanilla JS and four backends | headless (required) + 16 integration arms | yes |
| `party-wall` | Full asset-pipeline consumer: strip-declared photo uploads, required variants, ctx.assets.attach, RBAC'd live wall | headless (required), react (integration) | yes |
| `pointing-room` | Planning poker: state-dependent disclosure (votes masked on the wire until the round is revealed) over a cross-table JS live query, plus room-keyed Contract query scopes | headless disclosure proof (required), contract browser (integration) | yes |
| `public-dashboard` | Route-declared public snapshot bundle with parameter binding and resume tokens | headless (required) | yes |
| `pulse-monitor` | Demand-gated scheduled action → mutation → live-query delivery | headless (required) | yes |
| `rbac` | Scoped roles and memberships: declaration-bound visibility, generated membership writes, raw-write refusal | headlessRbacProof (required) | yes |
| `shindig` | Partiful-style events and RSVPs over resource-scoped membership with a React surface | headless (required), react/contract (integration) | yes |
| `team-chat` | Local non-claiming Slack/Discord-shaped pressure kernel: protected rooms, fan-out, unread state, revocation | headless/react/contract local product (required-local-nonclaim) | yes |
| `tiny-triumphs` | Expo SDK 57 shared victory jar over one public-read table, a validated mutation, and a live query | expo (ios/android/web), headless acceptance | yes |
| `todo` | The floor reference app — **legacy bundled-handler authoring form on purpose**; start new work from `todo-v2` or the templates | headless (required), contract (optional), react (absent — historical scoping) | yes |
| `todo-v2` | Second todo reference: richer rows, all-IR generated Contract bindings, retained/offline replay, register-mode web boot | headless/registerBoot (required), contract (optional), react (absent — historical scoping) | yes |
| `triage-graph` | Bounded graph composition, protected query churn, durable registration custody, authoritative retained relaunch | none declared (web app + `tests/`; workload-manifest.2026-08-03.v1.json) | yes |
