# LLP 0171: Authoring loop parity

**Type:** RFC
**Status:** Review
**Systems:** Developer experience, Authoring, Tooling, Code generation, Documentation, Packaging, Effects, Agent experience, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-04
**Revised:** 2026-08-04
**Related:** LLP 0010, LLP 0023, LLP 0041, LLP 0042, LLP 0061, LLP 0062, LLP 0070, LLP 0074, LLP 0089, LLP 0103, LLP 0108, LLP 0115, LLP 0117, LLP 0118, LLP 0122, LLP 0134, LLP 0144, LLP 0146, LLP 0160, LLP 0170

> **Evidence boundary.** Observations come from an external four-backend
> comparative build (chess, 2026-08-04) in which Snapback and Convex built the
> same frozen spec in parallel. The Snapback arm's diary is synced verbatim as
> [`diaries/0057-chess-backend-bakeoff.diary.md`](../diaries/0057-chess-backend-bakeoff.diary.md);
> working copies for all four arms remain at
> `~/projects/chess-bakeoff/implementations/`. Two of the items below are also
> filed as guide-gap tickets per LLP 0061 §5 —
> `issues/20260804-guide-gap-published-closure-drift.md` (§A) and
> `issues/20260804-guide-gap-handler-source-imports.md` (§C). This RFC
> proposes; **LLP 0115 remains the sequencing home** for Convex-parity work and
> should absorb these as CV items rather than run a second track.

## Summary

In the comparative build, Convex reached a green conformance suite in about 18
minutes with no debugging phase. Snapback reached a *larger* green suite — 21
required checks plus two extras it added because the spec's queue and analytics
claims are exactly the kind a conformance script can assert vacuously — but the
app itself took roughly five minutes to write and **everything expensive was
environmental**.

That is the whole gap, and it is worth stating precisely because it is good
news: Snapback's authoring *foundations* are stronger than Convex's on every
axis that was compared. What separates them is five pieces of plumbing, four of
which are already owned by an existing LLP and none of which is a design
mistake.

| | Item | Owner | Est. cost of the gap |
|---|---|---|---|
| A | Closure fences in the guide | LLP 0061 + LLP 0134 | ~8 min, two wrong design decisions |
| B | `snapback serve` — a non-interactive verb | LLP 0041 | ~4 min, 60 lines of substitute |
| C | Third-party libraries in handlers | LLP 0118 → LLP 0108 | ~3 min + an unguided bundling step |
| D | Function-surface evolution without `--fresh` | LLP 0160 | unquantified; degraded the loop to "drop the database" |
| E | `maxAttempts` default of 1 | LLP 0070 | latent; would have broken most games |

**A is worth more than the other four combined**, and is argued as such below.

## What Snapback already beats Convex on, and must not regress

Recorded first, because the items below are all repairs and a repair program
that damages the foundations would be a net loss:

- **Codegen diagnostics.** Deterministic, fails closed, writes nothing on
  error, stable codes, and messages naming the function, the argument, the file
  and the line. Convex has nothing comparable; its equivalent failure mode in
  the same build was two silent ways to believe you are typechecked when you
  are not (`--typecheck try` skips when TypeScript is absent;
  `--typecheck enable` reads `convex/tsconfig.json`, not the root one).
- **`degraded <fn>` lines.** Naming exactly which operations carry an `unknown`
  result contract and exactly how to fix each — a nudge toward the typed thing
  rather than a nag. This is also the migration precedent LLP 0170 §5 reuses.
- **`snapback doctor --json`.** A full vertical slice — launch, load a
  generated bundle, run a query, commit a mutation, open and close a live
  subscription, shut down — with one stable code per boundary, *before the
  author writes a line*. No other backend in the build had an equivalent.
- **The guide's architecture** (LLP 0061): intent-indexed, `targets:`/
  `maturity:` frontmatter, a capability index with explicit GAP rows, and
  CI-verified snippet excerpts. The arm navigated rather than grepped for the
  first hour and said so.
- **Product-side proof of background effects.** `defineJobStatusQuery` plus the
  mutation receipt's `enqueues` array let an author prove a job actually ran
  from the product surface. The arm's words: no other backend has handed it
  that.
- **Vacuous-pass protection** in the acceptance surface — zero checks can never
  pass. This is thinking about the specific failure mode that bites
  test-writing agents, and it is rare.

## A. Closure fences in the guide

**The problem.** Twice, the guide taught a primitive the published package does
not have: `ctx.refuse`/`refusals` (LLP 0144, Accepted, slice landed
2026-08-01) and `custody: 'anonymous-public'`. Both pages are
`maturity: shipped`, `status: current`, with no version fence. Both cost a real
workaround, and **both workarounds are things the guide separately names as
anti-patterns** — string-matching a diagnostic message, and hand-rolled `fetch`
against `/query/...`.

The arm shipped `refusalCodeOf()`, which regex-matches `CHESSFIELD_[A-Z_]+` out
of a diagnostic, and flagged it as the weakest thing in its implementation. The
correct mechanism exists and is Accepted. It simply is not in
`@expo/snapback-*@0.1.8`.

**Why this outranks everything else here.** The authoring-loop page already
states the rule — *when a page describes a surface newer than the newest
closure, it says so* — so the framework knows this class of drift exists and
has committed to disclosing it. The rule is unenforced, which puts the hole in
exactly the place the reader is most confident. For a human this is an
annoyance. **For an agent, whose entire model of the system is the text, it is
the specific failure the agent-first framing exists to prevent.** Three of the
arm's four largest time sinks trace to this one gap.

**Proposal.** Add `since:` to guide frontmatter, at page and section
granularity, naming the closure in which the described surface became
available. Extend `scripts/check-guide.mjs` — which already runs in the local
proof and the docs-only fast path — to join `since:` against the published
package closure and fail when a page claims `maturity: shipped` for a surface
the newest published closure does not contain. A page deliberately ahead
declares `unreleased: true` and renders a banner.

Every piece of machinery for this already exists: the frontmatter convention
(LLP 0061, `guide/conventions.md`), the checker, and the capability status
authority (LLP 0134). Only the join is missing.

**Second-order ask.** The arm's advice to its successor was "cross-check every
guide page against your installed `node_modules` before you build on it." That
sentence should be impossible to need.

## B. `snapback serve`

**The problem.** `snapback dev` is a foreground supervisor that reads commands
on stdin and shuts down cleanly on EOF — exit 0, ready file removed, no
diagnostic. That is a good design for a human at a terminal and a trap for
anything scripted. The arm lost ~4 minutes diagnosing a server that started,
printed `control-ready`, and then was not there; it worked the cause out by
noticing the exit code was 0. It then wrote 60 lines of `serve.mjs` around the
documented sessions one-boot form.

For an explicitly agent-first product this is the wrong way round: the paved
path assumes the operator Snapback says it is not optimizing for, and the
scripted path is a testing recipe rather than a command.

**Proposal.** Amend LLP 0041 (Status: Review, and this is squarely inside its
"watch mode" scope) with a `snapback serve` verb:

- backgroundable; no stdin dependency, and EOF on stdin is not a shutdown
  signal;
- `--port`, `--db`, `--fresh` as flags rather than as a documented recipe;
- one machine-readable ready line on stdout (JSON: address, admin URL, database
  path, token file path);
- non-zero exit on any failure to reach ready, with a stable `SNAPBACK_*` code;
- `snapback dev` keeps its current human-facing behavior unchanged.

The one-boot form the arm reimplemented is the specification for this; it
should be a verb, not a recipe.

## C. Third-party libraries in handlers

**The problem, and why it is not the problem LLP 0118 describes.** LLP 0118
frames handler composition as *sibling helper reuse* — Streak Lab's civil-date
parser duplicated between a query and a mutation — and lays out eight option
paths without making a call, deferring to the LLP 0108 follow-on.

The chess build supplies a case that framing does not cover: the app needed
**`chess.js`**, a third-party library. Duplication does not solve that at any
price. The arm esbuild-bundled the library into the handler as an IIFE and then
re-checked the output against the banned forms itself so failure would occur at
build time rather than at codegen.

Compounding it, the guide states that the legacy `{ source, exportName }` lane
is "useful ... for logic that genuinely needs imported or sibling helpers."
**It is not.** `loadHandlerSource()` reads exactly one file and any
`ImportDeclaration` is `BUNDLE_UNSUPPORTED_IMPORT`. The lane buys top-level
functions in the same file. Establishing this required reading
`node_modules/@expo/snapback-codegen/index.mjs` — the first place the arm left
the documentation to make progress, and an instance of A above.

**Proposal.** Two separable asks:

1. **Correct the page immediately.** One sentence — *handler sources are closed
   single scripts; you cannot import, so pre-bundle* — would have saved the
   trip. This is a docs fix and should not wait on the design.
2. **Move the bundling inside codegen.** The constraint is defensible: a
   handler's bytes must be hashable and replayable, which is what makes
   determinism enforcement and replay work at all. The bug is not the
   constraint; it is that **every app author must independently discover and
   implement it**. Codegen already owns the generate step, already fails
   closed, and already re-checks handler bodies for banned forms. Let it accept
   a declared dependency, bundle at generate time, and hash the *output* —
   preserving every existing property while removing an unguided step.

This RFC does not attempt to settle LLP 0118's eight paths. It argues that the
third-party-library case is materially different from the sibling-helper case,
that it is common (any domain with real rules — chess, dates, geometry,
currency, parsing — hits it on day one), and that it should be weighed in the
LLP 0108 follow-on rather than left to the sibling-helper framing.

## D. Function-surface evolution without `--fresh`

**The problem.** Adding one function to a sessions-mode app and restarting is
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`. The documented recovery is the watch
reload, which lives inside the thing B says cannot be backgrounded. So the
arm's inner loop became "drop the database" — acceptable in a bakeoff, and the
arm's own words: *would not be fine on Tuesday*.

The arm named this as the one thing it never demonstrated, and it is the reason
"day 200 of a real product" is currently unanswerable.

**Proposal.** Owned by LLP 0160 (the ideal migration experience), which should
absorb this as a named case: a sessions app admits a **superset** function
surface across restart when the identity-bearing subset of the auth startup
artifact is unchanged, and refuses only when that subset actually moved. The
current check appears to compare the whole artifact, which is why adding an
unrelated function is indistinguishable from rotating auth.

If that reading is wrong, the diagnostic should say which part of the artifact
changed — today it names only the mismatch.

## E. The job retry default

**The problem.** Push jobs in the chess build routinely failed their first
attempt with `SNAPBACK_AUTH_RESERVATION_STALE` against concurrent player moves
and succeeded on the retry. Two things make this worse than a transient:

- the succeeded job row reports `lastErrorCode: null`, so from the product
  surface the retry is invisible;
- **`maxAttempts` defaults to 1.**

Together: the obvious spelling of "enqueue a push notification on each move"
goes terminal-`dead` on the first move of most games, for reasons having
nothing to do with the consumer. The arm avoided it only because the spec told
it to write 3.

**Proposal.** Owned by LLP 0070. Either raise the default above 1, or — better,
since a silent retry is its own problem — record the attempt history on the
succeeded row so `lastErrorCode: null` stops being a lie, and treat
reservation contention as a platform-class retry that does not consume the
application's budget. The arm's advice to its successor was "never take the
default `maxAttempts: 1` on a job that runs alongside user writes," which is a
default worth changing rather than documenting.

**Adjacent, not proposed here.** Exhausted jobs land in a terminal `dead` state
on the same queue rather than a separate dead-letter queue. Substantively
equivalent; operationally, runbooks and tooling are built around the shape. Worth
a decision, not necessarily a change.

## Non-goals

- **Not a hosted-provisioning proposal.** Convex created a cloud project
  non-interactively on the first attempt and was ~90 seconds from `npm i` to a
  deployed function; Snapback has no hosted target to compare. That belongs to
  LLP 0089 and LLP 0103 and is deliberately out of scope here — every item
  above is reachable with no hosted story at all.
- **Not a re-litigation of LLP 0118.** §C supplies evidence and argues the
  framing is incomplete; the call stays with the LLP 0108 follow-on.
- **Not a change to determinism enforcement.** `ctx.runtime.now()`/`id()` frozen
  per invocation and `Date.now()` as a generation-time error are correct, and
  the chess clock depended on them. §C explicitly preserves the property that
  makes them possible.

## Acceptance

The right test is not a checklist but a **cold-start agent run**: an agent with
no prior Snapback exposure, an empty directory, and a written app spec, with no
human intervention and nothing written outside the app directory. Measure:

1. **Time to first running server.** Target: under 3 minutes, with no file the
   agent had to author itself in order to start one (kills B).
2. **Documents consulted before the first line of app code**, and whether any
   consulted page described a surface the installed package lacked (kills A).
   The arm needed ~7 minutes and three documents merely to establish that no
   Rust toolchain was required — that answer should be one line on the guide's
   first page.
3. **Trips into `node_modules`.** Target: zero (kills A and C).
4. **Whether adding one function after the first green run requires dropping
   the database** (kills D).
5. **Whether the app's first job spelling survives concurrent writes** without
   the author knowing to override a default (kills E).

Re-run against Convex on the same spec, by the same method, and record both.
The comparative build is repeatable — the frozen spec, the identical build
prompt, and the 21-check conformance list are at
`~/projects/chess-bakeoff/` and cost about 20 minutes of agent time per arm.

## Open questions

1. **Does `since:` belong at page granularity, section granularity, or on the
   individual snippet?** Snippets are already CI-verified excerpts, which
   suggests the snippet is the honest unit — and also the most expensive.
2. **What is the closure a guide page is checked against** — the newest
   published npm closure, the repo tree, or both with different severities? A
   contributor reading the guide while working on Snapback wants the tree; an
   app author wants the closure. LLP 0061's `targets:` frontmatter may already
   be the discriminator.
3. **Should `snapback dev` and `snapback serve` share a supervisor**, or is the
   scripted path better served by a genuinely separate, smaller entry point
   with fewer moving parts?
4. **Is codegen-owned bundling (§C.2) compatible with the LLP 0009 lifecycle**
   in which every invocation evaluates its handler module fresh? Bundling
   changes module size, not module count, so the answer is probably yes — but
   LLP 0118 v0.2 notes that lifecycle re-prices every bundling shape, and this
   should be priced rather than assumed.
5. **Does the cold-start acceptance run belong in CI**, and if so, what is the
   non-flaky form of "an agent with no prior exposure"? A recorded transcript
   replay is reproducible but stops measuring the thing.
