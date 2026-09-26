# Snapback 4: a row's own expiry withdraws a whole remembered answer

- **Opened:** 2026-09-25, from the lane U round 6 and round 7 delta reviews (Grok, then Astra), during the 0.4.2 integration. Lane U round 8 declined it deliberately.
- **Area:** `packages/snapback4/src/local-query.ts` (remembered server answers), and the engine's deadline reporting in `crates/snapback4-core/src/engine/read.rs`.
- **Severity:** Medium. It affects availability, not disclosure.

## What happens

Offline, a remembered server answer is withdrawn when its `nextExpiry` passes. `nextExpiry` is the earliest deadline among everything the engine examined. That includes a row's own `expire at`, such as a typing indicator, and the deadline of an authorization witness, such as a permit that authorizes a private row.

Reproduction: cache an `online only` page that holds a non-expiring message and a typing row expiring at T. Go offline. At T the whole answer is deleted, and the read returns `E_OFFLINE`: every watch clears, although the message is still authorized.

## Why it was not fixed in 0.4.2

Relaxing the cutoff would reopen a disclosure. When a permit authorizes a private secret, keeping the answer past the permit's deadline publishes expired authorization. The client cannot tell the two cases apart, because both arrive as one number.

## The fix

The engine reports the two kinds of deadline separately: an **authorization deadline**, where the witness a rule relied on expires, and **row-expiry deadlines**, where a returned row's own `expire at` falls. The remembered answer keeps the hard cutoff at the authorization deadline. At a row-expiry deadline it refreshes, or drops just that row, without revoking the rest. The result contract says which.

This touches the same deadline scopes that LLP 3000.014's lane T refined (provisional deadlines published on emission; predicate and candidate deadlines). Design it against that code, in an LLP section, before implementation.
