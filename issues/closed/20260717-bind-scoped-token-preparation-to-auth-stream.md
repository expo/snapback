# Bind scoped-token preparation to its authorization stream

**Status:** Closed
**Severity:** P1
**Systems:** Agent auth, Authorization reset, Bootstrap handshake, Connection grants
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0059 §Finite service authority fence; LLP 0059 §Reset, restore, and stream publication
**Marker:** auth, scoped-token, reset, stream-fence, toctou, connection-open

Scoped-token `/auth/session` and `POST /connection/open` resolve durable token
state and register its finite-service witness before capturing anonymous
authorization-stream authority. A reset can therefore commit between those
steps, after which the request binds its predecessor token result to the
successor stream. The handshake can publish stale authority facts and
connection-open can mint a successor-stream grant from state deleted by reset.

The handshake's diagnostic admission compounds the race by bypassing an
installed stream fence at final publication. Diagnostic admission is required
to report mode-transition state, but it is not permission to cross a destructive
authorization-stream reset.

**Done when:**

- `/auth/session` captures the current anonymous stream publication before any
  durable scoped-token resolution or service-witness registration.
- Connection-open captures the current anonymous connection authority before
  the same durable work and never re-reads the successor stream afterward.
- Reset which wins before durable resolution makes the token lookup fail;
  reset which commits after resolution makes the retained predecessor
  publication/grant preparation stale.
- Diagnostic handshake admission still serves mode-pending state but honors
  every installed stream/session fence at final response publication.
- Deterministic real-route tests pause both surfaces after stream capture and
  after durable resolution, commit a coordinated reset, and prove no stale
  response or connection grant crosses into the successor stream.
- Focused handshake, connection, finite-service, LLP reference, and canonical
  proof checks pass.

## Resolution

Both scoped-token preparation paths now capture their predecessor stream
authority before entering Local/SQLite. They retain that exact capture through
the final handshake response or connection-grant insertion, and no later
coordinator read can substitute reset's successor. The handshake's diagnostic
admission continues to expose pending mode state but now honors any installed
stream/session publication fence.

A deterministic real-route matrix covers `/auth/session` and connection-open
at both pause points: immediately after stream capture and immediately after
durable token resolution/witness registration. Each case commits a coordinated
reset and proves the request returns `SNAPBACK_AUTH_SCOPED_TOKEN_INVALID`; the
connection cases additionally prove the proposed readable id has no grant.

Focused verification on 2026-07-17:

- `cargo test --lib scoped_token_handshake_and_connection_open_cannot_cross_stream_reset -- --nocapture` — passed.
- `cargo test --lib handshake_holds_one_root_through_body_including_stable_pending_epochs -- --nocapture` — passed.
- `cargo test --lib retired_handshake_body_emits_no_frame_after_transition_cut -- --nocapture` — passed.
- `cargo test --lib finite_service_authority_real_route_by_terminal_ending_pause_matrix -- --nocapture` — passed.
- `cargo test --lib auth_session -- --nocapture` — 3 passed.
- `cargo test --lib connection_open -- --nocapture` — 4 passed.
- `./ref-check --verbose` — 63 LLP documents, 1,345 references, 0 errors, 0 unchecked.

The full Rust library suite subsequently passed 1,102 tests, and the
`local_v0` integration suite passed 96 tests.
