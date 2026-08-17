# ENG-24604 protected-room kick acceptance receipt

The integrated production trace is
`local::auth_room_kick_acceptance::card_game_kick_composes_durable_and_room_authority_boundaries`.
It installs a sessions-v1 `gameMembers` permission-backing table, a durable
`moves` board whose query re-reads membership, and protected `gamePresence`
rooms. A and B subscribe to the affected board and presence room; B also has a
second game. The trace deletes A's real membership row through the ordinary
storage mutation/interlock path.

The slice-1 codegen-emitted `allow.members` artifact now rides
`ephemeral::tests::codegen_emitted_membership_projection_parses_and_activates_in_sessions`
and the
`local::auth_room_kick_acceptance::codegen_manifest_enforces_anonymous_nonmember_and_member_room_grants`
and
`local::auth_room_kick_acceptance::codegen_membership_removal_unregisters_the_room_subscriber`
grant/removal tests.

| LLP 0053 kick clause | Executable evidence |
| --- | --- |
| dependency ticket, registration interlock, permit quiescence before commit | The integrated trace holds both a destructively drained protected-presence permit and an auth-scoped durable-board permit, observes the pending ticket reject a racing registration, and proves the SQLite kick cannot complete until both final-send permits drop. |
| selector targets the actual backing row; unrelated L9 work continues | The deleted `gameMembers` preimage identifies the affected `gameId`. A second protected room performs its durable lookup before the kick, then registers, publishes, and drains at generation 1 while the affected room is pending; it publishes again at generation 1 after commit, and only the affected room enters reauthorization. Scope-changing/unknown writes remain collection-wide and activation/destructive events remain all-room in production. |
| durable invalidation and `RoomAuthorityResync` bind the causing commit | The integrated trace compares both durable snapshot witnesses and the pending room obligation with the mutation's exact commit version and authorization expectation. |
| old-generation mutation/enqueue/drain/send cannot escape | The integrated trace rejects the old-authority publish while pending, drops queued generation-1 upserts at drain, and rejects both A's already-drained opponent-presence frame and its already-drained private durable board snapshot at final send after the kick commits. B's successor board snapshot acquires a fresh final-send permit. |
| A denied/unregistered/entries removed; B receives a fresh snapshot | The integrated trace reauthorizes against the committed membership projection, observes A's trusted denial and B's `AuthRevoked` removal plus generation-2 snapshot, then proves later B fanout does not reach A. The durable `board` query returns B's opponent move to both players before the kick, returns no rows to A after the kick, and still returns the move to B. |
| dropped room signal re-fires | The integrated trace drains B's first `AuthChanged` signal without completing reauthorization and observes the same generation on the next poll. |
| process loss forces fresh authorization | `process_loss_before_room_ack_forces_fresh_membership_authorization` replaces the process-local room authority before completion; fresh A authorization is denied and fresh B registration succeeds from a new generation-1 snapshot. |
| preliminary lookup → room mutation and registration → initial snapshot | The integrated trace independently records the pending ticket rejecting an old-grant publish at room mutation and a racing affected-room registration. It also proves an unrelated pre-looked-up room can register, publish, and drain while the affected room is pending. |
| frame construction → first enqueue | `frame_construction_before_first_enqueue_is_commit_ordered` installs a one-shot hook on that backend after the shared room frame is constructed and immediately before its first outbox push. The deterministic schedule observes the pending commit blocked before enqueue, releases the hook, observes publish/enqueue complete while the caller-retained admitted permit still blocks commit, then drops the permit and proves both commit completion and post-commit refusal of the captured predecessor frame. It emits `SNAPBACK_AUTH_ACCEPTANCE_ROOM_FRAME_ENQUEUE_RECEIPT`. |
| enqueue → destructive drain | The integrated trace completes B's generation-1 opponent-presence publish before the kick, retains that frame in B's real outbox across commit, and proves the guarded post-commit drain discards it. This distinct schedule emits `SNAPBACK_AUTH_ACCEPTANCE_ROOM_ENQUEUE_DRAIN_RECEIPT`; it is not inferred from the frame-construction or final-send schedules. |
| destructive drain → final send | The integrated trace destructively drains both an affected protected-room frame and an auth-scoped durable-board frame, proves each permit independently holds the SQLite commit boundary, then proves each predecessor envelope is rejected at final send after commit. This distinct schedule emits `SNAPBACK_AUTH_ACCEPTANCE_ROOM_DRAIN_SEND_RECEIPT`. `transport_drain_holds_commit_until_final_send_permit_drops`, `replacement_generation_inherits_the_guarded_durable_publication`, and `server::tests::authorized_durable_http_body_holds_commit_through_final_poll` retain the narrower transport proofs. |
| exact rollback and overlapping tickets | `ephemeral::tests::protected_registration_is_closed_by_the_exact_pending_ticket` proves one rollback cannot clear its sibling and only the last exact rollback reopens generation 1. |
| ambiguous commit | `ephemeral::tests::ambiguous_authorization_commit_leaves_every_protected_act_pending` proves uncertainty retains the exact ticket and closes protected acts. |
| stale queue drop and level-triggered re-fire | `ephemeral::tests::committed_authorization_event_drops_old_frames_and_refires_auth_changed`. |
| trusted denial/removal boundary | `ephemeral::tests::fresh_room_reauthorization_revokes_owner_and_emits_trusted_boundaries` plus the integrated durable-projection trace. |

There is intentionally no synthetic Condvar-poison or SQLite ambiguous-COMMIT
fault hook in production. Dependency-ticket/barrier preparation errors return
before `tx.commit()`; actual quiescence ordering and the explicit ambiguous
outcome are covered through the production interlock paths named above.
