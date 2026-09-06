use super::*;

impl Engine {
    // @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — only this entry constructs an operator context; attribution commits with writes.
    pub(crate) fn execute_operator(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        args: BTreeMap<String, Value>,
        by: String,
        now: i64,
        new_ids: VecDeque<String>,
    ) -> Result<Execution, RuntimeError> {
        let mut context = Context::system();
        context.args = args;
        context.operator_by = Some(by);
        context.now = Some(now);
        context.read_time = Some(now);
        context.new_ids = new_ids;
        // Input failures precede execution; the in-body path owns rejections and
        // their traces. Never replace execute_with_kind failures with an empty trace.
        validate_inputs(&self.schema, program, &context.args)?;
        self.execute_with_kind(program, certificate, context, Some("operator"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::certificate::{Ceilings, Checker};

    #[test]
    fn system_range_exhausts_examined_ceiling_and_reports_capped() {
        let mut table = public_table(
            BTreeMap::from([("id".into(), ColumnType::Id)]),
            BTreeMap::from([(
                "byId".into(),
                Index {
                    columns: vec!["id".into()],
                    unique: true,
                },
            )]),
        );
        table.rules.read = RuleExpr::Deny;
        let schema = Schema {
            tables: BTreeMap::from([("records".into(), table)]),
            ..Schema::default()
        };
        let mut engine = Engine::memory(schema.clone()).unwrap();
        for i in 0..7 {
            engine
                .seed("records", object([("id", Value::Id(format!("r{i}")))]))
                .unwrap();
        }
        let query = Program {
            name: "ceiling".into(),
            kind: ProgramKind::Query,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Return(Expr::Scan(Scan {
                site: "records.range".into(),
                table: "records".into(),
                index: "byId".into(),
                prefix: vec![],
                order: Order::Asc,
                take: Bound::Literal(10),
                after: None,
                before: None,
                range: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: KeyProvenance::Const,
            }))],
        };
        let mut certificate = Checker::new(&schema, Ceilings::default())
            .check(&query)
            .unwrap();
        let admitted = certificate.max_examined;
        // Normal certification refuses ceilings below take + 2. Lower the bound
        // at this private engine seam to isolate runtime clamping, not admission.
        certificate.max_examined = 5;
        let capped = engine
            .execute_operator(
                &query,
                &certificate,
                BTreeMap::new(),
                "alice".into(),
                1,
                VecDeque::new(),
            )
            .unwrap();
        assert_eq!(capped.state, ExecutionState::Capped);
        assert_eq!(capped.trace.examined, 5);
        assert_eq!(capped.trace.ranges[0].examined_ids.len(), 5);
        assert_eq!(capped.trace.ranges[0].stop, StopReason::Limit);
        assert_eq!(capped.trace.rule_probes, 0);
        assert_eq!(capped.result.as_array().unwrap().len(), 5);
        // Raising only that bound exhausts the same seven rows below take (10).
        certificate.max_examined = admitted;
        let complete = engine
            .execute_operator(
                &query,
                &certificate,
                BTreeMap::new(),
                "alice".into(),
                1,
                VecDeque::new(),
            )
            .unwrap();
        assert_eq!(complete.state, ExecutionState::Complete);
        assert_eq!(complete.trace.examined, 7);
        assert_eq!(complete.trace.ranges[0].stop, StopReason::Exhausted);
        assert_eq!(complete.result.as_array().unwrap().len(), 7);
    }

    #[test]
    fn system_operator_still_rejects_trace_subset_overruns_and_append_only_deletes() {
        let mut table = public_table(
            BTreeMap::from([("id".into(), ColumnType::Id)]),
            BTreeMap::from([(
                "byId".into(),
                Index {
                    columns: vec!["id".into()],
                    unique: true,
                },
            )]),
        );
        table.rules.insert = RuleExpr::Deny;
        table.rules.delete = RuleExpr::Deny;
        table.constraints.push(Constraint::AppendOnly);
        let schema = Schema {
            tables: BTreeMap::from([("records".into(), table)]),
            ..Schema::default()
        };
        let mut engine = Engine::memory(schema.clone()).unwrap();
        let insert = Program {
            name: "insert".into(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Insert {
                table: "records".into(),
                row: Expr::Literal(object([("id", Value::Id("r1".into()))])),
            }],
        };
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&insert)
            .unwrap();
        let mut mismatched = certificate.clone();
        mismatched.plan_hash = "wrong".into();
        assert!(
            matches!(
                engine.execute_operator(
                    &insert,
                    &mismatched,
                    BTreeMap::new(),
                    "alice".into(),
                    1,
                    VecDeque::new()
                ),
                Err(RuntimeError::TraceSubset(_))
            ),
            "pre-execution errors must not be wrapped as an empty rejected trace"
        );
        let mut too_small = certificate.clone();
        too_small.write_sites[0].max_rows = 0;
        let rejected = engine
            .execute_operator(
                &insert,
                &too_small,
                BTreeMap::new(),
                "alice".into(),
                1,
                VecDeque::new(),
            )
            .unwrap();
        assert!(
            matches!(rejected.state, ExecutionState::Rejected { ref code, .. } if code == "bound")
        );
        assert_eq!(rejected.trace.writes["records"], 1);
        assert_eq!(
            rejected.trace.last_write_attempt.as_ref().unwrap().max_rows,
            0
        );
        assert_eq!(
            rejected.trace.last_write_attempt.as_ref().unwrap().table,
            "records"
        );
        assert_eq!(engine.store().commit_seq().unwrap(), 0);
        assert!(engine.rows("records").unwrap().is_empty());
        let accepted = engine
            .execute_operator(
                &insert,
                &certificate,
                BTreeMap::new(),
                "alice".into(),
                2,
                VecDeque::new(),
            )
            .unwrap();
        assert!(matches!(accepted.state, ExecutionState::Committed { .. }));
        let delete = Program {
            name: "delete".into(),
            body: vec![Stmt::Delete {
                table: "records".into(),
                key: Expr::Literal(Value::Id("r1".into())),
            }],
            ..insert
        };
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&delete)
            .unwrap();
        let rejected = engine
            .execute_operator(
                &delete,
                &certificate,
                BTreeMap::new(),
                "alice".into(),
                3,
                VecDeque::new(),
            )
            .unwrap();
        assert!(
            matches!(rejected.state, ExecutionState::Rejected { ref code, .. } if code == "E_CONSTRAINT")
        );
        assert_eq!(engine.store().commit_seq().unwrap(), 1);
        assert_eq!(engine.rows("records").unwrap().len(), 1);
    }
}
