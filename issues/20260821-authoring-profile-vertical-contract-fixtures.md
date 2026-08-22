# Add packed vertical contract fixtures for advertised authoring paths

**Status:** Open
**Opened:** 2026-08-21
**Systems:** Guide, Public package exports, TypeScript, Code generation,
Handler runtime, React/headless clients, Authoring profiles, Diagnostics
**Governing:** LLP 0295 vertical paved-path coherence invariant and D0.3/W3;
LLP 0061; LLP 0252; LLP 0253; LLP 0275
**Related:** `issues/20260820-guide-gap-familiar-handler-dialect.md`;
`issues/closed/20260820-familiar-vdoc-generation-runtime-parity.md`;
`issues/20260820-guide-gap-membership-roster-projection-recipe.md`

## Problem

Layer-local tests allow an advertised path to change meaning across the Guide,
public entrypoint, generated types, codegen, runtime validation, client hooks,
and diagnostics. The current Familiar page now spells the qualified paths as
an unbounded `v.array(v.doc(table))` plus `.take(1)` for an empty-capable point
read, an authored child key such as `resourceField: "roomId"` for membership
visibility, and the shared `@expo/snapback-codegen/define` import for a
membership-backed ephemeral declaration. Those corrected spellings still need
one packed fixture proving they agree with the generated/runtime contracts.

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
- Start with the confirmed Familiar cases: empty-capable point-read document
  arrays, closed object/value results, mutation document results, authored
  membership resource identity, and the shared ephemeral declaration import
  path.
- Add the fixture as an acceptance obligation to future fixes that change an
  advertised authoring path; do not turn internal lowering syntax into public
  contract.

## D0.3 ruling (2026-08-21) — Adopted per LLP 0295; author may revise

The D0.3 decision packet landed in the owning LLPs:

- **LLP 0253 S9** — the Familiar product contract (rulings R1–R7) and the
  complete vertical contract fixture catalogue (S9.2, `VCF-F-*` /
  `VCF-E-*`).
- **LLP 0275 D8** — the fact-by-fact Explicit classification (policy vs
  derivable vs environment-integrity vs evidence, with product semantics
  and authored-because-underivable contracts named outside the taxonomy
  for exhaustiveness) and the Explicit economy lane registration. D8
  carries the D0.3 ruling's status on its own; LLP 0275's other sections
  remain Draft pending author acceptance.
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
   results and closed value objects are supported through `results.value`,
   and the guide keeps the spec's promise (R3). The adapter lowering is
   already green for the nullable point shape on current source; the
   remaining divergences (generated types, runtime admission, client
   projection; the value-object live-query runtime refusal) are per-layer
   defects and W3 attributes each to the layer that still disagrees. The
   singleton-array form is an interim workaround only.
3. Entrypoint/export parity: buildable-but-unexported is a contract
   violation; `defineEphemeral` **and** the `ephemeral` collection-builder
   namespace join the `@expo/snapback/server` and `generated/server` closed
   export lists, amended in place in LLP 0253 S3.1/S3.2 and Appendix A (R4).
4. Feature parity is reachability parity (nameable, sanctioned escape, or
   stable refusal+route), not constructor parity (R5). Sequences stay
   disposition 4 with a first-read-discoverable route. Membership resource
   identity has exactly one spelling shared across profiles; the guide's
   `resourceField` rows must corroborate against the canonical grammar.
5. The generator suggests profile switches only at disposition-4 refusal
   sites, Familiar→Explicit only, never on success (R6). R6 has no fixture
   of its own by design: every disposition-4 refusal fixture (VCF-F-N1,
   VCF-F-D4, VCF-F-SQ1) asserts the route in its step 6, and no fixture's
   success path may emit a switch suggestion.
6. **LLP 0295 open question 2 — recommendation:** templates may choose
   profiles by workload/client stack while preserving one normalized
   definition; Familiar is not required to reach constructor-level feature
   parity (R7). No semantic fork arises (one profile per app, profile-free
   normalized witness, no-branch gate, name-preserving migration).
7. No default-profile change; that stays gated on the N≥3 wave.

## W3 lane checklists

**Familiar coherence lane:**

- [x] One-pass clean generation with schema-derived `v.doc` results
      (VCF-F-G1) and mutation-doc runtime parity (VCF-F-M1) — closes
      `issues/20260820-familiar-vdoc-generation-runtime-parity.md`.
- [x] Close the remaining per-layer S4.3 catch-all divergences: nullable
      point result through generated types, runtime admission, and client
      projection (VCF-F-Q6 — the lowering is already green) and the
      value-object live-query runtime refusal (VCF-F-Q7); align guide,
      types, codegen, runtime, and client on the one partition.
- [x] Row-shaped partition fixtures VCF-F-Q1..Q5, VCF-F-Q8, VCF-F-M2,
      VCF-F-N1, VCF-F-A1 green from packed packages.
- [x] `defineEphemeral` and the `ephemeral` collection-builder namespace
      re-exported from `@expo/snapback/server` and `generated/server`;
      export-parity check over every claimed disposition-1/2 constructor;
      VCF-F-E1 green.
- [x] Membership resource-identity spelling corroborated across guide,
      generated, and runtime contracts; VCF-F-MB1 (paired with VCF-E-MB1)
      green.
- [x] First-read handler-dialect table plus retrieval-eval cases; each
      dialect boundary proves its single supported rewrite end to end with
      the refused form as the step-6 negative (VCF-F-D1..D3), and
      clock-dependent visibility refuses with the one Explicit route
      (VCF-F-D4) — closes
      `issues/20260820-guide-gap-familiar-handler-dialect.md`.
- [x] Sequence refusal route stable and first-read-discoverable (VCF-F-SQ1);
      asset intent recast with retrieval + negative steps (VCF-F-AS1).
- [x] Profile-switch suggestions confined to disposition-4 refusal sites.

### W3 implementation status — 2026-08-22

- The packed external-app carrier verifies the complete S9.2 Familiar
  catalogue: VCF-F-G1, Q1–Q8, M1–M2, N1, A1, D1–D4, E1, AS1, MB1, and SQ1.
  It begins without generated output, typechecks only packed packages, runs
  the packed native binary, exercises headless and React clients, and places
  every negative at its earliest capable layer. The receipt has no pending
  Familiar rows.
- VCF-F-M2 now distinguishes invocation-local IDs minted by `ctx.db.insert`:
  a same-table ID is admitted and a wrong-table ID minted in the same handler
  is rejected. Opaque pre-existing IDs remain admissible because Snapback row
  IDs deliberately carry no context-free table tag.
- R4's `defineEphemeral` and `ephemeral` exports are identity-preserving from
  both `@expo/snapback/server` and `generated/server`. VCF-F-E1 additionally
  proves membership-backed presence and the retired `_generated/` refusal.
  VCF-F-MB1 proves `_id` self-resource and child-resource visibility through
  generated and runtime contracts.
- The dialect carrier executes the one supported rewrite for D1–D3, refuses
  their familiar-looking negative forms pre-output, and routes only D4, N1,
  and SQ1 disposition-4 refusals to Explicit. VCF-F-AS1 uploads and reads back
  identical MP4 bytes and preserves the nested unsupported-media diagnostic.
- The Explicit economy carrier verifies VCF-E-P1–P4: exact result and table
  dependency facts are derived from closed plans, provenance is projected,
  compatible authored controls preserve the same generated contract and
  authority evidence, and conflicts refuse before output. VCF-E-L1 binds the
  scaffolded install → generate → dev → prove lifecycle to the landed
  W1 M1→M2 continuity proof. The other Explicit catalogue rows, D4/D5
  economy work, and the corpus-wide ceremony measurement remain open.

Verification evidence for this increment:

- `node --test packages/snapback-harness/envelope.test.mjs` — 15/15 passed.
- `cargo test -p snapback-engine tagged_failure_maps_code --lib` — 1/1 passed
  (the focused envelope case passed); the focused invocation-local ID
  provenance test also passed 1/1 (495 filtered).
- `cargo build --bin snapback` and
  `target/debug/snapback runtime-qualify` — current dirty-worktree binary built;
  restricted no-eval handler VM qualified.
- `SNAPBACK_RUNTIME_BINARY=target/debug/snapback node
  scripts/familiar-vdoc-vertical-contract.mjs` — complete Familiar catalogue
  and Explicit P1–P4 receipt passed with no pending Familiar rows; its R6
  control proves an ordinary timestamp refusal retains the
  `ctx.runtime.now()` rewrite without a profile-switch suggestion.
- `SNAPBACK_RUNTIME_BINARY=target/debug/snapback node
  packages/snapback-cli/packed-dev-lifecycle.test.mjs` — VCF-E-L1 passed the
  packed scaffold/install/generate/dev/prove lifecycle and W1 M1→M2
  continuity proof.
- `scripts/bootstrap-ibex-runtime` — ran before Cargo as required, installed
  the lazy Ibex/Hermes state, then timed out after 900 seconds with stable code
  `SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT`; the subsequent focused Cargo build and
  runtime qualification succeeded.

**Explicit economy lane:**

- [x] Plan-derived result contracts (LLP 0275 D3) with provenance markers
      and closed-plan dependency-set derivation; duplicate `result:` blocks
      and transcribed dependency lists removed from first-party templates;
      VCF-E-P1..P4 as receipts — via
      `issues/20260817-0275-derive-closed-plan-result-contracts.md`.
- [x] Recurring fixed lifecycle wiring supplied by template scaffolding
      through the packed cold-install closure (LLP 0275 P5/P7, D6);
      VCF-E-L1 as the receipt.
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
