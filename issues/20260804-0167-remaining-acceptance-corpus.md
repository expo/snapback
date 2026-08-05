# LLP 0167: remaining acceptance corpus and later stages

**Opened:** 2026-08-04
**Systems:** Server, Cloudflare arm, Agent experience, Acceptance testing
**Related:** LLP 0167, LLP 0024, LLP 0042, LLP 0017, LLP 0138

The Rust core of LLP 0167 landed (profile model, activation gate, env +
admin-API surfaces, two-phase deadline release on all three lanes,
HTTP marker, telemetry snapshot). Honest residue, in rough order:

1. **Socket-level ack+delta timing acceptance test** — commit-group
   plumbing is covered by carrier/queue unit tests, but there is no
   end-to-end socket test asserting the shared commit-relative deadline
   envelope (ack floor, delta floor, scheduler-noise skew bound).
   **Resolved 2026-08-04:** `tests/network_profile_v1.rs` runs the same
   timestamp-free fixture under `normal` and a 120 ms equal-lane profile,
   awaits the actor ack plus actor/observer socket frames, and checks both
   floors, the 80 ms skew bound, commit/settlement facts, and HTTP markers.
2. **HTTP lanes have no per-connection monotone deadline clamp** — the
   clamp is complete for live durable queues; queries/mutations on one
   keep-alive connection could observe reordered-by-delay responses only
   if a client pipelines, which HTTP/1.1 clients here do not. Decide:
   clamp per connection or document per-request semantics.
   **Resolved 2026-08-04:** HTTP query/mutation lanes are per-request.
   Snapback's supported HTTP/1.1 clients have one in-flight request per
   connection and pipelining is not supported; LLP 0167's Observation
   semantics and the HTTP release site now record that ruling.
3. **Middleware-origin refusals are neither delayed nor marked** —
   responses produced before the query/mutation handler (auth gate,
   body-shape refusals) bypass the egress seam. RFC intent is
   result-readiness stamping for commitless responses; either extend the
   seam into the refusal tower or record the boundary explicitly.
   **Resolved 2026-08-04:** the registered function-route tower admits
   unhandled query/mutation/action refusals at result readiness, while the
   existing response observation plus a private handler-origin marker prevent
   double release. Acceptance covers body-shape and auth-gate refusals,
   `normal`, action refusal, and a single-delay handler response.
4. **Per-delay Tokio timer per delayed enqueue** — fine at demo scale;
   coalesce into a single deadline scheduler if profile use under load
   matters.
   **Resolved 2026-08-05:** `DeliveryNotifier` now owns one deadline scheduler
   per local server, grouping connection ids by exact release instant and
   re-arming only when the earliest deadline changes. The owning
   `delayed_burst_uses_one_scheduler_timer_and_releases_fifo` unit test proves
   a 16-frame burst uses one scheduler task/one Tokio timer, releases at the
   profiled floor in FIFO order, and leaves `normal` timer-free.
4a. **Non-staged commit fanouts fall back to per-frame stamping** — the
   commit egress group (shared commit-relative deadline, once-per-commit
   jitter) is captured only in `finish_mutation_commit`. Job-completion
   publication, generic `notify_live_subscriptions` fanouts, and
   auth-mode seed frames stamp per frame from enqueue and re-sample
   jitter per frame. FIFO stays safe (monotone clamp) and built-in
   profiles have zero jitter, but a nonzero-jitter profile splits one
   commit's deadlines across subscriptions on those paths. Route them
   through `admit_commit` + the shared carrier.
   **Resolved 2026-08-04:** generic committed fanout, job completion, and
   same-mode auth activation/seed publication now scope one `admit_commit`
   live carrier around all frames and clear it before returning. A four-
   subscriber job-completion unit witness asserts one exact shared deadline.
4b. **Env-startup leg has no test** — the `SNAPBACK_NETWORK_PROFILE`
   startup activation (refusal fails boot; non-normal announces in
   startup output; env profile re-activates after restart) is exercised
   only indirectly; the in-process restart unit test is near-tautological.
   Add a spawn-the-binary test for refusal, announcement, and
   runtime-set-clears-on-restart.
   **Resolved 2026-08-04:** `tests/network_profile_v1.rs` launches the Cargo-
   supplied `snapback` binary on an ephemeral port with a ready file, asserts
   env provenance and startup announcement, proves an over-ceiling env value
   exits nonzero with the stable code, runtime-selects `demo-slow`, and then
   restarts the same database under `optimistic` to prove env reactivation.
5. **Later stages (unstarted):** Cloudflare coordinator arm (two-phase
   release outside `runExclusive`, deployment classification, ENG-23576
   delivery anchoring via `waitUntil`/DO alarms, per-arm "restart"
   semantics for hibernation), Latency Kanban client-sleep deletion +
   manifest schema versioning (LLP 0138), `host.networkProfile{Get,Set}`
   host-ops + MCP tools (LLP 0024/0042, OQ2 namespace ruling needed),
   admin-console Developer panel (LLP 0017 amendment), fold-or-document
   the two `SNAPBACK_TEST_*_DELAY_MS` coordinator seams (OQ4).
   **Bakeoff clause resolved 2026-08-04:**
   `demos/zero-bakeoff/protocol/environment.v2.json` owns the built profile
   vocabulary, bounded actor-ack/observer-delta windows, and the Zero
   `pre-commit` versus Snapback `post-commit` declarations. The cited
   `protocol/acceptance/latency-kanban.v2.json` is consumed by both runners;
   the Snapback runner in
   `apps/latency-kanban/snapback/tests/acceptance.mjs` has no client sleep,
   launches the local debug binary under `SNAPBACK_NETWORK_PROFILE`, asserts
   both response-marker forms and both timing windows, and compares its
   timestamp-free open-loop commit facts with `normal`. The Zero injection
   remains in `apps/latency-kanban/zero/api.ts` before commit and its runner
   consumes the same v2 envelope.

The capability row `operating.network-profiles` is `partial` with a GAP
naming this ticket's scope; flip it when the corpus above closes.

## Residue after the 2026-08-04 residue program (integration review findings)

Landed that day: Cloudflare arm (two-phase release, classification,
OQ4 fold), socket wire marker (both arms; CF kit `network_profile` /
proof `networkProfile` members), `debug.networkProfile{Get,Set}`
host-ops + MCP projection (proposed OQ2 ruling), console Developer
panel + banner, Latency Kanban server-side swap with environment.v2.
Still open, from the integrated-diff adversarial review:

1. **HTTP poll-lane frames are delayed but unmarked** — `drain_outbox`
   poll batches honor `is_network_ready` but carry no marker
   (`DurableMessage.network_egress` is serde-skipped). Mark at the
   drain handoff like the socket path.
   **Resolved 2026-08-05:** the poll drain handoff installs LLP 0093's
   per-frame `network_profile` member from the selected frame's immutable
   admission snapshot, using the same helper as the socket lane. The owning
   `poll_lane_marker_uses_frame_admission_snapshot_and_normal_preserves_bytes`
   test changes the active profile before drain, proves the admitted name is
   retained, and proves a normal frame's payload bytes are unchanged.
2. **Provenance fidelity** — console PUTs record as `api`, MCP as
   `host-ops`; `principal` is never threaded even where host-ops has an
   authenticated operator context. Add Console/Mcp source hints and
   thread the principal.
   **Resolved 2026-08-05:** the admin client and MCP projection send explicit
   `console`/`mcp` source hints, the activation provenance has distinct enum
   values, and host-ops accepts an operator principal only after the existing
   process-bound impersonation capability authorizes it. Server/admin-client
   and MCP owning tests assert both source distinctions, the authenticated MCP
   principal, and the intentionally absent browser-bypass principal.
3. **CF action-route refusal parity — Resolved 2026-08-05.** The CF
   `/action/:name` route now admits body-parse and staged pre-handler refusals
   through `withProfiledJsonObject` on the query-response lane, while an
   internal handler-origin discriminator preserves the existing unprofiled
   successful-action response boundary. The closed kit `ErrorResponse` emitter
   remains unchanged. `cloudflare/test/acceptance.network-profile.mjs` pins a
   120 ms custom non-normal refusal floor plus marker and the fast, unmarked
   `normal` identity; `cloudflare/test/acceptance.wire-shapes.mjs` remains the
   emitter-governance gate. Implementation:
   `cloudflare/src/coordinator.js` (`/action/:name`, `executeAction`).
4. **MCP tool schema drift guards** — the inline builtin enum and
   per-field maxima in the MCP tool schema will drift if built-ins
   change; the server remains authoritative, but add a pin test.
   **Resolved 2026-08-05:** the MCP schema reads its built-in enum and all
   delay maxima from `packages/snapback-cli/network-profile-authority.json`;
   the owning Rust test
   `mcp_authority_projection_matches_rust_builtins_and_ceiling` checks that
   projection against the executable `NetworkConditionProfile::builtins()`
   collection and `NETWORK_PROFILE_DELAY_CEILING_MS`, while the MCP test
   checks the exposed tool schema.
5. Timer coalescing (item 4 above) remains open as before.
   **Resolved 2026-08-05:** see item 4 and its bounded-timer owning test above.
6. **OQ3 implementation (ruled 2026-08-04):** hosted non-`normal`
   profiles are allowed only on LLP 0158 forks/derived instances, and
   the Cloudflare arm gets a dedicated deployment-classification binding
   tied to derived identity instead of `SNAPBACK_TESTING`. Build the
   fork-exception gate leg (Rust: derived-instance identity admits the
   activation gate) and the CF binding, with the refusal matrix extended
   for both. Until built, the fail-closed interim rule stands.
   **Resolved 2026-08-05:** `AppState` now captures the exact LLP 0158 fork
   lineage already validated by `LocalDatabase::open` and threads its presence
   into `NetworkProfileAuthority`; only that fact flips an otherwise-identical
   non-`Prod` hosted tuple from refuse to allow. The Cloudflare coordinator
   reads the dedicated canonical-fork-id binding
   `SNAPBACK_DERIVED_INSTANCE_ID`, independent of `SNAPBACK_TESTING`, so a
   hosted derived deployment can select `demo-slow` without exposing test-only
   routes/functions. `src/network_profile.rs` exercises every selector across
   local, explicit/defaulted `Prod`, primary hosted, hosted derived, missing,
   and contradictory Rust facts; `cloudflare/test/acceptance.network-profile.mjs`
   exercises the corresponding startup/runtime test, hosted-primary,
   hosted-derived, missing, malformed, and contradictory deployment matrix.
