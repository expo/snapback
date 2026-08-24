# LLP 0144: Declared application refusal codes

**Type:** RFC
**Status:** Accepted
**Systems:** Runtime, Code generation, Client protocol, Client integration,
Authoring, Contract, Diagnostics, Guide, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-01
**Revised:** 2026-08-24 (packaged-accessor amendment: the canonical client now
exports `projectAppRefusal(error)` and `SnapbackAppRefusal`, with identical
React-root and Familiar re-exports; OQ7 is answered while per-operation D2
generation remains future work.)
**Revised:** 2026-08-03 (Accepted 2026-08-03 by the author — decision
sitting #2, "accept all that verify",
`issues/20260803-author-decision-sitting-2.md`; gate verified: the loop
converged dual-family READY 2026-08-01 with zero unresolved concerns and
OQ1 was ruled B3 in the 2026-08-02 packet; OQ2–OQ8 remain open design
questions, none pre-acceptance-blocking; status Review → Accepted).
2026-08-02 (decision-sitting propagation: OQ1 selects B3 — admit
the declared code, drop an invalid payload, and emit the
`appDetailsDropped` diagnostic detail. D2's discriminated union and the wire
carrier key follow from this selection. Source:
`issues/20260802-author-decision-packet.md`). 2026-08-01 (engine-leg admission floor repaired: local admission
now runs after the Ibex/workerd executor join, Cloudflare admits against the
resolved deploy-time function definition through the shared JS admitter, and
the LLP 0048 corpus pins the declared/undeclared/bare-claim triad across all
three serving surfaces; the widened parity ticket is resolved). 2026-08-01 (loop CONVERGED dual-family READY — Fable round 3,
Codex round 4, zero unresolved concerns; artifacts
reviews/0144-declared-app-refusal-codes.{fable,codex}.md. Status
advances Draft -> Review; acceptance is the author's call; the
engine-leg admission floor repair (widened parity ticket) is the
first implementation motion.) 2026-08-01 (v4, round-3 narrow fixes: per Codex R3, the
F1 correlation token's shim-side binding is now non-extractable — a
token branded as an error property would be handler-copyable, so the
`host()` shim holds token-to-error in a shim-private identity map
(WeakMap keyed by the exact error object) and the settle encoder emits
it only by object identity, making replay ≡ rethrow and
catch-invalidation structural (no binding on a replaced error, no
token on the final envelope, no restore) — and the FO-3 contradiction
is resolved by admitting F1's carrier requirement into FO-3's
description: "unobservable" narrows handler-visible surface only, the
structured FFI token carrier still crosses under F1, shim-private.
Parity-ticket wording aligned to per-engine-leg. Per Fable R3's
details: the explicit catch-invalidation bookkeeping rule is dropped
as implicit under the token design, and OQ1's echo now names both the
union grammar and the wire carrier key. Status stays Draft; a narrow
Codex round 4 closes.) 2026-08-01 (v3, round-2 verify-then-fix: the floor's
admission story narrowed again after Fable M-R2-1 proved it short an
ENGINE LEG, not just a host — the only `admit_declared_refusal` call
site is the local Ibex leg (crates/snapback/src/runtime.rs:2726) and the workerd-v8
twin path returns before it (:2682, plain `parse_handler_output` at
workerd_exec.rs:874), so undeclared `ctx.refuse` survives on the local
host under the LLP 0048 twin; floor fact 3 rewritten as a
per-engine-leg admission matrix with the structural fix recorded
(hoist admission into the engine-neutral completion path; witness
restores stay Ibex-side since actions never take the twin), the parity
ticket widened to both unadmitted surfaces, and step 0 / the floor
witness extended to the three-surface triad. Per Codex round-2 F1, the
refusal-witness sketch now keys restoration on an unforgeable
host-minted per-host-call correlation token (code-only matching would
let a caught refusal resurrect stale details onto a later
same-appCode failure) and states FO/F-transport composability
explicitly. Fable details: A2's stale 0094-ticket parenthetical
re-pointed at the analogy, I3 restated normatively (must fold; the
unadmitted surfaces are violations to repair), and B3's value-free
note given its wire carrier (`appDetailsDropped` inside diagnostic
details — a new detail key, not an envelope-schema change — making
D2's `detailsDropped` discriminant client-computable and keeping C1's
posture honest). Status stays Draft.) 2026-08-01 (v2,
round-1 verify-then-fix: all six MATERIAL
findings across both families verified against the tree and applied —
the floor restated per-host after Codex M1 proved it false on the
Cloudflare host (no admission counterpart under targets/cloudflare/src; blocker
ticket 20260801-0144-cloudflare-host-lacks-app-refusal-admission.md);
Axis F rebuilt around the read-out as-built determination (fold always —
`appCode` never crosses the host-call FFI) and split into observation
and transport halves with a refusal-witness sketch (Fable M1, Codex
S5); a disclosure axis and invariant I7 added (Fable M2); Axis C
rescoped — no completion-envelope fixture class exists, three fixture
classes separated, and the live 16-code decoder-allowlist divergence
cited (Fable M3, Codex S3); the public-descriptor `refusals` omission
recorded in the floor (Fable M4); B3+D2 payload typing made
value-consistent (Codex M2); Axis E's gate reworded — LLP 0133 is
Accepted and does not own queue dispositions (Codex S4); OQ4's verified
hash fragments recorded, LLP 0061 added to Related, LLP 0070's Axis E
adjacency named, witness wording fixed, and the 0094-ticket citation
downgraded to analogy per the Fable details). 2026-08-01 (initial
draft, commissioned as ballot item 3: the full option space for
application refusal codes, taking the same-day LLP 0108 §"Declared
application refusals" first slice as its settled floor and designing
the remaining axes — payload contracts, wire and fixture treatment,
typed client unions, disposition participation, action-boundary
composition, migration, and taxonomy)
**Related:** LLP 0053, LLP 0061, LLP 0070, LLP 0093, LLP 0094, LLP 0095,
LLP 0108, LLP 0115, LLP 0125, LLP 0127, LLP 0131, LLP 0133, LLP 0137

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
code. Admission now runs after the local Ibex/workerd executor join and
on the Cloudflare host against the exact deploy-time function definition;
the three-leg LLP 0048 corpus pins the triad on every serving surface.

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
  `restore_denial_witness`, crates/snapback/src/runtime.rs; LLP 0053's dated 2026-08-01
  note). The fix is deliberately inapplicable to app-minted codes: an
  app refusal has no host-produced witness to corroborate.
- `issues/closed/20260801-0137-a3-restart-evolution-refusal-misattributed-diagnostic.md`:
  the adjacent misattribution leg — when refusals lack identity, the
  diagnostic that does surface can point at the wrong cause.

Two further data points frame the demand. The clean-room protocol
client work recorded the registry angle
(`issues/closed/20260726-0094-refusal-registry-gaps-from-a-clean-room-client.md`):
that ticket's recorded gaps are *platform*-code registry gaps; "a
client implementing from fixtures alone needs the refusal vocabulary
enumerable, not folkloric" is this RFC's extrapolation of the same
lesson to app codes — an analogy, not the ticket's recorded ask.
And the sixth sweep arm (A6, the operations
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
(crates/snapback/src/runtime.rs), `validate_declared_refusals` (crates/snapback/src/manifest.rs),
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
3. **Admission — every serving surface.** `admit_declared_refusal`
   admits the claim only when the invoked function declared that code;
   everything else — undeclared, forged, bare claim — folds to
   `SNAPBACK_HANDLER_FAILED` and the app payload is dropped with it.
   The declared set rides the prepared invocation and is empty by
   default. The admission matrix as built:
   - *Local host, Ibex and workerd-v8 legs*: both executors join in
     `run_ibex_handler_with_context_until`, and one engine-neutral
     completion seam admits against `invocation.declared_refusals`.
     Denial-witness restoration remains after that join; actions stay on
     Ibex, so its action-scoped authority is unchanged.
   - *Cloudflare host*: the JS envelope decoder remains claims-only;
     `admitDeclaredRefusal` then adjudicates against `fn.refusals` from
     the exact deploy-time function definition resolved for the
     invocation, before platform classification or response rendering.
   The LLP 0048 conformance corpus runs declared, undeclared, and bare
   claims through the local Ibex leg, local workerd-v8 twin leg, and
   Cloudflare host, comparing the admitted payload for the declared case
   and the generic payload-free fold for the other two. Resolved ticket:
   `issues/closed/20260801-0144-cloudflare-host-lacks-app-refusal-admission.md`.
4. **Surface.** The refusal arrives as platform code
   `SNAPBACK_APP_REFUSAL` with `appCode`/`appDetails` in diagnostic
   details — beside the platform namespace, structurally unable to mask
   a `SNAPBACK_*` denial. Decoder parity is *claims* parity: both
   decoder legs extract the claimed carrier identically on the refusal
   branch; each host then adjudicates the claim at its manifest-backed
   completion seam (fact 3).
5. **Effects.** A declared refusal is an ordinary handler failure for
   effect purposes: a refusing mutation commits nothing.
6. **Enumerability — deliberately absent from the protocol surface.**
   `PublicFunctionDefinition` drops `refusals` on purpose ("the public
   identity descriptor does not restate it", crates/snapback/src/manifest.rs:4582–4585)
   while the generated functions manifest carries it
   (packages/snapback-codegen/index.mjs). The vocabulary therefore
   reaches codegen consumers but is **not enumerable from the served
   protocol surface** — a floor fact Axis A2's registry pitch, OQ5, and
   OQ6's quieter manifest-surface sibling must argue against.
7. **Boundary composition — total collapse today.** A refusal raised in
   a nested mutation never survives the action boundary in any form:
   the as-built determination is recorded in Axis F.

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
- **I3.** Fail-closed folding, stated normatively: any completion path
  that does not deliberately carry and adjudicate the declared set
  **must fold every claim** — decoding a claim is never admitting it.
  The three-leg triad in floor fact 3 pins the repaired invariant; any new
  engine leg or host inherits the same obligation before it serves handlers.
- **I4.** A refusing mutation commits nothing (refusal is not a partial
  effect channel).
- **I5.** Wire tolerance per LLP 0093: unknown fields and unknown app
  codes must be tolerable by conforming clients; the fixture corpus,
  not prose, pins decoder behavior.
- **I6.** Host denials (auth, capability, protocol) remain terminal,
  uniform, and outside this channel.
- **I7.** Refusal codes and details are **caller-visible bytes raised
  from inside permission-gated functions**: where LLP 0053 keeps
  platform denials uniform and non-disclosing, this channel is
  app-authored disclosure by construction. The ordering of auth gates
  relative to `ctx.refuse`, and what may enter `appDetails`, are part
  of the app's disclosure surface; no extension may blur that fact or
  imply the platform vets refusal content (Axis I).

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
  client a single enumerable registry (the clean-room lesson this RFC
  extrapolates from the 0094-gap ticket by analogy — see §Motivating
  evidence — and unreachable either way while floor fact 6 stands).
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
  off-contract bytes. **The note needs a stated wire carrier**, because
  `appDetails: null` alone is ambiguous — `ctx.refuse(code)` with no
  details also yields null — and D2's `detailsDropped` discriminant
  must be client-computable: the carrier is `appDetailsDropped: true`
  set beside `appCode` *inside the existing diagnostic-details map*
  (absent otherwise). That is a new detail key, not an envelope-schema
  change — diagnostic details are an open map — so C1's
  no-envelope-change posture survives, but the key is contract surface
  the moment D2 generates from it: it must be named normatively and
  pinned by an admission fixture, never inferred.
- **B4.** Validate at codegen/dev only; production admits declared
  codes with any JSON-safe payload. Cheapest, but it makes `appDetails`
  a documentation contract rather than an enforced one, which is
  exactly the gap LLP 0131 closed for arguments.

B3 is selected: it is the only option where a details regression cannot
destroy the code channel while the payload contract stays enforced.

**Decision — 2026-08-02: B3.** A declared code remains admitted when its
payload fails validation; the invalid payload is dropped and the diagnostic
details carry `appDetailsDropped: true`. This fixes D2's union as the
discriminated valid-payload/dropped-payload pair and makes
`appDetailsDropped` the normative wire carrier key. Source:
`issues/20260802-author-decision-packet.md`.

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
- **Fixtures (required work under either, larger than it looks).** The
  LLP 0093 corpus (`schemas/live.wire-fixtures.v1.json`, contract in
  LLP 0095 §2) contains no `SNAPBACK_APP_REFUSAL` fixture — and more:
  it has **no completion-envelope fixture class at all** (its fixtures
  are live-protocol frames, negotiation, and lifecycle steps;
  `mutation.output` is a separate schema outside the corpus). Step 1 of
  the recommended composition is therefore a corpus-contract extension
  — deciding where handler-completion fixtures live is a
  formatVersion-bump-class change under 0095 §2's own precedent, and
  lands in the 0094/0095 delegation's territory — not an additive
  fixture drop. Three fixture **classes** must stay separate (they test
  different authorities):
  1. *envelope decoding* — bytes in, claimed carrier out (decoder
     parity across both `handler_envelope_code` legs);
  2. *host admission* — decoded claim plus a declared set in, admitted
     or folded judgment out (the declared/undeclared/bare-claim triad;
     both hosts must consume the same semantic admission vectors — now
     pinned by the three-leg LLP 0048 conformance corpus);
  3. *declaration validation* — invalid manifest/codegen inputs
     (including the reserved `SNAPBACK_*` spelling, which is a
     codegen/manifest fixture, never a wire fixture).
  Today the semantic triad is pinned on both local engines and the
  Cloudflare serving path by the LLP 0048 conformance corpus; the separate
  completion-envelope fixture class remains open. And the decoder-parity
  argument is stronger than hygiene: the two allowlists already diverge
  by 16 codes (Rust-only: `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`,
  `SNAPBACK_AUTH_MUTABLE_INPUT_DENIED`,
  `SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED`,
  `SNAPBACK_ACTION_GENERATION_CONFLICT`,
  `SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED`,
  `SNAPBACK_CTX_LEDGER_EXHAUSTED`,
  `SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED`; JS-only:
  `SNAPBACK_UNKNOWN_TABLE`, `SNAPBACK_UNKNOWN_FIELD`,
  `SNAPBACK_QUERY_UNKNOWN_INDEX`, `SNAPBACK_FIELD_MISSING`,
  `SNAPBACK_FIELD_TYPE_MISMATCH`, `SNAPBACK_SYSTEM_FIELD_WRITE`,
  `SNAPBACK_ACTION_REPLAY_DIVERGED`,
  `SNAPBACK_FUNCTION_KIND_MISMATCH`,
  `SNAPBACK_TEST_CRON_ACTION_INTERRUPTED` —
  crates/snapback/src/runtime.rs:3794–3848 vs envelope.mjs:16–60, whose header claims
  it "mirrors" the Rust leg). The refusal-branch narrow alignment this
  RFC's floor claims is true; the wide divergence needs a ruling —
  intentional per-engine difference or drift (OQ8).
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
  `MoveIssueRefusal = { appCode: 'STALE_MOVE'; ... } |
  { appCode: 'INVITE_CONSUMED'; ... }` — with a client helper that
  narrows (`isAppRefusal(err, api.moveIssue)`), and the undeclared
  collapse deliberately absent from the union (per CV-16's exit
  criterion: typing must not widen the collapse). Without A3 the
  `appDetails` member is `unknown`. **With A3 the type must represent
  payload validity, because the recommended B3 admits a code while
  dropping an off-schema payload**: a bare
  `appDetails: StaleMoveDetails` would promise what B3 cannot deliver.
  The composed shape is a discriminated pair per variant —
  `{ appCode: 'STALE_MOVE'; appDetails: StaleMoveDetails;
  detailsDropped: false } | { appCode: 'STALE_MOVE'; appDetails: null;
  detailsDropped: true }` — where `detailsDropped` is computed from
  B3's stated wire carrier (`appDetailsDropped` in diagnostic details;
  its absence plus null details means "refused without details", never
  "dropped"), and `detailsDropped: true` is the named, typed location
  for B3's value-free validation note. Under B2 (fold everything) the
  pair collapses to the simple typed member; choosing B3 *requires*
  this shape, and OQ1's ruling therefore fixes both D2's grammar and
  the carrier key.
- **D3.** D2 plus typed *result* integration: the refusal union joins
  the mutation's result type as a discriminated non-exception return
  (`await mutate(...)` yielding `ok | refusal`), replacing thrown
  errors for declared refusals. This is a larger client-contract change
  (it alters every call site's control flow) and drifts toward the
  result-object pattern apps can already build themselves — exactly the
  zero-declaration alternative §Motivating evidence records from the A6
  arm, which is why D2-not-D3 and Axis G's result-object-vs-`ctx.refuse`
  split are the same decision seen twice; the draft position is that
  thrown-with-typed-narrowing (D2) preserves the existing client
  contract while delivering the types. The React arm
  (`useSnapbackMutation`) needs the same treatment either way.

**Packaged accessor amendment — 2026-08-24.** The minimal D1 accessor now
exists. `@expo/snapback-client` exports
`projectAppRefusal(error: unknown): SnapbackAppRefusal | null`; the React root
and Familiar entry re-export the identical helper and type. It accepts either
the public `SnapbackDiagnosticError` carrier or a raw public diagnostic, projects
only platform code `SNAPBACK_APP_REFUSAL` with a non-reserved app code matching
the declaration grammar, and returns the B3-compatible discriminated shape:
`{ code: 'SNAPBACK_APP_REFUSAL', appCode: string, appDetails: unknown,
detailsDropped: false } | { code: 'SNAPBACK_APP_REFUSAL', appCode: string,
appDetails: null, detailsDropped: true }`. This is an observation helper over a
host-admitted diagnostic, never a second admission authority. It makes D1
teachable now without claiming D2's generated per-operation code union.

### Axis E — retry, quarantine, and disposition participation

The landed slice: declared refusals participate in no dispositions.
Options:

- **E1 (landed).** None. A declared refusal is terminal for that
  attempt; what to do next is app logic.
- **E2.** Declared per-code hints — `retryable: false`, `quarantine:
  'drop' | 'hold'` — consumed by client mutation queues. The forcing
  context is local-first replay: when a queued offline mutation replays
  against fresh state and draws a declared refusal, the queue must do
  *something* — silently dropping loses user intent, retrying forever
  wedges the queue. Today that behavior is platform-generic; E2 lets
  the app say per code which refusals are conflicts-to-surface versus
  staleness-to-drop.
- **E3.** Platform disposition classes: a small closed set of declared
  *kinds* (`conflict`, `consumed`, `validation`) with platform-defined
  queue behavior per kind, instead of raw per-code booleans. Less
  expressive, more uniform; resembles the taxonomy axis (H) and risks
  becoming one.

Ownership, stated precisely: LLP 0133 is **Accepted** and defines
lane-Q/lane-L settlement and the closed reservation-stale retry — it
does **not** decide generic declared-refusal queue dispositions, and it
explicitly leaves refusal typing and quarantine/resync behavior to
other owners. E1 therefore remains normative not "until 0133 forces
the question" but until a *named* amendment defines terminal
declared-refusal handling for the queue — whether that amendment
extends LLP 0133 or belongs to the client lifecycle/outbox owner is
itself part of OQ3. The adjacency that keeps LLP 0070 in this
document's Related set lives here too: a drained one-off job drives an
action whose nested mutation may refuse — job attempt records
(`lastErrorCode`) and at-least-once redrives are a second consumer of
whatever disposition vocabulary E settles on. Draft position: E1 now;
E2's minimal hints over E3's taxonomy if and when the owning amendment
lands.

### Axis F — composition across the action boundary

An action calls `ctx.runMutation('moveIssue', ...)`; the mutation
raises its declared `STALE_MOVE`.

**As-built determination (read from the tree; a pinning test is owed
but the answer is not open).** Today the composition is **total
collapse — regardless of what the action declares**, which is neither
F1 nor F2: (1) the interior refusal is admitted against the interior
declaration and propagates out of `action.runMutation`
(crates/snapback/src/runtime.rs:1922–1941); (2) it crosses the host-call FFI as a bare
`"CODE: message"` string — `SnapbackError`'s `Display` carries code and
message only (crates/snapback/src/diagnostic.rs:189–197, via `c_host_response`,
crates/snapback/src/runtime.rs:3351–3355; the workerd leg likewise sends only
`{ok:false, code, message}`, crates/snapback/src/workerd_exec.rs:1185–1192) — so
`appCode`/`appDetails` **never cross the FFI**; (3) `host()` rebrands
the thrown error with only `__snapbackCode` parsed from the message
(ctx-bootstrap.js:558–573); (4) the settle encoder emits `appCode` only
from `__snapbackAppCode` (ctx-bootstrap.js:1205–1211), which only
`ctx.refuse` sets — so the action's envelope carries a bare
`SNAPBACK_APP_REFUSAL` claim; (5) `admit_declared_refusal` folds the
bare claim to `SNAPBACK_HANDLER_FAILED`. This is the a3-restart
misattribution failure mode one layer up, and it splits the axis into
two separable questions:

**F-observation — can the action's own handler see the interior
`appCode`?** Currently impossible (the code crosses only inside the
message string), so catch-`STALE_MOVE`-and-recover logic cannot be
written. Options: FO-1 carry `appCode`/`appDetails` across the
host-call boundary in the structured error (both FFI legs); FO-2 a
witness-side read surface (the handler asks the host what the last
nested refusal was); FO-3 leave unobservable to handler code —
interior refusals stay hidden from the wrapping action's JS, though
pairing FO-3 with F1 still requires F1's structured FFI token carrier,
kept shim-private per the identity-binding rule (interior refusals are
for
callers, not for wrapping actions). No option existed in v1; this half
is new and open (OQ2).

**F-transport — does the action's caller see the refusal?**

- **F1.** Raising-site admission carries through via a host-recorded
  witness, the a4-f5 pattern: `dispatch_host_call` records a
  `refusal_witness` (admitted app code + details) symmetric with
  `denial_witness`, and the action's envelope restores it. The fact is
  host-recorded, not handler bytes, so I1 holds. The state machine must
  be pinned before this is adoptable: the witness is recorded only for
  an *admitted* interior refusal; an unrelated subsequent failure
  restores nothing; and at most one witness is live per invocation
  (last-write or first-write must be chosen and tested).
  **Restoration matching must key on an unforgeable per-host-call
  correlation token, not on the code**: code-only matching (the
  `restore_denial_witness` exact-match rule) is insufficient here,
  because a handler that catches an interior `STALE_MOVE` and later
  fails with its own same-`appCode` claim would resurrect the stale
  witnessed details onto an unrelated failure. The host mints the
  token when it records the witness at `dispatch_host_call` and
  returns it in the structured FFI error (a small structured addition
  to the `-` response either way — the bare `"CODE: message"` string
  cannot carry it). **The shim-side binding must be non-extractable**:
  a token branded as an error property would itself be handler-copyable
  bytes — caught handler code could transfer it onto a later error —
  so the `host()` shim instead records token-to-error in a
  shim-private map keyed by the **exact error object's identity**
  (WeakMap or equivalent; handler code can neither read nor transfer
  it), and the settle encoder emits the token only by looking up the
  identity of the very object it is serializing. Only rethrowing the
  same object carries the token — **replay is rethrow**, so
  catch-invalidation needs no separate bookkeeping: a caught-and-
  replaced error simply has no binding, no token reaches the final
  envelope, and no restore fires. Restore fires only on token match
  and consumes the token. Handler bytes can copy a code and even a
  token-shaped string; neither mints an identity binding.
- **F2.** Boundary re-admission: each crossing re-checks the code
  against the *crossing* function's declaration, so an action must also
  declare `STALE_MOVE` to let it out. Fail-closed at every layer, at
  the cost of respelling (against the 0115 grammar rule) and of actions
  needing to enumerate their callees' vocabularies.
- **F3.** F1 with an action-level opaque opt-out for actions that
  deliberately hide interior semantics — spelled as a **distinct
  field** (`refusalExposure: 'opaque'`), because overloading the landed
  `refusals` array with a string sentinel would change A1's settled
  grammar; if a union-shaped `refusals` is ever wanted instead, that is
  an Axis A grammar change and must be argued there.

**Composability of the two halves, stated explicitly.** Every
FO-option pairs with every transport option, but not symmetrically:
FO-1 (structured crossing) subsumes the correlation token naturally —
the same structured FFI error that carries `appCode`/`appDetails`
carries the token, catching becomes observable to the host, and
invalidation follows from the catch; FO-2 (witness-side read) must
consume or mark the **same** witness the transport half would restore —
one authority, so an observed-then-rethrown refusal cannot restore
twice and an observed-then-swallowed one restores never; FO-3
(unobservable to handler code) is the only FO-option that adds **zero
handler-visible surface** — but it does not spare the FFI: under F1
the structured token carrier still crosses both directions, held in
the shim-private identity binding, so "unobservable" narrows what
handler code can read, never what the transport needs. Choosing F1
under any FO-option — or none — requires the token's structured FFI
addition; choosing FO-1 gets it for free.

The draft leans F1-by-witness for mutations-inside-actions with F3's
opt-out considered, and takes no position yet on F-observation. The
fold-always pinning test should land immediately (it guards every
earlier stage against silently changing boundary semantics), not wait
for this axis's slot in the composition.

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
  generated artifacts. The tree already answers fragments of OQ4: the
  generated functions manifest carries `refusals`
  (packages/snapback-codegen/index.mjs), so manifest-digest-keyed
  artifacts move when a declaration changes; the served public
  descriptor excludes it (floor fact 6), so protocol-surface identity
  does not; and `result_contract_hash` inputs do not obviously include
  it. The hash-participation *ruling* — is adding a refusal to a live
  app a hot change or a versioned-evolution-visible one — remains open
  as OQ4, but it is a ruling over these verified fragments, not a blank
  deferral.
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

### Axis I — disclosure posture

The neighboring design is emphatic the other way: LLP 0053 keeps
platform denials uniform and non-disclosing ("trusted error with its
uniform bytes"), precisely so a caller learns nothing from being
refused. This channel is the deliberate opposite — app-authored bytes
delivered to the caller, raised from inside permission-gated mutations
— and v1 never asked what a refusal may *reveal*. Concretely:
`INVITE_CONSUMED` fired before the auth gate discloses that the invite
exists; a `STALE_MOVE` payload can carry another principal's row
content into `appDetails`; under sessions auth this is a
cross-principal disclosure surface. H3 (i18n riding `appDetails`)
sharpens the exposure rather than mooting it. Options:

- **I-1 (floor + I7).** App-owned responsibility, stated: the guide's
  `ctx.refuse` teaching (Axis G) carries the obligation — auth gates
  before refusal logic; `appDetails` contains only what the caller is
  entitled to read; codes chosen knowing they are caller-visible.
- **I-2.** A3's payload schemas as the mitigation hook: a declared
  details schema is also a disclosure allowlist — nothing off-schema
  can leak by accident, which is an argument *for* A3 independent of
  typing.
- **I-3.** A generation-time lint for the sharpest footgun: `ctx.refuse`
  reachable before the function's first authorization gate produces a
  warning (heuristic, best-effort; never claimed as enforcement).

I-1 is the floor obligation under any composition; I-2 rides A3; I-3 is
cheap and honest if kept advisory. Witness: the guide page's refusal
section states the disclosure obligation, and one negative example
(pre-auth `INVITE_CONSUMED`) shows the gate-ordering fix.

## Recommended composition (draft)

The floor (A1/B1/C1/D1/E1, local host) is shipped. The recommended
target, staged:

0. **Floor repair (implemented 2026-08-01)**: admission is green across
   all three serving surfaces — the local Ibex leg, local workerd-v8
   twin leg, and Cloudflare host — with the declared/undeclared/bare-
   claim triad run on each (floor fact 3's matrix). Local admission is
   hoisted after the executor join rather than duplicated per engine.
   The separate fold-always action-boundary pin remains Axis F work.
1. **Fixtures** (Axis C), scoped honestly: decide the
   completion-envelope corpus class with the 0094/0095 owners
   (formatVersion-bump-class change), then land the three fixture
   classes — decoding parity, semantic admission vectors consumed by
   both hosts, and declaration validation.
2. **A2+A3 with B3** riding the CV-4-era declared-contract grammar
   (LLP 0115 Tranche B): one vocabulary, referenced not respelled,
   payloads contracted with LLP 0131's grammar, code identity surviving
   payload regressions — with I-2's disclosure-allowlist framing.
3. **D2 typed unions** (CV-16's committed exit) in the B3-consistent
   discriminated-pair shape: generated refusal unions in `api.d.ts`, a
   narrowing helper on the packaged client, the React arm surfaced,
   undeclared collapse never widened.
4. **F-transport resolved** (F1-by-witness lean, state machine pinned)
   and **F-observation decided** (FO-1/FO-2/FO-3), each with an
   end-to-end test of the nested-mutation-inside-action composition.
5. **E and H deferred** until a named queue/outbox amendment (Axis E's
   ownership note) and post-D2 ecosystem pressure respectively force
   them.

## Open questions

- **OQ1 (payload-violation fold) — ANSWERED 2026-08-02: B3.** Admit the code
  and drop the payload when a declared-schema payload fails validation at
  raise. B3 was selected with the failure-economics
  argument written down: LLP 0131's fold-the-invocation precedent is an
  *ingress* gate firing before effects on every call; A3 validation is
  an *egress* check on the rare path in production — different
  economics justify different strictness. The ruling also fixes D2's
  union grammar and the wire carrier key (the discriminated pair and
  `appDetailsDropped` exist only under B3).
  The decision admits the declared code, drops the invalid payload, and sets
  `appDetailsDropped: true`; D2 uses that discriminated pair and carrier key.
  Source: `issues/20260802-author-decision-packet.md`.
- **OQ2 (action boundary).** The as-built half is answered in Axis F
  (fold always; `appCode` never crosses the FFI). What remains open:
  F-transport's mechanism choice (F1-by-witness with the sketched
  state machine, versus F2, versus F3's distinct-field opt-out) and
  F-observation (FO-1 structured crossing / FO-2 witness-side read /
  FO-3 unobservable). The fold-always pinning test lands regardless.
- **OQ3 (dispositions and their owner).** Whether declared refusals
  ever carry retry/quarantine hints — and *which document owns the
  queue's terminal-refusal handling*: an LLP 0133 amendment or the
  client lifecycle/outbox owner. E1 stays normative until that named
  amendment exists.
- **OQ4 (hash participation).** Over the verified fragments in Axis G
  (generated manifest carries `refusals`; public descriptor excludes
  it; `result_contract_hash` inputs do not obviously include it): is
  adding a refusal to a live app a hot change or a
  versioned-evolution-visible one?
- **OQ5 (registry scope).** Is A2's app-level registry worth its
  surface, or is per-function A1 plus guide conventions enough until
  H2-style convergence pressure exists? Note that *neither* A1 nor A2
  is protocol-enumerable while floor fact 6 stands.
- **OQ6 (wire and manifest promotion).** Does LLP 0094 ever want
  `appCode` as a first-class envelope field or a distinct status family
  (wide-409)? Owned there; recorded here to prevent drift — together
  with its quieter sibling: whether the served public descriptor should
  ever restate `refusals` (floor fact 6), which no document currently
  owns.
- **OQ7 (client accessor now) — ANSWERED 2026-08-24: yes.** The packaged
  accessor is `projectAppRefusal(error)`, returning the dated Axis D amendment's
  `SnapbackAppRefusal | null` discriminated shape. The React root and Familiar
  entry re-export the same helper/type; D2's generated per-operation union
  remains separate future work.
- **OQ8 (decoder-allowlist divergence).** The 16-code divergence
  between the Rust and JS `handler_envelope_code` allowlists (Axis C):
  intentional per-engine difference or drift? Someone should rule;
  the shared corpus then pins the ruling.

## Acceptance witnesses (per axis, when adopted)

- Floor repair (step 0, green): an undeclared `ctx.refuse` folds identically
  on all three serving surfaces — local Ibex leg, local workerd-v8
  twin leg, Cloudflare host (the parity ticket's triad green on each)
  — and the fold-always boundary test pins today's collapse.
- A2/A3: a clean consumer declares a registry entry with a payload
  schema once, references it from two functions, and the generated
  manifest carries one shape (no respelling); an off-schema raise
  behaves per the OQ1 ruling with a fixture proving it.
- C: both `handler_envelope_code` legs consume the same fixture bytes
  and yield equivalent decoded judgments, and both hosts consume the
  same semantic admission vectors with identical admitted/folded
  outcomes.
- D2: a seeded `STALE_MOVE` reaches an external TypeScript consumer as
  a narrowed union member whose payload member reflects validity per
  the B-ruling (the discriminated pair under B3); an undeclared throw
  stays `SNAPBACK_HANDLER_FAILED` and is absent from the union.
- F: the nested-mutation-inside-action composition surfaces the
  declared refusal per the OQ2 rulings (transport and observation) in
  an end-to-end served test, including the caught-and-replaced case
  (no identity binding on the final error, so no token reaches the
  envelope and nothing restores) and the same-`appCode` non-replay
  case.
- G: the guide mutations page teaches `ctx.refuse` beside the
  result-object pattern with CI-verified snippets, and the capability
  index row flips from GAP.
- I: the guide's refusal section states the disclosure obligation with
  the pre-auth `INVITE_CONSUMED` negative example and the gate-ordering
  fix.
