# Pre-registered prediction for calibration #14, written before its score exists

**Filed** 2026-09-18, during #14's builder phase (started 18:19 UTC on the 0.2.30 pin)
**Status** open — resolves when #14's score lands
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
