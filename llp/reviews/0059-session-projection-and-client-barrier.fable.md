**Reviewer family:** Claude (Fable)
**Provider / runtime:** fresh Claude Code workflow subagent — model claude-fable-5, reasoning effort max (explicit per-agent override); orchestrated by /llp-super-refine
**Date:** 2026-07-14
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** sub-agent

# LLP 0059 reviews — Claude family

## Round 1 — 2026-07-14

**Revision under review:** `llp/0059-session-projection-and-client-barrier.spec.md`, sha256 `d78399dcc37cca8a6f385519405149aa89d1ffa62e3bc1634e6cdc5b2a799d3c` (committed at repo HEAD `b11a6fa`)
**Runtime detail:** fresh Claude Code workflow subagent (run wf_f4bfeeab-1c8), model claude-fable-5, reasoning effort max (explicit per-agent override); fresh context, blind to all archived reviews and to the concurrent GPT-family round; orchestrated by /llp-super-refine
**Verdict:** NOT READY

### Review body (verbatim)

All verification complete. I now have a comprehensive evidence base to write the review.

---

# LLP 0005 Review — LLP 0059: Session projection and client authority barrier protocol

**Reviewer:** Claude (Fable 5), independent blind review — no prior review artifacts consulted.
**Document version reviewed:** Draft, Revised 2026-07-14 (through the ENG-24996 review-gate revision).

## 1. Overall assessment

This is an unusually strong executable protocol spec, and the design it pins is a good idea. It takes the two obligations LLP 0039 explicitly deferred to implementation (revocation linearization and client barrier fencing, LLP 0039:1557–1582) and discharges them with genuine protocol rigor: exact record shapes and byte encodings, a two-phase ticket/fence choreography with named rollback and ambiguous-commit behavior, a total lock order, a durable clock floor that makes wall-time monotone across restarts, and a client custody/CAS barrier that is honest about what multi-tab browsers can and cannot guarantee. The fail-closed bias is consistent and correctly placed throughout — ambiguity blocks one session rather than the process, the floor over-expires rather than revives, custody corruption blanks rather than guesses.

I verified the document's load-bearing claims against the code, and fidelity is very high: the projection struct and indexes (src/auth/session_projection.rs:564–575), ticket encoding `<startupId>:<seq>` (:189–197), the 5000 ms terminal grace (:27) and ≤1000 ms expiry scan (:919–920), the clock floor (src/storage/auth.rs:29,479–517; src/auth/provider.rs:745–844; startup seeding at src/auth/runtime.rs:270–273), the 60/240-per-60 s three-bucket open throttle (src/server.rs:2672–2674, 1590–1658), the 16,384-grant cap (src/server.rs:2670), close code 4401 (src/server.rs:10333), the closed live `auth_error` enums (src/live_wire.rs:184–203), the two separate 64 MiB budgets and eight-marker cap (src/ephemeral.rs:684, 711, 704), reset rotating the incarnation inside the caller's destructive transaction (src/storage/auth_stream.rs:226–238), derived-not-asserted readiness (src/auth/mode.rs:368–419), and the full client stack (auth-coordinator.mjs constants at lines 8–12, 210, 214, 478, 1251; client-store.mjs version 5 at line 28; kit custody enforcement at demos/_kit/client.mjs:822, 947, 2186–2188). All five provenance commits exist with matching subjects. The @ref annotation coverage back to this document's anchors is extensive (60+ sites).

Two things keep it from ready: the document itself records nine untriaged material findings from the archived cross-family review, and I found one concrete spec-versus-code fidelity gap (claimed lock-rank assertions and the stalled-revocation independence evidence do not exist in the tree). Both are fixable without redesign. Nothing here is wrongheaded.

## 2. Strengths

- **It discharges exactly what 0039 deferred, without re-owning anything.** §Summary and §Scope and ownership map precisely onto LLP 0039's deferred obligations 1 and 2 and are scrupulous about consuming (not amending) LLP 0057/0058/0043/0053. The 0057 grace/matrix consumption (§Operation-specific publication, §Diagnostics) matches LLP 0057:615–632 exactly, including the inclusive ten-second boundary.
- **The durable session clock floor (§Durable session clock floor) is the standout design decision.** It converts a whole class of backward-wall-clock revival attacks into a documented availability-only residual, and the implementation is exactly as specified: `now_ms()` is `fetch_max` over an atomic floor (src/auth/provider.rs:830–834), startup raises-then-seeds (src/auth/runtime.rs:270–273), and GC advances the floor atomically with reclamation (src/storage/auth.rs:505–517, with @ref).
- **Two-phase mutation with ticket-scoped compare-unmark (§Tickets and leaf fences, §Rollback and ambiguous commit) is the correct shape.** "Comparison is ticket ownership, not equality with a saved snapshot" kills the classic lost-sibling-marker bug, and the coordinator test suite exercises exactly the hard cases: sibling rollback in both orders, ambiguous commit staying blocked, one-shot committed outcome not surviving incarnation change (src/auth/coordinator.rs:1439–1789).
- **Honest security posture.** §Durable custody record explicitly flags plaintext bearer custody as an intentional local-target behavior change that ENG-24607 must ratify before hosted, rather than pretending IndexedDB is an XSS defense. §Reuse and mismatch names the canonical-token-spray CPU residual and refuses to pretend loopback `peer_addr` is a source identity. This candor is worth more than false assurances.
- **Enqueue-vs-drain honesty (§Fenced effects, §Durable and ephemeral outboxes).** "This protocol promises non-delivery, not non-computation" plus "a buffer accepted before Begin is honestly in flight" is the right, provable claim; the marker-vs-batch precedence is tested (src/server.rs:17250–17781).
- **The client barrier avoids the classic multi-tab lies.** §Cross-context ownership claims fail-closed commit/exposure fencing rather than "globally simultaneous DOM blanking"; the fenced fallback lease with monotonic-observation takeover (§Cross-context ownership) is a correct Web Locks substitute, implemented with the exact 5000/1000/2000 ms constants (auth-coordinator.mjs:10–12) and a same-transaction lease check (auth-custody-indexeddb.mjs).
- **Historical-boundary discipline.** The reconciliation of item 5's landing boundary against the now-landed items 6–8 (§Format 3 and authority tags, §Independent item-5 availability axes, §Readiness facts) consistently qualifies format 3 as historical and points composed production at LLP 0043's format 5 — which matches `SNAPBACK_CLIENT_STORE_VERSION = 5` (client-store.mjs:28) — without self-ratifying the Draft.

## 3. Concerns

**1. MATERIAL (decision-quality/process) — the document records untriaged material findings from a prior review.**
Evidence: §Open decisions and status states the ENG-24996 gate archived a cross-family review with verdict "NOT READY — nine material client/handshake fidelity and barrier findings" and that "its material findings await author triage"; the Revised header repeats "material findings remain for author triage." I have not read that artifact (blind-review constraint), but the document's own text asserts unresolved material findings exist. A Draft that itself declares an open material-finding backlog cannot simultaneously be judged to have "no unresolved MATERIAL concern."
Resolution criterion: the author triages all nine findings and the document records each disposition (applied, rebutted with rationale, or converted to a tracked follow-up), updating the status section so it no longer asserts an untriaged material backlog.

**2. MATERIAL (correctness-of-claim / implementation fidelity) — the lock-rank assertion claim is false to the code, and the stalled-revocation independence evidence is not discoverable.**
Evidence: §Locking and linearization states "The server supplies lock-rank assertions in test/dev builds" (present tense, normative) and "The L9 concurrency suite must show that a stalled revocation transaction for session A does not delay an unrelated finite request or publication for session B." Exhaustive search of `src/` and `tests/` for any lock-rank/lock-order/lock-witness machinery finds none; tests/concurrency_v0.rs's L9 tests cover hot-room publish and busy-mutation write-lane independence (tests/concurrency_v0.rs:492, 723) but none holds a *revocation transaction* stalled while an unrelated session proceeds, and I find no test implementing acceptance "Projection and mutation model #8" (commit held at a failpoint for A; B completes). §Executable acceptance says "Every acceptance below is required before its readiness fact can be true," and production hardcodes the three item-5 facts true (src/cli.rs:327–341), so this is a real evidence gap in a document whose revision history stakes itself on "implementation-evidence reconciliation." The underlying property may well hold — the leaf-fence design is specifically built for it — but the spec claims evidence that does not exist.
Resolution criterion: either (a) land lock-rank assertions and the stalled-revocation independence test and cite them, or (b) amend the spec to state these as open obligations (not present-tense fact), reconciling that with the readiness-fact rule it declares.

**3. MINOR (coherence) — the "indistinguishable public posture" acceptance sentence is unscoped and contradicts the document's own diagnostics section as written.**
Evidence: §Executable acceptance, "Grants, effects, and closure" #2 ends "Revoked, expired, malformed, and random bearers have indistinguishable public posture." Read globally, this contradicts §Diagnostics ("expired/revoked sessions and out-of-grace superseded tokens return LLP 0057's typed `SESSION_EXPIRED` and `CREDENTIAL_SUPERSEDED` outcomes as the deliberate recovery exceptions") and LLP 0057's matrix (llp/0057:620–628). The implementation resolves it by flattening only at grant open — `Unavailable`, `Unknown`, and `Malformed` all map to `SNAPBACK_AUTH_REQUIRED` there, while `Superseded` is typed `SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED` even at open (src/server.rs, `prepare_open_authority` classification arms). An acceptance item is exactly where this ambiguity is costly.
Resolution criterion: scope the sentence explicitly to the grant-open boundary and state that superseded-at-open remains the typed recovery exception, consistent with the diagnostics section and the code.

**4. MINOR (clarity/drift risk) — the constants table pins "Contract client-store format | 3" without the historical qualifier the body text applies.**
Evidence: §Normative vocabulary and constants row "Contract client-store format | 3" versus §Format 3 and authority tags ("Format 3 is the historical item-5 predecessor... current composed production store is format 5, owned by LLP 0043") and `SNAPBACK_CLIENT_STORE_VERSION = 5` (client-store.mjs:28). A reader of the table alone — the most-quoted part of a constants spec — gets the wrong current value. Relatedly, the durable floor key `auth_session_clock_floor_ms` (a protocol-stable durable name, src/storage/auth.rs:29) is absent from the table while its sibling `auth_stream_incarnation_v1` is present.
Resolution criterion: annotate the format-3 row as historical (pointing at LLP 0043's format 5) and add the clock-floor metadata key to the table.

**5. MINOR (protocol completeness) — `LiveAuthErrorFrameV1` does not pin the valid code-to-reason pairings.**
Evidence: §Typed terminal auth error defines three codes and six reasons as closed sets (matching src/live_wire.rs:184–203) but never states which pairings are valid — e.g., which code carries reason `downgrade` or `restore`. Both enums being closed still leaves 18 representable combinations for a frame the client must classify terminally. Elsewhere this Spec pins exact bytes; here it leaves a free cross-product.
Resolution criterion: add the valid (code, reason) matrix, or state explicitly that any pairing is client-equivalent and why that is safe.

**6. EDITORIAL — forward reference to "E".**
Evidence: §Coordinator interface says "`transition` throws local `SNAPBACK_CLIENT_AUTHORITY_STALE` when E names a different current authority" — "E" is only defined later in §Transition barrier ("For expected settled capture E and successor authority S").
Resolution criterion: replace with "the expected capture" or define E at first use.

## 4. Suggestions

- **Adopt deterministic model checking for the lock protocol instead of (or alongside) rank assertions.** The §Locking and linearization order (`projection topology -> stream fence -> session fence`, registry-after-fence, sequenced finalization) is exactly the shape `loom`/`shuttle`-style exploration handles well in Rust. A small loom harness over the leaf-fence/topology/registry interaction would discharge concern #2 with far stronger evidence than runtime rank assertions, and would honor the document's own "wall-clock sleeps are not proof of ordering" standard.
- **Advance the clock floor on terminal finalizations, not only startup and GC cadence.** §Durable session clock floor accepts losing forward progress "up to the maintenance cadence." Expiry/revocation finalize already runs a durable transaction; piggybacking `advance_session_clock_floor_on` there (as GC already does, src/storage/auth.rs:517) would make the "once terminalized at epoch E, no restart rebuilds it" guarantee independent of GC cadence at essentially zero cost.
- **Name the anonymous-open starvation residual.** The shared anonymous/malformed prebudget (240/min process-wide) means a hostile local page spraying malformed bearers can starve *legitimate anonymous* connection opens for the whole process. The document names the CPU-spray residual but not this one; on the local target it is a self-DoS, but §Reuse and mismatch's residual list is the right place to say so before ENG-24607 inherits it.
- **Add a compact acceptance-to-evidence index.** The document asserts its executable evidence has landed. A short table mapping each acceptance item to its implementing test (file plus test name) would make audits like this one — and the corpus's own `llp-maintain` drift checks — cheap, and would have caught concern #2 at author time.
- **State the readiness build-fact posture plainly.** §Readiness facts says facts flip "when and only when their named implementation and executable probes are installed"; production composes the three item-5 facts as literal build constants (src/cli.rs:332–340) with dynamic gating living in the pre-bind rebuild/worker path. That is defensible — say it in one sentence so "executable probes" is not read as a runtime self-test that does not exist.
- **Pin the fallback-lease ratio, not just the values.** The 5000 ms lease / 1000 ms renewal / five-second unchanged-observation takeover triple is safe because takeover-observation ≥ lease ≥ 5× renewal. Stating the required ratio would keep a future timing revision (which §Normative vocabulary permits with liveness evidence) from silently breaking the takeover argument.

## 5. Open questions

1. What are the dispositions of the nine archived material findings, and do any of them intersect the sections I verified as code-faithful (which would imply the findings target document prose rather than the implementation)?
2. Is the L9 stalled-revocation independence obligation intended to be discharged by a new dedicated failpoint test, or is the position that existing write-lane independence tests (tests/concurrency_v0.rs:492, 723) subsume it? If the latter, the spec should say so explicitly — a stalled *provider revocation transaction* exercises different locks than a busy app mutation.
3. Should the grant-open flattening of expired/revoked to `SNAPBACK_AUTH_REQUIRED` be pinned normatively in §Reuse and mismatch (it currently names only malformed/unknown), given the code already implements it?
4. What is the operator story when real time cannot be advanced past a spuriously high floor (e.g., a VM restored from a snapshot with a far-future clock excursion persisted)? Reissuing sessions works because issuance uses the floored clock, but is there a diagnostic (ibex-doctor-style) that *detects* floor-ahead-of-wall so the operator knows which recovery to choose?
5. Does LLP 0058 need a reciprocal revision note recording that `authorizationStreamIncarnation` (present in its handshake body at llp/0058:1114) is owned by this Spec's §Bootstrap response revision, so closed-DTO ownership stays single-writer?

## 6. Readiness verdict

The design is sound, the fail-closed posture is consistently correct, and code fidelity is exceptional across nearly every load-bearing claim I checked. But two material items remain: the document's own acknowledgment of nine untriaged material findings from the archived cross-family review (Concern 1), and a verified present-tense implementation claim — lock-rank assertions plus stalled-revocation acceptance evidence — that is not true of the tree (Concern 2). Both are resolvable without redesign; until they are, the document is not ready. Concerns 3–6 are non-blocking polish.

READINESS VERDICT: NOT READY
### Orchestrator disposition (round 1, outside the verbatim body)

Disposition: Concern 1 (untriaged findings) → the round-2 §Review triage records
a disposition for every material finding of both families. Concern 2 (lock-rank
claim false to code + stalled-revocation evidence not discoverable) → restated as
named defect obligations, landed-evidence claim removed. Concern 3
(indistinguishable public posture unscoped) → scoped to grant minting. Concern 4
(format-3 historical qualifier) → the body already qualifies format 3 as the
historical item-5 predecessor; the constants table entry is noted. Concern 5
(LiveAuthErrorFrameV1 code-reason pairings) → recorded for the wire-DTO pin.

## Final implementation review — 2026-07-15

### Provenance

- Reviewer family: Anthropic Claude
- Provider/runtime: Claude CLI, model `claude-fable-5`
- Method: read-only Plan mode; high effort; no session persistence; blind to `llp/reviews/`
- Reviewed commit: `62a11cedfb1ff7ad0258dc3e6ce667989b88b819`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review

# LLP 0005 final review — LLP 0059 at committed HEAD `62a11ce` (blind; advisory only)

## Overall assessment

This is a strong, unusually well-evidenced Spec. The ENG-25001 revision's resolved-defect claims verify against shipped code essentially across the board: I checked every decisive implemented-boundary claim in the resolution list against the Rust server, the client packages, and the executable suites, and all but coverage-completeness nuances confirmed. The document is internally coherent, honest about residuals, and disciplined about provenance and non-self-ratification. One cross-document contradiction with LLP 0058 remains, which by this corpus's own round-2 standard (reconciliation, not unilateral override) is material.

## Strengths

- **Implemented boundaries verify.** Lock-rank guards exist exactly as specified, ranks 10/20/30, with an inversion test. The named L9 fixture exists and does what the spec claims: unrelated protected-room HTTP+WS progress while the affected commit holds the writer lane. The durable clock floor is real, including the obligation to durably advance the floor to the due-expiry frontier *before* publishing a time-derived terminal event. Exact incarnation bytes, `SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT`, and same-transaction rotation confirm. Throttle buckets/limits, the `4401`/`auth_error`/5000 ms terminal close, and all cited diagnostics confirm.
- **Client custody claims verify.** Custody format 2 with `transitionIntent` carrying embedded predecessor/successor authorities, key derivation from those authorities, and peer idempotent physical-store catch-up before resume; phase-8 ownership release before resume/network; late-registrant `commitDurable` catch-up; format-5 store with v1–v4 fail-closed migration; the LLP 0008 one-key localStorage adapter; and protocol 1 hard-requiring the coordinator all confirm.
- **The 0057 contradiction is genuinely resolved from the 0057 side.** 0057 `Concurrency now states exact-durable reconciliation "matching LLP 0059" and explicitly retracts its earlier discard-and-unavailable rule.
- **Honest residuals and scoping.** The XSS/at-rest bearer residual, canonical-token CPU spray, floor over-expiry availability residual, and the grant-mint-scoped "indistinguishable" claim are all stated without overclaim. `ref-check --verbose` passes with 0 errors; `@ref LLP 0059#…` annotations exist at the cited boundaries.

## Concerns

**MATERIAL 1 — 0059 amends LLP 0058's closed DTO without reconciling 0058.** `Bootstrap response revision declares that 0058's closed `GET /auth/session` success body "gains the required field … `deploymentIdentity`". The implementation carries it, so 0059 matches the code — but LLP 0058's `Exact response DTO does not include `deploymentIdentity`, and 0058's ENG-24991 "Exactness" amendment asserts every member is listed and required against an exact schema. Two normative Specs now publish contradictory exact DTOs for the same wire route; a reader implementing 0058's validator would reject the actual server response. 0058 is a living, non-frozen Spec, and 0059 itself applied the "reconcile the owning document, don't override unilaterally" rule to 0057 and 0008 in round 2. **Resolution:** update 0058's DTO example and exactness member list to include `deploymentIdentity`, or add an explicit 0058 deferral note pointing at 0059 `Bootstrap response revision, landed as a doc reconciliation.

**MINOR 1 — Acceptance matrix is partially, not fully, landed while the spec claims its evidence has landed.** `Executable acceptance states "Every acceptance below is required before its readiness fact can be true," and `Open decisions asserts item 5's executable evidence has landed. Coordinator races item 3 ("Kill a Web-Lock owner … during every participant phase") is covered by a crash-during-`commitDurable` case plus recovery-path tests, not a literal per-phase kill loop; item 5's broadcast matrix tests drop/delay/stale-arrival but has no explicit duplicate/reorder cases; the fallback-lease fencing-token increase is exercised only implicitly via `priorToken + 1`. Behavioral-equivalence arguments are plausible, but the spec's gate sentence makes the claim stronger than the landed suites. **Resolution:** add the missing named cases, or qualify those acceptance items with the landed equivalents they are satisfied by.

**MINOR 2 — LLP 0008 characterization slightly overstated.** 0059 twice calls the adopted design "governing LLP 0008's **ratified** Web-Lock one-key design"; 0008's Status is Draft, and 0008 phrases the mechanism as one exclusive Web Lock **per storage key**, not the "canonical per-app Web Lock" wording in `Durable client store. Semantics match; the words don't. **Resolution:** soften "ratified," for example to "LLP 0008's landed one-key protocol," and align the lock description with the per-storage-key reality.

**EDITORIAL 1 —** The Revised header and `Review triage say "close-only 4401 terminal latch," but the body correctly says "this frame **or** close code" is classified terminal, and the code clears on an in-band `auth_error` frame and then force-closes into the 4401 latch. Align the summary phrasing with the body.

**EDITORIAL 2 —** The Revised header is now a multi-page unstructured block that is genuinely hard to audit; consider moving the per-round detail into a dated history subsection in the body.

**EDITORIAL 3 —** `Durable session clock floor's restore rule says "restored session creation frontier"; 0057 phrases the same fix as "durable clock floor and relevant catalog maxima." Same substance — align the wording or cite the 0057 phrasing.

## Verdict

**NOT READY.** MATERIAL 1, the 0058 closed-DTO contradiction, must be reconciled first; on everything else observed, this document is one small cross-document doc fix away from READY. Advisory only — no Status change is proposed, and ratification remains the author's call.

## Blind final cross-family review — 2026-07-15

### Provenance

- Reviewer family: Claude Fable
- Provider/runtime: Claude Code 2.1.210
- Model: `claude-fable-5`
- Method: read-only plan-permission CLI; blind to `llp/reviews/`
- Session: `3bc33f41-dd55-4c3a-a62c-307430e5bef9`
- Reviewed commit: `8f03e42`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review artifact

# Blind final implementation review — LLP 0059 @ 8f03e42

Task: read-only review; deliverable is a ≤700-word verdict (READY / NOT READY) with MATERIAL/MINOR findings, file:line evidence, and resolution criteria. No file modifications.

## Direct findings so far (reentrant resume — reviewed personally)

- Fix at HEAD (`packages/snapback-contract/auth-coordinator.mjs:688-713`, `:728-742`): exact-match (settled phase + revision + epoch + authority key) reload during active resume returns capture without nested barrier; mismatch throws `SNAPBACK_CLIENT_AUTHORITY_STALE` (fail-closed abort of resume). Covers both reentrant (`#synchronizing` set — peer-adoption barrier) and non-reentrant (owner `transition()`) paths.
- Ownership released before resume (`auth-coordinator.mjs:1203`, `#resumeAfterOwnership:1221-1247`) → guard's `withOwnership` re-acquisition is deadlock-safe.
- Regression tests at HEAD: `auth-coordinator.test.mjs:412-451` (owner) and `:453-490` (peer), assert resumeCalls === 1 and capture equality.
- Composed Contract suite `auth-coordinator-contract.test.mjs:355-408`: single + multi-live surfaces on one coordinator; transition completes; `liveCallbacks.length === before + 2` would catch recursive replay; awaited transition would hang on starvation. Spec sentence (llp/0059 lines 1998-2000) attributes the no-recursion proof to this composed test — indirect there; direct proof is coordinator-level. Possible MINOR evidence-mapping nit.
- Kit resume (`demos/_kit/client.mjs:1250-1266`) does handshake + `#commitAuthSession` (compareAndCommit) during resume — consistent with spec §Handshake.

## Pending: three Explore agents
1. Client coordinator/store/kit evidence (custody format 2, lease/fencing, Web-Lock kill matrix, broadcast matrix, localStorage one-key, client-store format 5).
2. Server evidence (projection, clock floor, lock ranks, L9 fixture, throttle buckets, 4401/auth_error, construction receipts, leased outbox).
3. Cross-document ownership (0039 frozen anchor, 0057 reconciliation, 0058 protocol 1/readiness/DTO, 0008 one-key, 0043 format 5, 0012 diagnostics registry, 0053/0060).

## Agent results

**Cross-document (done):** No material contradictions. 0057 reconciled from its side (0057:1456,1472-1475); 0058 ratified the handshake DTO fields into its own closed shape (0058:17,1223,1273,1287-1288); 0008 one-key Web-Lock protocol confirmed (0008:429-430); 0043 #auth-posture/format 5 confirmed (0043:215+); 0012 registers all server codes; client-local codes correctly absent. MINOR: 0059:87-88 "transition table … from LLP 0039" overstates (0039 defers the state machine, 0039:1560,1574-1580); axis/type labels (retainedReads/queuedReplay, AuthDispositionV1) are 0059 coinages over owners' unnamed constructs.

**Client (done):** Format-2 custody/lease/broadcast/localStorage-hint constants all match (incl. AUTH_CUSTODY_SUPERSEDED_WAIT_MS=2000 at auth-coordinator.mjs:12 — agent's 2000-vs-5000 flag was a false positive; 5000ms is the separate lease observed-unchanged wait, spec'd as five seconds). Web-Lock kill matrix all 7 points (auth-custody-indexeddb.test.mjs:308-431); two consecutive fallback takeovers token+1 (:239-308); broadcast duplicate/reorder/drop matrix (auth-coordinator-missed-wakeup.test.mjs:375-427); localStorage one-key stale-writer test (offline-replay.test.mjs:1085-1129); kit 4401/auth_error latch + setBearerToken refusal (client.mjs:2290-2324, :1020-1023).
- **MATERIAL: client-store-authority.test.mjs FAILS at HEAD (:962)** — verified personally. Clearing-state recovery in a fresh context strands same-user private payloads (reason same_principal_new_session, plaintext args retained) where the test requires fail-closed delete ("recovery cannot prove the clearing transition's predecessor authority", :870-872). Red named evidence suite (spec provenance line 104 cites store-authority suite) at the readiness-closure commit.
- MINOR: spec 1998-2000 attributes the no-recursive-resume proof to the composed Contract test; that test (auth-coordinator-contract.test.mjs) has no recursion/starvation assertion and its client double stubs authSession; the real proof is coordinator-level (auth-coordinator.test.mjs:412-495).

**Server (done):** All 11 claims confirmed (projection/tickets, stream incarnation exact-JSON + same-tx rotation, clock floor with frontier-before-terminal at auth/runtime.rs:485-493, lock ranks session_projection.rs:34-97 + inversion test :2875, L9 fixture server.rs:14937, throttle boundaries :23267, 4401/auth_error/5000ms, receipts pre-bind cli.rs:1897-1913 + negatives :4066/:4130, leased outbox budgets/poison ephemeral.rs:684/:704, two-phase rewiring, handshake fields). Nuances: (a) closed LocalOpenBucketV1 lists 3 bucket kinds, code has a 4th service bucket (server.rs:1763-1775); (b) terminal 5000ms close tested with real Instant deadlines, not the fake monotonic clock the acceptance names (spec's own standard: wall-clock sleeps aren't ordering proof).

## Final verdict
NOT READY — one MATERIAL: red named evidence suite client-store-authority.test.mjs:962 at 8f03e42 (three-way spec/code/test disagreement on clearing-recovery disposition for same-user stranded private payloads). MINOR: composed-Contract-test evidence misattribution (0059:1998-2000); fake-clock terminal-close acceptance not literally discharged; undocumented 4th throttle bucket; 0039 "transition table" provenance wording. Full text in final response.

## Final delivery-fence review — 2026-07-15

### Provenance

- Reviewer family: Claude Fable
- Provider/runtime: Claude Code 2.1.210
- Model: `claude-fable-5`
- Method: read-only plan-permission CLI; blind to `llp/reviews/`
- Session: unavailable (ephemeral reviewer did not emit a session identifier)
- Reviewed commit: `3ac047322d055fad03e8308fdc0905d758eb9f61`
- Human authorization: ENG-25001 completion request
- Secrets or redactions: none
- Source artifact: `/private/tmp/eng25001-final2-fable-0059.md`

### Verbatim review

All verification paths are complete: the full LLP 0059 spec, the entire AuthCoordinator implementation and its delivery-time fences, both delayed-reload regression tests, the four ENG-25001 fix commits' diffs, the governing anchors (LLP 0008/0039/0043/0057/0058), and existence-level checks of every server/kit obligation named in the resolved-findings list.

VERDICT: READY

MATERIAL:
- None.

EVIDENCE:
- Target resolved: the prompt's filename `llp/0059-client-auth-coordinator-and-protocol-negotiation.spec.md` has never existed in history (`git log --all -- '*client-auth-coordinator*'` is empty); the review target is the actual LLP 0059, `llp/0059-session-projection-and-client-barrier.spec.md`, read completely (all 2172 lines) at HEAD = 3ac047322d055fad03e8308fdc0905d758eb9f61, clean tree.
- LLP sections inspected in depth: header/revision log (lines 8–39), Provenance, Durable session clock floor (354–407), Two-phase mutation, Locking, Connection-bound authority (incl. the 5c23b44-added service bucket, 708–744), Fenced effects, Client custody and `AuthCoordinator` (1145–1568, esp. Cross-context ownership 1389–1402 and Transition barrier 1457–1513), Durable client store (1570–1644), Contract/kit participation, Handshake/readiness, Executable acceptance (1858–2082, esp. Coordinator and two-context races 1977–2031), Implementation handoff, Open decisions/Review triage (2113–2172).
- Race cut 1 (synchronize completing during resume): reentrant during-resume re-read `packages/snapback-contract/auth-coordinator.mjs:688-713` (8f03e42, broadened to owner transitions by 5c23b44); delivery-time fences for results whose read finished pre-barrier — adopt-path barrier-active exact-or-stale at `auth-coordinator.mjs:1227-1237` (5c23b44) and plain-capture exact-or-stale (baaf890, now unconditional). Tests: `auth-coordinator.test.mjs:412-448` (owner resume exact reload, no recursion), `450-490` (peer-adoption resume reload), `492-545` (durable advanced during owner resume → `SNAPBACK_AUTH_TRANSITION_FAILED`, stays blank, later clean sync adopts), `547-600` (same for peer adoption → `SNAPBACK_CLIENT_AUTHORITY_STALE`), `602-660` (pre-barrier read delivered during held-open successor resume → stale; `capture()` throws `SNAPBACK_CLIENT_AUTHORITY_CLEARING` while resume is open).
- Race cut 2 (synchronize result completing after the resume barrier): 3ac0473 diff makes the plain-result exact check unconditional including null↔null (`auth-coordinator.mjs:1260-1277`), adds the no-barrier adopt-path confirmation short-circuit (`1239-1243`) and the `localAtRead`/`publicationPausedAtRead` fence captured inside the ownership read (`733-746`) and compared at delivery (`1244-1256`), so a delivery after a completed local barrier fails `SNAPBACK_CLIENT_AUTHORITY_STALE` instead of adopting or returning the predecessor capture. Exact regression test `auth-coordinator.test.mjs:662-703`: read completes, full transition finishes (activeBarrier gone), delayed delivery → stale, successor capture unchanged before/after, later clean `synchronize()` returns the settled successor.
- Fix interaction verified: the 3ac0473 unconditional plain-result fence subsumes baaf890's barrier-active case; clearing-phase deliveries also fail stale (exact requires `phase === 'settled'`); adopt fences compose with `#adoptPeerSettled`'s no-regression guard (`1485-1494`) and the `#synchronizing` dedupe (`714, 752-756`); correct peer adoption (local unchanged since read) still adopts (`1257-1258`), preserving cross-tab convergence (missed-wakeup permutation matrix, `auth-coordinator-missed-wakeup.test.mjs:375-425`).
- Spec language: cross-context ownership rule "exact record is confirmation only… mismatch fails stale… adopted [only in] a later clean synchronization" (0059:1390–1402, added 5c23b44) and acceptance narrative 0059:2024–2031 match the implemented exact-or-stale semantics; acceptance §Coordinator races item 1 (1979–1983) covers the delayed-completion family; real Contract participants perform the resume-time durable reload (`packages/snapback-contract/index.mjs:2401, 3911`; composed test `auth-coordinator-contract.test.mjs:155-172, 396-431` proves resume-once, no starvation).
- Resolved ENG-25001 findings spot-verified: coordinator-only protocol 1 (`demos/_kit/client.mjs:888-891`, `1022`); format-2 transition intent with embedded-authority/digest validation (`auth-coordinator.mjs:237-272, 305-386`; corrupt-intent peer rejection test `auth-coordinator.test.mjs:274-323`; same-user stranding recovery `client-store-authority.test.mjs:867+`); phase-8 ownership release before resume/network (`auth-coordinator.mjs:1199-1205`; test `auth-coordinator.test.mjs:1110-1138`; refresh outside ownership `923-960` with serialization test `835-876`); terminal `4401/auth_error` latch in both live APIs (`demos/_kit/client.mjs:2302-2318, 3911-3988`); deployment identity/UUIDv7 (`schemas/auth.session.output.schema.json:121-139`; kit fixtures `demos/_kit/tests/auth-coordinator-client.mjs` per 8f03e42); durable handshake cache fence via `compareAndCommit` (`demos/_kit/client.mjs:969, 1133, 1512, 1693`); typed construction receipts and pre-bind expiry-worker abort (`src/cli.rs:397-424, 1897-1920`); durable terminal frontier before publication (`src/auth/session_projection.rs:950-1006`) and clock floor (`src/storage/auth.rs:39-43, 972-979`); lock-rank assertions (`src/auth/coordinator.rs`, `src/auth/session_projection.rs`); L9 fixture `protected_room_server_fast_paths_progress_during_affected_commit` in `src/server.rs`; LLP 0008 one-key per-storage-key Web-Lock adapter (`packages/snapback-contract/client-store.mjs:2938-2979`, governing text `llp/0008:429-432`); item-5 delete/strand table enforced (`client-store.mjs:3006-3067`).
- Governing context: LLP 0039 `## Protocol obligations deferred to implementation` (line 1560) exists and 0059 defers correctly; LLP 0043 `### Auth posture` (line 215) exists for the format-5 ownership pointer; 5c23b44's coordinated 0057 (clock-floor seeding wording) and 0058 (commit-witness composition, `Cache-Control: no-store, private`) edits plus baaf890's 0058 descriptor-schema honesty correction are consistent with shipped code; fallback lease constants and 5-second observed-unchanged CAS takeover match the constants table (`auth-custody-indexeddb.mjs:10-16, 266-299`, `fencePublication` at 340/426).

MINOR:
- Early exposure unpause during an active barrier's resume: `transition()`'s idempotent already-settled-successor path calls `this.#adoptSettled(current)` with default `expose: true` (`auth-coordinator.mjs:1030-1033`), and `compareAndRotateBearer` does the same (`913`), so a concurrent same-context call landing during another barrier's resume phase sets `#publicationPaused = false` before the remaining participants finish `resume`, weakening "exposure resumes only after its own mandatory participants report readiness" (0059:1497–1499). No predecessor data or stale epoch can leak (blank/clearMemory already ran; record is the successor), so this is ordering robustness, not a safety break. Improvement: preserve paused state while `#activeBarrier !== null` (as `compareAndCommit` already does via `expose: !this.#publicationPaused` at line 856) and add a regression test.
- Spec prose lags the 3ac0473 extension: 0059:1400–1402 says a pre-barrier synchronization "completing after settle… may [not] replace the now-active barrier," which literally covers only delivery while the barrier is still active; the post-barrier delivery rule and the `localAtRead` local-changed adopt fence have no explicit sentence, and the revision log (0059:9–10) names only "fences pre-barrier reloads that finish during resume." Also, the now-unconditional exact check makes a reload racing a same-authority bearer rotation return stale rather than the pre-rotation capture (fail-closed; `waitForNewerRevision` retries at `auth-coordinator.mjs:969-979`), which sits in tension with the leniency note at 0059:1211–1214 for ordinary completions though a reload capture is not an app-state completion. Improvement: one sentence extending the exact-or-stale rule to completions delivered after the barrier ends, and a note that the reload's own return value is strictly exact-or-stale.
- Missing direct tests for two defensive delivery branches: the adopt-path barrier-active fence (`auth-coordinator.mjs:1227-1237`) and the adopt-path local-changed fence (`1244-1256`) are only reached indirectly; the pre/post-barrier regression tests pin the plain-capture variants only. Improvement: add delayed-delivery tests where the ownership read returns an `adoptPeerAfterOwnership` result and delivery lands (a) during an active barrier and (b) after a completed local transition.
- Diagnostic fidelity: `#finishClearingOwned`'s catch nulls `#activeBarrier` before building the error detail, so `phase` is always `'unknown'` (`auth-coordinator.mjs:1206-1214`). Improvement: capture the phase before clearing the barrier.
- Asymmetric fail-closed handling of vanished custody: `synchronize()` with a null durable record silently pauses and nulls local state without running quiesce/blank (`auth-coordinator.mjs:717-721`), while `restoreOffline()` treats the same disappearance over an exposed record as corruption with explicit fail-closed blanking (`782-786`). Commits/exposure gates still fail closed via the pause. Improvement: mirror `restoreOffline`'s blanking (or corrupt diagnostic) when a previously exposed record disappears.

## FINAL3 publication review — 2026-07-15

### Provenance

- Reviewer family: Claude Fable
- Provider/runtime: external Fable review artifact; exact CLI version was not emitted with this artifact
- Model: `claude-fable-5`
- Method: read-only blind implementation review
- Session: unavailable (ephemeral reviewer did not emit a session identifier)
- Reviewed commit: `bd7d1da6d458439081a60c6fe06fe700edc678cf`
- Human authorization: ENG-25001 FINAL3 completion request
- Secrets or redactions: none
- Source artifact: `/private/tmp/eng25001-final3-fable-0059.md`

### Verbatim review

VERDICT: READY

MATERIAL:
- None.

MINOR:
- None. (Non-mismatch observation: a paused context adopting a same-authority newer revision reruns a full local barrier from the retained transition intent — conservative fail-closed behavior, consistent with the spec's later-clean-synchronization rule.)

EVIDENCE:
- Reviewed exactly `bd7d1da6d458439081a60c6fe06fe700edc678cf`; working tree clean before and after review; only in-memory test suites were executed.
- Final locked confirmation after barriers clear: `packages/snapback-contract/auth-coordinator.mjs` `#confirmDurableExact` (1396–1414) performs a revision-exact settled compare under re-acquired ownership; owner transitions confirm after durable settle (1312–1315) and again after resume (1321–1324) before `#publicationPaused = false` (1325); peer adoption confirms before participant work (1234–1236) and after resume (1471–1475) before unpausing. Reentrant `synchronize()` during resume is exact-or-stale without nesting a barrier (688–713).
- Delayed ownership-result fencing: the provisional read carries a phase-aware `localAtRead` fingerprint plus `publicationPausedAtRead` (733–751), rechecked at delivery (1262–1283); non-adopt results are durably reconfirmed against the exact local record (1284–1308). Every mismatch path pauses publication before throwing `SNAPBACK_CLIENT_AUTHORITY_STALE`; `capture()`/`isCurrent()` gate on the pause (601–620), so no obsolete capture can publish.
- Clearing-phase custody with peer-recovered settled custody: the fingerprint canonicalizes `pendingAuthority` for clearing records (739–744), avoiding CORRUPT misclassification; `transition` from durable clearing recovers on a matching successor and fails STALE otherwise (1044–1049); `#adoptPeerSettled` runs the full barrier from the retained durable intent (1416–1479).
- Tests in `packages/snapback-contract/auth-coordinator.test.mjs` verifying each closure: owner/peer reentrant-resume confirm without recursion (412–448, 450–490); changed-durable during owner resume → `SNAPBACK_AUTH_TRANSITION_FAILED`, resume ran once, capture stays `SNAPBACK_CLIENT_AUTHORITY_CLEARING`, later clean sync adopts the peer successor (492–544); same for peer-adoption resume (546–598); pre-barrier reload completing during resume, and after barrier completion, both fail stale then adopt cleanly (600–658, 660–701); direct A→B delayed delivery with broadcasts disabled (703–753); null→established (755–796); peer-adoption B→C provisional marker (798–853); failed-clearing peer recovery then original-context synchronize returns the recovered capture with no CORRUPT (855–901); failed final durable read blanks then recovers by clean sync (903–938); same-authority revision is part of exact confirmation (940–992); resume-time same-authority credential write cannot reopen exposure and the outer confirm aborts closed (994–1034); participant crash leaves durable `clearing` and recovery reruns the barrier from the exact clearing revision (1067–1105).
- Supporting acceptance parity: Web-Lock owner killed at all seven cuts (before-clearing, quiesce, blank, clearMemory, commitDurable, before-settled-publication, resume) with full recovery barrier (`auth-custody-indexeddb.test.mjs` 308–428); two consecutive fallback takeovers assert fencing tokens exact predecessor+1 (239–301); fenced compareAndCommit publication after lease loss (430–519); broadcast matrix covers drop-all, single phases, both orders, and every unique duplicate permutation (`auth-coordinator-missed-wakeup.test.mjs` 374–431); real single- and multi-live participants await `coordinator.synchronize()` inside resume (`index.mjs:2401`, `index.mjs:3911`); the composed Contract test proves each real participant resumed exactly once and the transition completed (`auth-coordinator-contract.test.mjs` 365–433).
- Executed at HEAD: `node auth-coordinator.test.mjs && node auth-coordinator-missed-wakeup.test.mjs && node auth-custody-indexeddb.test.mjs && node auth-coordinator-contract.test.mjs` — all pass ("all assertions passed"); all are wired into `packages/snapback-contract/package.json` `test`.
- FINAL3 scope: `bd7d1da` adds `HostedAdmission` as schema authority only under LLP 0060 (`src/auth/deployment.rs`: "no current target owns the authenticated producer"), consistent with LLP 0059 not enabling hosted sessions; kit changes tighten credential-response redaction (`demos/_kit/tests/auth-coordinator-client.mjs`). `2fc3593` implements the spec's restore frontier "not limited to session creation time" via `restored_auth_timestamp_frontier_on` with unit tests asserting non-creation maxima (`src/storage/auth.rs`); Rust-side evidence verified statically, not executed.
- Spec Status remains author-owned Draft (`llp/0059-session-projection-and-client-barrier.spec.md:2154`); no status change proposed.

## FINAL4 bootstrap-gate review — 2026-07-15

### Provenance

- Reviewer family: Claude Fable
- Provider/runtime: external Fable review artifact; exact CLI version was not emitted with this artifact
- Model: `claude-fable-5`
- Method: read-only blind targeted implementation review
- Session: unavailable (ephemeral reviewer did not emit a session identifier)
- Reviewed commit: `b0448e1d0daae84e207479065111323062548393`
- Human authorization: ENG-25001 FINAL4 completion request
- Secrets or redactions: none
- Source artifact: `/private/tmp/eng25001-final4-fable-0059.md`

### Verbatim review

VERDICT
READY. The staged final-confirm closure from 99d32ad, unchanged at HEAD, implements the spec's resume rules: settled successor authority is adopted unexposed (`#adoptSettled(..., {expose:false})`, `#publicationPaused` held from the clearing write through the final locked confirmation), and exposure opens only after `#confirmDurableExact` flushes staged callbacks under re-acquired ownership (`auth-coordinator.mjs:1332-1337` owner; `:1575-1580` peer, with a pre-participant confirmation at `:1240`).

MATERIAL
None found in the focus area. Verified: `compareAndCommit` refuses at three cuts while paused — before ownership, after the fenced read, and inside the lease-fenced commit (`:854-897`) — satisfying "even if durable custody already contains the exact successor." `stagePublication` accepts only the exact active resume barrier's revision-compared capture (`:1442-1460`); flush revalidates every staged capture against the final durable read (`captureMatches` requires settled, so clearing/null fail), runs synchronously and non-reentrantly (`#inCommit`) in enqueue order, under `owner.fencePublication` when lease-fenced. Changed custody, failed read, or callback failure discards unrun callbacks, reblanks participants, and leaves the gate paused (`:1339-1347`, `:1581-1585`); adoption only via a later clean synchronize. Leak channels are closed: `capture()` throws CLEARING and `isCurrent` is false while paused; `synchronize()` during resume is exact-compare-only (`:688-713`); delivery-after-settle requires exact-and-unpaused (`:1290-1314`); the kit stages its resume handshake cache (`client.mjs:1303`) and fences even its cached `authSession` return through `compareAndCommit` (`:1000-1005`); Contract resume defers refresh work whose effects route through `compareAndCommit`; a same-authority rotation from inside resume cannot reopen exposure; quiesce aborts requests/streams, and close-only `4401/auth_error` latches without reconnect.

MINOR
- The staged-flush composition under the fallback lease `fencePublication` is not directly tested; coordinator staged tests use memory storage without a fence (lease fencing is proven only at the storage/`compareAndCommit` level).
- A participant-initiated non-idempotent transition from inside its own resume replaces `#activeBarrier` (`:1184`) mid-resume; traced outcomes remain fail-closed, but completion bookkeeping resolves early. The spec defines only the idempotent case.
- `#flushStagedPublications`' `barrier !== this.#activeBarrier` guard is tautological at both call sites (argument read from that same field at call time); the phase/pause checks carry the load.
- Kit no-reconnect negatives rest on short bounded sleeps — smoke-grade under the spec's own wall-clock caveat.

EVIDENCE
Deterministic owner and peer cuts at HEAD: ordering `['resume-enter','resume-exit','staged-publication']` with refused `must-not-run` `compareAndCommit` and `isCurrent` false during flush (`auth-coordinator.test.mjs:424-509`); resume-race discard, `stagedPublications === 0` (`:528-620`); injected final-read failure in both modes with later clean adoption (`:963-1042`); staged callback failure/reentrancy — `['first']`, `clearMemory` twice, CLEARING (`:1045-1078`); same-authority write during resume aborts closed (`:1136-1176`). Staged-client cuts: kit cache published only at final confirmation (`auth-coordinator-client.mjs:472-478`); raw and managed close-only terminal latch, exact `compareAndClear`, no replacement socket (`client-errors.mjs:473-530`).

## FINAL5 composed-client evidence review — 2026-07-15

### Provenance

- Reviewer family: Claude Fable
- Provider/runtime: external Fable review artifact; exact CLI version was not emitted with this artifact
- Model: unavailable (artifact did not emit a model identifier)
- Method: read-only blind targeted implementation review
- Session: unavailable (ephemeral reviewer did not emit a session identifier)
- Reviewed commit: `b78998c0ebce04f94ea422227d57f4ab584cecd4`
- Human authorization: ENG-25001 FINAL5 completion request
- Secrets or redactions: none
- Source artifact: `/private/tmp/eng25001-final5-fable-0059.md`

### Verbatim review

VERDICT
READY

MATERIAL
None found.

MINOR
- The kit bootstrap catch retries only `SNAPBACK_CLIENT_AUTHORITY_STALE` (demos/_kit/client.mjs:1231); a bootstrap raced by a mid-barrier peer adoption throws `SNAPBACK_CLIENT_AUTHORITY_CLEARING` (auth-coordinator.mjs:653, 692) and propagates without the spec's optional single retry against the adopted successor. Fail-closed; liveness only.
- `establishAnonymous` broadcasts the created record (auth-coordinator.mjs:690) before its defensive local re-check and adoption; wakeups are stateless, so this is harmless ordering.

EVIDENCE
- Bootstrap witness: the kit treats only `synchronize() === null` as fresh custody (client.mjs:1221), double-confirmed under ownership (auth-coordinator.mjs:736-739, 1309-1332). A paused non-null exact capture skips bootstrap, fails `isCurrent` (619), and goes stale after one retry with no handshake or cache write (client.mjs:1242-1247).
- Creation-only: `establishAnonymous` refuses any local record/active barrier and any existing durable record without changing the paused gate (auth-coordinator.mjs:651-696); its sole production caller is the kit bootstrap branch.
- Pause holds through final confirmation: `capture()` throws (609); `compareAndCommit` refuses at entry, after reload, and before its callback (875, 878, 892); rotation and idempotent transition keep `expose:!paused` (944, 1064). The resume handshake publishes only through `stagePublication` (client.mjs:1314), flushed inside the final locked confirmation (auth-coordinator.mjs:1350-1355, 1593-1598); failure discards staging and reblanks (1357-1360, 1599-1602). Requests re-fence before returning (client.mjs:1557-1564).
- No reentry/deadlock: synchronize's resume guard precedes its memoized promise (706-731); staged callbacks are non-reentrant via `#inCommit` (1501).
- Deterministic committed tests, wired into runners (snapback-contract/package.json:21; scripts/verify-local-proof:129): owner/peer concurrent-authSession success cuts, owner post-staging mismatch, peer final-ownership failure (demos/_kit/tests/auth-coordinator-client.mjs:897-1160); creation-only and in-resume bootstrap refusals (auth-coordinator.test.mjs:347-368, 463-467, 518-522).
