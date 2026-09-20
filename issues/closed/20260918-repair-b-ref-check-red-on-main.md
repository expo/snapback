# `ref-check` is red on main: Repair B's ten `@ref`s name anchors that are table text, not headings

**Filed** 2026-09-18 · **Area** snapback4-device / LLP 3000.001 / frozen-record gate
· **Status** closed 2026-09-19 (fix-forward by the wave-13 lead on the author's sign-off; resolution below) · **Priority** P2 (main's `ref-check` gate is red for every session)

Not filed by the owner — I did not write Repair B and I have deliberately **not** fixed it,
because the two candidate repairs differ in intent and that is the author's to choose. The
diagnosis below should make either a few minutes' work.

## Reproduction

On main's tip:

```
./ref-check
ref-check: FAIL — 485 LLP docs, 9133 refs in 24472 files, 10 errors, 0 unchecked
```

Introduced by Repair B's landing (`201c45d245`, merged `863e345bf9`). It was green at
`9124` refs shortly before.

## The ten errors, and why

Two anchors do not exist in `llp/3000.001-durable-replica-and-write-lifecycle.research.md`:

| anchor | refs |
|---|---|
| `#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes` | 9 — `device.rs:367`, `device.rs:369`, `device/deferred.rs:115`, `device/predictions.rs:229`, `device/store_identity.rs:90`, `local.ts:248`, `local.ts:411`, `local.ts:438`, `web.ts:146` |
| `#repair-b-replacement-disposal` | 1 — `device.rs:660` |

**Where the first anchor's text comes from.** It is not invented. The document contains it
at **line 621**, but inside a *table cell*:

> `| … | B: never install a confirmed image over a row a live prediction writes |`

`ref-check` resolves anchors from headings, so table text cannot satisfy it. The document's
only Repair B heading is at line 691:

> `### Repair B: a confirmed image may not carry a write the acknowledgements do not`

**The second anchor has no source at all.** No "replacement disposal" heading or table text
exists, though the merge commit's subject says "authoritative replacement disposal". The
section may have been lost in the merge.

## The two candidate repairs — pick by intent, not by which is smaller

1. **Add the headings.** If Repair B was meant to have named sub-repairs — a "never install
   …" section and a "replacement disposal" section — then the refs are right and the
   document is missing structure the merge dropped. This preserves the annotations'
   specificity, which is the point of an `@ref` (AGENTS.md: "a reference should tell the
   reader something they would not know from the code and filename alone").
2. **Repoint the refs** at `#repair-b-a-confirmed-image-may-not-carry-a-write-the-acknowledgements-do-not`.
   Mechanical and reversible, but ten annotations become less specific, and
   `device.rs:660`'s disposal comment would then point at a section that does not discuss
   disposal.

I lean to (1) on the evidence — the anchors are too specific to be typos, and one of them
already exists as prose — but the content belongs to whoever wrote it, so I have not written
it for them.

## Note on landing past it

`LLP 0232` makes an inherited frozen-record red fix-forward work, not a landing veto, and
the wave-13 session already landed a docs-only commit past it with the gate's other checks
done by hand. That is correct process, and it is also why this needs a ticket rather than
silence: an inherited red that nobody owns becomes permanent.

## Resolution (2026-09-19)

Fixed forward on the author's general sign-off, choosing the repair that adds no content of the lead's own:

- **The nine `#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes` refs** now resolve to a
  heading with exactly the document's own phrase (its table cell at line 621), placed where the section states the
  invariant the nine sites cite — `#### Repair B: never install a confirmed image over a row a live prediction writes`,
  immediately before "**The invariant this turns on: a prediction is retired exactly when its effect enters the base.**"
  No prose was added or changed.
- **The one `#repair-b-replacement-disposal` ref** (`device.rs:672`) now names the heading of the section that discusses
  disposal, `#authoritative-replacement-disposes-of-the-deferred-slot`. The document already carried
  `<a id="repair-b-replacement-disposal"></a>` before that heading, which shows the author's intent — but `ref-check`
  resolves anchors from headings only (`anchor_resolves` in `ref-check`), so an HTML anchor cannot satisfy a ref. The
  gloss is unchanged.

`./ref-check --verbose` on the tree: `ok — 485 LLP docs, 9134 refs in 24577 files, 0 errors`. The Repair B author may
retitle either heading; if so, the ten refs move with it (`ref-check` is the gate).
