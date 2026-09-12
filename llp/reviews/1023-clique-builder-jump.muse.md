**Reviewer family:** Muse
**Provider / runtime:** Muse CLI, requested muse-spark-1.3 xhigh
**Date:** 2026-09-12
**Redacted:** no; repository design/source excerpts only
**Method:** Independent frozen-packet review, then a panel discussion supplied with all four actual reviews and proposed root dispositions. No author acceptance is inferred from a reviewer verdict.

# LLP 1023 panel — muse

Scope: LLP 1023, its three children, and residual research LLP 1018.008.009. Source inspected in the packet: `3b7f51564a`. Implementation reconciles the newer base `27d8d7e9dd98`.

## Round 1 — independent review

Packet SHA-256: `b7c0a76d5f4943aa84a8721b8b376bbd77e52347c4178ef74e7823a23cd1f474`. CLI exit: 0. Requested model is recorded above; no unreported served-model identity is inferred.

# Panel review: LLP 1023 program + 1018.008.009 residual

## Verdict: DIRECTIONALLY READY — with 5 pre-coding binds

The direction is solid enough to implement. The parent correctly frames three user-visible outcomes — coherent reads on one client, complete screens at fixture scale, durable browser writes — without reopening grammar, budget, scope, or benchmark requirements. Each child starts from reproduction classification, reuses landed fixes, and has a bounded stop rule. No material wrong turn requires a rewrite.

Readiness is conditional on the binds in §3. They are small, load-bearing, and must be recorded before coding starts. Without them the three lanes will collide on bytes, expand API surface, or re-litigate the benchmark.

## Per-child assessment

**1023 parent RFC — solid.** Gets the hard constraints right: 90,000-byte ceiling with effectively zero headroom at 89,999, no ceiling increase, no benchmark/fixture reduction to make refusals disappear, durability begins at carrier commit, `committed | queued | rejected` meanings preserved, acquisition throughput stays with 1018.008.007.002. Sequence — reconcile reproductions, parallel lanes with one integrator, then published-consumer qualification and a fresh frozen-input Clique wave — is the right order. Correctly states scores/diaries motivate but do not prove the bets.

**1023.000 one-query-story — ready with one gate.** Reusing the landed twin withhold for unheld totals rather than re-commissioning it is correct. Contract table properly distinguishes never-held, qualified-held, owner-proved absent/unreadable, and exhausted-empty cases, and refuses to infer coverage from `seq`, `live`, or numeric zero. Section A qualification-first approach is exactly right. Section C correctly reframes the media defect as online unconsumed disappearance, not cold-reopen redaction, preserving `nullOnceMedia` policy. The risk is §B: a conditional new refresh operation. The condition is stated but needs a harder gate before coding.

**1023.001 hub-scale — ready with one timebox.** The envelope audit in §A is the strongest part: it correctly separates probe `u0500` (500 follows + 100 conversations), hub `u0001` (100 groups + 900 DMs = 1,000 memberships), celebrity fan-out, and builder-requested 1,000-follow stress. Explicitly not selecting the hub ticket's brief reduction and requiring any real inconsistency to go through a separate future-freeze correction preserves benchmark integrity. The C1→C2→C3 order — sound single query, then complete composition, then declared gap — is right, as is refusing to bless `held_search` or guessed array-merge spellings as language. Risk is endless accounting repair on a heroic single 1,000-lane query instead of shipping a complete paged/chunked recipe.

**1023.002 web writes — ready with one clock cut.** Custody cuts are precise: no accepted-save claim before carrier commit, IndexedDB request success ≠ transaction completion, response-lost-after-commit replays same intent to one effect, route unmount ≠ document unload ≠ process kill. Reproduction matrix covers the right boundaries with barriers not sleeps. Keepalive as optional measured optimization only after admission, with quota/body/auth/loss controls, correctly demotes the headless-workaround lore. Token-only timing as diagnostic lower bound, not completion contract, avoids a false performance oracle. Risk is conflating the web lane's 1s/3s engineering targets with the acquisition lane's 2–3s objective or silently changing `mutation()` to resolve queued.

**1018.008.009 residual — correct supporting role, not a fourth work order.** Its value is connecting landed work to owners and naming what stays deferred: imported effect helpers, collection/`fn`-`proc` redesign, eviction, new policy identities. Its acquisition (§G3) and byte (§G8) warnings are load-bearing context for 1023: ~28.5s vs 2–3s objective is wide open, and V6 smoke ≠ V4 cohort qualification. The starter edit-draft ticket (G7) is correctly identified as G1-at-starter-scale but must stay out of 1023 lanes as a separate small task.

## 5 prioritized concerns and smallest fixes

**1. Three lanes, zero byte headroom — integrator must own the trade.**
At 89,999 bytes every lane cannot independently add code. The parent says "fund through deletion" but names no mechanism to serialize it.
*Bind before coding:* integrator measures five-root bytes before/after each lane merge; no lane lands net-positive without a paired deletion in the same merge; if no deletion is found the lane descopes per the 3-round rule rather than requesting a ceiling move. Guide/example bytes and runtime bytes stay separately accounted.

**2. 000-B refresh surface — prove the gap or ship no API.**
"Smallest refresh operation" is the only proposed API addition in the program and the easiest place to add permanent bytes and a second cache by accident.
*Bind:* no new method until a failing consumer test demonstrates the existing `useQuery`/`observe`/`client.query`/`{live:false}` sequence cannot express connected load → owner-accepted refresh → explicit stale/pending presentation with shared-subscriber, second-refresh, account/generation, cancellation, and offline-refusal lifecycle. Record the failing test and byte trade in-child before implementation. Default offline contract unchanged.

**3. 001 hero-query trap — timebox accounting, default to complete composition.**
The most expensive failure mode is spending all three fix rounds tuning certifier prices to admit one 1,000-lane merge or 50-row composite, then calling clearer refusal wording success.
*Bind:* C1 accounting repair gets the parent's 3-round budget; on expiry the child must ship C2 (cursor pages / smaller rich pages with valid continuation / complete chunk digest job with shipped compiling recipe in guide/examples) or declare C3 capability gap with failing consumer case retained. No freezing 500/100/10 as universal limits, no `first 100` paste as repair unless population/ordering/authorization/cursor proof is attached. Static bounds and measured fixture latency recorded separately.

**4. 002 clock and semantics confusion — keep acquisition out, keep `queued` honest.**
The web lane's median 1s admission / 3s terminal targets for a two-intent queue are validation targets, not SLAs or p95s, and full acquisition's 2–3s objective is owned elsewhere. A 15s unresolved call is a failed sample, not a timeout to raise.
*Bind:* web lane reuses the landed foreground fixture only as a matched pressure control with admission/replay/observation attribution; no bulk-preparation or receipt-execution throughput work. If an admission milestone before terminal is needed, propose explicit types/lifecycle with byte trade here — do not silently make `mutation()` resolve online calls as queued. Blocked-head cases expose reason + recoverable work, never counted as latency success.

**5. Custody and scope exclusions — once-media boundary + edit-draft out of scope.**
000-C's repair must live in selection/publication on the same durable client, never in persisted custody or the offline projection; no revival of consumed/revoked/switched-account descriptors, no durable live-answer cache, no `video once` grammar smuggling. Separately, the G7 edit-draft loss (draft in row state, page-shift eviction, `ui.editing` lockout) is real user-work loss but is not a 1023 acceptance item.
*Bind:* record both explicitly: once repair preserves `assets`/`offline` policy with alias/nullable-join/list-position and 410-vs-missing controls; edit-draft fix proceeds as an independent ticketed task with account-isolation and no-unauthorized-retention guards, not inside query/scale/web lanes.

## Landed vs new vs qualification

Already landed at `3b7f515` — qualify, do not rebuild: twin withholds unheld totals inside expressions/composites; foreground capacity/admission path with bounded waits and fences; bounded bulk transport batches and carrier groups; `deliver`-derived custody and empty-grant effects per 1019; locality diagnostics per 1020.

New implementation (only on demonstrated gap, within bytes): conditional refresh op in 000-B; accounting repair or complete composition + `E_BOUND`/`E_STEPS` repair guidance in 001; boundary repairs in 002 (provider ownership, carrier serialization/lock, replay head-vs-drain, observation notification) plus optional keepalive evaluation.

Qualification still missing and must be named, not inferred from old diaries: exact timed Insights load/refresh and UTC-boundary behavior; online unconsumed once publication vs warm/cold offline null; single-context offline-vote replay with clean-SDK and physical-network cuts; hub search reaching a last-slice match across 1,000 chats with paging/permission/offline controls; full-population digest with restart/retry/authorization; published-consumer evidence then a fresh Astra+Grok wave on unchanged frozen inputs. Old controls that already pass close only that case.

Subject to the five binds, implement the three plans in existing named lanes under the standing size, authority, loop, and NOT-DOING constraints, with no new gate, registry, service, or publication commitment beyond repository policy.

## Round 2 — panel discussion

Packet SHA-256: `68452b6c2e8a2512331442351512fe583a4e6a006f88023158983af3fe46cb65`. CLI exit: 0. Requested model is recorded above; no unreported served-model identity is inferred.

All four reviewers converged on DIRECTIONALLY READY, and that convergence is sound. The three 1023 plans isolate real builder failures, reuse landed repairs, and keep authority, size, and benchmark constraints intact. There is no material reason to redesign the program. The remaining work is the three Astra amendments, a byte/integrator discipline, and explicit rejection of two peer overreaches.

Astra's three amendments should be accepted as stated in the disposition. First, digest authorization must be evaluated at final per-user emission, not at early-chunk accumulation, because the job guide provides no sweep-wide snapshot. Revocation, deletion, or expiry between accumulation and emission must exclude the contribution. The fix must use existing bounded mechanisms or retain a named capability gap; neither an unbounded final rescan nor a new read model is presumed. Second, refresh completion must be a displayed-result contract: the accepted answer for that refresh must reach the screen through its chosen public path, same-sequence UTC changes can supersede, and an older delivery must settle obsolete without overwriting. The existing one-shot API is preferred; a new operation needs a failing consumer witness. Third, the pre-principal plain-wire branch must be traced for a configured durable client during restoration. A restoring durable client must wait or refuse truthfully, never fall through to plain bytes, and a refused wait after admission or auth expiry must preserve the admitted intent identity rather than encouraging a duplicate fresh submission.

Muse's five binds and Grok's locks are substantially compatible with this. I accept Muse 1-4 and Grok 1-5 subject to the root disposition: measured byte funding rides with each net-growing runtime change under one integrator for the two client lanes, not as a separate 500-byte deletion phase. The combined five-root measurement stays ≤90,000 with behavior preserved; package growth is separate. Scale stays ordered — sound single queries first, then complete supported compositions — with three failed rounds producing a recorded narrow gap, never an engine rewrite, new grammar, index, read model, or client N-way merge. A truthful gap is a bounded lane exit, not completed hub support. I also retain separated web versus acquisition clocks, real browser custody evidence, existing publication qualification, frozen brief interpretation, and no new blocking check or exact-HEAD loop.

Two peer mistakes must be corrected rather than carried into coding.

Gemini is wrong on three implementation prescriptions despite its correct READY verdict. Its mandated upfront ~500-byte deletion phase risks behavior-changing cleanup to fund unknown features; funding must be per-change and measured. Its G7 draft-custody prescription — lift drafts into defineItems/page cache — is outside this commission and substantively unsafe as specified: binding the draft lifetime to the query's authorized items reproduces the page-shift loss the ticket complains about, and authorization alone does not select that store. G7, acquisition throughput, hash narrowing, and effect helpers stay deferred. Gemini also overstates provider teardown on route unmount as the diagnosed web cause; it remains one lifecycle experiment among preparation, carrier, replay, and observation boundaries, and already-passing cases need no repair. I keep only Gemini's unrelated-update once-media witness, which the plan already contains, under existing revocation, account, and offline guards.

Grok's working-set demand is rejected. Archiving an unrelated active LLP to satisfy the pre-existing 59-document cap confuses Snapback 2's fenced working set with Snapback 1 apparatus and would delete active planning to green an unrelated check. The five links already existed; publication moves links only under repository policy.

With Astra's amendments recorded, per-change byte funding with one integrator, ordered scale with honest gaps, G7/acquisition/hash/helpers deferred, and no brief, fixture, or ceiling change, the program can start.

PROCEED

## Orchestrator disposition

All four reviewers supported proceeding. The three Astra amendments were incorporated in the child plans; actual byte funding, one integrator and the existing-mechanism scale order were retained. G7 and the arbitrary 500-byte cleanup phase were rejected. A capability gap remains an unmet product outcome.

Policy correction after discussion: root supplied an incorrect claim that the working-set cap did not apply. Reading `rules/RULES.md` directly confirms its 59-link budget applies to 1000+ work. The panel replies above preserve that mistaken input faithfully. The completed LLP 1021 current link is archived; its Implemented document and evidence remain intact. No active proposal is removed.
