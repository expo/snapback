# `caps` is red on main: 205 oversize files against a baseline of 204

**Opened:** 2026-09-01 · **Systems:** `scripts/caps.mjs`, `rules/RULES.md`, Snapback 1 engine
**Status:** Open · **Severity:** P2 (blocking gate red on main)

`node scripts/caps.mjs` fails at `4a54bec9d`:

```
oversize files: 205 of 204 allowed by baseline
cap:lines
  crates/snapback-engine/src/local/engine.rs is 45167 lines, over the cap of 1500.
  Baseline allows 204 oversize files; there are 205.
```

Reproduced on a pristine worktree at `4a54bec9d` with zero local changes, and
again with an unrelated docs-only change applied — identical output both times,
so this is inherited on main and not attributable to any in-flight lane.

`rules/RULES.md` says the baseline "may not grow, and `snapback2/` contributes
zero to it." The named file is Snapback 1's local engine at 45,167 lines, which
is far past the point where splitting it is a small change; the 205th entry is
what needs identifying, not that file. Wanted: whichever landing added the
205th oversize file either splits it or the baseline is corrected with a note
saying why, per the rule's own trade.

Found while landing LLP 1007 (`llp/1007-state-of-snapback2-and-the-work.plan.md`),
which proceeded under LLP 0232 as a baseline-proven inherited red.
