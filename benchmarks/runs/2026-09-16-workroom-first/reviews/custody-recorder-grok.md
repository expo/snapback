# Shared custody recorder isolation — Grok source review

2026-09-17. Fresh Grok 4.6, xhigh, source-only, mutually blind.
Started 20:08:46.610Z, completed 20:15:14.249Z, exit 0.
The entire current warm-runtime wrapper, tests, shared helper and deltas
were pinned. Helper SHA-256
`32234d430e1235248e19e87795d0bb0d74cd42f1c5da41abe1d0cfdb32bc2a2c`.
No app/runtime/provider execution or implementation by the reviewer.

The verdict portion of the received public answer follows verbatim.
The retained full public transcript also includes two short reading-progress
messages; its SHA-256 is
`471eefa4293f6a1a4a3fd25d0e4836faae0dbb7947cba078e8ac06aa51d2d0ca`.
No private reasoning transcript is reproduced.

> **READY**
>
> Shared helper `ProcessCustody` recorder isolation is also ready for other callers of this same helper (this is not a review of any provider wrapper).
>
> The 17-line repair latches exactly one in-memory `PILOT_CUSTODY_RECORD_FAILED` inside `emit` without re-entering `emit`/`uncertain`, leaves exact-identity cleanup running, and rebinds `receipt.ok` plus the `custody-cleanup-complete` event after that emit so a first failure on completion cannot stay green. W8 rebinds `FACTS.helperSha256` to `32234d430e1235248e19e87795d0bb0d74cd42f1c5da41abe1d0cfdb32bc2a2c` and fail-closes on that file in inner preflight; source/dependency/store/result binding, bounded blackhole/backend/acceptance, post-spawn seeded and unseeded cleanup, and positive-PID adapters are fail-closed in the current source. Documented TOCTOU, last-yield cutoff, fast unobserved double-fork, and conservative command-hash refusal are unchanged accepted limits. Source review cannot prove runtime acceptance.
