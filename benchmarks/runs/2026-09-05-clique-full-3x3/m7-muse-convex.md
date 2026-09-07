# M7 final report — muse-clique-convex

- start: 1788748804
- end: 1788774587
- wall: 25783s (~7.2h from first line to shutdown; includes long background backend uptime between turns)
- status: green
- backend: convex-1.45.0 (local, cloud 49811, site 49812, web 49800)

## Pre-M7 schema count structure

The pre-M7 schema carried NO stored count structure (`convex/schema.ts`
had no count field on chats). A computed `messageCount` query already
existed in `convex/chats.ts` (excluding deleted/expired). M7 added the
stored `chats.messageCount` field, backfilled it, and maintains it
forward; the query remains as the exact read path used to verify the
stored field.

## Suite results (`npm run acceptance -- --milestone m7`, 7/7 green)

- m7-a01 poll-create-validated: pass (shape rejects + idempotent choreography poll provision)
- m7-a03 vote-change-adjusts: pass (A->B switch adjusts, total stays exact)
- m7-a04 vote-intent-idempotent: pass (retried intent deduped, same-option no-op)
- m7-a06 counts-backfilled-exact: pass (stored===exact everywhere; live tombstone + live expiry exclusion)
- m7-a07 counts-maintained-forward: pass (0,1,2,3,2 across text/poll/media/delete; rendered in settings)
- m7-a09 prior-suites-still-pass: pass (m1 m2 m3 m4 m5 m6 m8 all re-ran green live)
- seed-idempotent: pass
- receipt: receipts/acceptance-m7.json

## Choreography (`choreography.mjs m7`, sole segment)

- m7-a02-live-poll-tallies: passed (attempts 1,2,3 all pass)
- m7-a05-offline-vote-reconciles: passed (attempt 1)
- segment green, twice: first run and re-run on the exact final state
- receipt: receipts/choreo-m7.jsonl; suite-status.json reflects the m7-only run

## Snapshot comparison (m7-a08 evidence)

- pre: m7/pre-snapshot/ (8 personas, manifest with hashes, exported over the M6 field manifest via the custom-client API)
- post: m7/post-snapshot/; compare via scripts/m7-compare.mjs
- result: 48/48 pre-existing message views intact, 0 field diffs, 0 receipt regressions, 0 media diffs; 9 receipt advancements (sent->delivered/read from legitimate client views); new chats/messages are M7 suite/demo/choreo additions

## Previously green suites

M1-M6 and M8 were green per the inherited run-log; all seven re-ran
green inside m7-a09 on the migrated backend (see receipt). No prior
failures existed, none were repaired.

## Correction loops (attribution + evidence)

1. agent-error — demo polluted the starter group (page-scoped choreo total requires exactly one poll there); fixed with dedicated demo groups + `/api/group`, residue removed, counts refreshed. Evidence: admin.counts/history before/after in run-log.
2. agent-error — UI hid poll deletion with poll editing; caught by the throwaway browser probe's failing cleanup step; conditions split, probe re-run fully green. Evidence: probe log + lib/Conversation.tsx:916.
3. environment — orphan probe poll outlived the shortened 120s delete window; tombstoned via the app's own production profile, restored to shortened. Evidence: history/messageCount before/after.
4. environment/pre-existing — app `tsc` reports one error in untouched render checks (react-dom/server types); unrelated to M7, left alone.

No convex-defect loops (backend deployed cleanly first try). No capability failures.

## Gap list (candid)

- Two tombstoned probe polls remain visible as tombstones in the starter group history (excluded from counts and the poll surface; verified harmless by the final choreo green). They cannot be removed through the app API under the shortened delete window.
- The profile was briefly switched to production for that cleanup; the digest tick may have written additive production-period digest rows. No M7 assertion reads them.
- UI poll creation/deletion is proven by a throwaway probe (/tmp, not shipped), not by a committed test; committed render checks cover the kit components and the API path is suite-tested.
- Stored counts converge for expiry within one 15s digest tick rather than instantly; exact at every read via the query path.
