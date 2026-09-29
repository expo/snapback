# Intermittent failure: `online: revoked data, keep=undefined, held`

Status: Open
Date: 2026-09-29
Systems: Snapback 4 client tests (`packages/snapback4/test/answer-withdrawal.test.mjs`)

The landing suite for lane AG (main `b7d05baff` plus AG's compiler-only change) failed once
in `client tests`:

```text
✖ online: revoked data, keep=undefined, held (160.81002ms)
  AssertionError: expected 'private answer', actual undefined
  at answer-withdrawal.test.mjs:207
```

AG changed no client code. The same test passed in lane AQ's landing suite on the same
base. It passed 5 of 5 isolated reruns in AG's landing tree (8 of 8 matching cases each).
The suite ran with other lanes active on eb1000.

Next: rerun it under CPU contention, and record the observation timeline to find the
timing window. Do not weaken the assertion or turn the failure into a pass.
