// @ref LLP 1003#4-in-the-owner — effect lifecycle operations remain on the sole writer.

use super::*;
use snapback2_core::OutboxRow;

pub(super) const RESULT_BYTES: usize = 16 * 1024;

#[derive(Default)]
pub(super) struct Observation {
    pub(super) queued: Option<u64>,
    pub(super) started: BTreeMap<String, Instant>,
}

pub(crate) fn transition(
    root: &std::path::Path,
    row: &OutboxRow,
    from: Option<&str>,
    to: &str,
    detail: Json,
) {
    let mut event =
        json!({"id": row.id, "seq": row.seq, "effect": row.effect, "from": from, "to": to});
    event.as_object_mut().unwrap().extend(
        detail
            .as_object()
            .into_iter()
            .flatten()
            .map(|(k, v)| (k.clone(), v.clone())),
    );
    crate::watch::log(root, json!({"outbox":event}));
}

pub(super) fn row_json(row: &OutboxRow) -> Json {
    let mut value = json!({"id":row.id,"seq":row.seq,"effect":row.effect,"state":row.state,
        "attempts":row.attempts,"nextAt":row.next_at,"lastError":row.last_error,"result":row.result});
    let bytes = row
        .result
        .as_ref()
        .map(|r| r.to_string().len())
        .unwrap_or(0);
    if bytes > RESULT_BYTES {
        value["result"] = Json::Null;
        value["resultCapped"] = json!({"bytes":bytes,"limit":RESULT_BYTES});
    }
    if row.state == "sent"
        && let Some(op) = &row.then_op
    {
        value["then"] = if let Some(error) = &row.last_error {
            json!({"op":op,"state":"rejected","code":error.split(':').next().unwrap_or(error)})
        } else {
            let mut receipt = json!({"op":op,"state":"committed"});
            if let Some(seq) = row.then_seq {
                receipt["seq"] = json!(seq);
            }
            receipt
        };
    }
    value
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EffectsStatus {
    pub(super) engine: String,
    pub(super) queued: u64,
    pub(super) running: u64,
    pub(super) then_pending: u64,
    pub(super) sent: u64,
    pub(super) failed: u64,
    pub(super) sent_unknown: u64,
}

impl State {
    pub(super) fn outbox_dev(&self) -> Result<(), Refusal> {
        if self.mode == "dev" {
            Ok(())
        } else {
            Err(Refusal::operator_required())
        }
    }

    pub(super) fn outbox_page(
        &self,
        state: Option<&str>,
        after: Option<&str>,
        up_to: u64,
        limit: usize,
    ) -> Result<Json, Refusal> {
        self.outbox_dev()?;
        let after = after
            .map(|text| {
                serde_json::from_str::<(u64, String)>(text).map_err(|_| {
                    Refusal::input(
                        "invalid outbox cursor",
                        "pass the previous page's after value",
                    )
                })
            })
            .transpose()?;
        let mut rows = self
            .runtime()
            .store()
            .outbox_page(
                state,
                after.as_ref().map(|(seq, id)| (*seq, id.as_str())),
                up_to,
                limit + 1,
            )
            .map_err(|e| Refusal::from_runtime(&e))?;
        let more = rows.len() > limit;
        rows.truncate(limit);
        let after = if more {
            rows.last().map(|row| json!([row.seq, row.id]).to_string())
        } else {
            None
        };
        Ok(
            json!({"rows":rows.iter().map(row_json).collect::<Vec<_>>(),"after":after,
            "now":self.now(),"engine":effects_engine()}),
        )
    }

    pub(super) fn log_unavailable(&mut self) -> Result<(), Refusal> {
        if effects_engine() == "none" {
            let queued = self.outbox_counts()?.queued;
            if self.outbox_observation.queued != Some(queued) {
                crate::watch::log(
                    &self.root,
                    json!({"outbox":{"engine":"none","queued":queued}}),
                );
                self.outbox_observation.queued = Some(queued);
            }
        }
        Ok(())
    }

    pub(super) fn log_then(&self, row: &OutboxRow, execution: &Json) -> Result<(), Refusal> {
        let after = self
            .runtime()
            .store()
            .outbox_get(&row.id)
            .map_err(|e| Refusal::from_runtime(&e))?
            .ok_or_else(|| {
                Refusal::new(
                    "E_EFFECT_NOT_FOUND",
                    "effect",
                    format!("outbox row {} vanished during its then settlement", row.id),
                    "inspect the outbox with snapback2 trace and restart the owner",
                    "effects/requeue",
                )
            })?;
        let mut outcome = json!({"op":row.then_op,"state":execution["state"]});
        if execution["state"] == "committed" {
            outcome["seq"] = execution["seq"].clone();
        } else {
            outcome["code"] = execution["code"].clone();
        }
        transition(
            &self.root,
            row,
            Some(&row.state),
            &after.state,
            json!({"then":outcome}),
        );
        Ok(())
    }

    pub(super) fn effect_declarations(
        &self,
        effect: &str,
        generation: Option<&str>,
    ) -> Result<Json, Refusal> {
        let current_generation = self.runtime().generation().effects_hash();
        let current = self.runtime().generation().effects().get(effect).cloned();
        let bound = generation
            .map(|generation| format!("effects_json:{generation}"))
            .map(|key| self.runtime().store().meta(&key))
            .transpose()
            .map_err(|error| Refusal::from_runtime(&error))?
            .flatten()
            .map(|encoded| {
                serde_json::from_str::<BTreeMap<String, snapback2_core::EffectDecl>>(&encoded)
                    .map_err(|error| {
                        Refusal::from_runtime(&snapback2_core::RuntimeError::Serialization(
                            error.to_string(),
                        ))
                    })
            })
            .transpose()?
            .and_then(|declarations| declarations.get(effect).cloned());
        Ok(json!({
            "currentGeneration": current_generation,
            "bound": bound,
            "current": current,
        }))
    }

    pub(super) fn wake_effects(&self) {
        if let Some(wake) = &self.effects_wake {
            let _ = wake.try_send(());
        }
    }

    pub(super) fn execute_then(
        &mut self,
        op: &str,
        args: Json,
        outbox_id: &str,
    ) -> Result<Json, Refusal> {
        let row = self
            .runtime()
            .store()
            .outbox_get(outbox_id)
            .map_err(|e| Refusal::from_runtime(&e))?
            .ok_or_else(|| Refusal::input("missing then row", "pass a pending outbox id"))?;
        let values = match operation_args(self.runtime().generation(), op, &args) {
            Ok(values) => values,
            Err(refusal) => {
                let execution = self
                    .runtime_mut()
                    .reject_then(op, outbox_id, &refusal.code, &refusal.message)
                    .map_err(|error| Refusal::from_runtime(&error))?;
                let value = execution_json(&execution);
                self.log_then(&row, &value)?;
                return Ok(value);
            }
        };
        let now = self.now();
        let new_ids = self
            .runtime_mut()
            .reserve_new_ids()
            .map_err(|error| Refusal::from_runtime(&error))?;
        let execution = self
            .runtime_mut()
            .execute_then(op, values, now, Some(now), new_ids, outbox_id)
            .map_err(|error| Refusal::from_runtime(&error))?;
        let value = execution_json(&execution);
        self.log_then(&row, &value)?;
        if matches!(execution.state, ExecutionState::Committed { .. }) {
            self.after_commit(execution.seq)?;
        }
        Ok(value)
    }
}

pub(super) fn effects_engine() -> &'static str {
    snapback2_effects::describe()
}

impl State {
    pub(super) fn settle_outbox(
        &mut self,
        id: &str,
        state: &str,
        result: Option<&Json>,
        last_error: Option<&str>,
        next_at: Option<i64>,
    ) -> Result<Json, Refusal> {
        let row = self
            .runtime()
            .store()
            .outbox_get(id)
            .map_err(|e| Refusal::from_runtime(&e))?
            .ok_or_else(|| Refusal::input("missing outbox row", "pass an outbox id"))?;
        self.runtime()
            .store()
            .outbox_settle(id, state, result, last_error, next_at)
            .map_err(|e| Refusal::from_runtime(&e))?;
        let mut detail = json!({"attempt":row.attempts});
        if let Some(started) = self.outbox_observation.started.remove(id) {
            detail["ms"] = json!(started.elapsed().as_millis() as u64);
        }
        if let Some(next_at) = next_at {
            detail["nextAt"] = json!(next_at);
        }
        if let Some(error) = last_error {
            detail["error"] = json!(error);
        }
        transition(&self.root, &row, Some(&row.state), state, detail);
        self.log_unavailable()?;
        Ok(json!({"ok":true}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_names_the_linked_effect_engine() {
        assert_eq!(effects_engine(), snapback2_effects::describe());
    }
    fn effect_state() -> State {
        let mut state = super::super::writer_live_tests::state("effect-transitions");
        let mut project = state.compiled.project.clone();
        project.schema.effects = vec!["delivery.notify".into()];
        project.effects = vec![snapback2_core::EffectDecl {
            name: "delivery.notify".into(),
            source: "async () => null".into(),
            grants: vec![],
            then: Some("notifications.recordNotified".into()),
        }];
        project.programs = vec![
            Program {
                name: "messages.send".into(),
                kind: ProgramKind::Mutation,
                args: BTreeMap::new(),
                read_time_granularity_ms: None,
                body: vec![Stmt::Emit {
                    effect: "delivery.notify".into(),
                    payload: Expr::Literal(Value::Null),
                }],
            },
            Program {
                name: "notifications.recordNotified".into(),
                kind: ProgramKind::Mutation,
                args: BTreeMap::new(),
                read_time_granularity_ms: None,
                body: vec![Stmt::Return(Expr::Literal(Value::Bool(true)))],
            },
        ];
        let generation = Generation::certify(&project, Ceilings::default()).unwrap();
        state.runtime =
            Some(Runtime::open(snapback2_core::Store::memory().unwrap(), generation).unwrap());
        let mut context = Context::mutation(Actor::user("test").unwrap(), BTreeMap::new());
        context.now = Some(1);
        context.new_ids = VecDeque::from(["one".into()]);
        let execution = state
            .runtime_mut()
            .execute("messages.send", context)
            .unwrap();
        state.after_commit(execution.seq).unwrap();
        state
    }

    #[test]
    fn transitions_are_logged_at_commit_claim_recovery_requeue_retry_and_then() {
        let mut state = effect_state();
        assert_eq!(
            state.handle(Action::OutboxClaim { now: 1 }).unwrap()["attempts"],
            1
        );
        state.handle(Action::OutboxMarkUnknown).unwrap();
        state
            .handle(Action::OutboxRequeue { id: "one".into() })
            .unwrap();
        state.handle(Action::OutboxClaim { now: i64::MAX }).unwrap();
        state
            .settle_outbox("one", "queued", None, Some("provider 503"), Some(2000))
            .unwrap();
        assert!(
            state
                .handle(Action::OutboxClaim { now: 1999 })
                .unwrap()
                .is_null()
        );
        assert_eq!(
            state.handle(Action::OutboxClaim { now: 2000 }).unwrap()["attempts"],
            2
        );
        state
            .settle_outbox(
                "one",
                "then_pending",
                Some(&json!({"providerId":"provider-1"})),
                None,
                None,
            )
            .unwrap();
        // Pending bookkeeping remains unsettled, even in an engine-less owner.
        assert_eq!(
            state.outbox_page(None, None, u64::MAX, 200).unwrap()["rows"][0]["state"],
            "then_pending"
        );
        state
            .execute_then("notifications.recordNotified", json!({}), "one")
            .unwrap();
        let trace = state.trace(Some(1)).unwrap();
        let history = trace["outbox"]["history"].as_array().unwrap();
        assert_eq!(
            history
                .iter()
                .map(|line| line["outbox"]["to"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec![
                "queued",
                "running",
                "sent_unknown",
                "queued",
                "running",
                "queued",
                "running",
                "then_pending",
                "sent"
            ]
        );
        assert!(
            history
                .iter()
                .all(|line| line["outbox"]["effect"] == "delivery.notify")
        );
        assert_eq!(history[0]["outbox"]["from"], Json::Null);
        assert_eq!(history[0]["outbox"]["by"], "messages.send");
        assert_eq!(history[5]["outbox"]["error"], "provider 503");
        assert_eq!(history[5]["outbox"]["nextAt"], 2000);
        assert_eq!(history[6]["outbox"]["attempt"], 2);
        assert!(history[7]["outbox"]["ms"].is_number());
        assert_eq!(
            trace["outbox"]["rows"][0]["then"],
            json!({"op":"notifications.recordNotified","state":"committed","seq":2})
        );
        assert_eq!(
            history[8]["outbox"]["then"],
            trace["outbox"]["rows"][0]["then"]
        );
        std::fs::remove_dir_all(&state.root).unwrap();
    }

    #[cfg(not(feature = "hermes"))]
    #[test]
    fn no_engine_count_changes_and_log_write_failure_are_visible_in_status() {
        let mut state = effect_state();
        for _ in 0..3 {
            state
                .handle(Action::OutboxMarkQueuedUnavailable {
                    error: "no engine in this build".into(),
                })
                .unwrap();
        }
        let log = std::fs::read_to_string(state.root.join(".snapback/log.jsonl")).unwrap();
        assert_eq!(
            log.lines()
                .filter(|l| serde_json::from_str::<Json>(l).unwrap()["outbox"]["engine"] == "none")
                .count(),
            1
        );
        let path = state.root.join(".snapback/log.jsonl");
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        state
            .handle(Action::EffectsLog {
                lines: vec![json!({"message":"cannot write"})],
            })
            .unwrap();
        assert!(
            state.status().unwrap()["log"]
                .as_str()
                .unwrap()
                .starts_with("unavailable(")
        );
        std::fs::remove_dir(&path).unwrap();
        state
            .handle(Action::EffectsLog {
                lines: vec![json!({"message":"writable again"})],
            })
            .unwrap();
        assert_eq!(state.status().unwrap()["log"], "available");
        std::fs::remove_dir_all(&state.root).unwrap();
    }

    // @ref LLP 1021#2-journeys-see-and-settle-the-outbox — a pending `then` keeps `settle` pumping to the budget even beside rows no engine can move.
    #[cfg(not(feature = "hermes"))]
    #[test]
    fn settlement_pumps_a_pending_then_beside_engineless_queued_rows_and_honors_the_budget() {
        let mut state = effect_state();
        state.handle(Action::OutboxClaim { now: 1 }).unwrap();
        state
            .settle_outbox("one", "then_pending", Some(&json!(true)), None, None)
            .unwrap();
        for index in 0..405 {
            let mut context = Context::mutation(Actor::user("test").unwrap(), BTreeMap::new());
            context.now = Some(1);
            context.new_ids = VecDeque::from([format!("queued-{index:03}")]);
            let execution = state
                .runtime_mut()
                .execute("messages.send", context)
                .unwrap();
            state.after_commit(execution.seq).unwrap();
        }
        let root = state.root.clone();
        let (wake, _wakes) = mpsc::sync_channel(1);
        state.effects_wake = Some(wake);
        let (tx, rx) = mpsc::channel();
        let handle = OwnerHandle { tx };
        let writer = thread::spawn(move || run_writer(state, rx));
        let started = Instant::now();
        let response =
            crate::control::settle_effects(&handle, &json!({"upTo":406,"budgetMs":400})).unwrap();
        let elapsed = started.elapsed();
        assert!(
            elapsed >= Duration::from_millis(400),
            "returned at {elapsed:?} with a then still pending"
        );
        assert!(
            elapsed < Duration::from_millis(1000),
            "overran the 400 ms budget: {elapsed:?}"
        );
        assert_eq!(response["settled"], false);
        assert_eq!(response["rows"].as_array().unwrap().len(), 406);
        let remaining = response["remaining"].as_array().unwrap();
        assert_eq!(remaining.len(), 406);
        assert_eq!(remaining[0], json!({"id":"one","reason":"then_pending"}));
        assert!(remaining[1..].iter().all(|r| r["reason"] == "engine:none"));
        handle
            .call(Action::Stop {
                cause: "budget test complete".into(),
            })
            .unwrap();
        writer.join().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deleted_declaration_fails_the_queued_row_at_claim_and_logs_e_effect_unknown() {
        let mut state = effect_state();
        let mut project = state.compiled.project.clone();
        project.schema.effects.clear();
        project.effects.clear();
        project
            .programs
            .retain(|program| program.name != "messages.send");
        let generation = Generation::certify(&project, Ceilings::default()).unwrap();
        state
            .handle(Action::Apply {
                compiled: CompiledProject {
                    project,
                    generation,
                    api_dts: String::new(),
                    compiler_ms: 0.0,
                    quarry: Vec::new(),
                    sources: Default::default(),
                },
                migration: None,
                seed: None,
                cache: None,
            })
            .unwrap();
        assert!(state.handle(Action::OutboxClaim { now: 1 }).unwrap().is_null());
        let row = state.runtime().store().outbox_get("one").unwrap().unwrap();
        assert_eq!(
            (row.state.as_str(), row.last_error.as_deref()),
            ("failed", Some("E_EFFECT_UNKNOWN"))
        );
        let log = std::fs::read_to_string(state.root.join(".snapback/log.jsonl")).unwrap();
        let failed = log
            .lines()
            .map(|line| serde_json::from_str::<Json>(line).unwrap())
            .filter(|line| line["outbox"]["to"] == "failed")
            .collect::<Vec<_>>();
        assert_eq!(
            failed,
            vec![json!({"outbox":{"id":"one","seq":1,"effect":"delivery.notify",
                "from":"queued","to":"failed","error":"E_EFFECT_UNKNOWN"}})]
        );
        std::fs::remove_dir_all(&state.root).unwrap();
    }

    #[test]
    fn settlement_budget_waits_off_writer_and_pending_then_is_not_settled() {
        let mut state = effect_state();
        state.handle(Action::OutboxClaim { now: 1 }).unwrap();
        state
            .settle_outbox("one", "then_pending", Some(&json!(true)), None, None)
            .unwrap();
        let root = state.root.clone();
        let (wake, wakes) = mpsc::sync_channel(1);
        state.effects_wake = Some(wake);
        let (tx, rx) = mpsc::channel();
        let handle = OwnerHandle { tx };
        let writer = thread::spawn(move || run_writer(state, rx));
        let settling = {
            let handle = handle.clone();
            thread::spawn(move || {
                crate::control::settle_effects(&handle, &json!({"upTo":1,"budgetMs":400})).unwrap()
            })
        };
        wakes
            .recv_timeout(Duration::from_secs(1))
            .expect("settle ran its first turn");
        let started = Instant::now();
        let status = handle.call(Action::Status).unwrap();
        assert_eq!(status["effects"]["thenPending"], 1);
        assert!(
            started.elapsed() < Duration::from_millis(200),
            "settle held the writer"
        );
        let response = settling.join().unwrap();
        assert_eq!(response["settled"], false);
        assert_eq!(
            response["remaining"],
            json!([{"id":"one","reason":"then_pending"}])
        );
        handle
            .call(Action::Stop {
                cause: "settlement test complete".into(),
            })
            .unwrap();
        writer.join().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
