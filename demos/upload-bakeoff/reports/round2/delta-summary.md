# Round 2 delta summary — did the fixes help?

**Verdict: yes, measurably and across the board.** Eight of the ten
round-1 Snapback frictions are gone, each traceable to a named fix; one
was not exercised this round (ticketed rather than assumed fixed); one
persists by design and is accepted. All 25 checklist items across the
three apps passed, built by fresh-context agents from the guide alone —
the strongest condition available, since round 1's builders carried
full repository context and round 2's carried none. The flagship
defect answer is unambiguous: round 1 could not upload a 120 MB file
at default configuration; round 2's builder, forbidden from tuning,
went 9/9 with untouched defaults.

## Numbers

| App | Checklist | Wall-clock R1 → R2 | R1 frictions → gone | New (disposition) |
| --- | --- | --- | --- | --- |
| Faceplate | 8/8 | ~40 min → **10m30s (~4×)** | 4 → **4 gone** | 1 environmental (good recovery) + 2 builder variance |
| Party Wall | 8/8 **first driver attempt** | R1 copied its backend from the demo; R2 authored it fresh from the guide in ~10 min | 2 → **2 gone** | 5 → 4 guide-fixed inline, 1 docs ticket |
| Clip Locker | 9/9, defaults untouched | defect-blocked (manual chunk tuning) → **13m08s clean** | 4 → 2 gone, 1 not exercised (ticketed), 1 by-design | 5 → 2 guide-fixed, 1 client fix landed, 2 tickets |

Friction ledger, precise: **10 round-1 frictions → 8 GONE** (URL
guessing ×2, persona-path spelunking, protocol-header surprise,
conformance-envelope spelunking, fixture refusal, the chunk-ceiling
defect `60a83597`, the stream-race noise that died with it), **1 not
exercised** (`ctx.db` member validation — real by inspection, ticketed:
`20260801-codegen-ctx-db-member-validation.md`), **1 persists by
design** (handler ceremony; recorded without complaint by the fresh
builder).

Fix attributions: the docs sweeps (sessions recipes, persona minting,
queries chain, authoring loop) killed the discovery-class frictions;
the chunk-ceiling fix + limits preflight killed the defect class; the
GPS instrument and paved `deliveryUrl()` killed the fixture/URL class.

Quality signals beyond pass/fail: Party Wall's live propagation
measured 14–48 ms with zero polls (no regression from round 1's
18–22 ms, under fresh authorship); Clip Locker's resume re-transmitted
exactly the unacknowledged remainder (57,297,955 of 120,212,515
bytes); every integrity grade came back `end-to-end-verified`.

## New frictions found this round (the harvest)

Ten new stumbles across three builders; dispositions: **6 guide fixes
landed inline** (the `createAssetClient` surface correction, the
one-boot provisioning form, burst dedup + attach-before-ready, the
witnessed-lane `meta.kind` vocabulary, the stale video-strip claim,
tombstone semantics + boot-tax notes), **1 client fix landed** (the
string-intent form that could never satisfy the server's admission DTO
now refuses client-side naming the generated reference), **3 tickets**
(`20260801-0044-video-location-policy-under-image-block` — author
naming call; `20260801-codegen-ctx-db-member-validation`;
`20260801-guide-gap-signed-out-byte-fetch-is-400`).

## Confounds, disclosed

Same package surface both rounds (workspace + `cargo run` rung, not
the published 0.1.8) — like-for-like, but external-consumer truth
still needs a 0.1.8-closure round. Builder variance (single builder
per arm per round). Fresh-vs-experienced authorship cuts the strong
way this round: fresh builders with no context beat experienced ones
that had it. The dirty-checkout provenance skip taxed every boot ~29 s
(documented now; working as designed). Ceremony counts are not
comparable across rounds (R1 counted coarse concepts, R2 fine ones) —
flagged as a measurement note; the ceremony-floor amendment (bare
`v.assetRef()` default intents, landed after these builds) is the next
round's measurement target.
