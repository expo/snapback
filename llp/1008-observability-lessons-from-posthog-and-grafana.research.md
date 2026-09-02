# LLP 1008: What PostHog and Grafana learned about observability and analytics

**Type:** Research
**Status:** Draft
**Systems:** Observability, Analytics, Diagnostics, `why`/`trace`, Metering,
Pricing surface, Guide
**Author:** Claude Opus 5 (external-evidence synthesis), commissioned by
Charlie Cheever 2026-09-01 in session
**Date:** 2026-09-01
**Revised:** 2026-09-01 (initial synthesis)
**Related:** LLP 1000 (the root), LLP 1002 §8 (`why`, `trace`, `guide`),
LLP 1005 (the same shape of document, for assets), LLP 1007 (the state of the
work), `rules/RULES.md`, `rules/NOT-DOING.md`

## Summary

Two incumbents own the ground Snapback 2 would enter. PostHog owns
product analytics for engineers; Grafana owns infrastructure dashboards. Both
are well liked. Both are, by their own users' accounts and in one case by their
own published research, failing at the same three things — and the three
failures are the same three failures, in different clothing:

1. **Both sell "collect everything" and leave relevance to the customer.**
   PostHog's autocapture and Grafana's forty-panel dashboard are one mistake:
   capture is cheap, relevance is expensive, and neither product owns relevance.
2. **Both require the operator to hand-build the meaning**, in event names or in
   PromQL, and that artifact silently rots the moment the code changes.
3. **Both answer aggregate questions well and causal questions badly.** They
   report *that* p99 rose. Neither says *why this request did this thing.*

The third is measurable and large: Grafana Labs' own 2026 survey finds alert
fatigue is the single biggest obstacle to faster incident response at 30%,
roughly double the next answer. That is failure 3 with a number on it — forty
panels go red and a human decides which one is the cause, in their head.

The reason this is worth a document rather than a link: **Snapback 2 already
owns the thing both incumbents lack.** LLP 1002 §8 specifies `why` — re-run the
read, report per-row rule verdicts and the rule inputs touched — and `trace` —
intent → commit → invalidation → delivery, from the owner's bounded ledger,
explicitly refusing to reconstruct from program syntax or current state. That
is a causal answer produced by owning the runtime. Neither PostHog nor Grafana
can build it, because neither owns the program.

This is a Research document. It proposes no Snapback 2 surface and binds
nothing. §7 is the input to whoever writes the observability RFC; the strong
recommendation there is that most of this is `NOT-DOING.md` material for now,
and §8 says why.

## 1. Where the evidence is, and how much to trust it

| Source | What it is | How much to trust it |
| --- | --- | --- |
| Grafana Labs 4th Annual Observability Survey (2026) | Large-n practitioner survey with well-posed questions | High on the pain questions, self-interested on the "open source wins" framing. Note that a Grafana survey undersamples people who left Grafana. |
| Hacker News threads on PostHog (40564345, 29914699) | Practitioners arguing with each other | High signal, selection-biased hard toward self-hosters. The self-hosting anger below is real but over-weighted relative to the paying population. |
| PostHog handbook, "risk mitigation and churn prevention"; "why we rebuilt our data warehouse" | The vendor naming its own churn causes | Unusually candid. Sales-framed, so read the *problems* and discount the *responses*. |
| G2 / Gartner / Product Hunt aggregate reviews | Rated review corpora | Low-to-medium. Directionally useful only where several sources agree. |
| The `*-alternatives` blog tier (userpilot, middleware, openobserve, motadata) | SEO content | Near zero. Almost all of it is written by competitors. Used here only to corroborate. |

Two words of caution on the whole corpus. First, complaint volume measures
*surface area times adoption*, not badness — PostHog is criticised for having
seven products because it has seven products, and a one-product competitor
escapes the criticism by being less useful. Second, nobody writes a review of
the thing that worked, so the "liked most" column is systematically thinner and
less specific than the "hated most" column across every source here.

## 2. PostHog: what is actually used

The gravitational centre is **product analytics + session replay + feature
flags**, in that order. The load-bearing fact is that this is *not* because any
one of them is best in class. It is because they share one event stream and one
person/group identity, so a single investigation — weak onboarding step in a
funnel → watch those users' sessions → see the errors they hit → ship a fix
behind a flag → measure it — runs without rebuilding the audience four times in
four tools.

That shared context is the product. Surveys, error tracking, logs, the
warehouse, AI analysis, workflows are all downstream and adopted far more
thinly.

**Autocapture** earns its own line, because it is both the biggest reason
PostHog is adopted fast and one of the biggest reasons it later hurts (§3.3).

## 3. PostHog: what is liked, and what is hated

### 3.1 Liked

- **Time-to-first-insight is near zero.** Snippet in, funnels and replays out.
  No taxonomy meeting, no tracking plan, no data hire.
- **An order of magnitude cheaper than Amplitude/Mixpanel** at small and mid
  scale. This is probably the single largest acquisition driver.
- **One tool instead of six.** Teams genuinely resent stitching GA + Amplitude +
  LogRocket + LaunchDarkly + a survey tool + Sentry.
- **Built for engineers.** SDK-first, code-first, no sales call to get value.

### 3.2 Hated, in rough order of heat

1. **Unpredictable pricing, and the failure mode is a surprise bill.** Seven-plus
   separate meters — analytics, replay, flags, experiments, surveys, error
   tracking, warehouse. Enabling replay "to see what it's like" and finding out
   next month is a recurring story. PostHog's own churn handbook concedes that
   customers self-serve, implement it wrong, and get "inflated bills, inaccurate
   data, or features that don't work as expected," and classifies the resulting
   churn as *avoidable*.
2. **Learning curve and UI overwhelm.** The most-cited complaint across the
   review corpora. It compounds: each additional product adds surface, and
   navigation degrades as adoption widens.
3. **Autocapture's hangover.** It captures far more than is needed — repeated
   interactions, noisy properties, events that inflate volume without answering
   a question. The mechanism that made onboarding free makes the bill and the
   UI expensive later, and nobody ever goes back and prunes it.
4. **Query performance at volume.** Predictable for an event store; still what
   people notice and mention.
5. **Open source in name, hostile to self-hosting in practice.** The angriest
   category by a distance. Helm chart and versioned releases dropped; the docs
   effectively warn against production use. From HN: *"if you can't stand behind
   your open-source version at all, I don't trust your commercial version
   either."* Another commenter calls it a bait-and-switch. The self-hosted stack
   was ClickHouse + Kafka + Zookeeper — "some of the most complicated software
   you can run on Kubernetes."
6. **It degrades into middleware at roughly 30–50 people.** PostHog's own
   strategy documents describe the pattern: the company hires a data engineer,
   the data engineer cannot do what they need inside PostHog, and starts
   exporting to a real warehouse. Events in, data out; the centre of gravity for
   understanding the business moves elsewhere. PostHog rebuilt their warehouse
   on DuckDB specifically to fight this.
7. **No data-lifecycle controls**, notably automatic deletion after N days. A
   named blocker for privacy-sensitive buyers.

## 4. Grafana: what is used, liked, and hated

### 4.1 Used

**Dashboards over Prometheus**, overwhelmingly, plus alerting. The 2026 survey
has 77% invested in Prometheus and 76% in OpenTelemetry — and 65% in *both*,
which is the real state of the world: two overlapping standards, both operated.
OTel signal split is 57% metrics, 50% traces, 48% logs.

One finding matters more than it looks: **50% now track business metrics**
(revenue, compliance, security) in the same place as infrastructure metrics, and
46% run unified infrastructure and application observability. The line between
"observability" and "analytics" — the line this document was commissioned to
sit astride — is already gone in practice.

### 4.2 Liked

- **Data-source agnosticism.** Prometheus, Elasticsearch, Postgres, CloudWatch,
  anything. It is the universal front end and nothing else really is.
- **The panel editor.** Fast, direct, good-looking output. The feature people
  praise by name.
- **Open source, credibly.** The axis on which Grafana beats PostHog's
  reputation outright.

### 4.3 Hated

1. **Alert fatigue — 30%, the single biggest obstacle to faster incident
   response, roughly double the next answer**, and consistent across roles.
2. **Complexity and overhead — 38%**, the top-ranked concern overall, ahead of
   signal-to-noise (34%) and cost (31%). "The biggest benefit is the biggest
   drawback: there is an enormous amount you can configure."
3. **Three query languages.** PromQL *and* LogQL *and* TraceQL, each a separate
   mental model, plus operating Prometheus, Loki and Tempo separately.
4. **Dashboards-as-code is bad.** Dashboards are large JSON blobs that are
   miserable to review or diff; Terraform helps at scale but is painful to
   author; Grafonnet helps but costs you Jsonnet. Everyone wants dashboards in
   git and almost nobody likes how they get there.
5. **Dashboard sprawl.** "Tricky unless you're very organised from the start,"
   and nobody is.
6. **Alerting has sharp edges** — alerts do not compose with template variables,
   so panels get duplicated purely to alert on them; the legacy → unified
   alerting migration was genuinely painful at scale.
7. **Grafana stores nothing.** Every real deployment is a five-component stack
   the customer operates.

### 4.4 What the market says it wants next

- **Cost is the #1 tool-selection criterion at 65%**; ease of use is #2 at 49%.
  Not features, not depth.
- **77% report saving time or money by centralising.** Consolidation wins;
  fragmenting loses.
- **AI: 92% see value in anomaly detection and 77% would accept autonomous
  action, but 95% require the system to explain its reasoning**, and the
  top-ranked AI complaint is "too much manual input of required context." Read
  that as: the system should already know what it did — do not make me
  re-explain my own architecture to it.

## 5. The three failures, restated

Everything in §3 and §4 collapses into three sentences.

**Relevance is unowned.** Cost complaints, slow-query complaints, alert-fatigue
complaints and UI-overwhelm complaints are one complaint wearing four hats:
nobody separated signal from exhaust, so the customer must.

**Meaning is hand-built and rots silently.** Grafana knows nothing about your
system; you encode your understanding into panels and PromQL. PostHog knows
nothing about your product; you encode it into event names and funnel
definitions. Both artifacts decouple from the code the moment the code changes,
with no error, and a dashboard can lie for months before anyone notices.

**Causation is left to the human.** Correlation is displayed; causation is
performed by an on-call engineer at 3am. The 30% alert-fatigue number is exactly
the cost of that hand-off.

## 6. What Snapback 2 already has that neither can build

The store, the rules, the ops, the personas and the commit ledger are
first-class and typed. That makes two of the three failures structurally
avoidable rather than merely improvable:

| Failure | Why Snapback 2 escapes it, if it chooses to |
| --- | --- |
| Meaning is hand-built and rots | Ops, rules, tables and channels are already declared. Anything derived from them is named after the code, so a rename is a compile error rather than a dashboard that quietly lies. |
| Causation is left to the human | `why` (LLP 1002 §8) reports per-row rule verdicts and the rule inputs touched. `trace` walks intent → commit → invalidation → delivery from the bounded per-commit ledger, and refuses to reconstruct from syntax or current state (review rulings 2026-08-30). Echo-vs-cause is recorded, not inferred. |

Relevance-is-unowned is *not* structurally solved; it is a design choice
Snapback 2 would have to make deliberately, and §7 treats it as the main risk
rather than the main opportunity.

## 7. Inputs to whoever writes the spec

Not recommendations to implement. Inputs, ordered by how much the evidence
supports them.

1. **The differentiated product is `why` at scale, not dashboards.** "Why did
   this user see this?", "why was this write refused?", "why is this slow?",
   answered from the ledger with rule-level attribution. 30% of the surveyed
   market is saying the panel editor is the problem; a fourth panel editor is
   not a product.
2. **Derive instrumentation; never ask for it.** Latency, error rate, refusal
   reasons, rule-verdict distributions and subscription fan-out per op should
   exist with no `track()` call, named after the op. This is the one thing
   neither incumbent can do.
3. **Show the bill before the bill.** The op set and rule set are static.
   Telling someone what a workload will cost *before* they enable it attacks
   PostHog's loudest complaint at its root cause, which is that the volume knob
   sits downstream of a decision made months earlier.
4. **Do echo-triage in the product.** The ledger records what invalidated what.
   "These 39 are echoes of this 1" is the largest unclaimed territory in the
   space, and it is a read over data Snapback 2 already keeps.
5. **One meter, or as close as reachable.** Seven meters produced both the bill
   shock and the UI sprawl.
6. **Retention and deletion as a declarable, first-class thing.** Still missing
   from PostHog; named as a blocker by real buyers.
7. **If AI analysis ever ships, it explains itself and is fed context
   automatically.** `guide app` — tables, rules, ops with bounds, channels,
   personas — already *is* the context those 95% are complaining about
   hand-feeding.
8. **Do not ship a query language.** Grafana users are drowning in three.
   Answers should return in ops, rules, personas and commits — the nouns the
   author already wrote.

## 8. What this document does not say

It does not say to build an observability product. `rules/NOT-DOING.md` sets the
bar — a fresh agent builds Clique M1–M3 on the published `snapback2` in under
1,200 s with at most one Snapback-attributed correction loop — and *nothing in
§7 is required by that bar.* On the evidence here, the correct near-term action
is almost certainly to write most of §7 onto `NOT-DOING.md` and keep only what
`why` and `trace` already specify.

Three further guards against over-reading this document:

- **Both incumbents are at a scale Snapback 2 is not.** Alert fatigue at 30% is
  a fact about organisations running hundreds of services. An app built by one
  agent in 1,200 s does not have forty panels to go red. Most of §7 is a
  description of a problem Snapback 2 does not yet have, and building for it now
  would be building apparatus ahead of need — the specific failure
  `NOT-DOING.md` exists to prevent.
- **The complaints are about products with paying customers.** Snapback 2 has
  the luxury of reading them as design constraints instead of incidents, and the
  cheapest form of acting on them is refusing to create the conditions — which
  costs nothing and ships nothing.
- **§6's advantage is durable and does not decay if unused.** It comes from
  owning the runtime. It will still be available when the bar is met. There is
  no first-mover argument for spending the surface now.

The one thing that is *not* free to defer is the shape of what the ledger and
the certificate record. Anything §7 might later want must be derivable from
what is being written today, and that is a question for the RFC, not this
document.

## Sources

- Grafana Labs 4th Annual Observability Survey, 2026 —
  <https://grafana.com/observability-survey/> and the accompanying release
  <https://grafana.com/press/2026/03/18/grafana-labs-4th-annual-observability-survey-reveals-a-field-at-a-crossroads-ai-economics-complexity-and-the-enduring-power-of-open-source/>
- Hacker News, "PostHog – open-source analytics and UX research tool" —
  <https://news.ycombinator.com/item?id=40564345>
- Hacker News, on PostHog's ClickHouse/Kafka/Zookeeper stack —
  <https://news.ycombinator.com/item?id=29914699>
- PostHog handbook, risk mitigation and churn prevention —
  <https://posthog.com/handbook/growth/sales/risk-mitigation-and-churn-prevention>
- PostHog, why we rebuilt our data warehouse —
  <https://posthog.com/blog/why-we-rebuilt-our-data-warehouse>
- PostHog self-host documentation — <https://posthog.com/docs/self-host>
- "I spent 12 hours debugging PostHog self-hosting" —
  <https://dev.to/ismailmirza/i-spent-12-hours-debugging-posthog-self-hosting-so-you-dont-have-to-pb0>
- PostHog reviews and pros/cons, G2 —
  <https://www.g2.com/products/posthog/reviews?qs=pros-and-cons>
- PostHog autocapture, what it tracks and costs —
  <https://userpilot.com/blog/posthog-autocapture/>
- Grafana Cloud reviews, Gartner Peer Insights —
  <https://www.gartner.com/reviews/product/grafana-cloud>
- Grafana community forums, legacy → unified alerting migration —
  <https://community.grafana.com/t/migration-grafana-legacy-alerts-to-new-unified-version/74138>
- Grafana documentation, provisioning dashboards as code —
  <https://grafana.com/docs/grafana/latest/as-code/infrastructure-as-code/>
- "The true cost of observability tool sprawl", 2026 —
  <https://oneuptime.com/blog/post/2026-02-28-true-cost-of-observability-tool-sprawl/view>
