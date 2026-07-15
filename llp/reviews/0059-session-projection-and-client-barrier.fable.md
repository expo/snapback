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
