# Snapback 4 quote-jump browser: visible original moves during pooled qualification

**Status:** Open
**Date:** 2026-10-13
**Scope:** Snapback 4 social template / real browser fixture
**Owner:** Unassigned

MACFIX's full Darwin publication client pool on the M5 (Node 24.19.0,
18 CPUs, six ordinary file slots, default TMPDIR) reported one concrete
failure in `social-quote-jump-browser.test.mjs`: online tier, "already visible
original highlights without moving the list; highlight clears", line 247.
The target's viewport top was 273 before and 307 after the jump. The file,
assertion, template and jump implementation were unchanged by MACFIX.
This is outside the deployment path/capability fence repair.

The complete same file then passed in the ordinary runner's one-file slot
(38 tests; about 40 seconds), with all pixel/timing assertions retained.
This is evidence of a scheduling/layout-sensitive failure, not a clean
initial full-pool result. Do not weaken the no-scroll or product timing bars.

Evidence on `ccheever@charlies-macbook-pro-m5max-black`, in the owned worktree
`~/projects/snapback-macfix`:

- `macfix-client-stage.log`: initial 372-file pool; failing nested subtest near
  line 41516, actual 307 / expected 273; the pool reported five failed files.
- `macfix-client-reruns.log`: five targeted files all passed, including the
  unchanged browser file; 167/167 tests. Other four initial reds were missing
  trace fixtures or stale test adapters, independently repaired in MACFIX.

Next step: reproduce this subtest under the normal pool, capture list scroll
position and target/list viewport geometry around route readiness and jump
completion, then distinguish fixture layout settling from a product scroll.
Keep browser measurement independent of driver descheduling and preserve the
existing no-scroll/highlight/arrival assertions. No origin push or publication
was performed by MACFIX.

## Integration 7 pooled evidence — 2026-10-13

The unchanged quote-jump browser file passes inside the fresh full Mac pool
at b7f161eef8 (six slots /default TMPDIR /descriptor limit 65536), about
38.7 seconds. All 373 ordinary files then pass, followed by all 81 default-count
serial models. Three complete Linux pools also passed this file. Keep the
original 273-to-307 failure and its solo-pass evidence: this clean pool does not
identify or repair that earlier layout-sensitive race. The ticket remains open
for geometry/scroll instrumentation; no pixel/timing bar was weakened. Final
pool logs are archived under snapback4/reports/20261013-integration7/mac/.

## Integration 8 pooled evidence — 2026-10-13

The first complete Linux 375-file pool (24 slots, Node 24.13.1) at repaired
HS source repeats the online visible-position assertion at line 247:
296 after the jump versus 264 before it. The same online tier then times out
after 122 seconds in the beyond-horizon anchored read at line 264. Record
both observations without assuming the geometry failure caused the timeout.
Replica-tier assertions pass; the complete file reports 34 passed / 4 failed
(including failed parent subtests). The template, list/jump implementation
and browser assertions are unchanged by HS and the integration repairs.

Evidence: `snapback4/reports/20261013-integration8/linux/client-tests.log.gz`
(archived with qualification). Preserve this red even if a later full pool
passes. No pixel, arrival or timing assertion is relaxed.

### Integration 8 clean-baseline reproduction and final disposition

The corrected complete Linux pool again reports only this file red (374/375
files pass): the same online 296-versus-264 geometry assertion, with three
failed test records including parents. The prior anchored-read timeout does
not recur. The integrated file then passes alone, 38/38, without changing
assertions.

A new clean detached `f9e40ef515` checkout also passes the file alone, 38/38.
Four concurrent complete copies on that clean baseline reproduce precisely
296 versus 264: one failed copy, 149 passed / 3 failed records across all four.
Before/after tracked status is empty. Baseline execution reuses the published
0.4.25 SDK/wasm and Linux binary; `a0bb11bde6` publication runtime/build inputs
are proven identical to `f9e40ef515`. Frozen baseline dependencies are installed.
No current-branch runtime artifact is used in the baseline. Artifact hashes,
commands, source equality and raw logs are archived in Integration 8's report.

This is a corroborated pre-existing failure; leave the issue open. The final
full pool remains red in this file and is not relabelled green by scoped passes.
