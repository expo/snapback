# Code-mode audit lane: framed, value-free, leak-resistant stderr

**Status:** Shelved
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Code-mode audit lane: framed, value-free, leak-resistant stderr” shows the issue materially affects reliability, verification, or developer experience; it can wait behind current correctness blockers, while the fix requires a few coordinated implementation and test surfaces, with specific cited code, progress, or acceptance criteria.
**Severity:** P2
**Systems:** Tooling, Security, Observability
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §3, LLP 0010 (structured diagnostics), LLP 0055 §Audit
**Marker:** app-cli, sub-stage-c, code-mode

Agents capture stderr, so the audit lane must not re-import the
intermediate values code mode exists to exclude. Per LLP 0062 §3: one
framing and one aggregate byte ceiling (typed elision, never
termination) shared by audit, console, and diagnostic events; per-call
audit records carry call identity, function id, envelope identity,
script provenance (content hash; file vs stdin), attribution as named
accepted leakage, a coarsely bucketed size class, and a
domain-separated commitment keyed by a fresh per-run parent-only
secret — **no unkeyed digests** (low-entropy values are
dictionary-recoverable) and **no exact byte counts**. The server-derived
portion is a closed allowlist, never a generic diagnostics/facts pass-
through: `code`/`severity`/`subsystem` only by default (with code and
subsystem grammar-bounded), known-code semantic extras only, the
individually named fact fields, and the attribution block. Unknown but
valid diagnostic codes are preserved and marked unrecognized with no
unknown extras; `message`/`details` and every non-allowlisted fact are
omitted. A value-free per-run summary closes the lane. Full values are
opt-in via the future `--transcript`.

**Done when:**

- The framed lane is implemented with versioned event schemas; console
  output rides it as console events; runtime warnings never enter it.
- A low-entropy planted-value test proves captured stderr cannot
  recover or correlate intermediate values beyond the accepted
  leakage (bucketed size, within-run keyed equality).
- Sensitive values planted in diagnostic `message`/`details`, unknown-
  code extras, and non-allowlisted facts never reach the lane on
  success, refusal, live-terminal, or caught-broker-error paths.
- The 500-row proof passes: a script that lists 500 rows and returns 3
  without logging the rows emits them to neither stdout nor stderr.
- Aggregate-ceiling overflow elides with a typed record and the run
  continues to its own outcome; the closing summary reports bounded
  budget/peak/elision classes without values or exact byte counts.

## Shelved (2026-08-01, author decision)

Temporarily shelved per Charlie's 2026-08-01 decision on the
triage-sweep recommendation: the app-cli program is paused (owning RFC
LLP 0062 parked at Review since 2026-07-17; LLP 0122 Q6 still open on
the CLI's shape). Reopening condition: LLP 0062 leaves Review or the
program is recommissioned. The design content here is not invalidated
by the shelving.
