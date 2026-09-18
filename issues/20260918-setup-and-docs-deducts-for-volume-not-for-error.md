# `setup_and_docs` deducts for orientation volume, never for wrong documentation — three runs, stated

**Filed** 2026-09-18 · **Area** snapback4 / documentation surface · **Status** open
· **Bears on** wave 14's removal question, LLP 3000.007 §14 rulings 40 and 40's revisit

`setup_and_docs` is one of the two categories still declining beyond one sd after
calibration #14 (−5.4 against sd 2.9; the other is `data_modeling`). Nothing currently
planned addresses it. This records what the scorer has actually said it is deducting for,
across three consecutive runs, because it is consistent, it is explicit, and **it
contradicts the position this file's author argued earlier today.**

## What the scorer said, verbatim, three runs running

| run | score | the deduction, in the scorer's words |
|---|---|---|
| #12 (0.2.28) | 88 | "Published docs sufficed without source access, but **required navigating README, guide cards, worker/wire references and generated types**" |
| #13 (0.2.29) | 92 | "**No misleading documentation was established**; recipe adaptation and learning Quarry **required additional orientation**" |
| #14 (0.2.30) | 88 | "**Orientation required a long README plus a second reference**; **no misleading documentation was recorded**" |

Every one names **how much had to be read**. Not one names anything *wrong* in what was
read — and two say so explicitly, unprompted.

## Why this matters, and why it is filed by the wrong person

Two consequences, and the second is a correction.

**1. It explains #14's null result mechanically.** LLP 3000.007 §20.23 landed six advice
repairs and every shape they targeted disappeared from the builder's evidence
(`int has no fields` 20 → 0, the ESM restart loop 7 → 0). `setup_and_docs` did not move.
That is exactly what this table predicts: the repairs made documentation *more correct*, and
the category has never been deducting for correctness. Ruling 40's verdict — right about
repair order, wrong about magnitude — has a mechanism now, not just an outcome.

**2. It weakens the argument I made against a removal wave.** In §14 ruling 40's revisit I
wrote that `setup_and_docs` rising 88 → 92 on a release that removed no surface was "the
strongest argument yet available against a removal wave". That reading does not survive
this table. #13's 92 carries the *same* deduction reason as #12's 88 and #14's 88 — the
score moved, the stated cause did not. Whatever produced #13's recovery, it was not less
reading, and the category fell back to 88 the next run.

So: **the removal hypothesis now has direct, category-level, scorer-stated support**, rather
than the indirect surface-budget inference (README 1,657 → 1,977 lines, cards +249) it had
when ruling 40 was written. I argued the other way on weaker evidence and am recording the
correction where the ruling can find it.

## What this does not establish

- It is a grader's rationale, not a controlled experiment. Nobody has removed surface and
  measured. The bounds bar's surface row and this table agree, but neither is an
  intervention.
- It does not say *which* surface to remove. "A long README plus a second reference" names
  a shape — orientation spread across two documents — not a candidate.
- It says nothing about `data_modeling`, the other declining category, which is separately
  accounted for (`20260918-data-modeling-is-deducting-for-the-thing-mc1-dissolves.md`).

## The test worth pre-registering

Per ruling 40, removal is to be tested against **one named candidate with a measurement**,
not adopted wave-wide. This table suggests what the measurement should be: not card line
counts, but **the orientation path** — how many documents a builder must cross before M1
compiles, and how many lines they request. The bounds bar already records lines requested
(1,380–2,494 → 1,872–4,797 across the before/after runs), so the instrument exists.

Pre-register it with a per-category threshold and an **explicit null band**, which is the
failure mode of the last two conditions this programme wrote.
