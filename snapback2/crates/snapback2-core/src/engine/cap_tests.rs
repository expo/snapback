use super::*;
use crate::{Ceilings, Checker, Constraint, Index, public_table};

#[test]
fn refusing_cap_probe_is_charged_before_returning_constraint_error() {
    let mut table = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            (
                "group".into(),
                ColumnType::Optional(Box::new(ColumnType::Id)),
            ),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    columns: vec!["id".into()],
                    unique: true,
                },
            ),
            (
                "byGroup".into(),
                Index {
                    columns: vec!["group".into(), "id".into()],
                    unique: false,
                },
            ),
        ]),
    );
    table.constraints.push(Constraint::Cap {
        by: vec!["group".into()],
        max: 50,
    });
    let schema = Schema {
        tables: BTreeMap::from([("memberships".into(), table)]),
        ..Schema::default()
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for n in 0..50 {
        engine
            .seed(
                "memberships",
                crate::object([("id", Value::Id(format!("m{n}")))]),
            )
            .unwrap();
    }
    let program = Program {
        name: "cap.refusing".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        result_page_site: None,
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "memberships".into(),
            row: Expr::Literal(crate::object([("id", Value::Id("over".into()))])),
        }],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let tx = engine.store.conn.transaction().unwrap();
    let mut runner = Runner::new(
        &tx,
        &schema,
        &certificate,
        Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
        &[],
        &[],
        RuleAuthority::StoreAuthoritative,
        1,
    );
    assert_eq!(
        runner.statements(&program.body).unwrap_err().code(),
        "E_CONSTRAINT"
    );
    assert_eq!(runner.trace.examined, 50);
    assert_eq!(
        runner
            .trace
            .constraint_inputs
            .iter()
            .find(|c| c.check.starts_with("Cap("))
            .unwrap()
            .examined_ids
            .len(),
        50
    );
    runner.assert_bounds().unwrap();
}
