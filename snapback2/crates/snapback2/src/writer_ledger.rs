// @ref LLP 1002#8-why-trace-guide — diagnostics report stored outbox and commit facts.

use super::*;
use crate::protocol::value_to_json;
use serde_json::Map;
use snapback2_core::OutboxCounts;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LedgerDelivery {
    pub(super) id: u64,
    pub(super) seq: u64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CommitLedger {
    pub(super) seq: u64,
    pub(super) invalidated: Vec<u64>,
    pub(super) deliveries: Vec<LedgerDelivery>,
}

impl State {
    pub(super) fn why(
        &mut self,
        op: String,
        args: Json,
        identity: Identity,
    ) -> Result<Json, Refusal> {
        let principal = self.principal(identity)?;
        let context = self.context(principal, &op, args)?;
        let requested_args = context.args.clone();
        let requested_principal = context.viewer().to_owned();
        let execution = self
            .runtime_mut()
            .execute(&op, context)
            .map_err(|error| Refusal::from_runtime(&error))?;
        let runtime_subscriptions = self.runtime().subscriptions();
        let subscriptions = self
            .live
            .iter()
            .filter(|(_, client)| {
                client.op == op
                    && client.context.args == requested_args
                    && client.context.viewer() == requested_principal
            })
            .filter_map(|(id, client)| {
                runtime_subscriptions
                    .iter()
                    .find(|subscription| subscription.id == client.runtime_id)
                    .map(|subscription| {
                        json!({
                            "id": id,
                            "op": client.op,
                            "principal": subscription.principal,
                            "lastResultDigest": subscription.last_result_digest,
                            "lastSeq": subscription.last_seq,
                        })
                    })
            })
            .collect::<Vec<_>>();
        Ok(json!({
            "op": op,
            "result": execution_json(&execution),
            "trace": execution.trace,
            "subscriptions": subscriptions,
        }))
    }

    pub(super) fn trace(&self, seq: Option<u64>) -> Result<Json, Refusal> {
        let latest = self
            .runtime()
            .store()
            .commit_seq()
            .map_err(|error| Refusal::from_runtime(&error))?;
        let wanted = seq.unwrap_or(latest);
        let commit = self
            .runtime()
            .store()
            .commits_since(wanted.saturating_sub(1), 1)
            .map_err(|error| Refusal::from_runtime(&error))?
            .into_iter()
            .find(|commit| commit.seq == wanted)
            .ok_or_else(|| {
                Refusal::new(
                    "E_INPUT_TRACE_UNKNOWN",
                    "input",
                    format!("commit {wanted} is not retained"),
                    "pass latest or a retained commit seq",
                    "input/trace",
                )
            })?;
        let outbox_rows = self
            .runtime()
            .store()
            .outbox_rows_for_seq(wanted)
            .map_err(|error| Refusal::from_runtime(&error))?
            .into_iter()
            .map(|row| {
                json!({
                    "id": row.id,
                    "seq": row.seq,
                    "effect": row.effect,
                    "payload": value_to_json(&row.payload),
                    "state": row.state,
                    "attempts": row.attempts,
                    "nextAt": row.next_at,
                    "lastError": row.last_error,
                    "result": row.result.clone(),
                    "createdAt": row.created_at,
                    "updatedAt": row.updated_at,
                })
            })
            .collect::<Vec<_>>();
        let ledger = self.ledger.iter().find(|entry| entry.seq == wanted);
        let mut output = json!({
            "commit": commit,
            "outbox": {
                "emits": commit.emits,
                "engine": writer_effects::effects_engine(),
                "rows": outbox_rows.clone(),
            },
            "outboxRows": outbox_rows,
        });
        let object = output.as_object_mut().expect("trace output is an object");
        if let Some(ledger) = ledger {
            object.insert("invalidated".to_owned(), json!(ledger.invalidated));
            object.insert("deliveries".to_owned(), json!(ledger.deliveries));
        } else {
            let reason = if wanted <= self.restarted_through_seq {
                format!("unavailable (owner restarted at {})", self.owner.started_at)
            } else {
                "unavailable (commit is outside the last 1000 owner-lifetime entries)".to_owned()
            };
            object.insert("ledger".to_owned(), Json::String(reason));
        }
        Ok(output)
    }

    pub(super) fn status(&self) -> Result<Json, Refusal> {
        let personas = self
            .runtime()
            .principals(Some("persona"))
            .map_err(|error| Refusal::from_identity(&error))?;
        let outbox = self.outbox_counts()?;
        Ok(json!({
            "project": self.root,
            "status": self.phase,
            "generation": self.runtime().generation().hash,
            "seq": self.runtime().store().commit_seq().map_err(|error| Refusal::from_runtime(&error))?,
            "subscriptions": self.live.len(),
            "channelSubscriptions": self.channels.len(),
            "effects": writer_effects::EffectsStatus {
                engine: writer_effects::effects_engine().to_owned(),
                queued: outbox.queued,
                running: outbox.running,
                then_pending: outbox.then_pending,
                sent: outbox.sent,
                failed: outbox.failed,
                sent_unknown: outbox.sent_unknown,
            },
            "personas": personas,
            "mode": self.mode,
        }))
    }

    pub(super) fn manifest(&self) -> Json {
        let ops = self
            .runtime()
            .generation()
            .programs
            .iter()
            .filter(|(name, _)| !name.starts_with("__owner."))
            .map(|(name, (program, _))| {
                (
                    name.clone(),
                    json!({
                        "kind": match program.kind { ProgramKind::Query => "query", ProgramKind::Mutation => "mutation" },
                        "args": program.args,
                    }),
                )
            })
            .collect::<Map<_, _>>();
        json!({
            "generation": self.runtime().generation().hash,
            "ops": ops,
            "channels": self.runtime().generation().schema.channels,
            "auth": self.runtime().generation().schema.auth,
        })
    }

    fn outbox_counts(&self) -> Result<OutboxCounts, Refusal> {
        self.runtime()
            .store()
            .outbox_counts()
            .map_err(|error| Refusal::from_runtime(&error))
    }
}
