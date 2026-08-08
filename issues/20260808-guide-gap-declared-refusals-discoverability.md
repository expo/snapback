# guide-gap: declared refusals exist but handlers ship plain throws for months

**Opened:** 2026-08-08 · **Severity:** P3 (DX/discoverability)

The typed refusal channel (`refusals: ['CODE']` + `ctx.refuse(code, details)`)
is exactly right, and the fold-undeclared-to-`SNAPBACK_HANDLER_FAILED`
posture is correct security. But the Zerobugs control — written by agents
reading the guide — shipped every application-semantic refusal as a plain
`throw new Error(...)` through ten receipted gate attempts, and only adopted
the channel when a gate assertion forced it (zb5-hot v9: the short-id
boundary refusal was invisible to the client as anything but a generic
handler failure).

Ask: (1) the mutations guide page should teach refusal-first ("if a caller
could act on the reason, declare it") rather than mentioning the channel in
passing; (2) consider a codegen advisory when a handler body throws
bare Errors on guard-shaped paths while declaring no refusals; (3) the
`SNAPBACK_HANDLER_FAILED` client message could hint "if this is an
application refusal, declare it" in dev mode.

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.
