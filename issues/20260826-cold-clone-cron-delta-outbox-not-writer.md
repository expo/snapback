# Cold clone: cron-authored delta cannot reach the browser (SNAPBACK_OUTBOX_NOT_WRITER)

**Status:** open
**Date:** 2026-08-26
**Systems:** sync, outbox, bindings, cron, All Aboard contract surface
**Related:** LLP 0283 F-3 (verification that had never run), `scripts/cold-clone-check.sh`

## What this is

The first completed run of `scripts/cold-clone-check.sh`. LLP 0283 F-3 lists the cold clone
among the verifications that have **never been exercised**; a prior attempt reached step 1
and stopped for want of a browser. This run completed both steps.

**Result: 33 of 34 browser acceptance checks passed, 1 failed.**

Step 1 passed cleanly — a production build from registry packages in a genuine cold clone,
with no sibling checkout and no pin file. So a stranger can build this repo from nothing.

## The failure

```text
check: "cron-authored delta reaches the browser through the bindings (no pump)"
code:  SNAPBACK_OUTBOX_NOT_WRITER
message: this context does not hold single-writer ownership of the client store;
         the mutation was not queued
```

A cron-authored delta does not reach the browser through the bindings, because the
authoring context does not hold single-writer ownership of the client store, so the
mutation is never queued. Everything else in the paved path is healthy in the same run —
`livePush: true`, and `liveTrainStatus` / `liveDepartures` / `feedState` all report `live`.

This is a product diagnostic, not an environment error. It is a real defect in the cron →
outbox → bindings path, exposed only because this check finally ran end to end.

## Environment notes for reproducing

Neither host could run this alone: the Linux build host has no browser and no passwordless
sudo to install one; the Mac build host had Chrome but no `bun`, and its default `node` was
v18, which fails earlier at `import.meta.resolve is not a function`. The repo correctly
declares `engines: node 24.x` and ships a `.node-version`, so that was environment drift
rather than a repo defect — but **nothing enforces the declared version**, so a stranger on
Node 18 gets a confusing `TypeError` from `packages/snapback-codegen/index.mjs` instead of
"this needs Node 24". A version gate in the entry scripts would turn a puzzling failure into
a one-line answer; filed here rather than as its own ticket because it surfaced in the same
run.

Working invocation:

```text
PATH=$HOME/.volta/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$PATH \
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
scripts/cold-clone-check.sh
```

## Why it matters

F-3 credit requires this check to pass. It does not. The gap is one named check with a
precise diagnostic, which is a far better position than "never run" — but it is not green,
and no F-3 claim should describe it as such.
