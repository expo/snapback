# anonymous-public custody sent legacy `auth` body fields; sessions servers refused every public query

**Date:** 2026-08-05 · **Found by:** LLP 0183 Stage 0.5 control, Lane 3 live
parity harness · **Resolved:** 2026-08-06

## Symptom

Every function query issued through
`new SnapbackClient(url, {custody: 'anonymous-public', adminToken: null})`
against a sessions-auth server failed with
`SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED: client-provided identity fields are not
accepted when session authority is server-resolved`. Sessioned clients on the
same server succeeded. Reproduced by six of sixteen Lane 3 checks (all and
only the anonymous ones).

## Cause

`packages/snapback-client/index.mjs`: the request path applies
`sessionWireBody` (which strips the legacy `auth` body field) only when
`sessionsMode` is true, and `sessionsMode` derives from the auth handshake.
Anonymous-public custody deliberately performs no handshake — per LLP 0137
A4-f6 the protocol-offer header alone is the anonymous contract — so its
requests kept the legacy `auth`-bearing body, which the sessions server
correctly refuses.

## Resolution

The wire body now goes through `sessionWireBody` when `sessionsMode` is true
**or** custody is `anonymous-public` (which always implies
`authClientProtocol = 1`; the constructor enforces this). Legacy null-custody
clients are unchanged. Regression assertion added to the existing
anonymous-public block in `packages/snapback-client/app-data.test.mjs`
(query bodies carry no legacy `auth` field). Verified by the Lane 3 live
harness going from 10/16 to 16/16 PASS on a fresh sessions server.
