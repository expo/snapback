# snapback2: a non-disclosing `insertIfAbsent` write (deferred from LLP 1010)

**Opened:** 2026-09-03
**Systems:** `snapback2-core` (engine, certificate, outcome vocabulary),
`packages/evaluator`, `packages/compiler` (Quarry lowering), the guide
**Related:** LLP 1010 §0 and §9 (D-F), LLP 0329.014.004 §2.1-C (`insertSoft`
per-row outcomes) and §2.5 of LLP 0329.014.010 (`insertIfAbsent`/get-or-create
restored), `packages/compiler/lib.d.ts:70` (`db.upsert` is `void`)

## What

The get-or-create idiom in every template is read, branch, insert:
`templates/chat/snapback/profiles.q:7–12` (`createMyProfile`),
`follows.q:1–10` (`setFollow`), and `fixtures/quarry-clique/snapback/social.q`
(`toggleRepost`'s `match`). The design has an `insertIfAbsent` that returns an
outcome without disclosing the conflicting row.

## Why it was deferred

Both panel families and the author agreed in LLP 1010's round 2 (D-F): the idiom
is race-safe today — the store is exclusive-single-writer, each mutation runs in
one transaction, and the point read is in the authoritative trace
(`engine/mod.rs`, `AuthoritativeTrace.absences`) — so the defect is boilerplate,
not correctness. A proper non-disclosing primitive cannot merely lower through a
visible `db.get`: an unreadable conflicting row needs engine, evaluator,
certificate, and outcome semantics, which is a platform write, not a notation
amendment.

## Trigger

An app on the loop or capability bar whose get-or-create must not disclose the
conflicting row (a unique key the viewer cannot read), or authored evidence that
the three-line idiom is a recurring correction-loop cost.

## Shape when it comes

`row = insert profiles { … } if absent` (or a keyword form) yielding the
inserted row or an absence marker, never the conflicting row; certificate
`writeSites` unchanged; the outcome enters the corpus as a twin case.

## Resolution — 2026-09-09

Implemented `insert table { fields } if absent` as the certified InsertIfAbsent
IR primitive in Rust and the TypeScript twin. Insert authority is checked before
unique probes; a collision yields null without reading or exposing its row, and
unheld local uniqueness is partial. Shared corpus plus native/compiler tests
cover created rows, collisions, missing authority, and rollback. Profiles and
follows now use the one-line primitive. LLP 1001 §3 and LLP 1010 record semantics.
