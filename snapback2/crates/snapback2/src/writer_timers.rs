use super::*;

impl State {
    pub(super) fn timer_poll_timeout(&self) -> Result<Duration, Refusal> {
        Ok(self
            .runtime()
            .store()
            .next_timer_at()
            .map_err(|e| Refusal::from_runtime(&e))?
            .map(|at| Duration::from_millis(at.saturating_sub(self.now()).max(0) as u64))
            .unwrap_or(Duration::from_secs(60)))
    }
    // @ref LLP 1025.001#d1--the-rule — at most 64 oldest-due firing transactions,
    // then inspect the remaining index at the same clock (exactly 64 can drain it).
    pub(super) fn fire_due_timers_background_turn(&mut self, now: i64) -> Result<bool, Refusal> {
        for _ in 0..64 {
            let outcomes = self
                .runtime_mut()
                .fire_due_at(1, now)
                .map_err(|e| Refusal::from_runtime(&e))?;
            let Some(outcome) = outcomes.first() else {
                return Ok(true);
            };
            self.after_commit(outcome.seq)?;
            crate::watch::log(
                &self.root,
                json!({"kind":"schedule","seq":outcome.seq,"firing":outcome.firing}),
            );
        }
        Ok(self
            .runtime()
            .store()
            .next_timer_at()
            .map_err(|e| Refusal::from_runtime(&e))?
            .is_none_or(|at| at > now))
    }
    // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — summaries begin
    // with the declarations so a schedule with no materialized timer row is still listed at zero.
    pub(super) fn timers(&self) -> Result<Json, Refusal> {
        let runtime = self.runtime();
        runtime
            .store()
            .timers_summary(self.now(), &runtime.generation().schema().schedules)
            .map_err(|e| Refusal::from_runtime(&e))
    }
    // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — a schedule target
    // is a system program: the timer runs it as the owner and `/api/*` refuses it like a job;
    // the operator seat (`run <target> --as system`) never comes through here.
    pub(super) fn refuse_schedule_target(&self, op: &str) -> Result<(), Refusal> {
        let schedules = &self.runtime().generation().schema().schedules;
        match schedules.iter().find(|schedule| schedule.target == op) {
            Some(schedule) => Err(Refusal::schedule_target(op, &schedule.name)),
            None => Ok(()),
        }
    }
    pub(super) fn timer_trace(&self, id: &str) -> Result<Json, Refusal> {
        let trace = self
            .runtime()
            .store()
            .timer_trace(id)
            .map_err(|e| Refusal::from_runtime(&e))?;
        if trace["timer"].is_null() && trace["firings"].as_array().is_none_or(|a| a.is_empty()) {
            return Err(Refusal::new(
                "E_INPUT_TRACE_UNKNOWN",
                "input",
                format!("unknown timer {id}"),
                "use a timer id from /control/timers or logs",
                "schedule",
            )
            .with_site(format!("timer:{id}")));
        }
        Ok(trace)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback2_core::{
        ColumnType, Index, IndexComponent, Input, LoopDomain, OperatorId, ProjectJson, Schema,
        Store, object, public_table,
        timers::{Schedule, Trigger},
    };

    fn fixture(count: usize, take: u32, enabled: bool, rejecting: bool) -> (State, String) {
        let program = |name: &str, kind, args, body| Program {
            name: name.into(),
            kind,
            args,
            read_time_granularity_ms: None,
            body,
        };
        let binding = program(
            "timerBinding",
            ProgramKind::Query,
            BTreeMap::from([("id".into(), ArgType::Id)]),
            vec![Stmt::Return(Expr::Object(BTreeMap::from([
                ("enabled".into(), Expr::Literal(Value::Bool(enabled))),
                (
                    "args".into(),
                    Expr::Object(BTreeMap::from([("id".into(), Expr::Variable("id".into()))])),
                ),
            ])))],
        );
        let purge = program(
            "purge",
            ProgramKind::Mutation,
            BTreeMap::from([("id".into(), ArgType::Id)]),
            vec![
                Stmt::Require {
                    site: None,
                    condition: Expr::Literal(Value::Bool(!rejecting)),
                    code: "RETAIN_ROW".into(),
                },
                Stmt::Delete {
                    table: "items".into(),
                    key: Expr::Variable("id".into()),
                },
            ],
        );
        let sweep = program(
            "observe",
            ProgramKind::Job,
            BTreeMap::new(),
            vec![Stmt::For {
                binding: "row".into(),
                domain: LoopDomain::Page(Scan {
                    site: "observe.items".into(),
                    table: "items".into(),
                    index: "byId".into(),
                    prefix: vec![],
                    order: Order::Asc,
                    take: Bound::Literal(take),
                    after: None,
                    before: None,
                    range: None,
                    opaque_cursor: false,
                    merge_site: None,
                    provenance: KeyProvenance::Const,
                }),
                body: vec![Stmt::Update {
                    table: "items".into(),
                    key: Expr::Field {
                        base: Box::new(Expr::Variable("row".into())),
                        name: "id".into(),
                    },
                    patch: Expr::Object(BTreeMap::from([("seen".into(), Expr::Input(Input::Now))])),
                }],
            }],
        );
        let project = ProjectJson {
            version: 1,
            schema: Schema {
                tables: BTreeMap::from([(
                    "items".into(),
                    public_table(
                        BTreeMap::from([
                            ("id".into(), ColumnType::Id),
                            (
                                "at".into(),
                                ColumnType::Optional(Box::new(ColumnType::Time)),
                            ),
                            (
                                "seen".into(),
                                ColumnType::Optional(Box::new(ColumnType::Time)),
                            ),
                        ]),
                        BTreeMap::from([(
                            "byId".into(),
                            Index {
                                components: vec![IndexComponent::Column("id".into())],
                                unique: true,
                            },
                        )]),
                    ),
                )]),
                schedules: vec![Schedule {
                    name: "expire".into(),
                    trigger: Trigger::Row {
                        table: "items".into(),
                        column: "at".into(),
                    },
                    target: "purge".into(),
                    binding: "timerBinding".into(),
                    site: "test:1:1".into(),
                }],
                ..Schema::default()
            },
            programs: vec![binding, purge, sweep],
            effects: vec![],
            auth: Default::default(),
        };
        let mut state = writer_live_tests::state_with("timer-order", project);
        let row = |id: String, at| {
            (
                "items".into(),
                object([("id", Value::Id(id)), ("at", at), ("seen", Value::Null)]),
            )
        };
        let mut rows = vec![row("a-future".into(), Value::Int(1_001))];
        rows.extend((0..count).map(|n| row(format!("m-{n:03}"), Value::Int(1_000))));
        state.runtime_mut().seed(&rows).unwrap();
        let id = state
            .runtime_mut()
            .enqueue_job_at("observe", BTreeMap::new(), OperatorId("test".into()), 0)
            .unwrap();
        (state, id)
    }

    fn data(state: &mut State) -> Vec<Json> {
        state
            .data(
                "items".into(),
                "byId".into(),
                json!([]),
                None,
                200,
                Identity::Operator { by: "test".into() },
            )
            .unwrap()["data"]
            .as_array()
            .unwrap()
            .clone()
    }

    fn skipped(state: &State) -> usize {
        std::fs::read_to_string(state.root.join(".snapback/log.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Json>(line).unwrap())
            .filter(|line| line["skipped"] == "timers-due")
            .count()
    }

    // @ref LLP 1025.001#acceptance — deterministic owner turns exercise actual
    // firing, commit, live-rerun and chunk code without waiting on wall time.
    #[test]
    fn a_timer_backlog_delays_the_chunk_until_a_later_turn_drains_it() {
        let (mut state, id) = fixture(100, 200, true, false);
        state.background_turn_at(1_000).unwrap();
        assert_eq!(state.runtime().job_record(&id).unwrap().chunks, 0);
        assert_eq!(
            state.runtime().store().timer_status(1_000).unwrap()["due"],
            36
        );
        assert_eq!(skipped(&state), 1);
        state.background_turn_at(1_000).unwrap();
        assert_eq!(state.runtime().job_record(&id).unwrap().state, "done");
        assert_eq!(
            data(&mut state),
            vec![json!({"id":"a-future","at":1001,"seen":1000})]
        );
        let commits = state.runtime().store().commits_since(0, 500).unwrap();
        let timed = commits
            .iter()
            .filter(|c| c.kind == "schedule" || c.kind == "job")
            .collect::<Vec<_>>();
        assert_eq!(timed.iter().filter(|c| c.kind == "schedule").count(), 100);
        assert!(timed.iter().all(|c| c.at == 1_000));
        assert_eq!(timed.last().unwrap().kind, "job");
        assert_eq!(skipped(&state), 1);
        std::fs::remove_dir_all(&state.root).unwrap();
    }

    #[test]
    fn exactly_64_or_fewer_due_timers_allow_the_chunk_at_the_same_pinned_clock() {
        for count in [0, 1, 63, 64] {
            let (mut state, id) = fixture(count, 200, true, false);
            // A cutoff far before wall time detects any resampling: it would
            // delete a-future during firing or stamp it with the wrong job now.
            state.background_turn_at(1_000).unwrap();
            assert_eq!(state.runtime().job_record(&id).unwrap().state, "done");
            assert_eq!(
                state.runtime().store().next_timer_at().unwrap(),
                Some(1_001)
            );
            assert_eq!(
                data(&mut state),
                vec![json!({"id":"a-future","at":1001,"seen":1000})]
            );
            assert_eq!(skipped(&state), 0);
            std::fs::remove_dir_all(&state.root).unwrap();
        }
    }

    #[test]
    fn a_restarted_running_job_waits_for_the_due_backlog_with_its_cursor_intact() {
        let (mut state, id) = fixture(65, 1, true, false);
        state.background_turn_at(0).unwrap();
        let before = state.runtime().job_record(&id).unwrap();
        assert_eq!(before.state, "running");
        assert_eq!(before.chunks, 1);
        let snapshot = state.root.join("restart.sqlite");
        state.runtime().store().snapshot_to(&snapshot).unwrap();
        state.runtime = Some(
            Runtime::open(
                Store::open(&snapshot).unwrap(),
                state.compiled.generation.clone(),
            )
            .unwrap(),
        );
        let reopened = state.runtime().job_record(&id).unwrap();
        assert_eq!(reopened.state, "queued");
        assert_eq!(reopened.cursor, before.cursor);
        state.background_turn_at(1_000).unwrap();
        assert_eq!(state.runtime().job_record(&id).unwrap().chunks, 1);
        assert_eq!(skipped(&state), 1);
        state.background_turn_at(1_000).unwrap();
        assert_eq!(state.runtime().job_record(&id).unwrap().state, "done");
        assert_eq!(
            data(&mut state),
            vec![json!({"id":"a-future","at":1001,"seen":0})]
        );
        std::fs::remove_dir_all(&state.root).unwrap();
    }

    #[test]
    fn rejected_and_predicate_skipped_targets_settle_but_do_not_imply_row_expiry() {
        for (enabled, rejecting, rejected) in [(true, true, 1), (false, false, 0)] {
            let (mut state, id) = fixture(1, 200, enabled, rejecting);
            state.background_turn_at(1_000).unwrap();
            assert_eq!(state.runtime().job_record(&id).unwrap().state, "done");
            let status = state.runtime().store().timer_status(1_000).unwrap();
            assert_eq!(status["due"], 0);
            assert_eq!(status["rejected"], rejected);
            let rows = data(&mut state);
            assert_eq!(rows.len(), 2);
            assert!(rows.iter().all(|row| row["seen"] == 1_000));
            assert_eq!(rows[1]["at"], 1_000, "settlement may retain an expired row");
            assert_eq!(skipped(&state), 0);
            std::fs::remove_dir_all(&state.root).unwrap();
        }
    }
}
