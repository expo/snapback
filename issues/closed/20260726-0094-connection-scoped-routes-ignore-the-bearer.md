# 0094 spec defect: the bearer is inert on every connection-scoped route, so a session change that does not re-open the connection keeps serving the previous user's data

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 **Dart** client build,
`clients/dart`).
**Systems:** Auth, Wire Protocol, Client SDK, HTTP surface

> **Scope note.** The concurrent P-4 **Kotlin** build independently filed the
> two adjacent findings this ticket does not restate:
> `issues/20260726-0093-p4-connection-open-auth-rr-gate.md`
> (`/connection/open` is labelled Public but demands the `auth/rr` offer)
> and `issues/20260726-0093-p4-sessions-mode-unsubscribe-body-auth.md`
> (T-UNSUB's recipe is dev-mode-only). Both reproduce here. This ticket is
> the consequence neither of them draws out.

## The defect

The bearer presented at `POST /connection/open` is what resolves the
connection's authority. After that it is **inert**: `/live/*/subscribe`,
`/live/*/unsubscribe`, `/live/{id}/stream` and `/outbox/{id}` are
`ConnectionAuth` routes whose credential is the connection grant, and
`Authorization` on them is neither required nor consulted.

Measured on a live sessions-mode server (`demos/rbac`, two identities,
2026-07-26):

| request | result |
| --- | --- |
| subscribe on **alice's** connection sending **bob's** bearer | **alice's rows**, `permission_epochs: {"user:<alice>":0}` |
| subscribe on an anonymously-opened connection sending alice's bearer | 401 `SNAPBACK_AUTH_REQUIRED` |
| unsubscribe with the right grant and **no** `Authorization` at all | 200 disposed |
| unsubscribe with alice's bearer but bob's grant | 403 `SNAPBACK_LIVE_RESUME_OWNERSHIP` |

**This is not a security hole.** The grant is bound to the right identity at
open and every check downstream is correct. It is a documentation hole with
a correctness consequence.

## Why it produces a real bug

The natural client design — the one every HTTP-shaped SDK teaches — is
"hold a credential, attach it to every request". Both LLP 0094 §0B and
LLP 0096 §1.3 reinforce it: offers are described as "stateless discovery
plus **per-boundary repetition**", i.e. everything is re-presented on every
request. Nothing anywhere says that one boundary is different and *binds*.

So a client that swaps the bearer on sign-out/sign-in — updating the header
it attaches everywhere, exactly as the documents describe — **keeps
delivering the previous user's live rows**, silently, until something
happens to re-open the connection. There is no refusal, no diagnostic, and
no wire signal that the live lane is answering a different identity than the
one in the `Authorization` header the client believes is in force.

The rule that would prevent it — *a change of session identity requires a
fresh `POST /connection/open`* — is stated in no document I could find. It
is derivable from `RetainedLiveAuthority::matches` and the `ConnectionAuth`
route policy, but only by someone who already suspects the problem.

## Fix wanted

1. **LLP 0094 §0A.6 gains its sessions-mode counterpart.** §0A.6 exists to
   state "precisely what a dev-mode server accepts without an auth
   handshake"; there is no matching section for the mode that actually
   ships to production. It should say: on `ConnectionAuth` routes the
   connection grant is the credential and `Authorization` is not consulted;
   the bearer is resolved once, at open.
2. **State the identity-change rule where a client author will hit it** —
   LLP 0096 §2.7's gate-timing table is the natural home, since that table
   is already the "what goes where, when" reference and currently implies
   uniform per-request repetition. One row, or one sentence beneath it:
   **a session identity change requires a fresh connection grant; re-using
   a grant across a user switch serves the old identity.**
3. Consider whether presenting a *different* resolved bearer on a
   connection-scoped route should refuse rather than be ignored. Ignoring
   is defensible (offers are not credentials, and the grant is the
   authority), but a refusal would convert this entire class from silent to
   loud. If ignoring stays, §0A.1's `ConnectionAuth` rows should say so
   explicitly.

## Resolution taken in the Dart client

`SessionsAuth` still attaches the bearer everywhere (harmless), but the
per-subscription retained identity is keyed on the grant, and the README
documents that changing `auth` requires constructing a new client. The
client does **not** currently detect a bearer/grant identity mismatch —
nothing on the wire lets it.

## Resolution

LLP 0094 now states explicitly that route-level bearer values are inert after
connection authority is established. A principal switch requires a fresh
connection and grant; silent credential reinterpretation is forbidden.
