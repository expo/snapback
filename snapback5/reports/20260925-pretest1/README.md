# Pre-test 1 ran: both families, resolutions, and the registered stop

2026-09-25. **The registered stop fires in both families, on all three
predicates. LLP 4001 is Shelved at §9 step 4.** This is the compiler-free
compatibility/rewrite-cost replay registered in
[LLP 4001 §7](../../../llp/4001-snapback5-sql-front-end.rfc.md#7-pre-tests-compiler-free-before-any-lane),
not a compiler execution, runtime comparison, or superiority claim.

## Instrument and provenance

The rubric is §7 at `da443e4d44`, SHA-256
`ed4b3f6136e8049d7132c11838a539caffa530aacecb6034d03bb9cfdc1fa7b5`.
The [freeze](freeze.json) records all nine original SQL hashes and line
counts. The [builder receipt](builder/freeze-hashes.json) and
[blind receipt](blind/verified-hashes.json) match every one of those nine
hashes and the rubric hash. This recording pass also rehashed the original
local corpus and rubric, checked the line counts, checked the complete RFC
hash against the builder receipt, and verified the rubric occurs verbatim
in that frozen RFC. [Comparison receipt](comparison/receipt.json).

| Family | Parser and independent record |
| --- | --- |
| Builder: Astra, gpt-6-astra xhigh | pglast 7.10 / PostgreSQL 17.4 grammar; [units](builder/units.jsonl), [summary](builder/summary.md), [interpretation](builder/interpretation.md) |
| Blind third family: Grok 4.7 xhigh | pglast 6.2 / libpg_query 16.1; [units](blind/units.jsonl), [summary](blind/summary.md), [full supplied transcript](blind/grok.md), [brief](blind/brief.md) |

Both counted by Postgres AST under the frozen counting rule, not by
semicolon splitting. The freeze did not pin a parser build; these are not
identical parser versions. All frozen statements parsed. For Muse, the
blind family substituted `{{P}}` → `ns_`; the builder used `clqfm_`.
Both hashed the original bytes first. This is the source's template
preparation, **not a classification or a rewrite credit**. The blind receipt
uses the UTC date 2026-09-26; the run folder and local record use 2026-09-25.

The builder was originally committed as `5e089fe559`; the requested fetch
and conflict-free rebase onto `71f77c16ca` replayed it as `c7fc2d8d42`.
No family classification was edited. The supplied draft already exposed
builder rates and the requested outcome; the recorder does not claim to
have been blind to those. The blind family reports it did not access the
builder result. The rules below were fixed before this pass read the blind
rate table or computed joined totals.

## Ambiguities resolved before the comparison totals

The [resolution rules](resolutions.md), SHA-256
`288f3ae3d8ebfa71611801434755ef2fbc77b6ddc00ad56080618191f1360969`,
cover **all 27 builder readings** indexed in
[ambiguities.md](builder/ambiguities.md) and **all 25 blind ambiguity
texts**, labeled B01–B25 in their summary order. The blind summary's
“3678 units” is a reporting bug: its generator sums the lengths of the
25 text keys, instead of the lengths of their unit-id lists. The actual
ledger has **327 units** bearing those 25 texts. The original is preserved.

Every ruling's effect on both inventories is accounted for in
[resolution-effects.md](comparison/resolution-effects.md); rulings not
listed in that delta table change zero class/raw counts in either family.
[comparison.json](comparison/comparison.json) gives every changed unit id,
old/new class, raw flag, and the applicable ruling. These are recorder
overlays, not revised independent reviews.

The material applications are finite PRIMARY KEY/id/reference spellings;
identity-path rather than family-wide UUID exclusion; admitted exact
probe inlining charged as work; explicit local null narrowing; no inherited
signature refusal on otherwise legal body primitives; required IN lists;
bounded/planned reads; and preserving expiry behavior beyond one SELECT
policy. pgcrypto is ignored dependency boilerplate in this manifest.
The ALTER DROP/ADD enum pair is judged by its **final catalog**, as §7
requires, not ignored as migration boilerplate. CREATE OR REPLACE is
canonicalized on the signature. A-COUNTER-SCOPE is resolved in favor of the
manifested Astra insert/delete writers after initialization.

Net effects on the native headline counts:

| Family | Δ top post / raw | Δ body post / raw | Other effects |
| --- | ---: | ---: | --- |
| Builder | 0 / 0 | 0 / 0 | 28 no-action reference constraint children become refused under B04; one signature admitted → canonicalized under B22; neither changes a parent refusal |
| Blind | +9 / −6 | −17 / −23 | Exact per-reading deltas and parent propagation are in the linked table; one more ignored top-level unit; native denominators unchanged |

**No resolution moves a stop predicate or an idiom answer.** Independent
local classification differences remain published; resolving the recorded
rubric choices does not assert identical semantic analysis by the families.

## Join and denominator reconciliation

Ids are `file:top-index[:child-index]`, but the builder is **one-based** and
the blind family **zero-based**. Blind ids must not be joined literally.
First pair each file's top-level statements with the one-index offset and
verify their statement content. Then reconstruct each child's statement
text/AST from the same hashed source using the committed enumeration rules,
normalize only the Muse prefix and parser locations, and match normalized
AST content within the parent, preserving occurrence order for identical
statements. Signature and body kinds are checked independently. No fuzzy
text match is used. The reconstruction uses pglast 7.10; it verifies all
original blind id/kind slots, and does not pretend to rerun the 16.1
classifier or replace its decisions.

[pairs.jsonl](comparison/pairs.jsonl) retains every matched id, source
text/AST, original classes and rationales, and resolved classes.
[Every disagreement](comparison/disagreements.md) is also listed in a
readable table with both classes and the rubric reading each family applied.
These appendices are part of this comparison.

| Tier | Builder units | Blind units | Comparable units/bundles | Original class agreement | Original disagreements | Disagreements after resolution |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Top-level | 354 | 354 | 354 | 334 (94.35%) | **20** | 1 |
| Bodies, including SQL/DO | 364 (333 routine PL/pgSQL + 18 SQL + 13 DO) | 354 (327 + 18 + 9) | 354 | 299 (84.46%) | **55** | 29 |
| Signatures | 37 | 37 | 37 | 33 (89.19%) | **4** | 0 |
| Column/constraint children | 989 | 548 | 546 bundles covering all 989 builder children | 394 (72.16%) | **152** | 0 |

Body reconciliation is exactly `333 + 18 + 13 − 10 = 354`: six
routine and four DO parser-inserted empty RETURN nodes are absent from the
blind ledger. ELSIF is a branch wrapper; its condition belongs to its IF.
The ten unmatched builder ids are in the receipt. All authored body units
match; none is silently discarded.

For table children, the blind family kept NOT NULL/NULL/DEFAULT on the
column. Aggregate each builder column with its attached attribute nodes
using §7's worst-class order for comparison only. This folds **443**
builder nodes into the 546 bundles; it does not add them to any rate.
The blind family additionally counted two ALTER-default children,
`astra-supabase/schema.sql:49:0` and `:69:0`, whose top-level statements
match builder `:50` and `:70`. Both are refused in the blind ledger;
the builder classifies that same final-catalog change only at the top level.
These are inventory differences, not two invented class disagreements.

## Unblinded totals

The original submissions are retained beside the resolved results. “Body”
in this table is each family's native headline denominator: builder routine
PL/pgSQL, blind all authored routine/SQL/DO bodies. Read the common-scope
sensitivities below before comparing the percentages.

| Record / family | Top post-rewrite | Body post-rewrite | Raw top | Raw body |
| --- | ---: | ---: | ---: | ---: |
| Original builder | 152/354 (42.94%) | 201/333 (60.36%) | 191/354 (53.95%) | 210/333 (63.06%) |
| Original blind | 143/354 (40.40%) | 242/354 (68.36%) | 198/354 (55.93%) | 269/354 (75.99%) |
| **Resolved builder** | **152/354 (42.94%)** | **201/333 (60.36%)** | **191/354 (53.95%)** | **210/333 (63.06%)** |
| **Resolved blind** | **152/354 (42.94%)** | **225/354 (63.56%)** | **192/354 (54.24%)** | **246/354 (69.49%)** |

The builder distinguishes an already admitted exact probe's inlining work
from raw syntax refusal. The original blind raw tally treated every
rewritten unit as raw-refused; the resolved raw tally applies A-PROBE-CLASS
to those recognized calls/bodies while keeping UUID signatures raw-refused.
Thus “rewritten” never silently becomes “canonicalized,” and rewrite work
remains visible even when it was not a raw refusal.

| Resolved denominator sensitivity | Builder post / raw | Blind post / raw |
| --- | --- | --- |
| All top-level, including ignored boilerplate | 152/354 (42.94%) / 191/354 (53.95%) | 152/354 (42.94%) / 192/354 (54.24%) |
| Excluding ignored boilerplate | 152/287 (52.96%) / 191/287 (66.55%) | 152/287 (52.96%) / 192/287 (66.90%) |
| Routine PL/pgSQL, authored only | 201/327 (61.47%) / 210/327 (64.22%) | 201/327 (61.47%) / 222/327 (67.89%) |
| Routine PL/pgSQL plus six literal AST returns | 201/333 (60.36%) / 210/333 (63.06%) | 201/333 (60.36%) / 222/333 (66.67%); returns added as admitted counting-only sensitivity |
| All bodies, authored only | 224/354 (63.28%) / 233/354 (65.82%) | 225/354 (63.56%) / 246/354 (69.49%) |
| All bodies, literal AST including ten returns | 224/364 (61.54%) / 233/364 (64.01%) | 225/364 (61.81%) / 246/364 (67.58%); returns admitted for this sensitivity |

Neither body inventory contains ignored units, so including/excluding
ignored boilerplate leaves every body rate unchanged. Before resolution,
non-ignored top-level rates were builder 152/287 (52.96%) and blind 143/288
(49.65%). Including SQL alone or DO alone also leaves the routine rate
above one third: their resolved component refusals are builder SQL 14/18,
DO 9/13, blind SQL 15/18, DO 9/9. Every registered/named denominator reading,
before or after resolution, exceeds one third in **both** families.

## Four registered idiom rows, five concrete answers

These quotes are from the frozen source as cited in the families' linked
interpretations. B ids below are builder ids; blind top ids subtract one.
Neither signature refusals nor absent replication requirements turn the
named `is_member` behavior question into a failure.

| Instance | Builder answer and quoted evidence | Blind answer and quoted evidence | Resolved behavior question |
| --- | --- | --- | --- |
| Muse `is_member` | Yes, online-only: `where m.conversation_id = c and m.user_id = u and m.left_at is null` (`functions.sql:1`); `(conversation_id, user_id)` is the total key (`schema.sql:12`) | Yes: the same full-key probe retains `left_at is null`; §3.3 admits it but publishing gives `E_SYNC`. Originally refuses the UUID signature under its family-wide reading | **Admitted after exact inlining, online-only.** No offline requirement in this frozen source. A-PROBE-CLASS records rewrite work and A-UUID resolves the signature scope separately |
| Astra `clqfa_like_counter` | Yes under A-COUNTER-SCOPE: `like_count=like_count+1` at `NEW.post`, decrement at `OLD.post` (`schema.sql:78`), trigger `after insert or delete` (`:80`) | Yes: “No such writer appears in the frozen Astra files” for an UPDATE retarget; `snapback.count('clqfa_likes', by => 'post')` preserves the manifested insert/delete behavior | **Admitted registered rewrite**, for the initialized manifested writers. Same post-row visibility and duplicate set/delete behavior. The top-level backfill remains refused; this is not a passing whole schema or a claim about arbitrary owner updates/overflow |
| Muse `bump_counters` | No: `like_upd` permits `using (auth.uid() = user_id) with check (auth.uid() = user_id)` (`rls.sql:94`), but trigger fires only after insert/delete; retarget A→B leaves source `(1,0)` while maintained counts become `(0,1)` | No: delete uses `greatest(like_count - 1, 0)` (`functions.sql:11`), with analogous repost/reply floors | **Refused.** The floor alone is not decisive if a count is always consistent; the reachable authorized-retarget witness proves history-dependent drift and makes the no-spelling answer robust. Adding immutability changes authority |
| Muse `enforce_message_windows` | No: `edit_s := coalesce(({{P}}cfg_windows()->>'editWindowSeconds')::int, 900)` and `extract(epoch from (now() - OLD.created_at)) > edit_s` (`functions.sql:8`); direct `msg_upd` writer (`rls.sql:66`) remains uncovered | No: the same config lookup, direct sender UPDATE, and `NEW.edited := true; NEW.edited_at := now()` cannot be preserved by checks in a nonexistent edit RPC; `NEW.purged` bypass also matters | **Refused.** Fixed intervals lose runtime configuration; preserving strict OLD/NEW boundaries, purge bypass and every privileged/direct writer is required. Configured 120 seconds with an edit at 121 is a concrete default-900 rewrite failure |
| Muse `feed` | No: `stream as (select * from orig union all select * from repo)` preserves separate cards, but mutable mapped columns, arbitrary viewer/limit, and `s.sort_ts < before_ts ... s.sort_key < before_id` (`rpcs.sql:6`) fail Following/page equivalence | No: same `union all` and keyset evidence; public policies exist, but no publication/immutability, a `tab = 'global'` branch, supplied viewer and keyset continuation do not agree with Following | **Refused.** Duplicate cards alone can survive; source admission, allowed updates, ranking/continuation and current-state behavior do not. CTE removal is insufficient |

For the complete attempted rewrites, touched AST nodes and authoring
explanations, see [builder interpretation](builder/interpretation.md),
[builder rewrite-work counts](builder/summary.md), and
[blind idiom evidence](blind/summary.md#named-idiom-instances).

## Registered stop and disposition

| Predicate after resolution | Builder | Blind third family |
| --- | --- | --- |
| Top-level post refusals > one third | **True:** 152 × 3 = 456 > 354; also > 287 excluding ignored | **True:** 152 × 3 = 456 > 354; also > 287 excluding ignored |
| Executable-body post refusals > one third | **True:** 201 × 3 = 603 > 333; all common-scope alternatives above also stop | **True:** 225 × 3 = 675 > 354; narrow authored PL/pgSQL 201 × 3 = 603 > 327 also stops |
| Any named instance has no behavior-preserving admitted spelling after its registered rewrite | **True:** `bump_counters`, `enforce_message_windows`, `feed` | **True:** the same three instances |

**The registered stop fires.** Per §9 and the Non-claims, the bet stops at
step 4; pre-test 2 is not run because the three failing idioms expose the
counter, edit-window and ordered-pagination behaviors its messaging task
would exercise. No SQL card, compiler lane, fourth review round, or
calibration run is authorized by this record. Shelving preserves the
original protocol, independent evidence, reviews, verified stubs and form
table; LLP 3000.015's additions and accounting law remain Snapback 4 work.
See [LLP 4001 §13](../../../llp/4001-snapback5-sql-front-end.rfc.md#13-shelving-record).

## Reproduction and limits

From this worktree, with the builder's existing pglast 7.10 environment:

```sh
snapback5/.venv/bin/python snapback5/reports/20260925-pretest1/reconcile.py \
  --input /Users/ccheever/projects/snapback-sb5-program/pretest1 \
  --out snapback5/.work/pretest1-record
```

This verifies input hashes, unique ids, every reconstructed blind child
kind, exact normalized AST matching, and emits the comparison/overlays for
inspection. It never executes SQL or either classifier's judgments and
never edits their ledgers. All nonmatched slots are reported. The archived
comparison was produced by that command with `--out` set to `comparison/`.
The investment threshold is not a calibrated statistical falsifier, and
these data do not establish true SQL equivalence or a general verdict on
SQL authoring. No guide pages or runtime code changed.
