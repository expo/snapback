# LLP 1023: The Clique builder jump — coherent reads, complete scale, durable writes

**Type:** RFC
**Status:** Accepted (2026-09-12: Charlie Cheever delegated directional selection after the panel and commissioned implementation; Codex selected this plan after all four reviewers advised proceeding)
**Systems:** Snapback 2 query publication and freshness, certified read envelopes, durable browser mutations, packaged guide and React/Expo examples; Clique benchmark interpretation
**Author:** Grok 4.6, for Charlie Cheever
**Date:** 2026-09-12
**Revised:** 2026-09-12 (Codex / GPT-6 Astra: final source review and full-suite evidence; inherited byte refusals; separately selected fresh instrument; retain unmet digest requirement and publication/benchmark limits)
**Related:** LLP 1000, LLP 1001, LLP 1010, LLP 1012, LLP 1018.003, LLP 1018.004, LLP 1018.007.000, LLP 1018.008.007.002, LLP 1019, LLP 1020; [residual assessment](./1018.008.009-residual-ergonomic-gaps.research.md); [query plan](./1023.000-one-query-story.plan.md), [scale plan](./1023.001-hub-scale-certified-reads.plan.md), [write plan](./1023.002-web-writes-that-survive-the-browser.plan.md)

## Summary

Builders have repeatedly added a second client or redesigned a query after
discovering a boundary in a working Clique app. The program should remove
those workarounds while preserving the product's data, authorization and
offline guarantees.

The commissioned program has three outcomes:

1. **Coherent reads on one client.** Unknown totals stay unknown; connected
   screen loads and refreshes meet their freshness requirement; held answers
   remain useful offline; view-once media follows its existing custody rules.
2. **Complete screens at the actual fixture scale.** Ship compiling query
   and job forms that reach all required data, with correct pagination and
   understandable costs. A smaller discovery bound is not a complete solution.
3. **Durable browser writes.** One provider-owned client admits writes,
   survives navigation after custody, replays after reopen and reports
   settlement without an auxiliary token client.

Charlie Cheever commissioned implementation on 2026-09-12 after a panel sanity
check, delegating the decision that the plans are directionally solid to Codex.
Implementation owner: Codex, with Astra coding agents in existing named
Snapback 2 lanes. The children now record their source outcomes and scoped
qualification below. The parent remains **Accepted, not complete**: the digest
final-emission requirement remains unmet. The residual research is context,
not a fourth implementation work order.

## Evidence and what it establishes

Initial review baseline: local main `3b7f51564a`, inspected 2026-09-12 UTC.
The table preserves that checkpoint; the integration section records subsequent
source outcomes. Neither is an exact-HEAD gate.

| Evidence | Supported conclusion | Limit |
| --- | --- | --- |
| [0.0.21 Astra score](../benchmarks/runs/2026-09-10-clique-ri-0.0.21/scores-astra.md) and [Grok score](../benchmarks/runs/2026-09-10-clique-ri-0.0.21/scores-grok.md): overall 82 and 72; Grok query/live 62, offline 53, client 50 | The reported client workarounds are important usability evidence | Different apps, builders and scorers; neither a controlled comparison nor proof of an 82-point ceiling |
| [0.0.24 record](../benchmarks/runs/2026-09-11-clique-astra-snapback2-0024-linux/README.md) and [0.0.25 record](../benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/README.md) | Builders reported recurring bound and client problems | The retained records do not establish independently graded M1–M8 success; shared-host load, preparation collision and cross-lane browser traffic limit attribution |
| [Insights resolution](../issues/closed/20260911-snapback2-insights-partial-twin-zero.md), landed in `3b7f51564a` | An uncovered maintained point could publish zero with a **partial** receipt; the twin now withholds the tainted result | Real-owner warm/cold hook regression exists; exact timed Clique Insights and published-browser qualification remain separate |
| [Acquisition plan §9](./1018.008.007.002-bounded-bulk-acquisition.plan.md#9-implementation-and-measured-outcome), `9f93f3e1ba` and `4e22e80462` | Batching and foreground admission repairs already landed | Single controls do not close the original single-context offline-flush report, browser navigation, or the acquisition objective |
| [Hub report](../issues/20260911-snapback2-hub-scale-certified-query-envelopes.md) | Several authored shapes refused and builders reduced/chunked them | Refusal sizes are bounds for those schemas, not universal lane limits; the report conflates required fixture coverage with the builder's chosen single-query shape |

The later `e4a85d7671` update completes the separate 0.0.24 Astra record:
fresh Opus 5 grading reports 101 passes and 18 not-run across its JSON and
M8 trace, fresh M7 finishes with a documented retry deviation, and the
experience score is 78/100. The grader also reproduces a major rapid-edit
application defect. Native proof, holdout, calibration and custody limits
remain. This corrects the initial checkpoint's incomplete grading state;
it is neither a result for this program nor evidence of a controlled score drop.

The earlier honestly stale complete-zero control remains valid behavior. The
later reproduced defect was unheld data published with a partial receipt.
Neither `seq === 0`, `source === "twin"`, numeric zero nor `live === false`
alone means an answer is wrong.

The score history and diaries motivate these bets; they do not prove that
papercuts cannot improve the product or that these three changes will raise
the score. Acquisition is also still a substantial user cost. Its owner stays
LLP 1018.008.007.002 rather than being duplicated here.

## Governing context

This scope is behind the Snapback 2 fence
([LLP 1000](./1000-snapback2.explainer.md#how-to-orient)). The foundation
overlay contains Snapback 1 policies; it does not import their apparatus here.
Current 1000+ implementation records and packaged guide cards govern facts.

- [LLP 1012 §6](./1012-local-first-v1.spec.md#6-reads-offline) and
  [LLP 1018.003 §2](./1018.003-truthful-and-composed-client.decision.md#2-derive-never-add):
  coverage, provenance, freshness and presentation are distinct. `ready`
  means readable data; a summary creates no authority.
- [LLP 1012 §7](./1012-local-first-v1.spec.md#7-writes-offline) and
  [LLP 1018.004](./1018.004-truthful-and-composed-writes.decision.md):
  atomic admission, immutable intent identity, FIFO, account fences and
  truthful settlement remain intact.
- [LLP 1012 §9](./1012-local-first-v1.spec.md#9-asset-bytes-on-the-device):
  once media is null offline, never byte-cached or made viewable by prediction.
- [LLP 1010 A5](./1010-quarry-language-amendments.rfc.md#a5-the-merged-feed):
  merge discovery and continuation must retain their actual semantics.
  Use `guide merge`, `bounds`, `pagination`, `maintain`, `live-query`,
  `offline`, `assets` and `job` before proposing a surface change.

The complete local runtime ceiling is 90,000 gzip bytes, target 80,000.
The initial [Insights record](../issues/closed/20260911-snapback2-insights-partial-twin-zero.md)
measured **89,999** with the pinned toolchain. The dedicated simplification
subsequently measured **89,986 → 89,843** on its fixed source baseline;
the combined `cee80bc1d` measurement confirms 89,843. Headroom remains narrow.
Fund added runtime bytes through deletion/simplification and measure the
combined result with the existing five roots. Package/guide growth limits
remain separate. Moving bytes between roots does not fund a feature.
The integrator records the baseline and each merged delta. A net-growing
runtime repair includes its behavior-preserving byte funding in the same
reviewed change. On 2026-09-12 the author additionally commissioned a dedicated,
metafile-driven simplification lane toward 80,000 bytes. No lane can spend
headroom independently of the combined result. After the measured attempt,
the integrator retained the 90,000 ceiling while the candidate fits it; the
author's conditional 99,999 fallback was not adopted. The 80,000 target remains
unmet.

## Program decisions

### One query story means coherent knowledge, not identical values at every instant

Bet 1 reuses the landed unheld-total repair and qualifies the remaining
screen-load, refresh, clock and live-media cases. A cached zero from yesterday
and a current owner value of three can both be correct with their respective
freshness. The product must make the required current answer available through
the same client and named query, without asking the app to repair receipt
logic. Do not blanket-hide valid offline totals or restore once media offline.

### Scale is a semantic obligation, not a preferred query spelling

The frozen brief at `f40559f37722c79178be664a11f8a6485f1508fd` names
`u0500` with 500 follows and 100 conversations. Its generator also gives
`u0001` 100 groups plus 900 DMs. That 1,000-conversation hub is real fixture
data. The brief does not demand a single 1,000-lane query, a 50-row composite,
or a 100-row backfill chunk.

Bet 2 preserves this population and the screen's semantics. Ordinary cursor
paging, bounded composite pages and complete scheduled jobs may be the right
forms. Querying only the first 100 of 1,000 memberships is not pagination.
No frozen benchmark, fixture or score threshold changes to make a refusal
disappear. If the supported form cannot meet the requirement within current
limits, report a remaining capability gap; do not call documentation success
the product jump.

### Durability begins at carrier commit

Bet 3 keeps the existing durable outbox as the owner. It separates provider
unmount, document unload, offline replay and delayed UI observation. Navigation
after successful custody must not lose a write; killing a document before
custody is not a delivery guarantee. Optional transport optimizations cannot
replace admission or ledger-based retry.

The existing mutation API returns `committed | queued | rejected`. Preserve
those meanings. An awaited rejection is not a successful save, and `queued`
does not mean the server has changed.

## Sequence and decision points

| Order | Work and owner | Reviewable exit |
| --- | --- | --- |
| 1 | Codex: reconcile all three reproductions against the inspected source and intended published version | Original shape, observed failure, existing fix and remaining test are identified per case |
| 2 | Query lane: preserve the Insights repair; resolve timed freshness and live once publication | One-client examples and before/after evidence for each remaining defect |
| 2 | Scale lane: compile and execute the required shapes; repair the highest-cost term or ship the complete existing composition | A cold consumer can reach required data using the shipped recipe; semantic and cost assertions both pass |
| 2 | Web lane: run deterministic custody/lifecycle cuts and the exact offline-vote replay | Same-account reopen preserves admitted identity and exactly one effect; terminal/refusal is observable |
| 2 | Byte lane: use the existing esbuild metafile to select structural consolidation in the measured runtime | Before/after five-root sizes and affected behavior checks; report any remaining gap to 80,000 honestly |
| 3 | Integrator: combine SDK changes, measure byte/loop costs, update governing LLPs and guide | Existing affected checks pass; every scope limit remains explicit |
| 4 | Existing publication/benchmark owner | Qualified package consumer evidence, then a fresh Clique wave using unchanged frozen inputs |

The three tracks may overlap; query and web edits to the
same lifecycle/publication code need one integrator. Acquisition owns throughput
work and its existing regressions. Do not reimplement it in the web lane.

Each reproduction/repair gets at most three fix rounds under
`rules/RULES.md`. Then record the unresolved cause or descope the proposed
mechanism. Descope does not change benchmark requirements or establish completion.
No new gate, registry, script, service, persistence layer or design document is
commissioned by this revision. Extend existing test and guide surfaces.

## Verification and product measure

**Implementation evidence:** the child acceptance matrices, compiling guide
examples, and affected semantic tests. Use Snapback 2's existing checks and
scheduled browser machinery. These plans create no additional blocking gate;
slow browser/full-scale work is scoped qualification, not an exact-HEAD landing
loop. Fix known affected failures before claiming their repair.

**Published product evidence:** record source/package, builder, instrument,
host, carrier and runtime. Reuse the frozen instrument unchanged; obtain fresh
Astra and Grok builds and independent grading. Preserve failures and environment
incidents. Earlier diaries help choose probes but are not prompts for cold
builders. Existing publication requirements still apply.

**Fresh-wave selection, before launch:** use upstream `b323d61f60b5d167708ca6ebe6434b1d5a79c899`,
instrument **0.3.8-m8**, fixture **0.2.2-m8**, manifest SHA-256
`3d449efbafb178cdc923bd2e69c01e692afbe2a2daf625ba7cb281255c5a5df4`.
The earlier `f40559f` and `e4a85d7` packets remain unchanged. Upstream 0.3.7
corrected the starter group that included Erin while its all-read choreography
opened only Alice/Bob/Carol. Before any run launched, upstream 0.3.8 then
preserved the UI kit's existing semantics on React Native Web and required
video posters; its observer reads that carrier. The scale log, brief, assertion
set and applicability are unchanged. This final selection incorporates both
separate instrument repairs without editing a running instrument or
reinterpreting earlier scores. Its identity differs from earlier scores and
cannot establish a causal score change. Cold builders receive only the normal
task, public instrument and installed package, without these findings.

| Outcome | Objective evidence | Product observation |
| --- | --- | --- |
| Reads | No unheld total published as data; fresh load/refresh matches owner at controlled state/time; once behavior correct online and offline | No extra client or polling loop to repair Insights or live media |
| Scale | Required population reachable, ordering/authorization/cursors correct, compiling shipped form within bounds | No invented merge algorithm or silent lane truncation |
| Writes | After admission, reload/retry preserves identity, order and one server effect; bounded result or truthful recoverable stop | No auxiliary client, unexplained 15-second wait or lost accepted settings |
| Cost | Combined runtime stays within 90,000 bytes; relevant loop and package checks recorded | Usability improvements do not silently consume an enlarged budget |

Record correction loops attributable to these failures and time to the first
working form. Holistic query/live, client and offline scores are secondary,
descriptive outcomes. Mechanical success with flat scores means the causal bet
needs reassessment; score improvement with wrong data fails the program.

## Remaining decisions

Exact final-time digest eligibility remains unmet, including deletion,
membership and expiry changes after accumulation. The bounded scale lane
records that gap; it does not satisfy the original complete-digest outcome.
The other source corrections pass the complete suite, and both independent
code reviewers return READY on `cee80bc1d`. Final package qualification,
publication and the separately frozen fresh Clique wave remain distinct work;
no score target, forced refusal or enlarged ceiling substitutes for them.

[Review and dispositions](./reviews/1023-clique-builder-jump.gpt.md).

## Panel selection — 2026-09-12

Astra, Grok 4.6, Muse Spark 1.3 and Gemini 3.1 Pro independently returned
DIRECTIONALLY READY and, after reading the peer findings and dispositions,
PROCEED. Codex selected implementation under the user's explicit delegation.
The children incorporate final-emission authorization, displayed refresh
completion and the durable-restoration/refused-wait probes. Deferred research
remains outside this commission; a documented capability gap is not success.

Actual reviews: [Astra](./reviews/1023-clique-builder-jump.astra.md),
[Grok](./reviews/1023-clique-builder-jump.grok.md),
[Muse](./reviews/1023-clique-builder-jump.muse.md),
[Gemini](./reviews/1023-clique-builder-jump.gemini.md).

The panel was initially given an incorrect interpretation of the working-set
cap. `rules/RULES.md` applies its 59-link budget here. Archive the current link
for [implemented LLP 1021](./1021-effects-in-the-loop.rfc.md); its document and
implementation evidence remain in place. This funds the existing 1023 draft
links becoming tracked without removing active work. After current main added
LLP 1024, archive the completed web child 1023.002; its parent retains the
publication and fresh-wave work. This keeps the declared working set at 59.


## Integration evidence in progress — 2026-09-12

The three source lanes were integrated with main's concurrent hardening at
`a41a132f82`; the later main merge `89b705dbb2` adds the global-search pager
and recipe, compact heads for all 1,000 follows, and phased schedules.
Main `3994fc112e` adds CLI recovery, explicit schedule phase, mutation-target
flow and the already-published 0.0.27 release. Main `4a4249f7cc` subsequently
adds Quarry first-use guidance and reserves 0.0.28 for a separate release.
This program therefore uses **0.0.29**. The guide merge retains both the full
hub forms and the typed global-pager operations; the latter remain an interim
composition with a request count proportional to membership.
Guide integration preserves the public global pager and its measured cost,
while teaching the distinct grouped-search form for Clique.
Integration preserves the full-media 500-follow fixture, ten-row grouped
search and five-row rich history. These source forms do not establish digest
final-emission eligibility.

The dedicated byte lane measured **89,986 → 89,843 gzip bytes**, a **143-byte
reduction**, using Node 24.18.0, esbuild 0.25.9, gzip -9 and the same five roots.
It consolidates typed interval comparison/traversal and evaluator write-row
bookkeeping; affected behavior checks pass. The result remains **9,843 bytes
over the 80,000 target**. An independent second look found no safe multi-kilobyte
cleanup: Unicode data is already compressed, and authority, coverage and
identity validation have distinct responsibilities. No required bytes were
relocated and no ceiling changed.

Metafile contributions are uncompressed emitted bytes, not additive gzip
savings. The largest baseline contributions were the range store (28,141),
evaluator runner (27,987), offline runtime (23,641), Unicode data (17,186), and
value runtime (13,006). `client.ts` does not participate in the fixed five roots;
public-entry sizes remain separate. The `cee80bc1d` guide was
**98,073 / 98,304 bytes**; after integrating main's Quarry guidance and restoring
the complete typed pager operations it builds at **98,178 / 98,304 bytes**.

The timed Insights consumer passes in **3.29 seconds** against the integrated
owner's current authentication rules. Its controlled UTC rollover stays inside
a fresh bearer session; after owner restart it restores the process-local
development clock before reconnecting. The earlier whole-day jump expired the
bearer, and the first restart moved time behind session creation. Those
refusals were correct; only the test clock changed, with no new refresh API.
The consumer covers equal-sequence day changes, delayed/overlapping results,
successor adoption, cancellation, account change, and warm/cold offline absence.

The real Chromium web matrix is complete for its scoped one-profile,
IndexedDB/bearer cases: SDK and physical offline cuts, route unmount, provider
teardown, browser process close/reopen, two ordered intents, and response-loss
retry preserve the stated admission and settlement contracts. Configured
durable clients refuse truthfully before principal restoration instead of
bypassing the carrier. A post-admission refused wait retains original work
identity. Sol's material cleanup finding is repaired in `f65f1e463b`, with
209 affected tests passing; the owner-stop race is repaired in `906672`.
These results do not close the separate full-acquisition objective.

Full-media following, grouped hub search and rich thread pagination execute
within existing bounds. The retained digest counterexample reaches done but
keeps 500 accumulated contributions after a contributing post is deleted and
the owner restarts. Phased scheduling alone does not prove final-time
eligibility. This requirement remains unmet and unclaimed.

Strict Chromium qualification passes all 13 controls on `ade4081550`,
including principal-specific consumed aliases, next-sequence publication,
mounted allowance, other-principal access and cold persisted denial. The
stock React/Expo templates now retain the opened descriptor and message ID
through nullable publication without retaining the full row. Restored hub
author rules have author/foreign edit and paired post/head deletion controls.
The outbox tests distinguish prepared admission bytes from the carrier's FIFO
order. The final full suite below passes; earlier failures remain recorded.
Both [Sol](./reviews/1023-clique-builder-jump.code-sol.md) and
[Grok](./reviews/1023-clique-builder-jump.code-grok.md) return READY in round 3.

Darwin 0.0.28 staging passed on `cee80bc1d` in 165.43 seconds, with production
Hermes/media and the installed todo/chat consumers. That is retained evidence,
not the release artifact: a concurrent release reserved that version. Final
0.0.29 platform qualification and publication remain pending. The prepared
fresh diagnostic packet on EPYC has not launched (estimated run: 7–12 hours),
so there is no fresh independently graded M1–M8 claim. Passing source checks
or an earlier native stage does not establish that result.


### Final combined qualification and measurement — 2026-09-12

The unmodified blocking script passes on cee80bc1d in 59 seconds: 1,450 package,
314 compiler and 1,198 native tests, both 266-case evaluator runs (27 server-only
cases), and doctests. The preceding five combined-run failures were introduced
guide-fixture and template-contract checks; their repairs passed affected checks
before this complete rerun. Source was clean before measurement.

The unchanged measure.mjs --check exits 1 on all four historical +1% byte
comparisons. Its last accepted comparable baseline is bf650aebb, measured
2026-09-09T18:12:53.625Z with Node 24.18.0, esbuild 0.25.9 and gzip level 9:

| Packaged closure | Accepted baseline | Current cee80bc1d |
|---|---:|---:|
| client | 136,547 | 142,989 |
| React | 146,166 | 152,942 |
| Expo | 149,836 | 156,395 |
| five-root runtime | 84,580 | 89,843 |

These four failures already exist in the starting fadda tree's comparable
900bbd9a90 record and in imported main 3994fc112e/e4a85. Both imported main
snapshots carry the successful-measurement 13dc20058d row, dated
2026-09-12T03:14:42.652Z, at 143,053 / 152,966 / 156,459 / 89,981 bytes with
byte_baseline_accepted=false. Current closures are smaller by 64 / 24 / 64 /
138 bytes respectively. This establishes inherited comparison failures, not
zero byte growth from every individual change. The historical measurement
remains failed; the baseline is neither accepted nor reset. The fixed 90,000
runtime ceiling passes, while the 80,000 target remains unmet.

Every timed check passes: warm release build 90s, incremental rebuild 3.06s,
development consumer (effects off) 23.32s, project check 0.896s, doctor
0.036/0.035s, and init-to-dev 1.615s. One loop row and one twin row are appended;
all prior records remain byte-for-byte unchanged and the new loop row keeps
byte_baseline_accepted=false. Full output and process evidence are retained on
EPYC under /home/ccheever/snapback-1023-20260912/qualification-complete/.
