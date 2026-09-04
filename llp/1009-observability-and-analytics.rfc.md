# LLP 1009: Observability and analytics — the correction loop is the product

**Type:** RFC
**Status:** Shelved (author ruling 2026-09-04 — slid off the doing-list to pay
for local-first v1, LLP 1012 §13 and `rules/NOT-DOING.md` §Moves; returns when
the offline bar is met; nothing here is withdrawn). Was: Draft — proposal,
binds nothing (`rules/RULES.md`: only implemented specs bind, and a spec needs
an implementer and a date; §6 has neither yet)
**Systems:** `snapback2/crates/snapback2` (`why`, `trace`, `logs`, `data`),
`snapback2/crates/snapback2-core` (certificate, retention estimator),
`snapback2/scripts/measure.mjs`, `benchmarks/`, `rules/NOT-DOING.md`
**Author:** Claude Opus 5, commissioned by Charlie Cheever 2026-09-01 in session
**Date:** 2026-09-01
**Revised:** 2026-09-01
**Related:** **LLP 1008** (the evidence this answers), LLP 1000, LLP 1002 §8
(`why`, `trace`, `guide`), LLP 1007 (the state of the work), LLP 0329.016 §5.11
(the verb table) §8 (the bar), LLP 0329.014.004, `rules/RULES.md`,
`rules/NOT-DOING.md`

## Summary

LLP 1008 read PostHog and Grafana and found three shared failures: relevance is
unowned, meaning is hand-built and rots silently, and causation is left to the
human. It also found that Snapback 2 escapes two of the three structurally, by
owning the program.

The obvious conclusion — build the causal observability product neither
incumbent can — is wrong for now, and this RFC argues the reason is already
written down.

**The bar in `rules/NOT-DOING.md` already contains Snapback 2's entire
observability requirement, and it is one clause: *at most one
Snapback-attributed correction loop.*** When an agent's program does something
the agent did not expect, the platform gets exactly one attempt to explain it
well enough to be fixed. That is the spec. It is measurable, it is already
measured by the benchmark, and nothing else on the observability wishlist is
required by it.

**And analytics needs no surface at all**, because the premise that makes
PostHog a product is false here. Product analytics exists as a separate
industry because event data lives in a different system from application data.
In Snapback 2 it does not have to: an app's analytics is more `query` programs
over the same store, under the same rules, with the same bounds, checked by the
same certificate.

So this RFC proposes **no new verb, no new check, no new storage, and no new
file**. It proposes nine lines onto `NOT-DOING.md`, one widening of an existing
verb, one number added to a benchmark that already runs, and one invariant
written down so the cheap option stays open. §5 is the part that matters most:
what we refuse, and why refusing is the active decision rather than the passive
one.

## 1. What this RFC is counterweighted by

`rules/RULES.md` requires that moving something onto the doing-list takes
something off. This RFC is net-negative in surface:

| Change | Direction |
|---|---|
| §4.1 — nine lines onto `NOT-DOING.md` | removes nine things from the possible doing-list |
| §4.2 — `why` accepts a commit seq or a refusal, not only a query | widens an existing verb; adds no verb, so needs no LLP 0329.016 §5.11 row |
| §4.3 — correction-loop attribution recorded by the benchmark | a number in a job that already runs on a schedule; not a sixth blocking check |
| §4.4 — one invariant stated and checked once | prose plus a one-time audit; no code, no registry, no gate |

If the author judges §4.2 to be new surface rather than a widening, §7(b) names
the candidate deletion.

## 2. The finding: the bar already specifies observability

`rules/NOT-DOING.md` opens with the bar that makes the whole list derivable:

> A fresh agent, with only the installed package and the task, builds Clique
> M1–M3 (accounts, feed, realtime chat) on the **published** snapback2 in under
> 1,200 s with **at most one Snapback-attributed correction loop**, and
> `snapback2 test` proves it.

The 1,200 s is a speed budget and gets all the attention. The correction-loop
clause is an *explanation* budget and gets none, and it is strictly the harder
of the two. It says: when the platform surprises the agent, the platform has one
turn to make itself understood. A second turn is a failure attributed to us.

That is a complete observability specification for the product Snapback 2
actually is today. It has a subject (the agent, mid-build), an event (a surprise
attributable to the platform), a success condition (fixed in one turn), and it
is already the thing the benchmark scores.

Read against LLP 1008 §7, the eight "inputs to whoever writes the spec":

| LLP 1008 §7 input | Required by the bar? |
|---|---|
| 1. `why` at scale, rule-level attribution | **Yes** — this *is* the correction loop |
| 2. Derive instrumentation, never ask for it | Partly — only the parts `why` reports |
| 3. Show the bill before the bill | No (but see §4.4 — nearly free already) |
| 4. Echo-triage: "these 39 are echoes of this 1" | No — needs a scale we do not have |
| 5. One meter | No — we have no meter |
| 6. Retention and deletion as declarable | No — no production data exists yet |
| 7. AI analysis that explains itself | No |
| 8. No query language | Trivially satisfied by building nothing |

One of eight. The other seven are descriptions of problems Snapback 2 does not
have, and building for them now is the exact failure `NOT-DOING.md` exists to
prevent.

## 3. Why analytics needs no surface

PostHog is a separate product because your events are somewhere your rows are
not. Every painful thing in LLP 1008 §3 follows from that separation: you must
name events by hand because the analytics system cannot see your schema; you
must autocapture because naming by hand is too slow; autocapture then produces
exhaust nobody prunes; the exhaust is metered separately from everything else,
which produces the bill shock; and the whole apparatus drifts from the code
because nothing binds it to the code.

None of that separation exists in Snapback 2. There is one store, one owner
writing it, one authorization model on the table block, and one bounded language
that all reads go through. "How many people sent a message this week" is
answered by the program the author already writes, under the same rules, with
the same typed states, and it breaks at `check` time — not silently, months
later — if the table it reads is renamed.

That is failure 2 from LLP 1008 §5 solved by construction rather than by
feature, and it is solved *today*, with nothing built.

### 3.1 Why co-location is safe here, and exactly when it stops being

Putting analytics in the application's database is normally a bad idea, and the
usual objection — a single writer, contended — understates the problem in
Snapback 2 rather than overstating it.

`store.rs:79–108` opens the store `WAL` **and `locking_mode = EXCLUSIVE`**, and
turns the resulting lock failure into `RuntimeError::StoreOwned`. That is how
single-instance enforcement works. The consequence for this RFC is that a second
connection cannot read the store *at all*. There is no reader/writer contention
to reason about, because there is no concurrency: every read and every write in
the entire application is serialized through one connection in one process. A
long aggregate scan would not compete with user traffic. It would be
head-of-line blocking on all of it, for its full duration.

Co-location is therefore safe for exactly one reason: **the certificate refuses
the query shape that would make it dangerous.** Bounded reads are not an
ergonomic nicety under an exclusive lock; they are what keeps an aggregate from
becoming an availability incident. The compiler already steers authors
accordingly — `certificate_policy.rs:295` tells an author whose read cannot be
bounded to "declare `maintain.count(...)` and read the maintained aggregate."

So the accurate statement of §3 is narrower and stronger than "write a query":

> An app's analytics is a **maintained aggregate** — computed incrementally
> inside the same transaction as the write that changes it, never by scanning at
> read time. Its write-side cost is not a runtime surprise: `certificate.rs:58`
> carries `maintained_amplification`, and `certificate.rs:225` folds it into the
> program's total write bound at `check` time.

That is the whole analytics story, it costs no new surface, and the cost it does
impose is priced statically before the program runs. The trade is real and worth
naming: maintained aggregates move work onto the write path. The reason to
accept it is that write-path work is bounded and visible, and read-path scanning
under an exclusive lock is neither.

**When co-location stops being safe** is sharp and worth writing down now, so a
later reader does not split the difference badly. It is the moment anything
begins appending a row per event. At that point the store gains unbounded growth
in a file held under an exclusive lock by the process serving user traffic, with
a retention lifetime that differs from the application's and a durability
requirement that differs too — nobody minds losing an hour of analytics, and
everybody minds losing an hour of messages. **If Snapback 2 ever ingests events,
they belong in a different file from the application's rows, and that should be
decided then rather than discovered.**

Which is a third independent argument for §4.1: the co-location this section
relies on is safe precisely as long as we do not build the thing §4.1 refuses.

### 3.2 Observability is already not in the store

Worth stating plainly, because it removes half the question. The `trace` ledger
is not a table. It is `ledger: VecDeque<CommitLedger>` on the writer
(`writer.rs:245`), trimmed to the last 1,000 entries at `writer.rs:871`, and it
dies with the owner — which is why LLP 1002 §8 specifies the
`ledger: unavailable (owner restarted at <ts>)` response rather than an empty
array.

So Snapback 2's causal-explanation data is a bounded in-memory ring that touches
neither SQLite nor the disk. That is the correct shape, it sharpens §7(d) — the
1,000 bound is a *memory* decision, and any proposal to raise it is a proposal
to make the owner's footprint grow with traffic — and it is one more reason
`trace` cannot drift into being a storage product without someone explicitly
deciding that it should.

The correct analytics deliverable is therefore prose, not code: **one recipe in
the packaged guide** showing an author writing an aggregate `query` over their
own tables, with the bound made explicit. LLP 1002 §8 already provisions about
twelve recipes and `NOT-DOING.md` already caps the guide at that; whether one of
the twelve should be this one is a guide-content decision, not a platform
decision, and this RFC does not spend a slot without the author saying so (§7c).

## 4. What is proposed

### 4.1 Nine lines onto `NOT-DOING.md`

Under "Not building", one bullet:

> - **An observability product.** No dashboards or panels, no metrics store, no
>   time-series retention or rollups, no alerting or notification routing, no
>   session replay, no autocapture, no telemetry query language, and no separate
>   analytics meter. `why` and `trace` (LLP 1002 §8) over the owner's bounded
>   ledger are the whole surface; analytics is a `query` program over the same
>   store (LLP 1009 §3). Evidence: LLP 1008.

This is the primary deliverable. It costs nothing, ships nothing, and is the
only item here that reliably pays — because the failure mode LLP 1008 documents
is not that PostHog and Grafana built these things badly, it is that they built
them at all and then could not stop.

### 4.2 `why` accepts a commit seq or a refusal, not only a query

Today `why <query> --as p` re-runs a read and reports, per examined row, the
rule verdict and the rule inputs touched (`crates/snapback2/src/why.rs`, 195
lines; LLP 1002 §8). It answers "why did this read return this?"

The correction loop needs two more question forms, and both are answerable from
records the owner already keeps:

- **`why <seq>`** — why did *this commit* do what it did. `trace` already reads
  the per-commit ledger and the store's `_outbox` for exactly this
  (`trace.rs`, 100 lines). The difference is that `trace` reports the mechanism
  and `why` reports the *verdict*: which rule admitted or refused the write, and
  on which inputs.
- **`why <E_CODE>` or `why` on the last refusal** — why was this refused, in
  terms of the rule and the row, rather than the diagnostic family alone.

No new verb. No new stored data. No new §5.11 row. The claim this rests on — and
it is the claim to attack in review — is that the ledger and the certificate
already contain everything these two forms need. §4.4 is the audit that settles
it.

**Why this and not the other seven.** Every Snapback-attributed correction loop
in a benchmark run is, by definition, a case where the platform's first
explanation was insufficient. Widening `why` is the only proposal here that
moves the number the bar actually scores.

### 4.3 Correction-loop attribution, in the benchmark, not the gate

`rules/RULES.md` allows five blocking checks in sixty seconds and requires that
a sixth delete one. This is not a sixth. Slow verification "runs on a schedule,
attributed to the breaking commit, and files a bounded set of issues" — which is
where this belongs.

The proposal: when a benchmark run records a Snapback-attributed correction
loop, it also records **which explanation was insufficient** — the verb the
agent ran, and the question it still had afterwards. A bounded set of issues
follows from that, and those issues are the actual work queue for `why`.

Without this, §4.2 is a guess about what agents need. With it, the widening is
driven by observed failures. This is the same discipline the rest of the
repository already applies to speed, via `metrics/loop.jsonl`, applied to
explanation.

### 4.4 The one thing that is not free to defer

LLP 1008 §8 ends by naming it: everything the deferred work might later want
must be derivable from what is recorded today.

Two records carry that weight, and both are already bounded on purpose:

- **The ledger** — last 1,000 commits, per owner lifetime, reporting
  `ledger: unavailable (owner restarted at <ts>)` rather than an empty array
  (LLP 1002 §8, review rulings 2026-08-30). This RFC proposes **no change**.
  Boundedness is correct: it is what keeps `trace` a debugging tool rather than
  a storage product, and it is the structural reason Snapback 2 cannot
  accidentally grow into the thing LLP 1008 describes.
- **The certificate** — read sites, bounds, prediction sites, disclosures,
  ceilings. Worth noting precisely, because it is the most under-used asset
  here: `snapback2-core/src/retention.rs` already computes a static per-program
  estimate of rows examined and **retained value bytes**, and
  `certificate.rs` already carries it. LLP 1008 §7.3 — "show the bill before the
  bill", the answer to PostHog's single loudest complaint — is therefore *not* a
  subsystem anyone would have to build. It is a rendering of numbers the
  compiler already produces. That does not make it required by the bar, and this
  RFC does not propose shipping it. It proposes writing down that it is cheap,
  so that the decision is later made on its merits and not on a false belief
  about its cost.

**The proposed action is an audit, once, and a sentence.** Take the two question
forms in §4.2 and the eight inputs in LLP 1008 §7; for each, name the field in
the ledger or the certificate that would answer it, or record that nothing
would. Anything in the second column is a real decision to make now; anything in
the first is correctly deferred. This is an hour of reading, produces one table,
adds no code, and is the only way to know whether deferring is free.

## 5. What is refused, and why refusing is the active decision

Not building a dashboard is easy. These are the ones with a real argument on the
other side, refused anyway:

**Echo-triage** (LLP 1008 §7.4) is the largest unclaimed territory in the
industry and the ledger genuinely records what invalidated what. Refused because
an app a single agent builds in 1,200 s does not have forty panels to go red.
The advantage comes from owning the runtime; it does not decay while unused; it
will still be there when there is a system large enough to need it.

**Derived per-op metrics** (LLP 1008 §7.2) — latency, error rate, refusal
reasons, fan-out, named after the op so a rename is a compile error. This is the
most tempting item in the whole document, because it is the one thing neither
incumbent can do and it looks nearly free. Refused because "nearly free" is how
every registry in Snapback 1 started, and because storing them means a retention
policy, and a retention policy means a storage product. If the benchmark in §4.3
shows agents repeatedly asking a question a counter would answer, that is
evidence, and evidence can reopen it.

**Data lifecycle and deletion** (LLP 1008 §7.6) is a named enterprise blocker
for PostHog. Refused because Snapback 2 has no production data, and because
`retention` in `snapback2-core` today means cost estimation, not lifecycle —
adding a second meaning for the word before it is needed would be a naming debt
paid at exactly the wrong moment.

**AI-assisted analysis** (LLP 1008 §7.7). The 95%-want-reasoning finding is
real, and `guide app` already is the structured context those users complain
about hand-feeding. Refused because there is nothing to analyse yet.

**A telemetry query language** (LLP 1008 §7.8) is refused permanently, not
deferred. Grafana users operate three. `NOT-DOING.md` already forbids a second
authoring profile; a telemetry dialect would be that mistake wearing a different
hat.

## 6. Implementer and date

`rules/RULES.md`: a spec needs an implementer and a date, or it is not written;
only implemented specs bind.

- §4.1 (`NOT-DOING.md` lines) — needs the author's ruling, not an implementer.
  It is a decision, and it is the one item worth taking today.
- §4.4 (the audit) — an hour, unassigned. This is the item whose result should
  determine whether anything else here proceeds.
- §4.2 (`why` widening) and §4.3 (benchmark attribution) — **deliberately
  unassigned.** Both should wait on §4.4 and on the first benchmark run that
  records a real correction loop. Assigning them now would mean building on the
  guess this RFC spends §4.3 arguing against.

Accordingly this document binds nothing and cannot block a PR. That is the
correct status for it.

## 7. Author decisions this needs

**(a) Is the bar's correction-loop clause really the observability spec?** §2 is
the load-bearing claim and everything else follows from it. If the intended
audience is instead the human operating a shipped Snapback 2 app, the answer
changes completely and most of §5's refusals need re-arguing.

**(b) Is `logs` subsumed by a widened `why`?** `logs` is one of the fifteen
verbs (`main.rs:62`, served at `/control/logs`). If §4.2 lands, "what happened"
and "why did it happen" are answered by one verb from one ledger, and `logs` may
be the deletion §4.2 owes. This RFC does not claim it is — the verb has not been
studied closely enough here to say — but it is the first place to look.

**(c) Does the analytics recipe get one of the guide's twelve slots?** §3 argues
the platform work is zero and the teaching work is one page. Twelve is a hard
cap, so this is a real trade, not a freebie.

**(d) Should the ledger stay at 1,000 commits and one owner lifetime?** §4.4
argues yes, emphatically — the bound is what stops this becoming a storage
product. Worth an explicit ruling rather than an inherited default, because
every future observability request will arrive as a proposal to raise it. §3.2
sharpens what is being ruled on: the ledger is in-memory
(`writer.rs:245`, `:871`), so the bound governs the owner's resident footprint,
and raising it means the owner grows with traffic.

**(e) Ratify §3.1's boundary before it is needed.** The store is opened
`locking_mode = EXCLUSIVE` (`store.rs:86`), so co-locating analytics is safe
only while the certificate refuses unbounded reads. The ruling worth having now
is the conditional: *if Snapback 2 ever ingests per-event rows, they go in a
different file from the application's rows.* Cheap to decide today, expensive to
decide after someone has shipped an events table into the owner's store.

## 8. How we would know this was right

The bar already provides the measurement, which is the strongest argument for
this shape: **Snapback-attributed correction loops per benchmark run, trending
to zero, with no observability surface added.** If that number falls while the
verb count stays at fifteen and `NOT-DOING.md` grows, this was right.

If instead the number stalls, §4.3's issues will say what agents were still
confused about after the platform's one explanation — and *that* is the input
that would justify reopening anything in §5. Not the industry evidence in
LLP 1008, which describes other people's problems at other people's scale.
