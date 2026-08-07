# Cold-clone Chrome loader resource exhaustion

**Status:** Closed — fixed forward 2026-08-06
**Opened:** 2026-08-06
**Systems:** CI, Browser acceptance, Demo apps
**Related:** LLP 0010, LLP 0015, GitHub Actions run `31137213479`, PR #18

## Failure

After the cold-clone lane's runtime bootstrap was restored, its All Aboard
browser acceptance reached 32 of 34 checks. The two remaining checks — the
second-window boot and the backend-unreachable cold open — launched isolated
Chrome processes as intended but failed while loading raw Vite modules with
`net::ERR_INSUFFICIENT_RESOURCES`. Both processes reported loader failures;
neither reached a product assertion or emitted a Snapback/Exact runtime
exception.

## Attribution

The existing isolated-process workaround for Chrome 151 on GitHub's Linux
image landed in `e3c847bf83`. PR #18's corrected bootstrap allowed the lane to
reach the later browser graph and exposed that process isolation alone does not
guarantee a successful raw-module load under transient runner resource
pressure. This is proof-infrastructure debt, not a regression in the All
Aboard product behavior and not part of PR #17's wave-regeneration changes.

## Resolution

The two independent cold opens now retry only when the complete error chain
contains Chrome's exact `net::ERR_INSUFFICIENT_RESOURCES` diagnostic. Each
attempt owns a fresh browser process and its attested cleanup, Linux isolated
processes use `--disable-dev-shm-usage`, and the retry is capped at three
attempts. Product assertions, timeouts, CDP failures, cleanup failures, and all
other diagnostics remain single-attempt failures. Deterministic fixtures pin
successful recovery, non-retryable product failure, and bounded exhaustion.
