# `classify_credential` is not prefix-free: `sbs_`/`sct_` swallow `sbs2_`/`sct2_`

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Systems:** Auth, Hosted sender-constrained connections, Credential class dispatch
**Date:** 2026-08-15
**Governing:** LLP 0055 (prefix-free class namespace), LLP 0077 (v2 `sct2_` sender connection grants)
**Related:** `issues/closed/20260725-sender-constrained-classes-unwired.md`,
`issues/closed/20260727-llp0077-v2-prefix-minting.md`
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

`classify_credential` does a first-match `starts_with` scan over
`REGISTERED_CREDENTIAL_PREFIXES` (`src/auth/crypto.rs:770-775`). The
registry lists both v1 and v2 spellings:

- `sbs_` (Session) before `sbs2_` (SenderSession)
- `sct_` (ConnectionToken) before `sct2_` (SenderConnectionToken)

`sbs2_…`.starts_with(`sbs_`) and `sct2_…`.starts_with(`sct_`) are true, so
every v2 token classifies as the v1 class. The module's own invariant test
(`credential_prefixes_are_mutually_prefix_free`, same file ~1116-1142)
documents that this must not happen: a prefix that is a prefix of another
makes structural class dispatch unsound.

Bearer *parsers* are still length/spelling-exact (`SessionBearer::parse`
rejects `sbs2_`), so ordinary session resolution is not a privilege
escalation. The hosted live path is not:

```12199:12207:src/server.rs
        if classify_credential(&connection_token) != Some(CredentialClass::SenderConnectionToken) {
            return Err(ApiError::from(SnapbackError::error(
                "SNAPBACK_CONNECTION_TOKEN_INVALID",
                "realtime",
                "sender-bound connection grants require the v2 token spelling",
            ))
```

The process mints `sct2_` sender-bound grants (`src/server.rs` ~6026). After
`hosted_sender_for_presented_grant` succeeds, this check always sees
`ConnectionToken` and refuses with “v2 token spelling”. Hosted sender-bound
connection/live use cannot work. The dedicated downgrade check never
observes the class it was written for.

`dispatch_credential_class` has the same first-match bug for any surface
that expects `SenderSession` / `SenderConnectionToken`.

## Desired outcome

Longest-prefix match in `classify_credential`, **or** rename v1 to
`sbs1_` / `sct1_` so the namespace is actually prefix-free. Keep
`credential_prefixes_are_mutually_prefix_free` and add a direct
`classify_credential("sct2_…") == SenderConnectionToken` pin.

## Acceptance

- `sbs2_` / `sct2_` classify as the v2 classes.
- `sbs_` / `sct_` still classify as v1.
- The mutual prefix-free test is green.
- The hosted sender-grant gate accepts a process-minted `sct2_` token.

## Non-goals

- Changing minted wire spellings for already-issued v1 tokens.
- Reopening the LLP 0077 grant-binding design.
