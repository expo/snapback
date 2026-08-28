# None of the nine rows reported as landed were closed

Status: Closed
Date: 2026-08-25
Systems: snapback-sync, snapback-engine, snapback-kernel, snapback-auth
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260825-a-closes-rows-trailer-is-a-claim-not-a-label.md,
  issues/20260824-landings-must-name-the-rows-they-close.md,
  issues/20260825-q06-landed-but-a-second-reviewer-says-the-output-travels.md

## The result

An audit re-attacked every row this programme reported as landed, at current `origin/main`, using
dependent-crate witnesses. **Nine of nine are OPEN.** The four function names claimed by the
deny/revoke landing are **NOT-A-ROW** — they are absent from the 134-row inventory.

| Row | Verdict |
|---|---|
| F157, F175 | OPEN — engine A's cloned carrier is accepted by engine B, which durably records `Approved` |
| F170, F171, F172, F173 | OPEN — a foreign lease plus caller-authored facts reaches the real OAuth sinks |
| F188 | OPEN — two public partial APIs compose into a pending grant the forged authority then approves |
| F190, F191 | OPEN — forged authority plans a terminal, acquires its gate, composes with the public durable writer; the revocation commits |

**The true landed count is 1** — F297, closed by private registry ownership, independently reviewed and
landed 2026-08-25. Every earlier figure this programme published (11, then 9) was wrong, and wrong in
the direction of over-reporting.

## The shared root

One attack root produces eight of the nine, and it needs **no features at all**:

> Construct a second public `AdmissionController`, obtain a lease, directly construct
> `ResolvedAppAuthority::Session` with the victim's identifiers and a caller-selected authority
> descriptor, and pass both **independently** to `prepare_admitted_authority`
> (`crates/snapback-sync/src/auth/invocation.rs:324`, `:2714`).

F157 and F175 are a second, related root: `PreparedBearerAuthority` and `ResolvedServiceAuthority` are
`Clone` and carry **no database binding**, so a carrier produced by engine A is accepted by engine B,
which compares identity fields but not provenance
(`crates/snapback-sync/src/auth/coordinator.rs:413`, `crates/snapback-engine/src/local/engine.rs:6017`,
`:3658`, `:6063`).

That second root is precisely the challenge already recorded against the Q06 landing. It was rated
"medium-high confidence, unexecuted". It is now executed.

## Why this was not caught

Every one of these rows was fixed at its **named entry point**, and each fix was real — the audit's
negative probe confirms `Default`, `From`/`Into`, serde and `builder()` are all genuinely absent on
`PreparedAuthority`, `PreparedBearerAuthority` and `ResolvedServiceAuthority` (15 attack expressions,
both feature cells). The carriers were locked down. What survived is the **producer**: a public enum a
caller can construct directly, and a public preparation that accepts subject and authority as separate
arguments.

This is LLP 0303 revision (q) — *enumerate the effect's producers, not the entry point's callers* —
demonstrated against nine rows at once. The rule was derived from two reviewers disagreeing about a
single row; this is the same finding at the scale of the whole programme's reported progress.

## Coverage, and the honest limit

The primary cell is **production-shaped**: witness package `--no-default-features`, direct Snapback
dependencies with defaults disabled, `snapback-engine/engine-owner` required, and **no `test-support`
anywhere**. A second additive cell unified `test-support` across five crates and additionally succeeded
through `InvocationGate::prepare_authority`, `AdmissionLease::unmanaged`,
`ResolvedServiceAuthority::synthetic_for_test` and `PreparedBearerAuthority::into_parts`.

Stated limit: a literally featureless `snapback-engine` was not testable, because removing
`engine-owner` makes the dependency fail internally at `host_ops.rs:1078` before the attack expression
compiles. So the result is precisely "no optional or test-support features", not "zero engine ownership
features". Witnesses ran at `baacaa209`; no intervening change touched the five relevant crates.

## What follows

- **The count is 1, and every published figure must say so.** Five earlier counts were corrected
  downward. This is the sixth and by far the largest.
- **The nine rows return to the board**, but they are not nine independent pieces of work. Eight share
  one root, and that root — `ResolvedAppAuthority` construction plus independent-argument preparation —
  is already the subject of in-flight work. Closing it is plausibly one lane, not nine.
- **A landing is not evidence.** Only an executed refusal at current `origin/main` is. The trailer rule
  already says a trailer counts once a review verifies it; this adds that *reviews of the fix are not
  interchangeable with attacks on the row*, because every one of these fixes passed its review.

## Resolution

Closed 2026-08-28. Point-in-time audit that nine claimed closures were still open. Superseded as a board by `issues/20260825-eight-rows-verified-closed-by-two-instruments.md` (eight of those later verified closed; F170 left open). The standing process lesson lives in `issues/20260825-a-closes-rows-trailer-is-a-claim-not-a-label.md`.
