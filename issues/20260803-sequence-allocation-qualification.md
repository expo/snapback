# Qualify and publish the LLP 0135 sequence-allocation capability

**Status:** Open
**Systems:** Runtime, Storage, Settlement, Testing, Capability publication
**Related:** LLP 0135 §5.1, LLP 0113, closed umbrella ticket
`issues/closed/20260802-wave1-0135-sequences-snapshot-batch.md`

The handler-tier sequence substrate, generated `AllocateSequence` step,
mutation-atomic lane-Q withholding, and A6 evidence have landed, but
`sequence_allocation_v1` intentionally remains support-false. Complete LLP
0135 §5.1's abort-disclosure, multi-writer performance/commit-order, and
remaining qualification corpus, then use LLP 0113's publication authority
before any target advertises support.

This ticket carries only the sequence publication remainder split from the
closed Wave-1 umbrella. Snapshot-batch v1 is implemented separately and must
not be reopened here.
