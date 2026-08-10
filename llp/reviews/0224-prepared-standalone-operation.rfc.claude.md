# Review artifact — LLP 0224 (Claude family)

## Round 1

- **Round:** 1
- **Date:** 2026-08-10
- **Target:** llp/0224-prepared-standalone-operation.rfc.md, revision b, blob f221fdac90fd8faf1cc299149a79cbcdbb9d4b55
- **Capsule:** sha256-16 93c413b2601650f6 (target + Related LLPs + pilot lane evidence + line-numbered code excerpts; reviews excluded)
- **Reviewer runtime:** Claude Agent tool (subagent_type general-purpose), capsule-confined read-only instructions; mutually blind from the GPT reviewer
- **Verdict:** NOT READY

Verbatim review follows (subagent final message, unedited).

---

# Review — LLP 0224: Prepared standalone operation and the application-readiness receipt (round 1)

## Summary

This is a well-grounded RFC. The problem statement is faithfully anchored in the pilot evidence (the B11 row's two lifecycle gaps, the 20-attempt retry loop in `clique/scale-run.mjs`, the driver's "supervisor reports ready before the sessions deployment fully settles" comment), and every load-bearing citation I could check against the capsule holds: the LLP 0030 ready-file timing ("written atomically... only after the listener is bound and instance-lock metadata has been recorded"), the `runDev` managed-loop ordering (`waitForReady` at index.mjs ~2296, `loadGenerated` at ~2379), the LLP 0058 pre-bind consume ordering and `sessionActivationReady`/`modeState: settled` vocabulary, `buildRelease`'s `SNAPBACK_DEPLOY_CAPABILITY_MISMATCH` required-vs-supported check (index.mjs 1307–1318), LLP 0123's presence-vs-readiness distinction, LLP 0167's observation-not-state rule, LLP 0103's component-level completion results, and the capability-index shipped/partial rows. The layered-readiness design (host descriptor untouched; a new receipt for the settlement predicate) is the right shape, the honesty about lost pilot evidence is exemplary, and the phasing is sound. The remaining problems are three spec ambiguities that would change implementation: how startup obligations reach a standalone native start given the untouched v1 carrier, who authoritatively writes the Phase 1 receipt, and how a consumer detects the reload-staleness the RFC itself asserts.

## MATERIAL concerns

**M1 — The standalone startup-obligation carrier story is unresolved, and the sessions-mode composition with LLP 0058's mandatory `--startup-artifacts` is unstated.**
Evidence: the RFC's Option A cost line says native startup "must consume declared startup obligations (routes, API envelope), not just today's schema/functions carrier"; §Prepared-release capability story says `snapback.start-plan.v1` "references the immutable release and names its startup obligations" while "the closed `StartupArtifacts` v1 stays untouched" and "routes/seed data must not be smuggled into v1." But LLP 0058 (line 832) requires `--startup-artifacts` on **every** settled-sessions process start, failing pre-bind with `SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED` — and the Phase 2 CLI sketch (`snapback start --release ... --db ... --ready-file ... --application-ready-file ...`) shows no carrier at all. Meanwhile LLP 0109 §3.1.1 designed `StartupArtifactsV2` as exactly the closed pre-bind carrier for routes+seed, and that path is deferred (binding decision 4 — respected here). So a Phase 2 implementer faces an undescribed fork: does native `start --release` derive the unchanged v1 pair from the release's schema/functions manifests to satisfy 0058, and are routes/API-envelope installed pre-bind (new native machinery) or post-bind before the receipt (native self-provisioning through the same host-ops core `loadGenerated` uses)? The receipt predicate ("schema/functions/routes are active") depends on the answer. This is not a field-list request; it is the mechanism that decides whether Phase 2 accidentally reopens V2 or invents a third carrier.
Suggested fix: add two or three sentences to §Prepared-release capability story: (a) native `start --release` derives the unchanged `StartupArtifactsV1` pair from the release's schema/functions manifests, satisfying LLP 0058's every-start requirement byte-for-byte; (b) routes/API-envelope (and any seed, pending OQ2) are post-bind obligations the native start executes from the release through the existing host-ops core before publishing the application-ready receipt — never pre-bind and never via v1 extension; or explicitly assign the pre/post-bind placement of route installation to OQ2 so the fork is at least named.

**M2 — Phase 1 receipt authority: the supervisor writes a receipt whose predicate the RFC declares server-owned, with no connection between the two.**
Evidence: §Layered readiness says the receipt is written "only when the **server-owned** operational predicate is true"; Phase 1 says "`runDev` publishes `snapback.application-ready.v1` after its existing `loadGenerated` succeeds" — i.e., from the supervisor's client-side observation of its own provisioning calls, not from the server-owned fact. The same phase adds `OperationalReadinessV1` to `app.inspect` "so CLI/HTTP/future MCP projections share one core fact (LLP 0024)" — but as written the file receipt is a second, independently derived source that can disagree with the core fact (e.g., a watch-loop reload racing the publication), which is exactly the "behavior difference between projections" LLP 0024 calls a bug.
Suggested fix: state that in Phase 1 `runDev` derives the receipt's content by reading the server's `OperationalReadinessV1` fact (one `app.inspect`/host-op after `loadGenerated` succeeds) and writes the file as a projection of that one core fact, binding the returned nonce/digests; in Phase 2 the native server writes the same format itself. One sentence resolves the two-writers/one-authority question.

**M3 — Reload staleness is asserted but undetectable under the specified validation, and the receipt's lifecycle across reload/restart is unspecified.**
Evidence: §Layered readiness: "`snapback wait ... --level host|application` validates the receipt(s) plus the live nonce" and, later, "A receipt goes stale after a dev reload; it is digest-bound." A hot reload does not change the process, so the live `startupNonce` still matches; a `wait` implementing exactly the stated validation will accept a receipt for a generation that is no longer active — the RFC asserts a staleness its own sanctioned consumer cannot detect. The Phase 1 proof list covers no-early-receipt, stale nonce, and settled restart, but not stale-after-reload, and nothing says the reload/restart paths remove or rewrite the receipt (the ready-file discipline — `rmSync` before respawn at index.mjs ~2718/2743 — has no stated receipt analogue).
Suggested fix: (a) specify that the supervisor removes the application-ready file at the start of every reload/restart/dev-fresh and republishes only on settlement (mirroring the ready-file discipline), so absence is the honest intermediate state; (b) have `wait --level application` cross-check the receipt's generation/artifact digests against the live `OperationalReadinessV1` fact (which folds in M2's single authority), not the nonce alone; (c) add stale-after-reload to the Phase 1 process-test list.

## MINOR concerns

**N1** — Summary's "B11 ... 74 — above Convex's 52" omits that Supabase scored 75, above Snapback (`benchmarks/records/...p2-pilot.md` builder table). Selective comparison in an evidence-framing sentence; add the third number.

**N2** — Phase 3's "capability rows moved off their B11 caveats" presupposes caveats that the current `guide/capabilities.md` rows (operating.server-lifecycle, operating.packaged-dev-loop) do not carry. Either Phase 1 should add the caveat/GAP text or the sentence should read "rows updated to sanction the standalone lifecycle."

**N3** — The Convex `--once`-kills-the-backend evidence is cited only as lane knowledge; it appears in neither the run record's F6 Convex gap list nor any capsule artifact. Cite the specific lane artifact (run-log/diary) so the Option B rejection's factual anchor is checkable.

**N4** — The claim that `dev --no-watch` "loads once and closes its managed server (`runCliDev` no-watch branch)" is not verifiable from the capsule: the `runDev` excerpt returns `{ child, close }` without closing, and `runCliDev` is not excerpted. Include the branch in the next capsule or soften the citation to the command-registry lifecycle line ("long-running unless --no-watch").

**N5** — `snapback wait --ready-file <host> --level application` never says how the application-ready file is located. Suggest the mechanically derived sibling convention the descriptor family already uses (cf. `<ready-file>.impersonation`), or an explicit flag.

**N6** — The receipt file should be stated to inherit LLP 0030's publication discipline (atomic rename, owner-only mode, identity-disjointness from managed artifacts) even though it carries no bearer authority — one clause.

**N7** — Phase 1's proof includes converting "the Clique scale launcher" — an external pilot artifact under `~/clique-runs/` — into a repo-phase proof. Clarify this is a demonstration rerun, not a repo-gated check, to keep the proof list mechanically satisfiable.

**N8** — "LLP 0109 deferred V2" slightly misattributes: 0109 (Accepted) *specifies* `StartupArtifactsV2` in §3.1.1; the deferral is a separate implementation-status decision recorded outside 0109. Reword to "V2's implementation remains deferred" with the deferral's actual home if one exists.

## AUTHOR-DECISION channel

**AD1 — OQ2 resolution direction (seed/migrations vs readiness).** Question: are release-declared seed installs readiness-gating? Options: (a) launch-plan-requested seed gates the receipt (it is already "explicitly requested initialization" in the predicate) while LLP 0081 migrations never gate and stay operator steps; (b) all post-bind obligations are separate operator steps and the receipt covers only schema/functions/routes/auth. Recommendation: (a) — it matches the predicate as drafted and keeps LLP 0109's refusal semantics (a refused seed means no receipt, which is the honest signal).

**AD2 — Placement of `snapback wait`.** Question: native binary or package CLI? The standalone destination explicitly serves environments without the JS toolchain, yet Phase 1 lands `wait` alongside the package CLI's `runDev`. Options: native-only, package-only, or native-with-package-delegation. Recommendation: native (it is a thin read/validate over server-owned facts, and Option A's whole point is no supervisor dependency); the package CLI delegates.

No rethink-scale challenge to any binding decision: Option A as destination, Option D as first landing, the Option B rejection, and the untouched StartupArtifacts v1 all look right on this evidence; M1 is satisfiable within them.

VERDICT: NOT READY

## Round 2

- **Round:** 2
- **Date:** 2026-08-10
- **Target:** llp/0224-prepared-standalone-operation.rfc.md, revision c, blob 04b7e893094806581e0281f7cf8ab502683bc2c6
- **Capsule:** sha256-16 4c3f6e3000dbc1a4 (round-1 capsule + revised target + LLP 0189 + convex-lane scores; reviews excluded; delta enumerated in instructions)
- **Reviewer runtime:** Claude Agent tool (subagent_type general-purpose), fresh instance, capsule-confined read-only instructions; mutually blind from the GPT reviewer
- **Verdict:** NOT READY (pre-existing text clean; both MATERIALs IN-DELTA)

Verbatim review follows (subagent final message, unedited).

---

# Review — LLP 0224 (revision c), round 2

## Summary

I read the target RFC in full and verified its claims against the capsule context: the pilot record and lane scores (`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`, `clique/scores.md` §B11, `clique/convex-lane-scores.md` §B10/B11, `clique/scale-run.mjs`), LLP 0030's ready-file semantics and publication discipline, `schemas/host-ready.schema.json`, LLP 0058's settled invariant, consume ordering, and startup-artifacts requirement, LLP 0109 §3.1.1's deferred `StartupArtifactsV2`, LLP 0024's one-core rule, LLPs 0123/0167/0103/0189/0010/0041, the `runDev`/`loadGenerated`/command-registry excerpts, and `ReleaseVerification.activationEligible: false` in `packages/snapback-cli/index.d.mts`. Every factual citation I checked is accurate: B11 74/52/75 and the calibration-only label match the run record; the 20-attempt retry loop and its "sessions deployment" comment are exactly as described, and the loop does swallow the failed responses; `runDev` really does run `loadGenerated` after `waitForReady`, so the reframing of the race as post-bind package-level provisioning settlement (not necessarily auth) is both correct and better-evidenced than the driver's own comment; the `dev --no-watch` lifecycle line matches the command registry; the corrected LLP 0058 invariant matches the spec's settled row; the capability-index framing matches `guide/capabilities.md`. The layered-readiness design (one server-owned `OperationalReadinessV1` fact, receipt as projection, removal-before-work lifecycle, `wait` cross-check that survives same-process reloads) is sound and respects the binding decisions. The **PRE-EXISTING text is clean of MATERIAL concerns**; both MATERIAL findings below attach to round-2 delta text (the start-plan qualification step and the carrier/phase restructure). They are refinements — a sentence or a scheduling fix each — not redesigns, but each is a spec ambiguity or internal contradiction that would change implementation, so I withhold READY this round.

## MATERIAL concerns

**M1 — IN-DELTA — The start-plan's operational placement is undefined in the canonical flow.** §Prepared-release capability story defines "start-plan preparation" as "the explicit qualification step" and makes native `start` refuse "an unknown plan version" — i.e., `start` consumes a `snapback.start-plan.v1` artifact. But the Decision section's canonical two-command flow (`deploy build` → `start --release …`) contains no plan-producing step, and Phase 2 adds only "`snapback.start-plan.v1` and native `start --release` + `--application-ready-file` in `src/cli.rs`" — no `--plan` input and no prepare verb. It is genuinely ambiguous whether the plan is (a) a durable third artifact prepared by a separate verb and referenced by `start`, (b) prepared implicitly inside `start --release` on every launch and retained as a receipt, or (c) something else — and the choice changes the CLI surface, where qualification failures are reported, and what "unknown plan version" can even mean. Suggested fix: one or two sentences in §Prepared-release capability story (and the Decision flow if a third step exists) pinning where plan preparation happens and how the plan reaches `start`.

**M2 — IN-DELTA — Standalone successor activation contradicts "keeps LLP 0058 intact," and the required 0058 amendment is scheduled in the wrong phase (or not at all).** Phase 2's proof list includes "explicit successor-activation process tests against a `deploy build` release" — i.e., the standalone path activating a new release over an existing settled sessions database. LLP 0058 currently fences that path: "The explicit pre-bind `--activate-startup-successor` flag is the sole cold same-mode exception… **Ordinary `snapback start` never implies that flag. Managed `snapback dev` may retry automatically with it only after…**" and `src/cli.rs` declares the flag "Managed-dev-only pre-bind opt-in" (hidden). So Phase 2 as written both (a) contradicts the carrier story's claim that it "keeps LLPs 0058 and 0109 intact," and (b) violates the RFC's own new rule (delta item 5) that owning-LLP amendments land in the phase that changes their surfaces — the only 0058 amendment scheduled is Phase 3's, and it is scoped to the operational predicate, not to successor-activation authority. Suggested fix (either): add a named narrow 0058 amendment to Phase 2 (extend the sole cold same-mode exception to prepared standalone start under an explicit operator opt-in / plan directive, never implied), and qualify the "keeps 0058 intact" sentence accordingly; or explicitly scope Phase 2's successor-activation proof to identity-equal restarts and defer new-release-over-existing-database to a follow-on with its own 0058 amendment.

## MINOR concerns

**N1 — IN-DELTA —** The RFC does not say which projection tier carries `OperationalReadinessV1` — the gated admin `app.inspect` (which, per the `runDev` excerpt's own comment, requires a separately minted secret-read lease when credentialed) or the public trimmed `/inspect` (LLP 0030/0031's precedent for keeping attach-compatibility facts public). `wait`'s application-level cross-check depends on this; the natural, precedented answer (public trimmed projection — the fact carries hashes and settlement state, no secrets) deserves one sentence so `wait` demonstrably needs no lease.

**N2 — IN-DELTA —** By the RFC's own amendment-placement rule, the narrow 0058 amendment "binding the operational predicate to its existing settlement facts" arguably belongs in Phase 1 (where the predicate starts consuming those facts and they become load-bearing), not Phase 3.

**N3 — IN-DELTA —** "Later health flows through the dev event stream, not the receipt" has no standalone analogue — a Phase-2 native-start process has no dev event stream. Worth a clause (or an explicit pointer into OQ4's supervisor question).

**N4 — IN-DELTA —** LLP 0058 pins the settled deployment identity byte-for-byte against the startup carrier. The carrier story should note that deriving the v1 pair "from the release's schema/functions manifests" must be byte-deterministic (same release ⇒ identical carrier identity across starts), which the content-addressed release makes achievable but which the derivation code must actually guarantee.

**N5 — IN-DELTA —** In Phase 1 the receipt publisher is the JS supervisor; in Phase 2 it is the server. LLP 0030's publication discipline (pinned parent directory, alias/disjointness checks, inode-verified cleanup) was specified for the server-side ready file; a clause on which parts the Phase-1 JS publisher must replicate would remove a small ambiguity.

**N6 — PRE-EXISTING —** The Related header cites `~/clique-runs/p2-pilot/...` paths that exist only on the run machine (the capsule mirrors them, the repo does not). Consider mirroring the two scores files (or their B11 rows) into the benchmarks record so header-cited evidence is durable.

## AUTHOR-DECISION channel

1. **OQ5 (placement of `snapback wait`) — recommendation offered.** Recommendation: native binary. The stated standalone premise (no JS toolchain in target environments) makes package-CLI placement self-defeating for the mode this RFC exists to sanction; `wait` is a thin descriptor read plus one HTTP fetch of `/health` + the readiness fact, well within native scope, and Phase 1 shipping it native avoids a Phase-2 migration. Package delegation can be added later for `snapback dev` ergonomics if wanted.
2. **OQ1 grant policy — no ruling needed now, but note the interaction with M2:** if the reproduced refusal turns out to be security-sensitive and standalone requires an explicit operator profile, the same profile is the natural home for the successor-activation opt-in in M2 — deciding them together would keep the standalone authority story in one place.

No rethink-scale challenge to any binding decision: Option A as destination, Option D as first landing, the recorded Option B rejection (well-supported by the Convex-lane evidence), and the untouched `StartupArtifacts` v1 all hold up against the capsule evidence.

VERDICT: NOT READY
