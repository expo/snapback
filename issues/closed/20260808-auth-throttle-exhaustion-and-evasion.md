# Auth throttle: attacker-controlled `subject` exhausts the shared table → deployment-wide 503; per-dimension limiters independently evadable

**Opened:** 2026-08-08 · **Severity:** P2 (fail-closed DoS on the whole auth plane) · **Area:** auth / throttle

## A) Capacity exhaustion → 503 for everyone

`src/auth/throttle.rs:369-375` (capacity gate); `src/server.rs:10884-10892`
(`Err(_)` → 503). Production config: `maximum_key_count: 100_000`,
`retention_ms: 600_000` (`src/bin/snapback-hosted-admission.rs:144-145`).

```rust
if existing < 0
    || (existing as u64).checked_add(new_count)
        .is_none_or(|count| count > config.maximum_key_count)
{ return Err(AuthenticationThrottleError::Capacity); }
```

Verified: `Capacity` flows through the catch-all `Err(_)` arm to
`SNAPBACK_AUTH_THROTTLE_UNAVAILABLE` / **503** for every caller. The bucket keys
are HMACs over the client-supplied `subject` (login identifier), and each denied
attempt still inserts its rows carrying a future `theoretical_arrival_ms`
(denial debt) that the retention prune can't reclaim inside the window.

**Failure scenario:** one source rotating a fresh `subject` per request writes
~2 new rows/request; sustained ~150-200 req/s fills 100k rows within the 10-min
retention window. Thereafter every legitimate user's charge (new keys) trips
`Capacity` → 503 — authentication is denied deployment-wide until the flood
stops (self-heals one retention window later). Fail-closed DoS, not a bypass;
scoped per single-instance deployment.
*Fix:* LRU-evict oldest `last_used_ms` rows to make room instead of failing the
whole charge at capacity, and/or cap distinct subject rows per source before the
global cap.

## B) Per-dimension limiters independently evadable

`src/auth/throttle.rs:221-232` (`grouped_source`, IPv6 grouped only to `/64`),
:284-307 (per-identifier `subject`/`source_subject` keys). An attacker with a
routed IPv6 allocation (/56–/48) rotates the /64 for a fresh `source` bucket and
rotates `subject` for a fresh subject bucket, defeating both per-dimension
limiters; credential-spray is then bounded only by the single `global` bucket
(which governs the whole deployment). Compounds (A).
*Fix:* add a coarser source group (also key a /48 or /32 IPv6 bucket) and treat
`global` as the real brute-force ceiling in the threat model.

## Confidence

Medium. The module's "finite denial debt" comment addresses per-key counter
growth, not key-cardinality growth — this is not a documented tradeoff. (B) is
inherent to IP/identifier keying but the design leans on these as independent
defenses.

## Resolution (2026-08-08)
Fixed on main (Lane C). Verified: cargo build; targeted suites pass (throttle 4/4, instance-lock 11/11, fork 3/3, value_expr 10/10, config 23/23, embed 7/7, workerd 10/10, data-tier corpus 2/2 + 37-case parity); ref-check clean.
