# Snapback 4: sync refuses OR-shaped read rules; builders made private rows public

Status: Open
Date: 2026-10-08
Scope: Snapback 4 core (`sync` audience inference, schema binder); a NOT-DOING line ("Union audiences")
Reproduced: yes, on main cd2fa88d8b

## Evidence

App-farm round 1 cluster 16 (S-SYNC): 6 builds (GPT 4, Muse 2) with issue rows,
17 diaries mention E_SYNC. Concrete cost:

- fridge-first-0911: `read <- .claimant = viewer or .postedBy = viewer` with
  `sync to .claimant` refused; dropped the poster disjunct, so the poster can no
  longer read claims of their own food (~2 min, privacy/function loss).
- memory-quilt-0800: `.approved or .author = viewer or exists organizers[..]`
  refused for `sync public`; made all photos public-read to get offline
  (major, "pending-queue privacy sacrificed for offline").
- seed-lineage-swap-0927: mixed public/private audience in one table refused;
  split into public lots + online-only swaps (4 min).
- inscription-proof-0798, meteor-blanket-0137 fell back to `online only`;
  waiting-room-quest-0360 split tables.

## Repro

```quarry
table photos:
  caption: text <=80
  author: principal
  approved: bool
  read <- .approved or .author = viewer
  insert <- .author = viewer
  sync last 100 by .id
```

`snapback4 check`:

```
schema.q:7:3 — E_SYNC: sync cannot infer an audience from `.approved = {"Bool":true} or .author = viewer`; use public, `.column = viewer`, or `exists target[.columns, viewer]`
  rewrite: use one invertible read rule, or remove sync (online only)
```

Same for `.claimant = viewer or .postedBy = viewer` with `sync to .claimant`.

Expected (builders' reading): either the union of the two audiences is synced,
or the refusal names the concrete split that keeps both readers.

Two defects beyond the design limit:

1. The message renders the literal as internal JSON: `.approved = {"Bool":true}`
   instead of the source `.approved` (or `.approved = true`).
2. The rewrite offers only "one invertible rule, or online only". It does not
   name the paved split (two tables, or a public projection plus an owner-keyed
   table) that keeps both audiences, so builders picked "make it public".

## Design status

NOT-DOING.md "Union audiences": one `sync` line per table; "several `sync`
lines per table wait for an app that needs them". Six farm apps needed them;
two of them weakened privacy to get offline. That is the evidence the line asks
for, recorded here for the lead session's decision.

## Suggested fix

- Core/lang (lead session): render rule literals in source form in E_SYNC.
- Make the E_SYNC rewrite name the concrete split for the two common shapes
  (public-or-owner: `public` table for approved rows + owner-synced pending
  table; owner-or-counterparty: two owner-keyed rows or a membership table),
  and add an "owner or role" recipe to `guide sync`.
- Decide on union audiences (a second `sync` line per table = union of
  partitions) with this evidence.

## 2026-10-08 — the diagnostic half landed (lane S1, LLP 3000.036 §1 A)

`E_SYNC` now quotes the read clause from source (no `{"Bool":true}`), says
not to make private rows public to get past it, and names the split for the
shape (a `<table>Readers` membership table synced to its members, or a public
table plus an owner-synced one) or `online only`. The design half (§1 B1, an
explicit exact-disjunct `sync to`) is still open for the lead session, so this
ticket stays open.

