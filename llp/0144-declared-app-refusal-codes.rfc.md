# LLP 0144: Declared application refusal codes

**Type:** RFC
**Status:** Draft
**Systems:** Runtime, Code generation, Client protocol, Client integration,
Authoring, Contract, Diagnostics, Guide, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-01
**Revised:** 2026-08-01 (initial draft, commissioned as ballot item 3: the
full option space for application refusal codes, taking the same-day
LLP 0108 §"Declared application refusals" first slice as its settled
floor and designing the remaining axes — payload contracts, wire and
fixture treatment, typed client unions, disposition participation,
action-boundary composition, migration, and taxonomy)
**Related:** LLP 0053, LLP 0070, LLP 0093, LLP 0094, LLP 0095, LLP 0108,
LLP 0115, LLP 0125, LLP 0127, LLP 0131, LLP 0133, LLP 0137

## Summary

Application-semantic refusals — "stale move", "invite consumed", "seat
already claimed" — historically collapsed to the single generic code
`SNAPBACK_HANDLER_FAILED`, forcing acceptance clients in two independent
bakeoffs to key reconciliation branches on message prose while host
refusals enjoyed an exemplary coded vocabulary. A first slice landed on
2026-08-01 (LLP 0108 §"Declared application refusals", normative): a
closed per-function `refusals: [...]` vocabulary, `ctx.refuse(code,
details?)`, the platform carrier `SNAPBACK_APP_REFUSAL` with
`appCode`/`appDetails` in diagnostic details, and fail-closed admission
that folds every undeclared, forged, or bare claim back to the generic
code.

This RFC does not re-open that slice. It records it as the floor,
states the invariants any extension must preserve, and lays out the
option space for what the slice deliberately deferred: payload
validation like a result contract, conformance-fixture and wire
treatment, generated typed rejection unions (LLP 0115 CV-16), retry and
quarantine disposition participation, composition across the action
boundary, migration for pre-declaration apps, and taxonomy/i18n. It is
an RFC of options; where the tree already confirms a direction it says
so, and where a choice is genuinely open it is an open question for the
review loop.

## Motivating evidence

Three LLP 0137 sweep-arm tickets, all filed 2026-08-01 and since
resolved or absorbed, define the wall:

- `issues/closed/20260801-0137-a3-no-structured-app-refusal-codes.md`
  (a3-f3): the A3 board arm's documented conflict semantics ("stale
  move: revision 2, expected 1"), a consumed invite, and a validation
  error were indistinguishable at the code level; the client keyed on
  message text. Its design-analysis section is this RFC's seed, and its
  resolution note records the landed first slice.
- `issues/closed/20260801-0137-a4-action-boundary-collapses-auth-refusals.md`
  (a4-f5): the sibling PLATFORM leg — a nested mutation's trusted
  `SNAPBACK_AUTH_PERMISSION_DENIED` collapsing through the action
  boundary — fixed by the witness-gated restore (`denial_witness` +
  `restore_denial_witness`, src/runtime.rs; LLP 0053's dated 2026-08-01
  note). The fix is deliberately inapplicable to app-minted codes: an
  app refusal has no host-produced witness to corroborate.
- `issues/closed/20260801-0137-a3-restart-evolution-refusal-misattributed-diagnostic.md`:
  the adjacent misattribution leg — when refusals lack identity, the
  diagnostic that does surface can point at the wrong cause.

Two further data points frame the demand. The clean-room protocol
client work recorded the registry angle
(`issues/closed/20260726-0094-refusal-registry-gaps-from-a-clean-room-client.md`):
a client implementing from fixtures alone needs the refusal vocabulary
enumerable, not folkloric. And the sixth sweep arm (A6, the operations
ledger, landing separately from this branch) re-hit the collapse as an
external 0.1.7 consumer: with no refusal channel, its claim/fence
semantics shipped as result-object refusals (`{claimed: false}`,
`{fenced: true}`) — a workable pattern this RFC treats as the
zero-declaration alternative, not a failure, but one that cannot cross
the thrown-error path or the action boundary, and that every app
reinvents ad hoc.

The structural asymmetry is recorded in LLP 0125 (finding 4): the
host-plan lane's `elseError`/`guard` channel already emits app-authored
codes verbatim, while the JS lane's closed allowlist folded everything.
LLP 0127 decision 7 confirmed the correction direction as LLP 0115
CV-16 ("declaration-closed rejection unions as result-contract
variants", owner: the LLP 0108 family — this document).

## The landed floor (2026-08-01)

Recorded here as settled; nothing below re-opens it. Authority:
LLP 0108 §"Declared application refusals"; implementation:
`admit_declared_refusal` and `parse_handler_output_with_claim`
(src/runtime.rs), `validate_declared_refusals` (src/manifest.rs),
`define.mjs` codegen validation, and both envelope decoders (Rust
`handler_envelope_code`; JS `packages/snapback-harness/envelope.mjs`).

1. **Declaration.** A function declares a closed set — `refusals:
   ['STALE_MOVE', 'INVITE_CONSUMED']` — validated at codegen and
   re-validated at manifest load: 1–64 chars, `A-Z0-9_`, at most 64 per
   function, no duplicates, reserved `SNAPBACK_` prefix refused with
   `SNAPBACK_FUNCTION_REFUSAL_DECLARATION_INVALID`.
2. **Raising.** `ctx.refuse(code, details?)` throws a branded error;
   the claimed code and JSON-safe details ride the completion envelope
   beside the platform code `SNAPBACK_APP_REFUSAL`.
3. **Admission.** The host admits the claim only when the invoked
   function declared that code; everything else — undeclared, forged,
   bare claim — folds to `SNAPBACK_HANDLER_FAILED` and the app payload
   is dropped with it. The declared set rides the prepared invocation
   and is empty by default: fail-closed by construction.
4. **Surface.** The refusal arrives as platform code
   `SNAPBACK_APP_REFUSAL` with `appCode`/`appDetails` in diagnostic
   details — beside the platform namespace, structurally unable to mask
   a `SNAPBACK_*` denial.
5. **Effects.** A declared refusal is an ordinary handler failure for
   effect purposes: a refusing mutation commits nothing.

Composition with LLP 0053 is the load-bearing design fact. The pinned
rule — "a thrown object, returned envelope, adapter string, or forged
`{code: …}` is untyped" — is unchanged: the *declaration*, not the
throw, is what types a code. The platform and application legs are now
symmetric in mechanism and opposite in witness: a platform code
survives a boundary only when corroborated by a host-recorded witness
(`denial_witness`), and an app code survives only when corroborated by
a manifest-recorded declaration. Neither trusts handler bytes. Every
option below must preserve that symmetry.

## Invariants for any extension

- **I1.** LLP 0053's pinned untyped-thrown-code rule is never weakened;
  no option may admit a code on the strength of the throw alone.
- **I2.** The `SNAPBACK_*` namespace is structurally unmaskable: app
  codes live in a namespaced field (`appCode`) beside a platform code,
  never in the platform code position, and the reserved prefix is
  refused at declaration.
- **I3.** Fail-closed folding: any path that does not deliberately
  carry the declared set folds every claim; invalid extensions degrade
  to the landed behavior, never past it.
- **I4.** A refusing mutation commits nothing (refusal is not a partial
  effect channel).
- **I5.** Wire tolerance per LLP 0093: unknown fields and unknown app
  codes must be tolerable by conforming clients; the fixture corpus,
  not prose, pins decoder behavior.
- **I6.** Host denials (auth, capability, protocol) remain terminal,
  uniform, and outside this channel.

## Option space

### Axis A — vocabulary declaration surface

- **A1 (landed).** Per-function `refusals: [...]` string list. Cheap,
  local, already shipped. Weakness: shared codes are respelled per
  function, and nothing relates `STALE_MOVE` on `moveIssue` to the same
  concept on `reorderIssue`.
- **A2.** App-level named registry referenced by functions —
  `defineRefusals({ STALE_MOVE: {...} })` with functions declaring
  `refusals: [refusals.STALE_MOVE]`. Fits the LLP 0115 grammar-cluster
  rule ("one declared-contract vocabulary; composite contracts
  reference declared shapes; nothing respells") and gives the clean-room
  client a single enumerable registry (the 0094-gap ticket's ask).
  Additive over A1: a bare string stays sugar for a function-local
  entry.
- **A3.** Schema-bearing declarations: the registry entry (A2) or the
  per-function entry (A1) carries a details validator — `STALE_MOVE:
  v.object({ expected: v.integer(), got: v.integer() })` — reusing the
  LLP 0131 argument-contract grammar verbatim rather than minting a
  refusal-specific one. This is the "payload validated like a result
  contract" half the first slice deferred; it is what makes
  `appDetails` a contract instead of an app-owned blob, and it is the
  prerequisite for typed unions (Axis D) carrying typed payloads.

These compose rather than compete: A1 is the floor, A2 is a naming
layer, A3 is a payload layer on either. The recommended target shape is
A2+A3 riding the CV-4-era grammar work (LLP 0115 Tranche B), because
CV-16 already commits the unions to "the same contract vocabulary".

### Axis B — payload validation semantics

Given a details schema (A3), what happens when a raise violates it?

- **B1 (landed).** No schema; JSON-safety only. `appDetails` is
  app-owned JSON (explicitly recorded in 0108's deferred list alongside
  i18n).
- **B2.** Validate at raise, fold on violation: an invalid payload
  folds the whole refusal to `SNAPBACK_HANDLER_FAILED` exactly like an
  undeclared code (I3's fail-closed instinct). Strictest; a payload bug
  costs the app its code identity at the worst moment — in production,
  on the rare path.
- **B3.** Validate at raise, admit code and drop payload: the client
  keeps the typed `appCode` and loses only the malformed details
  (surfaced as a value-free validation note). Preserves the primary
  product value (branch on code) while still refusing to deliver
  off-contract bytes.
- **B4.** Validate at codegen/dev only; production admits declared
  codes with any JSON-safe payload. Cheapest, but it makes `appDetails`
  a documentation contract rather than an enforced one, which is
  exactly the gap LLP 0131 closed for arguments.

B3 is the draft recommendation: it is the only option where a details
regression cannot destroy the code channel while the payload contract
stays enforced. B2-vs-B3 is a genuine reviewer question (OQ1).

### Axis C — wire, protocol, and fixtures

- **C1 (landed).** Single platform code `SNAPBACK_APP_REFUSAL`;
  `appCode`/`appDetails` inside diagnostic details. No envelope-schema
  change; both decoders already aligned.
- **C2.** Promote `appCode` to a first-class envelope field. This is a
  wire-shape change owned by LLP 0094 (the wire-envelope contract), not
  this document — LLP 0127 decision 7 explicitly delegated the
  action/mutation wire-shape choice and the wide-409 taxonomy to the
  LLP 0094/0095 pair. This RFC's position: C1 is sufficient until 0094
  has a reason of its own; nothing in Axes A–E requires C2.
- **Fixtures (required work under either).** The LLP 0093 conformance
  corpus currently contains no `SNAPBACK_APP_REFUSAL` fixture. The
  channel is only real for native/second-party clients when the corpus
  pins it: a positive fixture (declared code admitted, payload intact),
  the fold fixtures (undeclared code; bare claim; forged `SNAPBACK_*`
  spelling refused at declaration rather than on the wire), and — once
  A3/B lands — the payload-violation fixture for whichever of B2/B3 is
  chosen. Both `handler_envelope_code` legs (Rust decoder; JS
  `envelope.mjs`) must be exercised by the same fixture bytes, since
  their agreement is currently asserted by tests on each side rather
  than by a shared corpus.
- **HTTP status.** Declared refusals ride the existing failed-mutation
  status treatment; whether the wide-409 taxonomy gives app refusals a
  distinct status family is 0094/0095's delegated question, cited here
  only so its answer and this channel do not drift apart.

### Axis D — generation and client typing (CV-16)

The confirmed direction (LLP 0115 CV-16, 0127 decision 7): declaration-
closed rejection unions as result-contract variants, "declared failure
variants in the same contract vocabulary, with the generated failure
union reaching client types". Options for the shape:

- **D1 (today).** Untyped reach-through: clients read
  `error.diagnostic.details.appCode` by hand. Note that the packaged
  web client currently has no dedicated surface for this — only the
  harness decoder names the field — so even D1 needs a documented
  accessor before the guide can teach the channel.
- **D2.** Generated typed unions: `api.d.ts` gives each function a
  refusal union derived from its declaration —
  `MoveIssueRefusal = { appCode: 'STALE_MOVE'; appDetails: {...} } |
  { appCode: 'INVITE_CONSUMED'; ... }` — with a client helper that
  narrows (`isAppRefusal(err, api.moveIssue)`), and the undeclared
  collapse deliberately absent from the union (per CV-16's exit
  criterion: typing must not widen the collapse). With A3 the
  `appDetails` member is typed from the declared schema; without A3 it
  is `unknown`.
- **D3.** D2 plus typed *result* integration: the refusal union joins
  the mutation's result type as a discriminated non-exception return
  (`await mutate(...)` yielding `ok | refusal`), replacing thrown
  errors for declared refusals. This is a larger client-contract change
  (it alters every call site's control flow) and drifts toward the
  result-object pattern apps can already build themselves; the draft
  position is that thrown-with-typed-narrowing (D2) preserves the
  existing client contract while delivering the types. The React arm
  (`useSnapbackMutation`) needs the same treatment either way.

### Axis E — retry, quarantine, and disposition participation

The landed slice: declared refusals participate in no dispositions.
Options:

- **E1 (landed).** None. A declared refusal is terminal for that
  attempt; what to do next is app logic.
- **E2.** Declared per-code hints — `retryable: false`, `quarantine:
  'drop' | 'hold'` — consumed by client mutation queues. The forcing
  context is local-first replay (LLP 0133): when a queued offline
  mutation replays against fresh state and draws a declared refusal,
  the queue must do *something* — silently dropping loses user intent,
  retrying forever wedges the queue. Today that behavior is
  platform-generic; E2 lets the app say per code which refusals are
  conflicts-to-surface versus staleness-to-drop.
- **E3.** Platform disposition classes: a small closed set of declared
  *kinds* (`conflict`, `consumed`, `validation`) with platform-defined
  queue behavior per kind, instead of raw per-code booleans. Less
  expressive, more uniform; resembles the taxonomy axis (H) and risks
  becoming one.

Draft position: keep E1 until LLP 0133's replay semantics force the
question, then prefer E2's minimal hints over E3's taxonomy — but this
is deliberately an open question (OQ3) because 0133 owns half of it.

### Axis F — composition across the action boundary

An action calls `ctx.runMutation('moveIssue', ...)`; the mutation
raises its declared `STALE_MOVE`. What does the action's caller see?

- **F1.** Raising-site admission carries through: the refusal was
  admitted against the mutation's declaration, and the action boundary
  transports the already-admitted `SNAPBACK_APP_REFUSAL` +
  `appCode` verbatim, the way the denial witness transports a platform
  denial. No re-declaration at the action.
- **F2.** Boundary re-admission: each crossing re-checks the code
  against the *crossing* function's declaration, so an action must also
  declare `STALE_MOVE` to let it out. Fail-closed at every layer, at
  the cost of respelling (against the 0115 grammar rule) and of actions
  needing to enumerate their callees' vocabularies.
- **F3.** F1 with an action-level opt-out (`refusals: 'opaque'`) for
  actions that deliberately hide interior semantics.

The a4-f5 witness mechanism is precedent for F1's transport half: the
host already knows, host-side, that the interior invocation produced an
admitted refusal — this is a host-recorded fact, not handler bytes, so
transporting it does not weaken I1. F2's extra declaration adds no
integrity (the fact is host-recorded either way) but does add authorial
control over what leaks. The draft leans F1 for mutations-inside-
actions with F3's opt-out considered; genuinely open (OQ2), and the
current implemented behavior for this exact composition must be pinned
by a test either way.

### Axis G — migration for pre-declaration apps

The channel is additive, so migration is about teaching and tooling,
not compatibility breaks:

- Apps that throw `Error` prose today keep folding to
  `SNAPBACK_HANDLER_FAILED`, unchanged.
- The result-object refusal pattern (A3/A6 arms: `{claimed: false,
  reason}`, `{fenced: true}`) remains fully supported and is the right
  shape when a "refusal" is an expected outcome the caller always
  handles; the guide should teach the split explicitly — result objects
  for expected outcomes on the happy read path, `ctx.refuse` for
  exceptional refusals that abort the transaction (I4 is the dividing
  line: refusals commit nothing; result objects can commit receipts,
  which is exactly why the A6 arm's fence receipts used them).
- Declaring `refusals` changes the function manifest and therefore the
  generated artifacts; whether it perturbs `inputsHash`/result-contract
  hashes is deferred in 0108 and restated here as OQ4, because it
  decides whether adding a refusal to a live app is a hot change or a
  versioned-seed-visible evolution.
- Guide work: neither `ctx.refuse` nor the declaration appears anywhere
  in `guide/` today. The channel is not shipped, in the LLP 0061 sense,
  until the mutations page teaches it with a CI-verified snippet and
  the capability index carries the row.

### Axis H — taxonomy and i18n (deferred axis)

Deliberately deferred in 0108 and kept deferred here, with the option
space recorded: H1 fully app-owned codes forever (floor); H2 a
platform-*recommended* (never enforced) common-code vocabulary in the
guide (`CONFLICT_STALE`, `LIMIT_EXCEEDED`, ...) so ecosystems converge
without a registry; H3 message catalogs/i18n riding `appDetails`
conventions. None blocks Axes A–G; H2 becomes attractive only after D2
exists, since shared spellings pay off in shared client narrowing.

## Recommended composition (draft)

The floor (A1/B1/C1/D1/E1) is shipped. The recommended target, staged:

1. **Fixtures first** (Axis C): pin the landed behavior in the LLP
   0093 corpus before extending it — positive, fold, and bare-claim
   fixtures against both decoder legs.
2. **A2+A3 with B3** riding the CV-4-era declared-contract grammar
   (LLP 0115 Tranche B): one vocabulary, referenced not respelled,
   payloads contracted with LLP 0131's grammar, code identity surviving
   payload regressions.
3. **D2 typed unions** (CV-16's committed exit): generated refusal
   unions in `api.d.ts`, a narrowing helper on the packaged client, the
   React arm surfaced, undeclared collapse never widened.
4. **F resolved and pinned** (whichever way) with an end-to-end test of
   the nested-mutation-inside-action composition.
5. **E and H deferred** until LLP 0133's replay semantics and post-D2
   ecosystem pressure respectively force them.

## Open questions

- **OQ1 (payload-violation fold).** B2 (fold everything) versus B3
  (admit code, drop payload) when a declared-schema payload fails
  validation at raise. Draft leans B3.
- **OQ2 (action boundary).** F1 carry-through versus F2 re-admission
  versus F3 opt-out for declared refusals crossing `runMutation` into
  an action envelope — and what the implementation does *today*, which
  must be pinned by a test before this RFC leaves Draft.
- **OQ3 (dispositions).** Whether declared refusals ever carry
  retry/quarantine hints, and whether that design belongs here or in
  LLP 0133's replay/settlement contract. Blocked-on: 0133's queued-
  mutation refusal handling.
- **OQ4 (hash participation).** Do `refusals` declarations (and A3
  payload schemas) participate in result-contract hashes and
  `inputsHash`? 0108 deferred it; the migration story (Axis G) depends
  on the answer.
- **OQ5 (registry scope).** Is A2's app-level registry worth its
  surface, or is per-function A1 plus guide conventions enough until
  H2-style convergence pressure exists?
- **OQ6 (wire promotion).** Does LLP 0094 ever want `appCode` as a
  first-class envelope field or a distinct status family (wide-409)?
  Owned there; recorded here to prevent drift.
- **OQ7 (client accessor now).** Independent of D2's timeline: does the
  packaged web client grow a minimal documented accessor
  (`isAppRefusal(err)` / `err.appCode`) immediately, so D1 is at least
  teachable in the guide?

## Acceptance witnesses (per axis, when adopted)

- A2/A3: a clean consumer declares a registry entry with a payload
  schema once, references it from two functions, and the generated
  manifest carries one shape (no respelling); an off-schema raise
  behaves per the OQ1 ruling with a fixture proving it.
- C: the 0093 corpus round-trips the positive and fold fixtures through
  both `handler_envelope_code` legs byte-identically.
- D2: a seeded `STALE_MOVE` reaches an external TypeScript consumer as
  a narrowed union member with typed details; an undeclared throw stays
  `SNAPBACK_HANDLER_FAILED` and is absent from the union.
- F: the nested-mutation-inside-action composition surfaces the
  declared refusal per the OQ2 ruling in an end-to-end served test.
- G: the guide mutations page teaches `ctx.refuse` beside the
  result-object pattern with CI-verified snippets, and the capability
  index row flips from GAP.
