# Review: LLP 0223 — Claude family

## Round 1

**Provenance**
- Round: 1
- Date: 2026-08-10
- Target: `llp/0223-zero-config-connect-and-knowledge-closure.plan.md`, revision b, blob `fb714266c13d09b7532aa9333247a54daac85f05`
- Capsule: `round1-capsule`, sha256-16 `35d30046c8c91415`
- Reviewer runtime/mechanism: Claude family via Agent tool (general-purpose subagent), capsule-confined read-only instructions; mutually blind to the GPT reviewer
- Verdict: NOT READY

**Review (verbatim)**

The review is complete. All capsule evidence has been checked against the plan's claims.

---

**(i) Overall assessment.** LLP 0223 is a well-scoped, well-evidenced thin Plan whose factual spine almost entirely survives verification against the capsule: the pilot B9 figures (68/82/80, nulls-block-totals, builder-self-scored, graders unrun) match the run record exactly; the `startMetro` injection of `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` is at `packages/snapback-cli/expo-dev.mjs:1051` and the transient 0o600 descriptor write (removed in `close()`) at :1503, both as claimed; `MintSessionRequest` is `src/auth/wire.rs:344` (email-only, `deny_unknown_fields`); `auth_host_operation_input` is `src/server.rs:19709` with two generic "authentication request is invalid" emissions and access to `request.operation`, so the proposed contextual details are implementable; the mint dispatch arm parses `MintSessionRequest` from `args`; the CLI projection is exactly `{"operation":"auth.mintSession","args":{"email":…}}` (`mint_session_request`, `src/cli.rs:3863`, within the plan's "~3861"); the registry entry sits at line 20467 with five sites and null `guideAnchor`; `guide/clients/react-expo.md` ~587/~615, retrieval-eval case 25 (~270–281), and both capability rows (react-expo shipped; compose-existing-app GAP with its own issue) all check out, as do the LLP 0181 no-committed-env contract, LLP 0193's per-code grading unit, the 0146 OQ6 carrier attribution, and LLP 0061 §5 ownership. The `expo-chat` scaffold exists, `tests/host_ops_v0.rs` is the right proof home, and both Open Questions are genuinely open (a re-open trigger and a conditional evidence-interpretation rule, not disguised decisions). One load-bearing factual claim, however, is the only one in the document with no file citation and is not supported — and is partially undercut — by the capsule evidence supplied for it, which is enough to hold the document one revision short.

**(ii) Concerns.**

1. **MATERIAL — the ControlCatalog `inputSchema` claim is uncited and unsupported by its capsule evidence.** The plan asserts (Design detail, ticket 2): "Populate the ControlCatalog `inputSchema` for `auth.mintSession` — the field exists in the catalog schema (other entries carry it) but this entry has none." This is the only factual claim in the document without a file/line anchor. The capsule excerpt designated as "the routes/catalog `inputSchema` wiring" (`src/schema_export.rs`, `http_routes_artifact`/`route_schema_refs`) shows `inputSchema` only at the **HTTP-route** level, where `POST /_snapback/api/host-ops` falls through to `(None, None)` — one route serving 40 operations, structurally unable to carry a per-operation schema. `tests/host_ops_v0.rs` confirms per-operation catalog entries exist (`/_snapback/api/control-catalog/operations/{op}` returns `entry`) but shows no `inputSchema` field on them, and no `inputSchema` appears anywhere else in the capsule. If the field does not actually exist on catalog operation entries, ticket 2's first bullet changes shape (add the field additively vs. populate an existing one), and the "other entries carry it" premise misleads the implementer. Smallest fix: pin the claim — cite the file and approximate line where a ControlCatalog operation entry declares/carries `inputSchema` (naming one entry that carries it), or reword the bullet to "publish an input schema for `auth.mintSession` through the existing catalog entry (adding the field additively if per-operation entries lack it today)" and drop the unverified "other entries carry it."

2. **MINOR — "per-site" understates the plan's own "per-context" unit, and the registry cannot carry the promised note.** Registry sites `src/server.rs:19720` and `:19727` are the two emissions inside the shared `auth_host_operation_input` parser, which serves `auth.mintSession`, `auth.rescueCollidingTable`, `auth.integrationRetire`, and `auth.integrationSuspend/Resume` — so a per-**site** anchor cannot by itself route "the mint context"; the plan's own emission-time details (ticket 2) do that. Also, the registry format shown carries per-code `guideAnchor`/`guideAnchors` with no per-site anchor attribution, and it is generated — a hand-written "registry note" has no home there. Smallest fix: in the Decision and ticket 4, say "per emitting context (per-site at minimum; the shared host-ops parse site is disambiguated by ticket 2's emission-time details)," and state where the note lives (the LLP 0193 amendment/graded ledger, or an additive registry field), rather than "a registry note that … anchors are per-site."

3. **MINOR — "one generic URL would misroute four of them" is loose.** Because two of the five sites serve four operation families, misrouting counted by site understates the argument. Smallest fix: "would misroute every non-mint context (the five registered sites include a shared host-ops parser serving four operation families)."

4. **MINOR — ticket 3 omits the eval case's required fields.** `guide/retrieval-eval.md` (~437) requires each case to name expected pages and lexical route terms. Smallest fix: add them to ticket 3, e.g. expected pages `operating/host-ops.md`, `auth/native-apps.md`; route terms "auth.mintSession", "session mint HTTP", "SNAPBACK_AUTH_REQUEST_INVALID", "identity broker".

5. **MINOR — ticket 2's `snapback guide` proof is under-specified.** A code-keyed query cannot know the caller's context, so "routes the mint context correctly" needs a testable form. Smallest fix: state the assertion as "the command's output for the code includes the mint-context anchor (host-ops mint section) among its per-context anchors."

**(iii) AUTHOR-DECISION items.** None. The three binding decisions (auto-inject not auto-write; knowledge closure riding LLP 0193 with per-context grading; deliberately thin four-ticket scope) are consistent with LLP 0181's contract, the capsule code, and the pilot evidence, and I see no rethink-scale objection.

VERDICT: NOT READY

## Round 2

**Provenance**
- Round: 2
- Date: 2026-08-10
- Target: `llp/0223-zero-config-connect-and-knowledge-closure.plan.md`, revision c, blob `58858aecc63b6f5fdde0c907df4f08b0e3e92d2e`
- Capsule: `round2-capsule`, sha256-16 `a923788f92a78367`
- Reviewer runtime/mechanism: Claude family via Agent tool (general-purpose subagent), capsule-confined read-only instructions, blind to round 1 and to the GPT reviewer; delta (b -> c) enumerated in instructions
- Verdict: READY

**Review (verbatim)**

All load-bearing citations are now checked. I have verified the round-2 evidence for the catalog claim, the shared-parser fan-out, the guide/eval conventions, LLP 0181's `ready` semantics, the pilot record, and the expo-dev.mjs lifecycle. Here is the review.

---

## (i) Overall assessment

Revision c is a substantial improvement and the delta lands cleanly. Every factual claim I checked against the capsule holds: the ControlCatalog `inputSchema` claim is now pinned correctly (the generator's override application — `if (override.inputSchema) entry.inputSchema = override.inputSchema;` — exists in `scripts/generate-control-catalog.mjs` per the round-2 excerpt; the extracted catalog entries confirm `config.set` carries `inputSchema` while `auth.mintSession` carries none; the route-level contrast is honest — the host-ops route falls to `schema_export`'s null default arm, whose doc comment explicitly declares null honest). The five-site registry claim, the two shared-parser sites (server.rs 19720/19727 inside `auth_host_operation_input` at 19709), the four operation families served by that parser (mintSession, rescueCollidingTable, integrationRetire, integrationSuspend/Resume), the null `guideAnchor`, the corrected chronology (react-expo.md ~587/~615 persisted-receipt content, retrieval-eval case 25 at ~270), LLP 0181 revision (h)'s "does not require live transport to call retained state ready," the descriptor's 0o600 mode and close-time removal, and the pilot's 68/82/80 B9 figures with the nulls-block-totals/graders-unrun caveat all verify. The live-round-trip acceptance closes a real hole in revision b's proof obligation, and the cache/receipt exemption correctly reconciles the durable-copy ban with the shipped persisted-receipt fallback. All four tickets now carry clear, testable proof obligations (ticket 3's retained cold-agent transcript under `guide/eval-runs/` matches the protocol retrieval-eval.md already defines, including its ~15-tool-use budget). Remaining concerns are minor.

## (ii) Numbered concerns

1. **MINOR, IN-DELTA — Ticket 4's graded-ledger location is ambiguous against LLP 0193's own design.** Ticket 4's proof reads "the dated amendment text and graded-ledger entry in LLP 0193 itself," but LLP 0193 Phase 1 defines the graded ledger as "a checked-in graded ledger under `tests/acceptance/diagnostics/`" — not inside the LLP document. Since the Phase 1 ledger may not exist yet, recording the grading in the amendment is defensible, but as written an implementer could park a "ledger entry" inside the LLP that the drift gate's baseline (the checked-in ledger) never consumes. Smallest fix: one clause — e.g., "the dated amendment in LLP 0193 itself; the per-context grading of `SNAPBACK_AUTH_REQUEST_INVALID` carried into the Phase 1 ledger under `tests/acceptance/diagnostics/` when that ledger lands."

2. **MINOR, IN-DELTA — "(25 incl.)" in ticket 3 is ambiguous.** "Existing cases (25 incl.) are retained, not replaced" can be misread as "25 cases total" (the file has at least 31). Smallest fix: "Existing cases — including case 25 — are retained, not replaced."

3. **MINOR, PRE-EXISTING — the `expo-chat` scaffold suite is cited but not evidenced in the capsule.** Ticket 1's proof anchors on "the `expo-chat` scaffold suite," which appears nowhere in the capsule's cited code or guide pages (capabilities.md's react-expo witnesses name `expo-bootstrap-exchange.test.mjs` and `expo-device-forwarding.test.mjs`). If the suite exists, pin its path; if it does not, ticket 1 should say the acceptance is added where scaffold acceptance lives. Smallest fix: cite the suite's file path once in the Design detail bullet.

4. **MINOR, IN-DELTA (mint self-description bullet) — the catalog's mint `guide` pointer is left generic.** The `auth.mintSession` catalog entry's `guide` field currently points at `operating/host-ops.md#served-request-operations`; ticket 2 adds a mint-specific host-ops section but never says the catalog pointer should move to it, even though the same overrides mechanism the plan now pins (`applyOverride`'s `guide` field) makes that a one-line authored change. Smallest fix: add "and point the catalog entry's `guide` anchor at the new mint section (via the same overrides file)" to ticket 2.

5. **MINOR (altitude), IN-DELTA — "among its per-context anchors" presumes an output shape ticket 2 doesn't specify.** The registry today carries a flat `guideAnchors[]` array; the supplemental `snapback guide SNAPBACK_AUTH_REQUEST_INVALID` check speaks of "per-context anchors" without saying whether context labeling is a registry-shape change (which ticket 4 says rides ticket 2's generated fields) or just multiple anchors in the flat array. A competent implementer can resolve this, so it is altitude, not material. Smallest fix: either drop "per-context" from the supplemental check ("includes the host-ops mint-section anchor among its anchors") or note the flat array suffices.

## (iii) Pre-existing MATERIAL concerns

Pre-existing clean — the only pre-existing concern found (#3) is minor.

## (iv) AUTHOR-DECISION items

None. The three binding decisions (auto-inject not auto-write; closure riding LLP 0193 with per-emitting-context grading; the deliberately thin four-ticket scope) are well supported by the capsule evidence — in particular, the shared-parser fan-out and the descriptor lifecycle make the chosen option's rationale concrete — and I see no rethink-scale objection.

VERDICT: READY
