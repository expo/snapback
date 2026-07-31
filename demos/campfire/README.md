# Campfire — React query-group rerun arm

The Campfire chat contract from the workout matrix (Diary 0025, rerun in
Diary 0034) rebuilt inside this repository as a rerun arm that consumes the
LLP 0114 first-class React surface and a registered LLP 0112 generated query
group.

## Why this arm exists

LLP 0115 §Sequencing 5 records a measurement correction for the successor
matrix rerun: the Diary 0032–0039 method drives the provider's headless
client, so the LLP 0112/0114 React/query-group gains were structurally
invisible to it, and the plan's reactive-boundary watch trigger was
unmeasurable. This arm makes the trigger measurable — every product read
renders through a real React tree over the registered generated group, and
the acceptance suite fails if the arm stops using either surface.

## Shape

- `snapback/schema.mjs` — rooms, messages (unique `by_room_sequence`),
  reactions; sessions-mode artifacts; deliberately no membership model,
  matching the paired matrix arms.
- `snapback/functions.mjs` — declarative live `liveMessages`/`liveReactions`
  (the register group's children), JS `roomSummary` and `messagePage`
  (callable contract parity with the paired arms), JS `sendMessage` and
  `toggleReaction` mutations with exact result contracts.
- `snapback/routes.mjs` — one parameterized route `/rooms/:roomId`; codegen
  emits the typed `registerGroupEligible` group reference.
- `src/CampfireRoom.mjs` — the arm's product surface. Consumes ONLY
  `@expo/snapback-react`: `useSnapbackQueries(preparedGroup)`,
  `useSnapbackMutation`, `useSnapbackConnection`. It renders the registered
  boot provenance so the committed tree itself witnesses registered-bundle
  consumption.
- `tests/react-arm.mjs` — the retained acceptance
  (`acceptance/results/react-arm.v1.json`): registered boot renders through
  React, live mutation deltas re-render the tree, the shared pagination and
  summary contracts hold, a structural pin keeps the component off the
  headless client, and disposal releases every provider/server resource.

## Running

```sh
node packages/snapback-codegen/index.mjs demos/campfire/snapback  # regenerate
node demos/campfire/tests/react-arm.mjs                           # acceptance
```

The suite starts its own server on an OS-assigned port from
`target/debug/snapback` (run `scripts/bootstrap-ibex-runtime` first on a
fresh checkout). No demo-local `node_modules` is needed: the test and
component import the workspace packages and the root React install by
relative path, so everything shares one React instance.

## Known seam

A `$param` mapping into a JS-handler live query is marked
`registerGroupEligible` by codegen but refused by the served routes
admission, which derives param types only from declarative plans. That is
why this arm's group children are declarative; see
`issues/20260731-0112-register-eligibility-js-param-seam.md`.
