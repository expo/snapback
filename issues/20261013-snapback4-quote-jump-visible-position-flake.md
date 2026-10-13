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
