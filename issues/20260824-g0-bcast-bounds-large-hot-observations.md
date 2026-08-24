# G0-BCAST-BOUNDS: large/hot group-state and fan-out observations

**Status:** Open · **Owner:** LLP 0209 G2-C tail / LLP 0268 B1 gate ·
**Opened:** 2026-08-24

The sole remaining carrier for LLP 0268 §7's `G0-BCAST-BOUNDS` (and
therefore the only gate left on 0268 B1): the large- and hot-fixture
group-state/fan-out observations. Normal-fixture measurements are landed in
`tests/conformance/graph/served-observations.g2-c.v1.json` from the real
retained serving-memo path. The large fixture's CSVs are absent locally
(receipt only) and the hot baseline server was unreachable from the lane;
the exact rerun commands are pinned in
`tests/conformance/graph/0268-COMPLETION-DRAFT.md` and
`bound-derivation.v1.json` (zb5 gates). Also carried here: the production
class-2 authority-resolver seam follow-up (capability declaration stays
test-support-only until it exists; `0268-COMPLETION-DRAFT.md:41`).
