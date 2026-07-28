# Sound end-to-end handler result contracts

**Status:** Closed  
**Impact:** 5  
**Urgency:** 4  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Authoring, Runtime, Code generation, Client typing, React, Contract, Testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0004, LLP 0012, LLP 0032, LLP 0037, LLP 0064, LLP 0065

JS queries can declare `result: v.object(...)`, but the declaration currently
serves codegen typing only. Runtime egress does not validate it,
`jsQueryRowDescriptor` adds document system fields even to computed records,
mutations/actions cannot declare precise results, and React inference still
depends on caller-supplied generics. Omitted results degrade honestly, but the
ordinary typed path is incomplete and has a soundness hole.

## Desired resolution

- Define distinct closed result contracts for stored document rows, computed
  query records, mutation returns, and action returns.
- Carry the declared schema through the Rust-owned function manifest and
  validate handler egress before publication/settlement with stable,
  path-specific diagnostics.
- Never invent `_id`, version, or timestamp fields for computed records.
- Support validators for scalar, id, object, array, optional, union, and JSON
  shapes where the shared validator contract supports them.
- Generate function references whose Args and Result phantoms flow through
  headless, provider introspection, Contract, React query groups, query hooks,
  and mutation hooks without casts or manual generic annotations.
- Keep omission as an honest `unknown` path with an actionable author summary;
  do not infer a result from opaque JavaScript.

## Acceptance

- A TypeScript consumer compiles generated query and mutation calls, React
  hooks, and grouped queries without casts or explicit result generics.
- Runtime tests refuse malformed nested, optional, union, id, scalar, object,
  and array results before any invalid live/settlement publication.
- Stored-document and computed-record fixtures prove correct system-field
  behavior. Mutation result replay retains the validated typed shape.
- Generated provider, Contract, operation-schema, and public API artifacts are
  deterministic and agree on the same result contract.
- Degraded operations are counted with authored source links and exact
  `result` remediation; hard errors preserve the previous complete artifact
  graph.
- Guide pages teach the declaration and explain why opaque inference is
  deliberately unavailable.

## Resolution

Resolved 2026-07-28 by the LLP 0108 implementation slice.

- Codegen expands `results.documents`, `results.records`,
  `results.document`, and `results.value` into one closed, schema-bound
  effective contract and hashes its canonical bytes. The Rust-owned function
  manifest validates the kind, recursive vocabulary, profile bounds,
  capability acknowledgement, and hash before load.
- Query/live-query output is validated before publication, mutation output
  while writes remain provisional, action output before response publication,
  and retained mutation output again before same-process or process-reopen
  replay. Contract failures do not expose the rejected value.
- Documents include the exact four system fields and stored optional
  semantics; computed records remain closed and receive no invented system
  fields. Recursive null, boolean, string, integer, finite-real, principal,
  id, literal, JSON, array, union, object, and optional-field forms share the
  same bounded Rust/JS vocabulary.
- Generated API refs carry exact argument/result phantoms through the headless
  client, provider and Contract witnesses, query groups, React queries, and
  mutation hooks. Omitted contracts remain `unknown`.
- Codegen summaries now count degraded query, live-query, mutation, and action
  results, link the authored export span, and prescribe the appropriate
  `results.documents`/`records` or `results.document`/`value` declaration.
  Failed generation continues to preserve the prior complete graph.
- The query/mutation/React guide pages teach the precise declaration and the
  deliberate no-opaque-inference rule.

Evidence:

- `volta run --node 24 npm test` in `packages/snapback-codegen`
- `volta run --node 24 npm test` in `packages/snapback-contract`,
  `packages/snapback-client`, and `packages/snapback-react`
- `cargo test result_contract --lib` (7/7)
- `cargo test --test handler_settlement_v0` (11/11)
- `cargo test --test offline_replay_v0
  duplicate_client_identity_is_exactly_once_and_survives_reopen` (1/1,
  including frozen precise-id settlement replay after reopen)
- Signal Desk `npm run typecheck`, `npm run test:contract`, and
  `npm run test:snapback:extras` under Node 24 (3/3 app-specific checks)

`result_contract_v1` remains an explicit experimental capability and LLP 0108
remains in Review. Closing this ticket records the implemented, tested
repository surface; it does not claim author ratification of the broader
proposal or the superseded expected-operation protocol.
