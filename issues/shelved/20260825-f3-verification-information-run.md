# F-3 information run: the two never-exercised gates now have results

- Status: open (informational; Phase 4 credit still requires the complete battery at the final post-F-1 commit)
- Created: 2026-08-25
- Area: LLP 0283 F-3 verification
- Host: a 24-core Linux build host, clean checkout of `origin/main`

## Why this ran

LLP 0283's F-3 lists seven verification items. Four are already gates inside the complete canonical
proof inventory (LLP 0175 D2.3). **Two had genuinely never been exercised against the carved
workspace**: the cold clone, and the npm closure pack plus install witness. They were run now for
information — not for credit — so that a failure surfaces weeks before it gates the programme rather
than on the day it does.

## Results

| Item | Result |
| --- | --- |
| Cold clone — build and qualify the Rust binary | **Step 1 PASSES.** The clone built the workspace and the runtime readiness receipt was authoritative; link and handler-VM qualification both fine. This was the outcome most at risk given how much the workspace has been carved since the check last ran. |
| Cold clone — browser acceptance | **33/34.** One genuine product defect, filed separately as `issues/shelved/20260825-cron-authored-delta-not-outbox-writer.md`. |
| npm closure pack + install witness | **PASSES.** `published-closure-boot-smoke`, `local-source-package-closure`, `guide-published-closure`, `packaged-store-qualification` and `published-closure-rehearsal` all exit 0. |

## Two failures that were NOT repository defects

Recorded because both would have sent someone chasing nothing, and both were caused by the operator
rather than the repository:

1. **`[cold-clone] FAIL: required tool missing: bun`.** `bun` was installed at `~/.bun/bin/bun` but not
   on the invoking shell's `PATH`. A host problem. Worth noting that the check's prerequisites are not
   obvious from its output — it names the missing tool but not that a login shell may not have it.
2. **`local-source-package-closure` and `published-closure-rehearsal` both failed** with
   `checkout requires Bun 1.3.12; found 1.3.14` and `install uses the checkout-pinned Bun / expected
   1.3.12, actual 1.3.14`. The operator had installed Bun *latest* while fixing failure 1. **The
   checkout pins its Bun version and the closure gates enforce the pin**, which is correct behaviour
   and is the gates working as designed. Installing the pinned `bun-v1.3.12` made both pass.

The general rule this reinforces: a red from a first-ever run on a fresh host must be classified as
**(a)** a repository defect, **(b)** a host-setup problem, or **(c)** a stale expectation in the check,
before it is reported. Two of the three reds in this run were (b), and one was self-inflicted.

## What this does and does not establish

It establishes that neither never-run item is hiding a structural problem — the cold build works and
the published closure installs. It does **not** earn Phase 4 credit: that requires the complete
battery at the final post-F-1 commit, per LLP 0189. Re-run both at that commit.

Related: LLP 0283 F-3, LLP 0175 D2.3, LLP 0189.
