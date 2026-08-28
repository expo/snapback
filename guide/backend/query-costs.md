---
title: Query costs and runtime attribution
id: backend.query-costs
order: 2
audience: agent-first
capabilities: [operating.runtime-cost-diagnostics]
authorities: [llp/0267-query-cost-guardrails.rfc.md, llp/0031-server-route-taxonomy.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0095-client-lifecycle-and-conformance.spec.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0200-live-evaluation-scheduling-and-settlement.spec.md, crates/snapback-engine/src/local/runtime_cost.rs, crates/snapback-engine/src/local/engine.rs, crates/snapback-kernel/src/storage.rs, crates/snapback-engine/src/local/tests/engine.rs, crates/snapback-server/src/admin.rs, packages/snapback-client/index.mjs, packages/snapback-client/package.test.mjs, packages/snapback-client/runtime-cost-diagnostics.mjs, packages/snapback-client/runtime-cost-diagnostics.test.mjs, packages/snapback-cli/familiar-dev-loop.test.mjs]
examples: [packages/snapback-client/package.test.mjs, packages/snapback-client/runtime-cost-diagnostics.test.mjs, packages/snapback-cli/familiar-dev-loop.test.mjs]
status: current
targets: [local]
maturity: shipped
since: 0.1.27
reviewed: 2026-08-27
reviewed-authorities-digest: sha256:0ef57f1c87b477ec70a4b4fffe46d431ad76fd8f7292966cd38b68dfe215b075
---

# Query costs and runtime attribution

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use the runtime-cost snapshot when a mutation appears stuck, a live projection
does not advance, a query examines surprising work, or a framework-owned hook
multiplies equivalent work. It joins existing client and server inspection
facts; it is not a telemetry or profiling stream.

> **If you searched for a causal join:** a production tool needs a “single trace that connects the hook, current authority generation, mutation admission, server commit, invalidation publication, and subscriber revision.”
> This route applies to clients generated from both Explicit and Familiar authoring.
> Use `joinPendingDeliveryInspectionV1` below
> to join one current subscription to its server registry row and delivery
> wave. It does not join the originating mutation to its committed version, and
> it is not one backend-spanning causal receipt. Do not mistake that missing
> correlation for evidence that nonce churn, polling, skip cycles, revision
> rows, presence, reloads, or snapshot mutations are the next diagnostic step.

## Pull one local snapshot

Managed `snapback dev` enables the bounded recorder for its child server. A
direct `snapback start` leaves it off unless the operator starts that one local
instance with `SNAPBACK_RUNTIME_COST_RECORDER=1`. Pull the snapshot through the
existing authenticated host-operation path:

```sh
snapback inspect --ready-file .snapback/dev.ready.json > /tmp/snapback-inspect.json
jq '.data.runtimeState.runtimeCost' /tmp/snapback-inspect.json
```

The authenticated `GET /_snapback/api/inspect` twin carries the same
`runtimeCost` member at its root. Use the CLI when possible so the ready-file
credential and live process identity are checked together. Do not use public
`GET /inspect`: its exhaustive `PublicInspect` projection intentionally has no
runtime-cost field.

One pull returns these bounded, process-local families:

| Member | What it attributes |
| --- | --- |
| `mutationPhases.records` | queue, authorization, execution, and commit timing for recent mutations |
| `queryObservations.records` | result size, evaluation time, and available physical-access evidence |
| `liveDeliveryWaves.records` | rerun cause, covered versions, evaluations, memo deliveries, frames, and fan-out |
| `serverMutationPhaseCounters` | exact per-function phase totals, with evicted keys folded into `otherKeys` |
| `subscriptionRegistry` | the exact current owed/evaluating/queued state used by the client/server join |

Every ring reports its record and byte capacities plus `droppedRecords`.
Query consultation detail is sampled; read `complete` first and
`consultationsTruncated` before treating either the scalar physical totals or
the sample as exhaustive.

The current SQLite producer retains result rows/bytes and evaluation timing,
plus a best-effort physical summary when one range is representable, but marks
every such record `complete: false`. One planner summary cannot honestly encode
multi-seek `IN`, order-only index use, or every composed/specialized access, so
those physical facts are omitted rather than guessed. A JavaScript or graph
handler can therefore show positive `resultRows` with `scannedRows: 0`,
`indexRangeCount: 0`, and no consultations: those zeros mean **unmeasured**,
not zero database work. `complete: true` remains reserved for a future exact
physical consultation ledger.

## Attribute a delayed foreground send

Do not tune a retry delay first. Read the mutation in two stages:

1. While it is pending, call `await client.outboxStatus()`. `drainPhase` says
   what the drain loop is doing; `blockedReason` names the typed barrier, such
   as `auth-barrier`, `custody-unsettled`, `not-writer`, or an
   `authority-unavailable:*` reason.
2. After settlement, read
   `client.localResourceInspection().mutationPhaseCosts.records`. Match the
   stable pseudonymous `clientMutationId`, then compare `queueWaitMs`,
   `authWaitMs`, `executionMs`, and `commitMs`.

If `queueWaitMs` dominates, work waited before dispatch. If `authWaitMs`
dominates, authorization admission was the delay. Large `executionMs` or
`commitMs` puts the delay after authorization. Null means the record did not
observe both endpoints; it does not mean zero. This attribution uses recorded
stage boundaries and needs neither source inspection nor a guessed timeout.

## Attribute a stalled live projection

Capture the client snapshot with `client.localResourceInspection()` and the
server snapshot with `snapback inspect`, close enough together to describe the
same episode. Pass those two objects to
`joinPendingDeliveryInspectionV1(clientSnapshot, serverRuntimeState)`. The
join reads `serverRuntimeState.runtimeCost.subscriptionRegistry`, follows the
row's `currentWaveSeq` or `lastDeliveredWaveSeq` into
`runtimeCost.liveDeliveryWaves.records`, and derives one result per
subscription.

Read the derived result in this order:

1. `outcome: "snapshot-skew"` means the two pull snapshots straddled a
   lifecycle transition. Pull both again and pass the prior joined result as
   `{ previous }`; persistent same-direction skew becomes a defect.
2. A non-null `pendingDeliveryReason` is the first matching closed reason:
   `terminal-quarantine`, `auth-barrier`, `custody-unsettled`,
   `authority-unavailable`, `transport-recovery`, or `server-pending`.
3. For `server-pending`, inspect `serverRegistry.owedThroughVersion`,
   `evaluation`, `pendingWork`, and `currentWaveSeq`. `evaluating` together
   with `queued` or `coalescing` is a valid composite: a newer invalidation
   arrived while the current cut was evaluating.
4. Inspect the joined `wave.rerunCause`, `coveredVersions`,
   `distinctEvaluationGroups`, `realEvaluations`, `memoDeliveries`, and
   `deliveredFrames`. A covered revision with value-equal suppression is
   attribution evidence, not a missing delivery.

Two subscriptions to the same function and delivered version remain distinct:
the join keys by framework-minted subscription id and only then by the exact
wave sequence. A sibling subscription can therefore be neutral while another
is owed without guessing from function name or retry timing.

## Find framework-owned multiplicity

`client.localResourceInspection().runtimeCostDiagnostics` contains warnings
for repeated equivalent enqueues, duplicate live subscriptions owned by
different framework labels, and repeated asset issuance. These are local,
warning-only facts. Owner labels identify framework components or hooks; they
must not contain arguments, row values, principals, or caller-provided labels.

Use the multiplicity fact to consolidate ownership at the provider or hook
boundary. Do not silence the warning by raising an unrelated query bound, and
do not infer that two requests with different canonical fingerprints are
equivalent.

## Redaction, bounds, and posture

Snapshots omit arguments, row contents and ids, principals, tokens, literal
endpoints, and `fixtureIdentity`. Caller-influenced mutation and trusted-local
connection identities appear only as stable `sha256:` inspection pseudonyms.
The retained records are count- and byte-bounded; exact counter maps cap keys
and fold evictions into `otherKeys` with `evictedKeys` visible.

The recorder-off branch retains nothing. Direct and hosted serving are off by
default; an operator may explicitly enable the same instance-local gated
inspection on a hosted process, but v1 provides no export, upload, hosted
collection, or cost-record streaming protocol. A pull from a gated instance is
not evidence of a hosted telemetry capability.

## Anti-patterns

- Do not scrape logs or sleep until a retry happens; use the typed stage and
  pending-delivery vocabularies.
- Do not copy `runtimeCost` into anonymous inspect, application responses, or
  a new telemetry stream.
- Do not treat an incomplete query observation as a complete zero-work proof.
- Do not join live work by function and version; subscription id plus
  `waveSeq` is the collision-free path.
- Do not put application values into owner labels or caller-suggested ids and
  assume a gated surface makes them safe.
