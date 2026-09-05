use super::*;
use crate::timers::{Firing, Schedule, Timer, TimerOutcome, Trigger};
use serde_json::json;

impl Runner<'_> {
    pub(super) fn maintain_timers(
        &mut self,
        table: &str,
        old: Option<&Value>,
        new: Option<&Value>,
    ) -> Result<(), RuntimeError> {
        if self.rule_authority != RuleAuthority::StoreAuthoritative {
            return Ok(());
        }
        let writes = crate::store_timers::maintain(self.tx, self.schema, table, old, new)?;
        if writes > 0 {
            *self.trace.writes.entry("_timers".into()).or_default() += writes;
        }
        Ok(())
    }
}
impl Engine {
    // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — execute/enqueue, settle/re-arm and the occurrence ledger are one transaction. Savepoint rejection rolls back only the target.
    pub(crate) fn fire_timer(
        &mut self,
        mut timer: Timer,
        schedule: &Schedule,
        binding: &Program,
        binding_certificate: &Certificate,
        target: &Program,
        certificate: &Certificate,
        now: i64,
        ids: VecDeque<String>,
    ) -> Result<TimerOutcome, RuntimeError> {
        let (start, scheduled_at, skipped) = match (&schedule.trigger, timer.period_start) {
            (Trigger::Every { duration_ms }, Some(start)) => {
                let skipped = (now.saturating_sub(timer.at) / duration_ms).max(0);
                (
                    Some(start.saturating_add(skipped.saturating_mul(*duration_ms))),
                    timer
                        .at
                        .saturating_add(skipped.saturating_mul(*duration_ms)),
                    skipped as u64,
                )
            }
            _ => (None, timer.at, 0),
        };
        let occurrence = match start {
            Some(start) => json!([schedule.name, start]),
            None => json!([schedule.name, timer.row_id, timer.at]),
        };
        let seq = self.store.commit_seq()?.saturating_add(1);
        let tx = self.store.conn.transaction()?;
        tx.execute_batch("SAVEPOINT schedule_target")?;
        let mut trace = AuthoritativeTrace::default();
        let attempted = (|| -> Result<serde_json::Value, RuntimeError> {
            let mut context = Context::system();
            context.now = Some(now);
            context.read_time = Some(now);
            context.new_ids = ids;
            if let (Trigger::Row { table, .. }, Some(id)) = (&schedule.trigger, &timer.row_id) {
                let row: Option<String> = tx
                    .query_row(
                        "SELECT data FROM rows WHERE table_name=?1 AND row_id=?2",
                        params![table, id],
                        |r| r.get(0),
                    )
                    .optional()?;
                let Some(row) = row else {
                    return Ok(json!({"state":"skipped","reason":"row absent"}));
                };
                let mut row: Value = serde_json::from_str(&row)
                    .map_err(|e| RuntimeError::Serialization(e.to_string()))?;
                materialize_optional_fields(&mut row, &self.schema.tables[table]);
                context.args = row.as_object()?.clone();
            }
            validate_inputs(&self.schema, binding, &context.args)?;
            let mut binder = Runner::new(
                &tx,
                &self.schema,
                binding_certificate,
                context.clone(),
                &self.verdicts,
                &self.authority_absences,
                self.rule_authority,
                seq,
            );
            let Flow::Return(bound, _) = binder.statements(&binding.body)? else {
                return Err(RuntimeError::Input(
                    "schedule binding did not return arguments".into(),
                ));
            };
            binder.assert_bounds()?;
            if !matches!(bound.field("enabled")?, Value::Bool(true)) {
                return Ok(json!({"state":"skipped","reason":"predicate false"}));
            }
            let args = bound.field("args")?.as_object()?.clone();
            validate_inputs(&self.schema, target, &args)?;
            if target.kind == ProgramKind::Job {
                // The deterministic run id binds the entire occurrence, including its anchored period.
                let id = format!("job_timer_{}", digest(&occurrence));
                if let Some(existing) = crate::store_jobs::get(&tx, &id)? {
                    return Ok(json!({"state":"coalesced","job":existing.id}));
                }
                crate::store_jobs::enqueue(
                    &tx,
                    &self.schema,
                    target,
                    certificate,
                    args,
                    id.clone(),
                    format!("timer:{}", timer.id),
                    now,
                    None,
                )?;
                trace.writes.insert("_jobs".into(), 1);
                return Ok(json!({"state":"queued","job":id}));
            }
            context.args = args;
            validate_asset_inputs(&tx, target, &context)?;
            let mut runner = Runner::new(
                &tx,
                &self.schema,
                certificate,
                context,
                &self.verdicts,
                &self.authority_absences,
                self.rule_authority,
                seq,
            );
            runner.statements(&target.body)?;
            runner.check_final_constraints()?;
            // Settlement is certified alongside any timer-index writes made by the target.
            *runner.trace.writes.entry("_timers".into()).or_default() += 1;
            runner.assert_bounds()?;
            trace = runner.trace;
            Ok(json!({"state":"committed"}))
        })();
        let outcome = match attempted {
            Ok(outcome) => {
                tx.execute_batch("RELEASE schedule_target")?;
                outcome
            }
            Err(error) => {
                let Some(code) = mutation_rejection_code(&error) else {
                    return Err(error);
                };
                tx.execute_batch("ROLLBACK TO schedule_target; RELEASE schedule_target")?;
                trace = AuthoritativeTrace::default();
                json!({"state":"rejected","code":code,"family":if code=="E_CONSTRAINT" {"constraint"} else if matches!(code,"E_FANOUT"|"E_STEPS"|"E_TRACE_SUBSET") {"bound"} else {"input"},
                    "site":schedule.site,"message":error.to_string(),"rewrite":"fix the target or data, then run the target --as system","guide":"schedule"})
            }
        };
        if let Trigger::Every { duration_ms } = schedule.trigger {
            timer.period_start = Some(scheduled_at);
            timer.at = scheduled_at.saturating_add(duration_ms);
            crate::store_timers::save(&tx, &timer)?;
        } else {
            tx.execute("DELETE FROM _timers WHERE id=?1", [&timer.id])?;
        }
        trace.writes.entry("_timers".into()).or_insert(1);
        let firing = Firing {
            timer: timer.id,
            schedule: schedule.name.clone(),
            target: target.name.clone(),
            occurrence,
            row_id: timer.row_id,
            period_start: start,
            scheduled_at,
            fired_at: now,
            lateness_ms: now.saturating_sub(scheduled_at).max(0),
            skipped,
            outcome,
        };
        append_commit(
            &tx,
            &CommitRecord {
                seq,
                at: now,
                program: target.name.clone(),
                principal: crate::SYSTEM_PRINCIPAL_ID.to_owned(),
                kind: "schedule".into(),
                by: None,
                job: None,
                job_chunk: None,
                schedule: Some(firing.clone()),
                touched: trace.touched,
                writes: trace.writes,
                emits: trace.emits.len() as u64,
            },
        )?;
        #[cfg(test)]
        if FAIL_BEFORE_SETTLE.with(|fail| fail.replace(false)) {
            return Err(RuntimeError::Input(
                "simulated timer crash before commit".into(),
            ));
        }
        tx.commit()?;
        Ok(TimerOutcome { firing, seq })
    }
}
#[cfg(test)]
thread_local! {static FAIL_BEFORE_SETTLE:std::cell::Cell<bool>=const {std::cell::Cell::new(false)};}

#[cfg(test)]
mod tests {
    use crate::timers::{Schedule, Trigger};
    use crate::*;
    use std::collections::BTreeMap;

    fn runtime(target: &str) -> Runtime {
        let index = || {
            BTreeMap::from([(
                "byId".to_owned(),
                Index {
                    columns: vec!["id".into()],
                    unique: true,
                },
            )])
        };
        let items = public_table(
            BTreeMap::from([
                ("id".to_owned(), ColumnType::Id),
                (
                    "at".to_owned(),
                    ColumnType::Optional(Box::new(ColumnType::Time)),
                ),
                ("n".to_owned(), ColumnType::Int),
            ]),
            index(),
        );
        let log = public_table(
            BTreeMap::from([
                ("id".to_owned(), ColumnType::Id),
                ("item".to_owned(), ColumnType::Id),
            ]),
            index(),
        );
        let program = |name: &str, kind, args: Vec<(&str, ArgType)>, body| Program {
            name: name.into(),
            kind,
            args: args.into_iter().map(|(k, v)| (k.into(), v)).collect(),
            read_time_granularity_ms: None,
            result_page_site: None,
            body,
        };
        let row = |name: &str| Expr::Field {
            base: Box::new(Expr::Variable("row".into())),
            name: name.into(),
        };
        let purge = program(
            "admin.purge",
            ProgramKind::Mutation,
            vec![("id", ArgType::Id)],
            vec![
                Stmt::Insert {
                    table: "log".into(),
                    row: Expr::Object(BTreeMap::from([
                        ("id".into(), Expr::Input(Input::NewId)),
                        ("item".into(), Expr::Variable("id".into())),
                    ])),
                },
                Stmt::Delete {
                    table: "items".into(),
                    key: Expr::Variable("id".into()),
                },
                Stmt::Return(Expr::Literal(Value::Null)),
            ],
        );
        let sweep = program(
            "admin.sweep",
            ProgramKind::Job,
            vec![],
            vec![Stmt::For {
                binding: "row".into(),
                domain: LoopDomain::Page(Scan {
                    site: "sweep".into(),
                    table: "items".into(),
                    index: "byId".into(),
                    prefix: vec![],
                    order: Order::Asc,
                    take: Bound::Literal(100),
                    after: None,
                    before: None,
                    range: None,
                    opaque_cursor: false,
                    merge_site: None,
                    provenance: KeyProvenance::Const,
                }),
                body: vec![Stmt::Update {
                    table: "items".into(),
                    key: row("id"),
                    patch: Expr::Object(BTreeMap::from([(
                        "n".into(),
                        Expr::Binary {
                            op: BinaryOp::Add,
                            left: Box::new(row("n")),
                            right: Box::new(Expr::Literal(Value::Int(1))),
                        },
                    )])),
                }],
            }],
        );
        let job = target == "admin.sweep";
        let binding = program(
            "admin._timerBinding_expire",
            ProgramKind::Query,
            if job {
                vec![]
            } else {
                vec![("id", ArgType::Id)]
            },
            vec![Stmt::Return(Expr::Object(BTreeMap::from([
                ("enabled".into(), Expr::Literal(Value::Bool(true))),
                (
                    "args".into(),
                    Expr::Object(if job {
                        BTreeMap::new()
                    } else {
                        BTreeMap::from([("id".to_owned(), Expr::Variable("id".into()))])
                    }),
                ),
            ])))],
        );
        let schema = Schema {
            tables: BTreeMap::from([("items".to_owned(), items), ("log".to_owned(), log)]),
            schedules: vec![Schedule {
                name: "expire".into(),
                trigger: Trigger::Row {
                    table: "items".into(),
                    column: "at".into(),
                },
                target: target.into(),
                binding: "admin._timerBinding_expire".into(),
                site: "snapback/admin.q:1:1".into(),
            }],
            ..Schema::default()
        };
        let generation = Generation::certify(
            &ProjectJson {
                version: 1,
                auth: schema.auth.clone(),
                schema,
                programs: vec![purge, sweep, binding],
                effects: vec![],
            },
            Ceilings::default(),
        )
        .unwrap();
        let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
        runtime
            .seed(&[(
                "items".to_owned(),
                object([
                    ("id", Value::Id("a".into())),
                    ("at", Value::Int(5)),
                    ("n", Value::Int(0)),
                ]),
            )])
            .unwrap();
        runtime
    }

    // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — firing and settlement are one commit: a crash between them leaves no trace and the retry is the first attempt.
    #[test]
    fn a_crash_between_execute_and_settle_leaves_nothing_and_the_retry_fires_exactly_once() {
        for target in ["admin.purge", "admin.sweep"] {
            let mut rt = runtime(target);
            let before = rt.store().commit_seq().unwrap();
            let armed = rt.store().due_timers(5, 64).unwrap();
            assert_eq!(armed.len(), 1);
            super::FAIL_BEFORE_SETTLE.with(|fail| fail.set(true));
            let crashed = rt.fire_due_at(64, 7).unwrap_err();
            assert!(
                crashed.to_string().contains("simulated timer crash"),
                "{crashed}"
            );
            assert!(
                !super::FAIL_BEFORE_SETTLE.with(|fail| fail.get()),
                "the hook fires once"
            );
            assert_eq!(
                rt.store().commit_seq().unwrap(),
                before,
                "{target}: nothing committed"
            );
            assert_eq!(
                rt.store().due_timers(7, 64).unwrap(),
                armed,
                "{target}: the timer is still due"
            );
            assert!(
                rt.store().jobs(100).unwrap().is_empty(),
                "{target}: no enqueue survived"
            );
            assert_eq!(
                rt.store().timer_trace(&armed[0].id).unwrap()["firings"]
                    .as_array()
                    .unwrap()
                    .len(),
                0
            );
            let fired = rt.fire_due_at(64, 8).unwrap();
            assert_eq!(fired.len(), 1, "{target}");
            assert_eq!(fired[0].seq, before + 1);
            let state = fired[0].firing.outcome["state"].as_str().unwrap();
            assert_eq!(
                state,
                if target == "admin.sweep" {
                    "queued"
                } else {
                    "committed"
                },
                "{target}"
            );
            assert!(
                rt.store().due_timers(i64::MAX, 64).unwrap().is_empty(),
                "{target}: settled"
            );
            assert_eq!(
                rt.store().jobs(100).unwrap().len(),
                usize::from(target == "admin.sweep"),
                "{target}: exactly one enqueue"
            );
            assert!(rt.fire_due_at(64, 9).unwrap().is_empty());
            assert_eq!(rt.store().schedule_receipt().unwrap()["fired"], 1);
        }
    }
}
