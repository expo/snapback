# subscribe: durable live queries with pinned change semantics

**Status:** Shelved
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “subscribe: durable live queries with pinned change semantics” shows the issue materially affects a supported product or engineering path; it belongs in the current program but is not an immediate blocker, while the repair crosses several runtime, host, protocol, or policy seams, with specific cited code, progress, or acceptance criteria.
**Severity:** P2
**Systems:** Tooling, Realtime
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §2 (Review revision `14f54843…`), LLP 0055 (token renewal, rotation, per-grant cap)
**Marker:** app-cli, sub-stage-a

`subscribe <liveQuery> [--args-json '<json>' | -]` — same args
surface, schema validation, and no-network-on-invalid behavior as
`call` (parameterized live queries ship today). Modes: `--first-change`
(default) and `--watch` are mutually exclusive; `--timeout` combines
with either as a bound. Contract per LLP 0062 §2: snapshot always
prints first; "change" = RFC 8785 (JCS) canonical serialization
differs from the last printed snapshot; latest-wins coalescing;
bounded flag-overridable transport retry budget. Token lifecycle:
same-grant **renewal is a scheduled bounded cut/resync** (single-
carrier fence; JCS dedupe suppresses the resync duplicate — not
make-before-break, the fence can't overlap carriers); unplanned cap
eviction by a sibling is the same cut/resync with a distinct
diagnostic; credential-family **rotation is terminal for the watch**
(typed diagnostic naming rotation; a fresh invocation under the
successor recovers — no in-flight successor adoption in v1); renewal
impossible ends the watch with the server refusal preserved (exit 3).

The stage split is explicit: sub-stage (a) lands the dev-target command,
JCS change rule, retry/coalescing, and signal behavior. Scheduled token
renewal, cap-eviction recovery, and credential-rotation acceptance are
sub-stage-(b) integrations blocked on the agent/session custody work;
the public command contract does not change when they activate.

**Done when:**

- `--first-change`/`--timeout`/`--watch` goldens pass against a live
  memory server, including a parameterized live query with required
  args, reconnect-dedupe, and latest-wins under a slow consumer.
- Forced-expiry renewal is asserted as cut/resync via the content
  rule; rotation ends the watch with the typed diagnostic and a
  clean restart recovers.
- Sibling-invocation cap eviction self-heals via renewal; the
  above-cap admission gate and lease accounting cases live in the
  agent-onboarding ticket.
- Retry-budget exhaustion exits `SNAPBACK_APP_CLI_TRANSPORT_FAILED`;
  SIGINT/SIGTERM deaths are conventional 128+n, outside the
  taxonomy.

## Shelved (2026-08-01, author decision)

Temporarily shelved per Charlie's 2026-08-01 decision on the
triage-sweep recommendation: the app-cli program is paused (owning RFC
LLP 0062 parked at Review since 2026-07-17; LLP 0122 Q6 still open on
the CLI's shape). Reopening condition: LLP 0062 leaves Review or the
program is recommissioned. The design content here is not invalidated
by the shelving.
