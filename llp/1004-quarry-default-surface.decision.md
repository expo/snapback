# LLP 1004: Quarry is Snapback 2's default authoring surface

**Type:** Decision
**Status:** Accepted
**Systems:** Authoring surface, `snapback2/packages/quarry`, dev loop,
templates, guide, diagnostics
**Author:** Charlie Cheever (ruling); Claude Fable 5 (orchestrator, record)
**Date:** 2026-08-31
**Revised:** 2026-08-31
**Related:** LLP 1000 (decision 10), LLP 1002, LLP 0329.014.004, .009,
.010, .011, `spikes/clique-diagnostic-runs/`, `snapback2/packages/quarry`

## The ruling (author, 2026-08-31)

Quarry — the from-scratch notation of LLP 0329.014.009/.010, compiled to
the TypeScript authoring surface by `quarryc` — becomes the **default**
authoring surface for Snapback 2 backends. `snapback2 init` scaffolds a
Quarry backend; the guide teaches Quarry first. The TypeScript surface
remains fully supported as the compatibility surface and escape hatch
(`init --template ts`): it is what `quarryc` emits, what the compiler
certifies, and the second front end whose divergent idioms have already
proven themselves a bug-finding instrument (LLP 0329.014.011 §3).

Evidence behind the ruling: the executed head-to-head of LLP 0329.014.011
— both surfaces green on the Clique reduced run, with Quarry ~25% fewer
tokens, 29% fewer tool calls, a 3.0× smaller authored backend across 67
certified ops, zero hand-edits of generated code, and convergence under a
refusal-only repair loop. The orchestrator's recorded recommendation was
to gate the flip on a second-model-family replication; the author ruled
to flip now, and the gate items become flip workstreams below rather than
preconditions. The replication remains scheduled work, not a blocker.

## What "default" binds

1. `snapback2 init` scaffolds `snapback-quarry/*.q` (todos template in
   Quarry); `--template ts` keeps the current scaffold.
2. `snapback2 check`/`dev` run `quarryc` automatically when
   `snapback-quarry/` exists; generated `snapback/*.q.ts` are build
   artifacts (headered, never hand-edited).
3. Diagnostics on generated files map back to `.q` sites (the emitted
   `// q:<file>:<line>` markers become the reported sites).
4. The packaged guide carries the Quarry spec v0.3 as the authoring
   reference, reachable via `snapback2 guide quarry`.
5. **Spec truth rule:** the authoring spec states what the platform does,
   never the design intent of LLP 0329.014.004. v0.2's over-promises
   (`maintain`/`#`, `merge`, assets) were experienced as language
   friction by the first executed lane; v0.3 removes or explicitly marks
   them as not-yet-platform.

## Flip workstreams (commissioned with this ruling)

- **P0-A — the insert-return P1** (`issues/20260831-insert-return-
  reevaluates-row-expression.md`, verified): the paved emission idiom
  must not sit on silent id corruption. Single evaluation of insert row
  expressions (or certify-time refusal of impure builtins in row
  literals), regression pinning returned-row == stored-row, inline
  `ctx.now()` same class.
- **P0-B — quarryc graduation**: fix the branch-arm write-trace
  undercount (check-green/runtime-red is disqualifying in a paved path);
  fixtures for per-branch writes; init/check/dev/guide integration and
  `.q` site mapping per "What default binds"; the packaged-consumer
  smoke rung (`issues/20260831-packaged-consumer-smoke-rung.md`) now
  covering a Quarry-default scaffold end to end.
- **P1 — spec v0.3** (platform truth; orchestrator-authored) packaged
  into the guide.
- **P1 — replication**: rerun the .011 head-to-head with a second model
  family once P0s land; a regression in its verdicts reopens this
  decision's evidence, not the ruling by default.
- **P2 — parity instrument**: keep a standing two-surface fixture lane
  (same app, both front ends) as a platform test, per .011 open
  question 3.

## Non-claims

This does not publish anything (the first-publish ceremony remains the
author's), does not deprecate the TS surface, does not adopt LLP
0329.014.004's unimplemented dimensions into the platform, and does not
change Snapback 1.
