**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.150.1, `gpt-5.6-sol` at xhigh
reasoning effort (confirmed in the run-log header: `reasoning effort: xhigh`),
read-only sandbox, `--ephemeral`, session `01a05339-e62b-7c71-a25b-b4bf35b22b17`
**Date:** 2026-08-30
**Redacted:** no
**Method:** cli-runner (`~/.volta/bin/codex exec -s read-only --ephemeral -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -o <final> "<brief>" </dev/null`), launched by the orchestrator (Claude Fable 5) on the author's ruling 6; the orchestrator authored the target and is not a reviewer

# Review artifact — LLP 0331 §"Coverage", Codex family (delta review, round 1)

Cross-family delta review of §"Coverage — the model against the thirty-seven
paper applications" and the sentences it changed, requested by the author
(ruling 6) because the nine per-application audits were all same-family
(Claude). Part A re-derives eight load-bearing verdicts from the primary
paper-application artifacts before reading any audit slice; Part B reviews
the section as LLP 0005 prescribes. Blindness to the slice reports during
Part A was instruction-based (SELF-ATTESTED).

- Target: `llp/0331-scoped-roles-diary-feedback.research.md` (uncommitted; revision 3 with the author's rulings recorded)
- Target sha256 at review: `58678711245c5022de79cbdccb27afb1159c905ca8cc1f4a31e416effaf6935a`
- Checkout HEAD: `112ff712123ca660e1be9d958a9e0069e36e1a4a` (file uncommitted)
- Instruction brief: `llp/reviews/0331-coverage-audit.codex.brief.md` (body sha256 `fe938fd7104fa5f9fbe3744176275e07c1a412594d1c6b1974b7c1ab28c05fa1`)
- Verbatim body sha256: `ee0248301fdf50d38411c4dbdf96dc768a572ad053e334110533be0bf0dedcf0`
- Wall clock: 2026-08-30T08:11:32-0700 → 2026-08-30T08:27:58-0700 (~16 min); tokens used 447,240
- Result: **NOT READY** (Part A: 5 AGREE, 3 DISAGREE — items 3, 6, 8; Part B: 5 MATERIAL, 1 MINOR)

Dispositions are recorded in LLP 0331 §"Coverage" → "Codex delta-review
dispositions (round 1)". Body below is verbatim from the Codex `-o` final
message.

---

## Round 1 — 2026-08-30 — uncommitted revision 3 at sha256 `58678711…`

## Part A

| Item | Verdict | Reason | Citation |
|---:|---|---|---|
| 1 | AGREE | Workspace authorization is explicitly nearest-ancestor, deny-stopping hierarchy; the primary audit says that missing primitive refuses 20 of 29 operations. | `llp/reviews/0329.014.001-paper-archetypes.fable-workspace.md:5`, `llp/reviews/0329.014.001-paper-archetypes.fable-workspace.md:43`, `llp/reviews/0329.014.001-paper-archetypes.fable-workspace.md:318` |
| 2 | AGREE | Notion independently needs resource-ancestry evaluation and group subjects. Eliminating either leaves the other: ACLs collect through ancestry, while the v0 separately unions direct and group verdicts. | `llp/reviews/0329.014.003-wave-3.codex-notion.design.md:134`, `llp/reviews/0329.014.003-wave-3.codex-notion.design.md:141`, `llp/reviews/0329.014.003-wave-3.fable-notion.v0.md:77`, `llp/reviews/0329.014.003-wave-3.fable-notion.v0.md:83` |
| 3 | DISAGREE | The identity-layer reduction is credible, but the six-app count has no consistent denominator. Uber and Photos both promise anonymous token-holder access; if “load-bearing” counts product capability, the total is at least eight. If it counts need for `bearerOf` after redemption may mint a session, Events and Calendar should also be reconsidered. The honest alternatives are redemption-minted ordinary principals, or an explicit signed-in-only/no-anonymous-link reduction. PIR is the clear case that expressly requires no session. | `llp/reviews/0329.014.002-wave-2.fable-editor.design.md:21`, `llp/reviews/0329.014.003-wave-3.fable-events.design.md:228`, `llp/reviews/0329.014.003-wave-3.grok-uber.design.md:17`, `llp/reviews/0329.014.003-wave-3.grok-uber.design.md:399`, `llp/reviews/0329.014.003-wave-3.fable-photos.design.md:9`, `llp/reviews/0329.014.003-wave-3.fable-photos.design.md:284`, `llp/reviews/0329.014.005-wave-4.fable-pir.v0.md:276` |
| 4 | AGREE | The five named applications have genuine hidden cross-principal inputs. A system continuation is honest only if the viewer phase does not commit the hidden-dependent outcome and the system phase performs that outcome atomically; Payments expressly rejects after-the-fact debt repair. | `llp/reviews/0329.014.002-wave-2.grok-payments.v0.md:1172`, `llp/reviews/0329.014.002-wave-2.grok-payments.v0.md:1182`, `llp/reviews/0329.014.003-wave-3.fable-tournaments.v0.md:304`, `llp/reviews/0329.014.003-wave-3.fable-calendar.v0.md:168`, `llp/reviews/0329.014.001-paper-archetypes.grok-booking.md:415`, `llp/reviews/0329.014.003-wave-3.codex-brokerage.v0.md:331` |
| 5 | AGREE | Twitch requires grant/sentence intervals at authoritative commit time and expressly rejects dependence on a late flag-flipping job. Its v0 names approximate schedule-bucket expiry as the honest reduced product. The two Twitch primaries establish that call; exclusivity across all 37 remains a corpus roll-up rather than something those two files alone prove. | `llp/reviews/0329.014.003-wave-3.grok-twitch.design.md:33`, `llp/reviews/0329.014.003-wave-3.grok-twitch.design.md:58`, `llp/reviews/0329.014.003-wave-3.codex-twitch.v0.md:556`, `llp/reviews/0329.014.003-wave-3.codex-twitch.v0.md:582` |
| 6 | DISAGREE | Five spot-checks confirm pervasive `principal.kind === 'system'` disjuncts, and a program view could mechanically remove them. They do not prove that the full Tier-1 bundle is smallest. A smaller initial form is a reserved `SYSTEM` principal admitted through ordinary table rules plus `callable:'system'`; `phase` and bypassing read/write views can wait for their separate applications. If views authorize writes table rules deny, they are a second policy locus. | `llp/reviews/0329.014.001-paper-archetypes.fable-workspace.md:94`, `llp/reviews/0329.014.001-paper-archetypes.grok-booking.md:168`, `llp/reviews/0329.014.003-wave-3.fable-notion.v0.md:80`, `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:103`, `llp/reviews/0329.014.003-wave-3.grok-photos.v0.md:123` |
| 7 | AGREE | The sampled ordered roles are closed vocabularies whose comparisons expand to finite sets: Workspace and BI use integer ranks, zero-trust enumerates nine roles and spells clinical authorization as a set, and Calendar has three fixed detail levels. No lattice operator is needed. | `llp/reviews/0329.014.001-paper-archetypes.fable-workspace.md:47`, `llp/reviews/0329.014.002-wave-2.fable-bi.v0.md:49`, `llp/reviews/0329.014.005-wave-4.fable-zerotrust.design.md:100`, `llp/reviews/0329.014.005-wave-4.fable-zerotrust.design.md:194`, `llp/reviews/0329.014.003-wave-3.fable-calendar.v0.md:56` |
| 8 | DISAGREE | Events chose `userAccess`, but it did not establish a core-safe closure: unbinding leaves a `take:50` worklist, claim returns `mergeWork:'pending'`, and discovering all affected events remains refused over unbounded history. That conflicts with immediate loss of the former user’s rows. The honest reduced product needs a hard per-contact horizon cap and must withhold claim/unbind acknowledgement until closure repair completes; otherwise principal sets or engine-maintained closure remain Tier 2. | `llp/reviews/0329.014.003-wave-3.fable-events.design.md:117`, `llp/reviews/0329.014.003-wave-3.fable-events.design.md:226`, `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:942`, `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:959`, `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:965`, `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:1356` |

## Part B

### Overall assessment

This is a strong research synthesis, but §Coverage is not ready to govern the 1001+ authorization spec. The core grammar and evidence method are unusually explicit, and most individual hierarchy, hidden-read, time, and role-lattice calls survive independent checking. The blocking problems are in the aggregation: inconsistent count denominators, an unproved closure lowering, an internally ambiguous Tier 1, and unannounced reversals of the candidate RFC.

### Strengths

- The tested core is stated precisely enough to review: rule effects, operands, probe depth, relationship shape, transition state, provenance, tracing, and no-oracle behavior are all enumerated. `llp/0331-scoped-roles-diary-feedback.research.md:487`

- The method distinguishes primary requirements, extension codes, and load-bearing versus droppable product reductions, and it openly identifies the original same-family evidence boundary. `llp/0331-scoped-roles-diary-feedback.research.md:498`, `llp/0331-scoped-roles-diary-feedback.research.md:509`

- The hierarchy verdicts are well supported. Workspace directly reports 20 hierarchy-dependent refusals, while Notion separately models ancestry and groups. `llp/reviews/0329.014.001-paper-archetypes.fable-workspace.md:43`, `llp/reviews/0329.014.003-wave-3.codex-notion.design.md:141`

- The document names product losses instead of silently approximating them, especially for Twitch time semantics, bearer-free products, and explicit role sets. `llp/0331-scoped-roles-diary-feedback.research.md:749`

- The author-ruling table preserves confidence and distinguishes firm from provisional rulings. That is valuable provenance for the future spec. `llp/0331-scoped-roles-diary-feedback.research.md:812`

### Concerns

#### MATERIAL — The headline counts do not use stable categories

The `31 / 3 / 2 / 1`, `35/37`, and `17 → 6` figures are doing design-selection work, but they count different things.

The 31-app headline is expressly limited to “human who-may” relationship shapes, while the conclusion uses it to validate the authorization model more broadly. `llp/0331-scoped-roles-diary-feedback.research.md:68`, `llp/0331-scoped-roles-diary-feedback.research.md:78`

The bearer count is internally inconsistent. Uber promises a live anonymous-token map and Photos names an anonymous token holder, yet both are excluded from the six. `llp/reviews/0329.014.003-wave-3.grok-uber.design.md:17`, `llp/reviews/0329.014.003-wave-3.fable-photos.design.md:9` Conversely, Events is included even though the section accepts redemption into an ordinary contact principal—the same reduction used to exclude Photos. `llp/0331-scoped-roles-diary-feedback.research.md:621`, `llp/0331-scoped-roles-diary-feedback.research.md:627`

Likewise, 35 applications needing “something that is not a signed-in human” does not establish that 35 need privileged system-table access. The ledger itself distinguishes 35 mentions, 33 load-bearing system cases, and roughly five hidden-reader cases. `llp/0331-scoped-roles-diary-feedback.research.md:688` Its statement that Coterie has no effect is also factually false: the Coterie v0 classifies three upload effects. `llp/0331-scoped-roles-diary-feedback.research.md:600`, `llp/reviews/0329.014.001-paper-archetypes.fable-coterie.md:50`, `llp/reviews/0329.014.001-paper-archetypes.fable-coterie.md:52`

Resolution: define separate denominators for product capability, rule-language requirement, identity-layer requirement, non-human invocation, and privileged table access. Recalculate the roll-ups and stop using the application partition as evidence for the whole Tier-1 bundle.

#### MATERIAL — Events and Calendar do not establish the claimed closure coverage

The Summary, account-model paragraph, and coverage roll-up say Events and Calendar are covered by a program-maintained closure and describe that as how their designs “shipped.” `llp/0331-scoped-roles-diary-feedback.research.md:74`, `llp/0331-scoped-roles-diary-feedback.research.md:271`, `llp/0331-scoped-roles-diary-feedback.research.md:582`

Events’ closure is not synchronously complete. The v0 leaves former-user repairs in a worklist, reports pending merge work, and refuses the unbounded discovery transaction. `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:942`, `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:959`, `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:965` That is incompatible with the primary design’s immediate-removal requirement. `llp/reviews/0329.014.003-wave-3.fable-events.design.md:117`

Calendar did not choose a maintained closure at all: its v0 uses bounded `any` over the viewer’s groups and then performs the grant lookup. `llp/reviews/0329.014.003-wave-3.fable-calendar.v0.md:66`, `llp/reviews/0329.014.003-wave-3.fable-calendar.v0.md:67` A closure fan-out is a proposed alternative, not primary evidence of a shipped lowering.

Resolution: either prove a capped, synchronous closure protocol—including revocation, unbinding, grant change, and acknowledgement—or move Events and Calendar back to unresolved/Tier 2. Replace “shipped” with “proposed paper lowering.”

#### MATERIAL — Tier 1 is neither demonstrated minimal nor reconciled with the one-locus claim

The model says table policy is the authorization locus and promises no second evaluator. `llp/0331-scoped-roles-diary-feedback.research.md:149`, `llp/0331-scoped-roles-diary-feedback.research.md:154` Tier 1 then permits a program to read and write what table rules do not admit, based on its declared view. `llp/0331-scoped-roles-diary-feedback.research.md:720`, `llp/0331-scoped-roles-diary-feedback.research.md:725`, `llp/0331-scoped-roles-diary-feedback.research.md:728`

That yields a forced choice:

- If `reads:`/`writes:` merely document accesses, they cannot remove the system arms from table rules.
- If they grant access, they are a second authorization locus even if the same evaluator executes both policies.

The ledger makes this contradiction sharper by placing program-scoped write grants in Tier 2 while Tier 1 already contains per-program `writes:` views. `llp/0331-scoped-roles-diary-feedback.research.md:705`

The full bundle is also not minimal. Existing v0s show a smaller construction: an ordinary reserved system principal admitted explicitly by table rules, plus `callable:'system'` where client invocation must be refused. The approximately five hidden-read applications can justify `phase` or hidden views separately; the 35-app actor count cannot. `llp/0331-scoped-roles-diary-feedback.research.md:598`, `llp/0331-scoped-roles-diary-feedback.research.md:607`

Resolution: split Tier 1 into actor identity, invocation policy, continuation elevation, and program views. Choose explicitly between table-rule authorization and program-grant authorization. If views grant privilege, specify noninterference and taint rules at least as strong as the RFC’s prohibition on hidden inputs escaping through fields, errors, or failure detail. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:202`

#### MATERIAL — The section silently reverses the candidate RFC and misstates its “outside” verdicts

Because the RFC is Draft and authorizes nothing, the founder may narrow it. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:4`, `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:41` Only implemented Snapback 2 specs bind. `rules/RULES.md:56`

But the changes must be stated as explicit reversals:

- Ruling 0 refuses a surface `principal.kind` term that the RFC admits. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:280`
- Ruling 2 defers `principal.bearerOf`, which the RFC admits. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:280`
- Ruling 3 defers `getHidden`, which the RFC admits. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:283`
- Ruling 4 defers `any`, while the RFC admits both `any` and `nearest`. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:276`
- Rulings 1 and 5 are broadly consistent with the RFC’s `where` and versioned standard-library direction. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:276`, `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:288`

The “outside by the RFC’s own verdict” paragraph is also inaccurate. The RFC admits rule ownership/composition as dimension Q, treats device authority as the same language under a second runtime, and leaves that product-boundary classification open. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:235`, `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:258`, `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:614` Its actual “not this system” list is offline double-spend impossibility, commit-instant remote-oracle agreement, and PIR. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:536`

Resolution: add a “delta from LLP 0329.014.004” table and describe Platform, dimension P, and multi-region as initial Snapback 2 scope decisions—not RFC verdicts.

#### MATERIAL — The admission rule does not constrain admission, and Sequence 4b over-admits before the Clique bar

Tier 2 says each extension waits for a scheduled application. `llp/0331-scoped-roles-diary-feedback.research.md:736` The actual admission rule allows any corpus application, meaning the existing 37-app corpus can satisfy condition 1 immediately. `llp/0331-scoped-roles-diary-feedback.research.md:764` Condition 4 permits “why nothing can” leave, contradicting the governing rule that something must come off the doing-list. `llp/0331-scoped-roles-diary-feedback.research.md:772`, `rules/NOT-DOING.md:64`

The one-input/one-probe budget is syntactic, not semantic: a single hidden-read input, bearer term, or program write grant can carry much more authority than several ordinary probes. `llp/0331-scoped-roles-diary-feedback.research.md:775`

Nothing in Tier 2 or the refused list is required for Clique M1–M3. The stated bar is accounts, feed, and realtime chat, with everything else absent until demanded. `rules/NOT-DOING.md:9` Yet Sequence 4b bundles jobs, effect ingress, same-commit continuation, and per-program privileged views into the pre-bar sequence, although the pre-bar feature list names only one schedule kind alongside assets and one channel. `llp/0331-scoped-roles-diary-feedback.research.md:463`, `rules/NOT-DOING.md:29`

Rows 6 and 7 also place “principal sets” in both identity and authorization expansion without distinguishing binding storage from a rule input. `llp/0331-scoped-roles-diary-feedback.research.md:465`, `llp/0331-scoped-roles-diary-feedback.research.md:466`

Resolution: require a scheduled 1001+ spec with implementer/date, a specific failing product assertion, a measured lowering, and an actual doing-list trade. Split row 4b into the smallest schedule actor needed before the bar and later hidden-read/continuation/view extensions.

#### MINOR — Several categorical statements are only inferred or are literally too broad

“Every v0 in the corpus” uses a system-kind disjunct is false as written; Ledger has no schedule, channel, or effect, and Coterie has no system principal in its schema. `llp/0331-scoped-roles-diary-feedback.research.md:614`, `llp/reviews/0329.014.001-paper-archetypes.codex-ledger.md:20`, `llp/reviews/0329.014.001-paper-archetypes.fable-coterie.md:136`

The Events contact-lookup requirement is based on a line explicitly marked an inferred footgun, then becomes an unqualified fact in the application table. `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:132`, `llp/0331-scoped-roles-diary-feedback.research.md:554`

Resolution: say “the v0s that require privileged system writes commonly use…” and mark the Events hidden-lookup call as inferred and droppable unless cross-host contact deduplication is retained.

### Suggestions

- Replace the headline partition with a two-axis matrix: relationship expressiveness and execution authority. Applications can then occupy multiple cells without forcing a misleading single verdict.

- Give every count a named denominator and appendix list. Counts should be reproducible from rows, not interpretive summaries.

- Rename “declared read/write view” according to its real semantics: access manifest if descriptive, program grant if authorizing.

- Define the continuation boundary precisely: what commits in phase one, what the caller observes, whether phase two is synchronous, and what atomicity claim survives.

### Open questions

1. Is `phase:'system'` a second transaction enqueued by the viewer commit, as the RFC wording indicates, or an elevated phase inside one database transaction? `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:292`

2. Do `reads:` and `writes:` grant authority or merely report certificate access? The answer determines whether Tier 1 works and whether it violates the one-locus model.

3. What hard cap makes an Events claim/unbind closure complete before acknowledgement while preserving immediate revocation?

4. Is bearer “load-bearing” counting a product’s anonymous-link promise, or only the need for a raw bearer rule term after identity redemption?

### Recommended next step

Revise the affected Summary, model-table rows, account-model paragraph, Sequence rows, Coverage counts, and RFC-boundary language; then rerun this delta review against the revised named-app ledger. The author already required the cross-family pass, and the resulting disagreements are material rather than editorial. `llp/0331-scoped-roles-diary-feedback.research.md:820`

NOT READY
---

## Round 2 — 2026-08-30 — uncommitted revision 3 (round-1 fold + ruling-0 amendment) at sha256 `a1d4bb8f…`

- Target sha256 at review: `a1d4bb8f94b20545a2e93e05f54b3382cbd3633d69c4c34cbd2a6eb674c97597`
- Instruction brief: `llp/reviews/0331-coverage-audit.codex.r2.brief.md`, sha256 `4594c627086035d6a7250cb79a7c4297751a8037e9c41aa3dba82962b3696e42`
- Provider / runtime: OpenAI Codex CLI v0.150.1, `gpt-5.6-sol` at xhigh (run-log header: `reasoning effort: xhigh`), read-only, `--ephemeral`, session `01a05351-75bf-73f3-a39e-93960edf068e`
- Verbatim body sha256: `2287ee8f113d13d678f54700de46a3d511922f1a5dfff729cc0cf6a9be221d19`
- Wall clock: 2026-08-30T08:37:22-0700 → 2026-08-30T08:46:31-0700 (~9 min); tokens used 233,685
- Result: **NOT READY** (Part A: 4 RESOLVED, 4 PARTLY, 0 NOT RESOLVED; Part B: 3 MATERIAL — stale declared-view wording and a self-contradicting budget line; cross-program authority of one shared system principal; three omitted RFC delta rows)

Body below is verbatim from the Codex `-o` final message.

## Part A

| Item | Verdict | Reason | Citation |
|---:|---|---|---|
| 1 | RESOLVED | Bearer demand now has stable denominators: 17 mentions, 8 anonymous-access product promises, and 1–2 remaining rule-term cases after identity redemption; Uber, Photos, and necessarily sessionless PIR are accounted for. | `llp/0331-scoped-roles-diary-feedback.research.md:649`; `llp/0331-scoped-roles-diary-feedback.research.md:652`; `llp/0331-scoped-roles-diary-feedback.research.md:654`; `llp/reviews/0329.014.003-wave-3.grok-uber.design.md:17`; `llp/reviews/0329.014.003-wave-3.fable-photos.design.md:9`; `llp/reviews/0329.014.005-wave-4.fable-pir.v0.md:276` |
| 2 | PARTLY | Normative Tier 1 now has one table-policy locus and program-scoped write grants are cleanly Tier 2, but stale text still makes a “declared program view” operative, and the budget contradicts `viewer === system` by saying `system` is “never in a rule.” | `llp/0331-scoped-roles-diary-feedback.research.md:725`; `llp/0331-scoped-roles-diary-feedback.research.md:742`; `llp/0331-scoped-roles-diary-feedback.research.md:765`; `llp/0331-scoped-roles-diary-feedback.research.md:767`; `llp/0331-scoped-roles-diary-feedback.research.md:715`; `llp/0331-scoped-roles-diary-feedback.research.md:781`; `llp/0331-scoped-roles-diary-feedback.research.md:798`; `llp/0331-scoped-roles-diary-feedback.research.md:830` |
| 3 | RESOLVED | Events and Calendar are Tier 2; Events’ closure is only an interim with capped, named revocation lag, while Calendar is correctly recorded as using bounded `any`. | `llp/0331-scoped-roles-diary-feedback.research.md:570`; `llp/0331-scoped-roles-diary-feedback.research.md:577`; `llp/0331-scoped-roles-diary-feedback.research.md:598`; `llp/0331-scoped-roles-diary-feedback.research.md:607`; `llp/0331-scoped-roles-diary-feedback.research.md:728`; `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:942`; `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:959`; `llp/reviews/0329.014.003-wave-3.fable-events.design.md:118`; `llp/reviews/0329.014.003-wave-3.fable-calendar.v0.md:67` |
| 4 | RESOLVED | Recount: 35 table rows name an actor, and Coterie’s non-authorizing upload effects make 36 invokers; excluding Realtime’s ordinary-host path and Notion’s droppable X11 path yields 33 privileged-system cases. The five load-bearing viewer-invoked hidden cases are Booking, Payments, Brokerage, Calendar, and Tournaments; Events adds an inferred, droppable lookup. The 31 figure is explicitly limited to human who-may rules. | `llp/0331-scoped-roles-diary-feedback.research.md:552`; `llp/0331-scoped-roles-diary-feedback.research.md:556`; `llp/0331-scoped-roles-diary-feedback.research.md:567`; `llp/0331-scoped-roles-diary-feedback.research.md:582`; `llp/0331-scoped-roles-diary-feedback.research.md:594`; `llp/0331-scoped-roles-diary-feedback.research.md:619`; `llp/0331-scoped-roles-diary-feedback.research.md:624`; `llp/0331-scoped-roles-diary-feedback.research.md:559`; `llp/0331-scoped-roles-diary-feedback.research.md:563`; `llp/0331-scoped-roles-diary-feedback.research.md:575`; `llp/0331-scoped-roles-diary-feedback.research.md:577`; `llp/0331-scoped-roles-diary-feedback.research.md:581`; `llp/reviews/0329.014.001-paper-archetypes.fable-coterie.md:50`; `llp/reviews/0331-coverage-audit.w3b.md:228` |
| 5 | PARTLY | The listed RFC rows and “outside” distinctions are accurate, but the claim that every narrowing is listed is false: the table omits `ctx.replica`, server-plane session/device/fresh terms, and Tier-2 program-scoped write grants. | `llp/0331-scoped-roles-diary-feedback.research.md:880`; `llp/0331-scoped-roles-diary-feedback.research.md:884`; `llp/0331-scoped-roles-diary-feedback.research.md:892`; `llp/0331-scoped-roles-diary-feedback.research.md:895`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:280`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:303`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:308`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:188`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:536`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:545` |
| 6 | PARTLY | Conditions 1 and 4, the authority-aware semantic budget, and sequence rows 4b/4c/6/7 are present and match the doing-list rule; the budget’s “system … never in a rule” contradiction prevents full resolution. | `llp/0331-scoped-roles-diary-feedback.research.md:478`; `llp/0331-scoped-roles-diary-feedback.research.md:479`; `llp/0331-scoped-roles-diary-feedback.research.md:481`; `llp/0331-scoped-roles-diary-feedback.research.md:482`; `llp/0331-scoped-roles-diary-feedback.research.md:815`; `llp/0331-scoped-roles-diary-feedback.research.md:825`; `llp/0331-scoped-roles-diary-feedback.research.md:828`; `llp/0331-scoped-roles-diary-feedback.research.md:830`; `rules/NOT-DOING.md:52`; `rules/NOT-DOING.md:66` |
| 7 | PARTLY | Events’ contact lookup is correctly marked inferred, and the main count text now limits its v0 claim; however, “the form every v0 used” was reintroduced twice even though Ledger and Coterie do not have that system-rule form. | `llp/0331-scoped-roles-diary-feedback.research.md:570`; `llp/0331-scoped-roles-diary-feedback.research.md:639`; `llp/0331-scoped-roles-diary-feedback.research.md:647`; `llp/0331-scoped-roles-diary-feedback.research.md:930`; `llp/reviews/0329.014.003-wave-3.grok-events.v0.md:132`; `llp/reviews/0329.014.001-paper-archetypes.fable-coterie.md:136` |
| 8 | RESOLVED | This is adequate Research-to-Spec handling: it preserves the RFC’s enqueued-continuation reading, requires the 1001+ spec to define the transaction/observation boundary, and excludes Payments and Brokerage from the interim because they require an atomic hidden-dependent outcome. | `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:292`; `llp/0331-scoped-roles-diary-feedback.research.md:479`; `llp/0331-scoped-roles-diary-feedback.research.md:789`; `llp/0331-scoped-roles-diary-feedback.research.md:793`; `llp/0331-scoped-roles-diary-feedback.research.md:873` |

## Part B

### MATERIAL — The amendment is not consistently folded

What is wrong: the document simultaneously says table rules authorize `system`, says `system` is never in a rule, and still invokes a Tier-1 “declared view.” That leaves incompatible design instructions for the 1001+ spec. `llp/0331-scoped-roles-diary-feedback.research.md:715`; `llp/0331-scoped-roles-diary-feedback.research.md:765`; `llp/0331-scoped-roles-diary-feedback.research.md:781`; `llp/0331-scoped-roles-diary-feedback.research.md:798`; `llp/0331-scoped-roles-diary-feedback.research.md:830`

What would resolve it: replace all operative declared-view language with table-rule authorization, correct the Real Estate row, and make the budget say that the reserved `system` value may appear as a literal while `principal.kind` may not.

### MATERIAL — One reserved system principal creates unaddressed cross-program authority

What is wrong: `viewer === system` does not directly create an existence oracle for ordinary viewers, but it makes every system program mutually authoritative over every system-admitting table. Descriptive certificate sites do not constrain that authority or its disclosure flows. `llp/0331-scoped-roles-diary-feedback.research.md:765`; `llp/0331-scoped-roles-diary-feedback.research.md:767`; `llp/0331-scoped-roles-diary-feedback.research.md:774`

Evidence: the amendment mechanically covers sampled applications—Auction, Uber, and DoorDash all use system arms—but Auction’s primary v0 explicitly warns that this lets any other scheduled mutation patch any system-admitting wallet. `llp/reviews/0329.014.001-paper-archetypes.grok-auction.md:730`; `llp/reviews/0329.014.003-wave-3.codex-uber.v0.md:72`; `llp/reviews/0329.014.003-wave-3.codex-uber.v0.md:73`; `llp/reviews/0329.014.003-wave-3.grok-doordash.v0.md:98`; `llp/reviews/0329.014.003-wave-3.grok-doordash.v0.md:1401`

What would resolve it: the design must explicitly accept system programs as one fully trusted domain and require certificate-enforced negative/flow claims for hidden-to-visible disclosure, or supply another one-locus-compatible isolation mechanism. The RFC already specifies the relevant negative and taint claims. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:202`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:204`

### MATERIAL — The RFC delta claims completeness but omits admitted rule inputs

What is wrong: the Delta section promises every narrowing, yet omits RFC-admitted `ctx.replica`, `ctx.session`, `ctx.device`, `fresh`, and named-program write grants even though this document excludes or defers them. `llp/0331-scoped-roles-diary-feedback.research.md:880`; `llp/0331-scoped-roles-diary-feedback.research.md:882`; `llp/0331-scoped-roles-diary-feedback.research.md:741`; `llp/0331-scoped-roles-diary-feedback.research.md:742`

Evidence: those features are admitted by the RFC. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:188`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:256`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:280`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:303`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:308`

What would resolve it: add the omitted delta rows, or narrow the completeness claim to the author-ruling deltas actually enumerated.

NOT READY
---

## Round 3 — 2026-08-30 — uncommitted revision 3 (round-2 fold) at sha256 `57b6e3bc…`

- Target sha256 at review: `57b6e3bc28b5bcdf7df15f388d2b8ef2db044733596b2c9b8992ca45a3e296f4`
- Instruction brief: `llp/reviews/0331-coverage-audit.codex.r3.brief.md`, sha256 `9c6a6be7c4e4f5d5c244d2f7a408cb0cb4e3270afecf731e1480fda6673edea0`
- Provider / runtime: OpenAI Codex CLI v0.150.1, `gpt-5.6-sol` at xhigh (run-log header: `reasoning effort: xhigh`), read-only, `--ephemeral`, session `01a0535d-134a-7462-af8d-0b838d72018d`
- Verbatim body sha256: `d60b3d85035f13802374fd7855f65503366a423239efd1e16c58a17423bb1774`
- Wall clock: 2026-08-30T08:49:53-0700 → 2026-08-30T08:53:57-0700 (~4 min); tokens used 104,956
- Result: **NOT READY** (Part A: 3 RESOLVED, 1 PARTLY; Part B: 1 new MATERIAL — both residuals are delta-table rows: a missing `existsAny` row and a `propagate` row that contradicted ledger X13)

Body below is verbatim from the Codex `-o` final message.

## Part A

| Item | Verdict | Reason | Citation |
|---|---|---|---|
| 1 — MATERIAL 1 | RESOLVED | Operative Tier 1 text makes table rules the sole authorization locus, while certificate sites only describe access; the budget permits `system` solely as a literal compared with `viewer`. The remaining “same declared-view lowering” phrase is in a superseded audit question, not an operative grant; ruling 3 keeps `getHidden` in Tier 2. | `llp/0331-scoped-roles-diary-feedback.research.md:771`; `llp/0331-scoped-roles-diary-feedback.research.md:774`; `llp/0331-scoped-roles-diary-feedback.research.md:852`; `llp/0331-scoped-roles-diary-feedback.research.md:872`; `llp/0331-scoped-roles-diary-feedback.research.md:898` |
| 2 — MATERIAL 2 | RESOLVED | The consequence is stated honestly: every system program can access every system-admitting table. For Research feeding a spec, reviewed read/write sites plus mandatory negative and hidden-flow certificate claims sufficiently state the integrity and disclosure obligations the 1001+ spec must enforce. | `llp/0331-scoped-roles-diary-feedback.research.md:784`; `llp/0331-scoped-roles-diary-feedback.research.md:788`; `llp/0331-scoped-roles-diary-feedback.research.md:790`; `llp/0331-scoped-roles-diary-feedback.research.md:792`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:202`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:204` |
| 3 — MATERIAL 3 | PARTLY | The new rows cover the round-2 omissions, but completeness is still false: RFC dimension N admits bounded principal closure through `existsAny`, which this document explicitly defers to Tier 2, yet the delta table has no corresponding row. | `llp/0331-scoped-roles-diary-feedback.research.md:905`; `llp/0331-scoped-roles-diary-feedback.research.md:735`; `llp/0331-scoped-roles-diary-feedback.research.md:910`; `llp/0331-scoped-roles-diary-feedback.research.md:926`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:199` |
| 4 — Part A item 7 | RESOLVED | Both remaining categorical formulations are now correctly limited to v0s with privileged system writes. | `llp/0331-scoped-roles-diary-feedback.research.md:650`; `llp/0331-scoped-roles-diary-feedback.research.md:974` |

## Part B

NEW MATERIAL — The newly added v1.2 delta row says `propagate` is “not authorization scope here,” while the extension ledger places that same operator in Tier 2 as an engine-maintained authority-relation/fan-out mechanism. The RFC itself defines `propagate` through account-revocation authority fan-out. That leaves the future spec contradictory instructions: exclude it from authorization scope or admit it through Tier 2. `llp/0331-scoped-roles-diary-feedback.research.md:747`; `llp/0331-scoped-roles-diary-feedback.research.md:926`; `llp/0331-scoped-roles-diary-feedback.research.md:955`; `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:249`

NOT READY
---

## Round 4 — 2026-08-30 — uncommitted revision 3 (round-3 fold) at sha256 `cbf535f9…`

- Target sha256 at review: `cbf535f95c8f6ab039958b47dd6744ac390e40fb17e2323ba2db99f7c4165434`
- Instruction brief: `llp/reviews/0331-coverage-audit.codex.r4.brief.md`, sha256 `eeca1ebf1ccd6b18778e309b3ea1f71273c48a3cb2f9cf4d27b079b6b675dfbf`
- Provider / runtime: OpenAI Codex CLI v0.150.1, `gpt-5.6-sol` at xhigh (run-log header: `reasoning effort: xhigh`), read-only, `--ephemeral`, session `01a05361-a859-7460-9f68-3c0d8e58f88d`
- Verbatim body sha256: `e5989a790ec91726bafdd51da75010ef8e67133cb33664c1e175b95154ba7e43`
- Wall clock: 2026-08-30T08:54:56-0700 → 2026-08-30T08:57:20-0700 (~2.5 min); tokens used 84,810
- Result: **NOT READY** (both round-3 residuals RESOLVED; no new concern from the fold; one MATERIAL contradiction in pre-existing text — the admission rule's admissible classes vs Tier 2's engine-maintained relations and program-scoped grants). The orchestrator folded it and escalated the loop to the author after four rounds (rules/RULES.md: fix loops get three rounds, then escalate).

Body below is verbatim from the Codex `-o` final message.

Both round-3 residuals are resolved:

- `existsAny` now has an explicit dimension-N delta row assigning bounded principal closure to Tier 2, consistent with ledger X3 and the Tier 2 list: `llp/0331-scoped-roles-diary-feedback.research.md:927`, `llp/0331-scoped-roles-diary-feedback.research.md:736`, `llp/0331-scoped-roles-diary-feedback.research.md:802`.
- `propagate` now has its own dimension-E Tier 2 row matching ledger X13 and is absent from the not-in-scope row: `llp/0331-scoped-roles-diary-feedback.research.md:928`, `llp/0331-scoped-roles-diary-feedback.research.md:748`, `llp/0331-scoped-roles-diary-feedback.research.md:929`.

No new material concern was introduced within those two delta rows themselves. The changed Summary, model table, non-human-principal paragraph, and sequence rows consistently place the system actor in Tier 1 and principal sets, engine-maintained relations, and program-scoped grants in Tier 2: `llp/0331-scoped-roles-diary-feedback.research.md:85`, `llp/0331-scoped-roles-diary-feedback.research.md:97`, `llp/0331-scoped-roles-diary-feedback.research.md:169`, `llp/0331-scoped-roles-diary-feedback.research.md:170`, `llp/0331-scoped-roles-diary-feedback.research.md:285`, `llp/0331-scoped-roles-diary-feedback.research.md:288`, `llp/0331-scoped-roles-diary-feedback.research.md:482`, `llp/0331-scoped-roles-diary-feedback.research.md:486`.

One material internal contradiction remains. Tier 2 includes engine-maintained projections/`propagate` and program-scoped write grants: `llp/0331-scoped-roles-diary-feedback.research.md:748`, `llp/0331-scoped-roles-diary-feedback.research.md:750`, `llp/0331-scoped-roles-diary-feedback.research.md:809`, `llp/0331-scoped-roles-diary-feedback.research.md:811`. The delta table and amended ruling confirm those placements: `llp/0331-scoped-roles-diary-feedback.research.md:926`, `llp/0331-scoped-roles-diary-feedback.research.md:928`, `llp/0331-scoped-roles-diary-feedback.research.md:896`. But the admission rule permits only a new rule input or bounded probe and expressly excludes storage, while the budget says every Tier 2 row adds exactly one input or probe form: `llp/0331-scoped-roles-diary-feedback.research.md:845`, `llp/0331-scoped-roles-diary-feedback.research.md:847`, `llp/0331-scoped-roles-diary-feedback.research.md:857`. `propagate` is explicitly an engine write, and a program-scoped grant is a declaration/locus change, so neither satisfies that stated admission contract. The future spec therefore receives incompatible instructions about how these Tier 2 rows can enter.

NOT READY
---

## Round 5 — 2026-08-30 — the Expo/EAS section with rulings E-a to E-d applied, at sha256 `7d0ab32b…`

- Target sha256 at review: `7d0ab32bbc623c1b042849567b291c90ccb13f8ef2840f4b40cd8139b934ccec`
- Instruction brief: `llp/reviews/0331-coverage-audit.codex.r5.brief.md`, sha256 `3743753662683491fea294975e652932191824ed587b3692da24c811e11f4eac` (this round was permitted to read the Expo/EAS backend at `~/projects/universe/server/www/src` @ `ac32403958` to verify citations; its body cites that private repository by path and line only)
- Provider / runtime: OpenAI Codex CLI v0.150.1, `gpt-5.6-sol` at xhigh (run-log header: `reasoning effort: xhigh`), read-only, `--ephemeral`, session `01a05389-0f4a-70d0-8183-3433b415299d`
- Verbatim body sha256: `16c2d3b9e8222a383d0189742019525a62a99847e341ee6dfb1119ac8560e3b0`
- Wall clock: 2026-08-30T09:37:53-0700 → 2026-08-30T09:54:59-0700 (~17 min); tokens used 451,861
- Result: **NOT READY** — Part A: all three EAS claims AGREED on substance (mutable parent; 31/35 jobs as the dispatcher; cascades as deletion provenance) with corrected counts; Part B: 4 MATERIAL + 1 MINOR, all about the fold of rulings E-a to E-d rather than the rulings themselves. Folded; dispositions in LLP 0331 §"Coverage" → "Codex delta-review dispositions (round 5)".

Body below is verbatim from the Codex `-o` final message.

## Part A

1. **E1 — AGREE on the mutable-parent premise; DISAGREE with the `256/294` and `~280` counts.**

   Project transfer is shipped code: it requires `OWN` on the source and `ADMIN` on the destination, then rewrites `apps.accountId` in the transaction. `server/www/src/data/entities/projects/AppUtils.ts:124`, `server/www/src/data/entities/projects/AppUtils.ts:150`, `server/www/src/data/entities/projects/AppUtils.ts:158`, `server/www/src/data/entities/projects/AppUtils.ts:173`

   The app owns the mutable account association. `server/www/src/data/entities/projects/AppEntity.ts:215` App-scoped children instead carry `appId`: builds, branches, channels, updates, submissions, webhooks, and workflows all follow that form. `server/www/src/data/entities/turtlebuild/TurtleBuildEntity.ts:684`, `server/www/src/data/entities/updates/BranchEntity.ts:105`, `server/www/src/data/entities/updates/ChannelEntity.ts:93`, `server/www/src/data/entities/updates/UpdateEntity.ts:155`, `server/www/src/data/entities/submissions/SubmissionEntity.ts:372`, `server/www/src/data/entities/webhook/WebhookEntity.ts:73`, `server/www/src/data/entities/workflow/WorkflowEntity.ts:80`

   The dominant rule really does traverse the association path under authorization and then checks current account permission. `server/www/src/data/entities/rules/AllowIfAccountActorHasPermissionOnAssociatedAccountPrivacyPolicyRule.ts:234`, `server/www/src/data/entities/rules/AllowIfAccountActorHasPermissionOnAssociatedAccountPrivacyPolicyRule.ts:242`

   My primary-source census found 171 unscoped plus 121 scoped associated-rule instantiations: 292 total. Their directive depths were 20/176/69/27 for one through four steps; adding the two delegated app-read rules produces the artifact’s 294 and 22/176/69/27. `llp/reviews/0331-coverage-audit.eas-rules.md:51`, `llp/reviews/0331-coverage-audit.eas-rules.md:52`, `llp/reviews/0331-coverage-audit.eas-rules.md:96`

   Ten spot checks yielded two one-step, two two-step, four three-step, and two four-step paths:

   - App and SSO configuration: one step. `server/www/src/data/entities/projects/AppPrivacyPolicy.ts:23`, `server/www/src/data/entities/projects/AppPrivacyPolicy.ts:29`, `server/www/src/data/entities/sso/AccountSSOConfigurationPrivacyPolicy.ts:38`, `server/www/src/data/entities/sso/AccountSSOConfigurationPrivacyPolicy.ts:44`
   - Channel and billing pricing: two. `server/www/src/data/entities/updates/ChannelPrivacyPolicy.ts:27`, `server/www/src/data/entities/updates/ChannelPrivacyPolicy.ts:37`, `server/www/src/data/entities/billing/BillingContractPricingPrivacyPolicy.ts:31`, `server/www/src/data/entities/billing/BillingContractPricingPrivacyPolicy.ts:50`
   - Parent build, workflow run, workflow artifact, and Echo message: three. `server/www/src/data/entities/turtlebuild/TurtleBuildPrivacyPolicy.ts:68`, `server/www/src/data/entities/turtlebuild/TurtleBuildPrivacyPolicy.ts:86`, `server/www/src/data/entities/workflow/WorkflowRunPrivacyPolicy.ts:35`, `server/www/src/data/entities/workflow/WorkflowRunPrivacyPolicy.ts:49`, `server/www/src/data/entities/workflow/WorkflowArtifactPrivacyPolicy.ts:34`, `server/www/src/data/entities/workflow/WorkflowArtifactPrivacyPolicy.ts:48`, `server/www/src/data/entities/echo/EchoMessagePrivacyPolicy.ts:33`, `server/www/src/data/entities/echo/EchoMessagePrivacyPolicy.ts:47`
   - Echo message part and update-asset edge: four. `server/www/src/data/entities/echo/EchoMessagePartPrivacyPolicy.ts:32`, `server/www/src/data/entities/echo/EchoMessagePartPrivacyPolicy.ts:50`, `server/www/src/data/entities/updates/UpdateAssetEdgePrivacyPolicy.ts:33`, `server/www/src/data/entities/updates/UpdateAssetEdgePrivacyPolicy.ts:51`

   The broader 435-use roll-up and 32/46/16/6 percentages are consistent with the artifact’s grouped categories. `llp/reviews/0331-coverage-audit.eas-rules.md:87`, `llp/reviews/0331-coverage-audit.eas-rules.md:92` But the artifact’s own distinct-chain list sums to 216 App paths, not 256; its next sentence is internally inconsistent about the remaining 38. `llp/reviews/0331-coverage-audit.eas-rules.md:98`, `llp/reviews/0331-coverage-audit.eas-rules.md:102`

   **AGREE:** ruling 4’s immutable-scope premise fails for EAS’s central pattern. The scale is still dominant, but `256/294` and `~280` should not be retained without a corrected, published denominator.

2. **E2 — AGREE, with a qualification: 31 jobs never elevate; the other four do not necessarily run wholly as system.**

   Dispatch signs a serialized viewer and a 30-minute expiration into the job body. `server/www/src/background-jobs/BackgroundJobDispatching.ts:66`, `server/www/src/background-jobs/BackgroundJobDispatching.ts:69`, `server/www/src/background-jobs/BackgroundJobDispatching.ts:173`, `server/www/src/background-jobs/BackgroundJobDispatching.ts:195` The unauthenticated runner verifies the signature and expiry, deserializes that viewer, installs it on the request, and passes it into job execution. `server/www/src/apiv2/BackgroundJobRouter.ts:37`, `server/www/src/apiv2/BackgroundJobRouter.ts:102`, `server/www/src/apiv2/BackgroundJobRouter.ts:107`, `server/www/src/apiv2/BackgroundJobRouter.ts:114`, `server/www/src/apiv2/BackgroundJobRouter.ts:175`

   The registry has 37 entries, two explicitly test-only, hence 35 production jobs. `server/www/src/background-jobs/getBackgroundJobForType.ts:45`, `server/www/src/background-jobs/getBackgroundJobForType.ts:78`, `server/www/src/background-jobs/getBackgroundJobForType.ts:90` An exact module census finds four with an internal omni helper and 31 without one. `llp/reviews/0331-coverage-audit.eas-nonhuman.md:52`

   Five bodies confirm the pattern: DeleteApp loads and deletes under its passed viewer; automatic GitHub builds assert and use the robot/scoped viewer; audit export reads and uploads under the viewer; workflow review loads and mutates under the viewer; orchestrator priority sync is the sampled exception and temporarily enters omniscient context. `server/www/src/background-jobs/jobs/DeleteAppBackgroundJob.ts:35`, `server/www/src/background-jobs/jobs/DeleteAppBackgroundJob.ts:47`, `server/www/src/background-jobs/jobs/CreateGithubBuildAutomaticBackgroundJob.ts:73`, `server/www/src/background-jobs/jobs/CreateGithubBuildAutomaticBackgroundJob.ts:158`, `server/www/src/background-jobs/jobs/ExportAuditLogsBackgroundJob.ts:53`, `server/www/src/background-jobs/jobs/ExportAuditLogsBackgroundJob.ts:62`, `server/www/src/background-jobs/jobs/ReviewWorkflowRunBackgroundJob.ts:102`, `server/www/src/background-jobs/jobs/ReviewWorkflowRunBackgroundJob.ts:118`, `server/www/src/background-jobs/jobs/SyncOrchestratorPrioritiesBackgroundJob.ts:46`, `server/www/src/background-jobs/jobs/SyncOrchestratorPrioritiesBackgroundJob.ts:50`

   **AGREE:** 31 of 35 run without escalation as the dispatching principal. The E2 table should say the remaining four “contain an explicit elevation,” not that all four run entirely as system.

3. **E3 — AGREE on the authorization class; DISAGREE with “43 rule sites” as an unreconciled denominator.**

   Universe defines the claimed parent-specific wrapper family; App and User illustrate the seven wrappers over `AllowIfInParentCascadeDeletionPrivacyPolicyRule`. `server/www/src/data/entities/rules/AllowIfInAppDeletionCascadePrivacyPolicyRule.ts:8`, `server/www/src/data/entities/rules/AllowIfInAppDeletionCascadePrivacyPolicyRule.ts:25`, `server/www/src/data/entities/rules/AllowIfInUserDeletionCascadePrivacyPolicyRule.ts:9`, `server/www/src/data/entities/rules/AllowIfInUserDeletionCascadePrivacyPolicyRule.ts:26` Its tests allow only a matching transaction-local parent cause and reject absent or wrong-parent causes. `server/www/src/data/entities/rules/__tests__/AllowIfInAppDeletionCascadePrivacyPolicyRule-test.ts:39`, `server/www/src/data/entities/rules/__tests__/AllowIfInAppDeletionCascadePrivacyPolicyRule-test.ts:49`, `server/www/src/data/entities/rules/__tests__/AllowIfInAppDeletionCascadePrivacyPolicyRule-test.ts:71`, `server/www/src/data/entities/rules/__tests__/AllowIfInAppDeletionCascadePrivacyPolicyRule-test.ts:87`

   The deletion utilities propagate `cascadingDeleteCause`, use it while enforcing child loads, and pass it into child deletes; nullification does the same for updates. `server/www/src/data/entity/EntityDeletionUtils.ts:90`, `server/www/src/data/entity/EntityDeletionUtils.ts:299`, `server/www/src/data/entity/EntityDeletionUtils.ts:410`, `server/www/src/data/entity/EntityNullificationUtils.ts:127`, `server/www/src/data/entity/EntityNullificationUtils.ts:151` The practical reason is explicit: some cascades are too expensive for one transaction and are pre-deleted in batches. `server/www/src/data/entity/EntityDeletionUtils.ts:98`

   Child policies use the provenance to touch rows in accounts the deleting user can no longer access, and the last-owner invariant explicitly exempts account cascades. `server/www/src/data/entities/turtlebuild/TurtleBuildPrivacyPolicy.ts:133`, `server/www/src/data/entities/turtlebuild/TurtleBuildPrivacyPolicy.ts:148`, `server/www/src/data/entities/permissions/triggers/UserPermissionNoRemoveLastOwnerTrigger.ts:37` Entity schemas declare both cascade and set-null edges. `server/www/src/data/entities/turtlebuild/TurtleBuildEntity.ts:675`, `server/www/src/data/entities/turtlebuild/TurtleBuildEntity.ts:684`, `server/www/src/data/entities/updates/BranchEntity.ts:105`

   The 174 cascade plus 75 set-null order of magnitude is sound. The rule-site figure is not: the rules artifact reports 70 cascade-rule instantiations, with the per-class counts spelled out. `llp/reviews/0331-coverage-audit.eas-rules.md:63`, `llp/reviews/0331-coverage-audit.eas-rules.md:85` “43” may denote another grouping, but the document never defines it.

   **AGREE:** deletion cascades are the deletion-side counterpart of creation provenance, and no pre-E-c tier named that class. The current text now names it, so “no tier names it” should appear only as the historical audit finding.

## Part B

### Overall

The EAS audit found three real design pressures, and E-a through E-d are directionally good. The section is not ready as design input, however, because the new `inherits` admission does not satisfy the admission rule it invokes, its lowering discards an authorization check performed by EAS today, E-b leaves revocation semantics undefined, and E-c is not yet reconciled with the one-locus and bounded-certificate contracts.

### Strengths

- E1 is genuinely load-bearing: project transfer mutates the scope through which the dominant policy family resolves current authority. `server/www/src/data/entities/projects/AppUtils.ts:124`, `server/www/src/data/entities/rules/AllowIfAccountActorHasPermissionOnAssociatedAccountPrivacyPolicyRule.ts:234`
- E2 correctly avoids treating every deferred operation as omnipotent. The identity layer can supply an ordinary principal while table rules remain the only rule evaluator. `llp/0331-scoped-roles-diary-feedback.research.md:794`, `llp/0331-scoped-roles-diary-feedback.research.md:806`
- E-c identifies a real, cheaper structural class than adding `system` to every child rule. `llp/0331-scoped-roles-diary-feedback.research.md:403`, `llp/0331-scoped-roles-diary-feedback.research.md:967`
- E-d is narrow enough in its basic shape: it is limited to an invitation’s contact principal after a verified claim, not a general email-to-account merge. `llp/0331-scoped-roles-diary-feedback.research.md:324`, `llp/0331-scoped-roles-diary-feedback.research.md:327` That matches EAS’s actual verified-email invitation behavior. `server/www/src/data/entities/user/invitations/rules/AllowIfViewerEmailMatchesInvitationEmailRule.ts:44`, `server/www/src/graphql/mutations/UserInvitationMutation.ts:429`

### Concerns

1. **MATERIAL — E-a is not an instance of the admission rule as written.**

   The third class is an engine-maintained *relation declared like a table*, readable through its own rules and written only by the engine. `llp/0331-scoped-roles-diary-feedback.research.md:902` E-a instead defines a generated child column read through the child’s rule; it has no separate relation or “own rules.” `llp/0331-scoped-roles-diary-feedback.research.md:835`, `llp/0331-scoped-roles-diary-feedback.research.md:842`

   It also lacks the required scheduled spec, implementer, date, failing assertion, and doing-list trade. `llp/0331-scoped-roles-diary-feedback.research.md:897`, `llp/0331-scoped-roles-diary-feedback.research.md:912` Saying it will be implemented with the first transferring application is honest deferral, but not current admission. `llp/0331-scoped-roles-diary-feedback.research.md:847`

   The fold leaves two textual contradictions: the Summary still calls the system actor “the one extension admitted,” while the tier now has a second entry; and the EAS section says all three gaps are engine-maintained relations even though E2 immediately says it is only identity wording with no rule-language change. `llp/0331-scoped-roles-diary-feedback.research.md:105`, `llp/0331-scoped-roles-diary-feedback.research.md:835`, `llp/0331-scoped-roles-diary-feedback.research.md:1137`, `llp/0331-scoped-roles-diary-feedback.research.md:1152`

   Resolution: either keep `inherits` as an author-approved candidate until conditions 1 and 4 are satisfied, or amend the third class to cover an “engine-maintained derived field or relation,” state how each is governed, and name the actual scheduled spec and doing-list trade.

2. **MATERIAL — The proposed `inherits` lowering drops the intermediate parent’s read policy.**

   EAS does not merely fetch `app.accountId`; every intermediate entity is loaded with authorization. `server/www/src/data/entities/rules/AllowIfAccountActorHasPermissionOnAssociatedAccountPrivacyPolicyRule.ts:234` The App schema deliberately disables deletion-authorization inference in anticipation of possible per-project privacy. `server/www/src/data/entities/projects/AppEntity.ts:220`

   E-a instead says the child’s one-hop account rule is sufficient after copying the column. `llp/0331-scoped-roles-diary-feedback.research.md:842` That is equivalent for EAS today, but not generically: if the parent later gains an additional rule, a viewer could pass the inherited account test while being unable to read the parent.

   Resolution: `check` must prove that the parent policy is implied by the resulting child rule, retain an authorized parent probe, or refuse `inherits`. Rule changes on the parent must invalidate that proof.

3. **MATERIAL — E-b does not define live versus snapshotted authority or revocation.**

   EAS serializes a user ID and the sudo bit, not a session ID or session expiry. `server/www/src/data/entities/viewercontext/UserViewerContext.ts:26` The signed envelope expires after 30 minutes, but that does not revalidate the original session. `server/www/src/background-jobs/BackgroundJobDispatching.ts:173` Account membership is re-evaluated from current rows when the job runs. `server/www/src/data/entities/permissions/UserPermissionsUtils.ts:364`

   Thus EAS has mixed semantics: ordinary grants are live, while a copied sudo flag can outlive the request’s session state until envelope expiry. The ruling’s “bounded lifetime” does not choose the intended Snapback behavior. `llp/0331-scoped-roles-diary-feedback.research.md:966`

   Resolution: specify principal-disable/session-revocation behavior, whether app relationships are live, whether step-up state is ever copied, whether retries may extend the original bound, and the trace fields linking `enqueuedBy`, `runAs`, authority/session epoch, and expiry. A revoked principal or expired elevation should not escape the trace through reminting.

4. **MATERIAL — E-c is structurally plausible but not yet consistent with the strict one-locus and bounded-write claims.**

   The model says row-operation authorization lives at the table-policy locus. `llp/0331-scoped-roles-diary-feedback.research.md:182` E-c says a parent’s delete rule alone authorizes child deletes/nullifications through a schema edge. `llp/0331-scoped-roles-diary-feedback.research.md:403` Current EAS instead keeps child policy involved through explicit cascade-provenance rules. `server/www/src/data/entities/turtlebuild/TurtleBuildPrivacyPolicy.ts:136`, `server/www/src/data/entities/turtlebuild/TurtleBuildPrivacyPolicy.ts:153`

   This can remain one evaluator if the spec normatively defines the child’s `onDelete` declaration as part of that child table’s mutation policy. Without that sentence, it is a second authorization declaration outside table policy.

   The RFC supports engine structural writes and requires `writeSites.maxRows`, `engineWrites`, and amplification in the certificate. `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:367`, `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:425`, `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:471` The E-c text mentions `engineWrites` but does not define a priced cascade line, fan-out ceiling, cycle/multiple-path behavior, or what happens when the cascade exceeds one transaction. Universe explicitly needs batching for that case. `server/www/src/data/entity/EntityDeletionUtils.ts:98`

   There is also a scheduling contradiction: Tier 0 says deletion provenance is implemented for Clique M1–M3, while sequence 4c says cascade edges arrive after the bar with the first deleting application. `llp/0331-scoped-roles-diary-feedback.research.md:783`, `llp/0331-scoped-roles-diary-feedback.research.md:786`, `llp/0331-scoped-roles-diary-feedback.research.md:509`

   Resolution: define the schema edge as child-table policy, add a certificate entry such as `{ edge, mode, targetTable, maxRows, amplification }`, specify transaction/continuation behavior, and align Tier 0 with sequence 4c.

5. **MINOR — Several census claims need corrected denominators.**

   - 171 total and 168 production policy files are correct. But `164/148` includes the three test-fixture policies: the production counts are 161 omnipotent and 145 omniscient. `llp/reviews/0331-coverage-audit.eas-rules.md:48`, `llp/reviews/0331-coverage-audit.eas-rules.md:49` The current `164/148 of 168` formulation mixes denominators. `llp/0331-scoped-roles-diary-feedback.research.md:1117`
   - The `218` escalation-site count is reproducible when test-support code is excluded. `llp/reviews/0331-coverage-audit.eas-actors.md:168`
   - “About 80” scoped-token policies and “about 123” staff policies are acceptable approximations; the production policy counts are 77 and 122 respectively. `llp/reviews/0331-coverage-audit.eas-rules.md:50`, `llp/reviews/0331-coverage-audit.eas-actors.md:192`
   - The cascade census is 70 instantiations, not an explained 43. `llp/reviews/0331-coverage-audit.eas-rules.md:63`, `llp/reviews/0331-coverage-audit.eas-rules.md:85`
   - The introductory “thirty-six background jobs” should be 35 production jobs, or 37 registered including two tests. `llp/0331-scoped-roles-diary-feedback.research.md:1099`, `server/www/src/background-jobs/getBackgroundJobForType.ts:45`, `server/www/src/background-jobs/getBackgroundJobForType.ts:78`

   I did not independently reopen the E7 or E9–E11 primary implementations in this round; I therefore make no new end-to-end verdict on those rows beyond the cited audit artifacts.

### Suggestions

- Preserve E-d, but state that the contact principal is invitation-scoped, that rebinding is atomic with consuming or retargeting that invitation, and that collisions refuse rather than merge. That keeps “email is never a link key” meaningful. `llp/0331-scoped-roles-diary-feedback.research.md:316`, `llp/0331-scoped-roles-diary-feedback.research.md:326`
- Replace “all three are the admission rule’s third class” with separate classifications: E1 is a derived structural field, E2 is identity reminting, and E3 is a structural referential effect. `llp/0331-scoped-roles-diary-feedback.research.md:1137`
- Preserve the census query or script beside the evidence so future revisions cannot mix total-policy, production-policy, instantiation, file, and file×class denominators.

### Open questions

1. Is `inherits` physically a child column or a hidden maintained relation? Which table’s rules govern reading it?
2. Must an inherited child rule preserve every intermediate parent authorization verdict, or only the inherited scope equality?
3. Does job reminting revalidate principal/session epochs and current relation rows on every attempt?
4. Are cascade fan-outs bounded in one commit, or may they become continuations—and if so, what does the caller observe between phases?

### Next step

Revise E-a’s admission status and parent-policy semantics, specify E-b revocation/trace behavior, reconcile E-c with table-policy ownership and bounded certificates, and correct the census denominators. Then run a fresh delta review limited to those changes.

NOT READY
---

## Round 6 — 2026-08-30 — the Expo/EAS section after the round-5 fold, at sha256 `c4d71241…`

- Target sha256 at review: `c4d7124198ffe129c308e880d175ed7e1593438b73e5ddeed16338bdaaddeb41`
- Instruction brief: `llp/reviews/0331-coverage-audit.codex.r6.brief.md`, sha256 `06f7eea0aa61dbed8ac860e849a008e41efca84283636978c22b491b9e7f26db`
- Provider / runtime: OpenAI Codex CLI v0.150.1, `gpt-5.6-sol` at xhigh (run-log header: `reasoning effort: xhigh`), read-only, `--ephemeral`, session `01a0539c-793d-71a2-b189-5a4aa343056e`
- Verbatim body sha256: `2ab2e8dd8c15c1a2636c92f770723027782b4c376ff24890bed1c9d60c45b19c`
- Wall clock: 2026-08-30T09:59:10-0700 → 2026-08-30T10:02:32-0700 (~3.5 min); tokens used 103,739
- Result: **NOT READY** — Part A: MATERIAL 2, MATERIAL 4, and the E-d suggestion RESOLVED; MATERIAL 1, MATERIAL 3, and the census MINOR PARTLY (stale pre-fold wording left in the E1/E2 table cells, the EAS section's own rulings table, and three ledger rows); Part B: two MATERIAL (the same E-a wording inconsistency; condition 3 of the admission rule omits the derived-write bound) and two MINOR. All are text-consistency items; folded.

Body below is verbatim from the Codex `-o` final message.

## Part A

| Round-5 item | Status | Reason |
|---|---|---|
| MATERIAL 1 — E-a admission/classification | PARTLY | The admission rule now covers derived fields and E-a is conditional on conditions 1 and 4, but E1 still calls `inherits` Tier 2 and the later E-a ruling still reads as immediate admission. `llp/0331-scoped-roles-diary-feedback.research.md:875` `llp/0331-scoped-roles-diary-feedback.research.md:934` `llp/0331-scoped-roles-diary-feedback.research.md:1177` `llp/0331-scoped-roles-diary-feedback.research.md:1231` |
| MATERIAL 2 — parent policy lost by `inherits` | RESOLVED | The child keeps the parent’s rule conjoined unless `check` proves it implied, with that proof invalidated by parent-rule changes. `llp/0331-scoped-roles-diary-feedback.research.md:869` `llp/0331-scoped-roles-diary-feedback.research.md:1201` |
| MATERIAL 3 — E-b live/revocation semantics | PARTLY | Tier 1 now specifies live rows, disable/revoke refusal, no copied step-up, no retry extension, and trace fields; however, the E2 verdict still claims Tier 1 says jobs run as `system` and “must” be amended. `llp/0331-scoped-roles-diary-feedback.research.md:815` `llp/0331-scoped-roles-diary-feedback.research.md:1178` |
| MATERIAL 4 — E-c locus, certificate, continuation, placement | RESOLVED | The child declaration is explicitly part of the child table’s mutation policy, carries a bounded cascade certificate line, continues beyond one commit with observable draining state, and is placed after the Clique bar. `llp/0331-scoped-roles-diary-feedback.research.md:412` `llp/0331-scoped-roles-diary-feedback.research.md:797` `llp/0331-scoped-roles-diary-feedback.research.md:1001` |
| MINOR — census denominators | PARTLY | The EAS section has 161/145 of 168, 35 jobs, 272/292 paths, four elevations, and 70 cascade instantiations, but the ledger still says 164/168, 43 cascade sites, and approximately 280 mutable-parent uses. `llp/0331-scoped-roles-diary-feedback.research.md:773` `llp/0331-scoped-roles-diary-feedback.research.md:778` `llp/0331-scoped-roles-diary-feedback.research.md:785` `llp/0331-scoped-roles-diary-feedback.research.md:1150` `llp/0331-scoped-roles-diary-feedback.research.md:1168` `llp/0331-scoped-roles-diary-feedback.research.md:1177` `llp/0331-scoped-roles-diary-feedback.research.md:1179` |
| E-d narrowing suggestion | RESOLVED | Rebinding is invitation-scoped, atomic with consumption or retargeting, and collision-refusing rather than merging. `llp/0331-scoped-roles-diary-feedback.research.md:333` |

## Part B

MATERIAL — E-a still has contradictory disposition text. The operative tier and Author rulings make single-column `inherits` Tier 1, admitted only in principle until conditions 1 and 4 are met; the E1 “Verdict under the rulings” instead says `inherits` and `propagate` are both Tier 2, while the later EAS ruling says to admit `inherits` without preserving the conditional status. `llp/0331-scoped-roles-diary-feedback.research.md:856` `llp/0331-scoped-roles-diary-feedback.research.md:875` `llp/0331-scoped-roles-diary-feedback.research.md:999` `llp/0331-scoped-roles-diary-feedback.research.md:1016` `llp/0331-scoped-roles-diary-feedback.research.md:1177` `llp/0331-scoped-roles-diary-feedback.research.md:1231`

MATERIAL — The admission rule’s third class still cannot literally satisfy all four conditions. Condition 2 admits an engine-maintained derived field or relation and requires its write amplification in `engineWrites`, but condition 3 says pricing reports only “the input or the probe bound,” omitting the derived-write bound. `llp/0331-scoped-roles-diary-feedback.research.md:926` `llp/0331-scoped-roles-diary-feedback.research.md:934` `llp/0331-scoped-roles-diary-feedback.research.md:944`

MINOR — The E2 verdict remains written as an outstanding Tier 1 defect although the operative Tier 1 text already contains the amendment. `llp/0331-scoped-roles-diary-feedback.research.md:809` `llp/0331-scoped-roles-diary-feedback.research.md:1178`

MINOR — The round-5 disposition claims the census corrections were folded globally, but the ledger and several E-a evidence statements retain the rejected denominators. `llp/0331-scoped-roles-diary-feedback.research.md:778` `llp/0331-scoped-roles-diary-feedback.research.md:859` `llp/0331-scoped-roles-diary-feedback.research.md:1016` `llp/0331-scoped-roles-diary-feedback.research.md:1100` `llp/0331-scoped-roles-diary-feedback.research.md:1231`

NOT READY