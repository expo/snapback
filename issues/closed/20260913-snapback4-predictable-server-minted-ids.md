# Snapback 4: One server-minted id reveals the xorshift generator

Status: Closed
Resolved: 2026-09-13
Priority: P2
Observed: 2026-09-13
Review finding: S09
Evidence: Reproduced with a standalone probe of `ids::mint`
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../../llp/reviews/3000-security-review-20260913.md)

## Problem and reproduction

Server ids (guest principals, asset ids, engine-minted row ids) are `ids::mint`: 48 bits of milliseconds and 80 bits from two xorshift64 steps on a process-wide `u64`. The 80-bit field contains the entire first xorshift output in bits 16..79. From any one id:

1. Recover `s1 = entropy80 >> 16`.
2. `s2 = xorshift(s1)` is the generator state after that mint.
3. Predict every later id (given the millisecond, which is in the next id or approximately `now`).

Probe: mint A at t, mint B at t+100 from the resulting state; decoding A and stepping xorshift once predicted B exactly.

Session tokens are `getrandom` and are not this generator. Client `mintId` uses `crypto.getRandomValues`. The leak matters because guest principals and asset ids are returned to callers, and a future feature that treats those ids as capabilities would be born broken. The seed (`clock ^ pid ^ stack address`) is also guessable before the first observed id.

## Acceptance

- Server-minted ids that leave the process (assets, guests, anything on the wire) must come from a CSPRNG, or from a generator whose state is not a linear function of the id bits.
- Keep time-ordering if the sort property is still required; 80 bits of `getrandom` under the timestamp is enough.
- Add a test that two ids minted in one process are not predictable from the first by the current xorshift recovery.

## Implementation locations

- [crates/snapback4-core/src/ids.rs](../../snapback4/crates/snapback4-core/src/ids.rs)
- [crates/snapback4-core/src/identity.rs](../../snapback4/crates/snapback4-core/src/identity.rs) (`guest`)
- [crates/snapback4-core/src/engine/mod.rs](../../snapback4/crates/snapback4-core/src/engine/mod.rs) (`store_asset`)

## Resolution — 2026-09-13

Every minted ID now combines the existing 48-bit timestamp with 80 bits from getrandom. Web devices enable the Web Crypto backend as well; xorshift exists only in the regression that demonstrates the former prediction attack. Entropy failure is a typed refusal. Tests cover server minting and more than eight web/native prediction IDs, their persisted replay, and failure of the old state-recovery prediction.

Delivery validation and independent review for the current-main port are in
the [remediation record](../../llp/reviews/3000-security-remediation-20260913.md).
