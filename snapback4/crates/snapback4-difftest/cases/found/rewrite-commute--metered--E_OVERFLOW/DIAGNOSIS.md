# A refused commutation does not preserve executed cost

Found by LANG2's post-merge `run`, seed 50094 (2026-10-12). The source
`a = (b + b)` with `a = 0`, `b = 9007199254740990` refuses E_OVERFLOW
in either operand order. In the original order it reads `a` first; in the
commuted order the overflowing addition stops execution before that read.
The outcomes and refusal envelopes agree; the meter reports six versus five
steps, correctly counting the work actually performed.

This is a harness defect, not an engine defect. The commute rewrite now
omits meter fields when the original execution refuses, while comparing
all semantic fields and post-write observations. Successful commutations
retain their existing meter comparison. Campaign accounting records these
omissions. The regression exercises both operand orders and a successful
execution of the same expression.

Provenance: the case files are the runner's verbatim shrunk artifact,
136 shrink attempts. Their finding records the pre-fix comparison.
