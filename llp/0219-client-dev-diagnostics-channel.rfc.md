# LLP 0219: Client dev diagnostics channel

**Type:** RFC
**Status:** Draft
**Systems:** JS headless client, React/Expo adapters, Client diagnostics, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
**Related:** LLP 0218 (outbox settlement contract and platform-owned drain,
drafted from the same pilot batch — its queued/wedged diagnostic events flow
through this channel), LLP 0193 (errors-as-docs: every warning here must meet
its code + fix/guide-anchor floor), LLP 0156 (minimal error tracking — its E3
client-crash ingest is the explicit *non*-scope boundary of this RFC),
LLP 0012 §Diagnostic Schema and §React and Expo Requirements (the adapter
diagnostic contract this channel implements), LLP 0010 §Diagnostic Shape,
LLP 0043 §Raw settlement facts (the channel reports facts, never invents
settlement), LLP 0107 (queued-mutation rejection semantics), LLP 0208 G1
(outbox drain/observability gap — updated by this RFC without changing its
drain decision), LLP 0201 + `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`
(the pilot that produced the evidence),
`issues/20260809-live-hook-args-saturation-diagnostics.md`,
`issues/20260809-outbox-silent-queue-dx.md`

## Summary

The Clique P2 pilot produced two client-side dark loops, both costing hours
of a build that scored B10 diagnostics at 55 — Snapback's weakest builder
dimension alongside auth:

- **Live-hook args identity churn.** Unmemoized hook arguments caused
  subscription churn that saturated the main thread for ~50 minutes with
  *zero* console output (`issues/20260809-live-hook-args-saturation-diagnostics.md`).
  The authoring skill documents this exact trap and the builder hit it anyway
  — documentation does not catch what a runtime warning would.
- **Silent queued mutation.** A connectivity-classified refusal durably queued
  a mutation; `{queued:true}` resolved like success at the call site, every
  later ordered write queued behind it, and a screen without an outbox drain
  wedged for hours — "the worst hours of the run." An independent M7 session
  rediscovered the same defect from the other side (a rollback-on-error
  handler erased a pending marker for an intent that settled fine), making
  this the strongest convergent product finding of the pilot
  (`issues/20260809-outbox-silent-queue-dx.md`, pilot record F5).

Current main has fixed the immediate defects — content-keyed hook inputs
(`issues/closed/20260806-usesnapbackquery-inline-args-resubscribe.md`), a
distinct `SnapbackQueuedMutationError` class, an immediate queued warning and
a 30-second wedge warning (`QUEUED_MUTATION_WEDGE_WARNING_MS`,
`packages/snapback-react/index.mjs:57`), and `useSnapbackOutbox()`. But those
fixes are fragmented: direct `console.warn` calls
(`packages/snapback-react/index.mjs:~1000–1040`), a 64-entry React inspection
diagnostics array (`packages/snapback-react/index.mjs:309,409`), and separate
bounded outbox rings in the headless client (`__outboxDiagnostics`,
`packages/snapback-client/index.mjs:2122`). Console text is the de-facto
source; there is no coherent history, no active-condition view, no agent API,
and each new dark loop needs another bespoke sink. This RFC establishes one
bounded, machine-readable client diagnostics channel from which console
output, agent inspection, and any future overlay are projections.

## Options considered

1. **Targeted detectors only** — keep adding point `console.warn`s (churn
   warning here, wedge warning there). Smallest change and directly addresses
   the observed failures, but perpetuates the fragmented model: warnings
   require console scraping, agents get no structured view, and it conflicts
   with "the diagnostic object is the contract" (LLP 0010 §Diagnostic Shape,
   LLP 0193).
2. **Structured client diagnostics channel** (chosen) — one bounded
   provider/process-local channel with a default dev-console reporter,
   subscription, snapshot, a React hook, and a framework-neutral observer.
   Serves humans and agents across web/Expo/headless; implements LLP 0012's
   requirement that adapters expose the same diagnostic object. Cost: a
   versioned event contract, redaction rules, coalescing, and hot-path care.
3. **Full first-party dev overlay** — best persistent human visibility, but
   React-specific UI plus cross-platform layout work, production
   bundle/gating risk, and an overlay repainting on every event could itself
   worsen saturation. A visual-only surface is also weaker for Snapback's
   agent-first audience. An overlay is a fine *consumer* of Option 2; it is
   not a substitute for it.
4. **Ship client diagnostics into backend telemetry (LLP 0154/0156)** —
   durable and fleet-visible, but wrong scope now: LLP 0156 E0/E1
   deliberately consume existing backend telemetry, and E3 (client crash
   ingest) is an unbuilt sketch with unresolved authority/abuse/symbolication
   questions that LLP 0156 says graduates to its own RFC. Routine churn and
   queue-state advisories must not become grouped backend issues.

## Decision

**Build Option 2.** A bounded, process-local structured diagnostics channel
in the client, with an enabled-by-default console reporter in
positively-identified dev builds (the existing
`positiveDevelopmentEnvironment()` seam — never a production default).
Targeted detectors are *producers* into the channel; the first two are the
live-hook args identity-churn detector (naming the hook site) and the outbox
queued/wedged detector. A dev overlay is an optional LATER consumer, not the
authority. Fleet-wide aggregation is explicitly out of scope — that is
LLP 0156 E3 territory and stays there.

**Acceptance bar:** the two pilot dark loops are the test. Reproduce both
pathologies in a test app; the channel must surface each within one screenful
of console output, turning a ~50-minute bisection and a multi-hour wedge each
into minutes.

## Design detail

### Channel semantics

- New `packages/snapback-client/client-diagnostics.mjs` (+ `.d.mts`): a
  bounded channel owning `emit`, `subscribe`, `snapshot()`, an
  **active-condition map** distinct from the bounded history ring,
  occurrence coalescing with per-code/per-site cooldowns, explicit
  dropped/coalesced counts, and payload-safe normalization. Constant-time
  emission; no timers per event (one provider-owned deadline scheduler for
  wedge-class conditions, event-driven off outbox notifications).
- Events carry the LLP 0012/0010 shape: stable `SNAPBACK_*` code (registered
  in `diagnostic-codes.d.mts`), severity, subsystem, message, details,
  occurrence metadata. The existing carrier hardcodes
  `severity: 'error'` (`packages/snapback-client/index.d.mts:9`,
  `packages/snapback-react/index.mjs:111` freezes
  `snapback.client-diagnostic.v1`); warning-class events require an
  explicitly versioned evolution (`v2` union or widened `v1` behind a
  compatibility decoder) — never silently emitting new severity values under
  the old schema.
- **Redaction is structural:** raw args, presence values, credentials, and
  mutation payloads never enter the channel. Generated references, hook
  kinds, sequence numbers, hashed canonical-input identities, and a dev-only
  captured call site (once per hook instance) only.
- Every developer-actionable event meets the LLP 0193 floor: name the
  violated rule and a current fix or resolving guide anchor. Until LLP 0146
  OQ6 settles the structured-remediation carrier, use the existing
  text-plus-guide-anchor form; do not freeze a rival `remediations` field.

### Producers (pilot-scoped detectors)

- **`SNAPBACK_REACT_SUBSCRIPTION_CHURN` / `SNAPBACK_REACT_PRESENCE_PUBLISH_CHURN`:**
  warn after N committed resource transitions for one hook instance inside a
  short window (starting point: 8 in 2 s, tunable from stress fixtures
  without changing the code). The warning **names the hook site** (captured
  call site + generated reference + hook kind + transition count/timing).
  Exclusions: the Strict Mode setup/cleanup pair and HMR handoff. Content
  keying remains the primary correctness fix — the detector must *not* warn
  for fresh but content-equal args, which main deliberately supports; it
  catches genuinely changing inputs and future regressions.
- **Outbox queued/wedged:** emit `SNAPBACK_REACT_MUTATION_QUEUED`
  synchronously when enqueue commits; maintain
  `SNAPBACK_REACT_MUTATION_QUEUE_WEDGED` as an *active condition* after the
  30 s threshold, carrying queue depth, oldest-pending age, head
  mutation/sequence, transport provenance, and the exact recovery path
  (`useSnapbackOutbox().replay()`, or LLP 0218's drain once landed). The
  condition clears on replay or terminal disposition. The channel reports
  LLP 0043 raw settlement facts; it does not invent settlement, reorder
  replay, or change LLP 0107's queued-rejection contract (LLP 0218's
  question, not this one).

### Consumers and compatibility

- Default dev reporter: subscribes to the channel, deduplicated
  `console.warn`; existing direct warns in `packages/snapback-react/index.mjs`
  (queued, wedge, optimistic-replay advisories, internal errors) reroute
  through it so console text stops being the source.
- `useSnapbackDiagnostics()` and `observeSnapbackDiagnostics(provider,
  listener)` mirror the existing outbox hook/observer pattern
  (`packages/snapback-react/index.mjs:3473` region). `onDiagnostic` and
  `inspection().diagnostics` remain as compatibility projections. Headless
  `outboxDiagnostics`/`subscribeOutbox`/`outboxStatus()` are preserved;
  `outboxStatus()` gains payload-safe `oldestPendingAtMs` + head metadata.
- LLP 0218's settlement/drain diagnostic events are emitted through this
  channel; an eventual overlay ships (if ever) from a tree-shakable
  `@expo/snapback-react/devtools` export that only reads the channel plus
  existing hooks and owns no queue/settlement/remediation behavior.
- **Out of scope:** no server route, no telemetry database, no automatic
  replay, no settlement-semantics change, no LLP 0156 client ingest.
  Process-local means history dies on reload; acceptable for dev advisories
  because authoritative outbox conditions are reconstructed from the durable
  store.

## Phases

- **P1 — channel core.** `client-diagnostics.mjs` + types + code
  registration; versioned severity evolution; bridge `__outboxDiagnostics`.
  *Proof:* unit tests for bounds, coalescing/drop accounting, redaction,
  active-condition lifecycle, schema-version decode.
- **P2 — producers.** Churn detectors + queued/wedged conditions rerouted
  through the channel; default dev reporter; production suppression.
  *Proof:* package tests for positive dev detection, prod silence, Strict
  Mode/HMR exclusion, no-warn on content-equal args, warn inside the churn
  window, immediate queued emit, 30 s wedge, terminal clearing; parity
  fixture across `onDiagnostic`/hook/observer.
- **P3 — acceptance bar.** Test app reproducing both pilot pathologies
  (unmemoized genuinely-changing hook args; forced connectivity-refusal
  enqueue with no drain). *Proof:* an acceptance run showing each pathology
  surfaced, site-named, with recovery path, within one screenful of console —
  the minutes-not-hours demonstration this RFC is accepted against.
- **P4 — docs.** Amend LLP 0012 (channel/projection contract) and LLP 0107
  (churn + queue-condition semantics); update LLP 0208 G1; add a
  `clients.dev-diagnostics` capability row; update `guide/clients/react.md`,
  `guide/sync/offline-and-retention.md`, `guide/operating/diagnostics.md`.
  *Proof:* `node scripts/check-guide.mjs` + `./ref-check --verbose` green.

## Open questions

1. Churn thresholds (8 transitions / 2 s) are a consultation starting point,
   not measured; P2's stress fixtures set the shipped numbers.
2. Severity evolution shape — widen `v1` behind a decoder vs. a `v2` union —
   is an implementation-time call; the constraint (no silent new values under
   the frozen schema) is binding either way.
3. Whether repeated evidence shows dev environments where neither console nor
   agent observers are usable (e.g. physical-device Expo sessions) — that
   would pull the optional overlay forward into the same tranche, still as a
   channel consumer.
