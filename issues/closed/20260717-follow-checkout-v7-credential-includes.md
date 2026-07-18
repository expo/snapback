# Follow checkout v7 credential includes in CI cleanup proof

**Status:** Closed
**Severity:** P1
**Systems:** CI, Security, Git, Submodules, Acceptance testing
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0010 §CI and Review Gates
**Marker:** actions-checkout, credentials, includeIf, extraheader, submodule, ci

The checkout-credential attestation queried only direct repository-local
`http.*.extraheader` keys. Actions/checkout v7 stores its authorization header
in a separate `$RUNNER_TEMP/git-credentials-*.config` and references that file
through repository-local `includeIf` entries (and may use an unconditional
`include` in related contexts). Plain `git config --local --get-regexp` does
not traverse those files, so a persisted checkout token could survive while
the proof reported success.

The workflow source proof also searched checkout blocks and
`persist-credentials: false` as unanchored text. Commented examples could
therefore satisfy the credential policy without an active YAML property.

**Done when:**

- Effective local config inspection explicitly follows Git includes for the
  root repository and every initialized recursive submodule.
- A matching included extraheader fails without printing its value, while a
  benign included config does not produce a false positive.
- An inspection/parsing failure is a redacted failure, not an implicit pass.
- Tests cover direct, `include`, matching `includeIf`, malformed, direct
  submodule, and nested-submodule credential configurations.
- Only active checkout steps, cleanup commands, and
  `persist-credentials: false` properties satisfy workflow policy.

## Resolution

The attestation now asks Git for the name-only effective local configuration
with explicit include traversal and distinguishes the no-match exit from every
inspection failure. All Git output is discarded; diagnostics describe only
the failed invariant. Existing recursive `git submodule foreach` dispatch now
applies that same effective-config proof at every initialized depth.

The workflow test extracts only active `- uses: actions/checkout@...` step
blocks and requires anchored, uncommented credential properties and cleanup
commands. Credential fixtures model checkout v7's separate config file at the
root and in a nested submodule, retain direct-key compatibility coverage, and
pin both redaction and benign-include behavior.

Verification on 2026-07-17:

- `node tests/ci_workflows_v0.mjs`: passed 10/10 repeated runs;
- `bash -n scripts/check-checkout-credentials`: passed;
- `node --check tests/ci_workflows_v0.mjs`: passed;
- `scripts/check-checkout-credentials`: passed on the working repository and
  its initialized recursive submodules;
- `./ref-check --verbose`: 63 LLP documents, 1,380 references, no errors or
  unchecked references;
- `git diff --check`: passed.
