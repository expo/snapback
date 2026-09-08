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
    pub(super) fn after_commit(&mut self, seq: u64) -> Result<(), Refusal> {
        self.operator_rejection = None;
        self.sweep_expired_sessions()?;
        self.sweep_offline_now()?;
        let commit = self
            .runtime()
            .store()
            .commits_since(seq.saturating_sub(1), 1)
            .map_err(|error| Refusal::from_runtime(&error))?
            .into_iter()
            .find(|commit| commit.seq == seq)
            .ok_or_else(|| {
                Refusal::owner(
                    "E_OWNER_COMMIT_MISSING",
                    format!("commit {seq} was not recorded"),
                    "inspect the store and restart the owner",
                )
            })?;
        let invalidated = self.runtime().invalidated(&commit);
        let deliveries = self.rerun_live(&invalidated, false);
        self.ledger.push_back(CommitLedger {
            seq,
            invalidated,
            deliveries,
        });
        while self.ledger.len() > 1_000 {
            self.ledger.pop_front();
        }
        self.readmit_channels(&commit);
        if commit.emits > 0 {
            self.wake_effects();
        }
        Ok(())
    }

    pub(super) fn rerun_live(&mut self, ids: &[u64], force: bool) -> Vec<LedgerDelivery> {
        let mut deliveries = Vec::new();
        let now = self.now();
        let mut clients = BTreeMap::new();
        #[cfg(test)]
        {
            self.last_live_dispatch_work = 0;
        }
        for id in ids {
            #[cfg(test)]
            {
                self.last_live_dispatch_work += 1;
            }
            if let Some(client) = self.live.get(id).cloned() {
                clients.insert(*id, client);
            }
        }
        for client in clients.values_mut() {
            client.context.now = Some(now);
            client.context.read_time = Some(now);
        }
        let requests = clients
            .iter()
            .map(|(id, client)| (*id, client.context.clone()))
            .collect::<Vec<_>>();
        for delivery in self.runtime_mut().rerun_with_contexts(&requests) {
            let id = delivery.id;
            let Some(mut client) = clients.remove(&id) else {
                continue;
            };
            match delivery.execution {
                Ok(execution) => {
                    let refused = client
                        .drain
                        .then(|| self.admit_drain(&client.op).err())
                        .flatten();
                    let (frame, terminal) = if let Some(refusal) = refused {
                        refusal_frame(refusal, execution.seq)
                    } else if client.offline {
                        writer_offline::envelope_frame(
                            self.runtime().generation(),
                            &client.op,
                            &client.context,
                            &execution,
                        )
                    } else {
                        writer_offline::connected_frame(
                            self.runtime().generation(),
                            &client.op,
                            &execution,
                        )
                    };
                    let changed = frame_digest(&frame) != frame_digest(&client.last_frame);
                    client.last_frame = frame.clone();
                    if force || changed || terminal {
                        let _ = client.events.send_latest(SseEvent {
                            seq: Some(execution.seq),
                            data: frame,
                            terminal,
                        });
                        deliveries.push(LedgerDelivery {
                            id,
                            seq: execution.seq,
                        });
                    }
                    if terminal {
                        self.live.remove(&id);
                        self.runtime_mut().unsubscribe(id);
                    } else {
                        self.live.insert(id, client);
                    }
                }
                Err(error) => {
                    let seq = self.runtime().store().commit_seq().unwrap_or_default();
                    let (frame, terminal) = live_frame(Err(Refusal::from_runtime(&error)), seq);
                    let _ = client.events.send_latest(SseEvent {
                        seq: Some(seq),
                        data: frame,
                        terminal,
                    });
                    deliveries.push(LedgerDelivery { id, seq });
                    self.live.remove(&id);
                    self.runtime_mut().unsubscribe(id);
                }
            }
        }
        deliveries
    }

    pub(super) fn why(
        &mut self,
        op: String,
        args: Json,
        identity: Identity,
        query_only: bool,
    ) -> Result<Json, Refusal> {
        if let Identity::Operator { by } = identity {
            return self.operator_why(op, args, by, query_only);
        }
        let authority = self.resolve_authority(identity)?;
        let kind = self
            .runtime()
            .generation()
            .programs()
            .get(&op)
            .map(|(program, _)| program.kind)
            .ok_or_else(|| {
                Refusal::new(
                    "E_OP_UNKNOWN",
                    "op",
                    format!("unknown operation {op}"),
                    "use an operation listed by /api/manifest",
                    "op/manifest",
                )
            })?;
        // The CLI is read-only even across a hot successor; the protected
        // harness still executes mutations to harvest authoritative replay traces.
        if query_only && kind != ProgramKind::Query {
            return Err(Refusal::new(
                "E_OP_KIND",
                "op",
                "why only executes queries; a mutation would change stored data",
                "use a query containing the same lookup, then run snapback2 why <query> --as <persona>; see snapback2 guide auth",
                "auth",
            ).with_site(op));
        }
        let context = if kind == ProgramKind::Mutation {
            self.mutation_context(&authority, &op, args)?
        } else {
            self.context(&authority, &op, args)?
        };
        let requested_args = context.args.clone();
        let requested_principal = context.viewer().to_owned();
        let execution = self
            .runtime_mut()
            .execute(&op, context)
            .map_err(|error| Refusal::from_runtime(&error))?;
        let plan_hash = self
            .runtime()
            .generation()
            .programs()
            .get(&op)
            .map(|(_, certificate)| certificate.plan_hash.clone())
            .ok_or_else(|| {
                Refusal::new(
                    "E_OP_UNKNOWN",
                    "op",
                    format!("unknown operation {op}"),
                    "use an operation listed by /api/manifest",
                    "op/unknown",
                )
            })?;
        let runtime_subscriptions = self
            .runtime()
            .subscriptions()
            .into_iter()
            .map(|subscription| (subscription.id, subscription))
            .collect::<BTreeMap<_, _>>();
        let subscriptions = self
            .live
            .iter()
            .filter(|(_, client)| {
                client.op == op
                    && client.context.args == requested_args
                    && client.context.viewer() == requested_principal
            })
            .filter_map(|(id, client)| {
                runtime_subscriptions.get(id).map(|subscription| {
                    json!({
                        "id": id,
                        "op": client.op,
                        "principal": subscription.principal,
                        "lastResultDigest": subscription.last_result_digest,
                        "lastSeq": subscription.last_seq,
                        // @ref LLP 1002#7-test-and-the-receipt — the served receipt consumes the exact retained trace.
                        "trace": subscription.trace,
                    })
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({
            "op": op,
            "certificatePlanHash": plan_hash,
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
        // @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — a refusal has no commit; retain its attempted trace until another commit supersedes it.
        if seq.is_none()
            && let Some(rejected) = &self.operator_rejection
            && rejected["seq"].as_u64() == Some(latest)
        {
            return Ok(rejected.clone());
        }
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
            "generation": self.runtime().generation().hash(),
            "seq": self.runtime().store().commit_seq().map_err(|error| Refusal::from_runtime(&error))?,
            "subscriptions": self.live.len(),
            "channelSubscriptions": self.channels.len(),
            "executions": self.runtime().executions(),
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
            "timers": self.runtime().store().timer_status(self.now()).map_err(|e| Refusal::from_runtime(&e))?,
            "schedules": self.runtime().store().schedule_receipt().map_err(|e| Refusal::from_runtime(&e))?,
            "jobs": self.runtime().store().job_counts().map_err(|e| Refusal::from_runtime(&e))?,
            "mode": self.mode,
        }))
    }

    pub(super) fn manifest(&self) -> Json {
        let tables = self
            .runtime()
            .generation()
            .schema()
            .tables
            .iter()
            .map(|(name, table)| {
                (
                    name.clone(),
                    json!({ "retain": table.retain, "columns": table.columns }),
                )
            })
            .collect::<Map<_, _>>();
        let ops = self
            .runtime()
            .generation()
            .programs()
            .iter()
            .filter(|(name, _)| !name.starts_with("__owner."))
            .map(|(name, (program, certificate))| {
                (
                    name.clone(),
                    json!({
                        "kind": match program.kind { ProgramKind::Query => "query", ProgramKind::Job => "job", ProgramKind::Mutation => "mutation" },
                        "args": program.args,
                        "drain": writer_resume::drain_metadata(program, certificate),
                        "planHash": certificate.plan_hash,
                    }),
                )
            })
            .collect::<Map<_, _>>();
        json!({
            "generation": self.runtime().generation().hash(),
            "programGeneration": self.runtime().generation().program_hash(),
            "tables": tables,
            "ops": ops,
            "channels": self.runtime().generation().schema().channels,
            "auth": self.runtime().generation().schema().auth,
        })
    }

    fn outbox_counts(&self) -> Result<OutboxCounts, Refusal> {
        self.runtime()
            .store()
            .outbox_counts()
            .map_err(|error| Refusal::from_runtime(&error))
    }
}
