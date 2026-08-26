# LLP 0219: Client dev diagnostics channel

**Type:** RFC
**Status:** Accepted
**Systems:** JS headless client, React/Expo adapters, Client diagnostics, Wire Protocol, Live Queries, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-26 (draft-pending-review `live_delivery_pressure.v1`
negotiation, per-subscription interest, durable both-lane/reconnect-response
carrier, FIFO/enqueue-failure rule, and synchronous diagnostic insertion;
design only).
**Revised:** 2026-08-24 (the React provider adds the payload-safe
`SNAPBACK_REACT_PRESENCE_VALUE_CHURN` producer at the actual presence-publish
boundary: only consecutive changed values advance it; initial publishes,
content-equal no-ops, heartbeats, and superseded intents do not. The warning
names the generated presence key and the stable bound-value repair.)
**Revised:** 2026-08-10 (re-land reconciliation over LLP 0218 P3 and the
static React package split: queued dispatch resolves the authoritative union,
the React queued code is diagnostic-only, the client owns the wedge deadline,
and `useSnapbackOutbox().drainNow()` / the provider-owned drain are the
current recovery surface)
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
churn detector observes), LLP 0094 (closed DTO evolution and exact pressure
offers), LLP 0095 (both-lane client lifecycle), LLP 0200
(server overload conversion/order), LLP 0267 (overload episode registry and
inspection join), LLP 0193 (errors-as-docs: every warning here must meet
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

At proposal time main had fixed the immediate defects — content-keyed hook inputs
(`issues/closed/20260806-usesnapbackquery-inline-args-resubscribe.md`), a
distinct `SnapbackQueuedMutationError` class, an immediate queued warning and
a 30-second wedge warning (`QUEUED_MUTATION_WEDGE_WARNING_MS`,
`packages/snapback-react/index.mjs:57`, before the static package split), and
`useSnapbackOutbox()`. But those
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
positively-identified dev builds through the shared
`positiveDevelopmentEnvironment()` seam in
`packages/snapback-client/client-diagnostics.mjs`, so headless, React, and
Expo hosts get the same positive identification — never a production default.
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
  `packages/snapback-react/implementation.mjs` freezes
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
- **`SNAPBACK_REACT_PRESENCE_VALUE_CHURN`:** the provider warns after N
  consecutive actual presence publishes change the canonical value for one
  generated presence key inside the short detector window (the hook-churn
  starting point, 8 in 2 s, is shared). The first actual publish establishes
  a baseline; content-equal local no-ops, provider heartbeats, and superseded
  intents do not advance the counter. The payload-safe event names the
  generated key, transition count, and timing only — never the scope or
  presence value — and tells the developer to bind and memoize stable peer
  state rather than including timestamps, counters, or draft text.
- **Outbox queued/wedged:** the canonical queued channel event is
  `SNAPBACK_OFFLINE_MUTATION_QUEUED` — the code the durable layer already
  records — emitted synchronously at the **relinquishment-to-queued
  transition**: every relinquishment, not every durable insertion, since an
  explicit-id online dispatch commits the durable record before delivery.
  The React arm emits `SNAPBACK_REACT_MUTATION_QUEUED` as a compatibility
  channel event carrying the same durable identity; the default reporter
  deduplicates the canonical/compatibility pair to one line per transition.
  LLP 0218 §4.1/§4.4 own the trigger cadence and the queued payload; this
  bullet is the matching producer-cadence amendment 0218 §4.4 schedules.
  0218's first-queued-dispatch loud promotion ("session" = client-instance
  lifetime, the channel's own scope) is realized as the default reporter's
  dedup/cooldown policy; the channel owns delivery, formatting, and
  coalescing. Maintain
  `SNAPBACK_REACT_MUTATION_QUEUE_WEDGED` as an *active condition* after the
  30 s threshold, carrying queue depth, oldest-pending age, head
  mutation/sequence, transport provenance, and the current recovery path
  (`useSnapbackOutbox().drainNow()`; the provider-owned drain runs by
  default). The
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
  `console.warn`; existing direct warns in
  `packages/snapback-react/implementation.mjs`
  (queued, wedge, optimistic-replay advisories, internal errors) reroute
  through it so console text stops being the source. The reroute preserves
  LLP 0107's normative delivery pins (one advisory per (mutation, query)
  pair per provider); the P4 amendment records the new delivery surface.
- `useSnapbackDiagnostics()` and `observeSnapbackDiagnostics(provider,
  listener)` mirror the existing outbox hook/observer pattern
  (`useSnapbackOutbox`/`observeSnapbackOutbox` in the shared
  `packages/snapback-react/implementation.mjs`). `onDiagnostic` and
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
- **Out of scope:** no server route, no telemetry database, no
  channel-owned replay/drain, no settlement-semantics change, no LLP 0156
  client ingest. LLP 0218 P3 independently owns the landed automatic drain.
  Process-local means history dies on reload; acceptable for dev advisories
  because authoritative outbox conditions are reconstructed from the durable
  store.

## Phases

- **P1 — channel core.** `client-diagnostics.mjs` + types + code
  registration; versioned carrier evolution (distinct-version severity
  widening + new fields); bridge `__outboxDiagnostics`.
  *Proof:* unit tests for bounds, coalescing/drop accounting, redaction,
  active-condition lifecycle, schema-version decode.
  *Status (2026-08-10):* landed —
  `packages/snapback-client/client-diagnostics.mjs` (+ `.d.mts`), per-client
  channel wiring with `diagnosticsChannel()` and close-time disposal, the
  `__outboxDiagnostics` bridge (queued = warning, refusal/stranded classes =
  error), OQ2 resolved as a `snapback.client-diagnostic.v2` version-tagged
  superset with `projectDiagnosticV1` decode/filter; proof green in
  `client-diagnostics.test.mjs` (bounds, coalescing/drop accounting,
  structural redaction, active-condition lifecycle, single-deadline
  scheduler, v1 projection).
- **P2 — producers.** Churn detectors + queued/wedged conditions rerouted
  through the channel; default dev reporter; production suppression.
  *Proof:* package tests for positive dev detection, prod silence, Strict
  Mode/HMR exclusion, no-warn on content-equal args, warn inside the churn
  window, immediate queued emit at the relinquishment cut, 30 s wedge,
  terminal clearing; parity fixture across `onDiagnostic`/hook/observer.
  *Status (2026-08-10):* landed — client half: shared
  `positiveDevelopmentEnvironment()` hoisted into `@expo/snapback-client`,
  default dev console reporter (queued-pair dedup keyed by
  `clientMutationId`, first-loud pinned to client-instance lifetime,
  `devDiagnosticsReporter: false` opt-out), and the wedge active condition
  owned by the client channel's single deadline scheduler, keyed per durable
  head read from the store's own records (failed replays clear nothing;
  result-gone heads stay active with the acknowledge-cut recovery path);
  LLP 0218 attachment points are marked in code where its `outboxStatus()`
  extension and drain recovery land. React half: per-hook-instance churn
  detectors on committed descriptor-identity transitions (dev-only call-site
  capture, Strict Mode/HMR excluded, content-equal args never counted),
  `SNAPBACK_REACT_MUTATION_QUEUED` demoted to a channel compatibility
  projection with no React-owned timer, replay-divergence/HMR-reload/internal
  errors rerouted through the channel (0107 once-per-pair pin preserved,
  reload notice keeps a console fallback), and
  `useSnapbackDiagnostics()`/`observeSnapbackDiagnostics()` projecting the
  bound client's channel. Proof green in `client-diagnostics.test.mjs` and
  `dev-diagnostics.test.mjs` plus both full package suites.
  *0218 P3 attachment (2026-08-10, re-land):* queued delivery now attaches to
  the landed relinquishment-to-queued union cut. The headless client emits
  the canonical `SNAPBACK_OFFLINE_MUTATION_QUEUED` fact there; React resolves
  `status:'queued'`, emits only the reporter-deduplicated compatibility
  diagnostic, owns no wedge timer, and leaves drain scheduling to the
  provider-owned LLP 0218 controller.
  *0218 P1 attachment (2026-08-10, same day):* LLP 0218 P1 landed
  (9f62b14e2) and the marked attachment points are consumed: the wedge fact
  now carries `outboxStatus()`'s landed `oldestPendingAtMs`,
  `blockedReason` (named in the wedge line: not-writer /
  custody-unsettled), `drainPhase`, and pass-through `nextRetryAtMs`;
  0218's landed uncovered-range relinquishment code
  `SNAPBACK_OPERATION_RANGE_UNCOVERED_QUEUED` is treated as a queued
  transition (trigger + reporter dedup + warning severity) without
  synthesizing a canonical event — canonical-code unification stays with
  0218 §4.4. Head identity still comes from store records via the
  notification seam, never diagnostic history.
  *Concurrent-landing reconciliation (2026-08-10):* main's lane H
  (03dd340da, LLP 0043 M1) independently landed
  `SNAPBACK_REACT_LIVE_HOOK_ARGS_IDENTITY_CHURN` — a dev-only advisory for
  fresh-identity-but-content-equal args (5 consecutive renders, warn once
  per hook instance). That detector is complementary, not rival: it warns
  where content keying is saving the subscription but memoization is still
  owed; this RFC's detector warns where inputs genuinely change and the
  subscription actually churns. Per this RFC's reroute rule the lane H
  advisory keeps its detection semantics and site capture and now delivers
  through the channel as a producer (`react-runtime.mjs
  diagnoseLiveHookArgsIdentity`), with its direct console line preserved
  only as the no-channel fallback. Two codes, two conditions, one delivery
  surface.
- **P3 — acceptance bar.** Test app reproducing both pilot pathologies
  (unmemoized genuinely-changing hook args; forced connectivity-refusal
  enqueue with no drain). *Proof:* an acceptance run showing each pathology
  surfaced, site-named, with recovery path, within one screenful of console —
  the minutes-not-hours demonstration this RFC is accepted against.
  *Status (2026-08-10):* landed —
  `packages/snapback-react/dev-diagnostics-acceptance.test.mjs`: an
  app-shaped run over the real provider machinery reproducing both pilot
  pathologies with a captured console and one screenful defined as 40 lines.
  The undrained acceptance leg explicitly selects
  `outboxDrain:'manual'`; the shipped default remains LLP 0218 P3's
  provider-owned automatic drain. Queued dispatch resolves the P3 union rather
  than throwing the deprecated compatibility class.
  Acceptance evidence: churn surfaced at captured console line 1
  (site-named, with the memoize/hoist fix), queued surfaced at captured
  line 1 (single deduplicated canonical line), wedge surfaced at captured
  line 2 after the (shortened-for-test) threshold with queue depth, head
  identity/sequence, and recovery path; the content-equal control produced
  zero churn lines and the wedged condition was visible on
  `useSnapbackDiagnostics()`/`observeSnapbackDiagnostics` snapshots. The
  ~50-minute silent bisection and the multi-hour wedge each surface within
  the first two console lines.
- **P4 — docs.** Amend LLP 0012 (channel/projection contract), LLP 0114
  (subscription-churn detector semantics over its query-group/hook
  surface), and LLP 0107 (presence-churn + queue-condition semantics + the
  advisory delivery-surface reroute under its once-per-pair pin);
  update LLP 0208 G1; add a `clients.dev-diagnostics` capability row;
  update `guide/clients/react.md`, `guide/sync/offline-and-retention.md`,
  `guide/operating/diagnostics.md`.
  *Proof:* `node scripts/check-guide.mjs` + `./ref-check --verbose` green.
  *Status (2026-08-10):* landed — the four LLP amendments, shipped
  `clients.dev-diagnostics` capability row, and React/offline/operating Guide
  sections now describe the P1–P3 implementation, including LLP 0218 P3's
  relinquishment cadence, resolved queued union, and provider-owned drain.
  Guide/reference/flat projections were regenerated; guide check,
  ref-check, and package-test inventory are green. Existing code already
  carried the decision-bearing LLP 0219 refs, so P4 added no mechanical refs.

## Draft live-delivery-pressure carrier amendment — 2026-08-26

**DRAFT-PENDING-REVIEW — design only.** This amendment owns the proposed
server-to-client carrier and its channel insertion for contention Wanted #4.
It does not own overload detection (LLP 0200), episode registry semantics (LLP
0267), client lifecycle (LLP 0095), or group publication (LLP 0114), and changes
no served wire until accepted.

### Exact negotiation and subscription targeting

The exact capability token is `"live_delivery_pressure.v1"`. A fresh
`POST /connection/open` request offers it in
`liveDeliveryPressureProtocol`; an accepting response echoes the same field and
adds `liveDeliveryPressureMaxAtomicHoldMs`, a positive finite integer. The
binding is immutable for the connection grant lineage. Re-open may confirm but
not add/remove it; a fresh grant negotiates again.

A v1 client rejects the capability when the echo is absent/different or the
hold is absent, non-integer, non-positive, or greater than 120,000 ms. A server
may offer it only when that finite hold is not shorter than its configured
within-capacity LLP 0200 service/convergence envelope. Ordinary clients and
subscriptions remain eligible without the offer; LLP 0114 atomic own-write
mutation dispatch alone requires the exact accepted pair.

LLP 0094 owns the closed-DTO staging and legacy matrix. In particular, the
client sends the open field only after target capability preflight; an absent
offer creates an ordinary unnegotiated lineage; and mounting an atomic group
after that open refuses with `SNAPBACK_LIVE_DELIVERY_PRESSURE_UNAVAILABLE` and
guidance to create a fresh preflighted provider/connection. Re-open never
upgrades the lineage and the client does not silently retry an atomic group
through the ordinary offerless fallback.

Negotiation is only grant-wide permission. Emission additionally requires the
subscription's exact LLP 0094 `liveDeliveryPressureInterest` subscribe offer
and output echo, including positive never-reused subscription and interest
generations. An absent/mismatched echo is not participation. The server stores
no interest and emits no pressure for an ordinary subscription even when its
connection is negotiated; this carrier cannot perturb that subscription's
pre-amendment trace.

### Durable carrier, not socket control

The carrier is the following closed `LiveEnvelope` member:

```json
{
  "kind": "live_delivery_pressure",
  "subscription_id": "sub_...",
  "subscription_generation": 7,
  "pressure_interest_generation": 3,
  "episode_scope": "opaque-server-scope",
  "overload_episode_seq": 42,
  "wave_seq": 913,
  "coverage_through": 1088,
  "cause": "max-hold-overload"
}
```

It is deliberately not a `LiveSocketServerFrame`: the diagnostic must survive
the poll lane. Lane L emits the member bare in the socket's durable union. Lane
P serializes the byte-identical member as the payload of the ordinary
`RealtimeEnvelope::Durable` item. LLP 0095 owns unwrap, drain-handoff/
redelivery dispositions,
generation fencing, duplicate/stale behavior, and reconnect transitions.
If accepted, LLP 0094's schema/fixture registry must mechanically admit the
new open fields and closed envelope member; semantic ownership remains here.

`episode_scope` is an opaque, non-secret scope for one connection grant
lineage. `overload_episode_seq` is positive and strictly increasing only
inside that scope; a fresh lineage uses a fresh scope and may restart the
number at 1. `wave_seq` is the first LLP 0267 wave that converted the episode,
and `cause` has the single v1 value shown. Reprojection/retry reuses the exact
episode key and immutable wave/cause; a monotone extension may only raise
`coverage_through`.

### Producer, FIFO, and enqueue failure

There is one producer: LLP 0200's off-commit
`select_pending_live_subscription` branch after it actually converts pending
Data work to Refresh. It proceeds only when both the connection binding and
the subscription row's current interest pair are exact, asks LLP 0267 to
allocate/extend the current episode, then durably enqueues this projection. A
negotiated-but-uninterested subscription takes the ordinary LLP 0200
conversion path without an episode or carrier. No client clock, revision skew,
`server-pending`, ordinary queue/evaluation/transit, or inspection read may
emit it.

The server preserves FIFO per subscription generation across pressure,
content, watermark, and resync `LiveEnvelope` members. The episode projection
must be durably admitted before its converted Refresh crosses
`LiveEvaluationControl::begin_publication()`. Coalescing/supersession may
replace that Refresh but cannot overtake or discard the current episode. There
is no cross-subscription FIFO claim.

After the real conversion has created the episode, every strict
`coverage_through` raise is a new logical pressure enqueue, including a
coalesced/latest-value supersession that adds a newer owed revision without
another conversion. If an older projection for that episode is still queued,
it may be replaced at the same FIFO position with the greater coverage and
that replacement is the enqueue success; a coalesce that does not raise
coverage performs no pressure enqueue.

Serialization or queue admission failure is fail-closed: the corresponding
Refresh does not enter transport, and LLP 0200 takes its existing typed
`resync_required`/teardown capacity escape. The carrier is never reconstructed
after Refresh publication and never runs in the commit/settlement turn.

### Reconnect response ordering

Durable FIFO does not order T-RECONNECT's HTTP establishment snapshot. LLP
0094 therefore adds the exact same closed DTO as optional
`LiveSubscribeOutput.liveDeliveryPressure`. At the same atomic cut that moves
a current/transferable LLP 0267 episode to the successor, the server captures
that projection under the successor subscription/interest generations. The
client installs it and inserts the diagnostic before it applies the response's
snapshot and before it admits any establishment-produced watermark or replay
envelope. A later durable copy is an idempotent
or monotone confirmation. An episode allocated after the response cut follows
the ordinary FIFO rule above. The successor snapshot can therefore never cover
V and release the group before a pre-existing transferred pressure episode is
observed.

### Channel event

After LLP 0095 accepts a new/extended episode into canonical subscription
state, it synchronously emits the existing warning code
`SNAPBACK_LIVE_OVERLOAD_DEGRADE` into this RFC's v2 channel **before** invoking
interest-scoped group bookkeeping or external-store listeners. Ordinary
query/optionless projections receive neither this pressure notification nor
the sidecar state. The bounded/redacted details
are the pseudonymized subscription identity, subscription generation,
pseudonymized episode scope, episode sequence, first wave sequence, coverage
revision, cause, and the two repairs: keep the explicit LLP 0114 gate when
staged publication is acceptable, or replace the independent set with one
bounded relational/aggregate query. No args, rows, row ids, principals,
credentials, literal origins, or raw caller identifiers enter the event.

Coalescing key is
`(subscriptionIdentityPseudonym, pressureInterestGeneration,
episodeScopePseudonym,
overloadEpisodeSeq)`. Exact duplicate/redelivery increments occurrence
accounting without a second state transition; a monotone coverage extension
updates the active condition under the same key. LLP 0095 protocol-defect
diagnostics for conflicting reuse are separate and cannot replace this
accepted pressure event.

A projection at or below LLP 0095's retired episode/coverage high-water is
consumed as stale before channel insertion: it neither resurrects overload nor
increments this event's occurrence count. A strict same-episode coverage raise
may reactivate it and updates the one active condition.

The resulting cross-owner invariant is diagnostic-before the next LLP 0114
post-gate group notification, not diagnostic-before every child advance.
Ordinary consumers of the canonical child may already have advanced. A typed
authority/lifecycle blank may preempt because it publishes no staged data.

### Acceptance additions

Acceptance must use the real LLP 0200 producer and prove the exact shape and
FIFO on Lane L and Lane P; exact per-subscription interest targeting and
ordinary-subscription silence; poll response-handoff ownership plus
cancelled-drain duplicate; same-lineage reconnect/supersession response
pressure before snapshot with episode-key reuse;
fresh-lineage sequence-scope reset; monotone extension and conflicting reuse;
retired-high-water suppression; strict-raise enqueue versus no-raise coalesce;
enqueue failure preventing Refresh publication; synchronous channel insertion
before post-gate group notification; structural redaction and coalescing; and
the within-capacity control's complete silence. A happy-path live Refresh alone
is insufficient.

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
