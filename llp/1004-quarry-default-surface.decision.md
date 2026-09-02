# LLP 1004: Quarry is Snapback 2's default authoring surface

**Type:** Decision
**Status:** Accepted
**Systems:** Authoring surface, `snapback2/packages/quarry`, dev loop,
templates, guide, diagnostics
**Author:** Charlie Cheever (ruling); Claude Fable 5 (orchestrator, record)
**Date:** 2026-08-31
**Revised:** 2026-09-02
**Related:** LLP 1000 (decision 10), LLP 1002, LLP 1007 (§2, §5), LLP 0329.014.004,
.009, .010, .011, `spikes/clique-diagnostic-runs/`,
`snapback2/packages/compiler/src/quarry/`, `snapback2/packages/snapback2/guide/quarry.md`

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

## Implementation record (2026-09-02)

LLP 1007 §2 found, on 2026-09-01, that none of the five bindings above existed
in code, that the default language could not express the shipped `chat`
template, and that the bridge was a compatibility shim `rules/RULES.md` bans.
The flip was built and landed on 2026-09-02 (`<SHA>`). What binds now, and
where the code departs from the letter of the ruling:

1. **Layout.** One directory, not two: a Quarry backend is `snapback/schema.q`
   plus `snapback/<module>.q`, beside the unchanged `seed.ts`, `tests/`, and
   any TypeScript effect module. There is no `snapback-quarry/` and there are
   no generated `snapback/*.q.ts` files. The reason the ruling named a second
   directory — the unchanged worker could not read Quarry — is gone.
2. **The front end lives inside the compiler.** `quarryc` is no longer a
   program or a package; `packages/quarry` is deleted. The Quarry front end is
   `packages/compiler/src/quarry/`, and the worker's `lowerProject` compiles
   `.q` sources to the TypeScript authoring text **in memory** and lowers it as
   virtual modules. Nothing is written under `snapback/`; the generated text is
   available under `.snapback/build/quarry/` for inspection only. The dual
   `.ts`/`.q.ts` emit and the `__quarrySource` sentinel are deleted.
3. **Sites.** Diagnostics on Quarry sources report `snapback/<file>.q:line:col`
   (the emitted `// q:file:line:col` markers are consumed by the compiler, not
   by the reader), including certification refusals from the binary; rewrites
   for Quarry-origin refusals are Quarry text. Quarry's own refusals are one
   family, `quarry`, with codes `E_QUARRY_*`, each with a `guide` page.
4. **The guide.** `snapback2 guide quarry` serves `guide/quarry.md`, which is
   the Quarry v0.3 reference and states only what the platform does (item 5
   above); `guide grammar` is the Quarry one-screen grammar and `guide
   typescript` is the TypeScript surface.
5. **`init`.** `snapback2 init [--template todos|chat]` scaffolds Quarry;
   `--ts` scaffolds the TypeScript rendering of the same template
   (`--template ts` is accepted and is equivalent to `--template todos --ts`).
6. **The language grew to the platform** (spec truth cuts both ways): v0.2's
   `maintain` was refused because the platform lacked it on 2026-08-31; the
   platform has had `maintains` since `c6c3123a4`, so Quarry now spells
   `maintain t = count|sum … by …:` with the target's read rule and an optional
   `readable` disclosure, `#t[key]` reads the int, `effect … from <module>` +
   `emit` reach the effects subsystem, and `principal`, `json`, `bytes`, text
   ranges/formats, `immutable`, `after insert` (final-exists), `created`,
   `system`, `(old, next)` update rules, `return`, object literals, `count`,
   `where` on range reads, and inline `new` are all spelled. `asset`, `schedule`, `merge`,
   `decimal`/`money`, `while`, and user functions remain refused as
   not-platform.
7. **Blocking coverage.** The Quarry tests run in the compiler leg of
   `snapback2/scripts/test.sh`; the check count stays five (LLP 1007 §5 item 8).
   Both templates ship in both renderings (`todos`, `chat`, `todos-ts`,
   `chat-ts`), and the same journeys pass against each; with the
   Hermes-featured binary (`scripts/hermes build -p snapback2`) the `chat`
   receipt is a full pass in both renderings, the `effects` check included.

Workstream status: P0-A (insert re-evaluation, LLP 1007 §5 item 1) and P0-B
(branch-arm write accounting, item 2, plus init/check/dev/guide integration,
item 9) landed in the same change; P1 spec v0.3 is `guide/quarry.md`; P1
replication and P2 the parity instrument remain scheduled, not started. The
packaged-consumer smoke rung (`issues/20260831-packaged-consumer-smoke-rung.md`)
is LLP 1007 §5 item 7 and is still open.

## Non-claims

This does not publish anything (the first-publish ceremony remains the
author's), does not deprecate the TS surface, does not adopt LLP
0329.014.004's unimplemented dimensions into the platform, and does not
change Snapback 1.
