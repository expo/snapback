use super::*;
use crate::ir::IndexKeyExpr;
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
        let custody_certificate = self.custody_certificate(certificate, false);
        let tx = self.store.conn.transaction()?;
        tx.execute_batch("SAVEPOINT schedule_target")?;
        let mut trace = AuthoritativeTrace::default();
        let attempted = (|| -> Result<serde_json::Value, RuntimeError> {
            let custody_certificate = custody_certificate?;
            let certificate = custody_certificate.as_ref();
            let mut context = Context::system();
            context.connected = self.connected.clone();
            context.now = Some(now);
            context.read_time = Some(now);
            context.new_ids = ids;
            match (&schedule.trigger, &timer.row_id) {
                (Trigger::Row { table, .. }, Some(id)) => {
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
                (Trigger::Every { .. }, None) => {
                    context.args.insert(
                        "periodStart".into(),
                        Value::Int(start.expect("period start")),
                    );
                    context
                        .args
                        .insert("periodEnd".into(), Value::Int(scheduled_at));
                }
                _ => {}
            }
            validate_inputs(&self.schema, binding, &context.args)?;
            let mut binder = Runner::new(
                &tx,
                &self.schema,
                &self.hashes,
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
                // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — the
                // deterministic id binds the occurrence, and only a job still queued or running
                // for it coalesces. A done, cancelled, or parked job is history, not the
                // occurrence in flight: the firing enqueues a fresh job under the next attempt
                // suffix, so a deadline cleared and restored after its job finished runs again.
                let base = format!("job_timer_{}", digest(&occurrence));
                let mut attempt = 0_u32;
                let id = loop {
                    let candidate = if attempt == 0 {
                        base.clone()
                    } else {
                        format!("{base}_{attempt}")
                    };
                    match crate::store_jobs::get(&tx, &candidate)? {
                        Some(existing)
                            if matches!(existing.state.as_str(), "queued" | "running") =>
                        {
                            return Ok(json!({"state":"coalesced","job":existing.id}));
                        }
                        Some(_) => attempt += 1,
                        None => break candidate,
                    }
                };
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
                &self.hashes,
                certificate,
                context,
                &self.verdicts,
                &self.authority_absences,
                self.rule_authority,
                seq,
            );
            runner.statements(&target.body)?;
            runner.check_final_constraints()?;
            #[cfg(test)]
            if let Some(code) = CEILING_FAULT.with(|fault| fault.replace(None)) {
                return Err(match code {
                    "E_STEPS" => RuntimeError::Steps(1),
                    "E_FANOUT" => RuntimeError::Fanout,
                    "E_TRACE_SUBSET" => RuntimeError::TraceSubset("injected schedule target trace mismatch".into()),
                    _ => unreachable!("test ceiling code"),
                });
            }
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
                // A ceiling keeps its own code (`E_STEPS`, `E_FANOUT`, `E_TRACE_SUBSET`) and the
                // family is the one every rejection envelope uses (`jobs::rejection_family`), so
                // `trace timer:` reads the same words `/api/mutation` and a parked chunk carry.
                let code = match &error {
                    RuntimeError::Steps(_)
                    | RuntimeError::Fanout
                    | RuntimeError::TraceSubset(_) => Some(error.code()),
                    error => mutation_rejection_code(error),
                };
                let Some(code) = code else {
                    return Err(error);
                };
                tx.execute_batch("ROLLBACK TO schedule_target; RELEASE schedule_target")?;
                trace = AuthoritativeTrace::default();
                let mut rejected = json!({"state":"rejected","code":code,"family":crate::jobs::rejection_family(code),
                    "site":error.require_site().unwrap_or_else(|| schedule.site.clone()),"message":error.to_string(),"rewrite":error.rewrite().unwrap_or_else(|| "fix the target or data, then run the target --as system".into()),"guide":"schedule"});
                if code == crate::delivery::INCARNATION {
                    rejected["site"] = json!(error.require_site());
                    rejected["guide"] = json!("deliver");
                }
                if code == "E_BOUND" { rejected["guide"] = json!("bound/ceiling"); }
                rejected
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
                scope_touches: trace.scope_touches,
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
thread_local! {static CEILING_FAULT:std::cell::Cell<Option<&'static str>>=const {std::cell::Cell::new(None)};}

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
                    components: (vec!["id".into()])
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
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
                    prefix: (vec![]).into_iter().map(IndexKeyExpr::Scalar).collect(),
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

    // @ref LLP 1016#7-diagnostics — a ceiling settles under its own code and the bound family,
    // the words `/api/mutation` and a parked chunk carry for the same fault.
    #[test]
    fn a_ceiling_rejection_settles_with_its_real_code_and_the_bound_family() {
        for code in ["E_STEPS", "E_FANOUT", "E_TRACE_SUBSET"] {
            let mut rt = runtime("admin.purge");
            // Certification is static, so a certified target cannot exceed its ceiling; the
            // injected post-target fault is the only way to exercise every settle envelope.
            super::CEILING_FAULT.with(|fault| fault.set(Some(code)));
            let fired = rt.fire_due_at(64, 7).unwrap();
            assert_eq!(fired.len(), 1);
            assert_eq!(super::CEILING_FAULT.with(|fault| fault.get()), None);
            let outcome = &fired[0].firing.outcome;
            assert_eq!(outcome["state"], "rejected");
            assert_eq!(outcome["code"], code);
            assert_eq!(outcome["family"], "bound");
            assert_eq!(outcome["guide"], "schedule");
            assert_eq!(outcome["site"], "snapback/admin.q:1:1");
            assert!(outcome["rewrite"].as_str().unwrap().contains("--as system"));
            assert!(outcome["message"].as_str().unwrap().starts_with(code));
            let commits = rt.store().commits_since(0, 100).unwrap();
            let commit = commits.iter().find(|c| c.kind == "schedule").unwrap();
            assert_eq!(&commit.schedule.as_ref().unwrap().outcome, outcome);
            assert!(commit.writes.get("log").is_none(), "the target rolled back");
            assert_eq!(rt.store().timer_status(7).unwrap()["rejected"], 1);
            assert!(
                rt.store().due_timers(i64::MAX, 64).unwrap().is_empty(),
                "a rejected row timer settles"
            );
        }
    }
}
