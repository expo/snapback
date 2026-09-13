# Three pre-existing regressions surfaced by the first complete F-3 battery

**Status:** Open
**Filed:** 2026-08-20
**Systems:** Instance fork, Publication, Verification
**Related:** LLP 0283 F-3, LLP 0189, `7d8ffe524`

## Finding

The LLP 0283 F-3 complete proof battery ran end to end for the first time on 2026-08-20 and
attributed nine failing gates to recent work. Six trace to the 2026-08-19/20 program and are
being fixed in their own lanes. These three trace to **`7d8ffe524`**, which predates that
program, and are filed here rather than folded into it:

1. **`sequence-allocation-publication`** — root `7d8ffe524`, compounded by `dc5d59efd`;
   carrier source at `crates/snapback-engine/src/local/auth_room_kick_acceptance.rs:1690-1691`.
2. **`forked-parent`** — root `7d8ffe524`; the new staged clone/startup path at
   `crates/snapback-kernel/src/instance_fork.rs:797-819` and
   `crates/snapback-services/src/instance_fork/service.rs:4104-4106`.
3. **`fork-parallel-dispositions`** — same root as (2); both gates now fail identically
   before reaching any check.

Both fork gates were previously documented green and share one newly changed fork-startup
path.

## Reproduction note

The fork battery discarded the child's detailed `fork-runtime.log`, so the exact failing
assertion inside the new path was not captured. Rerun and preserve it:

```sh
node demos/todo/tests/acceptance/forked-parent.mjs
node demos/todo/tests/acceptance/fork-parallel-dispositions.mjs
```

## Acceptance

- The exact failing assertion in the staged clone/startup path is identified from a preserved
  `fork-runtime.log`, not inferred.
- All three gates return to green, or their expectations are corrected with a recorded reason.
- The fork acceptance harness preserves the child runtime log on failure, so the next
  occurrence is diagnosable from the battery output alone.
