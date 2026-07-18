# Document service-principal connection grants

**Status:** Closed
**Severity:** P2
**Systems:** Auth, Guide, LLP corpus, Service principals
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0055; LLP 0059; `guide/auth/protecting-data.md`
**Marker:** documentation-drift, connection-grant, service-principal

The local connection registry supports anonymous, session, and scoped
service-principal bindings, but the LLP 0059 grant-shape example and the auth
guide described only anonymous/session authority. An agent following the guide
could therefore mistake service-principal live connections for an unsupported
or bearer-rebinding path even though the runtime retains their durable resolved
authority, exact token/deadline carrier, and service publication fence.

**Done when:**

- LLP 0059's closed grant-shape example includes service-principal authority.
- The guide explains the durable-authority versus exact-token carrier split.
- The affected guide page is intentionally reviewed and pinned to the landing
  code commit.
- LLP reference and guide checks pass.

## Resolution

LLP 0059 now includes the third closed binding and names both bearer-free
publication handles. The auth guide teaches the same durable-authority/token
split without exposing bearer material. The affected page is included in the
landing commit's intentional review pin; guide generation and LLP reference
validation pass.
