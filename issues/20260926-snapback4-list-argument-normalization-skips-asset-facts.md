# Snapback 4: list argument normalization skips authoritative asset facts

**Opened:** 2026-09-26, Astra's blind review of `99ef276d95`
**Severity:** High: forged upload metadata can pass an application's mutation guard
**Area:** `snapback4/crates/snapback4-core/src/engine/mod.rs`, argument normalization
**Status:** Open; inherited from the parent, outside image-list fix round 2

Before executing a mutation, argument normalization unwraps one `Optional`
and stamps facts only for scalar `Image`/`Video` arguments. It skips `List`.
The later column stamping makes stored facts authoritative but runs after
application guards have already evaluated caller-supplied list facts.

Astra's `additional.rs::list_fact_input` reproduces this with an Alice-owned
PNG upload `a` whose ledger dimensions are 640 × 480 and whose size is 24 bytes:

```quarry
use server
table posts:
  owner: principal
  photos: [image <=1000] <=4
  read <- .owner = viewer
  insert <- .owner = viewer
mutation guarded(photos: [image <=1000] <=4):
  for p in photos:
    require p.width = 1 else WRONG_WIDTH
  return insert posts { owner: viewer, photos }
```

As Alice, call `guarded` with `photos: [{ id: 'a', width: 1 }]`.
Observed: `WriteState::Sent`; the guard accepts forged width 1 for the
640-pixel upload. Expected: normalize the argument from the upload ledger
before the guard, then refuse with `WRONG_WIDTH`. Column stamping afterward
does not repair the decision already made by that guard.

Evidence: `/Users/ccheever/projects/snapback-sb5-program/reviews/landing/imagelist.astra.md`
and its archived `imagelist-astra-probes/tmp/imagelist-astra/additional.rs`
and `additional.log`. The normalization block was unchanged by `99ef276d95`.

Follow-up: recursively normalize optional/list image and video arguments before
program execution, preserve uploader/system authority and declared work bounds,
and regress guards reading width, height, bytes and duration, including nested
and optional lists. No argument-normalization fix is included in this branch.
