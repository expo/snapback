# BG round 2 context

Scope: SQLite count certification/recounts and delivery heap admission. Base
4277a65cf4; round-1 report read first. Snapback 4 fence, root LLP 3000 and
LLP 2000.000, NOT-DOING, rules/RULES and the journal govern this lane.

- LLP 3000.015 §3 (current): instant live counts, transactional evidence,
  bounded writer/chunk work, fresh authority and finite caller heap.
- LLP 3000.019 §3.6 (current): one read transaction and pinned operation clock.
- LLP 3000.020 §3.2 (current): devices use coverage; server evidence stays SQLite-only.
- guide maintains: current authoring semantics; no public count/wire change.
- The foundation overlay is Snapback 1; its gates do not cross this fence.

Risk: expired members miss deltas; an earlier recount clock can make excluded
prefix rows live; nested batch admission cannot discard intervening occupancy.
Chosen rule and clock audit extend LLP 3000.015 §3. Existing report and append-only
journal receive round-2 evidence. Hand-off: none. No push/publication authorized.
