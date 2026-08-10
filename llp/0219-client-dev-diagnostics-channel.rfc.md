# LLP 0219: Client dev diagnostics channel

**Type:** RFC
**Status:** Accepted
**Systems:** JS headless client, React/Expo adapters, Client diagnostics, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (Review → Accepted — accepted to begin implementation
(author direction in-session); round-2 verdicts bind revision (c) — Claude
READY pre-existing-clean, GPT NOT READY with its MATERIALs fixed in the (d)
tail, which is unreviewed and disclosed; round-1 GPT failed-to-review
(environmental, recorded in the artifact); the families never reached
dual-READY on a single revision — disclosed.)
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; sub-orchestrated loop. Re-applied after a
concurrent session's checkout discarded the uncommitted edit; the round-1
reviews bound blob 9277f99a, which is this text)
**Revised:** 2026-08-10 (c — round-1 repairs per
`llp/reviews/0219-client-dev-diagnostics-channel.rfc.claude.md` (NOT READY;
the GPT-family runs produced no review after three attempts — recorded in
`llp/reviews/0219-client-dev-diagnostics-channel.rfc.gpt-5.md` — so round 1
bound on the Claude review alone): LLP 0218 seam reconciled against 0218's
accepted text — `outboxStatus()` extension deferred to 0218 P1's
enumeration (M1); queued-emit cadence pinned to the
relinquishment-to-queued transition with 0218 §4.4 owning trigger/payload
and this channel owning delivery/formatting/coalescing — the matching
amendment 0218 §4.4 schedules (M2); minors: per-client-instance channel
scope, redaction allow-list rescoped with payload-safe scalar facts
permitted, versioned evolution covers new carrier fields not just severity,
dev-seam hoist parenthetical, pilot-score wording, P4 churn-semantics owner
corrected to LLP 0114 alongside 0107, wedge-clear keyed to durable
queue-head advance)
**Revised:** 2026-08-10 (d — **UNREVIEWED** budget-terminal closure of the
round-2 MATERIALs, per
`llp/reviews/0219-client-dev-diagnostics-channel.rfc.{claude,gpt-5}.md`
round 2 (Claude READY with pre-existing clean; GPT NOT READY including a
pre-existing MATERIAL, so the asymmetric third-round condition — in-delta-only
MATERIALs — did not hold and the loop closed at budget): canonical queued
channel event = `SNAPBACK_OFFLINE_MUTATION_QUEUED`, React code demoted to a
compatibility projection with reporter dedup (GPT M1, Claude m4); wedge
deadline scheduler owned and disposed by the client channel, adapters only
consume (GPT M2, Claude m3); carrier evolution requires a distinct version —
legacy `v1` projections decode/filter, silently-widened `v1` ruled out of
OQ2 (GPT M3); minors: per-head wedge clear with fence-held terminal heads
staying active on the acknowledge-cut recovery path (Claude m1, GPT m6);
head-advance observed from durable-store notifications, never diagnostic
history (GPT m7); P1 versioned-carrier wording (Claude m2); explicit-id
gloss (Claude m5); threshold-vs-code tunability wording (Claude m6); P4
LLP 0107 scope gains the advisory delivery-surface reroute preserving its
once-per-pair pin (Claude m7); settlement wording updated to 0218-accepted
with 0107 amendment co-landed (GPT m4); first-loud "session" pinned to
client-instance lifetime (GPT m5))
**Related:** LLP 0218 (outbox settlement contract and platform-owned drain,
Accepted from the same pilot batch — its queued/wedged diagnostic events flow
through this channel, and its §4.1/§4.4 own the `outboxStatus()` extension
and the queued-event trigger/payload this channel consumes),
LLP 0114 (first-class React and query groups — the subscription surface the
churn detector observes), LLP 0193 (errors-as-docs: every warning here must meet
its code + fix/guide-anchor floor), LLP 0156 (minimal error tracking — its E3
client-crash ingest is the explicit *non*-scope boundary of this RFC),
LLP 0012 §Diagnostic Schema and §React and Expo Requirements (the adapter
diagnostic contract this channel implements), LLP 0010 §Diagnostic Shape,
LLP 0043 §Raw settlement facts (the channel reports facts, never invents
settlement), LLP 0107 (presence/optimistic lifecycle and advisory delivery
pins; its queued-rejection contract is superseded by LLP 0218's accepted
union with the 0107 amendment co-landing at 0218 P3 — this channel observes,
never changes, those semantics), LLP 0208 G1
(outbox drain/observability gap — updated by this RFC without changing its
drain decision), LLP 0201 + `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`
(the pilot that produced the evidence),
`issues/20260809-live-hook-args-saturation-diagnostics.md`,
`issues/closed/20260809-outbox-silent-queue-dx.md`

## Summary

The Clique P2 pilot produced two client-side dark loops, both costing hours
of a build that scored B10 diagnostics at 55 — tied with offline (B4) and
search (B6) as the weakest builder dimensions above auth's 48:

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
  (`issues/closed/20260809-outbox-silent-queue-dx.md`, pilot record F5).

Current main has fixed the immediate defects — content-keyed hook inputs
(`issues/closed/20260806-usesnapbackquery-inline-args-resubscribe.md`), a
distinct `SnapbackQueuedMutationError` class, an immediate queued warning and
a 30-second wedge warning (`QUEUED_MUTATION_WEDGE_WARNING_MS`,
`packages/snapback-react/index.mjs:57`), and `useSnapbackOutbox()`. But those
fixes are fragmented: direct `console.warn` calls
(`packages/snapback-react/index.mjs:~1000–1040`), a 64-entry React inspection
diagnostics array (`packages/snapback-react/index.mjs:309,409`), and separate
bounded outbox rings in the headless client (`__outboxDiagnostics`,
`packages/snapback-client/index.mjs:2139`). Console text is the de-facto
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
`positiveDevelopmentEnvironment()` seam — today defined in
`packages/snapback-react/index.mjs:83`, hoisted or shared into the client
so headless and Expo hosts get the same positive identification — never a
production default).
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
  emission; no timers per event — wedge-class conditions use exactly one
  deadline scheduler **owned and disposed by the channel owner itself**,
  event-driven off outbox notifications, so headless and Expo hosts get
  identical scheduling and multiple bound providers cannot duplicate it;
  adapters and providers consume the channel, they never own scheduling.
  The channel is owned **per client instance** (process-local: history dies
  with the process); the React hook and observer project the bound
  provider's client channel, and "session"-scoped behavior in this RFC
  means client-instance lifetime.
- Events carry the LLP 0012/0010 shape: stable `SNAPBACK_*` code (registered
  in `diagnostic-codes.d.mts`), severity, subsystem, message, details,
  occurrence metadata. The existing carrier hardcodes
  `severity: 'error'` (`packages/snapback-client/index.d.mts:9`,
  `packages/snapback-react/index.mjs:111` freezes
  `snapback.client-diagnostic.v1`); warning-class events and every
  carrier-shape addition this channel needs (`subsystem`, occurrence
  metadata) ship under a **distinct carrier version** — a silently widened
  `v1` is not a versioned evolution, because old consumers would see new
  severity values and fields under the frozen discriminator. Legacy
  projections (`onDiagnostic`, `inspection().diagnostics`) explicitly
  decode the new version down to a `v1`-shaped view, filtering or
  conservatively mapping what `v1` cannot express; nothing ever emits new
  values under the old version tag.
- **Redaction is structural:** raw args, presence values, credentials, and
  mutation payloads never enter the channel. Argument- and payload-derived
  material is limited to generated references, hook kinds, sequence
  numbers, hashed canonical-input identities, and a dev-only captured call
  site (once per hook instance); payload-safe scalar facts the detectors
  need (queue depth, ages, transition counts and timing, transport
  provenance) are permitted.
- Every developer-actionable event meets the LLP 0193 floor: name the
  violated rule and a current fix or resolving guide anchor. Until LLP 0146
  OQ6 settles the structured-remediation carrier, use the existing
  text-plus-guide-anchor form; do not freeze a rival `remediations` field.

### Producers (pilot-scoped detectors)

- **`SNAPBACK_REACT_SUBSCRIPTION_CHURN` / `SNAPBACK_REACT_PRESENCE_PUBLISH_CHURN`:**
  warn after N committed resource transitions for one hook instance inside a
  short window (starting point: 8 in 2 s; the thresholds are tunable
  configuration whose shipped values P2's stress fixtures set — the
  registered `SNAPBACK_*` codes are stable regardless of tuning). The
  warning **names the hook site** (captured
  call site + generated reference + hook kind + transition count/timing).
  Exclusions: the Strict Mode setup/cleanup pair and HMR handoff. Content
  keying remains the primary correctness fix — the detector must *not* warn
  for fresh but content-equal args, which main deliberately supports; it
  catches genuinely changing inputs and future regressions.
- **Outbox queued/wedged:** the canonical queued channel event is
  `SNAPBACK_OFFLINE_MUTATION_QUEUED` — the code the durable layer already
  records — emitted synchronously at the **relinquishment-to-queued
  transition**: every relinquishment, not every durable insertion, since an
  explicit-id online dispatch commits the durable record before delivery.
  The existing React-arm `SNAPBACK_REACT_MUTATION_QUEUED` warning becomes a
  compatibility projection of that one event, not a second event; the
  default reporter deduplicates the pair to one line per transition.
  LLP 0218 §4.1/§4.4 own the trigger cadence and the queued payload; this
  bullet is the matching producer-cadence amendment 0218 §4.4 schedules.
  0218's first-queued-dispatch loud promotion ("session" = client-instance
  lifetime, the channel's own scope) is realized as the default reporter's
  dedup/cooldown policy; the channel owns delivery, formatting, and
  coalescing. Maintain
  `SNAPBACK_REACT_MUTATION_QUEUE_WEDGED` as an *active condition* after the
  30 s threshold, carrying queue depth, oldest-pending age, head
  mutation/sequence, transport provenance, and the current recovery path
  (`useSnapbackOutbox().replay()`, or LLP 0218's drain once landed). The
  condition is keyed to the durable queue head, observed from the durable
  store's own outbox notifications (the `subscribeOutbox` seam, which
  carries head identity/sequence) — never inferred from the bounded
  diagnostic history. While the head is unchanged the condition stays
  active (a failed replay attempt clears nothing); when the head advances,
  it clears and re-arms against a still-pending successor. A fence-holding
  terminal head (0218's `resultGone`, which blocks its successor until the
  explicit acknowledge cut) keeps the condition active with the recovery
  path switched to that acknowledge cut, surfaced via `outboxStatus()`'s
  blocked reason. The channel reports LLP 0043 raw settlement facts; it
  does not invent settlement or reorder replay — settlement semantics are
  LLP 0218's accepted union and its co-landed LLP 0107 amendment, which
  this channel observes and never changes.

### Consumers and compatibility

- Default dev reporter: subscribes to the channel, deduplicated
  `console.warn`; existing direct warns in `packages/snapback-react/index.mjs`
  (queued, wedge, optimistic-replay advisories, internal errors) reroute
  through it so console text stops being the source. The reroute preserves
  LLP 0107's normative delivery pins (one advisory per (mutation, query)
  pair per provider); the P4 amendment records the new delivery surface.
- `useSnapbackDiagnostics()` and `observeSnapbackDiagnostics(provider,
  listener)` mirror the existing outbox hook/observer pattern
  (`useSnapbackOutbox`/`observeSnapbackOutbox`,
  `packages/snapback-react/index.mjs:3562` region). `onDiagnostic` and
  `inspection().diagnostics` remain as compatibility projections. Headless
  `outboxDiagnostics`/`subscribeOutbox`/`outboxStatus()` are preserved. The
  `outboxStatus()` extension (`oldestPendingAtMs`, drain phase, last
  attempt, next retry, payload-free blocked reason) is owned and landed by
  LLP 0218 P1; this channel only consumes those fields — the wedged
  condition reads them, it does not define them.
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
  registration; versioned carrier evolution (distinct-version severity
  widening + new fields); bridge `__outboxDiagnostics`.
  *Proof:* unit tests for bounds, coalescing/drop accounting, redaction,
  active-condition lifecycle, schema-version decode.
- **P2 — producers.** Churn detectors + queued/wedged conditions rerouted
  through the channel; default dev reporter; production suppression.
  *Proof:* package tests for positive dev detection, prod silence, Strict
  Mode/HMR exclusion, no-warn on content-equal args, warn inside the churn
  window, immediate queued emit at the relinquishment cut, 30 s wedge,
  terminal clearing; parity fixture across `onDiagnostic`/hook/observer.
- **P3 — acceptance bar.** Test app reproducing both pilot pathologies
  (unmemoized genuinely-changing hook args; forced connectivity-refusal
  enqueue with no drain). *Proof:* an acceptance run showing each pathology
  surfaced, site-named, with recovery path, within one screenful of console —
  the minutes-not-hours demonstration this RFC is accepted against.
- **P4 — docs.** Amend LLP 0012 (channel/projection contract), LLP 0114
  (subscription-churn detector semantics over its query-group/hook
  surface), and LLP 0107 (presence-churn + queue-condition semantics + the
  advisory delivery-surface reroute under its once-per-pair pin);
  update LLP 0208 G1; add a `clients.dev-diagnostics` capability row;
  update `guide/clients/react.md`, `guide/sync/offline-and-retention.md`,
  `guide/operating/diagnostics.md`.
  *Proof:* `node scripts/check-guide.mjs` + `./ref-check --verbose` green.

## Open questions

1. Churn thresholds (8 transitions / 2 s) are a consultation starting point,
   not measured; P2's stress fixtures set the shipped numbers.
2. Carrier-evolution shape — what the distinct next version looks like
   (`v2` union vs. a version-tagged superset) — is an implementation-time
   call; the binding constraints are a distinct version tag and legacy `v1`
   projections that decode/filter (a silently widened `v1` is ruled out).
3. Whether repeated evidence shows dev environments where neither console nor
   agent observers are usable (e.g. physical-device Expo sessions) — that
   would pull the optional overlay forward into the same tranche, still as a
   channel consumer.
