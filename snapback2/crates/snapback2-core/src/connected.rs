//! The virtual catalog entry has no durable rows or application-authored rules.
// @ref LLP 1001#51-connected — only program point reads expose the live registry.
use crate::schema::{ColumnType, Index, RetentionPolicy, RuleExpr, Rules, Table};
use std::collections::BTreeMap;
use std::sync::LazyLock;

pub const CONNECTED_TABLE: &str = "_connected";
pub const CONNECTED_INDEX: &str = "byPrincipal";

pub(crate) static TABLE: LazyLock<Table> = LazyLock::new(|| Table {
    columns: BTreeMap::from([
        ("id".to_owned(), ColumnType::Id),
        ("principal".to_owned(), ColumnType::Principal),
        ("value".to_owned(), ColumnType::Int),
    ]),
    indexes: BTreeMap::from([(
        CONNECTED_INDEX.to_owned(),
        Index {
            columns: vec!["principal".to_owned()],
            unique: true,
        },
    )]),
    rules: Rules {
        read: RuleExpr::Allow,
        insert: RuleExpr::Deny,
        update: RuleExpr::Deny,
        delete: RuleExpr::Deny,
    },
    constraints: vec![],
    retain: RetentionPolicy::UntilRevoked,
});

impl crate::Runtime {
    /// Called only by the owner between transaction turns.
    pub fn set_connected(&mut self, counts: BTreeMap<String, u64>) {
        self.engine.set_connected(counts);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::*;

    fn read() -> Read {
        Read {
            site: "connected".into(),
            table: CONNECTED_TABLE.into(),
            index: CONNECTED_INDEX.into(),
            key: vec![Expr::Input(Input::Viewer)],
            provenance: KeyProvenance::Viewer,
        }
    }
    fn program(value: Expr) -> Program {
        Program {
            name: "online".into(),
            kind: ProgramKind::Query,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            result_page_site: None,
            body: vec![Stmt::Return(value)],
        }
    }
    fn context() -> Context {
        Context::query(Actor::user("alice").unwrap(), BTreeMap::new())
    }

    #[test]
    fn virtual_reads_trace_one_probe_and_never_issue_row_or_absence_custody() {
        let schema = Schema::default();
        let program = program(Expr::Get(read()));
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        assert_eq!(certificate.max_rule_probes, 1);
        assert_eq!(
            (certificate.max_examined, certificate.max_index_entries),
            (0, 0)
        );
        let mut engine = Engine::memory(schema).unwrap();
        for count in [0, 2, 1, 0] {
            engine.set_connected(BTreeMap::from([("alice".into(), count)]));
            let execution = engine.execute(&program, &certificate, context()).unwrap();
            if count == 0 {
                assert_eq!(execution.result, Value::Null);
            } else {
                assert_eq!(
                    execution.result.field("value").unwrap(),
                    &Value::Int(count as i64)
                );
            }
            assert_eq!(execution.trace.rule_probes, 1);
            let [point] = execution.trace.points.as_slice() else {
                panic!("expected one point")
            };
            assert_eq!(
                (&*point.table, &*point.index, &point.key),
                (
                    CONNECTED_TABLE,
                    CONNECTED_INDEX,
                    &vec![Value::Id("alice".into())]
                )
            );
            assert!(
                execution.receipt.rows.is_empty()
                    && execution.receipt.absences.is_empty()
                    && execution.receipt.verdicts.is_empty()
            );
        }
    }

    #[test]
    fn execute_uses_one_immutable_snapshot_and_next_execute_refreshes_it() {
        let schema = Schema::default();
        let query = program(Expr::Array(vec![
            Expr::Get(read()),
            Expr::Get(read()),
            Expr::Exists(read()),
        ]));
        let checker = Checker::new(&schema, Ceilings::default());
        let certificate = checker.check(&query).unwrap();
        let mut mutation = program(Expr::Literal(Value::Null));
        mutation.kind = ProgramKind::Mutation;
        let paired = checker.check_pair(&query, &mutation).unwrap();
        assert_eq!(paired.prediction_sites[0].mode, PredictionMode::Partial);
        let mut engine = Engine::memory(schema).unwrap();
        let context = context();
        let mut results = Vec::new();
        for count in [1, 2, 0] {
            // Engine exclusively borrows itself for execute: owner actions can
            // only replace the snapshot between runs, never halfway through one.
            engine.set_connected(BTreeMap::from([("alice".into(), count)]));
            let execution = engine
                .execute(&query, &certificate, context.clone())
                .unwrap();
            let Value::Array(values) = &execution.result else {
                panic!("array result")
            };
            assert_eq!(values[0], values[1]);
            assert_eq!(values[2], Value::Bool(count > 0));
            if count > 0 {
                assert_eq!(values[0].field("value").unwrap(), &Value::Int(count as i64));
            } else {
                assert_eq!(values[0], Value::Null);
            }
            results.push(execution.result);
        }
        assert_ne!(results[0], results[1]);
        assert_ne!(results[1], results[2]);
    }

    #[test]
    fn raw_ir_refuses_nonprincipal_keys_scans_writes_and_rule_probes() {
        let schema = Schema::default();
        let checker = Checker::new(&schema, Ceilings::default());
        for key in [
            vec![],
            vec![Expr::Literal(Value::Null)],
            vec![Expr::Literal(Value::Id("alice".into()))],
            vec![Expr::Literal(Value::String("alice".into()))],
            vec![Expr::Input(Input::Viewer); 2],
        ] {
            let mut read = read();
            read.key = key;
            assert!(checker.check(&program(Expr::Exists(read))).is_err());
        }
        let mut read = read();
        read.index = "byId".into();
        assert!(checker.check(&program(Expr::Get(read))).is_err());
        assert!(
            checker
                .check(&program(Expr::Scan(Scan {
                    site: "scan".into(),
                    table: CONNECTED_TABLE.into(),
                    index: CONNECTED_INDEX.into(),
                    prefix: vec![Expr::Input(Input::Viewer)],
                    order: Order::Asc,
                    take: Bound::Literal(1),
                    after: None,
                    before: None,
                    range: None,
                    opaque_cursor: false,
                    merge_site: None,
                    provenance: KeyProvenance::Viewer,
                })))
                .is_err()
        );
        let mut write = program(Expr::Literal(Value::Null));
        write.kind = ProgramKind::Mutation;
        write.body.insert(
            0,
            Stmt::Delete {
                table: CONNECTED_TABLE.into(),
                key: Expr::Input(Input::Viewer),
            },
        );
        assert!(checker.check(&write).is_err());
        let rule = RuleExpr::Exists {
            table: CONNECTED_TABLE.into(),
            index: CONNECTED_INDEX.into(),
            key: vec![RuleTerm::Viewer],
            provenance: KeyProvenance::Viewer,
        };
        let mut schema = schema;
        let mut table = TABLE.clone();
        table.rules.read = rule;
        schema.tables.insert("notes".into(), table);
        assert!(!crate::rule_types::check(&schema).is_empty());
    }
}
