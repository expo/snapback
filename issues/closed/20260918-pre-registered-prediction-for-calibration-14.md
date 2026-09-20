# Pre-registered prediction for calibration #14, written before its score exists

**Filed** 2026-09-18, during #14's builder phase (started 18:19 UTC on the 0.2.30 pin)
**Status** closed 2026-09-18 — resolved by #14: strong criterion met, named condition gapped, conclusion "right about repair order, wrong about magnitude"
**Subject** LLP 3000.007 §14 ruling 40 (advice before documentation), §20.23

Calibration #14 is the first run whose builder sees the six advice repairs of §20.23;
#13 could not test them, because they landed after 0.2.29 was published. This file
records what would confirm and what would refute ruling 40 **before the number exists**,
so the result cannot be read as support whatever it says.

That discipline is the same one §20.23 asks of the engine: state the bar in advance, then
let the measurement decide.

## What shipped in the pin that could move a score

Four of the six are compile-cycle costs the 0.2.28 builder actually paid:

| repair | what the builder used to get | evidence of cost |
|---|---|---|
| scalar field access (`c9b4e93377`) | "read a row or an object before selecting a field" on a `maintain` scalar | **20 occurrences** — the run's most frequent compile error |
| `bool ?` condition (`b88f5d6c9f`) | `x != null`, which compiles and silently inverts intent | 6 occurrences |
| worker ESM seam (`4aa083b2d6`) | Node's 8-frame trace and a restart loop | 7 occurrences, ended by renaming to `.mts` |
| horizon advice (`a3ca6fab1e`) | an alphabetically-chosen index that compiles green | 1 note, on the right table, ignored |

## The prediction

**Confirms ruling 40** — `diagnostics` and `setup_and_docs` both at or above their fitted
line, and no increase in Snapback-attributed loops for the four shapes above. The strongest
single confirmation available: the builder's evidence shows **no `int has no fields`
cluster**, no `bool ?`/`!= null` repair, and no `server.ts` ESM restart loop.

**Refutes it** — those four shapes still cost the builder cycles despite the repairs, or
`setup_and_docs` and `diagnostics` sit below their fitted line. That would mean the repairs
were correct but not where the cost is, and the surface-removal case gets correspondingly
stronger.

**Tells us nothing either way** — the holistic score alone. Its sd is 1.81 and a wave moves
it by less; #13 scored exactly the mean. **A holistic number in the high 80s is not evidence
for this ruling and must not be reported as though it were.** That is the specific error this
file exists to prevent.

## Stated plainly, so it cannot be walked back

The six repairs are, individually, small. If they move nothing measurable, the honest
conclusion is that **advice quality is worth doing because it is correct — a rewrite that
recommends a silent bug is a defect whatever the score does — but that it is not the lever
holding the Astra-medium score down.** Ruling 40 would then be right about repair order and
wrong about magnitude, and the next wave should weigh removal more heavily than §20.23's
argument implies.

I would rather record that in advance than discover a reason afterwards why the number I
got was the one I expected.

## One confound to check before reading anything

#14 runs on a host whose provenance-scan stall recurred twice in two days, and #13's own
`scale_and_limits` reading was distorted by exactly that ([[host-binary-launch-stall]];
#12's 65 was the outlier). Check the packet's `logs/load.log` and the cold-first-feed window
before attributing any `scale_and_limits` movement to the pin.

---

## Outcome (calibration #14, 0.2.30, resolved 2026-09-18)

**Holistic 90.** setup_and_docs 88, data_modeling 82, authorization 96, queries_and_live 85,
writes 96, offline_sync 96, media 98, background_work 87, client_integration 92,
diagnostics 95, scale_and_limits 82, operations 88.

### Against the criteria above, in order

**The strong criterion is MET.** The builder's evidence is free of all four shapes the
repairs targeted: **no `int has no fields` anywhere — 0, against 20 in #12, where it was the
run's most frequent compile error**; no `server.ts` ESM restart loop (0, against 7);
`N_NO_HORIZON` absent from the log; no `bool ?`/`!= null` repair. Builder episodes 16, none
Snapback-attributed.

**The named confirmation condition is NOT met, and neither is the refutation.** It required
`diagnostics` *and* `setup_and_docs` both at or above their fitted line. `diagnostics` 95 is
+0.6 above its 11-run line; `setup_and_docs` 88 is **0.4 below** its 88.4. On a category sd
of 2.86 that is 0.14 sd — on the line, a null result.

**The condition gapped, and that is the author's error.** This is the second time in one day:
ruling 40's revisit condition gapped on #13's 89, and this one gaps on setup_and_docs. Both
were conjunctions whose negation is not the other branch, so they do not partition the space.
Recorded as a defect in how the conditions were written, not as a near-miss. A condition for
#15 must state a threshold per category **with an explicit null band**.

### The conclusion, as pre-committed

The repairs did what they were built to do, and the category they would most plausibly move
did not move. Taking the file's own words rather than finding better ones now:

> **Ruling 40 is right about repair order and wrong about magnitude.** Advice quality is
> worth doing because it is correct — a rewrite that recommends a silent bug is a defect
> whatever the score does — but on this evidence it is **not the lever** holding the
> Astra-medium score down, and the surface-removal case is correspondingly stronger than
> §20.23 argued.

A positive result about **mechanism** (the four shapes are gone) beside a null result about
**magnitude** (the category did not move). Those are different claims and neither should be
reported as the other.

### Two things this run says that the criteria did not anticipate

**The decline has localized.** Over 12 runs the holistic slope no longer clears one sd
(−1.82 against sd 1.83), but `setup_and_docs` (−5.36 against 2.86) and `data_modeling`
(−5.27 against 2.57) both still do. **`data_modeling` at 82 with that drift is arguably the
sharpest remaining target, and is the one category this programme has never gone at
directly.**

**"0 Snapback-attributed episodes" is a floor, not a count.** Six builders of eight
self-attributed a packaging defect as agent error (wave-13 session's P3). The meaningful
comparison is the shapes — 20 → 0 — never the attribution number. #12's builder also
attributed nothing to Snapback while paying for three of its defects.

Also: #14's grader did not probe the 32-word search expansion bound, so its absence here is
not evidence it stopped mattering. It was named twice on independent evidence and stands.

**Status: closed.** The prediction resolved; the ruling it tested stands amended by its own
terms rather than by reinterpretation.
