# LLP 0102 deep-round independent evidence audit

**Audit base:** `c42feb25083fb3294a20e8c2d5755a5d257e9536`

**Mode:** read-only, isolated detached worktree on the MacBook fleet worker

**Date:** 2026-07-29
**Scope:** all 35 run capsules, Stage 0, freeze boundary, evidence paths,
cleanup, scenario totals, confidence totals, and Stop-class attribution

## Result

The independent worker reproduced the repository verifier result for all 35
capsules. Stage 0 and the freeze boundary also passed. The frozen app/provider
identities agree with LLP 0102, the 21 deep-arm scenario and confidence totals
agree with the central audit, and cleanup is 34 `complete` plus the disclosed
Research Room/InstantDB `explicit-gap`.

The stricter Draft 2020 schema pass found four capsule root properties that
the repository verifier incorrectly accepted:

- Linear/Convex and Linear/Snapback: `notes`;
- Partiful/Appwrite: `resultSummary`; and
- Research Room/Supabase: `builderIncidents`.

Evidence traversal checked 573 references. One was not a file:
Research Room/Convex used the sentinel
`not-applicable-fresh-local` as `targets.binding.baselineReceiptPath`.

The coordinator removed the four redundant root properties and represented
the absent Convex baseline with an empty path. The underlying facts remain in
the referenced receipts and central audit; no result, timing, confidence,
incident attribution, or cleanup claim changed. After correction, strict Ajv
and the repository verifier both pass all 35 capsules, and every nonempty
evidence, cleanup, and baseline path resolves.

This verifier/schema divergence is tracked in
`issues/20260729-bakeoff-capsule-verifier-schema-divergence.md`.

## Frozen matrix reproduced by the auditor

`P/F/G/U` means pass/fail/gap/unrun. `C` is evidence confidence out of 16.

| App | Snapback | Convex | Supabase | Firebase | InstantDB | SpacetimeDB | Appwrite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Todo | 10/1/3/0 C15 | 13/0/1/0 C16 | 11/0/3/0 C16 | 14/0/0/0 C16 | 14/0/0/0 C16 | 11/0/3/0 C16 | 11/0/3/0 C16 |
| Chat | 13/1/1/0 C15 | 12/0/3/0 C15 | 14/0/1/0 C14 | 15/0/0/0 C16 | 13/0/2/0 C14 | 13/0/2/0 C15 | 12/0/3/0 C16 |
| Linear | 10/0/4/0 C14 | 12/0/1/1 C14 | 12/0/2/0 C14 | 12/0/1/1 C16 | 12/0/2/0 C16 | 11/0/2/1 C14 | 12/0/1/1 C16 |
| Partiful | 12/0/3/0 C14 | 14/0/0/1 C14 | 14/0/0/1 C14 | 14/0/0/1 C15 | 9/0/6/0 C13 | 14/0/0/1 C15 | 14/0/0/1 C15 |
| Research Room | 1/12/2/0 C8 | 14/1/0/0 C14, 2 Stops | 15/0/0/0 C14 | 15/0/0/0 C15 | 11/0/4/0 C13 | 13/0/2/0 C15 | 14/0/1/0 C13 |

| Provider | P/F/G/U | Confidence | Provider Stops |
| --- | ---: | ---: | ---: |
| Snapback | 46/14/13/0 | 66/80 | 0 |
| Convex | 65/1/5/2 | 73/80 | 2 |
| Supabase | 66/0/6/1 | 72/80 | 0 |
| Firebase | 70/0/1/2 | 78/80 | 0 |
| InstantDB | 59/0/14/0 | 72/80 | 0 |
| SpacetimeDB | 62/0/9/2 | 75/80 | 0 |
| Appwrite | 63/0/8/2 | 76/80 | 0 |

## Stop-class adjudication

Research Room/Convex remains stopped and ineligible at the tested version.
The official local backend put a control credential in process argv and bound
its backend and site listeners to wildcard addresses. The worker's first
isolation proof also printed that argv into orchestration output. Both the
provider defect and builder evidence-handling defect were contained; the
credential was rotated, targets were removed, and only hashes and redacted
process facts remain.

Research Room/Supabase remains complete and eligible at 15/15. Its original
timed attempt stopped when ordinary CLI output contained generated local
credentials and a builder-authored redactor failed. That is a genuine builder
execution/evidence Stop, not a Supabase product defect. The capsule therefore
retains zero provider `stopDefects` while machine-linking the original
incident through `assistanceEvents`, the incident receipt, original partial
result, and clean untimed-extension lineage. The central audit preserves the
attribution and containment.

## Cleanup conclusions

No hidden residual was found. Research Room/InstantDB explicitly records its
remaining provider lifecycle limitation: empty namespaces, invalidated actor
tokens, no process/port/runtime residue, and an anonymous temporary shell
awaiting provider auto-expiry. Linear/SpacetimeDB does not receive credit for
its invalid describe command; deletion, port, and state evidence carry the
cleanup claim at reduced confidence.

## Reproduction

```sh
find demos/backend-bakeoff/arms -name run-capsule.v1.json -print0 |
while IFS= read -r -d "" capsule; do
  node demos/backend-bakeoff/scripts/run-capsule.mjs verify "$capsule" || exit 1
done

node demos/backend-bakeoff/scripts/verify-stage0.mjs
node demos/backend-bakeoff/scripts/freeze-boundary.mjs

npx --yes ajv-cli@5.0.0 validate \
  --spec=draft2020 \
  -s demos/backend-bakeoff/protocol/run-capsule.v1.schema.json \
  -d "demos/backend-bakeoff/arms/**/run-capsule.v1.json"
```
