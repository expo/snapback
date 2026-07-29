# LLP 0102 independent subjective-rating audit

**Evidence snapshot:** `d0ffb84263958307c2bda23e6d8b84010c80a054`

**Reviewer:** Anthropic Claude Opus 4.6 through OpenCode 1.14.40 (`opencode/claude-opus-4-6`, high, plan/read-only)

**Session:** `ses_051e3ccb1ffeXMIVdM3zpHkBHC`

**Session snapshot:** `1e1bf551ccfb39963a496bab4cff6092e668d30e`

**Raw rating response SHA-256:** `e9daf7e9ea2c4509f3f8a1399c4772f6326977ba3eb34ffe3b8d1450d20b7542`

**Cost recorded by the review channel:** USD 1.39055850

**Prompt SHA-256:** `dffa60a7b719b41d05564823998144cfd08983cc8e17d90500d9d071b74ff9bd`

**Output-schema SHA-256:** `85b0cef617d960a1013041031d63e7c2062365b536d67b00cab3860243ac51e1`

## Channel and independence

The first intended channel was Claude CLI 2.1.220 with Opus and high
reasoning. Its first invocation rejected the schema draft URI before a model
call; the schema-free retry then failed because the configured OAuth token had
expired. It consumed no model tokens and produced no ratings.

The retained review used a fresh OpenCode session with an Anthropic model
family distinct from the GPT/Codex builders. The final builder rating matrix
did not exist and was not shown to this reviewer. The reviewer was read-only
and changed no files.

There is one independence limitation: the frozen calibration and deep reports
are evidence-bearing reports but contain earlier provisional narrative and
aggregate scores. The reviewer explicitly referred to those provisional
calibration values in its closing summary. Therefore this is independent from
the final 35-arm builder matrix, but not perfectly unanchored from every prior
subjective signal. Confidence is lowered accordingly; the disagreement set is
retained instead of presenting the reviewer as a blind ground truth.

## Output retention

The reviewer inspected the LLP, frozen scoring rules, all five diaries, round
reports, selected capsules, remediation evidence, package confirmation, and
current Firebase and Supabase refreshes. It produced all 350 integer category
ratings, evidence lists, rationales, the Convex Research Room provider Stop,
warnings, and recommendations.

The response used a nonconforming envelope despite the requested schema:
category fields were flattened, `researchRoom` used camel case, and warnings
were objects. The coordinator performed a mechanical semantic normalization
and compressed some rationales/evidence lists. No numeric rating, Stop, or
recommendation was changed. The normalized
[`independent-ratings.v1.json`](./independent-ratings.v1.json) passes the
frozen Draft 2020 schema. The raw response remains addressable by the session
ID and hash above.

## Reviewer result

Applying the frozen weights to the reviewer matrix yields:

| Rank | Provider | Composite | Caveat |
| ---: | --- | ---: | --- |
| 1 | Supabase | 78.80 | Practical tie with Firebase |
| 2 | Firebase | 78.40 | Reviewer's narrative overall go-to |
| 3 | Convex | 74.84 | Research Room provider Stop remains |
| 4 | SpacetimeDB | 66.92 |  |
| 5 | InstantDB | 63.40 | Practical tie with Appwrite |
| 6 | Appwrite | 61.12 |  |
| 7 | Snapback | 55.48 |  |

The reviewer chose Firebase overall within the 0.40-point practical tie,
InstantDB for Todo, Firebase for Chat and Partiful, and Supabase for Linear and
Research Room.

## Builder comparison

The coordinator created
[`final-ratings.v1.json`](./final-ratings.v1.json) only after the reviewer
finished. Across 350 category cells:

- 248 agree exactly;
- 102 differ by one or more points;
- 9 differ by two points;
- none differ by more than two points.

The nine two-point disagreements are:

| Provider/app/category | Builder | Reviewer | Adjudication |
| --- | ---: | ---: | --- |
| Snapback Todo correctness | 5 | 3 | Builder emphasizes direct final authority/conflict proof; reviewer retains maturity discount from the repaired revocation failure. Both retained. |
| Snapback Chat correctness | 5 | 3 | Same distinction: terminal correctness versus confidence shaped by the original defect. |
| Snapback Linear realtime/offline | 3 | 1 | Builder credits strong online realtime; reviewer treats the central offline GAP as dominant. |
| Snapback Linear auth | 5 | 3 | Builder credits direct scoped-role evidence; reviewer prices setup and product maturity. |
| Snapback Linear performance/cost | 4 | 2 | Builder credits within-arm samples; reviewer discounts cross-machine comparability and write latency. |
| Snapback Research Room auth | 5 | 3 | Builder credits direct outsider/collaborator authority; reviewer retains sessions-composition maturity cost. |
| Convex Research Room correctness | 2 | 4 | Builder applies the provider Stop directly to correctness; reviewer keeps functional correctness high and applies the Stop to operations/maturity. The Stop itself is identical and controlling. |
| InstantDB Partiful realtime/offline | 4 | 2 | Builder credits live transport; reviewer emphasizes stale protected state after permission transition. |
| Appwrite Partiful realtime/offline | 4 | 2 | Builder credits completed live scenarios; reviewer emphasizes sequential subscription and observability friction. |

The main category-level pattern is that the builder scores demonstrated
realtime and within-arm performance more generously, while the reviewer gives
Snapback a larger maturity discount and separates Convex's provider Stop from
its otherwise strong functional correctness.

## Central adjudication

No cell was forced to consensus. The frozen builder matrix drives the official
composite, as LLP 0102 defines the score as the builder's go-to judgment. The
review is a bias check:

- both matrices put Supabase and Firebase first and second within a practical
  tie;
- both put Convex third and preserve its Research Room Stop;
- both order SpacetimeDB fourth and Snapback seventh;
- both identify Firebase's offline breadth, Supabase's relational/search
  strength, and Convex's authoring coherence;
- the reviewer's Firebase narrative preference is retained beside the
  builder's 0.44-point Supabase lead.

This convergence supports the tier-level result. The large number of
one-point differences and the partial anchoring limitation argue against
pretending the decimals are more precise than they are.
