# Snapback 4: a retryable `E_CONFLICT` from a conditional write stays `pending`, retried with the same arguments

Status: Open
Date: 2026-10-08
Scope: the published SDK (`mutate`, the outbox) and the server's `E_CONFLICT` refusal on a conditional update; Exact2's first-party client mirrors the SDK (`snapback4/client/src/round.rs`, the outbox flush)

The server answers a conditional update that lost its race (an expected
revision that no longer holds) with `{ state: "failed", why: { code:
"E_CONFLICT", retryable: true }, current? }`. Both clients treat
`retryable: true` as "send this write again later": the SDK's `mutate`
returns `state: "pending"`, and Exact2's client keeps the write queued and
stops the round (`Stop::Retry`), so every write queued behind it waits too.
Sent again with the same arguments, the write conflicts again: it never
settles, and nothing tells the app to re-read.

App farm evidence (Exact2 + Snapback 4, GPT-6.1-sol and Muse builders;
`~/appfarm/synthesis/round-03.md` cluster 11): 34 GPT builds across the four
client arms, about 1–3 minutes each, every one of which added a terminal
`require` guard by hand; quoted: "concurrent conditional completion returned
server `state: failed`, `E_CONFLICT`, `retryable: true`, while npm `mutate`
returned `state: pending`" (workplace-ergonomics-audit-0651). Round 1 saw it
too ("Stale-revision `E_CONFLICT` held as pending in the SDK").

Question for the owner: is a conflict's `retryable` meant as "the app may
retry after re-reading" rather than "resend this write"? If so, the write
should end `failed` with the code (and `current`), as other refusals are
terminal, and the docs should say what `retryable` means per family. If a
resend can succeed (a transient conflict), say when, and bound the resends so
one write cannot block an outbox forever. Exact2's client follows whatever
the SDK does (QUEUE line there).
