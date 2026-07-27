# Sender-constrained credential classes are registered but nothing mints or enforces them

**Status:** Resolved (2026-07-27)

**Resolution:** both options, split by hazard. The trap half of option 1 is
taken: `CredentialClass::is_session()` is deleted (zero callers; an unused
fold that would have granted v1 `sbs_` acceptance to any future
sender-constrained check). The classes themselves and `parse_any_version`
stay, per option 2, with `@ref LLP 0077#author-decisions` annotations in
`src/auth/crypto.rs` recording them as reserved-unissued: they are the
commissioned first layer of decision 4's downgrade defense (the
legacy-rejecting versioned prefix), which production has not minted yet —
sender-bound sessions still carry the `sbs_` spelling and their sender-ness
is durable family-binding state. The v2 minting is its own reviewed change,
filed as `issues/20260727-llp0077-v2-prefix-minting.md` (P2, since a
pre-sender v1 *server* rollback would honor an `sbs_` sender-bound token as
a plain bearer; only the prefix closes that, and decision 4 rejects sole
reliance on LLP 0060 D6). LLP 0077's decision-4 checkpoint records the same
caveat.
**Severity:** P3
**Systems:** Auth, Credentials
**Author:** Claude (Opus 5), directed by Charlie Cheever
**Date:** 2026-07-25
**Related:** LLP 0077 (sender-constrained browser auth); PR #4 (`984b6a06`);
`src/auth/crypto.rs`, `src/auth/coordinator.rs`
**Marker:** auth, llp-0077, unwired-seam

This tranche registers two new credential classes and their prefixes:

- `CredentialClass::SenderSession` / `sbs2_`
- `CredentialClass::SenderConnectionToken` / `sct2_`

Both appear in `REGISTERED_CREDENTIAL_PREFIXES`, which is the table a reader
consults to learn which credential shapes the system issues. Neither is
reachable in production:

- `SessionBearer::generate_sender_v2` is `#[cfg(test)]`. Nothing mints an
  `sbs2_` bearer outside crypto.rs's own tests.
- Nothing mints or parses an `sct2_` connection token. `SenderConnectionToken`
  appears only in the enum, the `prefix()` match, and the prefix table — so
  `classify_credential` would name the class if one were ever presented, but
  no code path produces or consumes one.
- `CredentialClass::is_session()` — added here to fold `Session` and
  `SenderSession` together — has zero callers in `src/` or `tests/`.
- `SessionBearer::parse_any_version` (the only production-reachable change,
  wired into two `AuthCoordinator` entry points at coordinator.rs:988 and
  :1033) accepts `sbs_` first and falls back to `sbs2_`. Since nothing mints
  `sbs2_`, it only ever resolves the v1 spelling.

So the class distinction currently buys no runtime property. The risk is not a
present vulnerability — it is that the prefix table now advertises
sender-constrained sessions as an issued credential shape, and `is_session()`
pre-declares that a v1 `sbs_` session satisfies any check written against the
sender-constrained class. The first caller to reach for `is_session()` as an
authorization gate will get v1 acceptance for free, which is the opposite of
what a sender-constrained credential is for.

## Proposed fix

Pick one:

1. If the v2 minting path is imminent, land it and delete `is_session()` until
   a call site needs it — an unused fold over two authorization-relevant
   classes is a trap.
2. If v2 is deferred, annotate both enum variants and `parse_any_version` with
   `@ref LLP 0077#<section>` stating that the classes are reserved and
   unissued, and record which follow-on work mints them. LLP 0077 decision 5
   (WebSocket nonce release) is already tracked as a follow-on; this belongs
   with it.

Either way `llp/reviews/0077-sender-constrained-browser-auth.codex.md` landed in
this same tranche and should say which of the two is intended.
