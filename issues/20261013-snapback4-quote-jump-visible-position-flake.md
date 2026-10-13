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
