//! Replay-envelope parsing, grant checks, and pinned-id execution.
// @ref LLP 1012#7-writes-offline — only a current principal-bound grant may
// inject ids, and the terminal response is deduplicated by intent.

use super::writer_auth::ResolvedAuthority;
use super::*;
use serde::{Deserialize, Serialize};
use snapback2_core::{
    REPLAY_GRANT_LIFETIME_MS, REPLAY_GRANT_LOW_WATERMARK, ReplayCommit, ReplayGrant, ReplayTrace,
    ReplayTracePoint, ReplayTraceVerdict, replay_mutation_response,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplayEnvelope {
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "present_generation")]
    expected_generation: Option<Json>,
    grant: String,
    offset: u32,
    count: u32,
    intent: String,
    trace: ReplayTraceWire,
}

fn present_generation<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Json>, D::Error> {
    Json::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplayTraceWire {
    points: Vec<ReplayPointWire>,
    verdicts: Vec<ReplayVerdictWire>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplayPointWire {
    table: String,
    index: String,
    key: Vec<Json>,
    digest: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplayVerdictWire {
    rule_hash: String,
    inputs_digest: String,
    result: bool,
}

impl State {
    pub(super) fn mint_replay_grant(&mut self, principal: &str) -> Result<ReplayGrant, Refusal> {
        let now = self.now();
        self.runtime_mut()
            .mint_replay_grant(principal, now)
            .map_err(|error| Refusal::from_runtime(&error))
    }

    /// Mint a grant only when the client's unused pinned ids are low.
    /// `remaining` is the client's own count; absent or `null` means it
    /// holds none. Above the watermark, only a certified selected mutation's
    /// larger allocation demand can request a replacement.
    // @ref LLP 1012#7-writes-offline — a grant is returned when the client's
    // remaining ids are low, never on every reconnect.
    pub(super) fn grant_if_low(
        &mut self,
        principal: &str,
        remaining: Option<&Json>,
        demand: u64,
    ) -> Result<Option<ReplayGrant>, Refusal> {
        let remaining = match remaining {
            None | Some(Json::Null) => None,
            Some(value) => Some(value.as_u64().ok_or_else(|| {
                Refusal::input(
                    "remaining must be a non-negative integer",
                    "send remaining as the count of unused pinned ids, or omit it",
                )
            })?),
        };
        if remaining.is_none_or(|count| count < REPLAY_GRANT_LOW_WATERMARK || count < demand) {
            Ok(Some(self.mint_replay_grant(principal)?))
        } else {
            Ok(None)
        }
    }

    /// Replay one outbox intent under an already-resolved authority.
    ///
    /// The contract is principal binding plus a live session, and the two
    /// halves are checked in different places on purpose. The session is the
    /// mutation route's business: `resolve_authority` runs before this
    /// function and a bearer whose session was logged out, expired, or fenced
    /// is refused `E_AUTH_SESSION` there — before the ledger, the grant, or
    /// the slice is consulted, so a dead session cannot even fetch a stored
    /// terminal. The grant is bound to the *principal* (spec §7) and is not
    /// consulted for a session or an auth epoch: it outlives the session that
    /// minted it by design, so a fresh login of the same principal finishes
    /// the outbox its previous session queued, and a stored terminal is keyed
    /// by `(principal, intent)` for the same reason. Nothing here trusts a
    /// grant or a ledger row on its own; every call arrives through a live
    /// session of the principal the grant names.
    // @ref LLP 1012#7-writes-offline — a grant is bound to the principal, not
    // the session, so a fresh session for the same principal finishes its outbox.
    pub(super) fn execute_replayed_mutation(
        &mut self,
        op: &str,
        args: Json,
        authority: &ResolvedAuthority,
        replay_json: Json,
        acknowledgement_only: bool,
    ) -> Result<Json, Refusal> {
        let wire: ReplayEnvelope = serde_json::from_value(replay_json).map_err(|error| {
            Refusal::input(
                format!("invalid replay envelope: {error}"),
                "send replay { grant, offset, count, intent, trace: { points, verdicts } }",
            )
        })?;
        let request_digest = snapback2_core::digest(&(op, &args, &wire));
        let now = self.now();
        let principal = authority.principal.id.as_str();
        // @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — a retry after a 503 returns the stored
        // terminal without executing, so a commit never looks like a rejection.
        // The stable wire digest uses no current program/schema information.
        // Consult the ledger before program, trace, or grant validation: an
        // identical retry stays exactly-once across successors and spent grants.
        if let Some(stored) = self
            .runtime()
            .store()
            .stored_client_intent(principal, &wire.intent)
            .map_err(|error| Refusal::from_runtime(&error))?
        {
            if stored.request_digest == request_digest {
                return Ok(stored.response);
            }
            return Err(Refusal::offline(
                "E_OFFLINE_INTENT_REUSE",
                "the replay intent was already settled for different request bytes",
            ));
        }
        // @ref LLP 1018.008.007.002#5-batch-acknowledgement-admission-and-replay —
        // a terminal retry precedes current generated-IR eligibility, including
        // after a successor removed its receipt operation.
        if acknowledgement_only {
            self.operation_kind(op, Some(ProgramKind::Mutation))?;
            let generation = self.runtime().generation();
            let program = &generation.programs()[op].0;
            if snapback2_core::delivery::acknowledgement(generation.schema(), program).is_none() {
                return Err(Refusal::input(
                    "replay batches contain only generated acknowledgement operations",
                    "send ordinary product mutations individually in FIFO order",
                ));
            }
        }
        let stored_grant = self
            .runtime()
            .store()
            .replay_grant(&wire.grant)
            .map_err(|error| Refusal::from_runtime(&error))?;
        // @ref LLP 1012#5-retention-revocation-and-the-fence — the server's
        // fence is thirty days by its own clock; no client clock is consulted.
        let Some((grant_principal, grant)) = stored_grant else {
            return Err(Refusal::offline(
                "E_OFFLINE_INTENT_EXPIRED",
                "the replay grant is unknown or has expired",
            ));
        };
        if grant_principal != principal
            || now >= grant.expires_at
            || now.saturating_sub(grant.minted_at) >= REPLAY_GRANT_LIFETIME_MS
        {
            return Err(Refusal::offline(
                "E_OFFLINE_INTENT_EXPIRED",
                "the replay grant does not belong to this principal or is older than 30 days",
            ));
        }
        let expected_intent = format!("{}:{}", wire.grant, wire.offset);
        let ids = snapback2_core::Store::replay_slice_ids(&grant, wire.offset, wire.count)
            .filter(|_| wire.intent == expected_intent)
            .ok_or_else(|| {
                Refusal::offline(
                    "E_OFFLINE_ID_BLOCK",
                    "the replay id slice is empty, outside its grant, or names the wrong intent",
                )
            })?;
        if !self
            .runtime()
            .store()
            .replay_slice_is_unused(&wire.grant, &wire.intent, wire.offset, wire.count)
            .map_err(|error| Refusal::from_runtime(&error))?
        {
            return Err(Refusal::offline(
                "E_OFFLINE_ID_BLOCK",
                "the replay id slice overlaps an already settled intent",
            ));
        }
        if let Some(mut response) = self.generation_rejection(wire.expected_generation.as_ref())? {
            response["intent"] = json!(wire.intent);
            let replay = ReplayCommit { grant: wire.grant, offset: wire.offset, count: wire.count,
                intent: wire.intent, request_digest, trace: ReplayTrace::default(), at: now };
            self.runtime().store().record_replay_rejection(principal, &replay, &response)
                .map_err(|error| Refusal::from_runtime(&error))?;
            return Ok(response);
        }
        self.refuse_schedule_target(op)?;
        self.operation_kind(op, Some(ProgramKind::Mutation))?;
        let trace = self.decode_replay_trace(&wire.trace)?;
        // A replay judged by current validation (a removed enum case, a changed
        // argument type) is refused like any request and never spends the intent:
        // its bytes stay queued and commit once the declaration accepts them again.
        let mut context = self.context(authority, op, args)?;
        // The grant's reserved ids replace the ordinary 1,024-id reservation.
        context.new_ids = ids;
        let replay = ReplayCommit {
            grant: wire.grant,
            offset: wire.offset,
            count: wire.count,
            intent: wire.intent.clone(),
            request_digest,
            trace,
            at: now,
        };
        let execution = self
            .runtime_mut()
            .execute_replay(op, context, &replay)
            .map_err(|error| Refusal::from_runtime(&error))?;
        if matches!(execution.state, ExecutionState::Committed { .. }) {
            self.after_commit(execution.seq)?;
        }
        let (_, certificate) = &self.runtime().generation().programs()[op];
        Ok(replay_mutation_response(
            &execution,
            &wire.intent,
            Some((&certificate.plan_hash, &certificate.schema_hash)),
        ))
    }

    fn decode_replay_trace(&self, trace: &ReplayTraceWire) -> Result<ReplayTrace, Refusal> {
        let schema = self.runtime().generation().schema();
        let points = trace
            .points
            .iter()
            .map(|point| {
                if let Some(value) = &point.digest {
                    require_digest(value, "point digest")?;
                }
                let table = schema.table(&point.table).ok_or_else(|| {
                    Refusal::input(
                        format!("replay trace names unknown table {}", point.table),
                        "send trace points emitted by the certified client twin",
                    )
                })?;
                let index = table.index(&point.index).ok_or_else(|| {
                    Refusal::input(
                        format!(
                            "replay trace names unknown index {}.{}",
                            point.table, point.index
                        ),
                        "send trace points emitted by the certified client twin",
                    )
                })?;
                if point.key.len() != index.components.len() {
                    return Err(Refusal::input(
                        format!(
                            "replay point {}.{} key has {} values, expected {}",
                            point.table,
                            point.index,
                            point.key.len(),
                            index.components.len()
                        ),
                        "send the complete point key emitted by the certified client twin",
                    ));
                }
                let columns = index.scalar_columns().ok_or_else(|| {
                    Refusal::input(
                        "replay point must address an ordinary index",
                        "send certified ordinary point keys",
                    )
                })?;
                let key = point
                    .key
                    .iter()
                    .zip(&columns)
                    .map(|(value, column)| {
                        let kind = table.columns.get(column).expect("certified index column");
                        writer_values::json_as_kind(value, kind)
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(ReplayTracePoint {
                    table: point.table.clone(),
                    index: point.index.clone(),
                    key,
                    digest: point.digest.clone(),
                })
            })
            .collect::<Result<Vec<_>, Refusal>>()?;
        let verdicts = trace
            .verdicts
            .iter()
            .map(|verdict| {
                require_digest(&verdict.rule_hash, "verdict ruleHash")?;
                require_digest(&verdict.inputs_digest, "verdict inputsDigest")?;
                Ok(ReplayTraceVerdict {
                    rule_hash: verdict.rule_hash.clone(),
                    inputs_digest: verdict.inputs_digest.clone(),
                    result: verdict.result,
                })
            })
            .collect::<Result<Vec<_>, Refusal>>()?;
        Ok(ReplayTrace { points, verdicts })
    }
}

fn require_digest(value: &str, label: &str) -> Result<(), Refusal> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(Refusal::input(
            format!("replay {label} must be a lowercase SHA-256 digest"),
            "send the trace emitted by the certified client twin",
        ))
    }
}
