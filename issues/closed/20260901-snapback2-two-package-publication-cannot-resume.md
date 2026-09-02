# snapback2: two-package publication cannot resume after partial success

**Status:** Closed
**Resolution:** Staged integrity-bound tarballs and made scripts/publish.mjs converge each registry artifact independently from a durable resume record, covered by partial-publish self-test.
**Systems:** snapback2, publish, npm
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/scripts/publish.mjs:63-64

Failure scenario: the platform package publishes successfully, then npm transiently rejects the shim. Rerunning publish immediately fails because the immutable platform version already exists and exits before reaching the still-missing shim.

Why it happens: the two external commits are unconditional and sequential, with no registry-state check, staged digest, or resume marker. The workflow cannot distinguish an identical already-published first artifact from a conflicting one.

Suggested fix: query each package/version before publishing and skip it only when the registry artifact digest matches the staged bytes; otherwise refuse explicitly. Record/resume the pair until both matching artifacts exist. Add a fake-registry first-success/second-failure test.
