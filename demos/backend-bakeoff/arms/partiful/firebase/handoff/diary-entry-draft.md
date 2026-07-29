# Partiful / Firebase diary-entry draft

Date: 2026-07-28 to 2026-07-29

Arm: `partiful/firebase`, LLP 0102 deep round

Status: local acceptance complete; hosted evidence unavailable because the isolated Firebase CLI state had no account.

## What felt good

- Firestore transactions were a strong fit for the final-seat RSVP race. The
  callable transaction expressed “read invitation + prior RSVP + attendance,
  reject over-capacity, update RSVP and derived count” in one place, and the
  emulator demonstrated automatic retry under contention. Exactly one of two
  actors got the last seat and the authoritative count stayed at 50.
- Native `onSnapshot` listeners were simple and credible. A second authenticated
  client received the 20-post burst without polling, and the remediation receipt
  separately captures the attendance total changing from 0 to 2 during the same
  burst.
- Rules dependency re-evaluation was better than I expected. Existing listeners
  were terminated with `permission-denied` when guest-list visibility or role
  membership changed. Clearing the app’s retained state in the listener error
  path produced an honest revocation story.
- The Local Emulator Suite made destructive concurrency, authorization, Storage,
  Functions, and ambiguous-effect tests cheap and repeatable. Using a `demo-*`
  style project identity also gives useful safety against accidental production
  access.
- Splitting anonymous event previews, member event state, and host controls into
  distinct documents made the public/private boundary legible in both rules and
  the UI.
- Callable Functions automatically carried the authenticated actor into the
  handler. That kept privileged mutations and provider effects off the browser
  without a separate session/token bridge.

## What felt bad or surprising

- The operational surface was much larger than the app surface. The visible
  Auth/Firestore/Functions/Storage ports were not the whole story: Firebase CLI
  also opened Eventarc, Tasks, the Firestore UI websocket, hub, logging, and
  Pub/Sub listeners. I had to inspect installed CLI source to learn the config
  keys and pin every hidden port for worker isolation.
- Scheduled-function emulation was not self-evident. `onSchedule` was silently
  skipped until Pub/Sub was included. Even once initialized, deterministic
  acceptance needed an authenticated callable that invoked the same reminder
  core; the emulator did not offer a particularly discoverable “run this
  schedule now with this date key” workflow.
- Firestore Rules cannot redact fields, so a natural single event document was
  unsafe for anonymous reads. The three-document split works, but every event
  create/edit now has denormalization and atomicity obligations.
- Storage Rules cannot consult Firestore. The 256 KiB object therefore binds
  host ownership in object metadata instead of checking event membership. That
  is workable but creates security glue and makes role changes less naturally
  authoritative.
- Cross-document server operations still require care. `setCohost` updates the
  event and controls documents separately, which is a small atomicity papercut
  the arm would fix before production.
- Effect idempotency and ambiguity were entirely application-authored. Firebase
  gave excellent transactions and ledgers, but not the end-to-end “known
  success versus ambiguous acceptance” abstraction. The fake provider, stable
  effect keys, attempt ledger, terminal dedupe, and socket-drop remediation were
  all custom code.
- The Functions emulator emitted noisy Admin SDK metadata/config warnings for a
  valid local demo project. These did not affect acceptance, but they lower
  confidence during debugging.
- Frozen installs reported high/moderate npm audit findings, and the minified
  Firebase UI bundle was about 763 KiB before gzip. Both are ecosystem weight
  worth including in holistic scoring.
- The first evidence pass caught a real harness-quality issue: I had proved the
  post burst but not retained the simultaneous RSVP listener transition. The
  correct response was a new fresh remediation namespace, not a narrative pass.

## Snapback lessons

- Match Firebase’s end result for transactional contention: a mutation should
  make its atomic read/write set obvious, retry conflicts safely, and return a
  typed capacity failure with authoritative settlement evidence.
- Match the listener end result on policy change: an already-connected client
  must be actively invalidated, and the client arm should have a standard
  retained-state purge hook rather than leaving each app to remember it.
- Snapback can be materially better by keeping local topology explicit and
  single-command. Every process/listener should appear in one machine-readable
  receipt with assigned ports and cleanup ownership; hidden auxiliary listeners
  are avoidable friction.
- Provide first-class public/private projections so developers do not manually
  maintain three documents just because the policy system cannot hide fields.
- Provide a scheduled-job test API with a frozen logical clock and visible run
  receipt. “Define, trigger locally, inspect one deduped run, retry” should be a
  coherent workflow.
- Provide an effect primitive that records stable idempotency keys, attempts,
  known-success settlement, and ambiguous outcomes without pretending network
  failure means the provider did nothing.
- Unify blob authorization with application data policy. Firebase’s split
  Firestore/Storage rule languages make object authorization harder than the
  rest of the app.
- Keep the emulator’s strongest property: local authorization, transactions,
  listeners, functions, and object storage should be real enough that
  adversarial acceptance is cheap.

## Preliminary holistic impression

Firebase is powerful and mature, especially for local adversarial testing,
transactions, first-party Auth, and live delivery. It is not the lowest-friction
backend for this app: document denormalization, two policy languages, scheduled
function plumbing, hidden emulator topology, and application-authored effect
semantics add substantial glue. It is a strong benchmark for capabilities and
correctness, but not automatically the go-to choice for a small team optimizing
for conceptual economy.
