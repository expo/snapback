# D-06: Errors surface, console, and the full fixture-gate corpus (LLP 0156 checklist 4–7)

**Status:** Open — released 2026-08-02 (LLP 0156 Accepted at v0.7);
depends on obs-05
**Program:** 20260802-obs-00-program.md
**Systems:** Error tracking, Admin console, CLI, Testing

Realigned 2026-08-02 to the v0.7 checklist. Implement LLP 0156
§Deliverables checklist items 4–7 exactly:

- **Typed operations (checklist 4):** `errors.issues` / `errors.issue` /
  `errors.transition` with pinned schemas + fixtures; LLP 0031 route rows
  under the CE3 authority split (structural titles only on the closed
  `OperatorMetadata` surface; templates/stacks raw-tier under
  `AdminSecretRead` + `no-store`); the seq-based `since=<release>`
  preset over `release_activations`; the bulk deploy-resolve form (one
  atomic transaction, per-row applied/skipped); `snapback errors` CLI +
  deploy-hook resolve option; control-MCP projection; the
  variance-envelope extensions (overflow fold count labeled
  cumulative-since-generation-start, exemplar staleness/truncation,
  group horizon, transition floor + history-truncated label, drop
  counters, suppression counters).
- **Console (checklist 5):** the Errors page + Health link-out tile.
- **Fixture gates (checklist 6):** the full v0.7 list, verbatim from the
  LLP — including the barrier crash schedules (overtaking,
  restart-straddling, resolve-after-unflushed-admissions), same-batch
  activation ordering by sequence, coupling-rule-violation counter,
  generation-rebind counter reset, fingerprint-version rollout
  suppression with predecessor exemplars aged out, and the cross-language
  fingerprint vectors. Read the list in the LLP; do not paraphrase it.
- **Guide + cross-refs (checklist 7):** guide page;
  `backend.error-tracking-v1` capability row (GAP row until landing);
  the LLP 0154/0108 cross-references.

Acceptance drives the operations and CLI directly — agents are the
tested consumer; the console is not the proof. E2 (alerting/outbox) and
E3 (client ingest) are explicitly NOT this ticket: E2 lands later with
its own deliverable block; E3 graduates to its own RFC.

**Exit:** every checklist-6 fixture exists and passes; guide checks
green; ref-check green; dated implementation-record amendment on LLP
0156 when E1 completes.
