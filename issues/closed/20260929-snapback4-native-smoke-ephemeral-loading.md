# Native smoke rejects the published ephemeral-query offline result

Status: Closed
Date: 2026-09-29
Systems: Snapback 4 native witness / generic smoke / published client 0.4.7
Related: LLP 3000.030 §11; LLP 3000.011.005.000 §2; LLP 3000.017

The real cal25 Clique app on Expo 57.0.22 / RN 0.86.3, using the published
`snapback4@0.4.7` client and native core, passes prime and renders eight held
messages after a cold offline launch. Generic smoke then fails on
`chat.typingInMyRooms(c: cursor ?)` with “returned neither ready nor an
explained refusal”. Its actual one-shot query result is `loading`.

This is reproducible in own-build A and the diagnostic repacks; it is not an
HBC, native module, routing, authentication or missing-history failure.
The published `dist/local-query.js` explicitly returns `loading` from
`recover()` for an ephemeral read when its server route is blocked offline.
The smoke helper requires every optional-argument query to return data or an
explained refusal. It correctly rejects loading under its current contract.
The source implementation has the same ephemeral recovery branch.

Evidence: `snapback4/reports/20260929-np-macos-slice/`, particularly
`a-ownbuild-1` raw receipts, run manifest, offline screenshot, and the retained
preparation inventory. No package/client behavior or smoke assertion was
changed to make this result pass. The witness-only native helper patch is
listed separately in the report.

Resolution needs the owning design decision: reconcile the generic smoke's
scope with the ephemeral read contract, or change one-shot client semantics
with appropriate client coverage. Do not skip this query, convert loading to
synthetic success, alter the app's schema to evade discovery, or count the
partial native runs as complete smoke. The NP macOS first slice remains
unqualified until the selected resolution and full A/B/restart experiment pass.


Resolution — 2026-09-29, NP-mac round 1: the supervisor ruled that generic
smoke uses compiler residency, not observed results. The driver supplies the
eligible query facts; device-answerable loading still fails. Server-only
reads record expected offline unavailability and the actual loading/refusal,
and must answer online in prime and restart. LLP 3000.011.005.000 §2 and the
witness card record the scope. Client semantics and the subject's published
client/native engine bytes are unchanged. Native completion evidence belongs
to `snapback4/reports/20260929-np-macos-slice/round1/REPORT.md`.
The separate caller-experience follow-up is
`issues/20260929-snapback4-server-only-query-offline-refusal.md`.
