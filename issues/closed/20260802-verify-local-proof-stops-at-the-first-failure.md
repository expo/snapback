# verify-local-proof stops at the first failure, so the queue behind it stays invisible

**Status:** Resolved
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Severity:** P2
**Systems:** CI, Developer experience
**Author:** Claude (Fable 5), directed by Philippe Loulidi
**Date:** 2026-08-02
**Related:** LLP 0010

`scripts/verify-local-proof` runs its gates under `set -e`, so the first
failing gate ends the run. When the lane has been red for a while, that means
each CI round reveals exactly one defect and hides however many are queued
behind it. Fixing one costs a full round (~10 min) just to learn the next.

Measured on 2026-08-02 while greening the lane: the proof surfaced its
defects strictly one per round — demo-list drift, then a moved workflow file,
then three separate waves of unregistered package tests, then a missing
declaration, and so on. Replaying the JS-only prefix locally with a loop that
continues past failures found the remaining two (a stale publication carrier
and two unclassified guide routes) in a single pass. The throwaway script is
reproduced below; it is the shape a real `--keep-going` would take.

```bash
for step in "${STEPS[@]}"; do
  out="$(eval "$step" 2>&1)"
  if [ $? -eq 0 ]; then printf 'PASS  %s\n' "$step"
  else printf 'FAIL  %s\n' "$step"; printf '%s\n' "$out" | tail -12; fi
done
```

Suggested shape: a `--keep-going` flag (or `SNAPBACK_PROOF_KEEP_GOING=1`) that
runs every gate, prints a PASS/FAIL summary with a bounded tail per failure,
and exits non-zero if any failed. Default stays fail-fast so a normal local
run is quick. CI would pass the flag, so one red round names every broken
gate instead of the first.

Caveat worth respecting: the later stages genuinely depend on earlier ones
(the Rust gates need the bootstrap to have produced a runtime; the demo
provisioning test needs the regen gate to have materialized manifests). A
useful `--keep-going` therefore continues past *independent* gate failures
but must still stop a dependent stage whose prerequisite failed, rather than
reporting a cascade of derived errors as separate findings.

Exit: one CI round on a broken lane names every failing gate, and the
dependent stages are reported as skipped rather than as extra failures.

## Resolution (2026-08-02)

**Status: Resolved.** `scripts/verify-local-proof` gains exactly the
suggested shape: `--keep-going` flag or `SNAPBACK_PROOF_KEEP_GOING=1` runs
every gate through the shared `run()` wrapper, prints a per-failure `FAIL
(exit N): <command>` line inline plus a final `KEEP-GOING SUMMARY` naming
every failed gate, and exits 1 if any failed. Default stays fail-fast with
the failing gate's own exit code. CI passes the env var in
`local-proof.yml`. Unknown arguments exit 2. Verified by standalone harness
on /bin/bash 3.2 and modern bash: continue-past-failure + summary + exit 1;
fail-fast stops at first gate with exit 3; all-pass keep-going exits 0 with
no summary; `bash -n` clean. Known accepted shape: gates downstream of a
failed producer (e.g. the built binary) fail as a cascade — the summary
shows all, first failure is authoritative.

## Corrective completion (2026-08-05, LLP 0175)

The accepted cascade above did not meet this issue's original dependency-aware
exit criterion. LLP 0175's first implementation tranche completes it:

- every canonical command now has a stable gate id and structured duration;
- producer prerequisites are explicit and transitive;
- keep-going records dependents as `BLOCKED` without executing them, while
  independent gates continue;
- selected `BLOCKED` gates keep the proof red but do not become additional root
  product failures; and
- fixtures prove a failed build blocks readiness and downstream acceptance,
  and the inventory rejects a newly declared direct real-server gate without
  current-binary readiness.

CI retains the JSONL gate artifact on both green and red runs. The issue is
therefore still resolved, now for its intended exit rather than the interim
flat-runner behavior.
