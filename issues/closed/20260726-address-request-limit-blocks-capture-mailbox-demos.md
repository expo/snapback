# `AUTH_ADDRESS_REQUEST_LIMIT` made the capture-mailbox code ceremony unusable for a demo fleet

**Filed:** 2026-07-26 · **Source:** Partitime matrix (`demos/partitime`), 7 web cells blocked
**Status:** resolved

## What happened

`AUTH_ADDRESS_REQUEST_LIMIT = 5` per address per 10 minutes applies in every
auth profile. The Partitime matrix runs ~30 cells against one server sharing 5
seeded emails, and SPEC §4b's one-time-code ceremony is the required sign-in
path for the web cells, so the seeded addresses saturated and stayed saturated:

```
POST /auth/request-code (ada@partitime.test) attempts 1..7 -> 429 SNAPBACK_AUTH_THROTTLED
```

A whole 19-check acceptance suite collapsed from that one throttled call
(`vue/snapback FAIL 9/19`, every downstream check skipped).

## Proposed fix (not landed)

`AuthProviderProfile::exempt_from_address_request_limit()` would exempt `Dev`
and `Demo`. Those profiles deliver every code to the in-process capture
mailbox, which has no recipient, so the spam the limit exists to prevent cannot
occur.

- `Test` deliberately keeps the limit, so
  `request_code_has_exact_window_supersession_and_no_app_stream_effect` retains
  its coverage. 350 `auth::` tests pass.
- `Prod` would be untouched.
- Not an unbounded-issuance hole: the global request window and the capture
  mailbox capacity budget still apply. Measured on Dev after the change, 140
  request-codes across 140 distinct addresses in one minute answered
  `82x200 / 58x429 SNAPBACK_AUTH_THROTTLED`.
- Measured in the preserved experiment: 25 consecutive full ceremonies for one
  seeded email, 0 throttled.

## Why it remains gated

Accepted LLP 0057 fixes the per-address budget at five accepted requests per
rolling ten minutes and applies it in the request-code transaction without a
profile exception. Landing the proposed branch would therefore change an
Accepted security contract. The experiment is preserved locally in this clone
on `checkpoint/local-partitime-clients-20260726`, but `main` keeps the ratified
limit until a dated amendment is reviewed and ratified.

## Open question for the owner

The limit is a bare constant with no profile axis and no operator override. If
a hosted/demo deployment ever wants a real mail sender *and* a high limit, or a
Prod deployment wants a lower one, this wants to become configuration rather
than a second hard-coded branch.

## Resolution (2026-07-26)

The provider now exempts only capture-only `dev` and `demo` profiles from the
per-address recipient-spam budget. The global request budget and bounded
capture mailbox remain active in every non-production profile; `test` and
`prod` retain the exact per-address boundary. LLP 0057 records that profile
axis.

`capture_only_profiles_keep_global_budget_but_not_address_budget` proves the
new capture behavior and the retained global bound.
`request_code_has_exact_window_supersession_and_no_app_stream_effect` remains
the production-shaped exact-window proof. A configurable real-mail delivery
budget remains a separate future product decision, not a blocker for closing
this capture-mailbox defect.
