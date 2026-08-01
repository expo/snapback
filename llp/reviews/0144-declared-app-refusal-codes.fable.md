# LLP 0144 declared app refusal codes review — Fable family


## Round 1 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, non-author session
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** commissioned round-1 review (orchestrator message, no capsule
file); mutually blind — no `llp/reviews/` artifact concerning LLP 0144
read, blind to any 0144 codex artifact. SHA-pinned target verified against
origin/main before reading. Verify-first: every settled-floor claim, quoted
authority, and motivating ticket checked against the tree; the
action-boundary composition traced end-to-end by reading
(READY bar: thought-through-without-running-code).
**Target:** `llp/0144-declared-app-refusal-codes.rfc.md` (408 lines, Draft)
**Target SHA-256:** `4cc87731c2265b6f296ccd72543946dccbca73a757168cc3263f9c96b42e075f`
**Repo revision at review start:** origin/main `a8dcb148`
**Tool uses:** 36
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## Overall assessment

**Verdict: NOT READY** — one revision round should clear it.

This is a disciplined options RFC with an unusually accurate as-built
record. Every settled-floor claim I checked verifies against the tree, the
quoted authorities (LLP 0053's pinned rule and its 2026-08-01 denial-witness
note, LLP 0125 finding 4, LLP 0127 decision 7, LLP 0115 CV-16's work and
exit text) are faithful to the letter, the motivating tickets say what the
RFC says they say, and the two flags it plants — the corpus has zero
`SNAPBACK_APP_REFUSAL` fixtures, the guide teaches nothing — are both
correct. The invariants are well-chosen and each one is real in the code.
The ownership boundaries (C2 and wide-409 delegated to 0094/0095) match the
0127 item-3 delegation exactly.

It is not ready for two reasons of substance and two of completeness. First,
OQ2's "what does the implementation do *today*" is fully answerable by
reading the tree — the answer is "fold always, regardless of the action's
own declaration, because the app code never crosses the host-call FFI" —
and the answer restructures Axis F: it splits composition into an
observation half (the action's own JS cannot see the interior `appCode` at
all) and a transport half the RFC does analyze. A document commissioned at
the thought-through-without-running-code bar should carry this
determination, not defer it to a test. Second, for a commissioned *full*
option space, one axis is missing outright: the disclosure posture of
`appCode`/`appDetails` — the platform's neighboring design (LLP 0053) is
emphatic about uniform, non-disclosing denial bytes, and this RFC hands
apps a caller-visible byte channel that fires inside permission-gated
mutations without once asking what it may reveal. Third, "fixtures first"
understates its own scope: the 0093 corpus has no completion-envelope
fixture *class* at all, so step 1 is a corpus-contract extension crossing
the 0094/0095 delegation, not an additive fixture drop — and real
allowlist drift between the two decoder legs (16 codes today) makes the
shared-corpus argument stronger than the RFC states it. Fourth, the floor
record omits one deliberate as-built fact that bears on three axes: the
served public function descriptor drops `refusals` on purpose.

## Strengths

- **The floor section is exact.** Every element verified: declaration
  bounds and the reserved-prefix refusal with
  `SNAPBACK_FUNCTION_REFUSAL_DECLARATION_INVALID`
  (`validate_declared_refusals`, src/manifest.rs:2146–2184, and the
  same rules at codegen in `authoredFunctionAuth`,
  packages/snapback-codegen/define.mjs:174–196 — genuinely validated at
  codegen *and* re-validated at manifest load, with identical rule sets);
  `ctx.refuse` throwing the branded error
  (packages/snapback-harness/ctx-bootstrap.js:775–792, non-enumerable
  `__snapbackAppCode`/`__snapbackAppDetails` via `trustedDefineProperty`);
  fail-closed admission with payload dropped on fold
  (`admit_declared_refusal`, src/runtime.rs:3104–3133); the declared set
  riding the prepared invocation and empty by default (src/runtime.rs:1198,
  1256, set at four invocation sites); `SNAPBACK_APP_REFUSAL` passing both
  decoder legs with conditional `appCode` extraction (src/runtime.rs:3844
  and 3175–3193; packages/snapback-harness/envelope.mjs:59, 95–98). The
  positive/fold/undeclared/forged quartet is already pinned by unit tests
  (src/runtime.rs:4167–4215).
- **Quoted authorities are faithful.** LLP 0053's pinned rule ("a thrown
  object, returned envelope, adapter string, or forged `{code: …}` is
  untyped") and the 2026-08-01 Revised-header witness note match verbatim;
  the platform-vs-app "opposite in witness" symmetry framing is an accurate
  and genuinely illuminating reading of `restore_denial_witness`
  (src/runtime.rs:2742–2756) beside `admit_declared_refusal`. LLP 0125
  finding 4 (host-plan `elseError`/`guard` verbatim vs JS-lane fold) is
  quoted correctly. CV-16's work text ("declared failure variants in the
  same contract vocabulary, with the generated failure union reaching
  client types", llp/0115:836–839) and exit ("without widening the
  undeclared-failure collapse", :845–847) are exact, as is the 0127 item-3
  delegation of the wire-shape choice and wide-409 taxonomy to 0094/0095.
- **The motivating tickets are honestly characterized**, including the
  load-bearing negative: a4-f5's mechanism is "deliberately inapplicable to
  app-minted codes" because there is no host-produced witness — that is the
  ticket's own design analysis, correctly carried.
- **Both planted flags verify.** `schemas/live.wire-fixtures.v1.json`
  contains zero occurrences of `SNAPBACK_APP_REFUSAL` or `appCode`; `guide/`
  contains no `ctx.refuse`, no declared-refusals coverage (its "refusal"
  hits are host stream/search refusals). D1's observation that the packaged
  web client has no accessor also verifies: zero `appCode` references in
  `packages/snapback-client/` and `packages/snapback-react/`.
- **The invariants are real, not aspirational.** I2 is structurally true in
  both encoder and admitter; I3's "empty by default" carriage is the actual
  mechanism; I5's corpus-normative posture matches LLP 0095 §2. The
  result-object-vs-`ctx.refuse` dividing line in Axis G (I4: refusals
  commit nothing; result objects can commit receipts) is the clearest
  statement of that split anywhere in the corpus.
- **Scope discipline.** The RFC consistently refuses to own what 0094/0095
  own, and says so at each brush (C2, HTTP status, OQ6). Axis A's
  compose-don't-compete structure (A1 floor, A2 naming, A3 payload) is the
  right shape and matches the 0115 move-1 grammar rule it cites.

## Findings

**MATERIAL-1 — OQ2's as-built half is answerable by reading, the answer is
"fold always", and Axis F is missing its observation half.**
§Axis F, §OQ2. The current behavior for the nested-mutation-inside-action
composition is fully determinable from the tree, no test run needed:
(1) the interior mutation's refusal is admitted against the *interior*
declaration and propagates out of `action.runMutation`
(src/runtime.rs:1922–1941, the `?` at :1940); (2) it crosses the FFI as a
bare string — `SnapbackError`'s `Display` is `"CODE: message"` only
(src/diagnostic.rs:189–197, via `c_host_response('-', error.to_string())`,
src/runtime.rs:3353; the workerd leg likewise sends only
`{ok:false, code, message}`, src/workerd_exec.rs:1187–1191) — so
`appCode`/`appDetails` never reach the action's JS; (3) `host()` rebrands
the thrown error with only `__snapbackCode` parsed from the message
(ctx-bootstrap.js:558–573); (4) the settle encoder emits `appCode` only
when `__snapbackAppCode` is a string (ctx-bootstrap.js:1208), which only
`ctx.refuse` sets, so the action's envelope carries code
`SNAPBACK_APP_REFUSAL` with no app code; (5) `admit_declared_refusal`
folds the bare claim to `SNAPBACK_HANDLER_FAILED` — *regardless of what
the action declares*. Two consequences the RFC should carry: the current
behavior is neither F1 nor F2 but total collapse (the a3-restart
misattribution ticket's failure mode, one layer up); and Axis F conflates
two separable design questions — whether the action's *caller* sees the
refusal (transport, F1–F3 as written) and whether the action's *own
handler* can observe the interior `appCode` to branch on it
(catch-STALE_MOVE-and-retry recovery, currently impossible since the code
crosses only inside the message string). F1's witness-transport precedent
answers the first; the second needs either details crossing the host-call
boundary or a witness-side read surface, and no current option names it.
Resolution: record the as-built determination in the RFC (a test pinning
it can then land as the witness), and split Axis F.

**MATERIAL-2 — The option space has no disclosure axis, and the neighboring
design says it needs one.**
§Invariants, §Axis A3/B, §Axis G. Platform denials are deliberately
uniform and non-disclosing — the RFC itself quotes LLP 0053's
"uniform, non-disclosing bytes" when describing a4-f5. The new channel is
the opposite by construction: app-authored bytes, delivered to the caller,
raised from inside permission-gated mutations. Nothing in the six
invariants or eight axes asks what a declared refusal may *reveal*:
`INVITE_CONSUMED` fired pre-authorization discloses that the invite
exists; a `STALE_MOVE` payload can carry another principal's row content
into `appDetails`; under sessions auth this is a cross-principal
disclosure surface with no stated posture. This is app responsibility in
the end — but a commissioned full-option-space RFC should say so
explicitly: at minimum a seventh invariant or Axis G guide obligation
("refusal codes and details are caller-visible bytes; the ordering of
auth gates vs `ctx.refuse`, and what belongs in `appDetails`, are part of
the app's disclosure surface"), noting A3's payload schemas as the
natural mitigation hook and adding a witness. H3 (i18n riding
`appDetails`) makes this sharper, not moot.

**MATERIAL-3 — "Fixtures first" understates its own scope, and the decoder
drift it hypothesizes already exists.**
§Axis C, §Recommended composition step 1. The LLP 0093 corpus
(`schemas/live.wire-fixtures.v1.json`, contract in LLP 0095 §2) has no
completion-envelope fixture *class* at all: its fixtures are live-protocol
frames, negotiation requests/refusals, and lifecycle steps; every
`SNAPBACK_*` code in it is a connection/auth/wire code, and
`mutation.output` is a separate schema outside the corpus. So step 1 is
not an additive fixture drop — it requires deciding where
handler-completion fixtures live (a new corpus class/lane is a
formatVersion-bump-class change under 0095 §2's own v3 precedent, and
arguably lands in 0094/0095's delegated territory, which the RFC should
say). Separately, the RFC's careful "their agreement is currently
asserted by tests on each side rather than by a shared corpus" is *weaker*
than the truth: the two allowlists visibly diverge today — Rust-only:
`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`,
`SNAPBACK_AUTH_MUTABLE_INPUT_DENIED`,
`SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED`,
`SNAPBACK_ACTION_GENERATION_CONFLICT`,
`SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED`, `SNAPBACK_CTX_LEDGER_EXHAUSTED`,
`SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED`; JS-only: `SNAPBACK_UNKNOWN_TABLE`,
`SNAPBACK_UNKNOWN_FIELD`, `SNAPBACK_QUERY_UNKNOWN_INDEX`,
`SNAPBACK_FIELD_MISSING`, `SNAPBACK_FIELD_TYPE_MISMATCH`,
`SNAPBACK_SYSTEM_FIELD_WRITE`, `SNAPBACK_ACTION_REPLAY_DIVERGED`,
`SNAPBACK_FUNCTION_KIND_MISMATCH`, `SNAPBACK_TEST_CRON_ACTION_INTERRUPTED`
(src/runtime.rs:3794–3848 vs envelope.mjs:16–60, whose header claims it
"mirrors" the Rust leg). Refusal-narrow alignment — the RFC's actual
claim in C1 and the floor — is true; but citing the existing 16-code
divergence turns the fixtures argument from hygiene into repair, and the
divergence itself deserves a pointer (intentional per-engine difference
or drift — someone should rule).

**MATERIAL-4 — The floor omits a deliberate as-built fact: the public
function descriptor drops `refusals`.**
§The landed floor, §Axis A2, §OQ5/OQ6. `PublicFunctionDefinition`
explicitly destructures `refusals: _` with the comment "Declared
app-refusal vocabulary is an authoring contract the generated client
already carries; the public identity descriptor does not restate it"
(src/manifest.rs:4582–4585). So today the vocabulary reaches codegen
consumers (the emitted functions manifest carries it,
packages/snapback-codegen/index.mjs:4417, 4852) but is *not* enumerable
from the served protocol surface. That is a floor fact with teeth: A2's
"single enumerable registry" pitch and the clean-room-client story are
currently unreachable for any client that isn't a codegen consumer, and
OQ6's wire-promotion question has a quieter sibling (manifest-surface
promotion) that nobody owns. Record the omission in the floor section and
let A2/OQ5 argue against the real baseline. Relatedly, the
0094-gap ticket the RFC cites recorded three *platform*-code registry
gaps; "a client implementing from fixtures alone needs the refusal
vocabulary enumerable, not folkloric" is the RFC's (reasonable)
extrapolation to app codes, and should be presented as analogy rather
than as the ticket's recorded ask.

**DETAIL-1 — Related header omits LLP 0061; LLP 0070 is Related but never
cited.** Axis G invokes "shipped, in the LLP 0061 sense" and the
capability-index row; 0061 is absent from the Related header. Conversely
LLP 0070 appears in Related but nowhere in the body — if it is there for
the jobs-lane refusal question (can a job's mutation declare refusals and
who observes them on replay — a real Axis E adjacency), the body should
say so; otherwise drop it.

**DETAIL-2 — OQ4 has partial as-built anchors worth restating.** The tree
already answers fragments: `refusals` are excluded from the public
descriptor (MATERIAL-4) but carried in the generated functions manifest,
so manifest-digest-keyed artifacts move when a declaration changes, while
`result_contract_hash` inputs do not obviously include it. Stating the
verified fragments (with the hash-participation remainder still open)
would make the migration axis concrete instead of fully deferred.

**DETAIL-3 — The C acceptance witness's "byte-identically" is loose.** The
decoders yield decoded structures (a `SnapbackError`, a JS object), not
bytes; the corpus contract's own framing is fixture-bytes-in,
judgment-out. Say "with equivalent decoded judgments from the same fixture
bytes".

**DETAIL-4 — D3's drift concern could cite its own floor.** The
result-object pattern D3 "drifts toward" is exactly the A6 zero-declaration
alternative the RFC documents in §Motivating evidence; a cross-reference
would close the loop on why D2-not-D3 and the Axis G split are the same
decision seen twice.

## Positions on the open questions (reviewer input, not rulings)

- **OQ1:** B3, agreeing with the draft — with one sharpening: the LLP 0131
  precedent (fold the whole invocation) is an *ingress* gate that fires
  before effects on every call; A3 validation is an *egress* check on the
  rare path in production. Different failure economics justify the
  different strictness, which is the argument to write down. B3 also
  degrades to an admitted code with a value-free note — never an admitted
  off-contract payload — so I3 is preserved.
- **OQ2:** the as-built answer is in MATERIAL-1 (fold always). Lean
  F1-by-witness (a `refusal_witness` recorded at `dispatch_host_call`,
  symmetric with `denial_witness` — the fact is host-recorded, so I1
  holds), plus the observation half as its own decision. F3's opaque
  opt-out is worth keeping.
- **OQ3:** keep deferred to 0133's replay contract; E2-over-E3 is right if
  it comes to that.
- **OQ4:** restate the verified fragments (DETAIL-2) and keep the
  hash-participation remainder open.
- **OQ5:** A2's value is real but not urgent; note that *neither* A1 nor
  A2 is protocol-enumerable until MATERIAL-4's omission is revisited.
- **OQ6:** correctly owned elsewhere; add the manifest-surface sibling.
- **OQ7:** yes — a minimal documented accessor is cheap, unblocks the
  guide, and its shape (`isAppRefusal(err)` narrowing on `appCode`) is
  D2-forward-compatible.

## Assessment of the staged recommendation and witnesses

The stage order (fixtures → A2+A3+B3 → D2 → F → defer E/H) is sound, with
two amendments: step 1 carries the corpus-scope decision (MATERIAL-3), and
the F pin — at least the test recording today's fold-always behavior —
should not wait for step 4, since it guards every earlier stage against
silently changing the boundary semantics. The acceptance witnesses are
well-shaped (the A2/A3 no-respelling witness and the D2
undeclared-absent-from-union witness are exactly CV-16's exit); add a
disclosure witness if MATERIAL-2 is taken, and fix DETAIL-3's wording.

## Verification ledger

Verified against origin/main `a8dcb148`: `validate_declared_refusals`
(src/manifest.rs:2146–2184); `authoredFunctionAuth` refusal rules for all
function kinds (define.mjs:142–197); `ctx.refuse`
(ctx-bootstrap.js:771–795); settle-encoder refusal leg
(ctx-bootstrap.js:1195–1227); `admit_declared_refusal`,
`parse_handler_output_with_claim`, `handler_envelope_code`,
`restore_denial_witness`, `dispatch_host_call` witness recording,
`action.runMutation`, FFI error crossing (src/runtime.rs:3104–3133,
3144–3205, 3794–3848, 2742–2756, 2597–2622, 1922–1941, 3351–3355);
`SnapbackError` Display (src/diagnostic.rs:189–197); workerd host-call
error shape (src/workerd_exec.rs:1185–1192); JS decoder
(envelope.mjs:12–105); `PublicFunctionDefinition` refusal omission
(src/manifest.rs:4559–4596); manifest emission carrying refusals
(packages/snapback-codegen/index.mjs:4417, 4852); zero corpus hits and
corpus code inventory (schemas/live.wire-fixtures.v1.json); zero guide and
packaged-client surface; LLP 0108 §Declared application refusals; LLP 0053
Revised header + pinned rule (llp/0053:8–20, 1225–1226); LLP 0125
finding 4 (:563–569); LLP 0127 item 3 (:616–626); LLP 0115 CV-16
(:319, 437, 830–847); tickets
`20260801-0137-a3-no-structured-app-refusal-codes.md`,
`20260801-0137-a4-action-boundary-collapses-auth-refusals.md`,
`20260801-0137-a3-restart-evolution-refusal-misattributed-diagnostic.md`,
`20260726-0094-refusal-registry-gaps-from-a-clean-room-client.md`;
LLP 0131 grammar spellings (`v.object`/`v.integer`, llp/0131:133–134);
LLP 0095 §2 corpus contract. Not verified (out of tree): the A6 arm's
result-object patterns (the RFC flags it as landing separately — honest).

## Recommended next step

Revise and stay Draft: fold in the as-built Axis F determination and the
observation/transport split (MATERIAL-1), add the disclosure
axis-or-invariant (MATERIAL-2), scope step 1 honestly and cite the live
decoder divergence (MATERIAL-3), record the public-descriptor omission in
the floor (MATERIAL-4), and sweep the details. None of this disturbs the
recommended composition — A2+A3/B3/D2/F1-lean all survive; the revision is
about completeness of the option record, which is this document's entire
commission. One round, then a second family pass on the delta.


## Round 2 — 2026-08-01 (delta review of v2)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, non-author session (same session as round 1)
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** delta review of v2 against the round-1 findings ledger; every
claimed resolution re-verified against the tree, the new per-host floor
restatement and Cloudflare parity ticket independently verified
(Codex-territory content checked for truth only, no codex artifact read),
and all newly added text swept for fresh defects.
**Target:** `llp/0144-declared-app-refusal-codes.rfc.md` (638 lines, Draft, v2)
**Target SHA-256:** `6eb359517530cd222f05ce69a32149789f0e98910527c6506b4e25fbb67d5dda`
**Repo revision at review start:** origin/main `9224c01a`
**Tool uses:** 15
**Status:** completed
**Verdict:** NOT READY (one focused sentence-level round; the option
space itself is now in good shape)

## Verbatim review

## Overall assessment

**Verdict: NOT READY** — for one fresh material defect in the newly
restated floor, plus three details. Everything else landed.

The v2 revision is high quality. All four of my round-1 MATERIALs are
genuinely resolved — not paraphrased away — and the four details are
swept (one partially, see DETAIL-R2-1). The new per-host floor
restatement and the Cloudflare parity ticket read true against
`cloudflare/src`: I independently confirmed `classifyHandlerPlatformFailure`
(cloudflare/src/platform-errors.js:80–93) returns every non-platform
failure unchanged — including a decoded `appCode`/`appDetails` claim from
`parseHandlerEnvelope` (consumed at cloudflare/src/coordinator.js:3718) —
and that no admission implementation or `refusals` reference exists
anywhere under `cloudflare/src/`, so an undeclared `ctx.refuse` really
does survive on that host. The ticket's named Rust test exists
(`application_refusal_is_admitted_only_when_declared`,
src/runtime.rs:4172), and the "no JS- or Cloudflare-side
application-refusal test exists anywhere" claim verifies (no test files
in `packages/snapback-harness/` at all; zero hits under
`cloudflare/test/` and `tests/`).

But the corrected floor is still one engine leg short, and the error is
in freshly written text: admission is not a property of "the Rust host" —
it is a property of the Rust host's *Ibex leg only*.

## Fresh findings (v2 text)

**MATERIAL-R2-1 — The per-host floor restatement is itself overstated:
the local workerd-v8 twin leg bypasses admission, so the hole is
per-engine-leg, not per-host — and the repair program inherits the
miss.**
§Floor facts 3–4, the parity ticket, §Recommended composition step 0.
`run_ibex_handler_with_context_until` (src/runtime.rs:2655) routes
queries and mutations to the workerd twin when
`SNAPBACK_HANDLER_BACKEND=workerd-v8` is selected
(src/workerd_exec.rs:74–82; excluded for actions only, :2665–2668) and
**returns at :2682 — before the single `admit_declared_refusal` call
site at :2726, which only the Ibex leg reaches**.
`run_handler_workerd` itself ends in plain `parse_handler_output`
(src/workerd_exec.rs:874) with no admission, and there is no other
admission call site in the tree (the only non-test caller of
`admit_declared_refusal` is :2726). So on the *local Rust host* under
the twin backend, a claimed `SNAPBACK_APP_REFUSAL` — declared or not —
passes to the caller with its app-authored bytes, exactly the defect
class floor fact 3 attributes to the Cloudflare host alone. The twin is
opt-in (default Ibex) and primarily the LLP 0048 parity harness — but
that is precisely the aggravation: the twin exists to prove
engine-parity, and this is an engine-parity divergence sitting inside
it. Consequences for the v2 text: floor fact 3's "fail-closed by
construction *on that host*" is false as stated; floor fact 4's "only
the Rust host then adjudicates the claim" should read "only the Rust
host's Ibex leg"; the parity ticket's fix shape (Cloudflare-side
admission) is scoped one leg short — the structural fix is to hoist
admission out of the engine legs into the engine-neutral completion
path (the workerd branch's early return at :2682 skips only admission;
`denial_witness`/`stream_refusal` restoration are action-scoped and
actions never take the twin branch, so admission is the only orphan);
and step 0 plus the floor-repair witness should cover the triad on
**three** surfaces (Ibex leg, twin leg, Cloudflare host), not two.
Resolution: one sentence-level pass over floor facts 3–4, widen the
ticket (or file the twin-leg sibling), extend step 0's triad, and note
the hoist as the fix shape.

**DETAIL-R2-1 — A2 still carries "(the 0094-gap ticket's ask)" after
§Motivating evidence downgraded that citation to analogy.**
§Axis A2 vs §Motivating evidence. v2's motivating-evidence text now
correctly says the enumerability framing "is this RFC's extrapolation …
an analogy, not the ticket's recorded ask", but Axis A2 (line ~212)
still asserts the ask directly — the round-1 detail was applied in one
place and not the other. Same sweep should re-argue A2's "single
enumerable registry" line against floor fact 6 in place (only OQ5
carries the caveat today): enumerable to codegen consumers is not
enumerable to the clean-room client while the public descriptor drops
`refusals`.

**DETAIL-R2-2 — I3 is stated in the indicative and is now contradicted
twice by the RFC's own floor.** "Any path that does not deliberately
carry the declared set folds every claim" is aspiration, not fact, on
the Cloudflare host (floor fact 3) and on the twin leg (MATERIAL-R2-1).
Rephrase normatively — "must fold" — so the invariant reads as the
obligation the repair restores rather than a description the floor
section itself refutes.

**DETAIL-R2-3 — B3's value-free validation note has no stated wire
location, and C1's "no envelope-schema change" quietly depends on the
answer.** D2's discriminated pair makes `detailsDropped` a typed
discriminant the *client* must be able to compute, which means the
dropped-payload marker must cross the wire somewhere (presumably a
diagnostic-details field). That is smaller than C2's `appCode`
promotion, but it is not nothing: either name the carrier (a
`detailsDropped: true` / note field inside `appDetails`-adjacent
diagnostic details, fixture-pinned in class 1) or soften C1's claim to
"no envelope-schema change beyond the B3 marker".

## Round-1 findings ledger

- **M1 (as-built Axis F + observation half): RESOLVED.** Axis F now
  opens with the read-out total-collapse determination (citation chain
  reproduced accurately), splits observation (FO-1/2/3, all three
  genuinely distinct) from transport, sketches the F1 refusal-witness
  state machine faithfully to the `restore_denial_witness` precedent
  (exact-match restore, caught-refusal invalidation, single-witness
  rule), and pulls the fold-always pinning test to step 0. F3's
  distinct-field spelling (`refusalExposure`) properly avoids mutating
  A1's settled grammar.
- **M2 (disclosure): RESOLVED.** Axis I with I-1/I-2/I-3, invariant I7,
  and a witness; I-2's schemas-as-disclosure-allowlist argument is a
  real addition, and I-3 stays honestly advisory.
- **M3 (fixture scope + divergence): RESOLVED.** The
  no-completion-envelope-class fact is recorded, the three fixture
  classes are correctly separated by authority, the 16-code divergence
  list matches my round-1 enumeration exactly, and OQ8 asks for the
  ruling. The new "Rust-side tests only (direct and served-path)"
  claim verifies (src/runtime.rs:4172;
  `declared_application_refusal_round_trips_and_undeclared_folds`,
  src/local.rs — in-process `LocalSnapback` end-to-end, "served" per
  that test's own doc comment).
- **M4 (public-descriptor omission): RESOLVED with residue.** Floor
  fact 6 records it with the right anchors; OQ5/OQ6 re-argue against
  the real baseline; the A2 in-place residual is DETAIL-R2-1.
- **Details D1–D4: RESOLVED** (LLP 0061 in Related and LLP 0070's Axis
  E adjacency named — `lastErrorCode` verifies at src/jobs.rs:158; OQ4
  rewritten over the verified fragments with the ruling kept open; C
  witness reworded to decoded judgments; D3↔A6 cross-reference closes
  the loop). The Axis E ownership rewording also verifies: LLP 0133 is
  Accepted, and its §element-1 text explicitly leaves refusal typing
  and quarantine/resync disposition to other owners ("not decided
  here", llp/0133:575–583).

## Recommended next step

Revise and stay Draft: apply MATERIAL-R2-1 (floor facts 3–4 sentence
fixes, ticket widened to the twin leg or a sibling filed, step 0 triad
on three surfaces, hoist-the-admission fix shape) and the three
details. That is a small, mechanical round; nothing in the option
space, the recommendation, or the open questions needs to move. After
it, this reviewer expects READY.
