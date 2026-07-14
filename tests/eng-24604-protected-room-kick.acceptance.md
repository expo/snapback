# ENG-24604 protected-room kick acceptance receipt

The integrated production trace is
`local::auth_room_kick_acceptance::card_game_kick_composes_durable_and_room_authority_boundaries`.
It installs a sessions-v1 `gameMembers` permission-backing table, a durable
`moves` board whose query re-reads membership, and protected `gamePresence`
rooms. A and B subscribe to the affected board and presence room; B also has a
second game. The trace deletes A's real membership row through the ordinary
storage mutation/interlock path.

| LLP 0053 kick clause | Executable evidence |
| --- | --- |
| dependency ticket, registration interlock, permit quiescence before commit | The integrated trace holds a destructively drained final-send permit, observes the pending ticket reject a racing registration, and proves the SQLite kick cannot complete until the permit drops. |
| selector targets the actual backing row; unrelated L9 work continues | The deleted `gameMembers` preimage identifies the affected `gameId`. A second protected room performs its durable lookup before the kick, then registers, publishes, and drains at generation 1 while the affected room is pending; it publishes again at generation 1 after commit, and only the affected room enters reauthorization. Scope-changing/unknown writes remain collection-wide and activation/destructive events remain all-room in production. |
| durable invalidation and `RoomAuthorityResync` bind the causing commit | The integrated trace compares both durable snapshot witnesses and the pending room obligation with the mutation's exact commit version and authorization expectation. |
| old-generation mutation/enqueue/drain/send cannot escape | The integrated trace rejects the old-authority publish while pending, drops queued generation-1 upserts at drain, and rejects A's already-drained frame containing B's private opponent presence at final send. |
| A denied/unregistered/entries removed; B receives a fresh snapshot | The integrated trace reauthorizes against the committed membership projection, observes A's trusted denial and B's `AuthRevoked` removal plus generation-2 snapshot, then proves later B fanout does not reach A. The durable `board` query returns B's opponent move to both players before the kick, returns no rows to A after the kick, and still returns the move to B. |
| dropped room signal re-fires | The integrated trace drains B's first `AuthChanged` signal without completing reauthorization and observes the same generation on the next poll. |
| process loss forces fresh authorization | `process_loss_before_room_ack_forces_fresh_membership_authorization` replaces the process-local room authority before completion; fresh A authorization is denied and fresh B registration succeeds from a new generation-1 snapshot. |
| preliminary lookup / registration / frame / enqueue / drain / send pauses | The integrated trace captures A's pre-kick durable grant, performs an unrelated lookup-before-write followed by registration while the ticket is pending, and holds a real affected-room post-drain frame. `ephemeral::tests::transport_drain_holds_commit_until_final_send_permit_drops` separately pins the drain-to-send pause; the production room permit spans mutation and enqueue atomically. |
| exact rollback and overlapping tickets | `ephemeral::tests::protected_registration_is_closed_by_the_exact_pending_ticket` proves one rollback cannot clear its sibling and only the last exact rollback reopens generation 1. |
| ambiguous commit | `ephemeral::tests::ambiguous_authorization_commit_leaves_every_protected_act_pending` proves uncertainty retains the exact ticket and closes protected acts. |
| stale queue drop and level-triggered re-fire | `ephemeral::tests::committed_authorization_event_drops_old_frames_and_refires_auth_changed`. |
| trusted denial/removal boundary | `ephemeral::tests::fresh_room_reauthorization_revokes_owner_and_emits_trusted_boundaries` plus the integrated durable-projection trace. |

There is intentionally no synthetic Condvar-poison or SQLite ambiguous-COMMIT
fault hook in production. Dependency-ticket/barrier preparation errors return
before `tx.commit()`; actual quiescence ordering and the explicit ambiguous
outcome are covered through the production interlock paths named above.
