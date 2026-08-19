# LLP 0193: Errors-as-docs completeness program

**Type:** Plan
**Status:** Accepted
**Systems:** Diagnostics, Error handling, Guide, Agent experience, CI
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-10 (amendment: grading unit for shared codes tightened
per LLP 0223 ticket 4 — per emitting context, (code, operation) under
fan-out; first entry `SNAPBACK_AUTH_REQUEST_INVALID` recorded ahead of the
Phase 1 ledger.) 2026-08-10 (amendment: accepts ownership of the `snapback
feedback` verb per the 2026-08-10 author ruling on
`issues/20260809-snapback-feedback-verb-proposal.md` — design added as a
dated amendment under Phase 4; explicit invocation only, the
0207-rejected telemetry stays rejected.) 2026-08-08 (implementation amendment: replaces the 200–500 intake estimate with the audit's measured ~2,418 production-code vocabulary and records the measurement method.) 2026-08-08 (Accepted by Charlie Cheever — author ruling in session; final review binding per llp/reviews/0193-*.run.md close-out: 0194 dual-READY at r8, the others accepted with the enumerated r9 tail.) 2026-08-08 (r9, round-7 fixes: the residue routing re-derived from diary 0069's record — run 5's refusal-reachable set is EMPTY (1/4 → 0196, 2/3/5 → 0194, 6 = guide-anchor gap, no refusal incident), replacing r8's unverified 1/4/6 enumeration; D7 terminology narrowed to the typed-remediation requirement vs OQ6's carrier.) 2026-08-08 (r8, round-6 fixes: ledger fields made orthogonal (representation / target kind / OQ6 mechanism); candidate-vs-published closure validation so unreleased diagnostics stay landable; exit criterion 5 requires downgrade+refix+retest for ineffective A-grades, bounded to the first post-ratchet run; carrier trigger = OQ6 carrier SHIPS; three-of-six residues enumerated.) 2026-08-08 (r7, author-merge: Charlie's reconciliation —
the evidence claim narrowed to the refusal-reachable three-of-six subset
with the rest routed to 0194/0196; the ledger grades resolution quality
and closure binding (carrier/target/applicability/one-attempt witness
fields); exit criterion 5 adds the one-attempt recovery test; OQ1 recast
as migration cadence — merged onto the r6 review spine, keeping the
retained-exemplar corrections, the ~2,700-symbol population note, the
OQ6 carrier dependency, mechanical reclassification refusal, and
post-run grading.) 2026-08-08 (r6, this document: sibling-ticket provenance corrected (excursion vs product-half fix), retrofit removed from the observed list, reclassification refusal made mechanical + exit-criterion negative test, post-run grading outside the metered window. UNREVIEWED — applied after the final authorized round; every change resolves an enumerated round-5 concern.) 2026-08-08 (r5, this document: exemplar reattributed (assets-put-user is the retrofit case, ticket-cited); reclassification gating in Phase 3; 0065 slug.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations; 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (W3 states the bar), LLP 0146 (D7 — typed
remediations, ratified at sitting #4), LLP 0010 (diagnostic codes),
LLP 0194 (generated reference anchors), LLP 0197 (benchmark
disclosure), diaries 0065
(`0065-rematch-published-closure-bakeoff`)/0066/0068/0069

## Summary

Across the retained measurement series, refusal-quality incidents
resolved fastest when the refusal named its own fix — diary 0048's (`0048-upload-bakeoff-faceplate`)
`SNAPBACK_ASSET_IMAGE_DECODE_FAILED` carrying the exact upstream parser
error, is the retained observed exemplar; the anonymous-upload refusal
(`SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE`, which now names
`snapback assets put --user`) is the retained RETROFIT exemplar — the
0058-era run paid the source-reading excursion (recorded in
`issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`)
and the remediation-carrying message is the sibling product-half fix
(`issues/closed/20260805-expo-asset-upload-guide-gap.md`, resolved
2026-08-06), exactly the before/after this program generalizes — while several of
the expensive detours trace to refusals that carried neither rule nor
fix. (Additional unretained lane-report incidents exist but are not
cited as evidence here.) Refusal quality is one high-leverage subset of
the remaining cost, not the whole remainder: run 5 also paid for a
template defect, simulator-proof assembly, and signature discovery that
no refusal could repair — those route to LLP 0196 and LLP 0194 and keep
this Plan's causal claim bounded. LLP 0186 W3 states the
bar — **every `SNAPBACK_*` refusal an authoring agent can trigger names
the violated rule and either the fix or a resolving guide anchor** — but
the bar has only ever been applied to codes that happened to appear in
diaries. This Plan audits the entire population once and then makes the
bar structural, so it can never regress.

## Evidence

- Diary 0069: six expensive moments were knowledge-shaped, and the
  retained record routes none of them to a mishandled `SNAPBACK_*`
  refusal: residues 1 and 4 (template web deps, simulator-proof
  recipe) route to LLP 0196, residues 2, 3, and 5 (signature
  discovery) to LLP 0194, and residue 6 (supervisor-origin
  discoverability) is a guide-anchor gap with no refusal incident in
  the diary or its ticket. Run 5's refusal-reachable set is empty;
  the observed evidence for this Plan's mechanism is the earlier-run
  exemplar pair below, and run 5 bounds the causal claim rather than
  extending it.
- The retained record shows the mechanism in both directions: observed
  refusals that named remediations (diary 0048's decode diagnostic, the
  seed-recovery messages) cost near-zero (the `assets put --user`
  remediation is the retrofit case above, not an observed resolution);
  refusals that did not each cost a bisection session — diary 0058's (`0058-relay-room-expo-backend-bakeoff`)
  "host-ops error response was not JSON" (in-checkout era;
  `issues/closed/20260805-managed-dev-multi-json-load.md`) and the
  SHA-256-hashed field path
  (`issues/closed/20260805-result-contract-violation-hashes-field-path.md`).
- The infrastructure half-exists: stable code registry, the
  production diagnostic-inventory drift gate, and the typed-remediation
  requirement D7 ratified (the enforcement/storage carrier itself
  remains OQ6's selection).

## Program

**Phase 1 — enumerate and grade.** Extract the complete `SNAPBACK_*`
code inventory (a raw identifier sweep finds ~2,700 `SNAPBACK_*` symbols
including env vars and test constants; the diagnostic subset is the
real population and Phase 1 establishes its size) from the diagnostic registry
plus a grep sweep for unregistered emissions. Fan out grading lanes:
each code graded A (names rule + current fix/anchor), B (names rule
only), or C (bare). The ledger also records the emitting site, agent-triggerability, and
three orthogonal remediation fields — emitted representation
(`structured | message-text`), remediation target kind
(`inline-fix | guide-anchor | reference-symbol`), and the OQ6-selected
enforcement/storage mechanism once ruled — plus closure/version
applicability, anchor/symbol resolution, and whether a cold one-attempt
recovery witness exists. A structured remediation targeting an exact
registry symbol is an ordinary valid combination. Output: a checked-in graded ledger under
`tests/acceptance/diagnostics/`.

**Phase 2 — fix in evidence order.** First: every B/C code that appears
in any diary's correction-loop list. Then B/C codes on
agent-triggerable paths, batched by subsystem. Message edits follow the
house style; guide and LLP 0194 reference anchors must resolve against
the closure the remediation names: unreleased diagnostics validate
against the exact candidate/build closure digest and are revalidated
against the qualified published digest at release (so the ratchet never
makes an unreleased diagnostic unlandable), and the remediation and its
anchor must name the same closure (check-guide and the reference checks
enforce). Codes
that are genuinely internal (never agent-triggerable) are marked so in
the ledger rather than polished; later reclassification of an
agent-triggerable code to internal is refused mechanically by the drift
gate absent an explicit override marker, under the same review bar as a
grade regression.

**Phase 3 — the ratchet.** Extend the diagnostic-inventory drift gate:
a new agent-triggerable code cannot land without a remediation in the
carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
floor. The typed-remediation end state is 0146's ratified D7 and is not
reopened here; the carrier choice is OQ6's open ruling
(`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`) and is a
named dependency of this phase's structured half — until it rules, the
gate enforces text+anchor as a bounded interim floor, upgraded
code-by-code as the carrier lands (new codes use the structured carrier
once it exists; audited legacy codes may hold the floor until touched).
Anchor and generated-symbol resolution join CI. The graded ledger
becomes the gate's baseline; grade or closure-applicability regressions
fail.

**Phase 4 — close the loop with measurement.** Refusal grading happens
post-run from retained lane reports and transcripts — outside the
metered window, so Snapback-only grading duty never skews the
comparison (LLP 0197's fairness rules assume this) — and records
whether each supplied remediation resolved the condition in one
attempt. New B/C sightings and A-grade remediations that still caused
search or bisection are the recurring audit input.

### Dated amendment — 2026-08-08: measured Phase 1 population

The earlier intake estimate of **200–500** codes is superseded by the audit's
measured **~2,418 distinct production `SNAPBACK_*` identifiers**. The audit
scanned literal identifiers in `crates/snapback/src/**/*.rs` (1,248 distinct) and
`packages/**/*.mjs` (1,316 distinct), excluded tests, fixtures, and templates,
then deduplicated the two sets to a 2,418-identifier union. This measurement is
the sizing input for Phase 1; grading still distinguishes actual diagnostics
from environment names, protocol constants, and other non-emitting vocabulary.

### Dated amendment — 2026-08-10: the `snapback feedback` verb (Phase 4 intake)

Accepted in principle by author ruling 2026-08-10 on
`issues/20260809-snapback-feedback-verb-proposal.md` (origin: the LLP
0207 dissolution). This Plan owns the verb because Phase 4's grading
loop is its consumer: the npm-consumer population is invisible to the
loop today (LLP 0202 theme 5's surface inventory shows no feedback
affordance), so refusal grading runs on internal benchmark evidence
only. The ruling's fences bind this design: **explicit invocation only,
no ambient collection** — the opt-in `SNAPBACK_*` frequency telemetry
killed in the 0207 review
(`llp/reviews/0207-agent-efficiency-round-two.gpt-5.md`, round 1
concern 6) stays rejected, and nothing here reintroduces it. The verb
never runs as a side effect of any other command, installs no hooks,
counts nothing, and transmits nothing except during a deliberate
`snapback feedback` invocation by the user or an agent acting on the
user's visible intent (the expo-skill-feedback posture).

**Verb surface.** `snapback feedback "<text>"` with optional
`--category "<category>"` and `--subject "<subject>"` — a single
non-interactive command, mirroring the expo-skill-feedback shape
(`npx --yes submit-expo-feedback@latest "TEXT" --category ... --subject
...`). It works from any installed closure — the npm-distributed CLI,
not just a checkout — and never prompts: every path through it is a
print-and-exit or a send-and-exit.

**What gets sent — exhaustive.** The payload contains exactly:

1. the free-text message, and the `--category` / `--subject` values if
   given;
2. the CLI version and the installed closure/package version
   identifiers as the installed distribution itself reports them
   (the `snapback --version` surface);
3. the platform triple (e.g. `aarch64-apple-darwin`);
4. a payload schema-version field, a client-generated random report id
   (not derived from any machine or user identifier), and a send
   timestamp.

Nothing else, and everything not listed is excluded by construction:
no source code, no file paths, no working directory, no environment
variables, no project/app/schema names or contents, no error
transcripts (unless the user pastes text into the message themselves),
no usage counts or command history, no hostname, username, machine id,
or persistent client identifier, and no ambient usage data of any
kind. The receiving endpoint must not persist transport metadata
(client IP) with the report.

**Consent copy and acknowledgment.** On first use the verb sends
nothing: it prints the consent copy plus the exact composed payload
and exits 0, instructing a re-run with `--consent`. Proposed copy:

> `snapback feedback` sends exactly: your message (with any
> `--category`/`--subject`), your Snapback CLI and package versions,
> and your platform (e.g. `aarch64-apple-darwin`). Nothing else — no
> code, paths, environment, project data, or usage data — and nothing
> is ever sent except when you run this command. Reports go to the
> Snapback maintainers and are deleted after 12 months. Re-run with
> `--consent` to acknowledge and send; later invocations will send
> without this notice.

`--consent` records the acknowledgment as
`~/.snapback/feedback-consent.json` (consent-copy version +
timestamp); subsequent invocations send directly. If the config
directory is unwritable, `--consent` sends without persisting and the
notice repeats next time. A material change to the payload or copy
bumps the consent-copy version and re-triggers the notice.

**Endpoint ownership.** Primary: `POST
https://snapback.expo.app/api/feedback`, an Expo Router API route on
the existing EAS Hosting project (`@ccheever/snapback`) that already
serves the docs site (`website/`, LLP 0041/0195 pipeline) — the one
hosted surface this repo owns and redeploys on every closure
publication. This requires flipping `website/app.json` from
`web.output: "static"` to `"server"` (EAS Hosting runs API routes on
its Workers runtime); the route validates the schema and forwards the
report to Linear (Exact project, `snapback-feedback` label) via an API
token held as an EAS Hosting environment secret. Stated fallback: if
the static→server flip is judged too coupled to the docs site, a
dedicated minimal Worker under the repo's existing `targets/cloudflare/`
deploy tooling serves the same route at a dedicated hostname, same
schema, same Linear forward. The CLI reads the endpoint URL from its
build, not the environment.

**Retention and read access.** Reports are retained **12 months** from
receipt, then deleted; what survives past deletion is only what a
Phase 4 audit has already distilled into graded-ledger entries,
tickets, or LLP amendments (which carry no more than the report's
substance). Readable by Snapback maintainers only — the Linear
workspace (Charlie plus agents operating with his credentials); never
public, never republished raw.

**Feeding Phase 4.** The standing post-run grading audit gains a
second standing input: each grading session sweeps `snapback-feedback`
reports received since the previous sweep. A report that names or
implies a `SNAPBACK_*` code is graded as a sighting against the
ledger — a B/C sighting joins Phase 2's evidence-order queue ahead of
un-sighted codes, and an A-grade code reported as still costing search
or bisection triggers exit criterion 5's downgrade-and-refix rule. A
report naming no code routes as naturalistic evidence to LLP 0186's
failure-to-recovery trace amendment or to a guide-gap ticket. The
report's version fields bind the sighting to a closure, exactly as
ledger applicability requires. Reports are advisory audit input, never
benchmark data: they never enter a metered window (LLP 0197's fairness
rules are unaffected).

**Failure behavior.** The verb must never block or break a workflow:
one bounded network attempt (connect+send timeout on the order of 5
seconds), no retries, no background work. On any failure — offline,
DNS, non-2xx, timeout — it **drops** the report: it prints a one-line
notice plus the composed payload so the user can retry or file
manually, and exits 0. No queue: a queued report would be sent later
as a side effect of some unrelated invocation, which is exactly the
ambient-transmission behavior the fences prohibit. Only argument
errors (empty text, unknown flag) exit non-zero.

**Proposals for the author** (concrete answers proposed above; confirm
or adjust): (1) the 12-month retention window; (2) the primary
endpoint's static→server flip of the docs site versus going straight
to the `targets/cloudflare/` Worker fallback; (3) final wording sign-off on
the consent copy. Everything else in this amendment is designed, not
open.

### Dated amendment — 2026-08-10: grading unit for shared codes (LLP 0223 ticket 4)

Shared codes are graded and repaired **per emitting context, not per
code**: the unit is **(code, operation)** where an operation is in scope at
the emitting site, and per-site where sites do not fan out. A single grade
for a code with fan-out sites would either misroute every non-matching
context (one generic anchor) or under-repair the shared site (a per-site
anchor cannot separate the operation families a shared parser serves).
Wrong-shape refusals get an inline expected contract or an exact reference;
no-refusal behavioral surprises stay with LLP 0061's diary/retrieval loop.
No new wire member: emission-time `details` carry the routing (message
text, structured details, and build-bound relative anchors suffice for
this tranche; LLP 0146 OQ6's structured-remediation carrier is not
pre-decided here).

First entry recorded under this rule — `SNAPBACK_AUTH_REQUEST_INVALID`
(five emitting sites, two behind the shared `auth_host_operation_input`
parser in `crates/snapback/src/server.rs`, which serves several host-ops operation
families):

- **(SNAPBACK_AUTH_REQUEST_INVALID, auth.mintSession): A** after
  LLP 0223 ticket 2 — the refusal's `details` name
  `operation: "auth.mintSession"`, the expected argument contract
  (`args: { email }`, closed), and the resolving
  `guide/operating/host-ops.md` mint-section anchor;
  `crates/snapback/tests/host_ops_v0.rs` pins the shape.
- **The remaining contexts of the shared parser** (the rescue and
  integration-operator families) and the non-fan-out sites
  (`crates/snapback/src/auth/provider.rs`, the `crates/snapback/src/server.rs` mailbox path,
  `crates/snapback/src/server/api_error.rs`) stay ungraded-B/C pending their own
  context repairs; they are unchanged by ticket 2 and keep the stable
  code.

Phase 1's checked-in graded ledger under `tests/acceptance/diagnostics/`
has not landed yet; per LLP 0223 ticket 4, this amendment records the
grading and the ledger entry follows with Phase 1. The generated
diagnostics registry is not hand-annotated; any registry change rides
ticket 2's generated fields.

## Exit criteria

1. Graded ledger covers 100% of registered codes; zero ungraded
   emissions in the sweep.
2. **Every ledger entry classified agent-triggerable is grade A** (the
   program's declared bar; diary-cited codes are merely the first
   batch).
3. The drift gate refuses a new agent-triggerable code without
   remediation/anchor, refuses grade regressions, and refuses
   unmarked agent-triggerable-to-internal reclassification (negative
   tests for all three).
4. A benchmark run encounters zero B- or C-grade refusals — as
   validation of criterion 2, not a substitute for it.
5. In the first post-ratchet benchmark run, every encountered A-grade
   refusal produces a one-attempt recovery; an ineffective A-grade
   remediation triggers downgrade and refix with a successful retest
   before this criterion passes (classes where one-attempt recovery is
   intrinsically inappropriate get a bounded alternative witness,
   named in the ledger). The standing per-run audit rule lives in
   Phase 4.

## Open questions

- OQ1: Migration cadence — how quickly audited legacy codes graduate
  from the text+anchor floor to D7's structured `remediations` carrier
  once the 0146 OQ6-selected carrier ships. New codes use the structured
  carrier from the moment it ships (the ruling alone does not end the
  text+anchor floor); the open question is cadence, not the target
  shape (settled by 0146's ratified D7). Proposal: structured on next
  touch, dated full-migration milestone set when the carrier ships.
- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
  from any published-surface operation, decided by the grading lane,
  spot-checked in review.
