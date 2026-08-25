# `snapback auth password unlock` accepts the admin token only via env

**Status:** Closed 2026-08-25
**Opened:** 2026-08-15 · **Severity:** P4 · **Area:** CLI / auth
**Found by:** the password clean-install proof
(`issues/closed/20260809-password-credential-auth.md`), against published
`@expo/snapback-cli@0.1.22`.

`snapback auth password unlock` takes its admin token only through
`SNAPBACK_ADMIN_TOKEN`, with no `--admin-token-file` flag, unlike the
convention other admin verbs follow. Papercut: align the carrier surface
with the other admin verbs.

## Resolution (2026-08-25)

The package wrapper delegated `auth password unlock` unchanged, while the
native target accepted an explicit token only through argv or
`SNAPBACK_ADMIN_TOKEN`; there was no non-argv file carrier for a URL-addressed
unlock.

The wrapper now consumes `--admin-token-file <path>`, applies the same strict
owner-only regular-file checks and `SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID`
diagnostic used by managed admin-token custody, removes the file flag from
native argv, and supplies the token only in the delegated child's
`SNAPBACK_ADMIN_TOKEN`. Explicit file custody overrides an ambient token and
conflicts with native `--token`. Leaf help advertises the wrapper carrier.

`packages/snapback-cli/cli-help.test.mjs` proves the token and carrier path do
not reach native argv/output, an ambient token is overridden, and permissive
file modes refuse before delegation.
