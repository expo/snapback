# Diary 0035: Cursor Garden current-main rerun

**Application:** shared garden note plus high-frequency pointer/selection
presence on Snapback and Convex
**Rerun:** 2026-07-30
**Snapback revision:** `01e941730306973aadaf21cd50b4c1613d171075`
**Systems:** Snapback, Convex, ephemeral state, live queries, code generation,
Ibex/Hermes runtime, acceptance
**Related:** Diary 0026; LLP 0013;
`/Users/ccheever/projects/snapback-workout-matrix-20260729/apps/04-cursor-garden`

## Why rerun

The first Cursor Garden workout already showed a meaningful semantic
difference: Snapback had typed process-local latest-state presence, while the
Convex control implemented presence as durable heartbeat rows. The old
Snapback test, however, exercised lower-level publish plumbing and recorded a
generated provider-introspection warning. Its binary also did not match the
source checkout.

This rerun keeps the application and Convex contract unchanged while asking
whether current main provides a paved end-to-end ephemeral client:

- subscribe with the default managed stream;
- publish through the returned `EphemeralOverlay`;
- receive the latest sample after a burst;
- prove that the durable version does not move; and
- remove connection-owned state on disconnect.

The final report also makes the scope explicit: it claims local
process-resident presence, not hosted or multi-instance presence.

## Orientation and guide experience

I loaded the guide index, capability index, ephemeral-state page, cursor
presence recipe, and acceptance page, then oriented through the root LLP and
LLP 0013. The current guide was effective. It clearly separates durable state
from TTL-bounded latest state, identifies connection ownership as the
appropriate key for cursor presence, and documents the managed stream and
overlay publish path used here.

No guide gap was found. The remaining issues are runtime preparation and
product scope, not missing authoring instructions.

## Current-main Snapback arm

The Snapback model is still one syncable `gardens` table, one durable live
query, one mutation, and one `gardenPresence` ephemeral collection. The
collection declares:

- `gardenId` scope/routing;
- connection ownership;
- 2-second default and 5-second maximum TTL;
- 768-byte maximum values;
- 30 Hz sustained / 60 burst publish budget; and
- latest-state delivery at a 20 ms dispatch cadence.

The acceptance test now creates observer and publisher overlays with
`subscribeEphemeral`. The publisher sends all 24 samples with
`publisher.publish(...)`; there is no direct raw ephemeral request and no
app-authored read pump. `overlay.drain()` establishes the observation
boundary.

Code generation:

```text
tables 1; operations 2 (live query 1, mutation 1); ephemeral 1
files 22 (review manifest 1, consumer committed 0, ignored cache 21)
warnings 0
inputsHash 677130e8d60e…
```

There is still advice that `updateNote` could declare a complete mutation
result, but the earlier ephemeral provider-introspection warning is gone.

## Runtime and bootstrap evidence

The first sequential acceptance attempt failed the JS-backed seed query and
durable live query with:

```text
SNAPBACK_RUNTIME_CREATE_FAILED: Ibex runtime could not be created
```

The Rust-native ephemeral checks still passed 4/6 in that run. This was useful
diagnostic evidence but not an acceptable final result: it showed that
ephemeral transport could operate while application JS runtime creation was
broken.

`scripts/ibex-doctor` reported the native artifacts present. The vendored
framework digest nevertheless differed from the prepared sibling artifact.
Running the required `scripts/bootstrap-ibex-runtime` refreshed the framework
and passed exact link/launch smoke, but an immediate app run could still
refuse startup. The matrix-wide investigation captured the deeper diagnostic:

```text
Armed startup refused: Hermes promise rejection checkpoint tracking is unavailable
```

The final repair was ordering-sensitive: after the framework refresh, the
paved bootstrap had to relink the binary again. The final framework SHA-256
was:

```text
7c3dd1a82c329c187d57939071dbffb8fa699518559a32019f17077a4413bfb6
```

With the final artifact and binary coherently linked, the exact same Cursor
Garden suite passed **6/6**:

1. generated artifacts and deterministic garden seed loaded;
2. the generated presence descriptor carried routing and publish budgets;
3. client B observed client A's durable note update at version 2;
4. the observer received sample 23 and selection `blue-corner`;
5. the durable version stayed exactly 2 across 24 publishes; and
6. disconnect removed the publisher's connection-owned entry.

The report explicitly records:

```text
defaultEphemeralTransport: stream
hostedPresenceClaimed: false
multiInstancePresenceClaimed: false
```

This is positive local-backend evidence, not a hosted fanout claim.

## Convex control

The Convex source and contract were preserved. It still uses a
`presenceHeartbeats` table indexed by garden and participant, patches or
inserts one durable row per publish, filters TTL at query time, and deletes the
row on explicit leave.

The owned anonymous-local wrapper ran sequentially and passed **5/5**:

- deterministic generated-binding reset/seed;
- WebSocket delivery of the durable note update;
- sample 23 and `blue-corner` after the burst;
- positive proof that presence changed durable storage; and
- explicit deletion of the heartbeat row.

Direct strict TypeScript checking of `convex/garden.ts` and
`convex/schema.ts` also passed. The wrapper stopped its port-3210 backend after
the test.

## What felt good

- `subscribeEphemeral` now returns the useful unit of work for both sides:
  managed incoming state plus `EphemeralOverlay.publish`.
- The default stream requires no consumer-authored loop.
- Schema-level budgets, TTL, routing, value shape, and ownership remain more
  expressive than the Convex heartbeat approximation.
- Non-amplification is easy to prove from the durable storage version.
- Generated bindings now include the publish-rate budget and codegen reports
  zero warnings.
- Disconnect cleanup follows transport-owned identity rather than trusting an
  app participant string.

## What felt bad or surprising

- The native runtime could pass link/launch preparation while refusing its
  first application JS VM. A real handler-creation smoke is still missing.
- Repair depended on framework-refresh/bootstrap ordering. Exact commit
  stamping alone was not sufficient evidence of a coherent binary/framework
  pair.
- External apps still import Snapback authoring, client, and test modules from
  absolute checkout paths.
- `updateNote` still has a degraded/omitted result contract.
- The strongest presence semantics remain process-local. The app must not
  imply hosted or multi-instance fanout.

## Size and comparison

Measured over authored source/seed/acceptance files, excluding generated
caches, reports, locks, and tool configuration:

| Arm | Authored | Generated |
| --- | ---: | ---: |
| Snapback | 229 lines / 7,825 bytes | 22 files, 2,015 lines / 62,985 bytes |
| Convex | 302 lines / 10,648 bytes | 5 files, 368 lines / 12,444 bytes |

Snapback is smaller in authored code because the product capability matches the
problem. Convex remains much smaller in generated surface. Convex's durable
heartbeat approach is functional but writes the database at cursor rate and
needs app-authored expiry/deletion policy; Snapback's collection preserves the
intended transient semantics directly.

## Verdict and priorities

Current main materially improves Cursor Garden. The paved overlay API and
managed stream remove lower-level transport work, codegen describes the
publish budget without warnings, and the final exact-main run proves
non-amplifying connection-owned presence.

The highest-value improvements exposed here are:

1. make bootstrap instantiate and execute a minimal application handler after
   the final framework refresh;
2. make the doctor detect binary/framework ordering or capability mismatch;
3. publish an installable external-app package path;
4. require or make easy a precise mutation result for `updateNote`; and
5. retain the explicit local-only/multi-instance nonclaim until deployment
   evidence expands it.
