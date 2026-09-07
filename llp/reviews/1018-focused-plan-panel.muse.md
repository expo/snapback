# LLP 1018 focused-plan panel — Muse

**Reviewer family:** Muse
**Provider / runtime:** Muse CLI, `muse-spark-1.3`, effort `xhigh`
**Date:** 2026-09-07
**Redacted:** No; selected repository context contained no credentials
**Method:** CLI runner; independent initial response, instruction-based blindness
**Targets:** LLP 1018 §12, LLP 1018.001 and LLP 1018.002 at `cc0616af4`
**Context:** Concurrent architecture record at `2cae5d9a2`; governing rules and authorization/replay excerpts; existing evolution/count diagnostic
**Round 1 prompt SHA-256:** `930a76cbc47e16371c3841f6cfce8f4f35cd48847f3ba3a5cfa60a0338464a89`
**Authority:** Charlie requested this panel and delegated plan revisions; feedback is advisory, not acceptance.

## Round 1 — 2026-09-07 (verbatim)

## 1. Strongest independent thesis

The plan has two different theories of unification running at once, and only one earns simplicity.

What landed under LLP 1018 §10 — shared refcounted entries, read-only follower, count-backed probes, binding hygiene — removes application-owned infrastructure with bounded diffs and named refusals. That is demonstrated unification.

What is now proposed alongside it — dependency-scoped invalidation (1018.002), persistent incremental rerun (1018.000 §3), durable follower forwarding (1018.000 §8), plus three open-ended investigations — adds new identities, protocols, and dependency graphs before the landed work is qualified by a cold run and before the concurrent integration lane is reconciled. That is expansion labeled as simplification.

My thesis: freeze semantic expansion and force convergence. Qualify what exists, reconcile the one typed compiler that already exists in the concurrent lane, and fix the two demonstrated correctness gaps — query-lifecycle ownership and proved-absence evidence — before authorizing any narrowing of the schema hash, any incremental-execution machinery, or any forwarding protocol. Elegance now is fewer live semantic owners, not more clever ones.

This honors your two constraints: no duplicate compiler migration, no naive hash deletion.

## 2. Up to five concrete changes

**1. Make 1018.001 a read-only census, not a second compiler.**
Mechanism: the first and only deliverable is the §4 responsibility/deletion table mapped onto the actual integration snapshot `2cae5d9a2` / run branch — old owner, candidate owner, deleted path, remaining consumer, intentional change. No new AST, checker, or emitter to "match terminology," no production code until the integration lane is accepted or explicitly abandoned.
Evidence: the candidate already deletes ~11.8k compiler lines and adds ~4.1k; gross bypassed lines are not net savings, and §6's census already warns of this. Two live frontends will diverge silently.
Change my mind: if the integration branch is declared dead, then re-staff a minimal direct lowering with the same census as its gate.

**2. Keep 1018.002 as audit-only; explicitly forbid runtime narrowing this round.**
Mechanism: produce only the §2 identity producer/consumer map and §3 closure with excluded-component reasons. Retain whole-schema binding as the sole authority. No new verdict domain, no mixed-domain settlement.
Evidence: broad-hash invalidation is conservative correctness, not a bug — the pending-client exercise replays byte-identical envelopes, returns stored terminals, and settles conflicts safely. LLP 1018 §6 rates M7 score impact low/unknown; Astra/Grok M7s were green with workarounds on 0.0.4. A canonical closure with cycles, short-circuit ordering, version domains, and fallback is a large new trusted base for one optional-column conflict.
Change my mind: a fresh M7 diary counts repeated false conflicts causing correction loops that no guide line fixes.

**3. Defer 1018.000 §3 (persistent incremental rerun) and §8 (durable forwarding) to icebox.**
Mechanism: keep full execution as reference and read-only followers (`E_OFFLINE_FOLLOWER`, `reason: follower`). Leave the two-offline-writes witness open as stated.
Evidence: no scorer attributes points to rerun latency; the latency witness itself shows unrelated-subscription count changes means by 0.2–0.4%. Forwarding adds 64/256 bounded receipts, recovery tokens, incarnation/epoch fencing, clock floors, and a fourth mutation outcome — against a 79.2k/82k runtime ceiling with ~2.8k reserve. Follower queue inversion was already fixed by making followers read-only. These are speculative taste/perf, not demonstrated correctness risks.
Change my mind: latency profiles from real Clique scale, or builder diaries showing two-tab offline writes as a blocking loop.

**4. Promote lifecycle ownership from investigation to the one staffed correctness fix.**
Mechanism: require the §12 transition table — mounted, shared entry, drain, resume/epoch, projection refresh/disposal, follower takeover, committed/predicted separation — with one owner per transition, before any composite-view or forwarding work qualifies.
Evidence: this is demonstrated risk, not taste. Integration notes record a `caughtUp`-before-watermark race and drain-restart fix, plus an open retained-projection nulling after unsend that bypasses local reconstruction. A stable snapshot for one named query does not make independent deliveries atomic; that confusion is already biting.
Change my mind: if the table shows each lifetime is already singly owned and the unsend case is re-qualified green.

**5. Missing simplification: one proved-absence representation.**
Nothing in the plan unifies how "zero" vs "unknown" is carried. The public zero-count ticket returns `data: 0` with empty `absences/ranges/verdicts` and no prediction; sparse aggregates read absent targets as zero through one op but absence through direct reads; the twin treats unheld as unknown. Each layer re-invents missing-vs-zero.
Mechanism: carry one justified, policy-scoped absence from native execution through receipt/store/twin to cap predictor, with generation/authority fences. Fix the zero-count fast path first; generalize only if the same shape also serves unsend partials and count-backed probes. Judge by deleted special cases.
Change my mind: if a census shows receipts, sparse targets, and twin coverage already share one absence type and only a single producer is missing.

## 3. Next 1–2 day slice vs explicit defer

Do in 1–2 days:

- Lifecycle table plus retained-projection repair and history/authorization re-validation on React and Expo. This closes the known open correctness hole.
- Smallest read-evidence fix: justified absence for the public maintained-count zero, preserving fences, denial, rollback, and scan fallback. Verify by actual public acquisition and cold reopen, no injected rows.
- 1018.001 census mapping against the real branch, no code. Record net production lines after replacement, not gross deletions.
- One-line guide pointer for the grant ritual (§7 survivor); run the M7 handoff prep in the diagnostic README, not M7 itself.

Explicitly defer: any 1018.002 implementation and domain versioning; incremental rerun and read-result caching; forwarding UI integration (composer/edit/unsend recovery); `fn` beyond the chat membership migration; any new gate, registry, or HEAD-pinned battery.

## 4. Counterargument to my own recommendation

The strongest case against me: deferral preserves the exact paper cuts Convex already avoids. Harmless evolution conflicting queued writes, full reruns at scale, and read-only followers will each cost a future Clique builder a correction loop, and the concurrent lane has already paid most of the implementation cost — walking away now wastes sunk work, leaves the 82k allocation stranded, and lets main and the integration branch diverge further. If the goal is to surpass Convex in one comparative run rather than to minimize trusted base, the rational move is the opposite: land the branch, qualify it whole, and let invalidation plus forwarding be the differentiator. I accept that logic if a fresh builder diary, not an engineering witness, shows those three frictions deciding points. Until then, convergence beats coverage.



## Round 2 — 2026-09-07 (verbatim discussion)

All initial responses, author positions and evidence corrections were shared.
Prompt SHA-256: `17a00d8c72214ed74ddc1ff3fe9a53243999c9df26a6981d3d17fcb5160b7cfa`. This discusses provisional decisions, not the final edited document bytes.

Most important disagreement: whether to icebox/revert follower-write forwarding and persistent incremental rerun now vs author's decline of blanket cancellation.

Muse would defer 1018.000 Sec 3/8 to icebox; Gemini would revert to `E_OFFLINE_FOLLOWER` + Web Lock takeover and shelve 1018.002 indefinitely. Author would assess residual complexity on actual integrated code, preserve independent claims/tests/size allocation, add no new features. Author is right on scope: this panel revises a plan, it does not cancel separately commissioned work. Revert/icebox now would pre-judge unintegrated code the panel has not read.

That does not make the work good because sunk. The burden stays with the lane: keep full execution as reference, keep read-only follower as contract, and require the forwarding/rerun claimants to show on the integrated snapshot a demonstrated correctness or score-critical win that survives the 79k/82k ceiling and without a fourth mutation state becoming a second admission authority.

Corrections, including against panel drafts:

- 1018.001 census is done, not 27/32 with five to fix. Record at `2cae5d9a2` is 27 CLOSED / 4 OUTSIDE-Q / 1 RETAIN / 0 PENDING, net -7,663 compiler lines. Asking to discover the census or dispose five items repeats completed work. Ask deltas only.
- Forwarding added ~11kB is unsupported. 79,207 is a five-root local-runtime measure; no isolated causal delta ties it to forwarding.
- Forwarding is not general distributed consensus. Owner Web Lock retains single admission authority. The added risk is transport uncertainty - `admission-unknown`, receipts/tokens/fencing - not multi-writer consensus.
- Stale unsend diagnosis must go. `8bea2c347` / browser witness `301e59bb6`: 208 pass/0 fail, unsend to count 2 then regression to capped seq7/count3. Qualify transitions/settlement from that, not missing-navigation.
- `client.observe` does not prove drain/auth/recovery ownership. It removes duplicate reducers; lifecycle table at failure seams is still needed.
- Pending-client retry context: graceful close/reopen, not process-kill. `E_OFFLINE_RESET`, FIFO byte-identical replay, both intents `E_OFFLINE_CONFLICT` because verdicts bind complete schema via `Schema::rule_hash`; new intents commit and count advances by two; dropped-response retry returns stored terminal, exactly one message. That preserves attribution. It does not claim unpredicted writes across schema change, and does not license an open-ended autopsy.
- I have no prior claim in this round to correct.

One improvement to synthesis: make 1018.001 a dated delta-closeout, not a standing Draft. Gate: reuse existing census/disposition, add only (a) packaged consumer negative type check from `0c1a538ae` - error-derived `any` under real Expo `skipLibCheck:true` where printed `Result` looked plausible - preserved across direct lowering, (b) 208-pass + browser transition witness, (c) lifecycle seams along the zero-count -> held-evidence -> prediction -> cold-reopen -> reconnect witness plus unsend/recovery. Expiry on land/abandon of the integration lane. Same for 1018.002: audit-only counterfactual isolating rule identity from row digests, current-op checks, and coverage resets; static closure and dynamic touched-reads must not become one universal key. Enforce author's principle: consume facts at establishing authority; proved absence is not zero-from-missing.

No material reason to reverse author decisions 1-6. The only near-case - collapsing 1018.001 into the lane to avoid dual governance - is met by finite delta-only closeout with expiry.


