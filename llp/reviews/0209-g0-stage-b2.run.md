# LLP 0209 G0 Stage B2 — review run journal

**Roster:** codex gpt-5.6-sol xhigh implemented (surgical rounds at high); codex + grok-4.6 xhigh reviewed blind on full rounds, codex targeted re-checks on surgical deltas; orchestrator Claude Fable 5 triaged, ruled, verified, landed.
**Result:** landed on main 2026-08-23 as the series ending `4627f9d95` (rebased over the concurrent guest-session landing; shared test-inventory counter merged 331→332; the frozen emitted-manifest vector deliberately re-frozen on the merged tree — two toolchain hash lines).

| Round | Codex | Grok | Disposition |
| --- | --- | --- | --- |
| r1 | NOT READY (5) | NOT READY (2) | converged: JS canonicalizer was not RFC 8785 JCS (integer-index keys; number/surrogate refusals); source gate bypassable; + register order, authored search feeding class derivation, rank-0-only admission proof with env-skip |
| r2 | NOT READY (2) | NOT READY (1) | builder recognition fail-closed (aliases/element access/re-exports/.call/.apply), JS recomputes B1 cost aggregates |
| r3 | NOT READY (2) | READY | local-alias provenance; closed nested cost records + reason parity + shared 11-case JS/Rust parity corpus |
| r4–r6 | targeted: 1 → 1 → READY | READY standing | wrapper-return hole ⇒ RULED allowance handshake (walker-minted per-site allowances, loader-armed, runtime-consumed, default-deny); final hole: loop-ancestor sites minted allowances ⇒ top-level/exported-const-only minting |

Verification on the landed content: types 245/0 (incl. the shared parity corpus), kernel 830/0, sync 253/0, s5_d10 4/0, graph+relational corpus green, codegen graph suite green, check-generated-artifacts ok, check-inventories PASS (332 package tests, 487 leaves), ref-check 0 errors. One genuine B1 bug found and fixed via B2: maxArgumentItems double-count (each collection argument now counts once, per LLP 0209 §2.6).

Structural lesson recorded: enumerating builder-call spellings does not converge; the closing move was a capability handshake between the AST walker and the runtime builder (allowances minted only at proven top-level literal sites, consumed per invocation, default-deny).
