# Phase B charter — `defineMediaCommand` (LLP 0239 D3, rollout R4)

You are the implementation engineer for Phase B of ticket
`issues/20260815-finish-media-happy-path.md` (Scope B). Phase A — the full
generated `assetCollection` (LLP 0239 D2/D4) — is LANDED on main and present
in this worktree (see `PHASE-A-REPORT.md` for its as-built surface, and
`SUBSTRATE-MAP.md` for the older substrate map). The orchestrator reviews,
runs landing gates, and commits — **you never run `git commit`/`git push`**.

## Read first

1. `issues/20260815-finish-media-happy-path.md` — Scope B, required evidence,
   non-goals (especially: the atomicity claim is narrow — bytes finalize
   first, then one atomic application transaction; no distributed txn).
2. `llp/0239-asset-collections-and-media-field.rfc.md` D3 + D4 (including the
   2026-08-15 dated rulings) — the exact contract.
3. `llp/0180-asset-bearing-client-commands.rfc.md` — the CommandTask contract
   you are specializing: declaration, execution, terminal-state transitions,
   failure/retry/cancellation/residue, authority replacement.
4. `PHASE-A-REPORT.md` — the as-built collection surface you compose with
   (descriptor shape, sharing grammar, generated ops, item-identity ledger,
   `SNAPBACK_MEDIA_COLLECTION_COMMAND_BINDING_REQUIRED` already exists and is
   HTTP-classified).
5. LLP 0238 `TaskHandle` where D3 references it.

## Non-negotiable constraints

- `defineMediaCommand` is a CLOSED specialization of LLP 0180's command: no
  authored mapping callback, transform, branch, loop, or arbitrary result
  processing. The descriptor compiles to a closed `MediaCommandBindingV1`
  (command identity, target mutation identity, passthrough args,
  asset-input→mutation-arg mapping, parent result path, collection
  identity/generation, item-identity plan, sharing plan, task profile).
  Unknown paths/transforms/callbacks refuse at generation with
  source-attributed diagnostics (D6 paths like `sendMessage.media.optional`).
- The binding is installed in the target mutation's manifest entry. The
  ordinary mutation host stays the SOLE application commit owner: it
  validates binding + mapped asset refs before handler execution, runs the
  authored mutation once, validates its exact result, resolves the declared
  parent path, reauthorizes parent/intent/collection/sharing policy at commit
  time, and stages collection rows + attachment lifecycle + grants in the
  same storage transaction (reuse Phase A's staging machinery — do not build
  a second writer).
- A mutation carrying a required media binding is COMMAND-ONLY in v1: plain
  dispatch refuses before handler execution with
  `SNAPBACK_MEDIA_COMMAND_BINDING_REQUIRED`; generated clients do not expose
  the direct verb. Text-only execution = same command, empty media list.
- Client: accept scalar or bounded array of `File`/`Blob`/native
  picker-shaped sources; normalize through LLP 0180's existing platform
  adapters; preserve input order (input order = manual collection order).
  Bounded concurrency (target profile default 3), per-item progress. No
  mutation invocation until every required upload is finalized.
- Task phases: `validating → uploading (0..N per-item) → committing →
  committed | failed | cancelled | ambiguous`, returned as LLP 0180
  `CommandTask` projected through LLP 0238 `TaskHandle`. Before commit it
  durably records ONE mutation-attempt identity and deterministic item plan
  (compose with Phase A's `snapback:asset-collection-item-id:v1` ledger).
  Response loss ⇒ `ambiguous`; retry reuses the same attempt/plan, returns a
  successor task, never migrates predecessor listeners/`.done`.
  Pre-invocation cancel may settle `cancelled`; post-invocation cancel stays
  `ambiguous` until authoritative settlement and NEVER claims rollback.
- Retry reuses already-finalized asset ids only after commit-time
  revalidation of intent, collection, sharing, parent, and principal
  authority. Report per-asset residue + cleanup provenance after partial
  failure; never silently delete finalized bytes.
- Sharing plans (D4): the binding selects ONE exact plan within the
  collection ceiling, carried in the binding identity; `inherit-command`
  resolves to that exact versioned binding's plan. Reauthorized at commit.
  Authority-profile-derived sharing stays generation-refused (R5 non-goal).
- The binding, mutation implementation, mapping, collection/sharing
  generations, and final executable bytes all enter semantic/executable
  identity.
- Capability id `assets.media-command.v1` (experimental) mirrors across the
  same registries as Phase A (codegen tables, `TargetCapabilityId`, JSON
  schemas, capability-registry.ids.json, capability-maturity.experimental.json).
  **Do NOT create the maturity introduction record, guide row, or program
  board entry — the orchestrator owns the LLP 0134 introduction act at
  landing time** (the record binds the landing commit's parent sha).
- New SNAPBACK_* codes: list every one in your report; production-reachable
  Rust codes ALSO need `src/server/api_error.rs` mapper entries and mirrored
  entries in the `src/server/tests.rs` reviewed families (follow the
  MEDIA_COLLECTION block precedents from Phase A). Do not leave s5_d10 worse
  than its 11-code inherited baseline.
- No guide pages, capability-row flips, React/Expo hook projections, or
  publication artifacts — those are Phase C / orchestrator work. Do not run
  `scripts/check-generated-artifacts` or carrier scripts.
- @ref sparingly to LLP 0239#d3 / LLP 0180 sections for non-obvious choices.
- If D3/D4/0180 underspecifies something semantic (identity, refusal shape,
  ambiguity handling), STOP that aspect and append the question to
  `PHASE-B-BLOCKERS.md`; keep building unaffected parts.

## Deliverables (stage order, keep each stage green)

1. **Codegen**: `defineMediaCommand` in `define.mjs`/`define.d.ts`; admission
   in `index.mjs` beside `buildGeneratedCommands` (lift
   `SNAPBACK_COMMAND_MULTI_ASSET_UNSUPPORTED` only for this closed form);
   `MediaCommandBindingV1` emission + install into the mutation manifest;
   generated client surface (`app.commands.*`); D6 source attribution;
   authoring tests `media-command-authoring.test.mjs` wired into the package
   chain + `scripts/check-package-test-inventory.mjs` (bump expectedTotal and
   append the ledger comment).
2. **Rust manifest**: binding types, fail-closed decode, validation parity,
   command-only enforcement point before handler execution.
3. **Host staging**: binding validation, single mutation invocation, parent
   result resolution, commit-time reauthorization, atomic staging through
   Phase A's collection machinery; OCC/retry with the deterministic plan.
4. **Headless client**: multi-source normalization, bounded-concurrency
   upload coordination with per-item progress, the task state machine,
   ambiguity/retry/cancel/residue semantics in
   `packages/snapback-client/commands.mjs` (+ types), tests in
   `packages/snapback-client/commands.test.mjs` (extend) covering: text-only,
   one-item, N-item success; per-item progress; upload refusal; partial
   transfer failure; commit refusal; response loss + same-attempt
   reconciliation; pre/post-invocation cancellation; explicit residue facts.
5. **Rust tests**: binding install/validation, command-only refusal, atomic
   staging success/failure, retry identity, reauthorization, residue — beside
   Phase A's `media_collection_acceptance_tests`.

## Environment

- `RUST_MIN_STACK=16777216 cargo test --lib` (without it a rehearsal test
  SIGABRTs before the summary). No DYLD_FRAMEWORK_PATH.
- Known inherited lib reds (do not chase): the 5 in
  the orchestrator's baseline (capability_maturity ×2 in
  membership_manifest_grammar_tests, table_visibility ctx_db,
  served_http_refusals, s5_d10 with exactly 11 unclassified codes).
- Codegen pretest chain is red on main at generated-mutation-ir.test.mjs:97
  (pre-existing) — run your test files directly.
- Sandbox may fail loopback suites spuriously; mark "sandbox-suspect".

## Report

Maintain `PHASE-B-REPORT.md` live (same format as Phase A): stages, files,
every new SNAPBACK_* code + its HTTP classification, registry touchpoints,
verbatim test commands/results, deviations, `## DONE` / `## STOPPED` last.
