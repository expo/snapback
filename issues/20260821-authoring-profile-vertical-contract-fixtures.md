# Add packed vertical contract fixtures for advertised authoring paths

**Status:** Open
**Opened:** 2026-08-21
**Systems:** Guide, Public package exports, TypeScript, Code generation,
Handler runtime, React/headless clients, Authoring profiles, Diagnostics
**Governing:** LLP 0295 vertical paved-path coherence invariant and D0.3/W3;
LLP 0061; LLP 0252; LLP 0253; LLP 0275
**Related:** `issues/20260820-guide-gap-familiar-handler-dialect.md`;
`issues/20260820-familiar-vdoc-generation-runtime-parity.md`;
`issues/20260820-guide-gap-membership-roster-projection-recipe.md`

## Problem

Layer-local tests allow an advertised path to change meaning across the Guide,
public entrypoint, generated types, codegen, runtime validation, client hooks,
and diagnostics. The current Familiar page demonstrates the class directly:
nullable document/direct object result spellings and membership
`resourceField: "_id"` do not agree with current generated/runtime contracts,
while membership-backed ephemeral behavior exists below an entrypoint that
does not expose the needed constructor.

Fixing only the page, generator, or runtime can move the mismatch one boundary
downstream.

## Scope

- Provide a reusable packed-external-package fixture shape that starts from one
  first-read Guide spelling and checks its advertised import.
- Typecheck and generate it from a clean application in one pass.
- Run the generated artifact and assert the exact result, nullability,
  authority, and lifecycle contract through the relevant headless/framework
  client.
- Add one negative case whose earliest capable layer refuses with a stable
  diagnostic and one supported rewrite.
- Start with the confirmed Familiar cases: nullable point results, closed
  object/value results, document results, membership resource identity, and
  the profile's ephemeral export path.
- Add the fixture as an acceptance obligation to future fixes that change an
  advertised authoring path; do not turn internal lowering syntax into public
  contract.

## D0.3 ruling (2026-08-21) — Adopted per LLP 0295; author may revise

The D0.3 decision packet landed in the owning LLPs:

- **LLP 0253 S9** — the Familiar product contract (rulings R1–R7) and the
  complete vertical contract fixture catalogue (S9.2, `VCF-F-*` /
  `VCF-E-*`).
- **LLP 0275 D8** — the fact-by-fact Explicit classification (policy vs
  derivable vs environment-integrity vs evidence) and the Explicit economy
  lane registration.
- **LLP 0252** cross-reference (2026-08-21) — the RFC-level summary: Familiar
  promises vertical coherence beyond vocabulary; Explicit promises decision
  density beyond maximal declaration; parity is reachability parity;
  profile choice may vary by client stack/template without a semantic fork.

Key rulings, in brief:

1. One-pass clean generation and codegen↔runtime phase parity are contract
   (LLP 0253 S9.1 R1); the `v.doc` bootstrap and mutation-doc runtime
   failures are implementation defects, tracked in
   `issues/20260820-familiar-vdoc-generation-runtime-parity.md`.
2. The S4.3 r5 result partition is normative at every layer: nullable point
   results and closed value objects are supported through `results.value`;
   the current lowering/runtime refusals are defects, and the guide keeps
   the spec's promise (R3). The singleton-array form is an interim
   workaround only.
3. Entrypoint/export parity: buildable-but-unexported is a contract
   violation; the ephemeral declaration constructor joins the
   `@expo/snapback/server` and `generated/server` closed export lists (R4).
4. Feature parity is reachability parity (nameable, sanctioned escape, or
   stable refusal+route), not constructor parity (R5). Sequences stay
   disposition 4 with a first-read-discoverable route. Membership resource
   identity has exactly one spelling shared across profiles; the guide's
   `resourceField` rows must corroborate against the canonical grammar.
5. The generator suggests profile switches only at disposition-4 refusal
   sites, Familiar→Explicit only, never on success (R6).
6. **LLP 0295 open question 2 — recommendation:** templates may choose
   profiles by workload/client stack while preserving one normalized
   definition; Familiar is not required to reach constructor-level feature
   parity (R7). No semantic fork arises (one profile per app, profile-free
   normalized witness, no-branch gate, name-preserving migration).
7. No default-profile change; that stays gated on the N≥3 wave.

## W3 lane checklists

**Familiar coherence lane:**

- [ ] One-pass clean generation with schema-derived `v.doc` results
      (VCF-F-G1) and mutation-doc runtime parity (VCF-F-M1) — closes
      `issues/20260820-familiar-vdoc-generation-runtime-parity.md`.
- [ ] Implement the S4.3 catch-all rows the lowering currently refuses:
      nullable point result (VCF-F-Q6) and closed value-object live query
      (VCF-F-Q7); align guide, types, codegen, runtime, and client on the
      one partition.
- [ ] Row-shaped partition fixtures VCF-F-Q1..Q5, VCF-F-Q8, VCF-F-M2,
      VCF-F-N1, VCF-F-A1 green from packed packages.
- [ ] Ephemeral constructor re-exported from `@expo/snapback/server` and
      `generated/server`; export-parity check over every claimed
      disposition-1/2 constructor; VCF-F-E1 green.
- [ ] Membership resource-identity spelling corroborated across guide,
      generated, and runtime contracts; VCF-F-MB1 (paired with VCF-E-MB1)
      green.
- [ ] First-read handler-dialect table plus retrieval-eval cases and
      pre-output refusals with supported rewrites (VCF-F-D1..D4) — closes
      `issues/20260820-guide-gap-familiar-handler-dialect.md`.
- [ ] Sequence refusal route stable and first-read-discoverable (VCF-F-SQ1);
      asset intent recast with retrieval + negative steps (VCF-F-AS1).
- [ ] Profile-switch suggestions confined to disposition-4 refusal sites.

**Explicit economy lane:**

- [ ] Plan-derived result contracts (LLP 0275 D3) with provenance markers;
      duplicate `result:` blocks removed from first-party templates;
      VCF-E-P1..P3 as receipts — via
      `issues/20260817-0275-derive-closed-plan-result-contracts.md`.
- [ ] Auto-qualification in the ordinary proof (LLP 0275 D4) — via
      `issues/20260817-0275-auto-qualify-packaged-runtime-in-prove.md`.
- [ ] Single-source, staleness-aware acceptance registration (LLP 0275 D5)
      — via `issues/20260817-0275-single-source-verify-path-registration.md`.
- [ ] Advertised-path fixtures VCF-E-Q1..Q4, VCF-E-M1..M2, VCF-E-MB1,
      VCF-E-E1, VCF-E-AS1, VCF-E-SQ1 green from packed packages.
- [ ] Ceremony measurement per LLP 0275 D7: fewer transcribed derivable
      facts and manual platform commands with identical policy, type,
      runtime, and evidence verdicts.

## Exit

Every initial case has one packed vertical receipt covering Guide retrieval,
public import/typecheck, clean generation, runtime behavior, client projection,
and a negative diagnostic. Supported spellings agree at every layer;
unsupported spellings refuse before emitting artifacts that a later layer
rejects. The fixture is cheap enough for affected-scope use and does not
require the complete benchmark. The catalogue of record is LLP 0253 S9.2;
both W3 lane checklists above are complete or explicitly re-routed by the
author.
