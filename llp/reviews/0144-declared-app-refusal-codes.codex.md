# LLP 0144 declared app refusal codes review — Codex family

## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-08-01
**Redaction:** not redacted
**Method:** full round-1 — independent review per LLP 0005; reviewer directed to verify the settled-floor claims against the tree (LLP 0108, ctx.refuse, SNAPBACK_APP_REFUSAL, admit_declared_refusal, both handler_envelope_code legs), the LLP 0053 composition symmetry, the eight option axes, the zero-fixtures flag, CV-16/0125 typed-union direction, and the 0133-gated retry axis; read-only sandbox in a fresh worktree of origin/main at a8dcb148, blind to fable artifacts
**Target SHA-256:** `4cc87731c2265b6f296ccd72543946dccbca73a757168cc3263f9c96b42e075f`
**Instruction SHA-256:** `ed0ee2f6d1e83eba23dd7475bd372376caad148c2f06e1ead2c30642fa50b5c9`
**Status:** completed (first attempt, no retry needed)

### Verbatim review

Verified exact SHA-256: `4cc87731c2265b6f296ccd72543946dccbca73a757168cc3263f9c96b42e075f`. I did not read any `llp/reviews/*.fable.md`.

## Overall assessment

LLP 0144 is a strong option-space RFC with good invariants, provenance, and separation between the landed slice and future extensions. However, it is not READY: one central settled-floor claim is false for the Cloudflare host, and the recommended B3+D2 composition is type-inconsistent.

## Strengths

- The LLP 0053 security model is correctly preserved conceptually: handler bytes never type themselves; platform denials require host evidence and application refusals require declaration evidence.
- The eight axes are mostly well separated, with explicit ownership where wire and lifecycle questions belong elsewhere.
- The zero-fixtures flag is correct: `SNAPBACK_APP_REFUSAL` appears in runtime tests, but not in the LLP 0093 conformance corpus.
- Axis D accurately follows CV-16’s declaration-closed union direction and preserves undeclared collapse, as required by [LLP 0115 CV-16](</Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:825>).
- The migration distinction between expected result-object outcomes and transaction-aborting refusals is particularly useful.

## Concerns

1. **MATERIAL — The settled floor is not implemented on the Cloudflare/JS host.**

   The Rust path parses and then calls `admit_declared_refusal` against the prepared declaration set ([runtime.rs](</Users/ccheever/projects/snapback/src/runtime.rs:2725>), [runtime.rs](</Users/ccheever/projects/snapback/src/runtime.rs:3104>)). The JS decoder instead returns any string `appCode` accompanying `SNAPBACK_APP_REFUSAL` ([envelope.mjs](</Users/ccheever/projects/snapback/packages/snapback-harness/envelope.mjs:87>)). The Cloudflare coordinator classifies that result and forwards it unchanged ([coordinator.js](</Users/ccheever/projects/snapback/cloudflare/src/coordinator.js:3718>), [platform-errors.js](</Users/ccheever/projects/snapback/cloudflare/src/platform-errors.js:80>)); no declaration-admission implementation appears under `cloudflare/src`.

   Thus an undeclared `ctx.refuse` can survive on Cloudflare, contradicting I1/I3, the LLP 0053 symmetry, and the claim that both host legs are aligned.

   **Resolution:** either land Cloudflare admission against the invoked function’s manifest declaration with declared/undeclared/bare-claim tests, or revise the RFC and LLP 0108 to identify the first slice as local-only with a named parity blocker. It cannot remain described as a cross-host settled floor.

2. **MATERIAL — Recommended B3 and D2 cannot provide the stated payload type.**

   B3 preserves `appCode` while dropping malformed details ([LLP 0144](</Users/ccheever/projects/snapback/llp/0144-declared-app-refusal-codes.rfc.md:185>)), while D2 promises schema-typed `appDetails` ([LLP 0144](</Users/ccheever/projects/snapback/llp/0144-declared-app-refusal-codes.rfc.md:238>)). Under the recommended B3+D2 composition, a value can narrow to `STALE_MOVE` yet lack the statically promised details object.

   **Resolution:** choose B2, or make D2 explicitly represent payload validity—for example, separate valid-details and invalid-details variants with a discriminator. The value-free validation note also needs a named, typed location.

3. **should-fix — The fixture plan conflates envelope decoding, declaration admission, and authoring validation.**

   “Same fixture bytes” can test decoder parity, but undeclared-versus-declared admission also requires the invoked function’s declaration set. Reserved `SNAPBACK_*` spelling is a codegen/manifest fixture, not a wire fixture. The claim that agreement is already asserted by tests “on each side” is also unsupported: Rust has direct and served-path tests, but I found no JS/Cloudflare application-refusal test.

   **Resolution:** define separate fixture classes:

   - envelope decoding: bytes → claimed carrier;
   - host admission: envelope plus declared set → admitted or folded result;
   - declaration validation: invalid manifest/codegen inputs.

   Both hosts should consume the same semantic admission vectors, not merely the same envelope bytes.

4. **should-fix — LLP 0133 is not the stated future gate for Axis E.**

   LLP 0133 is already Accepted. It defines lane-Q/lane-L settlement and the closed reservation-stale retry, but it does not decide generic declared-refusal queue dispositions. It explicitly leaves some refusal typing and quarantine/resync behavior to other owners. Therefore “keep E1 until LLP 0133’s replay semantics force the question” and “Blocked-on: 0133’s queued-mutation refusal handling” describe a dependency that does not presently exist.

   **Resolution:** state that E1 remains normative until a named client-queue/outbox amendment defines terminal declared-refusal handling. Identify whether that work amends LLP 0133 or belongs to the client lifecycle/outbox owner.

5. **should-fix — Axis F needs a concrete trusted transport shape, and F3 conflicts with A1 syntax.**

   Today only platform denials have an out-of-band witness. Nested host-call errors lose `appCode`/`appDetails`, so F1 requires a new host-recorded admitted-refusal artifact plus rules for caught refusals, unrelated subsequent failures, and exact restoration matching. In addition, F3’s `refusals: 'opaque'` conflicts with the landed rule that `refusals` must be an array.

   **Resolution:** sketch the witness/restoration state machine before recommending F1, and use a distinct action exposure field—or explicitly include the changed union-shaped `refusals` grammar in Axis A.

## Verdict

**NOT READY**

The open choices themselves are appropriate for an options RFC. The blockers are the inaccurate cross-host settled-floor claim and the unsound recommended B3+D2 composition.

## Next step

Revise those two MATERIAL points first, then tighten the fixture, LLP 0133 ownership, and Axis F language and request a focused Codex re-review. No implementation or test run is necessary before that revision.

The workspace was read-only, so I could not persist this review as the LLP 0005 review artifact.

*(Runner note: the verbatim body above is unaltered except that file citations the reviewer emitted as absolute paths into the disposable review worktree are mechanically rewritten to the equivalent paths under /Users/ccheever/projects/snapback/ to avoid dead worktree links; raw output is preserved in the session capture.)*

## Round 2 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-08-01
**Redaction:** not redacted
**Method:** round-2 delta — reviewer given its own Round 1, instructed to verify v2's application of its five items (per-host floor + Cloudflare parity-blocker ticket, B3+D2 discriminated-pair repair, fixture-class separation + Rust-only correction + OQ8, E1-until-named-amendment, Axis F rebuild) and check the changed text only for fresh defects; read-only sandbox in a fresh worktree of origin/main at 9224c01a, blind to this RFC's fable artifact (the reviewer itself discloses one inadvertent metadata-only fable search hit in the verbatim body below)
**Target SHA-256:** `6eb359517530cd222f05ce69a32149789f0e98910527c6506b4e25fbb67d5dda`
**Instruction SHA-256:** `914da398e5c53212f5fd7b29526d3ea38c953da5da521e9a42c8cef3a8c71188`
**Status:** completed (first attempt, no retry needed)

### Verbatim review

Verified SHA-256: `6eb359517530cd222f05ce69a32149789f0e98910527c6506b4e25fbb67d5dda`.

Verdict: **NOT READY**

1. **READY** — The settled floor is now accurately scoped per host, and the Cloudflare parity blocker has a concrete test triad.
2. **READY** — B3+D2 is type-consistent through the `detailsDropped` discriminated pair, with OQ1 correctly controlling D2’s grammar.
3. **READY** — Decoder, admission, and declaration fixtures are properly separated; Rust-only coverage is stated honestly and OQ8 names the allowlist ruling.
4. **READY** — E1 is normative until a named queue/outbox amendment, without falsely gating on LLP 0133.
5. **NOT READY** — F1’s witness sketch cannot reliably implement its catch-invalidation rule: a caught interior refusal followed by a later same-`appCode` failure still satisfies code-only matching and can resurrect stale details. It also requires the final envelope to claim the witnessed `appCode`, which does not compose with FO-3 under the stated transport. See [LLP 0144](/Users/ccheever/projects/snapback/llp/0144-declared-app-refusal-codes.rfc.md:431).

Next step: revise F1 with an unforgeable per-host-call correlation token or equivalent identity rule, and state explicitly which FO options can compose with it; then request a narrow round-3 review.

The read-only workspace prevented appending this round to the Codex review artifact. Also, I did not open the 0144 Fable review, though a broad search inadvertently exposed one metadata-only match from it; none of its review content informed this verdict.

*(Runner note: the single file citation above was emitted as an absolute path into the disposable review worktree and is mechanically rewritten to the equivalent /Users/ccheever/projects/snapback/ path; raw output is preserved in the session capture.)*
