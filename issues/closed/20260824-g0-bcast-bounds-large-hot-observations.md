# G0-BCAST-BOUNDS: large/hot group-state and fan-out observations

**Status:** Closed · **Owner:** LLP 0209 G2-C tail / LLP 0268 B1 gate ·
**Opened:** 2026-08-24
**Closed:** 2026-08-25

The two measurement *blockages* that kept this ticket open are gone:

- Large-fixture `SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` at registration is
  fixed (`parent-key-set` / unbound principal-bound parent facts). Evaluate+register
  on the `VACUUM INTO` clone completed for `issueListV2`, `issueDetail`, and
  `listIssueByID` twice.
- Hot-baseline clone is unblocked via read-only `VACUUM INTO` (two 8753221632-byte
  destinations). Declared in `tests/conformance/graph/MEASUREMENT-REPORT.v1.md`.

D2-H2 N≥3 / D2-H3 hot-shape *publication* and live `SNAPBACK_PB_MODE=observe`
subscribe on a current auth-catalog-v3 ingest remain follow-on measurement.
`G0-BCAST-BOUNDS` stays **PARTIAL** until those numbers exist; this ticket no
longer gates starting that work.

- 2026-08-25 (P-B): deterministic shape inputs delivered; max-bearing large
  observations blocked by demand-identity mismatch; all hot arms blocked by
  online-backup hang.
- 2026-08-25 (unblock): both blockages resolved as above.
