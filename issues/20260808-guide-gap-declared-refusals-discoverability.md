# guide-gap: declared refusals exist but handlers ship plain throws for months

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
