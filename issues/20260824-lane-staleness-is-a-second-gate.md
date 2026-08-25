# Lane staleness is a second gate, and it compounds every round

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Systems:** Process, Build
**Date:** 2026-08-24
**Related:** LLP 0189, LLP 0232, CLAUDE.md ("`main` moves fast"),
  `issues/20260824-linux-build-hosts-for-snapback-crates.md`

## What happened

A lane cleared its review with no outstanding findings. Before landing it, the eight crates its diff
touches were compile-checked. **Six passed, two failed:**

```
snapback:            error[E0063] missing field `port_range` in `snapback::cli::Args`
snapback-activation: error[E0599] no method `private_failure_context` on
                     snapback_auth::diagnostic::SnapbackError
```

`vendor/ibex` was present, so these were real failures, not the usual environment gap. The cause was
that the branch had fallen **179 commits behind `origin/main`**. Neither error had anything to do
with the lane's own change.

Rebasing then produced a **source** conflict — in a file where an earlier measurement had found
none. That earlier "zero source conflicts across six lanes" result was a snapshot at one instant, not
a property, and it stopped being true as `main` advanced.

## The measurement

All nine in-flight lane heads against `main` at `8e9086c73`:

| Lane | Commits behind |
|---|---:|
| q43 | 27 |
| q12, q04, q10, q14 | 50 |
| deny, q06 | 51 |
| q05 | 94 |
| OAuth | **180** |

`main` advanced roughly **50 commits during a single fix round**. So drift is not a fixed tax paid
once at landing — **it accrues per round**, and a lane needing four rounds accumulates on the order of
200 commits of drift before anyone tries to land it.

That is the mechanism behind an otherwise puzzling observation: lanes clear their reviews and still
do not land.

## Why it was invisible

The review gate answers "is this change correct". Nothing in that question notices that the base has
moved. A lane reports green suites truthfully, a reviewer executes real exploits against the branch,
and both are working against a tree that no longer merges cleanly with `main`.

It also interacts with the environment gaps recorded in the build-hosts ticket: a lane that cannot
build `snapback-engine` or `snapback-server` for lack of `vendor/ibex` cannot distinguish "my change
does not compile" from "this crate never compiled here", and neither can it see drift-induced
breakage.

## What to do

**Rebase at the start of every fix round, not at the end of the lane.** A round that begins on current
`main` accumulates at most one round of drift, which is a conflict a lane can resolve while it still
has the context. A lane that rebases only when it is otherwise finished is resolving conflicts in code
it last thought about several rounds ago.

Concretely, every fix-round brief should open with `git fetch origin && git rebase origin/main`, and
every review dispatch should be preceded by the crate-list pre-gate:

```sh
git diff --name-only origin/main <sha> | grep '^crates/' | cut -d/ -f2 | sort -u
# then: cargo check --locked -p <each> --tests
```

This is consistent with CLAUDE.md's standing warning that `main` moves continuously and that
processes must not assume it is quiet. The warning was written about *qualification loops*; this is
the same hazard applied to *lane lifetime*.

## One further observation

The OAuth conflict was with commits from **another session working the same LLP 0303 subject matter**
— `Break grant approval fixture axis bijections` and `Complete grant approval physical readback`. The
work turned out to be adjacent rather than duplicated: those commits contain zero lines mentioning
`oauth_consent` or `approval-session`. But it is worth knowing that concurrent sessions are editing
the same fixture file for the same programme, and a conflict there needs checking for duplicated
effort before it is resolved mechanically.
