# Snapback 4: Grok reports missing like-list results; reduced server-watch control passes

**Status:** Closed
**Priority:** P3
**Date:** 2026-09-14
**Systems:** online and local client observations, query routing, residency, Clique
**Author:** Codex / GPT-6 Astra
**Resolution:** Closed as a retained non-reproduction; exact published-package controls contradict the proposed runtime attribution.

Observed package version: published `snapback4@0.2.10`; Grok re-signed its lane binary
Evidence status: received builder report; reduced independent control does not reproduce

## Received observation

The in-flight 0.2.10 Clique Grok builder records correction loop 8 as
`snapback-defect`: an online-only count and an unsynced likes table yielded
what its log calls “likesOf horizon none.” It reports adding
`sync public last 2000 by byTime` to likes and reposts as the workaround.
The query is a plain public prefix: `likes[postId] first 200 by byPost`.
The inspected UI uses `useQuery(api.likesOf, ...)` and also contains a
manual repeated-query fallback.

The previous completed M2 choreography attempt passed 5/9 checks; a later
attempt passed 9/9. Several app fixes happened between them, including an
unrelated private daily-activity counter being made public after `E_RULE`.
Those two receipt outcomes alone do not isolate the sync change's effect.
The counter correction has the builder's `agent-error` attribution and is
not this ticket's claimed product defect.

## Contract and independent counterexample

[LLP 3000.007 §6.2](../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#6.2)
and the published README specify that an online-only read runs on the server.
An observed server-run query refreshes when a commit touches its tables;
`online only` on a maintain opts out of inherited sync. Lack of sync is
therefore not, by itself, an explanation for missing online results.

A fresh, isolated process-device probe at the unmodified published 0.2.10
pin used an online-only public likes table, an online-only count maintain,
and the same prefix-query shape. Results:

- Both query operations compile as `runs: server`.
- The likes watch initially answers an empty array, then refreshes to one
  row after a separate persona commits a like, without an explicit refresh.
- The count query answers 1. Neither query enters the device interpreter.
- No sync line or manual polling was added; the client and owned server
  were closed after the probe.

This control does **not** reproduce the reported full-app symptom. Keep the
builder's label as received evidence, with technical attribution unresolved.
Do not turn the reported workaround into guidance that every online-only
like list must sync. No runtime or guide change is justified by this
control alone.

### 2026-09-14 — completed builder and online-client control

The builder ended at 16:47:32 UTC. Its final report numbers this observation
as loop 10, while the chronological run log calls it loop 8; retain both
identities. The final web application uses `createClient`, with no local
replica. Its essay generalizes the workaround to “No sync, no tick.” That
generalization is not established by the app observation.

A second isolated control at the same unmodified published 0.2.10 pin used
the online `createClient` directly, with the same unsynced likes table and
online-only maintain. `observe(likesOf)` changed from an empty, complete
answer to one complete row after Bob's separate HTTP mutation; `countOf`
answered 1. There was no device, sync declaration, manual query polling,
or explicit refresh. The client and owned server closed afterward.
This passes on the client tier the builder actually shipped, while leaving
the full-app symptom unresolved.

Evidence: `~/projects/snapback-lanebriefs/online-client-likes-probe-20260914/`
contains `probe.mjs`, `snapback/schema.q`, `check.txt`, `result.json`
(16:54:36 UTC), and `server.log`. The builder's final narratives and source
hashes are now captured before grading/M7 at
`~/projects/snapback-lanebriefs/cell-custody-0.2.10/grok/builder/`; selected
source and final receipts are copied in `builder-supplement/` beside it.

## Next investigation

After the frozen run, reduce the original app state with its generated and
copied API metadata, backend adoption/restarts, query/watch lifecycle, and
pending outbox state retained. Identify the actual failing answer and route
before changing sync, then change one input at a time. Compare the ordinary
React observation with the manual repeated-query fallback. A final builder
report or independent grade may clarify or supersede this interim account.

## Evidence

Packet: `~/clique-sb4-20260913-relaxed-3models/lanes/grok-snapback4/`:

- `run-log.md`, correction loops 8 and 9, followed by the M2 green receipt
  timestamp `2026-09-14T15:34:33.853Z`.
- `snapback/schema.q`: likes/reposts tables, online-only count maintains,
  `likesOf`, `repostsOf`, `dailyActivity`, and `bumpDailyLikes`.
- `src/FeedItem.tsx` and `src/api.generated.ts`: query observation, repeated
  query fallback, and copied operation facts. These are still live builder
  files; the final record must bind their retained source state.
- Original public builder stream is `logs/grok-snapback4.ndjson` at the
  packet root. No specific pre-workaround diagnostic file is named in the
  current loop-8 entry; the report alone cannot establish its exact result.

Orchestrator records, outside the frozen packet:

- `~/projects/snapback-lanebriefs/online-likes-probe-20260914/`: `probe.mjs`,
  `snapback/schema.q`, `check.txt`, `result.json`, and `server.log`. The probe
  uses the unmodified 0.2.10 client/binary from ceremony third run 1, a fresh
  OS-assigned server port, and a separate process-device store.
- `cell-custody-0.2.10/grok/observed-attempts/20260914T145648Z/m2.jsonl`
  retains the earlier 5/9 attempt; `20260914T153608Z/m2.jsonl` retains 9/9.
- `grok-signature-observation-20260914.json`: the builder changed the
  executable signature; all 17 Mach-O section payloads and the payload
  between load commands and signature match the published control. This
  does not make the re-signed binary byte-identical to the npm artifact.

Fetched origin/main and searched Snapback 4 issues, the governing RFC
(including §18), and recent commits before filing. No duplicate report was
found. CU1–CU5 cover different observations; their work was not modified.

## Resolution — 2026-09-14

Closed as a retained non-reproduction, not as a product-code fix. Two exact
published-0.2.10 controls cover both client routes implicated by the report:
the process-device route and the online `createClient` route. In each control,
an unsynced public likes prefix changed from an empty result to the committed
row, and the online-only count returned one. Neither control added a sync
declaration, manual polling, or an explicit refresh.

The original pre-workaround failing result was not retained, while the full
application changed several independent inputs between its red and green M2
receipts. That evidence cannot isolate a Snapback defect or justify changing
runtime routing or teaching “No sync, no tick.” The builder report, exact
controls, source custody, and the unresolved attribution remain preserved
above. Reopen only with a reproducible failing answer and route on a named
source/package identity.
