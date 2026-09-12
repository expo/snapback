# Snapback 2 replay of a removed mutation never settles the intent

**Status:** Closed
**Priority:** P1
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2/src/writer_replay.rs`, `writer.rs` (`generation_rejection`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1020 A2; LLP 1012 §7 (exactly-once replay)

## Symptom

Replay settlement is exactly-once for a stored terminal and for `E_GENERATION_CHANGED` when `expectedGeneration` is present (`record_replay_rejection`). After that, `operation_kind(op, Mutation)` and `context()` can still fail: successor removed or retargeted the op (`E_OP_UNKNOWN` / `E_OP_KIND`), or current validation refuses the args (`E_INPUT`). Those paths return `Err(Refusal)` **without** recording a replay terminal.

LLP 1020 A2 wants true `E_INPUT` (removed enum case, changed argument type) not to spend the intent so the bytes can commit if the declaration returns. A **removed** mutation with no `expectedGeneration` then leaves the FIFO head retrying forever.

`generation_rejection` is skipped when the client omits the hash (`writer.rs`: `let Some(expected) = expected else { return Ok(None); }`). Control-plane `/control/execute` never sends `expectedGeneration`.

## Evidence

```183:197:snapback2/crates/snapback2/src/writer_replay.rs
        if let Some(mut response) = self.generation_rejection(wire.expected_generation.as_ref())? {
            response["intent"] = json!(wire.intent);
            ...
            self.runtime().store().record_replay_rejection(principal, &replay, &response)?;
            return Ok(response);
        }
        self.refuse_schedule_target(op)?;
        self.operation_kind(op, Some(ProgramKind::Mutation))?;
        ...
        // A replay judged by current validation ... never spends the intent
```

## Proposed patch

Treat “op missing or not a mutation under the live generation” as a durable replay rejection (same family as `E_GENERATION_CHANGED`). Keep true `E_INPUT` unspent.

```rust
        if let Some(mut response) = self.generation_rejection(wire.expected_generation.as_ref())? {
            ...
            return Ok(response);
        }
        self.refuse_schedule_target(op)?;
        if let Err(error) = self.operation_kind(op, Some(ProgramKind::Mutation)) {
            if matches!(error.code.as_str(), "E_OP_UNKNOWN" | "E_OP_KIND") {
                let mut response = refusal_json(&error);
                response["intent"] = json!(wire.intent);
                let replay = ReplayCommit { grant: wire.grant, offset: wire.offset, count: wire.count,
                    intent: wire.intent, request_digest, trace: ReplayTrace::default(), at: now };
                self.runtime().store().record_replay_rejection(principal, &replay, &response)
                    .map_err(|error| Refusal::from_runtime(&error))?;
                return Ok(response);
            }
            return Err(error);
        }
```

Use the existing `Refusal` shape already returned by `operation_kind` rather than inventing a new code. Confirm the code strings against `operation_kind` before landing.

Optional: require `expectedGeneration` on the mutation replay HTTP route so a successor always hits `generation_rejection`. Do not require it on control-plane execute unless the harness is updated in the same change.

## Acceptance

- Enqueue a mutation, apply a successor that removes the op, replay without `expectedGeneration`. The intent is recorded rejected (or generation-changed) and drain proceeds to the next queued intent. It does not retry forever.
- An `E_INPUT` from a temporarily-narrower argument type still does **not** spend the intent.
- A matching `expectedGeneration` still takes the existing `generation_rejection` path.

## Resolution (2026-09-11)

After authenticating and checking the grant and unused slice, removed/retargeted mutation admission now records the existing refusal as state=rejected with its intent and stable envelope digest. Current trace and argument E_INPUT failures stay unspent. Existing stored terminals still precede current lookup and authenticated ownership still precedes terminal retrieval. Expected-generation rejection remains unchanged. Batch acknowledgement eligibility retains its separate current-program whitelist preflight.

Validation: native owner successor witness passed (48.81 s). A newly removed operation and mutation retargeted to a query settle durably without expectedGeneration; identical retries return identical bytes immediately and after the original declaration returns. The next unused intent commits after restoring the declaration. Four argument/trace schema failures remain unspent and the previously failed slice commits when valid again. Existing terminal reuse, foreign principal and expired-session witnesses pass in the same test. LLP 1012 updated.
