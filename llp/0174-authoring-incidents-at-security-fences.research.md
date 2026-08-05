# LLP 0174: Authoring incidents at security fences

**Type:** Research
**Status:** Draft
**Systems:** Security, Code execution, Auth, Deployment, Packaging, Runtime
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-04
**Related:** LLP 0009, LLP 0058, LLP 0108, LLP 0118, LLP 0160, LLP 0171

## Summary

Two Chessfield authoring incidents were incorrectly promoted into developer-
experience mechanisms that would weaken or widen security fences: codegen-owned
third-party handler bundling and sessions startup admission of a function-
surface superset. Current source does not support either conclusion.

Third-party handler packages change the code-execution supply chain. Hashing
bundler output preserves byte identity only; it does not preserve deterministic
regeneration, bounded reviewability, source diagnostics, dependency admission,
or the semantic intent of syntax-based handler checks. Sessions startup binds a
complete schema/function pair because the carrier is executable authority.
Adding a function changes callable authority and is not an identity-preserving
superset.

This Research document records the negative result: neither fence changes as a
DX repair. Package admission remains open under LLP 0009/0108/0118. Complete-
pair sessions pinning remains settled under LLP 0058; the observed authoring
problem routes to the existing live supervisor, as recorded by LLP 0171.

## Evidence boundary

The motivating demand is one external Chessfield build on 2026-08-04. It needed
`chess.js` in a handler and could not keep `snapback dev` alive after non-TTY
stdin closed. The arm pre-bundled `chess.js` and reset its sessions database
after function changes. Those workarounds prove that the incidents occurred;
they do not establish that either workaround is safe or should become product
behavior.

The findings below were checked against the current codegen scanner, handler
loading path, LLP 0009/0108/0118, LLP 0058, `src/auth/mode.rs`, the sessions dev-
loop regression test, and the guide's documented live-reload path.

## Finding 1: third-party handler admission is a supply-chain decision

### Current contract

`loadHandlerSource()` reads one closed script and passes it through
`scanUnsupportedHandlerSource()`. Static and dynamic imports, `require`,
dynamic code constructors, direct ambient clock/entropy spellings, and other
blocked forms fail generation. Same-file helpers are available through the
landed helper mechanism; a `node_modules` graph is not.

LLP 0118 already distinguishes ordinary helper reuse from package admission.
It records the open hermetic-package profile: the lockfile, resolver, package
artifacts, export conditions, toolchain, and graph would join executable
identity. Chess adds one concrete package-demand observation. It does not
answer that open question or justify ambient package resolution.

### Why output hashing is insufficient

A bundle hash says which final bytes execute. It does not establish:

- that two machines resolve and transform the same dependency graph;
- which lockfile and package-manager semantics are authoritative;
- package integrity and the identity of each resolved edge/file;
- conditional-export, built-in, symlink, and initializer policy;
- graph, file, and byte ceilings;
- reviewable source provenance and source-span mapping; or
- that a transform did not rewrite a forbidden authored construct into syntax
  the final scanner happens to admit.

Running the current scanner over bundled bytes provides a capability floor,
not preservation of every existing property. A class-heavy dependency may fail
an authored-source subset, while a downlevel/minifying transform may erase the
surface spelling of a rejected construct. Neither “scan dependencies as
authored” nor “scan final output only” is a neutral implementation detail.

### Disposition

The rejected codegen-owned bundling proposal is deleted. The immediate guide
correction may say only that handler sources are closed single scripts, imports
are refused with `BUNDLE_UNSUPPORTED_IMPORT`, and same-file helpers are the
supported sharing boundary. It must not prescribe pre-bundling as a sanctioned
escape hatch. The existing
`issues/20260804-guide-gap-handler-source-imports.md` proposed-fix text needs
that narrowing before implementation.

A future package RFC must choose one explicit trust profile. At minimum it must
own resolver semantics, lockfile custody, package and per-edge identity,
conditional exports and built-ins, initializer effects, bounds, source maps,
final capability scanning, toolchain identity, stored-versus-rederived bundle
bytes, and cross-machine reproducibility/adversarial tests. Vendoring a closed
app-relative graph and an opt-in hermetic package profile are materially
different options and should not be conflated.

## Finding 2: sessions deployment identity is a complete executable pair

### Current contract

LLP 0058 defines a closed deployment identity containing `schemaHash`,
`bundleHash`, and the pair-level `inputsHash`. The cold startup carrier contains
the complete schema and function manifests, is treated as executable authority,
and must equal the pinned deployment before listener bind. `src/auth/mode.rs`
computes and compares that complete identity.

The source and guide also verify the intended evolution path. A stop,
regenerate, and restart over a settled sessions database refuses with
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`; the structured diagnostic carries
expected and observed deployments. Additive evolution goes through the running
`snapback dev` reload, which preflights and activates the complete pair without
discarding the database.

### Why superset admission is not a repair

Adding a function changes `bundleHash`, `inputsHash`, and callable authority.
Calling it an unrelated superset assumes the conclusion that the pin exists to
prevent. Selecting an “identity-bearing subset” would turn a complete-pair
fence into partial executable admission without a successor protocol.

The Chessfield failure was operational: the sanctioned live supervisor stopped
when non-TTY stdin closed, so the arm replaced live reload with a cold one-boot
script and database reset. LLP 0171 routes that symptom to the supervisor's
control-channel lifecycle. It supplies no evidence that the startup pin is too
strict.

### Disposition

The identity-subset/superset proposal is shown mistaken and deleted. LLP 0058's
complete-pair semantics remain. LLP 0160 continues to improve migration
experience without changing that authority.

If a cold-start successor mechanism is ever needed, it is an LLP 0058
amendment, not a DX flag. It must specify complete-pair preflight, atomic
activation, concurrent-admission fencing, live-authority invalidation,
crash/restart behavior, predecessor compatibility, and negative cases for
partially or maliciously widened function surfaces.

## What is decided and what remains open

| Topic | Status |
|---|---|
| Pre-bundling as documented workaround | Rejected as sanctioned guidance. |
| Codegen-owned ambient `node_modules` bundling | Rejected as proposed; no trust profile was specified. |
| Hermetic third-party package admission | Open under LLP 0009/0108/0118; Chess is one demand point. |
| Complete schema/function startup identity | Retained; LLP 0058 governs. |
| Function-surface superset admission | Rejected as proposed. |
| Backgroundable live reload | Open tooling work under LLP 0041/0171, with no security-fence change. |
| Cold successor protocol | Open only through a future LLP 0058 amendment. |

## Acceptance boundary for future work

This Research document authorizes no implementation. Any future handler-
package proposal needs reproducible clean-machine builds, lockfile and resolver
adversaries, conditional-export/built-in/symlink negatives, initializer and
syntax-laundering cases, byte/graph ceilings, exact stored/rederived identity,
and source-diagnostic fixtures.

Any future cold successor proposal needs unchanged-database activation of a
complete valid pair plus refusals for a missing half, mismatched inputs hash,
added callable surface outside the approved pair, stale predecessor, concurrent
old-authority invocation, and crash at every activation boundary. The current
live-reload path remains the control.

## MATERIAL review disposition

| Review concern | Disposition |
|---|---|
| 0171 GPT-5 M5 — output hashing does not preserve handler properties | Resolved by Finding 1: byte identity is separated from regeneration, review, diagnostics, and supply-chain admission; no bundling proposal remains. |
| 0171 GPT-5 M6 — identity subset weakens executable authority | Resolved by Finding 2: complete-pair pinning remains and the authoring symptom routes to the supervisor. |
| 0171 Claude M1 — bundled bytes versus subset checking is the core decision | Resolved by Finding 1: neither scanning choice is assumed neutral; a future trust profile must decide it explicitly. |
| 0171 Claude M2 — auth relaxation rested on an unverified reading | Resolved by source verification in Finding 2; the proposed relaxation is deleted. |
| 0171 Claude M6 — npm resolution enters replay identity | Resolved by Finding 1: the full resolver/lockfile/toolchain custody problem is explicit and remains open under the security owners. |

## Confidence

High for both negative findings. They follow from current source and the
governing security contracts. Low for package-demand prevalence and for whether
a cold successor protocol is needed after the supervisor lifecycle is fixed;
one chess build cannot answer either.
