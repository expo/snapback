# Clock fixture test can exhaust its wall deadline under parallel load

Status: Open
Date: 2026-10-27
Scope: Snapback 4 language security test harness

`future_payment_can_be_replayed_against_clock_intent` creates a campaign with a
15,000 ms wall deadline and an 8,192-work allowance. In SEC11b's full language
run on the shared host, the 144-test unit binary took 168.87 s and this one test
failed because its fixture population remained empty after `stopped early
(time)`. The other 143 unit cases passed. The exact named test then passes in
isolation in 1.29 s, without any source or assertion change.

The complete `challenges/generated.rs` file is byte-identical to item-1 commit
`1f9b2610d3` (SHA-256
`a0f97e3f91570a9c7d2703939d1cb88578c3ffaf72396ee84f72efbddc32bf0a`).
The original failed receipt and exact retry are retained under
`~/sb4-loop/reports/sec11b/item3-lang-full.log` and `item3-clock-retry.log`.
No original failure is relabeled PASS. Final affected verification uses a
bounded test-thread count; product campaign budgets and scheduling are unchanged.

Follow-up: make this fixture/replay regression use deterministic work bounds,
like production checks and the new assignment regressions, while retaining the
same real admitted-call and false-intent assertions. A host-load timeout cannot
supply a security verdict. Do not fix this by weakening the assertions.
