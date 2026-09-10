//! LLP 1019 P0 only. Fixed declaration, no production schema/grammar changes.
//! The optional marker encodes the prototype's historical audience bound.
// @ref LLP 1019#mechanism-to-be-settled-by-a-prototype-before-d1 — compare executable representations before choosing one.
use super::*;
use crate::certificate::{Ceilings, Checker, WriteKind};
use serde_json::json;

pub(crate) fn bound(schema: &Schema, table: &str, kind: WriteKind) -> u64 {
    if table != "messages" || matches!(kind, WriteKind::Update | WriteKind::Emit) {
        return 0;
    }
    let historical = match schema
        .table("deliveries")
        .and_then(|t| t.columns.get("p0Native"))
    {
        Some(ColumnType::Optional(inner)) => match **inner {
            ColumnType::Text { max } => u64::from(max),
            _ => 0,
        },
        _ => 0,
    };
    if historical == 0 {
        return 0;
    }
    let current = schema
        .table("memberships")
        .unwrap()
        .constraints
        .iter()
        .find_map(|c| match c {
            Constraint::Cap { max, .. } => Some(u64::from(*max)),
            _ => None,
        })
        .unwrap();
    if kind == WriteKind::Insert {
        current
    } else {
        historical.max(current)
    }
}

impl Runner<'_> {
    pub(super) fn deliver_native(
        &mut self,
        table: &str,
        old: Option<&Value>,
        new: Option<&Value>,
    ) -> Result<(), RuntimeError> {
        if self.rule_authority != RuleAuthority::StoreAuthoritative {
            return Ok(());
        }
        let kind = if old.is_none() {
            WriteKind::Insert
        } else if new.is_none() {
            WriteKind::Delete
        } else {
            return Ok(());
        };
        let cap = bound(self.schema, table, kind);
        if cap == 0 {
            return Ok(());
        }
        let message = new.or(old).unwrap();
        let (target, index, key, event) = if old.is_none() {
            (
                "memberships",
                "byConversationPrincipal",
                message.field("conversationId")?,
                "delivered",
            )
        } else {
            ("deliveries", "byRow", message.field("id")?, "removed")
        };
        let target_schema = self.schema.table(target).unwrap();
        let rows = scan_indexed(
            self.tx,
            target,
            index,
            target_schema,
            target_schema.index(index).unwrap(),
            &[key.clone()],
            None,
            None,
            None,
            Order::Asc,
            cap as usize + 1,
        )?;
        // P0 intentionally refuses event histories larger than A: the RFC's
        // all-kind byRow cannot certify repeated edits in A examined rows.
        if rows.len() as u64 > cap {
            return Err(RuntimeError::Input(
                "P0: byRow exceeds audience reserve; need delivered-only index".into(),
            ));
        }
        self.trace.examined += rows.len() as u64;
        self.step(rows.len() as u64 * 5)?;
        let mut recipients = BTreeMap::new();
        for row in rows {
            if event == "removed" && row.field("kind")?.as_str()? != "delivered" {
                continue;
            }
            let recipient = row
                .field(if event == "delivered" {
                    "principal"
                } else {
                    "recipient"
                })?
                .as_str()?
                .to_owned();
            let incarnation = if event == "delivered" {
                self.seq as i64
            } else {
                row.field("incarnation")?.as_int()?
            };
            recipients.insert(recipient, incarnation);
        }
        let audience = recipients.len() as i64;
        for (recipient, incarnation) in recipients {
            let row = event_row(
                message,
                &recipient,
                event,
                incarnation,
                audience,
                self.seq as i64,
                self.context.now.unwrap_or(0),
            );
            // Engine-owned block only. Restore the actor even when validation fails.
            let viewer = self.context.viewer.clone();
            self.context.viewer = Context::system().viewer;
            let written = self.insert("deliveries", row);
            self.context.viewer = viewer;
            written?;
        }
        Ok(())
    }
}

pub(super) fn event_row(
    message: &Value,
    recipient: &str,
    kind: &str,
    incarnation: i64,
    audience: i64,
    seq: i64,
    at: i64,
) -> Value {
    object([
        (
            "id",
            Value::Id(digest(&(
                message.field("id").unwrap(),
                recipient,
                kind,
                seq,
            ))),
        ),
        ("row", message.field("id").unwrap().clone()),
        (
            "conversationId",
            message.field("conversationId").unwrap().clone(),
        ),
        ("recipient", Value::Id(recipient.into())),
        ("kind", Value::String(kind.into())),
        ("incarnation", Value::Int(incarnation)),
        ("audience", Value::Int(audience)),
        ("seq", Value::Int(seq)),
        ("at", Value::Int(at)),
    ])
}

pub(super) fn schema(native: bool, cap: u32) -> Schema {
    let index = |columns: &[&str], unique: bool| {
        json!({
            "components": columns.iter().map(|c| json!({"Column": c})).collect::<Vec<_>>(), "unique": unique,
        })
    };
    let table = |columns: serde_json::Value, indexes: serde_json::Value| {
        json!({
            "columns": columns, "indexes": indexes,
            "rules": {"read":"Allow", "insert":"Allow", "update":"Allow", "delete":"Allow"},
            "constraints": [], "retain":"until-revoked",
        })
    };
    let mut s = json!({"tables": {
        "conversations": table(json!({"id":"Id"}), json!({"byId":index(&["id"],true)})),
        "memberships": table(json!({"id":"Id", "conversationId":{"Ref":{"table":"conversations"}}, "principal":"Principal"}),
            json!({"byId":index(&["id"],true), "byConversationPrincipal":index(&["conversationId","principal"],false)})),
        // Copy of chat's text message lane; assets/search are orthogonal to P0.
        "messages": table(json!({"id":"Id", "conversationId":{"Ref":{"table":"conversations"}}, "authorId":"Principal",
            "body":{"Optional":{"Text":{"max":4000}}}, "at":"Time", "expiresAt":{"Optional":"Time"}}),
            json!({"byId":index(&["id"],true), "byConvTime":index(&["conversationId","at","id"],false)})),
        "deliveries": table(json!({"id":"Id", "recipient":"Principal", "row":{"Ref":{"table":"messages"}},
            "conversationId":{"Ref":{"table":"conversations"}}, "kind":{"Enum":{"variants":["delivered","removed","changed"]}},
            "incarnation":"Int", "audience":"Int", "seq":"Int", "at":"Time"}),
            json!({"byId":index(&["id"],true), "byRecipient":index(&["recipient","seq","id"],false),
                "byRecipientGroup":index(&["recipient","conversationId","kind","seq","id"],false),
                "byRow":index(&["row","recipient"],false)})),
    }});
    s["tables"]["memberships"]["constraints"] =
        json!([{"Cap":{"by":["conversationId"],"max":cap}}]);
    s["tables"]["messages"]["retain"] = json!("delivered-history");
    s["tables"]["messages"]["rules"]["insert"] = json!({"Eq":[{"Field":"authorId"},"Viewer"]});
    s["tables"]["messages"]["rules"]["delete"] = json!({"Eq":[{"Field":"authorId"},"Viewer"]});
    s["tables"]["deliveries"]["rules"] = json!({
        "read":{"Eq":[{"Field":"recipient"},"Viewer"]}, "insert":"Deny", "update":"Deny", "delete":"Deny",
    });
    if native {
        s["tables"]["deliveries"]["columns"]["p0Native"] = json!({"Optional":{"Text":{"max":cap}}});
    }
    serde_json::from_value(s).unwrap()
}

pub(super) fn member(id: &str, principal: &str) -> Value {
    object([
        ("id", Value::Id(id.into())),
        ("conversationId", Value::Id("c".into())),
        ("principal", Value::Id(principal.into())),
    ])
}

pub(super) fn message(id: &str) -> Value {
    object([
        ("id", Value::Id(id.into())),
        ("conversationId", Value::Id("c".into())),
        ("authorId", Value::Id("alice".into())),
        ("body", Value::String("hello".into())),
        ("at", Value::Int(10)),
        ("expiresAt", Value::Null),
    ])
}

pub(super) fn program(name: &str, body: Vec<Stmt>) -> Program {
    Program {
        name: name.into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body,
    }
}

pub(super) fn insert(id: &str) -> Stmt {
    Stmt::Insert {
        table: "messages".into(),
        row: Expr::Literal(message(id)),
    }
}

pub(super) fn delete(id: &str) -> Stmt {
    Stmt::Delete {
        table: "messages".into(),
        key: Expr::Literal(Value::Id(id.into())),
    }
}

pub(super) fn recipients(engine: &Engine, kind: &str) -> Vec<String> {
    let mut rows: Vec<_> = engine
        .rows("deliveries")
        .unwrap()
        .into_iter()
        .filter(|r| r.field("kind").unwrap().as_str().unwrap() == kind)
        .map(|r| r.field("recipient").unwrap().as_str().unwrap().to_owned())
        .collect();
    rows.sort();
    rows
}

pub(super) fn execute(engine: &mut Engine, p: &Program) -> Result<Execution, RuntimeError> {
    let cert = Checker::new(&engine.schema, Ceilings::default())
        .check(p)
        .unwrap();
    engine.execute(
        p,
        &cert,
        Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
    )
}

pub(super) fn populated(native: bool) -> Engine {
    let mut e = Engine::memory(schema(native, 3)).unwrap();
    e.seed("memberships", member("a", "alice")).unwrap();
    e.seed("memberships", member("b", "bob")).unwrap();
    e
}

#[test]
fn native_insert_delete_original_audience() {
    let mut e = populated(true);
    execute(&mut e, &program("send", vec![insert("m")])).unwrap();
    println!("native delivered={:?}", recipients(&e, "delivered"));
    assert_eq!(recipients(&e, "delivered"), ["alice", "bob"]);
    execute(
        &mut e,
        &program(
            "leave",
            vec![Stmt::Delete {
                table: "memberships".into(),
                key: Expr::Literal(Value::Id("b".into())),
            }],
        ),
    )
    .unwrap();
    e.seed("memberships", member("c", "carol")).unwrap();
    execute(&mut e, &program("unsend", vec![delete("m")])).unwrap();
    println!("native removed={:?}", recipients(&e, "removed"));
    assert_eq!(recipients(&e, "removed"), ["alice", "bob"]);
}

#[test]
fn baseline_unexpanded_write_has_no_custody() {
    let mut e = populated(false);
    execute(&mut e, &program("send", vec![insert("m")])).unwrap();
    println!("baseline delivered={:?}", recipients(&e, "delivered"));
    assert!(recipients(&e, "delivered").is_empty());
}
