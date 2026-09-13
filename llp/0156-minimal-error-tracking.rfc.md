# LLP 0156: Minimal built-in error tracking

**Type:** RFC
**Status:** Accepted
**Systems:** Observability, Error tracking, Server, Runtime, Admin
console, CLI, Client SDK, Hosted execution, Developer experience
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-02
**Revised:** 2026-08-02 (v0.1, initial draft; split out of the LLP 0154
scoping discussion — 0154 gives error *rates*, this RFC gives error
*issues*: grouping, triage state, regression detection, alerting, and
eventually client crash ingest)
**Revised:** 2026-08-02 (v0.2, landscape research pass — four parallel
researchers over Sentry/GlitchTip, the standalone competitor field,
PostHog/Crashlytics/Datadog, and the backend-platform cohort; the
prior-knowledge landscape section is replaced with sourced findings.
Design deltas from the evidence: typed Diagnostic codes named as the
custom-fingerprint escape hatch (an override mechanism is table stakes
market-wide); regression-reopen confirmed as the one behavior no
product omits, with `resolved_release` future-proofing version-aware
semantics; E2's two-rule core anchored to Google Cloud Error
Reporting's exactly-two-triggers precedent and its throttle numbers;
Sentry-envelope compatibility promoted to leading candidate for E3
ingest (unanimous choice of the 2025–26 minimal-tracker tier) as new
OQ-G; snooze/discard/first-in-deploy noise-control variants folded
into OQ-E; merge/split deferred as OQ-A4)
**Revised:** 2026-08-02 (v0.3, round-1 super-refine — both families NOT
READY in design-partner mode; both endorse the direction (separate
document, consumer-not-pipeline, agent-first) and both independently
propose Sentry-envelope *egress*; this is a restructure, not a patch.
Headline changes: a new **Phase E0** (failure disposition and carrier)
after Codex showed "every failed observation" conflates declared
application refusals with actionable faults (LLP 0108's
`SNAPBACK_APP_REFUSAL` would flood the issue list and collapse
`appCode`s) and both families showed the stack-capture claim covered
only the async-failure seam — ordinary handler throws settle through a
JS envelope carrying only code/message, so settle-path stack capture
is a real carrier deliverable with a poisoned-getter trust design, not
a free decode; **fingerprints are versioned** (a normalizer change
would otherwise orphan every issue and break regression detection);
issue ids are **minted, not derived** (`crates/snapback/src/ids.rs` has no Derived
body; determinism moves to a unique fingerprint key); the store splits
physically into **classification-only groups + raw-tier exemplars**
(both families: retained message/stack snapshots violated the
aggregates-outlive-raw-retention justification, stretching ~7-day raw
content to 730 days) with closed-surface titles now **structural**
(code/class + name, never message-derived text); transitions become a
same-database **ledger with `state_seq` CAS** and a **resolved-seq
barrier** so a buffered pre-resolve failure cannot falsely regress;
the regression guarantee is honestly scoped to the group horizon; E2
narrows to **new + regression only** with a durable **alert outbox**
(the spike rule had no data substrate — demoted to OQ-E pending a
denominator-aware model); stack/details byte budgets align to 0154's
8 KiB details cap; loss-model inheritance stated as new CE5; adopted
Fable proposals: deploy-integrated bulk resolve, canned since-release
query preset, `subsystem` facet column, Sentry-egress encoder)
**Revised:** 2026-08-02 (v0.4, round-2 super-refine — focused delta,
both families NOT READY on defects *inside* the v0.3 machinery; both
endorse the restructure and neither reopens the architecture.
Convergent findings, all applied: the E0 disposition becomes a
**versioned per-event classifier** (`ErrorClassificationV1`) stamping
`failure_disposition`/eligibility/versions onto the terminal record at
emission, because one operation class terminates in several
dispositions and refusal opt-ins are manifest properties — a registry
*column* cannot represent it (Codex BLOCKING, Fable MATERIAL); the
resolved-seq barrier gains a **persisted enqueue high-water in
`telemetry_meta`** (boot-seeded, admission-atomic, dated 0154 D3
amendment, restart-straddling fixture) — as specified it was not
restart-safe and could permanently mask regressions (both families);
the **cap regime is fold-only** (the "evicted at the cap" sentence
contradicted CE4); the since-release preset and bulk resolve get their
missing substrate — a classification-only **`release_activations`**
table maintained from lifecycle rows (release ids are hashes; `≥` over
them was unimplementable; activation rows age out at raw retention) —
and bulk CAS becomes a **per-issue snapshot with per-row results**;
the **alert outbox becomes a normative protocol** (DDL, immutable
payload snapshots keyed by edge, boot/flush recovery scans, bounded
retries with terminal states, caps, locally-specified
SSRF/redirect/rotation rules — the cited D9 inheritance was phantom;
the outbox crash fixtures move to E2's deliverables where they
belong). Family-specific findings, all applied: settle-seam
`errorClass` is **grammar-validated with a closed `unclassified`
sentinel** (Fable: handler-controlled class names were free text in
the classification tier, titles, and webhooks; the async seam is
already a closed host enum, and 0108 already grammar-validates
`appCode` — the whole classification tier is now grammar-constrained
by construction); the fingerprint canonical encoding is **pinned as a
tagged byte grammar with cross-language vectors**, diagnostic-branch
fingerprints gain `name`+`subsystem`, and `status_class` gets its
missing column (Codex); `iss_` bodies become **TimeOrdered** (0148
makes Random `usr_`-exclusive; Codex); a fingerprint-version bump gets
a **rollout alert-suppression window** so normalizer maintenance
cannot fire a fleet-wide new-issue storm (Codex); the transition
ledger is renamed **bounded recent history** with caps and a
transition floor — `error_groups.state` is the authority, and calling
a horizon-swept table in a deletable file an "audit authority"
overstated it (Codex); Sentry egress is renamed a **Sentry-formatted
alert bridge** — the outbox carries notification edges, not error
events, so "graduation with zero app changes" was dishonest; a true
eligible-event forwarder is named separate future work (Codex);
exemplar truncation flags, the full transition matrix, summary
enum/terminology drift, and the stale OQ-A3 tag are fixed (both))
**Revised:** 2026-08-02 (v0.5, round-3 super-refine — spot-check of the
v0.4 repairs, both families NOT READY on strictly narrower findings,
architecture undisturbed; both independently found the same barrier
crash hole. All applied: **the resolve transaction now advances
`enqueue_high_water` to the captured barrier value** under the
admission-sequence lock, with a defensive boot seed of
`max(high_water, max(resolved_seq))` — the live counter running ahead
of the flush-persisted high-water meant a resolve followed by a crash
could transiently mask regressions (Fable MAJOR / Codex BLOCKING,
identical scenario); **classification and fingerprinting are split
into two contracts** — `ErrorClassificationV1` is an exhaustive
first-match precedence table (total via a residual `fault` arm) over
failed terminal *and point* records, and the fingerprint step is
specified separately over the full record — with
`failure_disposition` and `classifier_version` now stored on groups
so the promised filter is implementable (Codex BLOCKING, Fable
MINOR); **enqueue sequences become the universal acceptance-order
substrate** — groups gain first/last-seen and last-regressed
sequences, `release_activations` gains activation sequences plus
last-activation fields (same-hash reactivation visible), and the
since-preset is restated over sequences because 0154's per-batch
clock stamps cannot order within a flush (Codex MAJOR); **the rollout
suppression window is now implementable and durable** — rollout
bounds persist in `telemetry_meta` and emitters dual-stamp the
predecessor-scheme hash during the window, so predecessor lookup
needs no exemplars and survives restart (both); **the allocator gains
a total priority order over every occupant** including
`appCode`/`appDetails`/function/raw message, UTF-8-safe truncation,
and whole-value JSON drops, and `unclassified` is reserved out of the
accepted grammar (both); **the outbox becomes per-destination** (one
row per edge × enabled destination, `delivery_id` in the signed
payload as the receiver dedup key, explicit at-least-once, payload
and error byte caps, terminal timestamps, current-generation fence on
recovery scans, HTTPS with resolve-validate-and-pin SSRF discipline)
(Codex MAJOR, Fable MINOR); bounded-state edges closed — `_overflow`
is a reserved row outside the group cap, `release_activations` gets a
hard cap with a visible floor, the transition floor is normatively
derived, `regressed → open` is an explicit admin reopen, and
cooldown-suppressed edges create no outbox row, counted (both). This
entry also corrects the v0.4 header's slip: `release_activations`
retention is the group horizon, as the v0.4 body already said, not
raw retention.)
**Revised:** 2026-08-02 (v0.6, round-4 super-refine — narrowest round,
verdict split: Fable READY (all seven v0.5 hunks sound, the round-3
barrier hole verified closed, five MINOR residues, no re-review
requested), Codex NOT READY on six strictly-narrower findings inside
the v0.5 hunks. All eleven applied: **a disposition-changing
classifier revision now bumps the fingerprint scheme version** (the
coupling rule), with the flusher defensively asserting
stored-disposition equality on upsert — a classifier change could
otherwise re-arm a code into a group whose stored
`failure_disposition` reported the old value (Codex MATERIAL);
**`_overflow` moves out of `error_groups` entirely** — overflow
accounting is a `telemetry_meta` counter advanced atomically in the
flush transaction, because one reserved row could not truthfully
inhabit the group schema's singular fingerprint/disposition/state
columns (Codex MATERIAL); **suppression counters get persisted
storage** — per-group `suppressed_cooldown_count` /
`suppressed_rollout_count` columns updated atomically with the
suppression decision (Codex MATERIAL); the **generation fence now
governs dispatch, not just re-arm scans** — the dispatcher re-checks
generation at claim time, and the guarantee is honestly narrowed to
"not newly dispatched after rotation; a request already on the wire
may complete, and leaks nothing new because its payload is an
immutable OperatorMetadata snapshot" (Codex MAJOR); the
**resolve-validate-and-pin transport rules become
destination-generic**, covering the Sentry DSN endpoint with
hostname-preserving TLS validation, not just the webhook (Codex
MAJOR); the **derived transition floor is totalized** — empty history
derives floor = `state_seq` with an explicit history-truncated label
(both families); and Fable's editorial residues land — the
admission-lock scope is confined to the counter capture (never the
SQLite commit, keeping 0154's never-block hot path), the
"replayed duplicate" rationale is restated as a defensive-idempotence
guard, the allocator gains a residual slot for all other
pre-existing D2 keys ranked in the D2 amendment, and `classifier_v`
is clarified as the column abbreviation of the `classifier_version`
stamp.)
**Revised:** 2026-08-02 (v0.7, round-5 super-refine — Codex-only
spot-check of the v0.6 hunks (Fable READY standing from round 4), NOT
READY on five strictly-narrower findings, 0 BLOCKING / 0 MAJOR, all
applied per Codex's own prescribed resolutions: the
classifier-mismatch path gains a **named durable counter**
(`classifier_disposition_mismatch_count` in `telemetry_meta`,
incremented in the failed-upsert transaction, variance-envelope
exposed, with a group-unchanged fixture); **`overflow_fold_count` is
defined as a cumulative current-generation counter** reset atomically
at generation rebind, with responses labeling that scope — the
"delta in the window" phrasing was unimplementable from a scalar;
the **generation-fence fixture splits into three cases** (unclaimed
pending row: never dispatched; claimed-but-undispatched: never
dispatched; already on the wire: may complete) so acceptance no
longer overclaims cancellation; **`allow_private_webhook` is scoped
webhook-only** (the Sentry DSN is always public HTTPS) and the E2
deliverable now requires the TLS/pinning/redirect fixture matrix for
both destinations with HMAC fixtures webhook-only; and **group
creation pins `state_seq = 0`** with no creation history row, making
the history-truncated predicate unambiguous. Loop closed here under
the corpus's asymmetric stopping rule — Fable READY (round 4,
editorial residues only, re-review declined), Codex NOT READY rounds
3–5 with monotonically shrinking fix-of-the-fix findings; these v0.7
repairs follow Codex's prescriptions but are themselves unreviewed.
The author decides the status transition.)
**Revised:** 2026-08-02 (ACCEPTED under the 2026-08-02 decision
sitting's standing ruling 7 — `issues/20260802-author-decision-packet.md`:
"standing accept on loop close; the loop session flips the header citing
this record." The loop closed the same day under the corpus's asymmetric
stopping rule, recorded honestly: Fable READY at round 4 with editorial
residues only and re-review declined; Codex NOT READY in rounds 3–5 with
monotonically shrinking fix-of-the-fix findings (2 BLOCKING + 3 MAJOR →
2 MAJOR + 3 MATERIAL → 4 MATERIAL + 1 MINOR, zero BLOCKING/MAJOR at
close); the v0.7 repairs follow Codex's round-5 prescribed resolutions
but are themselves unreviewed. Convergence record:
`llp/reviews/0156-minimal-error-tracking.super-refine.md`. Acceptance
releases obs-05/obs-06 per the sitting. The E0 cross-document
amendments to LLP 0154 (registry vocabulary + `failure_disposition`,
D2 allowlist keys + allocator, D3/`telemetry_meta` `enqueue_high_water`
+ rollout bounds) land as dated 0154 amendments at obs-05
implementation time; the 2026-08-02 admission-identity amendment to
0154 (fixed `release` column, meta-pinned app/environment) already
supplies the per-row release identity this document's E1.2 group folds
and `release_activations` consume.)
**Revised:** 2026-08-02 (dated E1 store implementation amendment — the
accepted schema is made mechanically complete with exemplar acceptance
sequences and separate depth/byte/per-flush drop counters; strict closed
branch stamps cover code-less 5xx transport faults without synthesis;
release-activation floor, rollout, retention, direct-transition
linearization, checked sequence exhaustion, and historical resolve-field
rules are pinned to the store behavior and acceptance corpus.)
**Revised:** 2026-08-03 (Phase E0/E1 implementation record — local classifier,
group state, read/mutation projections, Errors UI, fixtures, and guide have
landed. E2 alerting and E3 client crash ingest remain deferred by phasing and
entirely unbuilt.)
**Revised:** 2026-08-03 (dated amendment — multi-rejection fingerprint
authority ruled at author decision sitting #2: the fingerprint authority
for a multi-rejection handler terminal is the first ordered rejection;
the full ordered rejection carrier is retained as facts on the failure
record; no per-rejection group split and no aggregate grammar. See
§Amendment (2026-08-03): multi-rejection fingerprint authority.)
**Revised:** 2026-08-04 (dated E0/E1 implementation-record extension — the
first-ordered multi-rejection authority now ships locally with the complete
ordered carrier retained in raw failure details and singular observation,
group-count, metering, and exemplar semantics; fingerprint scheme v1 remains
current because its exception tuple and normalizer did not change.)
**Revised:** 2026-08-10 (dated scope amendment — the sanitized
**runtime-failure evidence bundle** proposed from the LLP 0207
dissolution (`issues/shelved/20260809-runtime-failure-evidence-bundle-proposal.md`)
is accepted into this document per the 2026-08-10 author ruling, with the
ruling's two fences: v1 is local-capture-only, and the redaction contract
is a tested invariant. The mandated fit check ran first: the bundle
inherits the raw tier's governance (CE3 authority, raw retention floor,
generation binding, budget/flag discipline, observation-keyed identity)
but is a **sibling raw-tier table**, not an exemplar-schema extension —
the pinned exemplar budget accounting and the 8 KiB details allocator
cannot carry it. Capture is a second stated CE1 exception. The bundle is
inspection-only; deterministic replay stays dead per the 0207 review
record. See §Amendment (2026-08-10).)
**Related:** LLP 0154 (minimal observability; the substrate this layers
on — spans, the telemetry sibling store, flush-path maintenance, typed
operations, the variance envelope; this RFC amends its registry, D2
allowlist, and D3 buffer by dated amendment), LLP 0000 (explainer),
LLP 0010 (inspect loop), LLP 0017 (packaged console), LLP 0024
(host-operations style), LLP 0031 (route registry), LLP 0036 (runtime
exposure; the staged-value redactor the evidence bundle's redaction
invariant extends), LLP 0072 (hosted
logs surface), LLP 0093 (client protocol; Phase E3 crash ingest
touches it), LLP 0104 (metering; shares 0154's seams, not this RFC's),
LLP 0108 (inline handlers and result contracts; declared application
refusals and the settle envelope, which E0 extends), LLP 0140 (build
pipeline; source-map custody for symbolication), LLP 0148 (prefixed
identifiers; the `iss_` prefix, TimeOrdered body)

## Summary

LLP 0154 (Accepted, with local Phase 1 implemented) gives Snapback an
observability kernel: spans at
the server seams, error rates and latency on a Health page, a filterable
Logs page, typed query operations. What it deliberately does not give is
what makes Sentry Sentry: the words "alert", "issue", "fingerprint", and
"stack trace" appear nowhere in it. An operator who sees "error rate
0.4%" on the Health page still cannot answer *which distinct problems do
I have, are they new, did the one I fixed come back, and will anyone
tell me when the next one appears?*

This RFC proposes the deliberately minimal error-tracking layer — an
**agent-first issue index over the 0154 substrate, not a miniature
Sentry** — phased:

- **Phase E0 — failure classification and carrier.** Two contracts the
  rest of the design stands on. (1) A **versioned per-event
  classifier** (`ErrorClassificationV1`): an exhaustive first-match
  precedence table — total by a residual `fault` arm — that assigns
  every failed record (terminal *or* point) a **`failure_disposition`**
  from the closed set (`fault`, `app_refusal`, `caller_error`,
  `cancellation`, `timeout`, `overload`) and an issue-eligibility bit
  at emission; a separately-specified **fingerprint step** over the
  full record then stamps the versioned fingerprint beside the
  classifier's outputs. Unhandled exceptions, host faults, timeouts,
  and overloads are tracked by default; declared application refusals
  (LLP 0108), caller errors, and cancellations are not — routine
  domain outcomes must not flood the issue list. Opted-in refusals key
  by `appCode`. (2) A trusted **failure carrier**: today ordinary
  handler throws settle through the `snapbackSettle` envelope carrying
  only `code`/`message` (`packages/snapback-harness/ctx-bootstrap.js`),
  so the envelope gains a **grammar-validated `errorClass`** (closed
  `unclassified` sentinel on validation failure) and a bounded `stack`,
  extracted under the poisoned-getter discipline the envelope already
  applies to `message`, with Ibex/workerd parity fixtures and a
  deterministic whole-record byte allocator inside 0154's 8 KiB
  `details` cap. The async-failure seam is the cheap half: the Hermes
  FFI already returns the stack to `render_async_failure`
  (`crates/snapback/src/runtime.rs`) and the current code frees it unread.
- **Phase E1 — issues.** Eligible failures — already classified and
  fingerprinted at emission under a **versioned scheme** — are folded
  in the **flush transaction** into a bounded, **classification-only**
  `error_groups` table in the LLP 0154 telemetry sibling database: a
  materialized aggregate in the same sense as 0154's rollups, so issue
  *identity and counters* outlive raw-event retention. Every value in
  the classification tier is grammar-constrained by construction
  (Diagnostic codes, `appCode`s, validated `errorClass`, declared
  pattern names, subsystems). Raw-tier content — stack heads, message
  templates — lives in a separate **`error_exemplars`** table governed
  by the same retention floor as raw events. Each group carries
  first/last-seen, first/last release, a count, a `subsystem` facet,
  and **triage state** (`open` / `resolved` / `ignored`, with
  `resolved` → newly-accepted event ⇒ `regressed`, ordered by a
  **restart-safe resolved-seq barrier**) driven on the write path
  through a bounded same-database transition history with `state_seq`
  compare-and-swap. A small classification-only
  **`release_activations`** table (maintained from the lifecycle rows
  the flusher already persists) gives release identities their
  activation order, powering the canned **"new or regressed since
  release X"** preset and a **deploy-integrated bulk resolve** with
  per-issue snapshot CAS. The surface is three typed operations
  (`errors.issues`, `errors.issue`, `errors.transition`) projected
  onto routes, CLI, the control MCP, and one fixed **Errors** console
  page — same contract discipline as 0154 D5. Closed-surface titles
  are structural (`<code|class> in <name>`); handler-authored text
  never leaves the raw tier. Phase E1 is subject-free, like 0154
  Phase 1.
- **Phase E2 — alerting.** Exactly two rules — new issue, regression —
  the pair Google Cloud Error Reporting proves sufficient, evaluated
  on the flush path (no cron, same argument as 0154 D4), committed to
  a same-database **alert outbox** (a normative delivery protocol:
  immutable payload snapshots keyed by edge, boot/flush recovery,
  bounded retries, terminal delivered/dropped states, caps) in the
  transaction that creates the edge, delivered asynchronously by a
  single best-effort HMAC-signed webhook under locally-specified
  SSRF/redirect/rotation rules — plus an optional **Sentry-formatted
  alert bridge** encoder on the same outbox (notification edges
  rendered as Sentry envelopes; honestly *not* event forwarding — a
  true eligible-event forwarder with raw-data custody is named
  separate future work). A fingerprint-version rollout window
  suppresses scheme-created new-issue alerts so normalizer maintenance
  cannot fire a fleet-wide storm. Rate-spike alerting is deliberately
  absent until a denominator-aware model exists (OQ-E).
- **Phase E3 — client crash ingest.** An app-facing report endpoint for
  the LLP 0093 client arms, heavily capped and shed-first, with
  Sentry-envelope-compatible ingest as the leading candidate (the
  unanimous choice of the 2025–26 minimal-tracker tier). E3 has
  genuinely hard open problems (authority, abuse, symbolication,
  offline batching) and **graduates to its own RFC at kickoff**; the
  sketch here records direction, not commitment. It blocks on none of
  E0–E2.

The scope line: **grouping, triage, and notification of eligible
failures the substrate already observes are in scope; everything that
requires new observation machinery is not** — E0 enriches what
existing rows carry (classification stamps, carrier fields), never
adds a seam or a write lane. No session replay, no breadcrumb SDK
(0154's `correlation` field already reconstructs the request timeline
via `telemetry.events` — breadcrumbs for free), no
crash-free-session rates (needs distinct users — gated behind 0154
Phase 3 identity), no performance-issue detection, no assignment/team
workflow, no source-map management in E1.

## Motivation

1. **The typed-refusal head start.** Sentry's entire grouping-heuristics
   apparatus exists because arbitrary exceptions are all it has.
   Snapback's failure paths overwhelmingly terminate in `Diagnostic`
   values with stable `code`s (`crates/snapback/src/diagnostic.rs`) and, since LLP
   0108, declared application refusals with manifest-declared,
   grammar-validated `appCode`s — pre-grouped at the source. Grouping
   here is mostly bookkeeping, not heuristics; that asymmetry is why
   building this in is cheap for Snapback and expensive for everyone
   else.
2. **Agent DX, one level up from 0154.** `telemetry.events` answers
   "show me the failures"; an agent debugging a deployed app actually
   wants "show me the *distinct* failures, newest first, with an
   exemplar" — which today requires the agent to re-implement grouping
   over raw rows on every question, and stops working entirely once
   the raw rows age past `max_days`. Materialized groups make the
   question one operation and make the answer durable. The market's
   only move toward agent consumers is Better Stack's MCP server;
   Snapback's typed operations are ahead of the field here.
3. **The fix-verification loop.** "Did my fix work" is a state machine,
   not a query: resolve open issues at deploy time (E1's bulk verb),
   get told if they come back (E2's regression alert). Nothing in 0154
   holds that state.
4. **Nobody watches dashboards.** 0154's console pages answer questions
   the operator thinks to ask. The day-one expectation set by Sentry,
   Crashlytics, and every hosted platform is push: *tell me* when
   something new breaks. A single webhook covers the minimal form for
   operators and for agents (a webhook can wake an agent).
5. **The capture cost is unusually low — but not free.** The
   async-failure seam already has the stack at the FFI boundary
   (`render_async_failure` frees it unread today). The settle path —
   the highest-volume uncaught-exception path — needs the E0 carrier
   change to preserve class/stack at all. That is one bounded harness
   deliverable, not an SDK program; it is also unrecoverable data the
   moment it isn't captured, which is why E0 leads.

## Landscape findings (evidence)

From the 2026-08-02 research pass: four parallel researchers over
official docs — Sentry/GlitchTip, the standalone competitor field
(Rollbar, Bugsnag/Insight Hub, Honeybadger, Airbrake, Raygun, TrackJS,
AppSignal, Better Stack, Bugsink, Telebugs), PostHog/Crashlytics/
Datadog, and the backend-platform cohort. Sources inline; the pass's
flagged unverifiables are carried where they matter.

- **No backend platform builds issue grouping in.** The BaaS cohort
  sits on three rungs — per-execution logs (PocketBase, Appwrite,
  Supabase functions), error-rate metrics (Convex Health, Cloudflare
  invocation statuses, Vercel), rate-anomaly alerts (Vercel, Railway)
  — and none groups errors into stateful issues. Delegation to Sentry
  is institutionalized: Convex ships exception forwarding to
  Sentry/PostHog/Datadog as a Pro-plan integration
  (docs.convex.dev/production/integrations/exception-reporting),
  Cloudflare has a no-code dashboard Sentry toggle, and Fly.io
  auto-provisions a Sentry project for every deployment
  (fly.io/blog/sentry-partnership). PocketBase is the structural
  comparable: logs in a *separate sibling SQLite database* with
  retention and min-level knobs and debounced batched writes
  (pocketbase.io/docs/go-logging) — 0154's D1 rung, nothing above it.
- **Google Cloud Error Reporting is the minimal-shape existence
  proof** — the only platform-attached offering with the full loop on
  by default (Cloud Functions exceptions appear with zero config).
  Its whole decomposition: three-tier grouping key (exception type
  alone → type + top-5 stack frames → first-3-tokens-of-message +
  function name, with recursion collapsed and synthetic frames
  stripped); four states (Open, Acknowledged with an issue-link slot,
  Resolved, Muted) with Resolved→Open auto-reopen; notifications on
  **exactly two events** — new group and regression — throttled at 5
  per group per hour then silenced 6 hours; ≥30-day retention with
  per-hour ingest sampling and extrapolated counts
  (docs.cloud.google.com/error-reporting/docs/grouping-errors,
  …/managing-errors, …/notifications). A complete, deliberately small
  product — the template this RFC's E1+E2 shape tracks.
- **The market's common-denominator minimal set** (every credible
  tracker in the survey ships all six): capture with context + a
  one-call manual API; automatic grouping keyed on error class + stack
  location with volatile data normalized out (Rollbar deliberately
  excludes line numbers; Better Stack strips UUIDs/hex/emails/IPs/long
  numbers from messages — docs.rollbar.com/docs/grouping-algorithm,
  betterstack.com/docs/errors/using-the-product/exception-grouping);
  a custom-fingerprint escape hatch; a 3–4 state lifecycle where
  **regression-reopen-with-notification is the one behavior no product
  omits**; alerting on new-issue + regression to email/webhook
  minimum; and 7–90-day entry-tier retention with an event quota.
- **Sentry** currently: grouping precedence fingerprint → stack trace
  → exception type+value → message, in-app frames only with normalized
  filenames/context lines — so **symbolication directly affects
  grouping quality** (docs.sentry.io/concepts/data-management/
  event-grouping); six issue states (New/Ongoing/Escalating/Regressed/
  Archived/Resolved) with archive-until-escalating driven by per-issue
  weekly volume forecasts; errors retained 30 days (free) / 90 days
  (paid). Self-hosting it takes 4 cores, 16 GB RAM + 16 GB swap and
  dozens of services — Kafka, ClickHouse, Redis, Postgres, Relay,
  Symbolicator, ~25 Snuba consumers (develop.sentry.dev/self-hosted) —
  which is exactly the weight a built-in layer exists to not impose.
- **The 2025–26 minimal tier proves the small shape works.** GlitchTip
  (Django+Postgres, 512 MB RAM recommended), Bugsink (**one container,
  512 MB, SQLite** — the closest architectural comparable to Snapback:
  grouping + alerts on new/regression/unmuted, deliberately no
  dashboards/APM/replay — bugsink.com/docs), and Telebugs all thrive
  by amputating everything but the loop. Notably **all of them chose
  Sentry-SDK-protocol-compatible ingestion instead of shipping their
  own SDKs** — the Sentry event format is the de facto ingest standard
  for a minimal tracker.
- **PostHog error tracking** (GA April 2025) is the bundled-platform
  precedent: exceptions are ordinary events in the existing analytics
  pipeline — no new store — with fingerprinting (type → message-only-
  if-no-stack → resolved in-app frames), exactly three issue states
  (Active/Resolved/**Suppressed**, where suppression drops matching
  exceptions before ingestion as a cost lever), assignment, and
  new-issue/spike/reopen alerts reusing existing notification plumbing
  (posthog.com/docs/error-tracking). Its post-GA complaint surface:
  source-map upload friction and grouping quality without source maps
  — the two components that dominate real-world cost everywhere.
- **Crashlytics** validates the same floor for clients: multi-signal
  grouping (not user-customizable), open/closed/muted with
  version-aware reopening, velocity alerts as **impact rate** (issue
  exceeds a % of sessions in a 30-minute window per version, with a
  minimum-user floor, fire-once) rather than raw counts, and
  crash-free users/sessions as the headline metric
  (firebase.google.com/docs/crashlytics/alerts). **Datadog**
  contributes two refinements worth stealing: version-aware
  auto-resolve after 14 error-free days, and an **Excluded** state
  that stops ingesting *and stops billing*
  (docs.datadoghq.com/error_tracking/issue_states).
- **Noise control converges on a small kit**: per-issue mute in two
  distinct flavors — *pause* (stop notifying, keep counting) vs
  *discard* (stop recording, save quota: Honeybadger, Raygun, PostHog
  suppression, Datadog Excluded); conditional snooze until time or N
  occurrences (the survey's most-reinvented mechanism); digests;
  cooldowns; and deploy-scoped resets (AppSignal's default policy is
  **first-in-deploy** — one notification per error per release, which
  makes regression handling nearly free —
  docs.appsignal.com/application/notification-settings.html).
- **Agents as consumers barely exist in this market**: Better Stack's
  MCP server over exceptions and agent-ready error prompts are 2026's
  only move in that direction (betterstack.com/error-tracking) —
  Snapback's typed-operations-first posture (0154 D5) is ahead of the
  field here, not catching up.

## Constraints inherited and added

0154's constraint set (C1–C8) applies wholesale: no app-DB writes on
the telemetry lane (C1), idle-settle cleanliness (C2), bounded write
volume (C3), the shared-seam/separate-transport rule against metering
(C7), and the resource-safety envelope (C8). Added for this layer:

- **CE1 — Consumer, not pipeline.** Error tracking adds **no new
  observation seams and no new write lane**. Its event inputs are
  exactly the failed rows 0154 already persists; its event-driven
  writes ride the existing flush transaction on the telemetry
  connection (authored transitions are the stated exception — E1.3's
  writes execute on the same connection, serialized with the flusher).
  E0 *amends what existing rows carry* — the classifier stamps in the
  operation-class registry's vocabulary, the carrier fields in the
  settle envelope, and the enqueue high-water in `telemetry_meta` —
  via dated LLP 0154/0108 amendments; it does not add a seam. If a
  datum is not on a 0154 row after E0, this layer cannot use it.
- **CE2 — The classification tier is grammar-constrained by
  construction; authored state rides beside it.** `error_groups` and
  `release_activations` carry only values with pinned grammars —
  Diagnostic codes, `appCode`s (LLP 0108 grammar), validated
  `errorClass` identifiers (E0.2), declared pattern names, subsystems,
  status classes, counters, ids, timestamps — no handler-controlled
  free text, which is what lets them outlive raw retention under
  exactly the argument 0154 D7 uses for rollups. Raw-tier content
  lives only in `error_exemplars`, governed by the **same retention
  floor as raw events** (E1.2): nothing raw-class outlives `max_days`
  because it moved tables. Triage state is the one authored datum in
  the telemetry store; its durability class is OQ-B.
- **CE3 — Stacks, messages, and templates are C5-sensitive.** They are
  raw-tier data (`AdminSecretRead`, `no-store`), never in the
  `OperatorMetadata` projection and never in webhook bodies. Issue
  *titles* on the closed surface are **structural** — `<Diagnostic
  code | appCode | validated errorClass> in <declared name>` — never
  derived from handler-authored message text, however normalized.
- **CE4 — Bounded groups, fold-only (C8).** Group cardinality is
  capped (default 1,000 groups per generation). At the cap, new
  fingerprints are not grouped; they fold into a per-generation
  **overflow counter in `telemetry_meta`** (`overflow_fold_count` — a
  **cumulative current-generation counter**, advanced atomically in
  the flush transaction and **reset atomically at generation rebind**
  with the rest of the meta rebind; responses label it as
  cumulative-since-generation-start, not a per-window delta) — the
  same no-silent-truncation posture as D7's top-N fold, without a
  pseudo-group row: a fold target could not truthfully inhabit the
  group schema's singular fingerprint/disposition/state columns, so
  overflow lives in meta and surfaces through the variance envelope,
  never through issue filters or state operations. There is **no
  group eviction**; groups leave only via the horizon sweep (E1.2).
  Exemplar storage is byte-budgeted per group and push-capped per
  flush; the transition history is row-capped per group and globally;
  `release_activations` is hard-capped with a visible floor
  (E1.2/E1.3).
- **CE5 — Issue fidelity inherits the telemetry loss model.** 0154 D3
  gives failure records reserved buffer capacity, not a no-shed
  guarantee (C7 is explicit that telemetry may shed). Group counts are
  therefore honest-but-lossy; "new issue" and "regression" mean **at
  first *persisted* occurrence**; drop counters surface in the errors
  variance envelope. Every comparable product treats error events as
  must-keep — Snapback's substrate deliberately doesn't, and this
  layer says so rather than pretending otherwise.

## Design

### E0.1 — The failure classifier and issue eligibility

"Every failed observation" is the wrong input set: LLP 0108's declared
application refusals (`ctx.refuse` against a manifest-declared code
set, carried as `SNAPBACK_APP_REFUSAL` + `appCode`/`appDetails` on
both envelope decoders) are *routine domain outcomes* — consumed
invites, stale revisions — not defects. Tracking them by platform code
would both flood the issue list and collapse every `appCode` for a
function into one issue.

One operation class also terminates in *several* dispositions — a
`function_run` can end as a fault, a caller error, a timeout, or a
declared refusal — and refusal opt-ins are properties of the function
manifest, not of the class. Classification is therefore **not a
registry column**; it is a **versioned classifier evaluated per-event
at emission**, applied to every failed record — failure-status
terminal rows *and* Warning+ `diagnostic` point rows alike:

```
ErrorClassificationV1:
  (operation class, admitted platform code | HTTP status class,
   carrier category (diagnostic | app_refusal | exception | transport),
   manifest opt-in for the admitted appCode)
    → { failure_disposition, issue_eligible, classifier_version }
```

**The classifier is an exhaustive first-match precedence table, total
by construction** — the concrete code/status membership of each arm is
the registry amendment's table, versioned with it; the arms and their
order are normative here:

| order | arm (first match wins) | membership                                  | `failure_disposition` | issue-eligible by default |
|-------|------------------------|---------------------------------------------|-----------------------|---------------------------|
| 1     | declared refusal       | admitted `SNAPBACK_APP_REFUSAL` with validated `appCode` (LLP 0108) | `app_refusal` | no (opt-in per declared code, keyed by `appCode`) |
| 2     | cancellation           | the closed platform cancellation/disconnect code set | `cancellation` | no |
| 3     | timeout                | the closed deadline-exceeded code set       | `timeout`             | yes (own disposition so storms group apart from logic faults) |
| 4     | overload               | the closed shed/backpressure code set       | `overload`            | yes (ditto) |
| 5     | caller error           | 4xx status class; the closed validation/auth refusal code set; `_unmatched` | `caller_error` | no |
| 6     | fault (residual)       | **everything else** — uncaught exceptions, host faults, 5xx transport mapped to no logical call | `fault` | **yes** |

**Fingerprinting is a separate step**, specified in E1.1: it runs at
the same emission point, over the full record (name, code/`appCode`,
carrier `errorClass` and message template, status class, subsystem —
whichever its branch needs), but only for records the classifier
marked eligible. Classifier outputs (`failure_disposition`,
`issue_eligible`, `classifier_version`) and fingerprint outputs
(`fp_version`, `fp_hash`) are stamped side by side into the record's
`details` within the 0154 allowlist (E0.2's byte allocator). The
flusher *materializes* already-decided classification; it never
re-opens manifest or runtime semantics. Groups store both
`failure_disposition` and `classifier_version` (E1.2) — the
`errors.issues` disposition filter reads a column, not a
recomputation. Disposition is deterministic per fingerprint branch
*within* a classifier version; to keep the stored column truthful
across revisions, **a classifier revision that changes any
membership's disposition MUST bump the fingerprint scheme version**
(the coupling rule) — so identical `(fp_version, fp_hash)` always
implies identical disposition, and re-dispositioned codes start new
groups under the new scheme (with the E1.1 rollout suppression
window). The flusher additionally asserts stored-disposition equality
on every upsert; a mismatch (a coupling-rule violation) increments a
named durable counter — `classifier_disposition_mismatch_count` in
`telemetry_meta`, in the same failed-upsert transaction, exposed in
the variance envelope — and the record folds under its own stamps
rather than corrupting the group (fixture: the group row is unchanged
while the counter advances). `classifier_version` records first-fold
provenance.

The classifier's inputs, outputs, and version live in the 0154
operation-class registry **vocabulary** (a dated, registry-versioned
amendment); the field is named **`failure_disposition`** to avoid
colliding with 0154's existing usage-exclusion `disposition` axis.
Changing the classifier is a version bump stamped on every record —
never a reinterpretation of old rows. The manifest may opt a declared
refusal code into tracking (an app author saying "this refusal is a
bug signal for me"); it then fingerprints by `appCode`, not by
`SNAPBACK_APP_REFUSAL`.

### E0.2 — The failure carrier

Two capture seams exist today, with very different costs:

- **Async-failure seam (cheap half):** the Hermes FFI's safe-throw
  metadata call already returns error class, message, *and stack* to
  `render_async_failure` (`crates/snapback/src/runtime.rs`); the current code decodes
  the message and frees the stack unread. The class here is a **closed
  host-side enum** already. E0 decodes what is already returned, under
  the existing 16 KiB safe-text bound at extraction.
- **Settle seam (the real deliverable):** ordinary handler throws are
  caught in JS by `snapbackSettle`
  (`packages/snapback-harness/ctx-bootstrap.js`), which serializes an
  envelope of `code` + `message` (plus `appCode`/`appDetails` for
  declared refusals) — built from separately-encoded primitives
  precisely because handler code can poison prototypes and getters.
  The host never sees the thrown value's handle, so no FFI extraction
  is possible there. E0 extends this envelope with `errorClass` and
  `stack`, extracted under the same discipline already applied to
  `message` (`__snapbackSafeString`-class access — `error.stack` and
  `error.name` can be poisoned getters), and extends the Rust decoder
  (`crates/snapback/src/runtime.rs`) to carry them into the terminal row instead of
  folding everything to `SNAPBACK_HANDLER_FAILED` with no class.

**`errorClass` is grammar-validated, not trusted (normative).** A
thrown value's class name is handler-controlled text. Mirroring the
LLP 0108 `appCode` discipline, the extracted class is validated
against an identifier grammar — `[A-Za-z_$][A-Za-z0-9_$]{0,63}`,
**with the literal `unclassified` reserved out of the accepted set** —
at extraction; anything else (including proxy exotica, poisoned
`name`/`constructor` getters that survive safe access, and a handler
class actually named `unclassified`) folds to the closed sentinel
**`unclassified`**, which therefore unambiguously means "no validated
class available". With this, *every* value in the classification tier
is grammar-constrained (CE2 is checkable by construction, not by
promise), and fingerprint-cardinality abuse through fabricated class
names is bounded. The async seam's closed enum and this validated
identifier share one value space.

**Byte budget (normative).** 0154 D2 caps the serialized `details`
object at 8 KiB through an allowlist/redactor. The carrier and
classifier fields ride *within* that cap under a **deterministic
whole-record allocator** with a **total priority order over every
occupant, existing and new** — canonical serialized-byte accounting
with reserved bytes for the truncation flags themselves:

1. platform code, classifier stamps, fingerprint stamps
   (`fp_version`, `fp_hash`, plus the predecessor stamp during a
   rollout window — E1.1) — never truncated (fixed-size by grammar);
2. `appCode` (grammar-bounded);
3. `errorClass` (grammar-bounded);
4. decoder-added function/name fields;
5. all other pre-existing D2 allowlist keys (e.g. the `_unmatched`
   raw-path detail, diagnostic/log operator context) — ranked
   individually in the D2 amendment, as a block below slot 4;
6. `appDetails` — arbitrary JSON is dropped **whole** when it does
   not fit (never partially serialized), drop-flagged;
7. message template;
8. raw message;
9. stack head (truncated last-first).

String truncation is UTF-8-safe (character boundaries), every
truncation or drop is flagged per field, and the same allocator text
lands in the 0154 D2 amendment so the refusal-envelope contract and
this RFC cannot drift. The 16 KiB extraction bound applies before
allocation, not instead of it. The
allowlist keys land in 0154's D2 by the E0 amendment (they are a
registry-visible change to 0154's surface, not a private extension).
Parity fixtures run the same throwing handlers on Ibex and workerd
and require identical carrier output; the adversarial matrix covers
poisoned `message`/`stack`/`name`/`constructor` getters, proxies,
thrown primitives, and oversized `appDetails`.

Until symbolication exists (OQ-C), captured stacks render raw — Hermes
bytecode frames are of limited use to JS authors today, so the
carrier's near-term value is class/template grouping quality and
forward capture of data that is unrecoverable later; the stack's full
value is deferred, and this RFC says so plainly.

### E1.1 — Fingerprint at the seam, group in the flush transaction

Every **issue-eligible** failure gets a fingerprint computed where the
failure is rendered — the separate emission-time step E0.1 defines,
running only on records the classifier marked eligible — under a
**versioned scheme**:

- **Typed refusal** (the common case): `fp = (v, kind, name, code)` —
  the route/function pattern name plus the Diagnostic code. Two
  functions failing with the same code are distinct issues; one
  function failing for two reasons is two issues. No heuristics.
- **Opted-in declared refusal:** `fp = (v, kind, name, appCode)`.
- **Uncaught exception** (carrier present): `fp = (v, kind, name,
  errorClass, message_template)` where `message_template` is the
  message with digit runs, hex/base32 runs, quoted spans, and
  email-shaped tokens replaced by placeholders. The raw stack is
  **captured but deliberately not in the fingerprint** for v1: Hermes
  bytecode frames carry build-dependent offsets, so stack-keyed
  grouping would split every issue at every release (Rollbar excludes
  even line numbers for the same stability reason). Revisit when
  symbolication exists (OQ-C).
- **Transport-only faults** (no logical call, no carrier):
  `fp = (v, kind, name, status_class)` — `fault`-disposition rows only
  (5xx-class; `_unmatched` and 4xx are `caller_error` and excluded by
  default).
- **Standalone diagnostics** (`diagnostic` points, Warning+):
  `fp = (v, kind = diagnostic, name, subsystem, code)` — every field
  whose stored/displayed value must be deterministic is in the key.

**Canonical encoding (normative).** The fingerprint hash is SHA-256
over a **tagged byte grammar**, truncated to 16 bytes: a one-byte
branch tag (`0x01` refusal, `0x02` app-refusal, `0x03` exception,
`0x04` transport, `0x05` diagnostic), then each field as
`(present: 0x01 | absent: 0x00)` followed — when present — by a
4-byte big-endian byte length and the field's UTF-8 bytes exactly as
extracted (no Unicode normalization; absent ≠ empty by construction);
integers (scheme version, status class) render as decimal ASCII.
Cross-language test vectors (Rust + JS) ship in the fixtures so two
implementations cannot disagree.

**Scheme versioning (normative).** `v` — the fingerprint scheme
version — is part of the tuple's identity, stamped on every group row
**and carried beside the hash in the record's `details`** (the flusher
upserts on `(generation, v, hash)` and must not infer `v`). Normalizer
tuning or tuple changes (OQ-A1 anticipates both) bump `v`; rows
fingerprinted under the new scheme fold into new groups, old groups
age out through the horizon, and the upgrade policy is exactly that —
documented, no silent re-keying. A version bump also opens the E2
**rollout suppression window**, now with a specified mechanism: the
rollout's bounds — `(from_version, to_version, started_ms,
expires_ms)` — persist in `telemetry_meta`, and while the window is
open every emitter **dual-stamps the predecessor-scheme hash** beside
the new fingerprint (the emitter has every input; the flusher still
never recomputes). The flusher suppresses a new group's new-issue
alert when the predecessor group row exists — a classification-tier
lookup needing no exemplars — and suppressions are counted. The
window survives restart because its bounds are persisted; after
expiry the dual stamp stops. Carry-forward migration (re-keying old
groups under the new scheme) is named future work, not v1.

**The escape hatch is the type system.** Every credible tracker ships
a custom-fingerprint override because no default grouping survives
contact with every codebase (landscape: present in Rollbar, Bugsnag,
Honeybadger, Raygun, Better Stack, Sentry; the three that omit it
substitute server-side granularity dials). Snapback's override is
already in the authoring surface: **throwing a typed Diagnostic — or
declaring and opting in a refusal `appCode` — is choosing the
fingerprint.** Phase E1 therefore ships no separate fingerprint API —
the guide documents the pattern instead. Manual merge/split of issues
is deferred (OQ-A4).

Grouping happens in the **flush transaction** (not the slower
maintenance cadence — groups update at every flush): each eligible
failed row in the batch upserts its group — increment count, advance
`last_seen`/`last_release`, insert the exemplar (budget permitting),
run the state machine (E1.3) — and maintains `release_activations`
from any lifecycle activation rows in the same batch. This is CE1
satisfied by construction: same connection, same transaction, same
event-driven cadence, C2 for free, and a crash mid-flush loses the
batch's group increments together with the batch's rows — the two
stay consistent because they commit together.

**Issue identity (normative).** `iss_` ids are **minted with
`TimeOrdered` bodies** under the LLP 0148 grammar — 0148 reserves
`Random` for `usr_`, and `crates/snapback/src/ids.rs` offers exactly
`TimeOrdered`/`Random`; a time-ordered handle also sorts pleasantly —
with determinism carried by the unique key:
`UNIQUE(generation, fp_version, fp_hash)` on `error_groups`.
Re-derivation, exports, and restarts look up by the fingerprint key;
the id is a stable handle, not a hash. If stable re-derivable id
*bodies* are ever genuinely required, LLP 0148 gains a `Derived` body
class by dated amendment then — not now. The `Issue` registry row for
`iss_` lands with deliverable 3.

### E1.2 — The store: classification-only tables, raw-tier exemplars

In the telemetry sibling database (0154 D1), generation-bound like
everything else there — a reset/restore is a new world for issues too:

```sql
CREATE TABLE error_groups (            -- classification tier (CE2)
  issue          TEXT NOT NULL,        -- iss_… (minted TimeOrdered, E1.1)
  generation     TEXT NOT NULL,        -- D1 binding (gen_…)
  fp_version     INTEGER NOT NULL,     -- fingerprint scheme version
  fp_hash        BLOB NOT NULL,        -- 16-byte truncated SHA-256 (E1.1 grammar)
  kind           TEXT NOT NULL,
  name           TEXT NOT NULL,
  code           TEXT,                 -- Diagnostic code / appCode branch
  error_class   TEXT,                  -- validated identifier or 'unclassified'
  status_class   INTEGER,              -- transport branch (5xx class)
  subsystem      TEXT,                 -- Diagnostic subsystem facet
  failure_disposition TEXT NOT NULL,   -- E0.1 (stable per fingerprint branch)
  classifier_v   INTEGER NOT NULL,     -- the `classifier_version` stamp
                                       -- (column-name abbreviation), first-fold
  first_seen_ms  INTEGER NOT NULL,     -- observation-clock stamps (D2)
  last_seen_ms   INTEGER NOT NULL,
  first_seen_seq INTEGER NOT NULL,     -- enqueue seqs: the acceptance order
  last_seen_seq  INTEGER NOT NULL,
  last_regressed_seq INTEGER,          -- seq of the event behind the latest regression
  first_release  TEXT,
  last_release   TEXT,
  count          INTEGER NOT NULL,
  suppressed_cooldown_count INTEGER NOT NULL DEFAULT 0,  -- E2, atomic with the decision
  suppressed_rollout_count  INTEGER NOT NULL DEFAULT 0,
  exemplar_depth_drop_count INTEGER NOT NULL DEFAULT 0,
  exemplar_byte_drop_count  INTEGER NOT NULL DEFAULT 0,
  exemplar_flush_drop_count INTEGER NOT NULL DEFAULT 0,
  state          TEXT NOT NULL,        -- 'open'|'resolved'|'ignored'|'regressed'
  state_seq      INTEGER NOT NULL DEFAULT 0,  -- monotone per-row transition
                                       -- counter (CAS token); groups are
                                       -- created at 0 with no creation
                                       -- history row, so MIN(seq) IS NULL
                                       -- AND state_seq > 0 unambiguously
                                       -- means history was pruned
  state_ms       INTEGER,              -- informational timestamp
  resolved_seq   INTEGER,              -- enqueue high-water at resolve (E1.3 barrier)
  resolved_release TEXT,
  PRIMARY KEY (generation, issue),
  UNIQUE (generation, fp_version, fp_hash)
);

CREATE TABLE error_exemplars (         -- raw tier (CE3): retention = raw floor
  issue            TEXT NOT NULL,
  generation       TEXT NOT NULL,
  observation      TEXT NOT NULL,      -- obs_… correlation root
  recorded_ts_ms   INTEGER NOT NULL,   -- same clock as telemetry_events
  recorded_seq     INTEGER NOT NULL,   -- source row's enqueue acceptance order
  release          TEXT,
  title_template   TEXT,               -- normalized message template
  template_truncated INTEGER NOT NULL DEFAULT 0,
  stack_head       TEXT,
  stack_truncated  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (generation, issue, observation)
);

CREATE TABLE error_transitions (       -- bounded recent state history (E1.3)
  generation     TEXT NOT NULL,
  issue          TEXT NOT NULL,
  seq            INTEGER NOT NULL,     -- = error_groups.state_seq after apply
  from_state     TEXT NOT NULL,
  to_state       TEXT NOT NULL,
  at_ms          INTEGER NOT NULL,
  actor          TEXT NOT NULL,        -- 'admin' | 'flusher' | 'deploy-hook'
  release        TEXT,
  PRIMARY KEY (generation, issue, seq)
);

CREATE TABLE release_activations (     -- classification tier: release order
  generation     TEXT NOT NULL,
  release        TEXT NOT NULL,        -- bundle hash / deployment id
  activated_ms   INTEGER NOT NULL,     -- first activation (observation clock)
  activated_seq  INTEGER NOT NULL,     -- enqueue seq of that activation row
  last_activated_ms  INTEGER NOT NULL, -- advances on genuine reactivation
  last_activated_seq INTEGER NOT NULL,
  PRIMARY KEY (generation, release)
);
```

#### Amendment 2026-08-02: E1 store mechanical clarifications

The flusher accepts only a complete emission-seam stamp. The stamp includes
the closed fingerprint branch discriminator
`typed_refusal | app_refusal | exception | transport | diagnostic`; each
branch admits only its fingerprint tuple's facets. In particular, a
transport-only eligible fault has `failure_disposition = fault`,
`statusClass = 5`, and no `platformCode` — the store does not synthesize a
code from HTTP status. Every non-transport branch requires a grammar-valid
platform code; diagnostic requires `subsystem`; exception requires a
validated `errorClass`; app-refusal requires its grammar-valid `appCode`.
Foreign facets, partial predecessor stamps, unknown flags, wrong versions,
and wrong types are malformed eligible carriers: the raw telemetry row still
commits, grouping is skipped, and `malformed_error_stamp_count` advances in
that transaction. The flusher never reclassifies or recomputes a fingerprint.

`error_exemplars.recorded_seq` is the source row's enqueue sequence and is
the ring's oldest-first authority. The 32 KiB budget counts exact UTF-8 bytes
of `title_template + stack_head` (SQLite BLOB lengths for retained rows,
UTF-8 byte lengths for the incoming row). An individually oversized exemplar
is rejected before any eviction. The per-flush limit counts successful
inserts only; duplicate or oversized candidates do not consume one of the
five insertion slots. Depth replacement, byte-budget rejection/eviction, and
per-flush suppression advance the three separate per-group counters shown
above.

`telemetry_meta` carries the cumulative-current-generation
`overflow_fold_count`, `classifier_disposition_mismatch_count`, and
`malformed_error_stamp_count`, plus `release_activation_floor_seq`. Group
capacity is fold-only: an over-cap fingerprint creates no issue row and
increments overflow once per eligible occurrence. Release activations come
from the already-authoritative `lifecycle/release_activation` publication
rows; same-hash republication is a genuine later activation, while replaying
the exact same sequence is idempotent. First activation fields are immutable;
last activation fields advance only on a greater sequence. Horizon and
2,000-row cap pruning advance the floor to the greatest removed first
activation sequence; generation rotation resets it. Unknown and below-floor
selectors fail closed.

Every `*_visible` view uses the current generation, `max_days > 0`, and a
strict `>` horizon. Group, transition, and activation views use the group
horizon; exemplar views use the same strict
`max(raw boundary, retention_floor)` as raw events. A stale key is absent at
read time even before maintenance physically deletes it.

Direct state transitions share the telemetry owner's serialization gate with
flushes. Lock order is `flush gate → buffer sequence capture → store`; the
gate remains held through the short SQLite transaction, so a flush cannot
overtake barrier capture and commit. Producer admissions retain their D3
non-blocking critical section and may receive later sequences while that
transaction runs. `state_seq` and the admission sequence advance with checked
arithmetic and fail closed at their persisted integer boundary — saturation
is forbidden. A single resolve records the telemetry owner's current release.
`resolved_seq` and `resolved_release` survive reopen and ignore transitions;
a later successful re-resolve replaces both. Bulk resolve uses the named
release's immutable first `activated_seq`, applies exactly to groups with
`last_seen_seq < activated_seq`, and returns per-row results in one
transaction.

Fingerprint rollout suppression consumes the complete persisted tuple
`(from, to, started, expires)` only when
`started <= event.ts_ms < expires`; incomplete or invalid bounds fail closed.
The successor's dual-stamped predecessor lookup is classification-tier and
therefore continues to work after predecessor exemplars have aged out.

**Acceptance order is the enqueue sequence, not the clock.** 0154's
observation clock stamps every row of a flush batch identically, so
`*_ms` values cannot order events within a flush; the admission-time
enqueue sequence (E1.3) is strictly increasing per record and is the
substrate for every ordering claim in this design — the barrier, the
since-preset, first/last-seen, and release activation order. The
`*_ms` columns remain for display and time-window filtering.

- Reads go through `*_visible` views: current generation + the 0154
  disabled-guard (`max_days = 0` empties all of these views too).
- **Retention split (CE2/CE3):** the classification-tier tables
  (`error_groups`, `error_transitions`, `release_activations`) are
  bounded by the group cap (CE4, fold-only) and a **group horizon**
  over `last_seen_ms` (default: the 0154 D7 daily-tier horizon),
  swept by flush-path maintenance. `error_exemplars` rows are
  raw-class and are bounded by the **same read-time retention boundary
  and floor as `telemetry_events`** — an exemplar never outlives the
  raw window its source row lived in. After raw retention passes, an
  issue's detail keeps its structural identity, counters, and
  releases, and honestly reports "exemplars aged out"
  (variance-envelope labeling).
- **Exemplar budgets (CE4):** ring depth default 5, a per-group
  exemplar byte budget (default 32 KiB — the smaller of depth/budget
  wins), at most ring-depth inserts per group per flush batch, all
  three counted and visible when they truncate; per-field truncation
  flags are stored (schema above). Insertion replaces the oldest
  exemplar; an error storm therefore writes at most the ring's worth
  per group per flush, not per event.
- **Transition-history bounds (CE4):** per-group row cap (default
  100) and a global cap (default 10,000); at either cap the oldest
  rows for the affected scope are dropped and a per-group
  **transition floor** — normatively *derived*, never separately
  persisted, so it cannot drift: the lowest retained `seq` for the
  group, or `state_seq` itself when no history rows remain (with an
  explicit history-truncated label in responses:
  `MIN(seq) IS NULL AND state_seq > 0`) — makes the truncation
  visible — `error_groups.state`/`state_seq` are the **current-state
  authority**; the history is explicitly bounded and partial, and
  responses label it so. (It is deliberately *not* called an audit
  authority: it lives in a deletable telemetry file.)
- **Releases:** `release_activations` is maintained by the flusher
  from the lifecycle activation rows it already persists (CE1-clean —
  the input is an existing 0154 row), giving opaque release identities
  their activation order at group-horizon retention. `activated_ms`/
  `activated_seq` are immutable first-activation values (the `since`
  preset's anchor); `last_activated_*` advance when a later activation
  row for the same release hash arrives with a greater sequence, so a
  genuine reactivation is visible. (The strictly-greater guard is
  defensive idempotence — every admitted record carries a fresh
  greater sequence in normal operation, so the guard's only job is to
  make re-application of the same row harmless.) The table is
  hard-capped (default 2,000 rows per generation; at the cap the
  oldest-activation rows drop and a visible **activations floor**
  advances — a `since` selector below the floor fails closed). It
  powers the `since` preset and bulk resolve (E1.4) — and is the
  ordering substrate any future version-aware regression rule needs.
  Per-release occurrence tables remain future work; the
  `errors.issues` release filter is specified over
  `first_release`/`last_release` equality plus activation-order
  comparisons, and a selector naming an unknown release fails closed
  with the known-release list.
- **Group sweep and the regression guarantee (honest scope):** when a
  group ages past the horizon, its fingerprint's recurrence mints a
  *new* issue — the regression promise is scoped to **groups still
  within the horizon**, the horizon and the group-cap fold state are
  reported in `errors.*` responses, and OQ-B records this as the same
  accepted-loss class as file deletion. State tombstones that outlive
  the group row were considered and rejected for v1 (a second
  cap-managed lifetime for marginal benefit).

### E1.3 — The issue state machine

Allowed transitions (the complete matrix — anything absent is
rejected at CAS time):

| from \ to    | open        | resolved  | ignored | regressed        |
|--------------|-------------|-----------|---------|------------------|
| open         | —           | admin/bulk| admin   | (never directly) |
| resolved     | admin reopen| —         | admin   | **flusher only** (post-barrier event) |
| ignored      | admin reopen| —         | —       | (never — ignored suppresses) |
| regressed    | admin reopen (un-triage without resolving) | admin/bulk| admin   | —                |

Normative rules:

- **Transitions are direct serialized writes, not buffered events.**
  An `errors.transition` call executes a short transaction on the
  telemetry connection (not inside a flush, not through the D3
  buffer — the one CE1-stated exception): compare-and-swap on
  `state_seq`, append the `error_transitions` row, update the group —
  atomic, immediately readable, shed-proof. A non-authoritative 0154
  `lifecycle` marker may additionally be emitted for Health-timeline
  rendering, coordinated with the 0154 loop.
- **The resolved-seq barrier (restart-safe, normative).** Every record
  admitted to the D3 buffer is atomically assigned a monotone
  **enqueue sequence** at admission (the linearization point: sequence
  assignment and buffer insertion are one critical section). The
  sequence is seeded at boot from **`enqueue_high_water` persisted in
  `telemetry_meta`**, which every flush advances in its transaction —
  the same durable-high-water pattern 0154's observation clock already
  uses, landed as a dated 0154 D3/`telemetry_meta` amendment
  (deliverable 7). Resolving captures the live counter into
  `resolved_seq` **and, in the same transaction, advances
  `enqueue_high_water` to the captured value** (the admission lock is
  held only for the atomic counter capture and the in-memory
  high-water mirror — never across the SQLite commit, so producers'
  sequence assignment keeps 0154 D3's never-block-on-telemetry hot
  path) — the live counter runs ahead of the
  flush-persisted high-water between flushes, so a barrier persisted
  above the durable high-water would otherwise let a crash re-issue
  already-barriered sequences and transiently mask regressions. Boot
  additionally seeds defensively from
  `max(enqueue_high_water, max(resolved_seq) over current-generation
  groups)`. The flusher flips `resolved → regressed` only for eligible
  rows whose enqueue sequence **exceeds the barrier**. A failure
  already in flight when the operator resolved cannot falsely regress
  the issue — regression means *accepted after resolution* — and a
  restart cannot mask regressions, because no post-boot sequence can
  fall at or below any barrier captured before the restart. (Named
  fixtures, deliverable 6: the in-flight overtaking case, the
  restart-straddling case, and the exact crash schedule "resolve
  committed after unflushed admissions, crash before any flush, first
  post-restart failure must regress".)
- Regression-reopen-with-notification is the one lifecycle behavior no
  surveyed product omits — the non-negotiable core. v1 semantics
  beyond the barrier are the simple ones: any post-barrier eligible
  event regresses. Version-aware variants (Bugsnag reopens only on
  versions released after the fix; Datadog auto-resolves after 14
  error-free days) are deliberately deferred, but `resolved_release`
  and `release_activations` are recorded from day one so upgrading
  later is a rule change, not a schema migration.
- The flusher's regression flip is itself a history append
  (`actor = 'flusher'`), serialized with admin transitions by the
  connection, ordered by `state_seq` — the CAS token; `state_ms` is
  informational only (batch-granular clock stamps can collide).
- `ignored` suppresses transitions and alerts but never counting — the
  count keeps advancing so un-ignoring shows the true history.
  (Discard/snooze flavors: OQ-E.)
- **Deploy-integrated resolve (bulk, one transaction).** The bulk form
  of `errors.transition` — resolve all `open`/`regressed` issues whose
  `last_seen_seq` precedes a given release's `activated_seq`
  (`snapback errors resolve --open-before <release>`, also a
  deploy-hook option) — executes as **one serialized transaction** on
  the telemetry connection (its single linearization point): the
  selector is evaluated and applied atomically, each affected issue
  gets its own history row, one barrier capture (with its
  `enqueue_high_water` advance) covers the batch, and the response
  reports per-issue applied/skipped results (skipped = the transition
  was invalid for that row's current state). Clients supply no
  `expect_seq` in the bulk form — atomic selector evaluation replaces
  it. Combined with regression-reopen this yields first-in-deploy
  economics (AppSignal's default policy) without new notification
  machinery.

### E1.4 — Surface: typed operations, projected everywhere (D5 discipline)

Three operations, pinned schemas, fixtures, projected onto local admin
routes (`/_snapback/api/errors/*`, LLP 0031 rows), `snapback errors`
CLI verbs, the control MCP, and the console:

- `errors.issues` — the list: filter by
  state/kind/name/subsystem/failure-disposition/release/time, order by
  last-seen or count, cursor-paginated; includes the canned
  **`since=<release>`** preset — issues with `first_seen_seq ≥` the
  release's `activated_seq`, or with `last_regressed_seq >` it —
  evaluated entirely over group-row sequences (E1.2's acceptance-order
  substrate: correct within a flush batch, and it survives
  transition-history pruning) — as a named parameter (and the CLI's
  default view) because it is the agent's first post-deploy question;
  unknown releases and releases below the activations floor fail
  closed with the known-release list. The disposition filter reads
  the stored `failure_disposition` column. **`OperatorMetadata` projection**
  (CE3): structural titles and counters only — no stacks, no message
  text, no templates — the closed surface, ordinary admin authority.
- `errors.issue` — one issue with its exemplars (templates, stack
  heads, truncation flags) and a pre-built `telemetry.events`
  correlation query per exemplar (the breadcrumbs answer). **Raw
  tier**: scoped, budgeted `AdminSecretRead` lease + `no-store`, same
  as `telemetry.events`.
- `errors.transition` — `{issue, to, expect_seq}` for single issues
  (CAS on `state_seq`), or `{selector, to}` for the bulk form with
  per-issue snapshot CAS and per-row results (E1.3). Admin authority;
  every application appends to the bounded transition history.

Responses carry the 0154 variance envelope, extended with: the
group-cap fold fact (`overflow_fold_count` from `telemetry_meta`,
labeled cumulative-since-generation-start), exemplar
staleness and truncation labels (E1.2), the group horizon and
transition floor (the honest scopes of regression memory and state
history), and drop counters (CE5 — counts are
at-first-persisted-occurrence).

**Console:** one fixed **Errors** page (0154 D6 sense: opinionated, no
query builder) — open issues by recency with counts, state controls,
detail modal under the raw-read authority. The Health page gains one
link-out tile (new/regressed count), not a new data path.

### E2 — Alerting (Phase E2, deliberately after E1 ships)

- **Exactly two rules, no rule builder:** (1) new issue created; (2)
  `resolved → regressed`. This is the pair Google Cloud Error
  Reporting ships as its entire notification product, and the pair
  every heavyweight defaults on. **Rate-spike alerting is deliberately
  absent**: the honest version is impact-rate (Crashlytics: % of
  traffic in a window with a minimum floor), which needs per-issue
  time-bucketed history and a traffic denominator that the E1 schema
  deliberately does not carry — demoted to OQ-E until a
  denominator-aware model justifies its storage.
- **The alert outbox is a delivery protocol, not a row (normative).**

  ```sql
  CREATE TABLE alert_outbox (
    generation    TEXT NOT NULL,
    delivery_id   TEXT NOT NULL,       -- stable, minted at insert; in the signed payload
    destination   TEXT NOT NULL,       -- 'webhook' | 'sentry_bridge'
    issue         TEXT NOT NULL,
    rule          TEXT NOT NULL,       -- 'new_issue' | 'regressed'
    edge_seq      INTEGER NOT NULL,    -- the state_seq that created the edge
    payload       BLOB NOT NULL,       -- immutable snapshot, versioned shape, ≤ 4 KiB
    created_ms    INTEGER NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    next_attempt_ms INTEGER,
    status        TEXT NOT NULL,       -- 'pending' | 'delivered' | 'dropped'
    terminal_ms   INTEGER,             -- when status left 'pending'
    last_error    TEXT,                -- ≤ 1 KiB
    PRIMARY KEY (generation, delivery_id),
    UNIQUE (generation, issue, rule, edge_seq, destination)
  );
  ```

  The flush (or transition) transaction that creates an alertable edge
  inserts **one row per enabled destination** — webhook and the
  optional Sentry bridge retry, fail, and terminate independently —
  with the **payload snapshotted immutably at insert**
  (`OperatorMetadata` shape, versioned, byte-capped), so later group
  changes or sweeps cannot alter or lose what gets delivered.
  Delivery is asynchronous and event-armed after commit;
  **boot and every flush re-arm pending rows of the current
  generation only** (a crash between commit and delivery cannot
  strand one silently; rotated-away generations' rows are swept, not
  delivered), and **the dispatcher re-checks the generation at claim
  time** — claiming a row for send is the linearization point against
  rotation. The guarantee is honestly scoped: nothing is *newly
  dispatched* after its generation rotates away; a request already on
  the wire may complete, and leaks nothing new because its payload is
  an immutable `OperatorMetadata` snapshot. The contract is
  explicitly **at-least-once per destination until terminal**:
  `delivery_id` rides in the signed request body as the receiver's
  deduplication key. Bounded retries
  with backoff, then terminal `dropped` with `terminal_ms` — counted;
  pending count and oldest-pending age surface in the variance
  envelope. Pending rows are capped (oldest drop first, counted);
  terminal rows sweep at maintenance after a bounded retention.
  Cooldown-suppressed edges create **no outbox row**; the group's
  `suppressed_cooldown_count` (and `suppressed_rollout_count` for
  rollout-window suppressions) advances atomically with the decision
  (E1.2). Retry writes are bounded and terminal, so
  the C2 idle-settle argument holds (a finite retry tail after last
  traffic, then no writes).
- **Destination transport rules (generic — they bind every configured
  destination, the webhook URL and the Sentry bridge DSN alike;
  stated here because 0154's D9 is a one-sentence future-work note,
  not an inheritable contract):** HTTPS with hostname-preserving TLS
  validation; every resolved A/AAAA address must be public unicast
  and the connection is **pinned to a validated address** (no
  re-resolution between check and connect), unless
  `allow_private_webhook` is explicitly set — a **webhook-only**
  escape (local-first development, which also permits plain HTTP to
  loopback for the webhook; the Sentry DSN endpoint is always public
  HTTPS with no private-network exception); redirects are not
  followed. The webhook is additionally HMAC-signed, and its secret
  rotation admits an overlap window (old + new signatures both
  emitted during it). Payload is the outbox snapshot
  (`OperatorMetadata` tier — structural titles, no stacks, no
  templates, CE3; the receiver comes back through the authenticated
  surface for detail). Email/push/Slack are explicit non-goals for
  v1; a webhook composes into all of them and into agent-wakeup.
- **Optional Sentry-formatted alert bridge** (honest name — both
  review families proposed Sentry egress; round 2 showed the outbox
  carries notification *edges*, not error events, so this is an alert
  bridge, not event forwarding and not a zero-app-change graduation
  path): the same outbox snapshot rendered as a Sentry event envelope
  against a pinned subset, aimed at a configured DSN — useful for
  surfacing Snapback issues inside an existing Sentry workflow. A true
  **eligible-event forwarder** (per-occurrence, raw-data custody, its
  own volume/retry economics and opt-in) is named separate future
  work, coordinated with 0154's D9 forwarder note — not promised here.
- **Flap control:** per-issue alert cooldown (default 1h), a global
  per-flush alert cap, and the fingerprint-version **rollout
  suppression window** (E1.1) — all counted and visible when they
  suppress. (Precedent numbers: Google ER throttles at 5 notifications
  per group per hour then silences 6 hours; AppSignal's
  every-occurrence mode has a built-in 5-minute cooldown; Sentry's
  action interval spans 5 minutes–30 days. A 1h default sits inside
  the market band.)

### E3 — Client crash ingest (sketch only; graduates to its own RFC)

The LLP 0093 arms (Swift client, React/microclient) get a report path
for uncaught client-side exceptions. Direction, recorded here so E0–E2
don't foreclose it; the full design — authority model, abuse limits,
idempotency, offline ordering, symbolication custody — is its own RFC
at E3 kickoff:

- An app-facing endpoint — either a bespoke capped-batch report route
  negotiated with LLP 0093, or **Sentry-envelope-compatible ingest
  against a pinned envelope subset**, the leading candidate (OQ-G):
  every minimal tracker of the 2025–26 tier chose it over shipping
  SDKs, and it would replace a bespoke crash-spooling client with the
  mature Sentry client SDKs.
- Ingested as a new low-priority, shed-first 0154 kind
  (`client_error` — a registry-version change, per D2), with its own
  disposition, then classified and grouped by the same E0/E1 machinery
  with `platform` joining the fingerprint.
- Hard problems, named not solved here: **abuse** (a
  weakly-authenticated write endpoint on every app); **symbolication**
  (client stacks are minified/bytecode; useful grouping needs
  source-map custody from the LLP 0140 pipeline — OQ-C — and adopting
  Sentry SDKs imports their release/dist/source-map conventions, so
  OQ-C and OQ-G must be decided together); **offline batching**
  (crashes happen offline; late, clock-skewed batches — 0154's
  dual-timestamp design already gives the vocabulary).

E3 ships only after E1 proves the grouping core server-side, and
possibly never before demand: Convex's point-at-Sentry posture is a
respectable fallback for client crashes specifically.

## Deliverables checklist

**Phases E0 + E1:**

1. **E0 classifier:** `ErrorClassificationV1` (inputs, outputs,
   version) in the 0154 operation-class registry vocabulary as a dated
   amendment, with the `failure_disposition` naming (distinct from
   0154's usage `disposition`); the manifest opt-in for declared
   refusal codes (LLP 0108 touchpoint); classifier fixtures covering
   every Phase-1 0154 kind × admitted code/status × carrier category ×
   opt-in combination, including `_unmatched` and 5xx-vs-4xx splits.
2. **E0 carrier:** `errorClass` (grammar-validated, `unclassified`
   sentinel) and `stack` in the settle envelope with
   poisoned-getter-safe extraction and the 16 KiB extraction bound;
   decoder carriage into terminal rows under the deterministic
   whole-record allocator within 0154's 8 KiB `details` budget
   (allowlist keys registered in the E0 amendment; per-field
   truncation flags); async-failure seam stack decode; Ibex/workerd
   parity fixtures over the same throwing handlers; the adversarial
   matrix (poisoned getters, proxies, primitives, oversized
   `appDetails`).
3. **E1 store:** the four tables + visible views in `telemetry.rs`
   (including the disposition/classifier columns and the sequence
   columns that carry acceptance order); flusher upsert + state
   machine + restart-safe barrier (`enqueue_high_water` and the
   fingerprint-rollout bounds in `telemetry_meta`, dated 0154
   D3/meta amendment; resolve-transaction high-water advance) +
   exemplar budgets + `release_activations` maintenance in the flush
   transaction; group-cap fold (CE4, fold-only, overflow accounting
   as the `telemetry_meta` counter), group-horizon sweep,
   transition-history caps
   with the derived floor, activations cap/floor, and exemplar
   retention-floor enforcement in flush-path maintenance; the `iss_`
   `Issue` registry row (TimeOrdered body); the pinned fingerprint
   byte grammar with cross-language (Rust + JS) vectors.
4. **E1 surface:** `errors.issues` / `errors.issue` /
   `errors.transition` typed operations: pinned JSON Schemas,
   fixtures, LLP 0031 route rows with the CE3 authority split
   (structural titles only on the closed surface), the `since` preset
   over `release_activations`, the bulk snapshot-CAS form with
   per-row results, `snapback errors` CLI (+ deploy-hook resolve
   option), control-MCP projection; variance-envelope extensions (cap
   fold fact, exemplar staleness/truncation, group horizon, transition
   floor, drop counters). Acceptance drives the operations and CLI
   directly — agents are the tested consumer (0154's posture).
5. Errors console page + Health tile.
6. **Fixture gates (E0+E1):** crash-mid-flush consistency (rows, group
   increments, and activation rows commit or vanish together); the
   **overtaking race** (failure enqueued before resolve, flushed
   after: must NOT regress; enqueued after: must), the
   **restart-straddling barrier case**, and the exact crash schedule
   **"resolve committed after unflushed admissions, crash before any
   flush, first post-restart failure must regress"**; concurrent
   enqueue/transition linearization; resolve/regress/re-resolve
   cycling with `state_seq` CAS conflicts and bulk per-row
   applied/skipped results; same-batch activation ordering resolved
   by sequences (not clock stamps); same-hash reactivation advances
   `last_activated_*` (and the strictly-greater idempotence guard is
   a no-op on re-application of the same row); the
   `since` preset evaluated after transition-history pruning;
   overflow folding at the group cap advances `overflow_fold_count`
   visibly and folded fingerprints appear on no issue surface; the
   suppression counters advance atomically with their decisions; the
   activations cap
   advances its floor visibly and below-floor selectors fail closed;
   generation rotation isolates groups; `max_days = 0` empties all
   views; exemplar rows die at the raw retention floor while their
   group survives (and the detail response labels it); group-horizon
   sweep followed by recurrence mints a new issue and the response
   exposes the horizon; fingerprint-version bump starts new groups
   without touching old ones, and predecessor suppression works with
   all predecessor exemplars aged out; a coupling-rule-violating
   upsert leaves the group row unchanged while
   `classifier_disposition_mismatch_count` advances;
   `overflow_fold_count` resets atomically at generation rebind;
   transition-history cap advances the derived floor visibly (and a
   fresh group reads floor-not-truncated at `state_seq = 0`);
   byte-budget truncation at
   every cap, counted and flagged, allocator order pinned across
   implementations; fingerprint vectors byte-identical across Rust
   and JS.
7. Guide page + `backend.error-tracking-v1` capability-index row (GAP
   row until landing); the LLP 0154 amendments (registry vocabulary +
   `failure_disposition`, D2 allowlist keys, D3/`telemetry_meta`
   `enqueue_high_water`, the optional lifecycle marker) coordinated
   with that document's loop; LLP 0108 cross-reference for the
   envelope extension.

**Phase E2 (when it lands):** the outbox DDL + recovery scans +
bounded-retry delivery + the destination-generic transport rules +
the Sentry-formatted alert bridge behind config; fixture gates:
outbox rows commit atomically with their edge and survive group sweep
(immutable payload), one row per enabled destination with independent
retry/terminal state, crash-between-commit-and-delivery re-arms at
boot for the current generation only, the **generation-fence
triptych** (an unclaimed pending row from a rotated generation is
swept, never dispatched; a claimed-but-undispatched row re-checks at
dispatch and is not sent; a request already on the wire at rotation
may complete), retry exhaustion lands terminal `dropped` with
`terminal_ms` and is counted, `delivery_id` present in the signed
payload, cooldown (no-row) and rollout-window suppressions advance
their group counters, HMAC rotation overlap verified, and the
**transport matrix runs against both destinations** — webhook and
Sentry DSN each prove hostname-preserving TLS validation,
resolve-validate-pin, private/link-local rejection, and redirect
refusal; HMAC fixtures webhook-only; `allow_private_webhook` relaxes
the webhook only, never the DSN.

## Amendment (2026-08-03): Phase E0/E1 implementation record

The accepted E0 and E1 scope is implemented for the local target. The shipped
partial capability includes the versioned classifier and failure-detail
allocator; durable fingerprint groups, exemplars, release activations, state
history and generation fences; list/detail/facet reads; compare-and-swap
resolve/reopen mutations including bulk per-row results; exact route, CLI, and
control-MCP projections; and the Errors console page plus Health linkage. The
E0/E1 fixture corpus exercises the classifier, carrier, fingerprint vectors,
flush/store invariants, retention and rollout boundaries, state-machine races,
sequence exhaustion, caps, suppression, and cross-language fingerprint
parity. The guide page, capability row, LLP 0154 implementation record, LLP
0000 index, and LLP 0108 cross-reference complete checklist item 7.

The capability is deliberately labeled **partial**. A single observation with
multiple unhandled failures remains raw-only rather than guessing one group
fingerprint; the malformed-carrier counter preserves that fail-safe while a
separate authority follow-up resolves the grouping rule. Hosted JavaScript
grouping is outside local E1 and remains unsupported until the LLP 0154 Phase-2
Cloudflare projection has an approved implementation contract. Neither residue
is silently counted as an E2 or E3 deliverable.

Phase E2 alerting is deferred by phasing and entirely unbuilt: there is no
alert outbox, delivery/retry worker, webhook transport, or Sentry bridge. Phase
E3 client crash ingest remains a sketch subject to its own RFC and the open
questions named above; there is no client-ingest protocol or implementation.
It is deferred by phasing and entirely unbuilt. The RFC remains **Accepted**;
this implementation record closes the local E0/E1 tranche without asserting
completion of either later phase.

**Implementation update (2026-08-04 — multi-rejection authority).** The
2026-08-03 ruling now ships on the local E0/E1 producer seam. A terminal with
multiple queue-ordered unhandled rejections uses the first carrier's validated
class and normalized message template as the existing exception-v1 fingerprint
input. Its complete ordered `rejectionCarriers` vector remains on the one raw
failure record under the bounded-details truncation witnesses; the flusher
materializes one group membership, advances its occurrence count once, and
retains one exemplar from that same first carrier. Metering still observes the
single handler terminal and is unchanged. Well-formed vectors no longer take
the raw-only malformed-stamp path; genuinely malformed eligible stamps still
advance `malformed_error_stamp_count` without a guessed group. The fingerprint
scheme stays at v1: neither the exception tuple nor its normalizer changed, and
the formerly raw-only terminals have no prior fingerprinted group identity to
re-key or split. This supersedes only the multiple-unhandled residue in the
preceding 2026-08-03 record; hosted grouping, E2, and E3 remain the reasons the
capability is partial.

## Amendment (2026-08-03): multi-rejection fingerprint authority

Ruled by the author at decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`), resolving the question
extracted to
`issues/20260803-multiple-unhandled-error-grouping-authority.md`: when
one handler terminal carries multiple ordered unhandled rejections, the
**fingerprint authority is the first ordered rejection**. The full
ordered rejection carrier is retained as facts on the failure record, so
no truth is dropped — but there is no separate group per rejection and
no aggregate fingerprint grammar; the observation/group schema stays
singular. The E0/E1 raw-only fail-safe recorded in the implementation
record above (no guessed fingerprint, `malformed_error_stamp_count`
incremented) stands until an implementation lands this rule; the ticket
stays open as an implementable follow-up.

## Amendment (2026-08-10): runtime-failure evidence bundle (E1.5)

Accepted scope amendment per the 2026-08-10 author ruling on
`issues/shelved/20260809-runtime-failure-evidence-bundle-proposal.md` (origin:
the LLP 0207 dissolution; both 0207 review families independently
proposed capture-without-replay as the honest residue of the killed S5
replay workstream). Two fences from the ruling bind everything below:
**v1 is local-capture-only**, and **the redaction contract is a tested
invariant, not a convention** — a bundle that leaks a staged secret once
is worse than no bundle.

### Fit with the exemplar/raw-tier machinery (the ruling's first task)

Verified against the E1 store as accepted and implemented, not assumed.
Verdict: **the bundle fits the raw-tier *frame* but not the exemplar
*table* — it lands as a sibling raw-tier table inheriting the tier's
governance, with one honestly-stated CE1 exception for capture.**

What the bundle inherits verbatim from the exemplar machinery:

- **Tier and authority (CE3):** bundle content is raw-class —
  `AdminSecretRead` lease + `no-store`, never in the `OperatorMetadata`
  projection, never in webhook or Sentry-bridge payloads.
- **Retention:** the same read-time boundary and floor as
  `error_exemplars` — a bundle never outlives the raw window its source
  row lived in; groups keep structural identity after bundles age out,
  and responses label the staleness.
- **Identity:** observation-keyed, generation-bound, swept by the same
  flush-path maintenance, visible only through `*_visible`-style views
  (current generation, `max_days > 0` guard).
- **Bounded-writes discipline (CE4):** byte budgets, ring replacement,
  per-field truncation flags, counted suppressions in `telemetry_meta`.

What it cannot inherit, and why a parallel table is the honest shape:

1. **The exemplar schema and budget are pinned.** `error_exemplars`
   carries exactly `title_template` + `stack_head` under a 32 KiB
   per-group budget whose accounting is normatively defined over those
   two columns' UTF-8 bytes (2026-08-02 store amendment) and enforced by
   the acceptance corpus. Request shape, principal class, readiness
   facts, and log excerpts cannot inhabit those columns without
   re-opening the pinned budget arithmetic and every exemplar fixture.
2. **The flush-path carrier cannot carry it.** Exemplar content arrives
   stamped on the failed record inside 0154's 8 KiB `details` allocator
   (E0.2). A bundle with bounded logs is an order of magnitude larger;
   forcing it through the allocator would evict the carrier fields the
   allocator exists to protect. The bundle therefore does not ride the
   D3 buffer or the flush transaction at all.
3. **Capture is a second stated CE1 exception.** Bundle materialization
   is a direct, bounded, serialized write on the telemetry connection at
   the failure render seam — the same exception class as E1.3's authored
   transitions (short transaction, serialized with the flusher, never on
   the app-DB lane). CE1's *spirit* holds: every bundle input is data
   the process already holds at that seam — the stamped failure record,
   the runtime-readiness receipt, the correlated recent rows in the D3
   buffer/`telemetry_events` — so **no new observation seam exists**;
   what is new is one more non-flush write path, recorded here rather
   than smuggled.

### Purpose

Convert failure-state **reconstruction** (the expensive diagnosis mode:
an agent re-deriving what the failing state must have been from the
diagnostic alone) into **inspection**: on runtime failure the system
mints a sanitized, identity-bound local bundle recording what the
failing state *was*. The bundle answers "what was true when this
failed"; it deliberately cannot answer "run it again" (see below).

### Capture point, eligibility, and storm bounds

Capture runs at the failure render seam, after E0.1 classification and
fingerprinting, for **issue-eligible** records only (same eligibility
bit; opted-in refusal codes follow their opt-in). Storm bounds, all
counted in `telemetry_meta` and visible in the variance envelope:

- per-fingerprint capture **cooldown** (default 60 s;
  `bundle_cooldown_suppressed_count`);
- per-fingerprint **ring depth** (default 2; oldest bundle replaced);
- **global cap** (default 200 bundles per generation; at the cap new
  captures fold into `bundle_cap_fold_count`, no eviction);
- whole-bundle serialized cap **32 KiB**; an assembly that cannot fit
  after per-section truncation drops the bundle, counted.

### Bundle store

```sql
CREATE TABLE error_evidence_bundles ( -- raw tier (CE3): retention = raw floor
  generation       TEXT NOT NULL,
  observation      TEXT NOT NULL,     -- obs_… correlation root of the failure
  fp_version       INTEGER NOT NULL,  -- join key to error_groups: capture
  fp_hash          BLOB NOT NULL,     --   precedes the flush that mints iss_,
                                      --   so bundles carry the fingerprint
                                      --   key, never a guessed issue id
  recorded_ts_ms   INTEGER NOT NULL,
  recorded_seq     INTEGER NOT NULL,  -- failing record's enqueue sequence
  release          TEXT,
  bundle_version   INTEGER NOT NULL,  -- versioned serialized shape
  bundle           BLOB NOT NULL,     -- ≤ 32 KiB serialized
  truncation_flags INTEGER NOT NULL DEFAULT 0, -- per-section flags
  PRIMARY KEY (generation, observation)
);
```

### Contents (normative bounds)

| section | contents | bound |
|---------|----------|-------|
| diagnostic | platform code / `appCode` / validated `errorClass`, structural title, `failure_disposition`, classifier + fingerprint stamps | grammar-bounded; never truncated |
| closure/build identity | generation, release (bundle hash), `fp_version`/`classifier_version`, runtime-readiness receipt digest | fixed-size; never truncated |
| redacted request shape | key-structure skeleton only — key names plus type placeholders (`string`/`number`/`bool`/`null`/`object`/`array(n)`), **never leaf values** | ≤ 2 KiB; UTF-8-safe truncation, flagged; un-skeletonizable input drops the section whole, flagged |
| principal class | one value from a closed enum (admin / app-authenticated / anonymous / system; membership pinned at implementation as a registry-style vocabulary) — never a principal id, subject, or token | fixed |
| readiness facts | receipt validity + qualification age, runtime contract version, binary digest — the facts `scripts/ibex-doctor` reads, not the receipt file | ≤ 1 KiB |
| bounded recent logs | rows correlated to the failing observation available at capture (D3 buffer + `telemetry_events`), oldest dropped first, **each line passed through the LLP 0036 staged-value redactor** before entering the bundle | ≤ 50 rows and ≤ 16 KiB total; ≤ 512 bytes per line; truncations counted + flagged |

The logs section deliberately duplicates content `telemetry.events` can
reconstruct while raw rows live: the bundle's copy is bound at capture
time, so it survives telemetry shedding (CE5) and answers the
breadcrumbs question even when the raw rows were shed after capture.
Within the raw window the correlation query remains the richer view; the
bundle is the bounded snapshot, not a second log store.

### The redaction contract (tested invariant, normative)

Three classes of values MUST NOT appear in any byte of a serialized
bundle:

1. **staged secret values** — every class the LLP 0036 staged-value
   redactor covers;
2. **credential material** — admin secrets, webhook HMAC secrets, auth
   tokens, DSN keys, `Authorization`-class header values;
3. **raw application values** — request/argument leaf values,
   row/document field values, `appDetails` values. Shapes,
   grammar-validated names, and type placeholders only.

The enforcement is a fixture matrix, not a review convention, in the
existing seeded-secret pattern
(`staged_secret_values_are_scrubbed_from_stream_error_envelopes`,
`crates/snapback/tests/action_stream_envelope_v0.rs`):

- **Seeded-sentinel scrub matrix:** distinct sentinel values are seeded
  into every input source that feeds bundle assembly — staged config
  secrets, request body/query/header leaf values, principal token
  material, a handler throw embedding a sentinel in its
  message/stack, and correlated log lines embedding a sentinel — an
  eligible failure forces capture, and the test asserts **byte-level
  absence of every sentinel over the whole serialized bundle**, plus
  `[REDACTED]`-class scrub witnesses wherever redaction rewrote text.
- **Value-freedom fixture:** the request-shape section parses to a
  skeleton whose every leaf is in the placeholder vocabulary — no
  application value survives structurally, not just no *seeded* value.
- **Fail closed:** if any redaction step cannot run to completion, no
  bundle row is written and `bundle_redaction_failed_count` advances —
  the ruling's asymmetry made mechanical: a missing bundle is
  acceptable; a leaking bundle is not.

The invariant matrix is a landing gate for the capability-row flip, the
same way the adversarial carrier matrix gates E0.

### Identity binding and discovery

A bundle belongs to exactly one failure: its `observation` correlation
root — the `obs_…` id the rendered diagnostic already carries to the
caller. The agent's path from refusal to bundle is therefore one hop:
take the observation id off the failure, ask
`errors.bundle {observation}` (projected onto the admin routes,
`snapback errors bundle <obs_…>`, and the control MCP — raw-tier
authority, same lease discipline as `errors.issue`). `errors.issue`
additionally lists the issue's live bundles beside its exemplars,
joined through `(generation, fp_version, fp_hash)` — capture precedes
the flush that mints `iss_`, so bundles carry the fingerprint key and
the join happens at read time.

### Local-capture-only v1 (fence)

Bundles are written to and read from the local telemetry sibling store
only. **No hosted upload exists in v1** — the hosted retention/privacy
design defers with it, per the ruling. Bundle content never enters
alert-outbox payloads, webhook bodies, or Sentry-bridge envelopes (CE3
already excludes the raw tier from those surfaces; restated normatively
here because a bundle is the most concentrated raw-tier object this
document defines). The container-VM arm inherits this section verbatim
whenever it runs E1 (same binary, same sibling file); the Cloudflare
arm remains `unsupported` per OQ-D.

### Retention and rotation

Raw retention floor, identical to exemplars: a bundle is invisible at
read time once past `max(raw boundary, retention_floor)` and is
physically swept by flush-path maintenance; `max_days = 0` empties the
bundle view; generation rotation orphans nothing (bundles are
generation-keyed and rotated-away rows are swept, not read). The ring,
global cap, and cooldown bound live volume. Triage-state durability
caveats (OQ-B) apply unchanged: the telemetry file is deletable, and a
bundle is part of the same accepted loss class.

### What the bundle deliberately does not enable

**Replay.** The LLP 0207 review loop evaluated and killed deterministic
replay from a receipt across both model families
(`llp/reviews/0207-agent-efficiency-round-two.gpt-5.md` round 1
concern 5; `….claude.md` round 1 concern 3): a state digest verifies
state identity but cannot reconstruct state, and honest replay would
require the executable artifact, a data snapshot, principal,
environment, time, randomness, and external-service responses — a
privacy/retention design far out of proportion. Nothing in the bundle
captures any of those, and no future field may drift toward
replayability inside this amendment's scope: if replay ever returns it
is a **per-operation-class replayability matrix** under this document,
gated on the bundle proving insufficient in practice — a new dated
amendment with its own review, not an extension of this one.

### Deliverables (extends the E0+E1 checklist)

8. **Bundle store:** `error_evidence_bundles` DDL + visible view,
   caps/cooldown/fold/redaction-failure counters in `telemetry_meta`,
   maintenance sweep at the raw floor.
9. **Capture:** assembly at the failure render seam as a serialized
   telemetry-connection write (the second CE1 exception), the request
   skeletonizer, staged-value redactor integration on every log line,
   per-section bounds and truncation flags, storm bounds.
10. **The redaction invariant matrix** (seeded-sentinel scrub +
    value-freedom + fail-closed fixtures) — a landing gate for the
    capability row.
11. **Surface:** `errors.bundle` typed operation + route/CLI/MCP
    projections, bundle listing in `errors.issue`, guide note, and a
    `backend.error-evidence-bundle-v1` capability-index row (GAP row
    until landing).

### Open questions (author ruling needed)

- **OQ-EB1 — eligibility breadth.** As specified, capture follows issue
  eligibility uniformly — including `timeout`/`overload` storms and
  opted-in refusal `appCode`s, whose request shapes are the most
  application-specific data the bundle touches. Ring + cooldown bound
  the write cost either way; the ruling needed is signal policy:
  default-on for all eligible dispositions, or `fault`-only with config
  opt-in for the rest?
- **OQ-EB2 — per-bundle purge.** The telemetry file is deletable
  wholesale (OQ-B), but there is no verb to delete individual bundles
  ahead of retention. Is a purge verb (privacy hygiene after an
  accidental capture) v1 surface, or deferred until asked for?

## Alternatives considered

- **Fold all of this into LLP 0154.** Rejected: 0154 is seven
  super-refine rounds into a deliberately drawn scope ("fixed
  dashboards over pre-aggregated rollups") and none of issues, triage
  state, alert transport, or client ingest have vocabulary there;
  authored upsert state and a mutating operation are a different write
  pattern from its lossy event/rollup lane. The E0 amendments are the
  honest coupling: this RFC changes 0154's registry, allowlist, and
  buffer *by dated amendment*, not by absorption. Both round-1 review
  families independently endorsed the separate-document split.
- **Track every failed observation.** Rejected (round-1 Codex
  BLOCKING): declared application refusals and caller errors are
  routine domain outcomes; tracking them floods the issue list and
  collapses `appCode`s. Eligibility is decided by the versioned
  per-event classifier (E0.1).
- **Point at Sentry entirely** (the Convex posture). Rejected as the
  *only* answer: it forfeits zero-infrastructure local-first operation,
  ships handler content to a third party by default, and leaves agents
  without a typed in-platform query surface. Partially preserved as
  the E2 Sentry-formatted alert bridge — honestly an alert bridge, not
  event forwarding; a true eligible-event forwarder is future work.
- **Sentry-SDK-compatible ingest endpoint.** Rejected for the server
  side outright: Snapback owns the runtime, so capture is in-process
  and needs no SDK at all — the compatibility surface would buy
  nothing. For **Phase E3 client ingest** the calculus inverts: every
  2025–26 minimal tracker (Better Stack, GlitchTip, Bugsink, Telebugs)
  independently chose Sentry-protocol ingestion over shipping SDKs,
  making it the de facto standard and the leading candidate for E3 —
  decided in E3's own RFC (OQ-G).
- **Issues as app-queryable data.** Rejected: it would cross the C1/C5
  boundary (operator-tier failure material surfacing into app-authority
  surfaces) and create the first app-facing read of the telemetry
  store. Agents consume `errors.*` through admin host operations; apps
  wanting public status views project their own safe domain state.
- **Derived issue-id bodies.** Rejected for v1 (rounds 1–2, both
  families' inputs reconciled): `crates/snapback/src/ids.rs` has only
  `TimeOrdered`/`Random` bodies, 0148 reserves `Random` for `usr_`,
  and determinism is fully served by the
  `(generation, fp_version, fp_hash)` unique key. A LLP 0148 `Derived`
  body class remains available by dated amendment if stable
  re-derivable bodies ever earn their complexity.
- **Read-time grouping** (a `GROUP BY` over `telemetry_events` instead
  of tables). Rejected: dies at raw retention (CE2), re-pays
  normalization on every query, and cannot hold triage state at all.
- **Stack-based fingerprints in v1.** Rejected until symbolication:
  bytecode offsets rotate per release, so stack keys shatter issues at
  every deploy — the opposite of the cross-release continuity issues
  exist to provide.
- **State tombstones beyond the group horizon.** Rejected for v1: a
  second cap-managed lifetime to extend the regression guarantee past
  the group horizon buys little at the horizon's default scale
  (E1.2); the guarantee is scoped and reported instead.

## Open questions

- **OQ-A — Registry and grammar ratifications.** (A1) Normalizer
  token classes (digits, hex/base32, quoted spans, emails — more?) are
  tuned against a corpus of real refusal and exception messages before
  the fixtures freeze; every change bumps the fingerprint scheme
  version (E1.1) and opens the rollout suppression window (mechanics
  now specified: persisted bounds + dual-stamped predecessor hashes),
  so tuning is safe but not free — batch it.
  (A2) ~~Derived id bodies~~ **resolved in rounds 1–2**: minted
  TimeOrdered `iss_` ids + the unique fingerprint key (see
  Alternatives).
  (A3) ~~Audit carrier~~ **resolved in rounds 1–2**:
  `error_groups.state`/`state_seq` are the current-state authority;
  `error_transitions` is bounded recent history with a visible floor
  (deliberately not an audit authority — it lives in a deletable
  telemetry file); an optional non-authoritative 0154 `lifecycle`
  marker for Health-timeline rendering is coordinated with the 0154
  loop.
  (A4) Manual merge/split of issues: deferred from E1; if ever added,
  Sentry's semantics are the precedent to keep — merge is a display
  union that never infers new grouping rules, so future events keep
  routing by original fingerprints and fingerprint determinism
  survives.
- **OQ-B — Triage-state durability.** The telemetry file is deletable
  at any time by design (0154 D1), a reset rotates generations, and
  the group horizon sweeps old groups (E1.2) — all three lose triage
  state, the first two wholesale, the third per-issue with the horizon
  reported in responses. Leaning: accept all three for v1 and document
  them as one loss class (state is cheap to re-author; deletion is an
  explicit operator act; the horizon defaults to ~2 years). The
  alternative (mirroring state into the config store) buys durability
  at the cost of the design's first cross-database consistency
  problem.
- **OQ-C — Symbolication.** Server-side Hermes stacks are raw bytecode
  frames; client stacks (E3) are worse. Useful rendering needs
  source-map custody wired through the LLP 0140 build pipeline
  (retention per release, storage locus, the privacy class of maps).
  Nothing in E0–E2 blocks on it — stacks are captured and shown raw,
  and the carrier's near-term value is grouping quality (E0.2) — but
  fingerprint quality and E3 both eventually want it, and if E3 goes
  Sentry-envelope (OQ-G) the two designs must land together.
- **OQ-D — Hosted arms.** The container-VM arm inherits E0–E2 verbatim
  (same binary, same sibling file). The Cloudflare arm has no local
  SQLite; stateful issue grouping there is declared **`unsupported` in
  the first capability matrix** rather than left ambiguous —
  control-plane-held groups would be a second stateful store with its
  own consistency story, revisited only after 0154 Phase 2 proves its
  gateway.
- **OQ-E — Alert policy and noise-control kit.** Decided at E2 with
  real traffic. On the table, evidence-ranked: (1) **conditional
  snooze** — `ignored until <time>` or `until N more occurrences` —
  the survey's most-reinvented mechanism, strictly better than binary
  ignore; (2) a **discard** flavor that stops recording at
  classification time (PostHog suppression, Datadog Excluded), which
  also sheds write volume; (3) **first-in-deploy** notification
  bundling (AppSignal) — though E1's bulk deploy-resolve plus
  new/regression-only alerting already captures most of its value;
  (4) **rate-spike alerting**, only with an impact-rate model
  (per-issue time buckets + traffic denominator) and its storage
  justified; (5) the **eligible-event forwarder** (the true Sentry
  graduation path), coordinated with 0154's D9 note. Self-cleaning
  defaults (Highlight's auto-resolve after N idle days, Sentry's
  archive-until-escalating) are noted and deliberately not taken —
  they add forecast/idle machinery v1 doesn't need.
- **OQ-F — LLP 0072 relationship.** Hosted logs already mirror
  terminal outcomes; when E1 runs on a hosted arm, does the 0072
  surface link issues (one more projection) or stay disjoint? Leaning:
  disjoint until someone asks.
- **OQ-G — E3 ingest protocol.** Bespoke minimal endpoint negotiated
  with LLP 0093, or Sentry-envelope-compatible ingest against a pinned
  subset (the unanimous choice of the 2025–26 minimal-tracker tier,
  buying the mature Sentry client SDKs — including React Native —
  instead of a bespoke crash-spooling client)? Decided in E3's own
  RFC, jointly with OQ-C's source-map custody; the E0–E2 design is
  deliberately independent of the answer.
