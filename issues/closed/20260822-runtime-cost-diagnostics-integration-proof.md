# Integrate, document, and prove runtime-cost diagnostics

**Status:** Closed
**Opened:** 2026-08-22
**Closed:** 2026-08-25
**Systems:** Diagnostics, CLI/inspection, Guide, Acceptance testing
**Governing:** LLP 0267 §7.7; LLP 0031 D3; LLP 0295 W5
**Depends on:** `issues/closed/20260822-runtime-cost-recorder-and-server-observations.md`;
`issues/closed/20260822-client-runtime-cost-and-delivery-inspection.md`;
`issues/closed/20260822-equivalent-work-and-framework-multiplicity-diagnostics.md`

## Scope

- Expose one gated, pull-only local snapshot through the existing LLP 0031 D3
  path or in-process CLI; add no new telemetry protocol.
- Extend the query-cost guide (or a focused sibling) with the delayed-send and
  stalled-live-projection worked attributions.
- Assemble LLP 0267 §7.7's integrated redaction, bounds, attribution,
  multiplicity, posture, and snapshot-join fixtures.

## Exit

The affected proof passes; `PublicInspect` remains unchanged; hosted serving
has the recorder off and no export/upload path; both worked cases are
attributable without source inspection or empirical retry delays; guide and
diagnostic-register checks pass; LLP 0267 and LLP 0295 receive an
implementation-status reconciliation without overstating hosted capability.

## Progress — 2026-08-24 fix round

The existing authenticated LLP 0031 D3 pull exposes the bounded instance-local
snapshot without a new protocol. The fix-round receipt starts a real managed
server, establishes a real client subscription, pulls `app.inspect` through the
ready-file-authenticated host operation, serializes that envelope, and feeds
the parsed `data.runtimeState` into the client join. A JS-handler observation is
retained with `complete: false`, positive result facts, no physical
consultations, and no application values, so physical zeros cannot be mistaken
for measured zero work. The production declarative-query producer separately
proves value-free best-effort index facts and branch-and-drop collection
failure.

This does **not** claim that multiplicity and hosted/direct posture were
reassembled into that cross-process fixture. Those facts remain proven only by
their focused A/C/server owner tests. The §7.7 full integrated acceptance line
therefore remains open; LLP 0267 and LLP 0295 record source implementation and
the narrower receipt without claiming complete W5 acceptance or hosted
telemetry/export.

## Resolution — 2026-08-25

The reopened remainder is now assembled from production composition paths.
`packages/snapback-cli/familiar-dev-loop.test.mjs` starts one managed
development instance and, in one journey, drives three durable mutations from
connectivity-refused enqueue through a visible pending replay stop and then
settlement. Two equivalent inputs and one distinct input enter the recorder
through `mutate`; duplicate subscriptions enter through real `liveQuery`
establishment; and asset issuance enters through mounted
`useSnapbackAssetUrl` hooks. The pulled client snapshot proves each retained
fact and warning, its one-key overflow bucket and eviction count, exact
multiplicity totals, pseudonymized caller-controlled ids/labels, and the
selected mutation's finite queue/auth/execution/commit attribution. The
connectivity gate remains closed across a controlled clock interval, and the
settled record must report `queueWaitMs > 0`, so a producer that merely stored
zeroes cannot satisfy the delayed-send proof.

That same receipt pulls the ready-file-authenticated `app.inspect` envelope,
retains `complete: false` JS-handler observations, and joins three same-version
subscriptions. Each joined `wave.waveSeq` must equal that subscription's
`serverRegistry.lastDeliveredWaveSeq`, and all three wave sequences must be
distinct. It then runs 513 additional real JS queries to prove the host ring
drops detail while honoring record and byte ceilings. Adversarial values are
seeded separately into row/mutation content and a trusted-local suggested
connection id: both are absent from the client cost inspection; row content is
absent from the original serialized authenticated host operation that supplies
`runtimeState` to the join, before overflow can evict its observations; and the
suggested id is absent from the server runtime-cost projection. The host
operation's preexisting LLP 0031 D3 gated connection-control inventory remains
outside this cost-record claim. A public `/inspect` pull contains neither
adversarial value and still has no runtime-cost field.

Posture uses the production composition path rather than raw-authority
installation: the managed development instance reports recorder-on; a direct
`snapback start` child with no operator flag reports recorder-off through
authenticated inspection; and
`hosted_adapter_authority_requires_the_consumed_loopback_listener` writes a
signed hosted-edge config/admission pair, passes it through production
`compose_hosted_edge_admission`, consumes the result through production
`with_hosted_edge_admission`, asserts recorder-off and the `Pending`
listener-binding state, successfully consumes the observed loopback listener,
and asserts recorder-off again on the shared bound instance. No export, upload,
hosted collection, stream, new protocol, or new public surface was added or
claimed.

Together with the already-closed owner fixtures named in `Depends on`, this
closes LLP 0267 §7.7 acceptance. The closure does not promote hosted telemetry,
does not make incomplete SQLite/JS physical zeros complete measurements, and
does not advance W6, the binary-size work, or the later R1/R2 program.

The affected Guide and diagnostic vocabulary are intact: 15 focused Guide
contract tests pass, and all three emitted multiplicity codes occur in each of
the committed diagnostic registry, Guide projection, and client code union.
The aggregate Guide/inventory checks remain inherited red on unrelated stale
generated registries and three absent demo/Contract artifacts. An untouched
`HEAD` archive reproduces both registry failures and all three missing paths,
so LLP 0232's baseline-proven inherited-red posture applies; this lane neither
regenerates nor claims those unrelated artifacts.
