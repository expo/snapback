# Round-2 baseline: the round-1 Snapback measurements

Frozen 2026-08-01 from diaries 0048 (faceplate), 0049 (party-wall), and
0048-clip-locker before any round-2 builder ran. Round 2 reruns the
Snapback arms only, with fresh-context builders, against the same frozen
checklists; competitor round-1 measurements stand. Deltas are judged
against the numbers below.

Round-1 surface, all three arms: workspace packages + sessions-mode
server booted from this repo (Clip Locker via the `cargo run` rung,
26.3 s boot). Round-2 builders record their surface; a 0.1.8-vs-workspace
difference is a disclosed confound, not a hidden one.

## App A — Faceplate (round 1: PASS 8/8)

| Measure | Round 1 |
| --- | --- |
| Wall-clock (empty → check 2) | ~40 min authoring, ~half lost to frictions |
| First serve (check 2) | 199 ms (two fresh sessions → served bytes; local debug build) |
| Ceremony | 6 concepts (table, assetRef field, assetSharing, upload intent, attach-in-mutation, sessions auth); 3 authored files → codegen → server → client task |
| GPS (check 4) | stripped, zero thought (mandatory intent policy) |
| Replace (checks 5/6) | old avatar 403s other users on the next request (transactional revocation) |
| Signed-out (check 7) | 400 protocol-header demand (strict deliberately non-pasteable) |

Frictions (4): (F1) hand-guessed raw delivery URLs 404 — `deliveryUrl()`
is the paved path (guide covered it; author error); (F2) protocol-header
demand precedes auth consideration — surprising order, good message
(measurement, not defect); (F3) one conformance-suite reading to learn
the result envelope + client-side arg validation; (F4) hand-rolled JPEG
fixture refused by the decoder (hostile-input posture working as
designed).

## App B — Party Wall (round 1: PASS 8/8)

| Measure | Round 1 |
| --- | --- |
| Live burst | 5 posts as WS `live_replace` in 20–22 ms; thumb readiness via `_snapback.assetRecord`; zero polls |
| Revocation | feed blanked in 18 ms (witnessed lane) AND bytes 403 next request |
| Delete | 18 ms from feed; bytes 403 immediately; reference-GC after 61 s grace |
| GPS | stripped on served thumb |
| Backend authorship | copied verbatim from demos/party-wall (disclosed — round 1 measured nothing about authoring this backend fresh) |

Frictions: none new; two App-A repeats (session userId lives at
`credential.session.userId` — first guess wrong; raw delivery-URL
guessing). Round 2 note: a fresh builder authoring the backend from the
guide measures what round 1's verbatim copy could not.

## App C — Clip Locker (round 1: PASS 9/9, one real defect)

| Measure | Round 1 |
| --- | --- |
| Boot | 26.3 s (codegen → server → session mint) |
| Ceremony | 1 table, 1 intent, 2 mutations |
| 120 MB kill-at-58.7 MB → resume | **0 bytes re-transmitted**; 17.4 s transfer wall; 58 PATCHes |
| Integrity | end-to-end-verified; served digest == source |
| Ranges | real 206 incl. suffix; `no-store, private` on signed lane |
| Share link | headerless GET 200 → 401 after TTL → 404 after delete |
| Deletion truth | referenced delete 409 → clear → 200, dead at origin |
| GPS (video) | ©xyz location gone from served bytes (digest changed) |

Frictions (4): (F1) **the defect** — policy gate's 2 MiB inspection
ceiling 413'd the client's own 4 MiB default chunks
(`SNAPBACK_VALUE_TOO_LARGE`); worked around at 2 MiB chunks; since fixed
(`60a83597`) with conformance Vector 1c — round 2's flagship question is
whether default config now just works; (F2) the same defect surfaced
intermittently as bare `fetch failed` vs the clean 413 (stream race);
(F3) `ctx.db.update` is not a function at runtime — spelling is
`ctx.db.patch`; the fix-wave chain validation covered `ctx.db.query`
chains, not unknown `ctx.db` members — expected to persist, round 2
verifies; (F4) handler ceremony (`writes:`, separate handlers.mjs,
`source`/`exportName` indirection) heavier than the intent declaration.

## Fixes landed between rounds (what round 2 measures the effect of)

Chunk-ceiling fix + limits preflight (client narrows chunks to declared
max); guide additions (sessions recipes incl. persona minting, queries
builder chain, inline-handler subset, authoring loop, images flow);
digest + integrity grade on record/inspect; anonymous-public custody;
schema-module definition refusals; `ctx.refuse`; myMemberships; 0100
keyset pages + removePrincipal; per-VM strict context; server ThumbHash
in record views; pasteable public/signed delivery lanes.
