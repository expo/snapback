# LLP 0237: Bounded handler modules

**Type:** RFC
**Status:** Accepted
**Systems:** Authoring, Code generation, Runtime, Security, Application data
API, Developer experience, Diagnostics, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (post-acceptance authoring-program amendment: names
LLP 0246 as the separately reviewed TypeScript-custody owner and LLP 0249 as
the explicitly non-portable trusted-package boundary; neither widens this
accepted portable profile). 2026-08-12 (entered Review for the author-directed single-family
`llp-super-refine` loop: Codex GPT-5.6-sol xhigh only; Claude intentionally
skipped). 2026-08-12 (mechanically renumbered from LLP 0235 to LLP 0237 after
origin assigned LLPs 0234–0235). 2026-08-12 (author-directed acceptance after
Round-3 same-revision Codex GPT-5.6-sol xhigh convergence). 2026-08-12 (round-1 revision: froze graph cycles/re-exports, v1 ESM
custody, profile-selection evidence, and graph-edge identity shared with LLP
0241). 2026-08-12 (initial Draft synthesized from LLP 0236 P2, P11, and P12 and
the option space in LLP 0118)
**Related:** LLP 0009, LLP 0010, LLP 0061, LLP 0108, LLP 0115, LLP 0118,
LLP 0146, LLP 0178, LLP 0193, LLP 0203, LLP 0236, LLP 0238, LLP 0239,
LLP 0240, LLP 0241, LLP 0242, LLP 0243, LLP 0246, LLP 0249, Diary 0032, Diary 0033,
Diary 0039, Diary 0057, Diary 0058

## Summary

Snapback should admit ordinary helper reuse inside a closed, bounded,
content-addressed handler module graph. The authored surface remains familiar
ECMAScript modules with relative imports, but codegen—not the host module
loader—owns resolution, admission, bundling, identity, and diagnostics. Node
built-ins, packages, dynamic loading, ambient filesystem/network access, and
unbounded top-level evaluation remain unavailable.

This RFC chooses the follow-on that LLP 0108 left open and LLP 0118 analyzed:

1. keep inline declarations as the operation registry and source of contracts;
2. let a handler reference same-file helpers and admitted relative helper
   modules;
3. extract only the statically reachable handler graph;
4. refuse the graph before artifact replacement if any edge, initializer,
   syntax form, capability, or bound is unsafe or non-portable; and
5. publish the exact admitted runtime profile as a machine-readable artifact
   and as point-of-need diagnostics.

The goal is not “Node in the backend.” The goal is to make Snapback’s portable
deterministic dialect feel like a legible, composable language before an agent
authors against it.

## Improvement-set map

LLP 0236 synthesizes fourteen frictions. This proposal set groups the durable
product decisions by independently reviewable safety boundary:

| LLP | Decision boundary | LLP 0236 findings |
| --- | --- | --- |
| 0237 | bounded handler modules and legible runtime profile | P2, P11, P12 |
| 0238 | one explicit client lifecycle vocabulary | P4, P5, P11, P12 |
| 0239 | optional/multi-media as first-class asset application APIs | P3, P7, P11, P12 |
| 0240 | one product roster and declared authority profile | P6, P11, P12 |
| 0241 | semantic artifact identity and generation custody | P9, P11–P14 |
| 0242 | bounded children/aggregate/activity/feed plans | P10, P11, P12 |
| 0243 | policy-aware protected offline retained views | P8, P11, P12 |

Password credentials (P1), exact stored structured values (P7), truthful outbox
settlement and client diagnostics (P4/P11), and the zero-config/readiness path
(P13/P14) already have active owners in LLP 0227, LLP 0211, LLP 0218/0219,
and LLP 0223/0224. The sibling RFCs compose with those documents rather than
reopening them.

## Motivation

LLP 0236 identifies the handler environment as a convergent cross-model
friction. Builders repeatedly wrote idiomatic imports, helper calls, array
indexing, computed access, typed arrays, or Node crypto and learned the actual
runtime only after codegen or integration refused them. The refusals were often
good; the architectural rework was not.

The narrow self-contained-handler profile protected real invariants, but it
also duplicated domain logic. Streak Lab copied calendar transformations into
multiple handlers. Relay Board repeated indexed reads. Recipient-grant policy
code could not use normal factored helpers. This makes the app harder to review
and can cause two copies of a security- or date-sensitive rule to drift.

LLP 0108 already ships same-file helper sharing and contains the reviewed
blueprint for a closed handler graph. LLP 0118 found that helper composition is
separable from ambient runtime expansion and that Snapback already has a
fail-closed definition-module resolver. The remaining decision is to admit a
bounded handler-only graph without weakening runtime capability custody.

## Constraints inherited from existing design

- Executable custody remains closed and content-addressed. No runtime lookup
  may reach arbitrary checkout files or package resolution (LLP 0108#identity-artifacts-and-public-custody).
- Handler capabilities remain explicit and target-portable. Imports cannot
  become a side door to filesystem, process, network, entropy, or clock access
  (LLP 0009#runtime-boundary).
- A captured read/write set is evidence; it does not silently become a new
  authorization model or an enforced table ceiling (LLP 0146#d1-declarationobservation-conformance).
- The shipped fresh-per-invocation runtime posture governs cost analysis. This
  RFC does not rely on a warm bundle pool (LLP 0118#what-snapback-does-today).
- Generation is fail-closed: a bad candidate leaves the last complete artifact
  graph untouched (LLP 0108#identity-artifacts-and-public-custody).
- Diagnostics must identify the failed rule, source span, and next admissible
  move (LLP 0203#p2-every-failure-names-the-next-move).

## Decision

Adopt a new `bounded-handler-modules-v1` admission profile. It is an additive
successor to the self-contained and same-file profiles, not a reinterpretation
of their already-generated artifacts.

### D1. Authored shape: inline operation, ordinary helper imports

An operation remains declared where its arguments, result, authority, reads,
writes, effects, and capabilities are visible:

```js
import { civilDay, nextStreak } from "./lib/streak.mjs";

export const recordCheckIn = defineMutation({
  args: { at: v.string() },
  result: results.document("streaks"),
  reads: ["streaks"],
  writes: ["streaks"],
  handler: async (ctx, { at }) => {
    const day = civilDay(at);
    return ctx.db.patch("streaks", ctx.auth.userId, {
      count: nextStreak(day),
    });
  },
});
```

Codegen may retain helpers from the same file and from literal relative ESM
imports ending in `.js` or `.mjs`. The handler cannot be exported from a
separate registry file, named by string, or discovered dynamically. The
operation declaration remains the review locus.

Bare/package specifiers, `node:` specifiers, URL imports, absolute paths,
CommonJS, dynamic `import()`, re-export stars, import attributes, and symlink or
case-fold escapes outside the canonical Snapback source root refuse.

V1 also refuses every named re-export and every import or reachable-helper
strongly connected component with more than one declaration. Self-recursive
functions remain admitted under the existing handler rules, but mutual helper
recursion and module cycles refuse with a cycle trace. V1 therefore has no
transform-dependent ESM temporal-dead-zone or re-export-chain semantics. These
rules are entries in the generated runtime profile, not bundler accidents.

V1 custody is only emitted `.js`/`.mjs` ESM bytes plus source maps. Direct
`.ts` custody is deferred until a separately reviewed transform pins compiler,
configuration, source-map, and transform identity; v1 does not add an in-runtime
TypeScript compiler. LLP 0246 owns that follow-on without changing this v1
compatibility contract. Package-capable host execution, if admitted, is the
separate target-specific action profile proposed by LLP 0249; it never makes a
package import legal inside `bounded-handler-modules-v1`.

### D2. Closed graph and frozen bounds

Codegen resolves every edge through a Snapback-owned fail-closed resolver and
extracts only statically reachable declarations. V1 adopts the already-reviewed
LLP 0108 envelope:

- at most 64 source files;
- import depth at most 16;
- at most 512 KiB of admitted source bytes; and
- at most 256 KiB of final handler bundle bytes.

Every graph record carries importer span, normalized root-relative target,
source digest, module format, and extractor/admission version. Files are read
through a stable snapshot; a file that changes between parse and attested reread
refuses the candidate.

Allowed top-level forms are imports, function declarations, and `const`
bindings initialized by a closed pure-data grammar: literals, arrays and plain
objects without spreads/accessors, references to earlier admitted constants,
and calls to a versioned Snapback-owned pure-helper allowlist. Classes,
top-level calls into application code, mutation, `new`, getters, computed
initializers, environment reads, await/yield, and expression statements refuse.
Function bodies are scanned separately under the handler capability profile.

Tree shaking is not a security boundary. A forbidden construct in a reachable
declaration refuses even if a third-party bundler would erase it. Snapback’s
resolver and scanner own admission; a bundler may only host the deterministic
transform.

### D3. Safe JavaScript becomes less surprising

The admitted language keeps the restricted no-eval runtime and its forbidden
reflection keys, but v1 widens common data manipulation where it can be proved
safe:

- ordinary array indexing by a bounded integer expression is admitted;
- computed object access is admitted when codegen proves the key is a literal
  or closed literal union excluding `constructor`, `prototype`, and
  `__proto__`;
- dynamic computed access whose key cannot be so proved refuses with a
  diagnostic that names the unsafe key path and suggests an admitted map,
  switch, or validator spelling; and
- ordinary arrays and plain objects are the portable byte/data tools. Typed
  arrays, host buffers, Node crypto, and ambient Web APIs remain absent until a
  separate capability RFC defines cross-runtime semantics.

These are syntax admissions, not authority inference. A helper may receive
`ctx`, `ctx.db`, or an asset/action capability from its caller. The final closed
graph is scanned for the same capability use as inline code, and invocation-time
host checks remain authoritative. Codegen records a per-helper observed
capability summary for review, but does not pretend to prove semantic purity or
derive authorization from function signatures.

“Bounded integer expression” is a closed, versioned grammar: non-negative
safe-integer literals, finite generated integer-contract values, and canonical
checked literal arithmetic/induction over them. Each access is length-guarded;
overflow, negative, fractional, non-finite, out-of-range, or unproved forms
refuse at the source span. The implementation Spec freezes AST vectors and the
runtime-profile artifact publishes the executable rule table.

### D4. Runtime and implementation identity

Each operation still emits its own callable registration entry. Its
implementation identity binds:

- the canonical handler AST;
- every reachable helper AST and normalized graph edge;
- argument/result, authority, read/write, effect, and capability declarations;
- admission, transform, bundle, runtime, and target-profile versions; and
- final executable bytes.

For a multi-file operation, the normalized root-relative module targets and
the complete directed graph topology are behavior inputs: renaming or moving a
helper rotates semantic and executable identity whenever any admitted graph
record changes, even if canonical helper AST bytes are equal. Absolute checkout
paths, source spans, source maps, comments, and formatting are evidence only.
A relocation is evidence-only solely when the canonical executable graph record
and final executable bytes are byte-identical. LLP 0241 uses this same
conservative v1 rule; neither generator may infer behavioral equivalence from
equal helper bodies alone.

Comments, formatting, source locations, and `@ref` prose live in a separate
`sourceEvidenceHash`; they remain reviewable provenance but do not change the
executable implementation identity when the canonical executable graph is
unchanged. LLP 0241 generalizes this two-hash rule to the whole artifact
generation.

The server receives only the admitted bundle and graph identity, never an
ambient module resolver. Fresh-per-invocation targets evaluate the bundle for
each invocation. Any future pooling proposal must separately price bundle size,
module state, and reset behavior; this RFC neither assumes nor authorizes it.

### D5. Preflight is available before generation

The package CLI gains:

```sh
snapback generate --check --json
```

It performs source discovery, graph resolution, syntax/capability admission,
contract checking, and target-profile compatibility without replacing emitted
artifacts. The normal `snapback generate` runs the identical checker before
commit.

The result uses the existing structured diagnostic grammar. Every refusal
includes:

- stable code;
- operation and helper graph;
- exact file/line/column span;
- violated profile rule;
- an admitted alternative or explicit statement that no equivalent exists;
- the current limit and observed value for bounds; and
- a build-bound guide anchor.

Definition serialization errors must attribute the exported binding or field
that produced the unserializable value. A top-level unexported operation or an
invalid asset option can no longer collapse to an unattributed
`SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE`.

### D6. The runtime profile is a generated product surface

Codegen publishes `handler-runtime-profile.v1.json` beside generated schemas.
It is derived from the same rule tables the checker executes and contains:

- admitted module specifiers and graph bounds;
- cycle/re-export rules and the closed integer-index grammar;
- admitted/forbidden syntax forms;
- available globals by operation kind;
- computed-access rules;
- runtime capabilities and target differences;
- diagnostic codes and guide anchors; and
- profile/admission versions bound into artifacts.

Each operation record also states why this profile was selected:
`explicit` or `required-by-import`. Rollback and diagnostics never depend on an
ambient CLI flag that is absent from the generation.

The generated TypeScript declarations, control catalog, served guide, MCP
surface, and `snapback guide` exact lookup consume this artifact. They do not
hand-transcribe separate restriction lists. A cold-agent retrieval test must
reach the profile from “Can I import a helper?”, “Can I use Node crypto?”, and
the relevant diagnostic codes.

### D7. Portability is checked, not presumed

The local Hermes path and Workerd/V8 conformance twin admit the same v1 source
corpus or emit a declared target capability gap before generation. The corpus
includes helper graphs, array indexing, closed computed access, forbidden
reflection keys, top-level side effects, graph-boundary attacks, and diagnostic
goldens.

An app may request `portable: true` to require admission on every supported
target profile it names. A target-specific handler profile, if later admitted,
must be explicit in the operation declaration and capability manifest; it may
not be inferred from an import.

## Compatibility and migration

Existing self-contained and same-file handler artifacts remain valid under
their recorded profile versions. A handler enters the new profile only when its
closed executable graph contains an admitted helper import or when the app opts
in explicitly for portability checking.

Generated clients keep stable operation ids. The implementation hash changes
when executable helper semantics change, preserving stale-reference protection.
A comment-only or `@ref`-only edit changes source evidence but not executable
identity under D4.

The first release exposes the new profile behind an app-level capability flag.
After one release with the conformance corpus green, codegen may select it
automatically when an otherwise-valid helper import is present. It never
silently broadens a previously generated operation’s runtime capabilities, and
the generated selection-reason field distinguishes that automatic path from an
explicit opt-in.

## Alternatives considered

### Keep self-contained handlers and improve docs

Declined. It makes the restriction more legible but preserves duplicated domain
logic and the late architectural extraction that the cross-model evidence
reproduced.

### Restore the legacy handler registry

Declined. It shares helpers inside one file but reintroduces duplicated
operation names, source/export wiring, and navigation away from the declaration
that owns contracts and authority.

### Bundle the ordinary application dependency graph

Declined. Package resolution, transitive install scripts, Node built-ins, and
unbounded module initializers erase Snapback’s portable and reviewable runtime
boundary.

### Ship a Snapback-only helper DSL

Declined as the default. A DSL could be easy to analyze, but agents already know
functions and relative modules. The safer leverage is a closed admission
profile over familiar syntax.

## Rollout

1. **Profile artifact and preflight.** Generate the restriction artifact from
   current self-contained rules; attribute all definition failures; add cold
   retrieval probes.
2. **Same-file parity corpus.** Run current helper sharing through the new graph
   representation without imports and prove byte/behavior parity.
3. **Relative helper imports.** Land closed resolution, graph identity, bounds,
   and the local/Workerd corpus behind the capability flag.
4. **Safe syntax widening.** Admit bounded array indexing and provable computed
   keys with adversarial reflection tests.
5. **Default selection.** Enable automatic profile selection only after the
   affected-scope proof and a fresh external npm build reproduce the motivating
   Streak Lab and recipient-policy helpers without source inspection.

Per LLP 0189, phases use affected checks at landing and the scheduled complete
battery for broader drift. No phase waits for a quiet `main`.

## Acceptance

- Streak Lab shares one civil-date implementation across a query and mutation;
  Relay Board shares one indexed reader; neither duplicates helper code.
- The exact transitive graph and capability summary are inspectable from the
  generated artifact and agent digest.
- A package import, path escape, dynamic import, top-level side effect,
  reflection-key escape, or post-read file mutation fails before artifact
  replacement with source-attributed remediation.
- Array indexing and a closed safe computed-key union behave identically on
  Hermes and Workerd/V8; unsafe dynamic property access refuses.
- Comments, formatting, and `@ref` edits preserve implementation identity;
  executable helper changes rotate it.
- A failed candidate leaves the previous complete generation runnable.
- A cold agent given only the npm package reaches the restriction profile and
  fixes one import refusal without reading package source.
- The fresh-per-invocation benchmark reports bundle parse/evaluation p50/p95 for
  1, 8, 32, and 64-operation graphs. Results are a cost record, not an
  acceptance threshold until an author rules one.

## Risks

- A “small” module graph can become a shadow general-purpose runtime. Closed
  specifiers, top-level grammar, capability scans, and target conformance are
  therefore admission rules, not documentation.
- Canonical AST identity can accidentally erase semantically relevant syntax.
  Cross-runtime golden vectors and final-byte binding are the backstop.
- Context-reader helpers may conceal authority-relevant behavior from a casual
  declaration review. Per-helper capability summaries and LLP 0146 conformance
  evidence expose the behavior without falsely making declarations ceilings.
- Larger fresh-evaluated bundles can regress invocation latency. The rollout
  records the curve before default admission and retains self-contained output
  as an escape hatch.

## Open questions

1. Should safe dynamic computed access eventually use a runtime guarded-key
   primitive, or is static closed-key proof the permanent portable boundary?
2. Which capability summaries belong in generated public client metadata versus
   authenticated developer inspection?

## Status

Accepted. The document requests an author decision on the bounded module profile,
including the reviewed 64-file/16-depth/512-KiB-source/256-KiB-bundle envelope
as the opt-in v1 compatibility contract. Benchmarks may justify a smaller
automatic default but may not silently widen the contract. No runtime or
codegen surface changes until acceptance.
