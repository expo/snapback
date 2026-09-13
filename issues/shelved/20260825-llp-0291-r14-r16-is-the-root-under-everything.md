# LLP 0291's R14–R16 is the root under the reopened rows and the recurring defeats

Status: open
Date: 2026-08-25
Systems: snapback-sync, snapback-auth, snapback-engine
Related: llp/0291-authority-forgery-surface.research.md,
  llp/0303-subject-authority-correlation-policy.decision.md,
  issues/closed/20260825-none-of-the-nine-landed-rows-were-closed.md,
  issues/shelved/20260825-the-privilege-ratchet-cannot-measure-this-defect-class.md

## The connection

Three independent findings this cycle turn out to be **one** documented composition.

- An audit re-attacked all nine rows reported as closed and found nine of nine open, with **eight
  falling to a single no-features root**.
- The strongest lane of the programme — complete 13/13 and 12/12 enumerations, external fail-first,
  Cargo unification deliberately exercised — was defeated by an external dependent that executed
  `PUBLIC_STAGE committed=1 durable_auth_user=usr_external_forged` **without ever reaching the entry
  point it had bound**.
- The membership lane's three rows were judged open on the same shape.

All three are **R14 + R15 + R16 in LLP 0291**, an Active research document dated 2026-08-20 —
commissioned by this programme, five days before any of these findings:

| ID | Surface | LLP 0291's verdict |
|---|---|---|
| **R14** | `ResolvedAppAuthority` is a public enum with public fields (`snapback-sync/src/auth/invocation.rs:297`), plus `from_session` (`:393`), `from_scoped_token` (`:458`), and `prepare_admitted_authority` (`:1940`). `ResolvedSession`, `ResolvedScopedToken` and `AuthClaimsProjection` also have public fields and constructors. | **"YES, directly, no durable exploit required."** No credential needed. |
| **R15** | `AdmissionController::new` / `from_mode_state` / `admit` (`snapback-auth/src/auth/admission.rs:227`, `:232`, `:366`). A constructed controller proves ownership only relative to itself; `prepare_admitted_authority` never proves the lease belongs to the target `LocalSnapback`. | **"YES, enables R14."** Nothing beyond public constructors. |
| **R16** | Nine public execution sinks accepting `PreparedAuthority`: `snapback-engine/src/host_ops.rs:1133`, and `local/engine.rs:10883`, `:10963`, `:14849`, `:14942`, `:19170`, `:20393`, `:20718`, `:20726`. | **"YES, consumes R14's fabricated principal."** |

## The sentence that names the fix

From R16:

> Session authorities are **not re-resolved** by `validate_prepared_service_authority`; only
> service-principal variants get current durable revalidation.

The mechanism already exists and is already correct — for one variant. Service-principal authorities
are revalidated against current durable state at the sink; session authorities are not. That asymmetry
is the defect, and closing it is not new machinery.

## Why it kept being missed

Every lane that fell to this enumerated **its own row's entry point and that entry point's callers**,
thoroughly and correctly. R14–R16 is not any row's entry point — it is a parallel path to the same
durable effect, reachable with no features and no credential. That is exactly the distinction LLP 0303
revision (q) was written for: *enumerate the effect's producers, not the entry point's callers.*

It also explains why fixes kept passing review: each review checked the fix against the row, and the
fix was correct against the row.

## What follows

- **This is one piece of work, not eight rows.** Closing R14/R15/R16 plausibly closes F170–F173, F188,
  F190, F191 and bears directly on F091, C004, F232, F233 and C007. It should be staffed as a single
  lane and nothing else should be dispatched against those rows until it lands.
- **The enumeration is already done.** No lane needs to rediscover the surface; LLP 0291 lists every
  site with file and line, and its verdict column already distinguishes conditional from direct.
- **Land the asymmetry fix first and measure.** If re-resolving session authorities at the sinks closes
  the composition, the row-by-row work collapses considerably.

## The uncomfortable part

This document has been Active in the corpus for five days, commissioned by this programme, and the
programme spent that time closing rows one at a time against entry points while the root sat
enumerated. The corpus was not the problem; not reading it was. Orientation before staffing is a
documented step in this repository's own workflow, and skipping it cost the nine rows the audit
reopened.
