# Research Room / SpacetimeDB evidence audit

The arm reports 13 passes, 2 explicit GAPs, and no failures. Every pass has a
direct receipt:

- target and actor identities are hashed; raw identity tokens are absent;
- private source tables are omitted from generated bindings;
- Mallory's five protected view counts are zero and a private-table
  subscription is rejected;
- file bytes, content hash, owner refusal, delivery, and post-delete eviction
  are retained;
- keyword results are materialized by a server reducer;
- four durable progress rows include database timestamps and precede the
  terminal answer update;
- Bob's four callbacks are explicitly attributed to the SpacetimeDB WebSocket
  subscription;
- cancellation retains before/after late-probe counts and effect state;
- retry and five terminal outcomes retain authoritative rows;
- the schedule receipt retains the run identity, effect status, response hash,
  and one progress commit;
- every performance path retains two warmups and seven raw samples;
- cleanup retains exact database identity, delete command, 404 probe, validated
  listener commands, closed ports, and absent paths.

The semantic scenario is a GAP because stored arrays are not an ordinary
vector index or nearest-neighbor query. The secret scenario is a GAP because
SpacetimeDB 2.7 has no native module secret injection surface. Neither gap has
an application substitute presented as a provider capability.

The first scheduled HTTP attempt's localhost refusal is a secure product
behavior. The second public endpoint's non-200 result was not upgraded to a
pass. The successful run used the stable public RFC 2606 text.

No Stop-class defect occurred: there was no cross-user disclosure, secret
leak, late durable patch, destructive cleanup outside the target, or false
pass.

Confidence (0–2): actor/authority 2, transaction/conflict 2, transport 2,
offline/reconnect 1, settlement 2, target identity 2, cleanup/isolation 2,
artifact reproducibility 2. Total: 15/16.
