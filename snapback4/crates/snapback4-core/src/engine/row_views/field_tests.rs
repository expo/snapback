//! Every predicate-visible column compared with raw model facts at one clock.
use super::*;
use crate::schema::{ColumnType, Effect, Index, RuleExpr, RuleTerm, public_table};

pub(super) fn predicates(tx: &crate::store::Tx<'_>, schema: &Schema, c: Config, member: &Value,
    count: Option<i64>, now: i64, label: &str) -> usize {
    let mut comparisons = 0;
    for (field, kind) in &schema.tables["unread"].columns {
        if field == "recountPending" { continue; }
        let value = match field.as_str() {
            "member" | "id" => member.field("id").unwrap().clone(),
            "value" => Value::Int(count.unwrap_or(0)),
            "recountPending" => Value::Bool(false),
            other => member.field(other).unwrap_or_else(|_| panic!("missing independent member field {other}: {c:?}")).clone(),
        };
        let wrong = match &value {
            Value::Bool(v) => Value::Bool(!v), Value::Int(v) => Value::Int(v + 1),
            Value::Id(_) => id("wrong"), Value::String(_) => Value::String("wrong".into()),
            Value::Null => Value::Int(123456), other => panic!("unmodeled field {field}: {other:?}"),
        };
        for (probe, matches) in [(value, true), (wrong, false)] {
            let mut schema = schema.clone();
            let mut gate = public_table([("id".into(),ColumnType::Id), ("probe".into(),kind.clone())].into(),
                [("byId".into(),Index::of(&["id"],true))].into());
            let rule = RuleExpr::Exists { table: "unread".into(), index: "byGroup".into(),
                key: vec![RuleTerm::Literal(member.field("id").unwrap().clone())], provenance: crate::ir::KeyProvenance::Const,
                equalities: vec![(field.clone(),RuleTerm::Field("probe".into()))] };
            gate.rules.read = rule.clone(); gate.rules.insert = rule;
            schema.tables.insert("predicateGate".into(),gate);
            for (effect, cut) in [(Effect::Read,Cut::Cap),(Effect::Insert,Cut::Abort)] {
                let mut runner = Runner::new(tx,&schema,Context::new("reader",Default::default()).at(now),
                    Meter::new(Ceilings::unbounded(),cut),0);
                let row = object([("id",id("gate")),("probe",probe.clone())]);
                let actual = runner.check_rule("predicateGate",effect,None,&row).unwrap();
                assert_eq!(actual,count.is_some() && matches,"{label} {effect:?} {field} clock={now} member={member:?}");
                comparisons += 1;
            }
        }
    }
    comparisons
}

#[test]
fn private_settlement_cannot_change_read_or_insert_rules() {
    let source = r#"
table rooms:
  public
table members:
  room: rooms
  principal: principal
  until: time ?
  expire at .until
  cap 100 by room
  read <- .principal = viewer
  insert <- allow
table messages:
  room: rooms
  public
view unread: count messages by members m where .room = m.room
table gates:
  member: members
  read <- exists unread[member = .member, value = 0]
  insert <- exists unread[member = .member, value = 0]
query pair():
  return { count: unread['u'], rows: unread where .principal = viewer first 100, gate: gates['g'] }
mutation attempt():
  insert gates { id: 'attempt', member: 'u' }
"#;
    let b=snapback4_lang::compile(&[("fields.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let schema=crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let programs: Vec<Program>=crate::json_codec::from_text(&crate::json_codec::to_text(&b.programs.into_iter().map(|p|p.program).collect::<Vec<_>>()).unwrap()).unwrap();
    let mut e=Engine::memory(schema,programs).unwrap();
    let member=object([("id",id("u")),("room",id("r")),("principal",id("reader")),("until",Value::Int(100))]);
    e.seed_at([("rooms".into(),object([("id",id("r"))])),
        ("members".into(),member.clone()),
        ("gates".into(),object([("id",id("g")),("member",id("u"))]))],1).unwrap();
    let cached=e.store().rows("unread").unwrap();
    e.seed_at([("messages".into(),object([("id",id("m")),("room",id("r"))]))],2).unwrap();
    let after_source=e.store().rows("unread").unwrap();
    assert!(!e.store().rows("$recount:unread").unwrap().is_empty());
    for settled in [false,true] {
        if settled { while e.run_view_chunk(2).unwrap().is_some() {} }
        let result=e.query("fields.pair",Context::new("reader",Default::default()).at(2)).unwrap();
        assert!(result.complete,"{result:?}");
        assert_eq!(result.data.field("count").unwrap(),&Value::Int(1));
        assert_eq!(result.data.field("gate").unwrap(),&Value::Null);
        let row=&result.data.field("rows").unwrap().as_array().unwrap()[0];
        assert_eq!(row.field("recountPending"),Ok(&Value::Bool(false)));
        let insert=e.mutate("fields.attempt",None,Context::new("reader",Default::default()).at(2)).unwrap();
        assert!(matches!(&insert.state,crate::WriteState::Failed { why,.. } if why.code=="E_RULE"),"settled={settled} {insert:?}");
        let schema=e.schema().clone(); let tx=e.store_mut().transaction().unwrap();
        assert_eq!(predicates(&tx,&schema,config(Lifetime::Direct),&member,Some(1),2,"owned copy"),16);
    }
    assert_eq!(after_source,cached,"source event must change only private evidence, not replace a cache by a placeholder");
}

#[test]
fn every_field_rule_certifies_absent_and_legacy_pending_cache() {
    let c=config(Lifetime::Direct); let (schema,programs)=backend(c);
    let mut e=Engine::memory(schema,programs).unwrap(); seed_parents(&mut e);
    let messages:BTreeMap<_,_>=(0..1100).map(|n|(n,source(n,0,1,None))).collect();
    e.seed_at(messages.values().map(|v|("messages".into(),v.clone())),1).unwrap();
    let member=recipient(c,0,0,Some(100),Some(0));
    e.seed_at([("members".into(),member.clone())],2).unwrap();
    let stored=e.store().rows("unread").unwrap().pop().unwrap();
    assert!(stored.field("value").is_err() && stored.field("recountPending").is_err(),"no placeholder fields: {stored:?}");
    assert_eq!(e.store().rows("$recount:unread").unwrap().len(),1);
    let (schema,programs)=backend(c); e.adopt_at(schema,programs,2).unwrap();
    let schema=e.schema().clone();
    for legacy in [false,true] {
        let tx=e.store_mut().transaction().unwrap();
        if legacy {
            let old=tx.get("unread","u0").unwrap().unwrap();
            let poison=put_field(put_field(old.clone(),"value",Value::Int(777)),"recountPending",Value::Bool(true));
            tx.put("unread",&schema.tables["unread"],&poison,Some(&old)).unwrap();
        }
        let want=expected(c,&member,&messages,2);
        assert_eq!(want,Some(1100));
        assert_eq!(predicates(&tx,&schema,c,&member,want,2,"absent/legacy cache"),(schema.tables["unread"].columns.len()-1)*4);
    }
}

#[test]
fn computed_fields_cannot_select_a_stored_index() {
    for field in ["value","recountPending"] {
        let (mut schema,programs)=backend(config(Lifetime::Direct));
        schema.tables.get_mut("unread").unwrap().indexes.insert("unsafe".into(),Index::of(&[field,"id"],false));
        let error=Engine::memory(schema,programs).err().expect("computed cache index must refuse");
        assert!(error.to_string().contains("E_VIEW_KEY"),"{error}");
    }
}
