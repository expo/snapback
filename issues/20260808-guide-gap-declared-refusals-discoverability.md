# guide-gap: declared refusals exist but handlers ship plain throws for months

**Status:** Open — P3; guide fix landed, asks 2–3 await author scope/contract choices
**Opened:** 2026-08-08 · **Severity:** P3 (DX/discoverability)

The typed refusal channel (`refusals: ['CODE']` + `ctx.refuse(code, details)`)
is exactly right, and the fold-undeclared-to-`SNAPBACK_HANDLER_FAILED`
posture is correct security. But the Zerobugs control — written by agents
reading the guide — shipped every application-semantic refusal as a plain
`throw new Error(...)` through ten receipted gate attempts, and only adopted
the channel when a gate assertion forced it (zb5-hot v9: the short-id
boundary refusal was invisible to the client as anything but a generic
handler failure).

Ask: (1) the mutations guide page should teach refusal-first ("if a caller
could act on the reason, declare it") rather than mentioning the channel in
passing; (2) consider a codegen advisory when a handler body throws
bare Errors on guard-shaped paths while declaring no refusals; (3) the
`SNAPBACK_HANDLER_FAILED` client message could hint "if this is an
application refusal, declare it" in dev mode.

- **Claim released 2026-08-08:** the sweep (session dc26442d) landed what it could and recorded the remainder above/below; the open remainder is unclaimed and free for any session to pick up.


## Triage (2026-08-26 leftover sweep)

Still open for asks 2–3 only. Ask 1 (guide teaching) landed 2026-08-08. No codegen bare-throw advisory; `SNAPBACK_HANDLER_FAILED` client copy still does not hint “declare it.” `issues/closed/20260822-declared-refusal-client-code-preservation.md` is a sibling (client `appCode` preservation), not this ticket.

## Partial resolution — 2026-08-08 (ask 1 landed; asks 2 and 3 remain)

**Ask (1), the guide teaching, is done.** `guide/backend/mutations.md` now
carries a dedicated intent-first section, *"Refuse with a declared code, not a
bare throw"*, replacing the one paragraph that mentioned the channel in
passing:

- The refusal-first rule stated as a rule ("if a caller could act on the
  reason, declare it"), with *why* the bare-throw path is opaque (the message
  is deliberately not a public contract) and this ticket's own incident —
  the control's ten receipted gate attempts — as the motivating evidence.
- Two CI-exercised snippets: the declaration from
  `packages/snapback-codegen/refusal-tracking-authoring.test.mjs` (a registered
  package test) and the declared/undeclared throw pair from
  `tests/conformance/twin-corpus.handlers.js` (compiled into
  `crates/snapback/tests/workerd_twin_v0.rs`).
- A **decide what deserves a code** table routing each failure kind to its
  channel (declare it / `SNAPBACK_MUTATION_CONFLICT` / auth codes / leave it
  bare), plus the code grammar, the fold contract, and `trackedRefusals`.
- The previously undocumented distinction that **declarative host-plan
  `elseError` / `guard` codes are a different channel** — they arrive as
  `diagnostic.code` itself, not as `SNAPBACK_APP_REFUSAL` + `appCode`, and
  codegen does not cross-check them against `refusals` (so
  `demos/warble`'s `refusals: ['POST_NOT_FOUND']` on a plan mutation is
  documentation-only). Matching one client branch against both shapes was a
  latent bug the page now prevents.
- A forward pointer at the point of choice, next to the page's own
  bare-throw `createIncident` snippet (LLP 0187 T1 routing convention).
- Two new anti-patterns: bare throw for application-semantic refusals, and
  the ad-hoc `{ ok: false, error }` success-envelope workaround.

Routing fixes landed with it: `guide/backend/queries.md` gained a
*"Refuse with a declared application code"* section (the capability index's
`backend.functions` row lists `ctx.refuse`/`refusals` as aliases but pointed
at `queries.md`, which never mentioned them — a dead lexical route), and
`guide/retrieval-eval.md` gained seed case 18 per the LLP 0187 T7 standing
rule. `node scripts/check-guide.mjs` is green (63 pages, 236 snippets,
0 errors).

**Remaining — asks (2) and (3), deliberately not attempted here.** Both are
runtime/codegen changes with a blast radius disproportionate to a P3 docs
lane, and both need an author ruling before implementation, not just code:

1. **Codegen advisory for bare throws on guard-shaped paths.** The blocking
   question is scope, not feasibility. The guide's own canonical example
   (`demos/signal-desk`'s `createIncident`) throws bare on
   `'incident title is required'` and `'invalid severity'` — arguably both
   *are* caller-actionable and should be declared, which means the advisory
   would fire across most existing demo handlers on its first run. Because
   codegen warnings are recorded in committed review manifests and summary
   counts, that lands as a repo-wide generated-artifact diff plus a decision
   about which of those throws are defects. Needs: an author ruling on what
   "guard-shaped" means (validation vs. domain vs. invariant), then the
   heuristic in `packages/snapback-codegen`.
2. **Dev-mode hint on `SNAPBACK_HANDLER_FAILED`.** The fold lives in
   `admit_declared_refusal` / the generic fold in `crates/snapback/src/runtime.rs`. The
   message string is asserted on by Rust unit tests, the conformance twin
   corpus, and the JS `packages/snapback-harness/envelope.mjs` leg, which
   must stay byte-identical across engines — so a hint has to be an added
   *detail field* under a dev-only flag rather than message prose, and that
   is a diagnostic-contract change worth its own review.

Leaving the ticket open with those two named; the discoverability gap that
motivated it is closed.

## Decision memo (2026-08-28)

Read-only investigation for the two asks the ticket parks on an author ruling.
Nothing was implemented. Every claim below was verified in this worktree at
`lane/o44-refusals`; where the ticket's own text did not survive verification
it is marked **CORRECTION**.

### Ask 2 — codegen advisory for bare throws on guard-shaped paths

**Recommendation: adopt the narrow definition (D5 below). Do not adopt
"validation" or "domain".**

#### The measurement

Method: balanced-paren extraction of every `defineJs*`/`define*` call
containing a `handler:`/`js:` across `demos/`, `packages/`, `tests/`,
`guide/` (`node_modules`, `dist`, `_generated` excluded), then every
`throw new X(...)` inside those bodies. Bucketing is structural: a guard is
**validation** when its condition is decidable from `args` and pure locals
(no `await`, no `ctx.`, no identifier whose initializer chain reaches either);
**invariant** when the message names a corrupted/impossible internal state the
caller cannot repair by changing the call; **domain** otherwise.

| | handler defs | throw sites |
|---|---|---|
| handler defs scanned | 530 | — |
| ≥1 bare `throw new X` | 148 | — |
| ...declaring **no** `refusals` | **143** | **211** |
| ...declaring `refusals` and still bare-throwing | 5 | 8 |

Of the 211 undeclared throw sites: **validation 58 · domain 128 ·
invariant 25**. 209 are in `demos/`, 2 in `packages/`, 0 in `tests/` and
`guide/` (guide snippets are drawn from real sources, so it holds no handler
bodies of its own). Residual classifier error is ~2 sites (noted below).

**validation (58)** — argument shape/format, decided before any read:

- `demos/signal-desk/snapback/functions.mjs:161` `createIncident` — `if (!title)` → `'incident title is required'`
- `demos/signal-desk/snapback/functions.mjs:163` `createIncident` — `if (!new Set(['SEV-1','SEV-2','SEV-3']).has(args.severity))` → `'invalid severity'`
- `demos/campfire/snapback/functions.mjs:88` `messagePage` — `if (args.limit < 1 || args.limit > 50)`
- `demos/tiny-triumphs/snapback/functions.mjs:13` `celebrate` — `if (!['spark','sun','leaf'].includes(args.vibe))`
- `demos/zerobugs/control/snapback/functions.mjs:4410` `acceptanceAttachAsset` — `if (!Number.isSafeInteger(args.size) || …)`

**domain (128)** — decided against persisted state; caller could act:

- `demos/signal-desk/snapback/functions.mjs:207` `addTask` — `'incident not found'`
- `demos/knockoff/snapback/functions.mjs:62` `ensureProfile` — `'That handle is already in use'`
- `demos/upload-bakeoff/party-wall/snapback-r2/snapback/functions.mjs:113` `deletePost` — `'only the author may delete a post'`
- `demos/improvement-sweep/arms/a4-snapback-web/evidence/app/functions.mjs:386` `updateRsvp` — `` `capacity exceeded: …` ``
- `demos/improvement-sweep/arms/a3-snapback-web/evidence/app/functions.v1.mjs:568` `moveIssue` — `` `stale move: revision …` ``

**invariant (25)** — the caller cannot act; a bug or a broken fixture:

- `demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs:797` `maintenanceStep` — `'org missing from seed'`
- `demos/zerobugs/control/snapback/functions.mjs:3707` `usersForProject` — `'project user read model references a missing user'`
- `demos/improvement-sweep/arms/a2-snapback-web/evidence/app/functions.mjs:232` `listMessagesPage` — `'cursor page unexpectedly empty'`
- `demos/zerobugs/control/snapback/functions.mjs:672` `fixtureIngestSummary` — `'fixture ingest ledger does not match the frozen large plan'`
- `demos/pocketbase-snapback-bakeoff/snapback-incident-room/snapback/functions.mjs:143` `recordMaintenance` — `'maintenance row missing'`

Known residual: `demos/zerobugs/control/snapback/functions.mjs:1751`
(`'issue label was not found'`) lands in validation but is domain; and
`demos/expo-golden-path-fixture/snapback/functions.mjs:245`
(`if (args.failAfterFinalize)`) is arg-driven but is a deliberate failure
fixture, not authoring to correct.

#### How large the first-run generated-artifact diff really is

The ticket's premise checks out, with one sharpening. Codegen advisories are
`severity: 'warning'` entries in `generate().diagnostics`; **no committed
`generated/*.json` carries the per-site diagnostics list** (verified across
every tracked `demos/*generated/*.json`). What *is* committed is the count:
`packages/snapback-codegen/codegen-summary.mjs:78` filters
`severity === 'warning'` and `:220` writes `counts.warnings` into the summary
that lands in `generated/artifacts.json` — which is itself the review manifest
(`reviewManifest.custody: "review-manifest"`, `path: "artifacts.json"`;
e.g. `demos/todo/snapback/generated/artifacts.json`, `summary.counts.warnings: 1`).
60 `generated/artifacts.json` files are tracked.

Mapping the 211 sites to their backends: **25 backends** contain them, of
which **19 have a committed `generated/artifacts.json`** whose
`summary.counts.warnings` would move. Under validation-only, 13 of those 19.
Under D5, **1**.

Independent of firing count, any new code adds one row to
`guide/reference/diagnostics-registry.json` (entry shape at `:11856`) and
chains into `guide/guide-flat.generated.md`,
`guide/guide-flat.reference.generated.md`, and the client diagnostic union
(`guide/reference/expo-snapback-client.md:8432`). That cost is fixed and small.

Warnings never gate generation — `ok` flips only on `severity === 'error'`
(`packages/snapback-codegen/index.mjs:2485` and peers) — so no demo build
breaks either way.

#### The relevant precedent

LLP 0178 (`llp/0178-generate-time-authoring-diagnostics.rfc.md`) already owns
this decision and sets a proof-shaped bar: advisories are for "a conservative
heuristic or incomplete proof," and the most recent one to land,
`SNAPBACK_AUTHORING_PLAIN_JOIN_RELATIONAL_QUERY`, shipped with "an
AST-plus-schema equivalence proof, a purpose-built positive fixture, a closed
negative matrix, and a **zero-candidate** demo/guide-source corpus scan"
(§ dated amendment 2026-08-10, lines 395–408; the scan itself is
`packages/snapback-codegen/plain-join-advisory.test.mjs:313–340`). Feasibility
is not in question: `packages/snapback-codegen/n-plus-one-advisory.mjs` already
parses handler bodies with acorn and walks guard structure.

#### Recommended definition

**D5 — "guard-shaped" means the throw already carries a refusal code.** Fire
when a handler throws `new Error('<TOKEN>')` where `<TOKEN>` is a string
literal that would be a *valid* `refusals` entry under
`packages/snapback-codegen/define.mjs:502–517` (`/^[A-Z0-9_]+$/`, 1–64 chars,
not `SNAPBACK_`-prefixed) and that token is not in the function's declared
`refusals`.

Fires on **4 sites / 2 handlers / 1 backend**, all in
`demos/zero-bakeoff/apps/latency-kanban/snapback/functions.mjs`:
`moveCard` at `:68` `'CARD_NOT_FOUND'`, `:69` `'CARD_LOCKED'`, `:70`
`'CARD_REVISION_CONFLICT'`, and `setCardLocked` at `:87` `'CARD_NOT_FOUND'`.
That is not a style opinion — it is a live bakeoff defect: the competing Zero
arm throws the same codes at
`demos/zero-bakeoff/apps/latency-kanban/zero/mutators.ts:28–29` and its
acceptance run treats `CARD_LOCKED` as a client-actionable outcome
(`demos/zero-bakeoff/apps/latency-kanban/zero/tests/acceptance.ts:194`), while
the Snapback arm ships those same codes through the opaque
`SNAPBACK_HANDLER_FAILED` channel. Generated-artifact diff: one
`summary.counts.warnings`, plus the fixed registry/guide-flat rows.

Does **not** fire on: any of the 58 validation sites, any of the 128
prose-message domain sites, any of the 25 invariant sites — including every
`demos/signal-desk` throw the ticket names. Zero false positives by
construction: an all-caps single-token message is the author having already
invented a machine-readable code and then discarding its machine-readability.

**Reject validation+domain (186 sites, 25 backends, 19 committed
`artifacts.json`).** It is a style verdict on the demo corpus wearing a
diagnostic's clothes, it fails LLP 0178's extension bar, and it would fire on
the guide's own canonical example — which is precisely the objection the ticket
raised and did not answer. That population is already addressed by the ask-1
guide teaching, which is the right instrument for "you *could* have declared
this"; codegen is the wrong one.

**Optional second rule, author's call — D6.** Fire when a handler declares
`refusals` and *also* bare-throws. 5 defs / 8 sites today; 4 defs are in demos:
`demos/coterie/snapback/functions.mjs` (`:788`, and `:1179/:1183/:1213`) and
`demos/messaging-snapback/snapback/functions.mjs` (`sendMessage` declares
`refusals: ['MESSAGE_RECIPIENT_LIMIT','CONVERSATION_ROSTER_DRIFT']` at `:388`
yet throws bare at `:399` `'a message needs text or an image'` and `:401`
`'conversation not found'`; `sendViewOnce` at `:524`). Signal is good — the
author demonstrably knows the channel — but it is a heuristic, not a proof: a
handler may legitimately carry both a declared refusal and a genuine bug path.
Adds 2 backends to the diff.

**Rule to state either way:** the advisory must never fire on a throw whose
message is prose. Prose is the platform's own signal that the author did not
intend a contract.

### Ask 3 — dev-mode hint on `SNAPBACK_HANDLER_FAILED`

**Recommendation: yes, and it is smaller than the ticket assumes — the dev-only
flag already exists and the message string does not need to move. Scope it to
the undeclared-refusal fold only, not to every handler failure.**

#### Verifying the ticket's constraint

Mostly true, with two corrections.

- **True — the Rust leg pins the redacted shape exactly.**
  `crates/snapback-engine/src/runtime/host_glue.rs:8256` asserts
  `production.diagnostic.message == "JavaScript handler failed"` and `:8258`
  asserts `production.diagnostic.details == json!({ "function": "probe" })` —
  whole-map equality, not a subset check. Nothing may be added in production.
- **True — the JS leg must stay byte-identical.**
  `packages/snapback-harness/envelope.mjs:180` `admitDeclaredRefusal` is the
  hand-written twin of the Rust fold and emits the same
  `message: 'JavaScript handler failed'` / `details.message: 'handler raised an
  undeclared application refusal'` bytes (`:189–193`); it is live on the
  Cloudflare serving path (`targets/cloudflare/src/coordinator.js:4303`, whose
  details reach the wire via `kitError` at `:2177`). Covered by
  `packages/snapback-harness/envelope.test.mjs:582–586`.
- **CORRECTION — the conformance twin does not compare this message.** The
  triad exists (`tests/conformance/twin-corpus.handlers.js:595–605`
  `declaredAppRefusal`/`undeclaredAppRefusal`/`bareAppRefusalClaim`; cases at
  `crates/snapback-conformance/src/bin/snapback-conformance-twin.rs:364–392`),
  but the observation it compares keeps `details` **only** for
  `SNAPBACK_APP_REFUSAL`; every other failure is reduced to
  `{"ok":false,"code":…}` (`:648–655`). The folded `SNAPBACK_HANDLER_FAILED`
  cases therefore compare code alone, and the twin runs under the default
  (redacted) exposure. Ask 3 does not touch it.
- **CORRECTION — the fold is not in `crates/snapback/src/runtime.rs`;** that
  file does not exist (`crates/snapback/src/` is `embed.rs`, `lib.rs`,
  `main.rs`). The crate split moved it.

#### Fold sites, as they stand today

- `admit_declared_refusal` — `crates/snapback-engine/src/runtime/host_glue.rs:6539`;
  the undeclared branch at `:6558–6572` mints
  `SNAPBACK_HANDLER_FAILED` / `"JavaScript handler failed"` with
  `details.message = "handler raised an undeclared application refusal"`.
  Called at `:5769`, after the Ibex/workerd executor join.
- Generic JS-throw fold — `crates/snapback-runtime/src/runtime.rs:672–679`.
- JS twin — `packages/snapback-harness/envelope.mjs:180`.

#### The dev-only flag already exists

`SNAPBACK_HANDLER_ERROR_EXPOSURE` (`host_glue.rs:5483`; `Development` variant
`:5488`; resolution `:5504–5512`; thread-local test seam
`with_development_handler_error_exposure` `:5519`).
`snapback dev` already sets it — `packages/snapback-cli/index.mjs:5056`.

The single seam that branches on it is `project_handler_failure`
(`host_glue.rs:5856`), applied at `:5780` *after* `admit_declared_refusal` and
`restore_host_failure_witness`. Its Redacted branch (`:5876–5879`) overwrites
`details` wholesale with `{ "function": … }`; its Development branch
(`:5918–5940`) builds the enriched map that already carries `errorClass`,
`callee`, `property`, `sourcePosition`. A new detail belongs there, and is
production-invisible for free.

#### Proposed shape

- **Field:** `details.undeclaredRefusalCode` — the app code the handler
  claimed via `ctx.refuse` and did not declare. Type: `string`. Present only
  when the failure is the undeclared-refusal fold; absent on every other
  `SNAPBACK_HANDLER_FAILED`.
- **A field, not prose.** No hint sentence enters `diagnostic.message`; the
  CLI/client renders "declare it in `refusals`" from the field's presence. That
  keeps the message byte-identical across engines and keeps the advice out of
  the i18n-less platform string.
- **Gate:** `HandlerErrorExposure::Development` only, inside
  `project_handler_failure`.
- **Scope:** the undeclared-refusal fold path only. A blanket hint on every
  `SNAPBACK_HANDLER_FAILED` would fire on genuine `TypeError`s and is noise;
  this path is the one where the author provably reached for the channel.

Plumbing required, because the fact is currently destroyed before the
enrichment seam: `AppRefusalTrackingV1`
(`crates/snapback-types/src/error_tracking.rs:316–319`) has only
`AdmittedUntracked | Tracked`, and the fold's undeclared branch sets no
tracking value at all. It needs a third variant (or a sibling field on
`PrivateFailureContextV1`, `:325–329`) carrying the claimed code.

Everything that would have to change:

1. `crates/snapback-types/src/error_tracking.rs:316` — new variant/field.
2. Its consumers: `crates/snapback-services/src/telemetry.rs:626`
   (`app_refusal_tracked` boolean) and the table at `:9745–9746`.
3. `crates/snapback-engine/src/runtime/host_glue.rs:6558–6572` — set it in
   the fold; `:5918–5940` — emit it in the Development branch.
4. New Rust unit test beside `host_glue.rs:8225` proving the field appears in
   Development and is absent in Redacted. **The existing `:8258` whole-map
   equality assertion needs no change** — that is the point of the gating.
5. New case in `crates/snapback/tests/workerd_twin_v0.rs` (pattern at
   `:820–855`) proving Ibex and WorkerdV8 agree. Parity is structural, since
   both legs pass through `project_handler_failure` at `:5780`.
6. `packages/snapback-harness/envelope.mjs` + `envelope.test.mjs` — **only if**
   the JS/Cloudflare leg should match. It has no exposure mode today (no
   `HANDLER_ERROR_EXPOSURE` anywhere under `packages/snapback-harness/` or
   `targets/cloudflare/`). Recommend leaving it unchanged and scoping the hint
   to the Rust dev server: enrichment already differs between the legs, and
   introducing a second exposure gate is a larger change than the hint.
7. `node scripts/check-inventories.mjs` — mandatory, not optional. The
   diagnostics registry records emitting *sites*; `host_glue.rs:5483` is
   recorded in `guide/reference/diagnostics-registry.json:90227` and
   `guide/reference/diagnostics.md:3700`, so any line shift in that file
   invalidates them and chains onward.
8. No conformance-twin change (see CORRECTION above).

No new `SNAPBACK_` code is introduced.

#### Is this a diagnostic-contract change needing its own review? Yes.

Three reasons, in order of weight:

1. **It sits on the LLP 0144 disclosure boundary.** The field names a code the
   handler *claimed and was refused*. I1 ("no option may admit a code on the
   strength of the throw alone") and I3 (fail-closed folding) survive only
   because the field is Development-gated; if it ever leaked into the redacted
   projection, an undeclared claim would acquire an observable effect. The
   gating *is* the contract, and a reviewer's job is to check it, not to take
   it on faith. I7 is the companion concern: refusal content is app-authored
   disclosure, and this field re-surfaces content the fold deliberately dropped.
2. **It changes a type consumed by error tracking.** The new
   `AppRefusalTrackingV1` state flows into telemetry fingerprinting
   (`telemetry.rs:626`), a subsystem with no stake in this ticket.
3. **It widens an observed diagnostic surface.** LLP 0144 I5 (wire tolerance,
   per LLP 0093) makes an added `details` key additive-safe for conforming
   clients, so the change is *compatible* — but once shipped in dev the field
   is something agents and tools will read, and its name and shape are then
   effectively pinned.

Weight is moderate, not high: it is additive, dev-only, adds no code, and
breaks no existing assertion. A scoped review against LLP 0144 §Invariants and
LLP 0193 is proportionate; a full super-refine round is not.
