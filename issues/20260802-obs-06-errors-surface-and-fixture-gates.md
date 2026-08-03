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

## Running log

### 2026-08-03 — checklist 4 typed-surface checkpoint

Checklist 4 now has one Rust-owned contract projected through every local
operator carrier:

- `errors.issues` is a bounded, cursor-bound structural projection with the
  exact `first_seen_seq >= activated_seq OR last_regressed_seq > activated_seq`
  preset, first/last-release equality filtering, and fail-closed unknown or
  below-floor release selectors;
- `errors.issue` is the scoped `AdminSecretRead` + `no-store` raw projection,
  with canonical `iss_` input validation and a ready-to-run bounded
  `telemetry.events` correlation query per retained exemplar;
- `errors.transition` carries the single-row state-sequence CAS and the
  one-transaction `last_seen_seq < activated_seq` bulk selector with per-row
  results; and
- the three operations have pinned generated schemas and a language-neutral
  fixture corpus, LLP 0031 routes, `snapback errors` CLI verbs, and control-MCP
  tools. Host-operation envelopes report the distinct structural-read,
  secret-read, and admin-write authority facts instead of one generic
  observability reason.

The variance contract labels the cap fold as cumulative for the current
generation, keeps list transition floors null because transition sequences are
issue-local, reports exact per-issue transition floors/truncation, and
separates exemplar ring truncation from retention staleness. `exemplarStale`
means a visible durable group has occurrences but no visible raw exemplar; the
depth/byte/flush counters carry ordinary ring loss.

`snapback errors resolve --open-before <release>` is the executable
deploy-hook option named in LLP 0156 E1.3 and is acceptance-tested directly.
This checkpoint does not claim an automatic hosted deployment invocation:
this repository exposes no authoritative hosted lifecycle seam for one, and
the RFC does not require inventing such a seam to make the command hookable.

The reviewed HTTP table classifies malformed selectors/ids/transitions and
unknown/pruned releases as non-retryable-as-written HTTP 400, missing issue
detail as HTTP 404, and server serialization plus the inherited D-05 durable
state/sequence invariants as HTTP 500. The production diagnostic inventory
gate covers every family.

D-06 remains open for checklist 5 (console), checklist 6 (the complete fixture
gate corpus), and checklist 7 (guide/cross-references and the final dated LLP
0156 implementation record). Its obs-05 dependency also remains explicitly
open for the author-blocked multiple-unhandled fingerprint choice and the
hosted-JS tracking-authority/observation-owner boundary recorded there; this
surface checkpoint does not infer either authority.

Wave policy keeps the mechanically required route/host-op classifications in
`guide/capabilities.md` with this tranche, but defers the generated
`guide-manifest.generated.json` and `guide-flat.generated.md` freshness update
to the end-wave guide landing. Until then the guide generator reports that
expected carrier drift; checklist 7 remains the owner of the capability flip,
guide page, and final generated projections.

### 2026-08-03 — checklist 5 console + checklist 6 fixture checkpoint

The fixed admin console now projects the same three typed operations instead
of creating a console-private query path. Its Errors page merges open and
regressed structural rows in persisted-recency order, shows occurrence and
suppression counts, applies Resolve/Ignore through the exact `state_seq` CAS,
and loads templates/stacks only after an explicit raw-detail action under the
memory-only `errors.issue` lease. Health derives one link-out count from those
same `errors.issues` reads. Console bootstrap and polling never call the raw
detail operation.

The checklist-6 corpus now spells out the previously implicit transaction and
ordering witnesses. The injected mid-flush failure includes raw rows, a group
fold, and a release activation in the same commit/vanish assertion. The
overtaking case observes the pre-resolve admission flushed afterward while the
issue remains resolved, then separately observes the post-resolve admission
regress it. The crash schedule holds a real admission unflushed, commits the
resolve/high-water transaction, bypasses graceful producer drop to model
process loss, and proves the first post-restart occurrence regresses. Separate
gates retain the concurrent capture/enqueue ordering, state-cycle CAS conflict,
bulk applied/skipped rows, same-batch activation sequences, and idempotent
same-row activation replay.

The surface fixtures also re-run `since` after the real per-group history cap
has pruned early transitions; expose fresh and truncated transition floors;
show overflow, suppression, activation-floor, group-horizon, and exemplar-stale
facts through typed variance responses; prove suppression rollback and
generation-rebind counter reset; and retain the aged-predecessor fingerprint
rollout and coupling-violation cases. Rust and JavaScript both replay the
fingerprint bytes, while JavaScript independently checks the carrier fixture's
canonical UTF-8 byte count and priority cut (required stamps/allowlist,
whole-dropped `appDetails`, template/message, then truncated stack).

Checklist 7 remains deliberately open for the guide page, capability-row flip,
coordinated cross-references, generated guide projections, and final LLP 0156
implementation record. This checkpoint does not claim E1 complete and does not
enter E2 alerting/outbox scope.
