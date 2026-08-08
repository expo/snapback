# Wave 4 program — first-party identity

**Status:** Open (program)
**Opened:** 2026-08-08, at Charlie's direction following the wave 3 close
(`issues/20260803-wave3-program.md`, closed 2026-08-08)
**Systems:** Auth, Identity, Providers, Client surfaces, Hosted delivery
**Related:** LLP 0151 (the governing RFC — Option D), LLP 0150 (agent
tokens), LLP 0011 (guest claiming), LLP 0036 (grant model), LLP 0104
(shadow metering), LLP 0189 (verification cadence and claim gating)

## Kickoff decisions

**1. Generated-domain passkeys tier — RULED 2026-08-08: preview-only
exception.** Not production tier 1. Promotion to tier-1-with-disclosure is
conditioned on (a) ROR verified across target browsers and both
iOS/Android platform-association mechanisms, and (b) a named owner for the
indefinite generated-origin serving obligation. Recorded in LLP 0151
§Open questions with rationale; the Fable/Codex split is now evidence-gated
rather than a standing bet.

**2. Expo-hosted shared email/SMS delivery — OPEN.** Explicitly unbound
from the passkeys ruling, so it can be decided on its own merits. Still
needs Charlie. Note the broker rejection (credential-ownership ruling,
2026-08-02) does not automatically extend to delivery.

## Commissioned Specs

LLP 0151 commissions two implementing Specs; both get owners and numbers
here. Neither is blocked by the open delivery question.

- **LLP 0198 — completion protocol.** The identity-completion contract
  0151 pins but does not specify.
- **LLP 0199 — identity lifecycle state machine.** The transition machine:
  link/unlink/replace/recovery/deletion proofs, reauthentication rules,
  notification obligations, session consequences, failure atomicity, and
  the guest-migration checkpoint contract (round-2 addition, Codex).

Both are Spec-first per the wave-3 precedent that produced LLP 0166:
dual-family review loop, acceptance is Charlie's, and the implementation
program is scoped only after acceptance. Do not start implementation
against either until it is Accepted.

## Sequencing note

ROR verification is a prerequisite for the passkeys promotion condition and
is an independent research task — it does not block either Spec and should
start in parallel rather than waiting on them.

## House rules

Wave-3 rules carry over, with the LLP 0189 D-6 close form: this program
closes with claim-scoped evidence plus the scheduled battery green on
claim-relevant gates, unrelated red gates ticketed and named. No wholly-green
`main` commit is required. Expect to `git fetch` + rebase before every push;
the LLP 0175 drift hook now enforces frozen-record freshness in the landing
that causes it.
