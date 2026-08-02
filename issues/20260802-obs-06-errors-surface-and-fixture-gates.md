# D-06: Errors typed operations, CLI, console, fixture gates, guide row (LLP 0156 checklist 3–6)

**Status:** Open — gated on LLP 0156 Status: Accepted
**Program:** 20260802-obs-00-program.md
**Depends on:** 20260802-obs-05
**Systems:** Error tracking, API, CLI, Admin console, Testing

Implement LLP 0156 §Deliverables checklist (Phase E1) items 3–6 exactly:
`errors.issues` / `errors.issue` / `errors.transition` typed operations
(pinned JSON Schemas, fixtures, LLP 0031 route rows with the CE3 authority
split); `snapback errors` CLI; control-MCP projection; variance-envelope
extensions (cap fact, exemplar staleness); Errors console page + Health
tile; the guide page + `backend.error-tracking-v1` capability row flip.

The fixture-gate list (checklist 5) is normative — implement verbatim:
crash-mid-flush consistency (rows and group increments commit or vanish
together); regression transition under restart; resolved→regressed→resolved
cycling; `_overflow` fold visibility; generation rotation isolates groups;
`max_days = 0` empties the view; exemplar staleness labeling after raw
retention passes; grouping stability across a release change (same
fingerprint, new `last_release`).

Out of scope by the doc's own phasing: E2 alerting (starts only after E1
ships), E3 client crash ingest (sketch-only; OQ-G owns the Sentry-protocol
question).

**Exit:** all checklist-5 gates pass; agents-as-consumer acceptance drives
the operations and CLI directly; guide check green; dated
implementation-record amendment on LLP 0156 when E1 completes.
