# Server + config hardening (P3 cluster): non-constant-time token compares, enumeration, config durability, busy-poll

**Opened:** 2026-08-08 · **Severity:** P3 · **Area:** server / runtime / config

Low-severity hardening/consistency items, each a small deviation from a
discipline the rest of the repo enforces.

## Non-constant-time token comparisons where a constant-time helper exists

- `src/workerd_exec.rs:925, 1111` — `response.header(...) != Some(expected_token)`
  and `sent_token.as_deref() != Some(expected_token)`, plain `==` on capability
  tokens, while `server.rs:6544` has `constant_time_str_eq`. Loopback transport,
  local-attacker-only (documented private, @ref LLP 0048), so hygiene.
- `cloudflare/src/coordinator.js:2108, 4201` — admin token and connection bearer
  use early-exit `!==` while `rqs-host.mjs:667` has `constantTimeEqual`. Network
  jitter dwarfs JS string-compare timing, so very low exploitability.
*Fix:* route all through the existing constant-time helpers.

## Public `/ephemeral/collections/ensure` enumerates loaded collection names

`src/server.rs:8631-8638` (public route); `src/ephemeral.rs:5588-5610` (error
text). The mismatch error returns `extra`/`mismatched` lists of real loaded
collection names to an unauthenticated caller in sessions/prod mode. Low value
(names ship in the client bundle) but a free schema-enumeration oracle on a
public route. *Fix:* in sessions mode, collapse the error to counts, not names.

## Config secret store skips the parent-directory fsync

`src/config.rs:663-682` (`persist_state`) does `write_owner_only(tmp)` +
`rename` but no `sync_parent` afterward, while `secure_file::sync_parent` exists
and `instance_fork::replace_bytes_sync` uses it. `config set` reports success;
power loss before the dir entry is durable reverts to the prior generation
despite the reported new generation. *Fix:* `secure_file::sync_parent(path)`
after the rename.

## `import_env_blob` silently drops non-string array members

`src/config.rs:589-596` filters an array with `.filter_map(|m| m.as_str())`, so
`["good", 42, "also-good"]` imports two members and reports the name in
`imported` with no signal a member was dropped. A pool secret authored as a
number vanishes; rotation later serves fewer members. *Fix:* refuse the entry
(push to `ignored`) when any member is non-string/empty.

## Per-invocation busy-poll in the workerd executor

`src/workerd_exec.rs:786-850` (2 ms accept/try_recv spin), :634-676 (5 ms
readiness spin). Every V8 handler invocation burns ~500 wakeups/s on a blocking
thread for its duration. Correctness unaffected; the serving-thread shape is
deliberate, only the spin interval is unexamined. *Fix:* block on the listener
with an accept timeout or `poll(2)` over listener + done-pipe.

## Confidence

High on each mechanism; all P3 — none is exploitable/reachable in a way that
warrants urgency, but each is worth closing for consistency.

## Resolution (2026-08-08)
Fixed on main (Lane C). Verified: cargo build; targeted suites pass (throttle 4/4, instance-lock 11/11, fork 3/3, value_expr 10/10, config 23/23, embed 7/7, workerd 10/10, data-tier corpus 2/2 + 37-case parity); ref-check clean.
