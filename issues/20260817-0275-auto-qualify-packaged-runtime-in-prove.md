# LLP 0275: make packaged runtime qualification automatic in `prove`

Status: Open

Authority: Draft LLP 0275 D4; LLP 0123 and LLP 0146 D2 remain authoritative
for readiness evidence and verify-stage ordering.

## Problem

A fresh npm React app reaches `bun run prove`, then fails with
`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` and tells the author to run
`snapback runtime-qualify --persist` manually. The behavioral qualification is
necessary; discovering and invoking a separate platform command is not.

The public runtime packages already carry package-owned assembly/seal facts and
the CLI knows the exact selected binary and receipt path. The ordinary proof
command should validate a coherent seal/receipt or run the bounded probe when
the selected local target requires it.

## Scope

- Specify validate-existing, validate-package-seal, auto-qualify, and refusal
  precedence for the local packaged-runtime verify stage.
- Persist the same digest-bound readiness receipt currently created by the
  explicit command.
- Cache by exact binary/native-artifact identity so subsequent proofs do not
  rerun the probe unnecessarily.
- Preserve `snapback runtime-qualify` for explicit inspection, packaging, and
  recovery.
- Keep non-local targets explicitly not-applicable rather than borrowing local
  evidence.

## Acceptance

- In a fresh out-of-repository npm scaffold with no app-local readiness
  receipt, `bun run prove` performs the required bounded qualification and
  proceeds without a preparatory command.
- The verify receipt names whether readiness came from an existing receipt,
  admitted package seal, or a newly executed probe.
- A second proof with identical bytes validates cached evidence.
- Binary or Hermes drift invalidates the evidence and reruns or refuses
  according to the closed precedence.
- A failed handler-VM probe stops before admission/acceptance with the existing
  stable diagnostic family; no negative acceptance check can count under an
  unarmed runtime.
- Hosted/nonlocal verify profiles do not execute or claim the local probe.
