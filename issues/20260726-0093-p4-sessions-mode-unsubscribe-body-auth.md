# 0093 P-4 spec defect: T-UNSUB's "re-present the establishing owner" is a dev-mode-only recipe that hard-fails in sessions mode

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Kotlin client build, `clients/kotlin`).
**Systems:** Auth, Live Queries, Wire Protocol, Client SDK

## The defect

LLP 0095 §1.4 T-UNSUB (added 2026-07-25 from the P-2 Swift ledger) says:

> **Release must present the subscription's establishing live owner**: the
> resolved authority identity the subscribe carried (dev mode: the `auth`
> object of the subscribe input, e.g. `auth.user_id`) on the same connection
> grant. … a conformant client **retains the establishing auth identity per
> subscription** — discarding it makes demand unreleasable.

The parenthetical is the *only* concrete instruction, and it is dev mode's.
The text never says what sessions mode does, while the surrounding prose
("retains the establishing auth identity per subscription", "a mismatch —
including an absent `auth` on an authed subscription — refuses 403") reads as
mode-independent and actively pushes an implementer toward sending it.

A client that retains the identity and re-presents it in the unsubscribe body,
exactly as instructed, gets:

```
HTTP 400
{"diagnostic":{"code":"SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED","severity":"error",
  "subsystem":"auth",
  "message":"client-provided identity fields are not accepted when session authority is server-resolved",
  "details":{"field":"auth"}}}
```

The correct sessions-mode behavior — identity is re-presented by the session
bearer, and the body `auth` member must be **omitted** — is derivable only by
composing T-UNSUB with LLP 0094 §0A.6's separate statement that sessions mode
rejects body-carried auth members. Neither document cross-references the other
on this point, and the two instructions read as contradictory when both apply
to the same request.

## Cost

~10 minutes. Cheap, but only because the refusal names the offending field.

## Fix wanted

T-UNSUB (and the identical sentence in T-RECONNECT) states the carrier per
mode in one table:

| Mode | Where the establishing owner is re-presented |
| --- | --- |
| dev | the request body `auth` member (`auth.user_id`) |
| sessions | the session bearer; a body `auth` member is **refused** (`SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`) |

and the "retains the establishing auth identity per subscription" obligation
is scoped to the modes where the client actually carries it.

## Related

- `issues/20260726-0093-p4-live-auth-placement-asymmetry.md` (Dart P-4) —
  the *placement* half of the same sentence: subscribe nests `auth` under
  `input`, unsubscribe carries it at top level.
