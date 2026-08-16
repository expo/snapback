# `snapback auth password unlock` accepts the admin token only via env

**Status:** Open
**Opened:** 2026-08-15 · **Severity:** P4 · **Area:** CLI / auth
**Found by:** the password clean-install proof
(`issues/closed/20260809-password-credential-auth.md`), against published
`@expo/snapback-cli@0.1.22`.

`snapback auth password unlock` takes its admin token only through
`SNAPBACK_ADMIN_TOKEN`, with no `--admin-token-file` flag, unlike the
convention other admin verbs follow. Papercut: align the carrier surface
with the other admin verbs.
