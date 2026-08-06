# LLP 0178: Generate-time authoring diagnostics

**Type:** RFC
**Status:** Review
**Systems:** Code generation, Developer experience, Diagnostics, Schema
authoring, Auth, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-05
**Revised:** 2026-08-05 (d) — Super-refine round 2 (delta): the round-1 fix's
second worked example itself machine-applied a schema-weakening change
(`v.array()` → `v.json()`) despite being introduced as policy-free —
replaced with a genuinely zero-semantic-content example (a re-exported,
already-known TypeScript type, per LLP 0176 catalog C3) that changes no
schema, plan, or runtime behavior. Also corrected a cross-reference
("§Issue catalog G1" is a delivery gate, not a catalog row; the intended
reference is catalog item B3). 2026-08-05 (c) — Super-refine round 1: fixed a direct
self-contradiction a reviewer caught — the worked diagnostic example applied
a single machine-applicable, no-approval remediation to exactly the
optional-argument policy choice this document's own §2 prose says must
receive multiple non-machine-applicable options instead. The example now
illustrates that policy-choice shape correctly, and a second, genuinely
mechanical example (V2's field-name-only fix) is added so the document still
shows what a real machine-applicable remediation looks like. 2026-08-05 (b) —
Rebased the proposal on Snapback's existing generate-time validation/
diagnostic pipeline; split certain contradictions from conservative
advisories; made validation unsuppressible; and replaced a prose-only `fix`
field with LLP 0146 typed remediations.
**Related:** LLP 0004, LLP 0074, LLP 0094, LLP 0095, LLP 0146, LLP 0157, LLP
0172, LLP 0173, LLP 0176

## Summary

The messaging bakeoffs behind LLP 0176 exposed several mistakes only after an
author paid for a live execution, even though codegen already possessed enough
information to identify some of them.

Snapback does not need a second, optional “lint system” to fix this. Codegen
already validates authored schema/functions, refuses invalid declarations,
and emits structured warnings. This RFC extends that owner with one explicit
classification:

1. **Authoring validation** for a contradiction that is proven from complete
   static facts. It fails generation and cannot be suppressed.
2. **Authoring advisory** for a conservative heuristic or incomplete proof. It
   never changes semantic admission and may be promoted to an error by CI.

The distinction matters. The earlier draft called the whole pass optional and
advisory, then made `error` findings fail by default while offering
`--allow-lint` to suppress them. That allowed a known contradiction to ride
through and treated a heuristic as equivalent to a proof. This revision
removes both ambiguities.

The governing rule is:

> Refuse a statically proven contradiction at generation. Advise on a useful
> but incomplete signal. Retain runtime enforcement for both.

## Authority and scope

This RFC owns the classification, diagnostic shape, initial checks, and
extension bar inside the existing codegen pipeline. It does not decide the
semantics being checked:

- LLP 0004/0157 own schema, validator, and admitted plan semantics.
- LLP 0172/0173 own the meaning of omitted function auth.
- LLP 0146 owns typed remediation vocabulary and automation safety.
- LLP 0094/0095 own any shared wire carrier for remediations.
- The relevant runtime subsystem remains authoritative when a value or control
  path is not statically knowable.

This RFC is not a prerequisite for LLP 0179–0181. Its first checks belong in
LLP 0176 G0 because they are cheap, independent improvements to the authoring
loop.

## Baseline

`packages/snapback-codegen` already has:

- authoring validation that returns `ok: false` and preserves the previous
  generated output rather than partially replacing it;
- structured diagnostics with `error | warning | info` severity;
- codegen summaries and review surfaces that retain warnings; and
- subsystem-specific checks and tests, including
  `authoring-validation.test.mjs`.

The new work is therefore a disciplined extension of that mechanism, not a new
CLI, plugin framework, or independent parser.

## Design

### 1. Two lanes

#### Validation

A validation finding requires a complete proof that the authored artifacts
contradict current Snapback semantics. It:

- uses severity `error`;
- makes generation return `ok: false`;
- preserves the previous complete generated output;
- has no inline, command-line, local-only, or CI-only suppression;
- is tested against the runtime refusal it front-runs; and
- stays enforced at runtime for defense in depth.

If legitimate authored input can trigger the check, the proof is incomplete
and the check belongs in the advisory lane.

#### Advisory

An advisory identifies a high-confidence pattern whose consequence cannot be
proved for every execution. It:

- uses severity `warning` or `info`;
- is present in codegen summary/review artifacts;
- does not alter the generated manifest's semantic meaning;
- states what the analysis did and did not prove; and
- may become build-blocking through an explicit consumer policy such as
  `--deny-advisories`, not by pretending to be a validation error.

V1 adds no per-rule suppression syntax. If real false-positive noise later
justifies acknowledgement, the acknowledgement must be rule-specific,
source-local, review-visible, and artifact-bound; it cannot suppress
validation.

### 2. Diagnostic shape

Findings reuse the existing diagnostic carrier and LLP 0146's remediation
model. A remediation is included only when the repair is mechanically valid.
Policy choices — making an arg required versus adding a missing-value
branch, or choosing a function's auth posture — receive multiple
non-machine-applicable options or a guide pointer, never one guessed patch.
Two examples, one of each shape:

**A policy choice (V1's optional-argument contradiction).** There is no
single correct fix — the argument could become required, or the plan could
grow a missing-value branch — so every option is `machineApplicable: false`
and `requiresApproval: true`:

```json
{
  "code": "SNAPBACK_AUTHORING_OPTIONAL_ARG_CONTRADICTION",
  "severity": "error",
  "subsystem": "codegen",
  "location": {
    "file": "functions.mjs",
    "line": 42,
    "symbol": "sendText"
  },
  "message": "replyToId is optional to callers but this plan requires it.",
  "details": {
    "argument": "replyToId",
    "validator": "optional",
    "planUse": "required"
  },
  "remediations": [
    {
      "kind": "makeArgumentRequired",
      "riskClass": "policy",
      "machineApplicable": false,
      "requiresApproval": true,
      "authorityEffect": "none",
      "description": "Drop v.optional(...) so the caller must always supply replyToId."
    },
    {
      "kind": "guidePointer",
      "riskClass": "policy",
      "machineApplicable": false,
      "requiresApproval": true,
      "authorityEffect": "none",
      "description": "Add a missing-value branch to the plan instead (not yet an admitted node — see LLP 0176 §Beyond the golden path)."
    }
  ]
}
```

**A genuinely mechanical fix.** Two prior attempts at this second example
both failed for different reasons, each caught by a later review round: the
round-1 version machine-applied a real schema-weakening change
(`v.array()` → `v.json()`), which round 2 fixed by substituting a
type-only example — but a round-3 review then correctly found *that*
example out of this RFC's own stated scope. §Design 1 defines validation
against "the authored artifacts" and §Baseline scopes the whole mechanism
to authoring validation over "the previous complete generated output";
§Non-goals excludes "a general JavaScript type/data-flow analyzer." A
repository package's hand-written `.d.mts` declaration file is neither
authored application input nor generated codegen output — codegen does not
produce it and has no standing reason to inspect or rewrite it, and
treating it as authoring-validation scope would mean this diagnostic firing
on every user's codegen run against a file inside their own
`node_modules`. A genuinely in-scope, genuinely zero-policy example needs
both properties at once: authored schema/plan input, and exactly one
possible correct value rather than a choice among several. A closed-set
literal typo is exactly that shape — where a declarative plan's literal
does not match any variant the schema's own discriminant union admits, and
exactly one admitted variant is an unambiguous case-insensitive match:

```json
{
  "code": "SNAPBACK_AUTHORING_UNAMBIGUOUS_LITERAL_TYPO",
  "severity": "warning",
  "subsystem": "codegen",
  "location": {
    "file": "functions.mjs",
    "line": 31,
    "symbol": "sendMessage"
  },
  "message": "lit('Text') matches no variant of messages.kind's declared union (v.union(v.literal('text'), v.literal('image'))); 'text' is the only case-insensitive match.",
  "details": {
    "authored": "Text",
    "admittedVariants": ["text", "image"],
    "uniqueMatch": "text"
  },
  "remediations": [
    {
      "kind": "replaceLiteral",
      "riskClass": "mechanical",
      "machineApplicable": true,
      "requiresApproval": false,
      "authorityEffect": "none",
      "precondition": { "artifactHash": "..." }
    }
  ]
}
```

This has no schema, storage, or plan-shape change (`messages.kind`'s
declared union is untouched — only the plan's literal argument changes to a
value the schema already, exclusively admits) and does not reach outside
authored application source. It is machine-applicable specifically
*because* the schema's own closed union proves there is exactly one
possible correct value, unlike the V1 optional-argument case above, where
multiple different real fixes exist and picking one is a policy choice —
the same distinction §2's opening paragraph draws, now illustrated by two
examples that both actually respect it.

No schema, stored data, plan, or runtime behavior changes — the generated
value's actual runtime shape is unchanged; only its declared type becomes
accurate. That is what distinguishes this from the array-field case: there,
multiple different real fixes exist (store as JSON, or wait for native
structured storage) and picking one is a decision; here, exactly one type is
already true and the fix only states it.

The exact remediation-kind registry and carrier follow LLP 0146 and the LLP
0094/0095 family; this RFC does not mint an incompatible `fix: string`
convention. Until the shared carrier lands, the same structure may remain in
codegen-local diagnostic details without claiming cross-projection support.

### 3. Initial checks

#### V1 — optional plan argument contradiction

When a generated caller type permits omission via `v.optional(...)` but an
admitted declarative plan uses `arg("x")` in a position whose current
semantics require presence, generation fails with
`SNAPBACK_AUTHORING_OPTIONAL_ARG_CONTRADICTION`.

This is a validation under today's semantics: the omitted call is admitted by
the generated type and guaranteed to fail with `SNAPBACK_ARG_MISSING`.
Valid repairs are to make the argument required, split the operation, or use a
future admitted missing-value node. V1 does not invent that node or equate
missing with JSON `null`.

#### V2 — result-only validator in a table field

The existing generator refusal for `v.array(...)` in a table field remains
validation. Improve it to distinguish:

- the immediate prototype workaround: store opaque JSON and narrow the
  function result; from
- the full missing product capability: typed structured stored fields with
  write validation, indexing, migration, sync, and portability semantics
  under LLP 0115 CV-4b.

The workaround is not machine-applied because it weakens guarantees.

#### V3 — stored-row spread into a narrower result

Analyze direct object spreads from statically traceable database rows.

- If codegen can completely prove the row's field set, the closed result
  contract, and that undeclared fields necessarily cross the return boundary,
  emit an unsuppressible validation naming the fields.
- If provenance is only heuristic—for example, the value passes through a
  helper or a branch codegen cannot close—emit an advisory describing the
  suspected fields and incomplete proof.
- If there is no useful evidence, emit nothing.

This rule intentionally prefers a false negative over a false validation. The
runtime result-contract check remains authoritative; naming the leaked field
instead of only its hash is a routed ask to that check's own owner (tracked
as LLP 0176 §Consolidated issue catalog **B3** and
`issues/20260805-result-contract-violation-hashes-field-path.md`), not a
requirement this RFC can issue against a subsystem it does not own.

#### V4 — function auth omission

Do not ship an advisory that implies an undecided policy. Once LLP 0172/0173
decide what omission means:

- if omission is invalid, make it validation;
- if omission is valid but discouraged in a named context, make it an
  advisory; or
- if the chosen default is intentionally safe and unambiguous, add no finding.

The check follows the decision; it does not make it.

### 4. Extension contract

Every new check proposal must state:

1. the reproduced failure or repeated authoring cost;
2. the exact static inputs and whether each is complete;
3. the current governing semantic rule and runtime enforcement;
4. validation or advisory classification;
5. false-positive and false-negative posture;
6. structured detail fields and value-redaction behavior;
7. typed remediation options and preconditions, if any; and
8. target/package tests proving generator and runtime agreement.

A style preference, speculative best practice, or rule without a named
semantic owner does not meet this bar.

## Integration with the descriptor spine

The ordering "validation runs before LLP 0179 emits an `AppDescriptor`" is
not a new dependency this RFC introduces — it restates that the *pre-existing*
codegen validation lane (§Baseline) already gates every generated artifact,
descriptor included, and this RFC's new checks (V1-V4) simply join that same
lane rather than adding a second gate. A failed generation never publishes a
partial or contradictory descriptor, exactly as it never publishes a partial
schema/function bundle today. Advisories may be summarized in the
descriptor's review/provenance material if the existing generated-artifact
owner admits that projection, but they are not runtime capabilities and
clients must not reinterpret them.

LLP 0181 may render these same diagnostics in an Expo development overlay. It
must preserve codes, details, risk classes, and preconditions rather than
converting them into Expo-specific strings or automatic edits.

## Non-goals

- A new linter CLI, arbitrary custom-rule plugin ecosystem, or general
  JavaScript type/data-flow analyzer.
- Replacing TypeScript, runtime contract enforcement, or target admission.
- Suppressing a proven invalid artifact for development convenience.
- Deciding optional-value, auth-default, structured-storage, or result-contract
  semantics.
- Fabricating source rewrites for policy or authority decisions.
- Making LLP 0178 a dependency of application surfaces, commands, or Expo
  binding.

## Acceptance

- A B1 fixture fails generation before output replacement and before runtime,
  while its equivalent runtime path remains refused.
- The B2 refusal distinguishes a stopgap from the unimplemented structured
  storage capability and does not auto-weaken the schema.
- A completely proved B3 fixture fails and names leaked fields; a deliberately
  incomplete-provenance fixture produces only an advisory or no finding.
- No flag or inline comment can suppress validation.
- Advisories remain visible in the codegen summary/review surface, and an
  optional strict consumer policy can reject them without changing their
  classification.
- Emitted remediations satisfy LLP 0146's independent risk,
  machine-applicability, approval, authority-effect, and precondition axes.
- V4 remains absent until LLP 0172/0173 decide the governing policy.

## Open questions

1. Should the first implementation reuse only codegen's current diagnostic
   object, or wait for the LLP 0094/0095 remediation carrier before emitting
   the full `remediations` array?
2. Which minimal source-analysis subset catches the reproduced B3 case with a
   complete proof?
3. Should strict advisory policy be a codegen flag, a `snapback verify`
   profile, or both projections over one policy fact?
4. Do advisory acknowledgements need to exist at all after the first rule
   corpus is measured?

## Status

Review. V1 and the B2 message improvement are the strongest first slice. V3
must demonstrate a genuinely complete proof before any case enters validation.
V4 is blocked intentionally on LLP 0172/0173. This RFC extends the existing
authoring-diagnostic pipeline; it does not create a parallel lint subsystem.
A super-refine round-1 review found the worked diagnostic example
self-contradicted the document's own machine-applicability rule; fixed with
two corrected, distinct examples (§Design 2).
