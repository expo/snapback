**Reviewer family:** GPT
**Provider / runtime:** OpenAI Codex collaboration agent, gpt-6-astra xhigh
**Date:** 2026-09-12
**Redacted:** no; repository design/source excerpts only
**Method:** Independent frozen-packet review, then a panel discussion supplied with all four actual reviews and proposed root dispositions. No author acceptance is inferred from a reviewer verdict.

# LLP 1023 panel — astra

Scope: LLP 1023, its three children, and residual research LLP 1018.008.009. Source inspected in the packet: `3b7f51564a`. Implementation reconciles the newer base `27d8d7e9dd98`.

## Round 1 — independent review

Packet SHA-256: `b7c0a76d5f4943aa84a8721b8b376bbd77e52347c4178ef74e7823a23cd1f474`. Actual response from the Astra collaboration agent. Round 2 read the peer outputs and root dispositions directly; the assembled packet records those same inputs.

**DIRECTIONALLY READY.** Proceed with the three scoped plans. The program targets real builder failures, preserves the existing authority and size constraints, and starts with the right question: which failures remain on current source? It avoids recommissioning the unheld-total and foreground-admission repairs and does not mistake smaller discovery bounds for complete scale support.

The remaining uncertainty warrants bounded implementation work, not another program redesign. I would make the following three amendments before selecting repairs. They are local decisions and reproduction requirements; none requires another approval cycle or a new mechanism in advance.

1. **Define the digest’s authorization boundary before choosing its chunk recipe.**

   LLP 1023.001 correctly requires complete jobs, fixed period boundaries, restart safety and authorization exclusions. Its weakest remaining point is the interaction between those requirements and changes during a multi-chunk run.

   The supplied job guide says jobs execute as the owner, read current rows chunk by chunk, and do not share one snapshot across the sweep. Consequently, a system-owned job cannot rely on ordinary viewer read filtering to make each target’s digest safe. Further, checking membership when processing an early chunk does not establish that the accumulated contribution remains eligible when the final payload is emitted. Membership revocation, deletion or expiry between those events is the important counterexample.

   Amend the digest subsection to state an explicit evaluation point for authorization and expiry. The conservative interpretation of the supplied brief is that the final per-user emission must exclude contributions that are no longer eligible then. Fixed activity-period boundaries alone do not answer that question.

   Then choose the smallest bounded recipe that satisfies it. Existing contributions or aggregates may already remain correct under the relevant mutations; alternatively, the final bounded operation may be able to validate the necessary facts. The packet does not establish which form works. Do not preselect a new read model, freeze a job-wide snapshot, or assume a final unbounded rescan is available.

   The focused acceptance addition is straightforward: accumulate an eligible contribution, revoke membership or expire/delete the relevant content before final emission, and verify the payload’s counts. Repeat the final chunk across a restart to verify the same logical user/period emission. If the existing forms cannot satisfy this within their bounds, retain a specific digest capability gap. Calling the result “per-chunk consistent” must not silently weaken the brief’s authorization requirement.

2. **Make refresh completion a displayed-result contract, including timed answers at the same sequence.**

   LLP 1023.000 already recognizes that `client.query()` can return held data during restoration or transport loss, and that the public observed handle has no refresh method. That is a sound starting point. The amendment needed is to say precisely what completes the proposed load/refresh sequence.

   A fresh response arriving at `client.query()` is insufficient if the screen continues displaying an older shared observation. The supplied `client-observed.ts` excerpt makes this distinction material: store-input refreshes can publish a twin evaluation, while retention of an authoritative value depends on specific state and identity conditions. A consumer must not clear its refresh indicator merely because transport finished while its displayed value remains stale or becomes unavailable through another publication path.

   Add this contract: a successful refresh makes the accepted answer for that refresh available to the screen through the selected public consumption path. That can be the explicit one-shot result or the existing shared query owner; it does not require inventing a new shared refresh API. An unchanged answer can complete without manufacturing a snapshot identity change.

   Also specify how overlapping refreshes settle. An earlier request cannot satisfy a later refresh merely because their owner sequence is equal. The seven-day Insights expression can change with server time without any data write, so sequence-only ordering is inadequate. Existing query/session ownership should determine supersession and cancellation; an obsolete attempt should settle as obsolete rather than overwrite the current displayed answer.

   The smallest consumer witness combines these properties: mounted Insights with a held answer; a controlled owner change or UTC rollover; refresh; accepted current answer displayed; then a delayed earlier delivery. This supplements the existing clock and publication-order matrix by testing the actual completion signal the app will use. If the existing API supports the sequence cleanly, publish that recipe and stop. Only a demonstrated consumer gap justifies the conditional new operation.

3. **Prove that a configured durable client cannot enter the plain-wire path during restoration.**

   LLP 1023.002 describes the existing durable path as enqueue-before-dispatch, which is true of the established-runtime branch shown. However, the supplied `submitMutation` excerpt also contains:

   `if (!runtime || runtime.principal === undefined) return plain();`

   This is a targeted uncertainty, not a demonstrated defect: the caller may already prevent a configured durable client from reaching that branch before its account is established. The packet does not include that caller proof. Because the proposed outcome is one reliable durable client, the distinction between “no durable store configured” and “durable store still restoring its principal” deserves an explicit reproduction.

   Amend the fresh-store/bearer-auth case to pause restoration before the runtime principal is established, then submit a mutation. Trace whether it waits, refuses truthfully, or sends plain bytes. A configured durable client must not accidentally bypass the carrier and lose replay identity because preparation was incomplete. Preserve the intentional non-durable-client behavior; do not globally remove the plain path without tracing its callers.

   Add the complementary post-admission case to the same trace: authentication expires after carrier commit but before the call returns. The offline guide explicitly allows the call to refuse while admitted bytes remain sealed for later replay. The consumer must therefore distinguish a refused wait from a terminal rejection of the durable intent. Preserving a draft is correct, but encouraging a fresh submission while the original admitted work remains recoverable can duplicate the user’s action.

   Use the existing work/alias owner to retain that distinction. This does not justify another persistence layer or a new retry policy. If existing fences and work lookup already handle both cases, retain qualification and make no runtime change.

My assessment of each document is:

- **LLP 1023 parent: ready.** The three outcomes are coherent, and the sequencing separates source repair, integration, publication and benchmark evidence. Treat the latest user instruction as the implementation commission; the older “not commissioned” language needs a routine status update. The 89,999-byte baseline makes measured deletion a real prerequisite for runtime additions, not a closing bookkeeping task. Start that accounting with the first candidate change.

- **LLP 1023.000: ready, with amendment 2.** Reusing the unheld-total repair and testing the full timed Insights shape is substantially better than another generic snapshot rewrite. The once-media plan also draws the correct boundary: preserve an eligible online owner descriptor without weakening offline redaction or viewing-instance custody. Avoid solving either issue by broadly retaining old owner answers. The existing prohibition on extending untimed-total retention indiscriminately is important.

- **LLP 1023.001: ready as a feasibility-led implementation lane, with amendment 1.** It correctly distinguishes the 500-follow probe, the fixture’s 1,000-conversation hub, and optional stress shapes. Following, search, rich history and digest need working consumer forms, not mandatory changes to compiler prices. Membership paging and message paging must remain separate, and the shipped search consumer must represent continued search through empty membership slices rather than displaying premature “no results.” The supplied packet does not establish that every required form already fits; the plan appropriately allows a specifically retained capability gap instead of altered acceptance data.

- **LLP 1023.002: ready, with amendment 3.** Carrier commit, server settlement and query observation are separated correctly. The deterministic lifecycle cuts are appropriate, and optional keepalive work comes late enough to avoid becoming a substitute for durable admission. The ten-sample timing protocol is an engineering probe, not a claimed SLA. Preserve failures and blocked-head reasons instead of hiding them in a larger timeout.

- **Residual research: ready as an ownership map.** It accurately keeps the roughly 28.5-second acquisition result separate from the unmet 2–3-second objective, and distinguishes historical cohorts from current evidence. Its draft-state, invalidation and effect-helper findings do not commission additional mechanisms through this program. Neither completion of these three plans nor better qualitative scores should close those independent residuals.

The packet supports proceeding directionally. It does not establish compiled full-population recipes, real-browser custody success, or published-package qualification; those remain the concrete outputs of the authorized implementation work.

## Round 2 — panel discussion

Packet SHA-256: `68452b6c2e8a2512331442351512fe583a4e6a006f88023158983af3fe46cb65`. Actual response from the Astra collaboration agent. Round 2 read the peer outputs and root dispositions directly; the assembled packet records those same inputs.

After reading the actual Grok, Muse and Gemini reviews, I see no remaining material reason to delay implementation. All four reviewers support the direction. Root’s dispositions resolve the substantive disagreements without adding another approval cycle.

Record the three accepted amendments in the children: explicit digest authorization/expiry semantics at final emission; refresh completion tied to the displayed current answer, including overlapping timed reads at equal sequence; and the cold-authentication/plain-wire plus post-admission-refusal controls. These select what must be proved, not new mechanisms that must be built. Passing existing paths should produce qualification evidence and no speculative repair.

My responses to the peer differences are:

- **Bytes:** Agree with Muse and Grok on one integrator and measured paired deletion. Gemini’s mandatory 500-byte preliminary deletion is arbitrary. Fund the actual integrated change and measure the required roots and package entries; no separate deletion milestone is necessary.
- **Scope and diagnosis:** G7 remains deferred. Gemini’s proposed page-cache custody would couple draft survival to the very page membership changes that caused the loss; it is not an accepted repair. Likewise, route/provider teardown remains a hypothesis to reproduce, not an established root cause.
- **Scale:** A legitimate refusal of one 1,000-lane query does not finish the investigation while an existing complete composition remains untested. If both supported forms fail, a retained structural gap is a valid bounded lane exit, but complete hub support and program product success remain unmet. No new grammar, index or client N-way merge is commissioned.
- **Public API:** Grok’s preference for existing `client.query` and `queued` is a good default, not proof that either supplies the required lifecycle. A one-shot can return held data, and an ordinary online mutation can remain pending after admission while waiting for its terminal. Test the consumer contract before selecting the recipe; add a surface only for a demonstrated gap and with its byte trade.
- **Once media and apparatus:** Gemini’s unrelated-update concern is already covered by 1023.000-C. Preserve an eligible live owner descriptor using the existing authority and viewing guards, not asset-ID equality alone. Grok’s proposed archive-current prerequisite adds an inapplicable gate to this fenced Snapback 2 work; the existing links need no new promotion step.

Implement the three plans within those boundaries, retain failures, and distinguish source completion from browser, full-scale and published-consumer qualification. The remaining uncertainties are precisely the work now authorized.

PROCEED

## Orchestrator disposition

All four reviewers supported proceeding. The three Astra amendments were incorporated in the child plans; actual byte funding, one integrator and the existing-mechanism scale order were retained. G7 and the arbitrary 500-byte cleanup phase were rejected. A capability gap remains an unmet product outcome.

Policy correction after discussion: root supplied an incorrect claim that the working-set cap did not apply. Reading `rules/RULES.md` directly confirms its 59-link budget applies to 1000+ work. The panel replies above preserve that mistaken input faithfully. The completed LLP 1021 current link is archived; its Implemented document and evidence remain intact. No active proposal is removed.
