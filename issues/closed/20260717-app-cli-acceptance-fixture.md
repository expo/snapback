# Acceptance fixture app and cross-surface golden/parity harness

**Status:** Shelved
**Impact:** 4
**Urgency:** 2
**Ease:** 2
**Confidence:** 3
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Acceptance fixture app and cross-surface golden/parity harness” shows the issue materially affects a supported product or engineering path; it can wait behind current correctness blockers, while the repair crosses several runtime, host, protocol, or policy seams, with a clear design but unresolved dependencies.
**Severity:** P2
**Systems:** Testing, Tooling
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §7 (the full acceptance bar), LLP 0010 (acceptance discipline)
**Marker:** app-cli, acceptance

LLP 0062 §7 is the deliverable here: a fixture app (every function
kind, every `authRequirement`, hazardous-name and sentinel plants) and
the CI harness that runs the acceptance families end-to-end against
live memory servers on both tuples. Individual feature tickets carry
their own tests; this ticket owns the fixture, the harness, and the
cross-cutting families no single feature owns: the full exit-code
goldens (TTY and non-TTY), the complete auth matrix including the
anonymous × LiveQuery cell, LLP 0012 adapter-conformance
forged-violation tests, field-by-field disclosure sentinels across
every envelope member and the on-disk cache, the served-artifact
byte/identity witness, result-contract parity across HTTP / headless
client / CLI (and the MCP catalog when it lands), and the per-class
per-channel credential non-transmission suite.

The coverage manifest also includes the carried round-10 cases that
specialized tickets implement: zero-function and schema-owned
declaration forgeries, descriptor-less stage-(a) bootstrap, the full
GET/HEAD/304/OPTIONS/error digest matrix and intermediary transform,
session refresh races, login-code redaction/redirects, envelope-less
exit classification, and unknown-diagnostic fallbacks at every wire
locus. The 500-row context-economics fixture intentionally does not
print the rows through script-authored `console`; it proves that
engine-owned stdout/stderr do not leak an unprinted intermediate.

**Done when:**

- The fixture app and harness run in CI (local proof) against dev and
  sessions memory servers.
- Every acceptance family in LLP 0062 §7 and every executable case in
  `app-cli-review-residue` has at least one green, non-skipped case
  wired to it, with the §1-scoped generation races
  running on sessions only.
- The harness fails loudly on any silent coverage cap (no skipped
  cells without a named reason).

## Shelved (2026-08-01, author decision)

Temporarily shelved per Charlie's 2026-08-01 decision on the
triage-sweep recommendation: the app-cli program is paused (owning RFC
LLP 0062 parked at Review since 2026-07-17; LLP 0122 Q6 still open on
the CLI's shape). Reopening condition: LLP 0062 leaves Review or the
program is recommissioned. The design content here is not invalidated
by the shelving.
