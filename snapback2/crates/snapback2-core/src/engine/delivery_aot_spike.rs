//! P0 AOT experiment: ordinary IR plus exact-expansion admission and a scoped
//! engine-authority block. Not a product trigger language or raw-schema surface.
// @ref LLP 1019#mechanism-to-be-settled-by-a-prototype-before-d1 — measure what ordinary IR still needs from the engine.
use super::delivery_spike::*;
use super::*;
use crate::certificate::{Ceilings, Certificate, Checker};
use serde_json::json;

const AUTHORITY: &str = "P0 generated delivery block";

fn field(name: &str) -> Expr {
    Expr::Field {
        base: Box::new(Expr::Variable("recipient".into())),
        name: name.into(),
    }
}

fn scan(deleting: bool, n: u32) -> Scan {
    serde_json::from_value(json!({
        "site":"p0.audience", "table":if deleting {"deliveries"} else {"memberships"},
        "index":if deleting {"byRow"} else {"byConversationPrincipal"},
        "prefix":[{"Scalar":{"Literal":{"Id":if deleting {"m"} else {"c"}}}}],
        "take":{"Literal":n}, "order":"Asc", "after":null,"before":null,"range":null,"provenance":"Const",
    })).unwrap()
}

/// Compiler prototype, over typed IR instead of a second Quarry parser.
/// Fixed content row and incarnation/sequence literals are explicit P0 limits.
fn expand(source: &Program, n: u32, seq: i64) -> Program {
    let mut expanded = source.clone();
    expanded.body = source
        .body
        .iter()
        .flat_map(|stmt| {
            let deleting = matches!(stmt, Stmt::Delete {table, ..} if table == "messages");
            if !deleting && !matches!(stmt, Stmt::Insert {table, ..} if table == "messages") {
                return vec![stmt.clone()];
            }
            let template = event_row(
                &message("m"),
                "alice",
                if deleting { "removed" } else { "delivered" },
                1,
                2,
                seq,
                0,
            );
            let mut fields: BTreeMap<_, _> = template
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), Expr::Literal(v.clone())))
                .collect();
            fields.insert("id".into(), Expr::Input(Input::NewId));
            fields.insert(
                "recipient".into(),
                field(if deleting { "recipient" } else { "principal" }),
            );
            if deleting {
                fields.insert("incarnation".into(), field("incarnation"));
            }
            let mut body = vec![Stmt::Insert {
                table: "deliveries".into(),
                row: Expr::Object(fields),
            }];
            if deleting {
                body = vec![Stmt::If {
                    condition: Expr::Binary {
                        op: BinaryOp::Eq,
                        left: Box::new(field("kind")),
                        right: Box::new(Expr::Literal(Value::String("delivered".into()))),
                    },
                    then_body: body,
                    else_body: vec![],
                }];
            }
            let generated = Stmt::If {
                condition: Expr::Binary {
                    op: BinaryOp::Eq,
                    left: Box::new(Expr::Literal(Value::String(AUTHORITY.into()))),
                    right: Box::new(Expr::Literal(Value::String(AUTHORITY.into()))),
                },
                then_body: vec![Stmt::For {
                    binding: "recipient".into(),
                    domain: LoopDomain::Page(scan(deleting, n)),
                    body,
                }],
                else_body: vec![],
            };
            vec![stmt.clone(), generated]
        })
        .collect();
    expanded
}

/// Scoped proof view is deliberately visible in the experiment. A read of all
/// original recipients needs engine authority and a delivered-only cap proof.
/// The all-kind byRow cap is valid for this insert/delete fixture only; it is
/// NOT a schema invariant and cannot be shipped as ordinary table metadata.
fn admit(
    schema: &Schema,
    source: &Program,
    expanded: &Program,
    n: u32,
    seq: i64,
) -> Result<Certificate, String> {
    if expand(source, n, seq) != *expanded {
        return Err("P0 admission: omitted or changed generated writes".into());
    }
    let mut proof = schema.clone();
    let log = proof.tables.get_mut("deliveries").unwrap();
    log.rules.read = RuleExpr::Allow;
    log.constraints.push(Constraint::Cap {
        by: vec!["row".into()],
        max: n,
    });
    let mut c = Checker::new(&proof, Ceilings::default())
        .check(expanded)
        .map_err(|e| e.to_string())?;
    c.schema_hash = schema.hash();
    Ok(c)
}

impl Runner<'_> {
    pub(super) fn p0_aot_block(&mut self, statement: &Stmt) -> Result<Option<Flow>, RuntimeError> {
        if self.rule_authority != RuleAuthority::StoreAuthoritative {
            return Ok(None);
        }
        if !self
            .schema
            .table("deliveries")
            .is_some_and(|t| t.columns.contains_key("p0Aot"))
        {
            return Ok(None);
        }
        let Stmt::If {
            condition:
                Expr::Binary {
                    op: BinaryOp::Eq,
                    left,
                    right,
                },
            then_body,
            else_body,
        } = statement
        else {
            return Ok(None);
        };
        if **left != Expr::Literal(Value::String(AUTHORITY.into()))
            || left != right
            || !else_body.is_empty()
        {
            return Ok(None);
        }
        let viewer = self.context.viewer.clone();
        self.context.viewer = Context::system().viewer;
        let result = self.statements(then_body);
        self.context.viewer = viewer;
        result.map(Some)
    }
}

#[test]
fn aot_insert_delete_and_exact_expansion_admission() {
    let mut s = schema(false, 3);
    s.tables.get_mut("deliveries").unwrap().columns.insert(
        "p0Aot".into(),
        ColumnType::Optional(Box::new(ColumnType::Bool)),
    );
    let mut e = Engine::memory(s.clone()).unwrap();
    e.seed("memberships", member("a", "alice")).unwrap();
    e.seed("memberships", member("b", "bob")).unwrap();
    for (seq, source) in [
        program("send", vec![insert("m")]),
        program("unsend", vec![delete("m")]),
    ]
    .into_iter()
    .enumerate()
    {
        let seq = seq as i64 + 1;
        let expanded = expand(&source, 3, seq);
        if seq == 2 {
            let refused = Checker::new(&s, Ceilings::default())
                .check(&expanded)
                .unwrap_err();
            println!("AOT ordinary-schema delete: {refused}");
            assert_eq!(refused.code, "E_STRUCTURAL_FANOUT");
        }
        let c = admit(&s, &source, &expanded, 3, seq).unwrap();
        println!(
            "AOT {} certificate: examined={} index={} writes={:?} steps={}",
            source.name, c.max_examined, c.max_index_entries, c.write_sites, c.max_steps
        );
        assert!(
            admit(&s, &source, &source, 3, seq)
                .unwrap_err()
                .contains("omitted")
        );
        let mut changed = expanded.clone();
        changed.body.pop();
        assert!(admit(&s, &source, &changed, 3, seq).is_err());
        let mut context = Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new());
        context.new_ids = (0..3).map(|i| format!("event-{seq}-{i}")).collect();
        e.execute(&expanded, &c, context).unwrap();
        if seq == 1 {
            assert_eq!(recipients(&e, "delivered"), ["alice", "bob"]);
            // Fixture churn without another commit keeps the literal seq witness honest.
            e.store
                .conn
                .execute(
                    "DELETE FROM rows WHERE table_name='memberships' AND row_id='b'",
                    [],
                )
                .unwrap();
            delete_index_row(&e.store.conn, "memberships", "b").unwrap();
            e.seed("memberships", member("c", "carol")).unwrap();
        }
    }
    println!(
        "AOT delivered={:?} removed={:?}",
        recipients(&e, "delivered"),
        recipients(&e, "removed")
    );
    assert_eq!(recipients(&e, "removed"), ["alice", "bob"]);
}
