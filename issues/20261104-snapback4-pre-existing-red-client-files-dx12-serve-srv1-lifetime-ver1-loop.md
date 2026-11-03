# Three snapback4 client files are red on main before and after LLP 3000.001.001 landed

**Filed:** 2026-11-04 by the progressive-acquisition landing (Claude Fable 5.1 supervising).
**Status:** Open — fix-forward (LLP 0189: scheduled-battery reds become tickets, not landing vetoes).
**Systems:** snapback4 client test suite (`packages/snapback4/test/`), `dev`/`serve` process lifecycle witnesses.

The broad affected battery (`node snapback4/scripts/affected.mjs --base origin/main --run`, all 491 client files) run five times during the LLP 3000.001.001 landing showed three client files red every time. Each fails **identically on the base commit `18c70392f2`** (the commit before any of this lane's changes), reproduced on 2026-11-03 in an archive tree of that commit with a freshly built CLI, wasm and client package, Node 24.18.0, Darwin on the black M5 Max:

| File | Failing cases | Base commit result |
| --- | --- | --- |
| `dx12-serve.test.mjs` | "serve shutdown failure cannot earn success from a successful command" | 6 pass / 1 fail |
| `srv1-lifetime.test.mjs` | "036/017/008: SIGTERM to npm only releases {serveUntilSignal driver, native CLI} store and pipes"; "036/017/008: SIGKILL to npm only releases …" (both drivers); "024: request driver awaits npm close through tail after terminating only the wrapper"; "036/017/008: deploy immediately after npm TERM ({proof driver, native}) waits for ownership" | 7 fail |
| `ver1-loop.test.mjs` | "verify SIGKILL and outer npm death stop the active phase and never start later proofs" (×2) | 6 pass / 1 fail |

All three concern process-lifecycle custody of `npm`/`serve` children (signals, ownership waits, shutdown outcomes), not the sync protocol. They are the only reds left in battery attempt 5 on `b7a321fc39` besides one confirmed load flake (`server-e2e` "scheduled generated action runs under its declared service seat": 9/9 alone on the lane and on the base commit).

**Evidence:** `snapback4/reports/20261102-progressive-history-reviews/` (the landing's review index) and the program log at `~/projects/snapback-ph-program-20261102/STATUS.md` (`logs/base-reds-2.log` has the base-commit runs; `logs/affected-attempt5-b7a321fc39.log` the final battery).

**To do:** reproduce on a quiet host (the M5 Pro mini or Studio B) to rule out this laptop's process-inspection/`ps` custody quirks, then fix forward or re-baseline the witnesses. Not a progressive-acquisition defect.
