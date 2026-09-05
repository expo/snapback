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
        let result = validate_inputs(&self.schema, program, &context.args)
            .and_then(|()| self.execute_with_kind(program, certificate, context, Some("operator")));
        match result {
            Err(error) if program.kind == ProgramKind::Mutation => {
                if let Some(code) = mutation_rejection_code(&error) {
                    self.empty_execution(ExecutionState::Rejected {
                        code: code.to_owned(),
                        message: error.to_string(),
                    })
                } else {
                    Err(error)
                }
            }
            result => result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::certificate::{Ceilings, Checker};

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
            result_page_site: None,
            body: vec![Stmt::Insert {
                table: "records".into(),
                row: Expr::Literal(object([("id", Value::Id("r1".into()))])),
            }],
        };
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&insert)
            .unwrap();
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
