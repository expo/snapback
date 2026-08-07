# Arg-filtered live queries retain nothing and the retention mechanisms read as a maze

**Status:** Resolved (2026-08-07)
**Impact:** 3
**Urgency:** 3
**Ease:** 2
**Confidence:** 4
**Systems:** Live queries, Retention, Guide
**Date:** 2026-08-07
**Related:** Diary 0066 (three-lane measurement, 0.1.12)

Chat's natural query shape (args-filtered by conversation) classifies
retention `none`; single_table_v1 eligibility requires public
authority-independent args-less declarative queries, which the guide's
offline example does not make load-bearing. Lane 1 burned roughly half
its 80-minute build discovering this by experiment, dead-ending through
composition-activation and `registerQuery` (`NOT_WRITER` off-writer,
page-scope shadowing) before pivoting to args-less queries filtered
client-side. Three mechanisms (resume channel, registrations,
materialization store) with different survival rules need one guide page
that routes by workload shape and states the eligibility constraints
up front — and the eligibility rule belongs in the retention fact's
diagnostic, not just prose.

## Resolution (2026-08-07)

**The factual premise was partly wrong, and the correction is the fix.**
Explicit-args filters do NOT make a live query ineligible: both the codegen
predicate (`singleTableRqsDigestKind`) and the server predicate
(`rqs_eligible_digest_kind`, src/manifest.rs) classify `Arg(_)` as query
identity, not ambient authority. Re-verified empirically against the
published `0.1.12` packages (scaffold + `snapback dev` + packaged
darwin-arm64 runtime): an args-filtered
`eq('conversationId', arg('conversationId'))` public+authorityIndependent
query reports `retainable: true` with a minted resume token in BOTH dev and
sessions modes, args-less sibling identical. The CI witness
(`demos/public-dashboard/tests/acceptance/offline-local-first.mjs`) already
pins the args-filtered shape (`args: { dashboardId: 'ops' }`). What the
lane actually hit is the natural sessions-mode chat shape: a query without
BOTH `auth: 'public'` and `authorityIndependent: true` (or a JS-handler /
composite query) is authority-scoped or unclassified, and the old
`SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` reason was too generic to say so.

Delivered:

1. **Routing section** — `guide/sync/offline-and-retention.md` now opens
   with "Route by workload shape": eligibility constraints stated before
   any example (including "explicit args do not break eligibility" with the
   receipt trail), a six-row table routing args-less/args-filtered public
   queries, protected rows, relational composites, durable registrations,
   and snapshot batches to their mechanism with each one's survival rules,
   plus the two named maze dead-ends (`composition-activation-prepare` is
   not a retention lever; `SNAPBACK_RQS_STORE_NOT_WRITER` off-writer).
2. **Diagnostic** — the seam was cheap (JS-level): the generated reference
   already carries the codegen-derived retention classification, so
   `packages/snapback-client/index.mjs` now derives the
   `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` fact's `reason` from it
   (`rqsRetentionIneligibilityReason`): declaration never opted in vs.
   class volatile-by-design vs. eligible declaration on a target that did
   not activate the class. Unit-tested in
   `packages/snapback-client/rqs-resume.test.mjs`; probed live against a
   running server for all three shapes.
3. **Retrieval-eval seed** — case 17 in `guide/retrieval-eval.md`
   ("args-filtered retention none") routes to the new section; static
   routing checker green.

**Residue:** the client-side reason cannot name WHICH declaration fact is
missing (`auth` vs `authorityIndependent` vs plan shape) — the reference
does not carry the individual declaration facts, and emitting them would
rotate generated-artifact identity. That finer-grained naming is a
generate-time diagnostic and belongs to LLP 0178's V1 class
(`llp/0178-generate-time-authoring-diagnostics.rfc.md`); no separate seam
was built.
