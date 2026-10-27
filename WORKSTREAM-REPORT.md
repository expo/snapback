# SEC11 workstream report

Worktree: `/home/ccheever/projects/sb4-b31-sec11`, branch `sb4-b31-sec11`.
Base: `f032742ac8`, Snapback 4 0.4.43. No version bump or push.

This delivery stops at the item 1 boundary allowed by the brief. It does not
claim structurally zero medium holes. Items 2–9 and the full fix-forward matrix
remain outstanding. New witnessed questions remain advisory: a concrete replay
establishes admitted behavior, and cannot establish the builder's product intent.

## Item 1: witnessed decisions

Implemented current-witness refusal messages and additional bounded advisory
replays for omitted/empty media, text evidence, child-presence transitions,
unchanged direct guards used twice, and compiler-typed broad-read payloads.
Answers retain SEC10's current witness digest, exact `permit OP as CALLER`
clause and audience/effect rationale. A rejected batch publishes no decisions.

Read witnesses include the actual redacted delivered payload, distinct from
the policy row, effective logical time and visible identities. Changed delivered
fields renew the decision. Raw query results remain live-only, excluded from
serialization and Debug. Search deduplication still uses mutation prefixes.

The implementation deliberately leaves unsupported shapes uncovered: indirect
or compound guards, complex histories/assets/jobs, assignment-specific role
questions, and child-presence operations where another write or opaque effect
could repair an intermediate observation. These are coverage gaps, not gates.

Commits:

- `063c847045`: witness classes and decision refusal detail.
- `88a173a7c2`: exact guard identity, actual transitions and null redaction.
- `6525082163`: copied-schema/scoped verification runners.
- `d959a35bc1`: preserve mutation-prefix search deduplication.
- `f3612f3dbd`: actual delivered payload identity and live-only redaction.
- `267c579701`: atomic-call, cascade and commit-end expiry safeguards.
- `d9734feab5`: merge origin/main (experiment records only).

Design: LLP 3000.036.004.001. Independent Muse and fresh Codex reviews are
retained verbatim under `llp/reviews/`; earlier findings and corrections remain
visible. The 0.4.44 Guide changes entry documents this surface without bumping
0.4.43.

## Items 2–9

2. Approval-act inference: deferred; no new structural approval inference.
3. Assignment scoping: deferred; role-specific questions deliberately do not
   borrow unrelated broad-read witnesses.
4. Declared transitions/sibling prerequisites: deferred.
5. Entitlement consumption: deferred; item 1's bounded guard-reuse question is
   not an entitlement enforcement contract.
6. Caller-asserted history/latest subject: deferred.
7. Evidence typing gates: deferred; optional/text/child questions remain advisory.
8. Duplicable-row keyed exists/age intent: deferred.
9. Latency optimization: deferred; measured final production latency recorded
   below without claiming the targets passed.

## Verification and measurements

Final copied-schema measurements are running; replace this paragraph with
qualified results before delivery. Superseded or interrupted runs are not PASS.

Setup completed: frozen Bun install, native build, wasm build and package build.
Wasm remains 738,613 gzip bytes within its 739,113-byte budget.

Difftest: 2,000-case `run` passed with zero disagreements. 2,000-case `run-lean`
returned 18 disagreements, exactly the Integration 27 signature counts:
continuation-next 5, next 8, and E_RULE/NOT_FOUND prelude 5. This is an inherited
red, not a clean Lean pass. No interpreter/planner/store semantics changed.

The canonical affected plan expands these security/docs edits to six Rust crates
and 439 client files. That conflicts with the explicit brief prohibition on full
Rust/client pools. The retained runner records the original plan, the scoped
plan and omitted steps; only the changed CLI/language crates plus six affected
security/guide client files and relevant docs/generated checks are run.
Final CLI targets are `verbs::security*` unit modules and dx11, dx11_refusals,
dx13, security_reviews and security_wave19 integration targets. The earlier
broad CLI attempt reached unrelated 6,929-row residency calibration; it was
interrupted and is not a full-crate PASS. `0dffd02350` records this scope. This is
not a claim that the original canonical plan completed. See
`issues/20261026-snapback4-sec11-affected-selector-expands-for-docs.md`.

## Fix-forward

On a source-only copy of wave30 lane 033, adding
`require not j.dampSigned or j.dampApproved else DAMP_APPROVAL_REQUIRED` in
`advanceJob` clears the existing gate; the app's own acceptance script passes.
The raw acceptance log stays private outside the repository. Final production-binary reconfirmation also passes; the measured binary SHA is
`9d432a5fed665c418cbed5aa26995811411ee46c10f09f9e5181139ce7924a95`.

The remaining wave30 hole lanes have no completed fix-forward acceptance claim.
They depend on deferred mechanisms above; do not infer completion from an
unrelated advisory or gate in the same lane.

## Presentation limitation

The optional-list default card currently names the admitted operation and
caller but omits the focal list value (`absent -> {}`). Full JSON and failed
acknowledgments retain the exact row and predicate. The shared compact field
selector is DX14's scope; the concrete reproduction and suggested correction
are recorded in `issues/20261027-snapback4-sec11-optional-evidence-witness-fields.md`.
Counts of default witnessed questions mean the default names the question and
its admitted-call replay, with full concrete fields retained in JSON; they do
not claim every witness field is printed inline.
