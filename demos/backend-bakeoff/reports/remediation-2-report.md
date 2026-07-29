# LLP 0102 second Snapback remediation report

**Starting deep-round Snapback commit:** `5f31cb6174daaefa04a1e05242acbbc22c725040`

**Product repair commit:** `894ddaf99d4b7681499eec12ecbb3fc7a1a492e5`

**Final-confirmation Snapback freeze:** pending integration commit

**Frozen rerun:** Research Room

**Stop-class defects:** 0

## Result

The deep round found one high-severity Snapback defect: sessions complete-pair
preflight evaluated a static declared target while ordinary loading and served
inspection evaluated the exact process-live target. A Research Room artifact
requiring bounded streamed actions was therefore refused before bind even
though the same process had egress enabled and the runtime implemented the
capability.

The repair changes only that manifest composition seam and preserves
complete-pair, pre-effect, fail-closed startup:

| Arm | Deep round | Second-remediation confirmation |
| --- | --- | --- |
| Research Room / Snapback | 1 PASS / 2 GAP / 12 FAIL | **13 PASS / 2 GAP / 0 FAIL** |

The two unchanged GAPs are authenticated asset storage and provider-native
semantic/vector retrieval. The rerun did not disguise metadata rows as files
or substitute an application scan for an index.

## Accepted product repair

Sessions preflight now calls `CapabilityManifest::local_v0_instance` with the
same registered capability gaps and process-live outbound-action predicate
used by ordinary loading and inspection. An isolated two-child regression
proves both directions:

- an egress-enabled process admits the same sessions/stream artifact; and
- an egress-disabled process returns
  `SNAPBACK_CAPABILITY_UNSUPPORTED` before publication or auth-mode mutation.

The full external-copy confirmation then minted Alice, Bob, and Mallory
sessions and exercised authoritative progress to Bob's independent client,
outsider denial, citations, cancellation with zero late patches, stable retry
identity, five distinct settlement outcomes, cron, redacted config, 2+7
performance samples, and exact cleanup.

## Accepted Guide and diagnostic remediation

The Guide now:

- distinguishes generation-time and exact-process runtime
  `SNAPBACK_OUTBOUND_ACTIONS` admission and transcludes executable witnesses;
- states the 1,024 buffered-write ceiling and an honest idempotent
  keyset/checkpoint import pattern;
- records explicit capability-index GAPs for assets, notification delivery,
  and vector search; and
- states the one-generated-membership-command-per-mutation ceiling, atomic
  refusal, bootstrap expansion, and non-atomic idempotent multi-call pattern.

The assets/notifications, vector-search, codegen-egress, buffered-write, and
membership-cardinality Guide-gap tickets are resolved. The Guide, focused
codegen validation, and reference checker pass.

## New friction exposed by the repaired path

The pre-bind defect had masked the frozen setup's four membership commands in
one mutation. Runtime correctly refused them. The external copy decomposed the
same seed into four idempotent calls, and that adaptation remains explicit in
the receipt and diary. The Guide now prevents surprise, but generation-time
cardinality diagnosis remains a worthwhile product improvement.

The official `SnapbackClient.inspect()` also omitted the sessions protocol
offer. The confirmation used public `/inspect` with
`x-snapback-auth-client-protocol: 1`; sensitive
`/_snapback/api/inspect` correctly returned 401 without a secret-read lease.
The SDK issue is tracked separately rather than weakening operator authority.

The deterministic effect receiver's literal port also required an
external-copy source adaptation for parallel isolation. That reinforces the
existing typed local-configuration improvement item.

## Evidence

The additive confirmation bundle is under:

`demos/backend-bakeoff/arms/research-room/snapback/remediation-2-handoff/`

It retains a capsule-equivalent scenario map, before/after receipt, target
identity, exact inventory, performance samples, secret scan, UI screenshot,
cleanup plan and receipt, failed attempts/adaptations, verification transcript,
diary draft, and propose-only LLP audit. It does not overwrite the sealed deep
capsule or its original timing/friction record.

## Architectural conclusion after remediation

This defect does not demand a fundamental approach change. The repaired
system's strongest outcomes—server-derived authority, exact settlement,
effect certainty, cancellation fencing, native push, and one light local
target—compose successfully in the hardest app.

That is not the same as being the best holistic backend today. Snapback still
lacks important product surfaces and an ordinary complete hosted/external
package path. A fundamental rethink becomes warranted if clean external and
hosted deployment cannot preserve the authority/settlement model, if the
portable storage model prevents ordinary indexed retrieval and asset
lifecycle, or if cross-feature manifest drift keeps recurring after the
served-manifest construction is centralized. Current evidence supports
consolidation and breadth work before an architectural replacement.
