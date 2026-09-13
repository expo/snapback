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
        self.after_commit_record(commit)
    }

    // @ref LLP 1001#native-owner-image-pipeline — native packets hand off the
    // exact durably appended record; every post-commit consequence stays here.
    pub(super) fn after_commit_record(&mut self, commit: snapback2_core::CommitRecord) -> Result<(), Refusal> {
        self.operator_rejection = None;
        let seq = commit.seq;
        // @ref LLP 1021#1-the-lifecycle-is-in-the-log — record the emission before any post-commit maintenance or runner wake.
        if commit.emits > 0 {
            for row in self
                .runtime()
                .store()
                .outbox_rows_for_seq(seq)
                .map_err(|e| Refusal::from_runtime(&e))?
            {
                writer_effects::transition(
                    &self.root,
                    &row,
                    None,
                    "queued",
                    json!({"by":commit.program}),
                );
            }
        }
        self.log_unavailable()?;
        self.sweep_expired_sessions()?;
        self.sweep_offline_now()?;
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
                Refusal::unknown_operation(
                    op.as_ref(),
                    self.runtime()
                        .generation()
                        .programs()
                        .keys()
                        .map(String::as_str),
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
                "quarry",
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
        let (plan_hash, schema_hash) = self
            .runtime()
            .generation()
            .programs()
            .get(&op)
            .map(|(_, certificate)| {
                (
                    certificate.plan_hash.clone(),
                    certificate.schema_hash.clone(),
                )
            })
            .ok_or_else(|| {
                Refusal::unknown_operation(
                    op.as_ref(),
                    self.runtime()
                        .generation()
                        .programs()
                        .keys()
                        .map(String::as_str),
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
            "certificateSchemaHash": schema_hash,
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
                let mut value = writer_effects::row_json(&row);
                value["payload"] = value_to_json(&row.payload);
                value["createdAt"] = json!(row.created_at);
                value["updatedAt"] = json!(row.updated_at);
                value
            })
            .collect::<Vec<_>>();
        let history =
            crate::control::outbox_history(&self.root.join(".snapback/log.jsonl"), wanted);
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
        match history {
            Ok(lines) => {
                output["outbox"]["history"] = json!(lines);
            }
            Err(error) => {
                output["outbox"]["history"] = json!({"unavailable":error.message});
            }
        }
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
            "log": crate::watch::log_status(&self.root),
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
            "successor": self.runtime().store().meta("last_successor").map_err(|e| Refusal::from_runtime(&e))?
                .and_then(|report| serde_json::from_str::<Json>(&report).ok()),
            "jobs": self.runtime().store().job_counts().map_err(|e| Refusal::from_runtime(&e))?,
            "mode": self.mode,
        }))
    }

    pub(super) fn manifest(&self, operator: bool) -> Result<Json, Refusal> {
        let runtime = self.runtime();
        let schedule_targets = runtime
            .generation()
            .schema()
            .schedules
            .iter()
            .map(|schedule| schedule.target.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        let tables = runtime
            .generation()
            .schema()
            .tables
            .iter()
            .map(|(name, table)| Ok((name.clone(), manifest_table(name, table, runtime.store())?)))
            .collect::<Result<Map<_, _>, Refusal>>()?;
        let ops = self
            .runtime()
            .generation()
            .programs()
            .iter()
            .filter(|(name, (program, _))| {
                !name.starts_with("__owner.")
                    && (operator
                        || program.kind == ProgramKind::Job
                        || !schedule_targets.contains(name.as_str()))
            })
            .map(|(name, (program, certificate))| {
                (
                    name.clone(),
                    json!({
                        "kind": match program.kind { ProgramKind::Query => "query", ProgramKind::Job => "job", ProgramKind::Mutation => "mutation" },
                        "args": program.args,
                        "cursor": snapback2_core::certificate::result_cursor(program, certificate),
                        "drain": writer_resume::drain_metadata(program, certificate),
                        "planHash": certificate.plan_hash,
                    }),
                )
            })
            .collect::<Map<_, _>>();
        Ok(json!({
            "generation": self.runtime().generation().hash(),
            "programGeneration": self.runtime().generation().program_hash(),
            "tables": tables,
            "ops": ops,
            "channels": self.runtime().generation().schema().channels,
            "auth": self.runtime().generation().schema().auth,
        }))
    }

    pub(super) fn outbox_counts(&self) -> Result<OutboxCounts, Refusal> {
        self.runtime()
            .store()
            .outbox_counts()
            .map_err(|error| Refusal::from_runtime(&error))
    }
}

// @ref LLP 1019#7-the-twin — the declaration travels with the manifest so a
// client can tell a custody log from an ordinary table.
// @ref LLP 1019#4-certification — the audience bound `A` is the engine's
// recorded fact, disclosed beside the declaration; D2 reserves against it, so
// the manifest never publishes `deliver` without it: an unreadable or missing
// record refuses the manifest instead of dropping the bound.
fn manifest_table(name: &str, table: &snapback2_core::Table, store: &snapback2_core::Store) -> Result<Json, Refusal> {
    let mut entry = json!({ "retain": table.retain, "columns": table.columns });
    if let Some(deliver) = &table.deliver {
        let audience = snapback2_core::delivery::audience_bound(store, &deliver.log)
            .and_then(|bound| {
                bound.ok_or_else(|| snapback2_core::RuntimeError::StoreVersion {
                    detail: format!("custody log {} has no recorded audience bound", deliver.log),
                })
            })
            .map_err(|error| {
                // A missing or unparsable audience record is re-recorded by the
                // next open; the store must not be deleted for it (LLP 1019 §2).
                let mut refusal = Refusal::from_runtime(&error);
                refusal.site = Some(format!("schema.tables.{name}.deliver"));
                refusal.rewrite = Some(
                    "stop snapback2 dev and restart the owner: the audience bound is re-recorded on open; keep .snapback/store.sqlite"
                        .to_owned(),
                );
                refusal
            })?;
        entry["deliver"] = json!(deliver);
        entry["deliver"]["audience"] = json!(audience);
    }
    Ok(entry)
}

#[cfg(test)]
mod tests {
    use super::super::writer_live_tests::state_with;
    use serde_json::json;
    use snapback2_core::{
        Auth, Ceilings, ColumnType, Constraint, Expr, Generation, Index, IndexComponent,
        OperatorId, Program, ProgramKind, ProjectJson, Schema, Stmt, Value, delivery, object,
        public_table,
    };
    use std::collections::BTreeMap;

    fn index(columns: &[&str], unique: bool) -> Index {
        Index {
            components: columns
                .iter()
                .map(|name| IndexComponent::Column((*name).to_owned()))
                .collect(),
            unique,
        }
    }

    /// Conversations, memberships capped at `cap` by conversation, and messages
    /// carrying `deliver … bootstrap` when `declared`.
    fn custody_project(cap: u32, declared: bool) -> ProjectJson {
        let by_id = BTreeMap::from([("byId".to_owned(), index(&["id"], true))]);
        let mut memberships = public_table(
            BTreeMap::from([
                ("id".to_owned(), ColumnType::Id),
                ("conversationId".to_owned(), ColumnType::Ref { table: "conversations".to_owned() }),
                ("principal".to_owned(), ColumnType::Principal),
            ]),
            BTreeMap::from([
                ("byId".to_owned(), index(&["id"], true)),
                ("byConversationPrincipal".to_owned(), index(&["conversationId", "principal"], false)),
            ]),
        );
        memberships.constraints.push(Constraint::Cap { by: vec!["conversationId".to_owned()], max: cap });
        let mut messages = public_table(
            BTreeMap::from([
                ("id".to_owned(), ColumnType::Id),
                ("conversationId".to_owned(), ColumnType::Ref { table: "conversations".to_owned() }),
            ]),
            by_id.clone(),
        );
        let mut schema = Schema::default();
        schema.tables.insert(
            "conversations".to_owned(),
            public_table(BTreeMap::from([("id".to_owned(), ColumnType::Id)]), by_id),
        );
        schema.tables.insert("memberships".to_owned(), memberships);
        if declared {
            let deliver = delivery::Deliver {
                target: "memberships".to_owned(),
                prefix: vec!["conversationId".to_owned()],
                principal: "principal".to_owned(),
                log: "deliveries".to_owned(),
                receipts: false,
                bootstrap: true,
            };
            messages.deliver = Some(deliver.clone());
            schema.tables.insert("messages".to_owned(), messages);
            let log = delivery::log_table(&schema, "messages", &deliver).expect("log shape");
            schema.tables.insert("deliveries".to_owned(), log);
        } else {
            schema.tables.insert("messages".to_owned(), messages);
        }
        ProjectJson { version: 1, schema, programs: Vec::new(), effects: Vec::new(), auth: Auth::default() }
    }

    fn member(id: &str, principal: &str) -> (String, Value) {
        (
            "memberships".to_owned(),
            object([
                ("id", Value::Id(id.to_owned())),
                ("conversationId", Value::Id("c1".to_owned())),
                ("principal", Value::Id(principal.to_owned())),
            ]),
        )
    }

    // @ref LLP 1019#4-certification — the manifest never publishes `deliver`
    // without `A`: an unrecorded or unreadable bound refuses the manifest.
    #[test]
    fn manifest_refuses_a_custody_log_whose_audience_bound_is_unreadable_or_unrecorded() {
        let project = custody_project(1, true);
        let messages = &project.schema.tables["messages"];
        let mut store = snapback2_core::Store::memory().unwrap();
        let refusal = super::manifest_table("messages", messages, &store).unwrap_err();
        assert_eq!(refusal.code, "E_STORE_VERSION");
        assert!(refusal.message.contains("custody log deliveries has no recorded audience bound"), "{}", refusal.message);
        assert_eq!(refusal.site.as_deref(), Some("schema.tables.messages.deliver"));
        assert!(refusal.rewrite.as_deref().unwrap_or("").contains("keep .snapback/store.sqlite"), "{:?}", refusal.rewrite);
        store.set_meta("custody_audience:deliveries", "nope").unwrap();
        let refusal = super::manifest_table("messages", messages, &store).unwrap_err();
        assert_eq!(refusal.code, "E_STORE_VERSION");
        assert!(refusal.message.contains("custody_audience:deliveries is not an unsigned integer"), "{}", refusal.message);
        store.set_meta("custody_audience:deliveries", "7").unwrap();
        let entry = super::manifest_table("messages", messages, &store).unwrap();
        assert_eq!(entry["deliver"]["audience"], json!(7));
        let plain = super::manifest_table("memberships", &project.schema.tables["memberships"], &store).unwrap();
        assert!(plain.get("deliver").is_none());
    }

    // @ref LLP 1019#4-certification — the manifest discloses the engine-recorded
    // audience bound beside the declaration, not the target's live cap.
    #[test]
    fn manifest_discloses_deliver_with_the_engine_recorded_audience_bound() {
        let mut state = state_with("manifest-custody", custody_project(3, false));
        let manifest = state.manifest(false).unwrap();
        for (name, entry) in manifest["tables"].as_object().unwrap() {
            assert!(entry.get("deliver").is_none(), "{name} carries a deliver key without a declaration");
        }
        let runtime = state.runtime.as_mut().unwrap();
        runtime
            .seed(&[
                ("conversations".to_owned(), object([("id", Value::Id("c1".to_owned()))])),
                member("m-alice", "alice"),
                member("m-bob", "bob"),
                member("m-carol", "carol"),
                ("messages".to_owned(), object([("id", Value::Id("msg-1".to_owned())), ("conversationId", Value::Id("c1".to_owned()))])),
            ])
            .unwrap();
        let declared = Generation::certify(&custody_project(3, true), Ceilings::default()).unwrap();
        runtime.apply_successor(declared).unwrap();
        for who in ["m-bob", "m-carol"] {
            let leave = Program {
                name: "ops.leave".to_owned(),
                kind: ProgramKind::Mutation,
                args: BTreeMap::new(),
                read_time_granularity_ms: None,
                body: vec![
                    Stmt::Delete { table: "memberships".to_owned(), key: Expr::Literal(Value::Id(who.to_owned())) },
                    Stmt::Return(Expr::Literal(Value::Null)),
                ],
            };
            runtime.execute_adhoc_operator(&leave, BTreeMap::new(), OperatorId("op".into()), || 3).unwrap();
        }
        let lowered = Generation::certify(&custody_project(1, true), Ceilings::default()).unwrap();
        runtime.apply_successor(lowered).unwrap();

        let manifest = state.manifest(false).unwrap();
        assert_eq!(
            manifest["tables"]["messages"]["deliver"],
            json!({ "target": "memberships", "prefix": ["conversationId"], "principal": "principal", "log": "deliveries", "bootstrap": true, "audience": 3 }),
            "the bound is the recorded 3 while the cap is 1: {}",
            manifest["tables"]["messages"]
        );
        assert_eq!(manifest["tables"]["deliveries"]["retain"], json!("until-revoked"));
        for name in ["deliveries", "memberships", "conversations"] {
            assert!(manifest["tables"][name].get("deliver").is_none(), "{name} carries a deliver key");
        }
    }
}
