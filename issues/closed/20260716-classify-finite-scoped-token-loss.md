# Classify finite scoped-token loss before changing durable custody

**Status:** Closed
**Severity:** P1
**Systems:** Agent auth, HTTP diagnostics, JavaScript client, Durable replay
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Grant-backed live and queued replay, LLP 0059 §Typed terminal auth error
**Marker:** security, durability

Finite `SNAPBACK_AUTH_SCOPED_TOKEN_INVALID` responses collapse ordinary token
expiry, cap eviction, and unknown carrier bytes together with durable grant,
credential-generation, and principal revocation. The client consequently cannot
know whether it should preserve or delete a durable agent queue.

Classification can also arrive after the local carrier has already closed. A
close-only live event may cut the carrier before a concurrent finite revocation
returns, and a restarted process may receive the classified refusal during its
strict handshake before it has any publishable capture. In both races the
stronger `durableDelete` result still has to tombstone only the exact configured
and observed durable tuple; capture-only terminal dedup must not suppress it.

**Done when:**

- Scoped-token resolution classifies the exact cause as `carrier` or
  `durableDelete` without reviving an invalid token.
- The closed classification reaches finite HTTP diagnostics and is parsed
  fail-closed by the client.
- Missing or malformed legacy classification terminates the carrier but cannot
  select destructive durable deletion.
- A classified `durableDelete` for the exact same predecessor escalates an
  earlier carrier-only terminal handle, remains publication-closed, settles a
  durable tombstone, and does not replay the completed local blank/clear cut.
- A fresh process may use only the exact in-memory credential offer that
  received the classified handshake refusal. It re-reads durable custody under
  ownership and tombstones only a matching configured tuple; copied offers or
  mismatched observed tuples cannot delete custody.
- If that exact tuple is already `clearing/active`, restart replays and settles
  its original transition (including the durable participant) before beginning
  a distinct active-to-deleted transition; it never publishes the recovered
  carrier between the two intents.
- Exhausted volatile carrier/barrier identities still perform one local cut
  and cannot veto the exact durable tombstone lane. Exhausted persisted
  epoch/revision identities remain fail-closed and leave the unrepresentable
  durable predecessor byte-for-byte intact.
- Escalation and restart deletion are idempotent and their public settlement
  resolves only after the exact tombstone and durable participants settle.
- Tests distinguish token expiry/unknown carrier from grant, credential, and
  principal revocation, including close-only-to-finite escalation and
  restart-before-capture classification races.

## Resolution

Closed 2026-07-16. Commits `dfd829e`, `cbadaf5`, and `d4fcfaf` propagate closed
`carrier` versus `durableDelete` causes and settle only the exact durable tuple;
restart, escalation, mismatch, and exhaustion regressions live in
`agent-authority-custody.mjs` and `client-errors.mjs`.
