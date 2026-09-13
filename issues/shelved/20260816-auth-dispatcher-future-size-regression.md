# Auth dispatcher future regrew past its heap-bounded gate

**Filed:** 2026-08-16 · **Status:** Open · **Systems:** Auth, Server, Testing

## Signal

`server::tests::rehearsal_host_op_future_sizes_stay_heap_bounded` fails
deterministically (not load-sensitive; reproduces in isolation):

```text
auth dispatcher future regrew beyond its post-fix 21,032-byte size: 22264
```

## Attribution evidence

- GREEN on the media program's Phase B merged tree (base `d962379d4`,
  full-lib run 2745 passed / 5 failed, this test not among them).
- RED at `1829eb08d` (fix(ownership-gate): hardening minors 3,4,5,7) —
  verified by checking out that exact commit and running the single test.
- The media landings (`26e0ee26c`, `d4b14d33b`, `71372c5cc`) touch no auth
  dispatch path; Phase C contains no Rust at all.

The regression therefore entered on main between `d962379d4` and
`1829eb08d`. Plausible candidates in that window include the LLP 0258
owner-key threading through AuthCoordinator (`0477fda40`) and subsequent
0258 lanes; +1,232 bytes over the gate is consistent with a new by-value
carrier in the dispatcher future.

## Wanted

Whoever owns the introducing landing: rebox the grown arm (the gate's
existing post-fix pattern) or re-justify and raise the 21,032-byte bound
with a dated note. The gate exists to keep host-op futures heap-bounded;
silently living with the red hides the next real regrowth.
