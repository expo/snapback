# Recovery rotation response is rejected after rotating its authority instance

**Status:** Open
**Opened:** 2026-08-21
**Systems:** Password auth, Browser client, Session authority
**Related:** LLP 0227; LLP 0295;
issues/closed/20260820-vite-password-auth-relay-allowlist.md

## Problem

While qualifying the packed Vite password/recovery relay lifecycle,
`POST /auth/recovery/rotate` reached the backend and returned HTTP 200 with the
exact credential-plus-recovery-codes shape, but the packed client rejected it
as `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID`.

The response carries the newly rotated `authorityInstanceId`.
`SnapbackClient.#authPasswordCredentialRotation` currently requires that id to
equal the pre-rotation descriptor even though the server route rotates it. The
server's direct route test accepts the new credential shape, so the client and
server disagree after transport has succeeded.

This is independent of Vite relay admission. The relay lifecycle acceptance
uses a signup-issued one-time code for recovery consumption, while its exact
route matrix still proves `/auth/recovery/rotate` is admitted from the server
route authority.

## Exit

An authenticated generated app client rotates recovery codes against a real
server, adopts the successor credential/authority instance without exposing
the bearer, and can immediately use one of the new recovery codes after
logout. Add an integrated client/server regression outside any relay-specific
harness.
