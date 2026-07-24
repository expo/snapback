# Competitive checkpoint fixture

This is the frozen owner-private AI chat fixture from LLP 0075. It exercises
generated owner CRUD, unique lookup, keyset pagination, an explicit streamed
action, durable idempotent progress mutations, native live push, and one shared
React/Expo surface.

Generate and run the local semantic witness from the repository root:

```sh
SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs demos/competitive-checkpoint/snapback
node demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs
```

Verify the React/Expo projection:

```sh
cd demos/competitive-checkpoint/surfaces/react-expo
bun install --frozen-lockfile
bun run typecheck
bunx expo export --platform web --output-dir dist-web
bunx expo export --platform ios --output-dir dist-ios
```

Reproduce the public-alias package closure in a cold external directory and
retain its explicitly non-public checkpoint receipt:

```sh
node scripts/snapback-package-cold-install.mjs \
  --receipt demos/competitive-checkpoint/acceptance/results/package-cold-install.v1.json
```

Build the target-neutral immutable release closure from the frozen backend and
web export. This proves identity, scans, component digests, and read-back; its
blocking GAPs are the machine-readable reason it is not a hosted deployment:

```sh
SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-cli/cli.mjs deploy build \
  demos/competitive-checkpoint/snapback \
  --target-profile local-dev-sqlite-ibex \
  --web-dist demos/competitive-checkpoint/surfaces/react-expo/dist-web \
  --output /tmp/snapback-competitive-releases \
  --allow-dirty \
  --json
```

The protocol is [acceptance/protocol.v0.json](./acceptance/protocol.v0.json).
[acceptance/implementation-status.v0.json](./acceptance/implementation-status.v0.json)
records Charlie Cheever's `reprioritize` adjudication, the selected
`single-instance-container-vm.v1` next tranche, and the remaining blockers. In
particular, local/Workerd streaming evidence is not a substitute for public npm
publication or the complete hosted-profile drill.

The deterministic statistics engine and event-derived metric ledger are
implemented as explicitly unratified candidates under
[`acceptance/instruments/`](./acceptance/instruments/README.md). Their tests
lock implementation/schema digests and reject ambiguous event sequences, but
they do not unblock timed runs until a dated LLP 0075 amendment ratifies those
exact bytes.

The same directory contains an independently locked candidate machine gate
matrix. Its evaluator rejects missing arm/gate pairs, false positive treatment
of expected refusals, duplicate decisions, and invented `not-applicable`
outcomes. It is likewise unratified and cannot authorize evidence collection.

A fail-closed run-capsule verifier is also present. It can validate and
content-address the eventual prompt, scaffolds, harnesses, environment,
packages, provider choices, credentials, agent configuration, and
documentation corpora, but the populated capsule does not exist yet. The
verifier deliberately refuses timed execution for an unratified envelope.

The candidate scoring engine applies the exact first-hour conjunctions,
absolute-zero floors, confidence totals, trust lead, and outcome precedence.
It does not contain confidence-anchor prose; those anchors still require an
eligible independent author before evidence reveal.
