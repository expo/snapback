# Principal selection: anonymous default, explicit promotion, dev identity

**Status:** Shelved
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Principal selection: anonymous default, explicit promotion, dev identity” shows the issue materially affects a supported product or engineering path; it belongs in the current program but is not an immediate blocker, while the fix requires a few coordinated implementation and test surfaces, with specific cited code, progress, or acceptance criteria.
**Severity:** P2
**Systems:** Tooling, Auth
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §4, LLP 0031 (dev AppAuth lane), LLP 0042 (devUser posture), LLP 0055/0056
**Marker:** app-cli, sub-stage-a, auth

The CLI adds no principals and never guesses. Default is anonymous,
always; `--principal dev|session|agent` selects authority explicitly;
`--principal auto` is a deliberate opt-in resolving from a defined
source inventory with invalid-never-fallback (a malformed source is a
typed error, never a silent step down to anonymous). Dev identity is
the target's own lane: `--principal dev --dev-user <id>` maps to the
dev-mode `DevImpersonation` body contract (refused by sessions-mode
servers; the engine does not gate it client-side beyond the capability
pre-flag). `whoami`/`introspect` report the selected principal's
source, never a secret. The two client-decidable pre-flags — anonymous
× `authenticated`, and principal class absent from target capabilities
— are the only refusals predicted client-side.

Final-revision deltas to honor: `--principal auto` is
conflict-refusal (probe order only, refuses when more than one
source is live); the agent lane is loopback-only (literal
`127.0.0.1`/`[::1]`, the accepted trust decision — see the
agent-onboarding ticket); eligibility rides the `app-cli.target`
structured descriptor, with stage (a) credential-free so the
descriptor is not load-bearing there.

That carve-out is exact: a descriptor-less stage-(a) dev target may
serve only anonymous/dev operations after tuple and artifact
attestation. Descriptor absence never enables `session`, `agent`, or a
non-dev target, and the final descriptor amendment pins its top-level
field name, version, closed principal classes, token-cap field, and
fail-closed absent behavior before any credentialed lane ships.
The same amendment makes the remote-service row non-aspirational by
stating whether its descriptor/envelope advertisement is a phase-1
deliverable or deferred; “yes, once advertised” is not a schedule.

The stage split mirrors the RFC: sub-stage (a) implements only the
anonymous and dev rows; session/agent selection and the complete
capability matrix activate in sub-stage (b) without changing those
already-frozen selection rules.

**Done when:**

- Every `authRequirement` × principal-class cell of LLP 0062 §4's
  matrix has a test, including anonymous × LiveQuery, dev assertion
  accepted in dev mode and refused under sessions, and
  presented-but-invalid sources observed to refuse rather than fall
  back.
- `--principal auto` with two live sources refuses with
  `SNAPBACK_APP_CLI_USAGE`; with one, selects it and reports the
  source in `whoami`.
- The pre-flag tests prove exactly two client-decidable refusals fire
  and nothing else is predicted client-side.
- Descriptor-absent tests distinguish the credential-free stage-(a)
  dev carve-out from every fail-closed credentialed/non-dev case.

## Shelved (2026-08-01, author decision)

Temporarily shelved per Charlie's 2026-08-01 decision on the
triage-sweep recommendation: the app-cli program is paused (owning RFC
LLP 0062 parked at Review since 2026-07-17; LLP 0122 Q6 still open on
the CLI's shape). Reopening condition: LLP 0062 leaves Review or the
program is recommissioned. Note the adjacent landed surface: anonymous
public custody on the packaged client (custody:'anonymous-public',
fix-wave α1 5ed6d6b9) covers part of the anonymous-default story for
protocol clients.
