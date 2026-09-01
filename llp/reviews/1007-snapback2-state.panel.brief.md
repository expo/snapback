# Panel: the state of Snapback 2 — Round-1 brief (identical for both panelists)

**Type:** Review input
**Date:** 2026-09-01
**Panel:** codex gpt-5.6-sol (ultra), grok-4.6 (xhigh)
**Related:** LLP 1007, `llp/reviews/1007-snapback2-state.panel.{codex,grok}.md`

Preserved verbatim so the panel verdicts can be read against what was actually
asked. The framing, the candidate lists, and the adjudication in the round-2
brief are the orchestrator's and were not neutral prompts.

---

# Panel: the state of Snapback 2 — what should change?

You are one of two independent panelists (the other is a different model
family). Do not coordinate; give your own read. The orchestrator will
synthesize both and take a joint round afterward.

## Your working tree

`REPO` (given in your prompt) is a git worktree checked out at `origin/main`
(cc7eb764f). Everything below is real and readable. Read code, not just docs.

## What Snapback is

Snapback 1 is a shipped scale-to-zero backend: server-authoritative data,
live queries, ephemeral realtime, auth, first-party React/Expo/Swift clients.
It works, and it accreted: ~3,597 diagnostic codes, drift registries, frozen
record gates, committed generated code, 188 open / 623 closed tickets of pure
apparatus, two authoring profiles, a million-word guide.

Snapback 2 (`snapback2/`, LLPs numbered 1000+) is the from-scratch successor,
started 2026-08-29 — **three days ago**. It is fenced: its own Cargo workspace,
its own Bun workspace, no Snapback 1 gate/inventory/registry applies.

The thesis, in one line: **one language for queries and mutations, one loop
for the agent building on it, one binary.**

## The author's priorities for this panel — read this twice

> "Value simplicity and elegance and speed and ease and ergonomics as
> priority 1. Features are more about just making sure we can do everything
> we need to do, not beating out other things by having a longer list of
> features for its own sake."

So: a recommendation that adds surface area needs to pay for itself in
elegance or speed, and a recommendation that *removes* something is
first-class. The primary user is an **AI agent building an app**, second is a
human reading what the agent wrote.

## Required reading, in order

1. `rules/RULES.md` and `rules/NOT-DOING.md` — the posture. NOT-DOING is
   described as "the most valuable file in the repository."
2. `llp/1000-snapback2.explainer.md` — the root, the 9 founding decisions.
3. `llp/1004-quarry-default-surface.decision.md` — the 2026-08-31 ruling that
   flipped the default authoring surface to a new notation, Quarry.
4. `snapback2/packages/quarry/README.md` — the Quarry v0.2 lowering rules,
   the refused surface, and the known gaps. **Read the "Refused surface and
   known gaps" section carefully.**
5. `snapback2/packages/quarry/fixtures/full-surface/snapback-quarry/*.q` and
   `fixtures/todos-quarry/snapback-quarry/*.q` — Quarry as actually written.
6. `snapback2/packages/snapback2/templates/todos/snapback/*.ts` and
   `templates/chat/snapback/*.ts` — the TypeScript surface, which is what
   Quarry compiles *to*.
7. `snapback2/packages/snapback2/guide/grammar.md` — the whole grammar on one
   screen. Also `guide/auth.md`, `live-query.md`, `testing.md`, `personas.md`,
   `effects.md`.
8. `llp/1001-query-engine.spec.md` — store, generations, live subscriptions,
   identity, outbox. Skim §1–§3 and §6–§9 closely.
9. `llp/1002-dev-loop.spec.md` — the binary as one owner, the 13 verbs, the
   wire, the client. §1, §2, §4, §6.
10. `llp/1003-effects-on-ibex2.spec.md` — the effect seam.
11. `llp/1006-assets.rfc.md` — a *Draft* RFC (assets as a column type). Its
    revision (b) was a deliberate simplification pass; §12 records what was cut.
12. `snapback2/AGENTS.md`, `snapback2/README.md`.

Useful context if you want the *why*: `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md`
(the language design), `llp/0329.016-agentic-dev-loop-from-scratch.rfc.md`
(the loop design), `llp/0329.014.011-*` (the executed Quarry-vs-TS head-to-head).
These are long; sample them, don't read them cover to cover.

## Ground truth: what exists and what it costs

Code, at cc7eb764f:
- `crates/snapback2-core` — IR, certificate, engine over SQLite, trace, live,
  identity, successor, retention, registry, client replay.
- `crates/snapback2-effects` — the only crate that may link Ibex 2 (a Hermes
  JS runtime), behind `--features hermes`. Off by default.
- `crates/snapback2` — the binary: `init`, `check`, `dev`, `test`, `run`,
  `doctor`, `guide`, `data`, `why`, `trace`, `auth`, `fork`, `version`.
- `packages/compiler` — TypeScript subset → IR, with certificate provenance,
  type analysis, collection-fact checks.
- `packages/evaluator` — the IR twin for clients, 7.8 KB gzip.
- `packages/quarry` — `quarryc`: Quarry `.q` → the TypeScript surface.
- `packages/snapback2` — npm shim, client, React hooks, test runner, guide,
  templates.
- `corpus/` — 75 conformance cases shared by the Rust engine, the TS
  evaluator, and the TS compiler.

Measured loop (`snapback2/metrics/loop.jsonl`, latest entries; budgets in
`rules/RULES.md`):

| | measured | budget |
|---|---|---|
| warm build | 0.08 s | — |
| incremental rebuild after one-line edit | 0.97 s | 15 s |
| `core_test_s` (cargo test workspace) | **25.2 s** | 30 s |
| `check` on a program | 0.23 s | 1 s |
| `check` on a project | 0.34 s | 1 s |
| `doctor` boot-to-ready | 0.13–0.44 s | 0.5 s |
| `init` → `dev` serving | 0.63 s | — |
| `test` (todos template) | 0.85 s | — |
| release binary | **8.13 MB** | — |
| debug binary | 24.5 MB | — |

Source size (rough): Rust src ~12k lines across `crates/`, Rust tests ~9k,
TS src ~11k across `packages/`. Largest files sit just under the 1,500-line
cap (`tests/successor.rs` 1493, `tests/owner.rs` 1481, `tests/outbox.rs` 1445,
`effects/src/ibex.rs` 1391, `bin/export_corpus.rs` 1360, `src/writer.rs` 1350,
`certificate.rs` 1318, `compiler/src/test.ts` 1490, `evaluator.ts` 1353).
Verify these yourself; several are worth a comment.

Open issues touching Snapback 2 (in `issues/`):
- `20260831-quarryc-branch-write-trace-undercount.md` — check-green /
  runtime-red in the *paved* path. Named P0 in LLP 1004.
- `20260831-packaged-consumer-smoke-rung.md`
- `20260831-snapback2-compiler-flat-variable-namespace-collision.md`
- `20260831-snapback2-core-test-budget-breach.md`
- `20260831-snapback2-object-literal-decimal-field-types.md`
- `20260831-snapback2-test-wedge-rule-restricted-seeds.md`
- `20260831-mutation-reads-obey-read-rules-admin-null.md`
(`issues/closed/` has the recently resolved ones — including the insert-return
P1 — and is worth a skim for the shape of what goes wrong.)

The acceptance bar, from NOT-DOING.md: *a fresh agent, with only the published
package and the task, builds Clique M1–M3 (accounts, feed, realtime chat) on
published snapback2 in under 1,200 s with at most one Snapback-attributed
correction loop, and `snapback2 test` proves it.* Nothing not required by that
bar exists yet. Note: it has been executed twice against a **worktree** build,
not a published one — see LLP 0329.014.011.

## The questions

Answer these. Be concrete, cite files and line numbers, and rank.

**Q1 — The Quarry ruling.** Three days in, the project introduced a second
notation and made it the *default*, with the TypeScript surface as the
compatibility lane. Quarry buys ~25% fewer tokens, 29% fewer tool calls, a
3.0× smaller authored backend. But it is a second front end over the same IR,
its README lists a long refused surface, generated `.ts` is emitted in two
copies through a "packaged-worker filename bridge," and diagnostics now need
a site-mapping hop. Is this simplicity or is it the "two authoring profiles"
mistake of Snapback 1 wearing a new coat? Give a verdict, and if you'd change
something, say exactly what — including "make Quarry the only surface and
delete the TS authoring surface" if that's your view.

**Q2 — The language.** Read the Quarry fixtures and the TS templates as *a
language*. Where is it inelegant? Where does it make the agent write
something a human would find surprising? Name the three worst spots and the
three best. Consider specifically: the bracket-selection overload
(`t[x]`, `t[col = value]`, positional, ranges), `!  else CODE`, `match`
with no `return`, the `+ ~ - +~` write sigils, `by <index>` disambiguation,
absence/null semantics, and the fact that ranges are the only bounded scan.

**Q3 — What to delete.** Name the things in Snapback 2 today that should not
exist, ranked, with the argument. Candidates worth *considering* (not a
list to agree with): the TS authoring surface, the client-side IR evaluator
twin, the effects crate / Ibex 2 embedding, the certificate provenance
machinery, `fork`, `why`/`trace` as separate verbs, the 75-case corpus's
random-* cases, the packaged guide inside the binary, `decimal`/`money` as
column types, the `_commits` log. For each: what breaks if it goes.

**Q4 — What's missing that the bar needs.** Not a feature wishlist — what is
genuinely required to hit the acceptance bar or to keep the thing coherent,
that isn't there. Be ruthless about the difference.

**Q5 — Speed.** `core_test_s` is 25.2 s against a 30 s budget and has already
breached once (open ticket). The 60 s blocking-gate budget is the real
constraint. Where is the loop actually slow, and what would you change? Also:
the 8.13 MB release binary — does that number matter, and if so why?

**Q6 — The rules themselves.** `rules/RULES.md` and `NOT-DOING.md` are the
governance. Are they the right rules? Is anything in them already
being honored in the letter and violated in the spirit? (Look at the file-size
cap and the files sitting at 1,480–1,493 lines; look at "agents remove
apparatus freely and add none" against what has been added in three days.)

**Q7 — The one change.** If you could make exactly one change to Snapback 2
tomorrow, what is it? One paragraph, no hedging.

## Output format

Write a single markdown document. Lead with a **Verdict** section: 5–10
sentences, the honest overall read, including what is *good* and should not be
touched. Then Q1–Q7 with headers. Then a final **Ranked recommendations**
table: change | why | cost | risk if we don't. No more than 12 rows.

Rules for you:
- Cite `path:line` for every claim about the code. If you did not read it,
  say so rather than inferring.
- Disagree with the author's rulings where you think they are wrong. LLP 1004
  is an author ruling that overrode its own orchestrator's recommendation;
  saying so is in scope.
- Do not pad. A short document that is right beats a long one.
- Do not propose process, registries, or new checks. RULES.md forbids agents
  adding apparatus; a recommendation that adds a check must say what check it
  deletes.
