# Panel: LLP 1016 — Round-1 brief (identical for every panelist)

**Type:** Review input
**Date:** 2026-09-05
**Panel:** codex gpt-6-astra (xhigh), Muse Spark (ultra), grok-4.6 (xhigh); mutually blind round 1, cross-read round 2
**Related:** LLP 1016, `1016-administrative-plane.{astra,muse,grok}.md`, `1016-administrative-plane.panel.synthesis.md`

Preserved verbatim as handed to every panelist (each prompt prepended only `REPO`, `OUT`, and the output instruction).

---

# Panel: LLP 1016, the administrative plane — Round-1 brief (identical for every panelist)

You are one of three independent panelists, each a different model family
(codex gpt-6-astra, Muse, grok-4.6). Round 1 is mutually blind: do not
coordinate; give your own read. Round 2 will hand you the other two reviews
and ask you to respond, so this round is your position, stated with
evidence. The orchestrator will verify every engine claim against the tree,
synthesize, and put the splits to the author. Your review is preserved
verbatim under `llp/reviews/`.

## Your working tree

`REPO` (given in your prompt) is a read-only export of the repository at
commit `6d3d09c6f` (`origin/main`, 2026-09-05). Everything in it is real and
readable. **Read code, not just docs.** Cite `path:line` for every claim about
the engine, the compiler, the owner, the client, or the grammar. If you could
not verify something, say so in those words; do not guess and do not invent.
Write your review only to the output path in your prompt; do not modify the
tree.

## What Snapback 2 is

Snapback 1 is a shipped scale-to-zero backend (server-authoritative data,
live queries, ephemeral realtime, auth, first-party React/Expo/Swift clients)
that accreted: ~3,600 diagnostic codes, drift registries, frozen-record
gates, two authoring profiles, a million-word guide, and a control plane
that never reached a URL. Snapback 2 (`snapback2/`, LLPs numbered 1000 and
up) is the from-scratch successor, started 2026-08-29. One language for
tables, rules, queries, and mutations (Quarry), one agent loop, one binary.
The data plane is a Rust IR interpreter inside SQLite; every program is a
*bounded data program* with a static certificate (rows examined, rows
written, steps, bytes) proven before it runs; the client is a small
TypeScript twin of that interpreter; JavaScript never runs in the data
plane. The owner (`snapback2 dev`) is one process, one writer thread, one
store.

## The author's priorities — read this twice

> "Value simplicity and elegance and speed and ease and ergonomics as
> priority 1. Features are more about just making sure we can do everything
> we need to do, not beating out other things by having a longer list of
> features for its own sake."

And, from 2026-09-04: "in general i feel like we want to go as straight as
possible to the ideal thing rather than fiddling about in these critical
times where the world is moving so fast."

A recommendation that adds surface must pay for itself in simplicity or
speed; a recommendation that removes something is first-class. The primary
user is an AI agent building an app; the second is a human reading what it
wrote. Administration is to be done mainly through a command line an agent
drives; a web UI is reasonable later.

## What this panel is about

On 2026-09-05 a separate session read Snapback 2 and put its objection in
one paragraph:

> What's structurally missing is one thing wearing four hats: there's no
> administrative plane. No data backfill (successors add columns
> optional-only; `for` is too bounded to iterate a table). No scheduled
> work. No bulk delete or repair — GDPR erasure is inexpressible. No fan-out
> past ~50. All four are blocked by the same property that produces the
> guarantees. That's not a missing feature, it's the shape of the design,
> and it's the thing I'd want an answer for before betting on it.

`llp/1016-administrative-plane.rfc.md` is the orchestrator's answer,
written the same day and reviewed by no one. Its thesis: the property
bounds a *transaction*, not a *task*; so the plane is a **driver over
bounded programs** — a `job` kind that is a chunked mutation with the cursor
committed per chunk, run as the system principal under the tables' rules
and proven for that authority at `check`; expand/fill/contract migrations
with successor narrowing; erasure declared per table (`erase <- delete |
scrub | keep`) and derived by the engine; a row-triggered `schedule` kind
fired on the owner's existing tick; `enqueue` continuations for fan-out
past the bound; ad hoc programs through the engine's existing
`execute_adhoc`; no new verb; no console yet.

**The author's question to this panel is direct: are you happy with this
RFC, or should the design go in a different direction?** "Different
direction" is a first-class answer. Candidate directions you may argue for
or against, with evidence, include but are not limited to:

- **The RFC's**: a driver over certified chunks; no path outside the
  language.
- **An unbounded operator mode**: an administrative execution class that
  runs Quarry (or SQL) without the certificate's ceilings, isolated from
  the live-query and OCC machinery by some fence (a maintenance window, a
  paused owner, a fork-and-swap). Cheaper to build; what does it cost the
  guarantees, and is that cost real for the apps the benchmark describes?
- **A product boundary**: bulk and scheduled work live outside Snapback 2
  entirely (the host's cron, an external worker writing through named
  mutations, export/import for migrations), and the RFC's kinds are not
  built.
- **A smaller RFC**: some of the four hats are real and some are not, at
  the scale Snapback 2 is aimed at; say which and why.
- **A different decomposition**: the job as a schedule continuation (the
  design RFC's other option), a `migrate` block on the successor instead of
  narrowing plus fill, engine `propagate` instead of `enqueue`, or
  something the corpus has not named.

Everything in LLP 1016 — the decomposition, the grammar, the driver, the
authority proof, the erasure model, the schedule, the continuation, the
verb surface, the trade — was written by one session in one sitting and is
what you are here to break or to endorse. The author has ruled on nothing
in it.

## Required reading, in order

1. `rules/RULES.md` and `rules/NOT-DOING.md` — the posture: budgets, the
   three bars, "one `schedule` kind", "cron" on the not-doing list, "no verb
   without its row", "delete; don't deprecate".
2. `llp/1000-snapback2.explainer.md` — the root; the founding decisions and
   what exists today.
3. **`llp/1016-administrative-plane.rfc.md` — the document under review.**
   Read it whole, including §9 (author decisions) and §10 (lanes).
4. The design it claims to extend: `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md`
   §1 (the model), §2 rows B and I (time is state; jobs) and §2.1 K
   (`maintain` is a family; "maintain when fan-in is bounded, compute at
   read when fan-out is unbounded"), §2.2 row E (`propagate`), §6 (the
   kinds: `schedule`, `job`), §9 open question 3.
5. The engine and owner it makes claims about:
   `llp/1001-query-engine.spec.md` §1 (system tables), §2 (what a commit
   records), §3 (states), §4 (successors, `E_SUCCESSOR_COLUMN_REQUIRED`,
   `MigrationPlan`, fencing), §6 (identity, the reserved system principal),
   §8 (`emit`); `llp/1002-dev-loop.spec.md` §4 (the wire), §5 (the owner:
   one writer thread, `/control/clock`, session fencing), §6 (the verbs);
   `llp/1003-effects-on-ibex2.spec.md` §2 (the outbox lifecycle) and §4
   (the runner tick); `llp/1006-assets.rfc.md` §9 (reclamation);
   `llp/1012-local-first-v1.spec.md` §3 (the caller-invoked `purgeExpired`)
   and §5 (the four swap rules; absence versus hidden; `retain`).
6. The control plane it sits beside: `llp/1015-control-plane.rfc.md` D1
   (routes and modes), D6 (tokens), D10 (`run --env production` as the
   system principal, the operator ledger row), D13 (no console yet), §1
   (its refusals); `llp/1014-control-plane-lessons-from-snapback-1-and-the-field.research.md`
   §3.2 (what Snapback 1 shipped as its admin surface: `data.patch`, `jobs`,
   `cron`, `admin` console), §3.5 (what is worth keeping), §6 F7–F8.
7. The language as shipped: `snapback2/packages/snapback2/guide/quarry.md`
   (whole; note §Refused platform gaps and the `send` recipe under
   §Effects), `llp/1010-quarry-language-amendments.rfc.md` A4–A5 (no
   `where`; `merge`), `llp/1011-quarry-ergonomics.rfc.md` B1 (opaque
   cursors; total indexes), `snapback2/packages/snapback2/templates/chat/snapback/*.q`.
8. The code: `snapback2/crates/snapback2-core/src/certificate.rs`
   (`Ceilings`, write sites), `registry.rs` (`Runtime`, `execute_adhoc`,
   `apply_successor`), `successor.rs`, `store.rs` (system tables,
   exclusivity), `identity.rs` (the reserved principal), `engine/runner.rs`
   and `engine/runner_ops.rs` (loops, `Emit`, `new_ids`), `live.rs`;
   `snapback2/crates/snapback2/src/{owner.rs,writer.rs,writer_effects.rs,control.rs,verbs.rs,serve.rs,trace.rs}`;
   `snapback2/packages/compiler/src/quarry/` (parser, program lowering,
   checks — where `for`, `first N`, `emit`, and the refused list live);
   `snapback2/packages/evaluator/src/` (the twin's `Emit`).
9. The bar and the benchmark: `benchmarks/briefs/social-messenger.md`
   (search for "### M1" through "### M8"; note M5 disappearing messages and
   whatever asks for deletion, reporting, or account removal), and
   `benchmarks/briefs/clique-pay.md` if present (close of books, payouts).

## The questions

Answer each with evidence. Where the answer is "the RFC is right", say so
briefly and move on; the value is in what is wrong, unverifiable, or better
done another way.

1. **Direction.** Is "a driver over certified chunks, no path outside the
   language" the right shape for the four hats, or would one of the other
   directions above (or one you name) serve the author's priorities better?
   Argue it with what it costs in guarantees, in lines, and in what an
   agent has to learn. If you endorse the RFC's direction, say what would
   make you abandon it.
2. **Are the four hats the right four?** At the scale and app shapes
   Snapback 2 targets (the benchmark briefs), which of backfill, schedule,
   bulk delete/erasure, and fan-out are real, and what is missing from the
   list — import, export, index rebuilds, re-running effects, support
   impersonation, feature flags, seeding production, anything the briefs
   ask for?
3. **D1, the chunked mutation.** Cursor as a full key tuple, committed with
   the chunk; the visiting rule; a job "is not a transaction and does not
   claim to be". Sound against the engine's cursor and `for` machinery as
   they exist? Where does a partially-run job leave state an app or a user
   will misread — is that acceptable for backfill, for erasure, for
   fan-out?
4. **D2, authority proven at `check`.** A structural test ("the write
   site's rule admits `system`") — is it sound and complete enough against
   the rule language as lowered (`allow`, `deny`, `system`, `exists`,
   `created`, `and`/`or`/`not`, `(old, next)`)? Does it produce false
   refusals? Is running jobs under the tables' own rules right, or should a
   job be an engine-authorized writer like a seed or a maintain?
5. **D5, expand/fill/contract.** Is narrowing admission (`T?` → `T` when no
   row is null) implementable in `successor.rs` as it stands? Is add, fill,
   drop the honest migration path, or does the author's "go straight to
   the ideal" argue for a first-class transform on the successor (a
   `migrate` block that is itself a bounded program per row)? What happens
   to rename?
6. **D6, erasure.** Three words, a reserved `erased` principal, a derived
   job, refuse-until-declared. What does it miss — unique indexes over a
   principal column when two erased users collide on `erased`; `ref`
   columns to tables that name a principal; ids inside `json` or `[type]`
   columns; maintained aggregates; forks and snapshots; assets shared by
   forks; the `_commits` ledger; `delivered-history` on devices? Is
   "derived by the engine from three words" the right shape, or should
   erasure be an ordinary authored job with `check` verifying coverage? Is
   refuse-until-declared right for a template the loop bar must pass?
7. **D7, schedules.** A `_timers` index maintained from a `time ?` column;
   firing on the tick, at most 64 per tick, fire and settle in one commit;
   at-least-once under `(schedule, row_id, at)`; `if` re-evaluated at fire;
   `every` proposed on the same kind. Right against the owner's writer
   loop and the dev clock as they exist? Should targets be mutations only,
   or jobs too? Does `every` cross the "cron" line, and if the fallback is
   an external trigger on the CLI, is that honest or is it Snapback 1's
   "hosted lifecycle" shape again?
8. **D8, continuations.** `enqueue` as one write site, the twin's no-op,
   deliveries arriving over ten commits. Acceptable as observable
   behaviour? Right relative to `merge` (LLP 1010 A5) and to the design
   RFC's `propagate` (§2.2 row E)? What does the `send` recipe look like
   with it, and is the "silent fifty" you can read in `guide/quarry.md`
   really silent — check what the runtime does with a `Limit`-stopped page
   inside a mutation.
9. **D3, the driver.** One job at a time; client actions first on the one
   writer thread; pause and re-certify on succession; resume from the
   committed cursor after a crash; cancel at a boundary. Does the writer
   loop (`writer.rs`) admit this without a second thread? Will a 500-row
   chunk starve a chat app's sends? What is the right default chunk size
   and should the author-declared `first N` be the only knob?
10. **D4, D10, D11 — the surface.** Ad hoc `run --file` through
    `execute_adhoc`; `--as system` as the operator seat; no sixteenth verb
    (flags on `run`, `trace` for jobs); hosted under LLP 1015's `admin`
    token; MCP read tools only. Right? Where is a footgun (an operator
    running an ordinary mutation as `system`; ad hoc jobs hosted)? Would
    you add the verb and pay with `persona`?
11. **Agent-friendliness (§6).** Walk an agent building the benchmark's
    M1–M8 through the first administrative thing it will need. Does the
    RFC pave it — refusal, rewrite, `--plan`, `--dry-run`, `--wait`,
    receipt — or does it hit a gap? Name the gap.
12. **Surface and the trade (§1, §9.8).** Name every thing in 1016 that
    adds surface without paying for itself, and everything you would
    delete. Is executing LLP 1007 §7's ruled deletion of the `fork` CLI
    adapter the right counterweight, given LLP 1015 D1 still lists
    `/control/fork`?
13. **The console (D12).** Later, on the same routes — right, or does an
    agent-first posture still need a minimal human view sooner (the
    erasure map, running jobs)? If sooner, what is the smallest one?

## Your output

Write a single Markdown file to the output path in your prompt, at most
about 3,000 words, in this order:

1. **Verdict**: one of `READY` (implement as written when commissioned),
   `READY WITH EDITS` (list them; none blocking), `NOT READY` (at least one
   blocking finding in this direction), or `DIFFERENT DIRECTION` (name the
   direction, what it costs, and what it buys). Then one paragraph: are you
   happy with this RFC?
2. **Blocking findings**, numbered, each with: the claim in the RFC (quote
   it), the evidence (`path:line`), why it blocks, what would resolve it.
3. **Material findings** (should change before lanes are commissioned),
   same shape.
4. **Minor findings** (wording, spellings, consistency), briefly.
5. **Answers to the thirteen questions**, one short paragraph each; cite.
6. **Strengths** — what the RFC gets right that a revision must not lose.
7. **Open questions for the author**, only if a ruling is genuinely needed;
   include your recommendation on each of §9's nine decisions in one line
   each.
8. **One paragraph**: what you would build first if you owned lane J1.

Do not pad. Do not restate the RFC. If you ran out of time before reading
something on the list, say which.
