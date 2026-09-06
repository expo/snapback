# Snapback 2: nested named-shape collections refuse with generated alias names

**Status:** Resolved in `s2/clique-shapes` (parent review and landing pending)
**Date:** 2026-09-06
**Systems:** Snapback 2 Quarry shapes, collection lowering, diagnostics
**Source:** Astra-medium full Clique M3 on npm `snapback2@0.0.6`

A reusable message shape containing a nested, shaped receipt-target collection
fails with `E_OPAQUE`. The diagnostic refers to the compiler-generated name
`__q_rows_3_178_s41` and says it is aliased under another binding. Its `rewrite`
contains the entire original Quarry module rather than an actionable repair.

The published-only source and complete refusal are retained on the office M1
in `/Users/ccheever/clique-improvement/lanes/astra-snapback2-006/`, especially
`evidence/m3-check.log`, `snapback/chats.q`, and `diaries/run.md`. The log keeps
the original module even though the app subsequently uses separate per-message
live queries for receipt targets.

The relevant authored shape is:

```text
shape target = { recipient, state, active: exists members[.membership] }
shape messageCard = { *, author: profiles[.sender] person,
  quoted: messages[.quote] { id, body, sender },
  targets: targets[.conversation, .id] first 50 by byConversationMessage target }
```

It is used by a 20-message history page and by a nested recent-message shape
in the inbox. The same run separately hit legitimate inbox resource bounds
and reduced that page; do not confuse those explicit bound refusals with this
generated-binding refusal.

## Resolution

Implemented on 2026-09-06 from integration base
`754abdad16df7cd330bc90beaf5c64d82c07b0df`, including the cursor IR fixes.
The reproduction used only this issue and the immutable copy at
`/Users/ccheever/clique-improvement/revisions/nested-shapes/published-m3-check.log`;
the current benchmark app was neither inspected nor modified.

Named-shape field lowering inserted a diagnostic-site binding of the form
`const shapeField = rows`. The target `rows` collector is mutated during
projection, so the lowerer's ordinary alias check correctly refused that
generated TypeScript. The binding now takes an explicit spread copy for a
collection. Alias/escape enforcement, shape expansion hygiene, bounds, read
rules, and cursor derivation are unchanged. No internal name pattern is trusted.
The authored bounded shape compiles; its generated-name refusal and whole-module
rewrite disappear. Resource ceilings still refuse independently through the
existing authored-line certification diagnostic path.

Regression coverage in the existing compiler test files exercises both local
and imported `messageCard`, its nested target/point shapes, a 20-message history
page and continuation, inbox recent-message pages, and two point expansions.
Different recipients per message, an empty target collection, hidden target and
author rows, and absent membership/quote reads check isolation and RBAC. The
certificate must select the enclosing page for its cursor and refuse a reduced
examined-entry ceiling. Generated-looking bindings still refuse real aliases
and escapes, with compiling explicit-copy repairs.

Verification ran on M5 `ccheever@100.88.75.121` in the separate named
`clique-shapes` worktree and its private `snapback2/target` cache:

- Before the production edit, the integrated compiler reproduced `E_OPAQUE`
  at `chats.q:3:178`, including `__q_rows_3_178_s41`, for history, inbox, and
  repeated point expansions (`/tmp/clique-shapes-before.log`). The regression
  passes after the edit (`/tmp/clique-shapes-after.log`).
- Compiler: `bun run check` passed; `bun src/test.ts` passed 402/402 after
  building the package with `node build.mjs`. The initial fresh-lane run lacked
  package declarations and exceeded a cold fixture-build timing budget; the
  prepared, warm rerun passed.
- After strengthening the fixture to use distinct recipients and an empty
  target collection, all 104 affected Quarry/collection checks and compiler
  type checking passed (`/tmp/clique-shapes-affected-final.log`).
- Evaluator: `bun src/test.ts` passed 216/216 conformance cases and 2/2
  visibility checks (24 server-only cases remain excluded by that runner).
- Engine: `cargo nextest run --config-file ../.config/nextest.toml --profile
  local-proof -p snapback2-core --no-fail-fast` passed 382/382, one skipped.
- `caps`, `ref-check --verbose`, and `git diff --check` passed.

No new scripts, checks, registries, config files, or design documents were
introduced. No main update, push, or npm publication; the parent owns review
and landing.
