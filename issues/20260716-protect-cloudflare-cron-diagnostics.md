# Prevent public Cloudflare cron status from disclosing diagnostics

**Status:** Open
**Severity:** P2
**Systems:** Cloudflare target, Cron, Diagnostics, Admin auth
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0049 §Cron, Guide §Operating diagnostics
**Marker:** security, privacy

The Cloudflare gateway forwards `GET /cron/status` without caller headers, and
the coordinator returns `cronStatus()` without the admin read gate used by
`/config/status`. Cron execution persists the complete action diagnostic
message or caught exception text in `last_error`, and `cronStatus()` returns it
verbatim as `jobs[].lastRun.error`.

An unauthenticated caller can therefore retrieve application failure details.
For example, if a cron action rejects with a unique upstream/private sentinel,
the public status response returns that sentinel. Public operational endpoints
are supposed to expose bounded classifications rather than full diagnostics.

**Done when:**

- Either admin-gate `/cron/status` end to end, including gateway header
  forwarding, or define a public projection containing only timestamps,
  outcome, and bounded classification/code.
- Preserve useful detailed diagnostics only on an authenticated operator
  surface.
- Bound and scrub any retained/displayed diagnostic text before persistence and
  projection.
- Acceptance proves an unauthenticated caller cannot recover a private
  sentinel while an authorized operator can still diagnose the failure.
