//! Common-engine admission and foundation over the Postgres enum arm.
// @ref LLP 3000.009.001.000#3.4 — an admitted schema opens before it serves any operation.
use super::super::*;
use crate::{Engine, store_port::AnyStore};
pub(super) const SOURCE: &str = "table notes:\n  n: int\n  public\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public\nmutation put(key: id, n: int):\n  upsert notes[key] { n }\n  return n\nquery peek(key: id):\n  return notes[key]\nmutation refuse():\n  require false else NO\n";
fn bound(source: &str) -> (Schema, Vec<Program>) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    (serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap(), bound.programs.into_iter().map(|p| serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap()).collect())
}
fn connection() -> String { std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private scripts/test-postgres.sh database") }
fn name() -> String { format!("sb4_eval_unified_{:x}", crate::ids::seed()) }
fn context(n: i64) -> Context { Context::new("alice", [("key".into(), Value::Id("n1".into())), ("n".into(), Value::Int(n))].into()).at(1000) }
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn common_engine_opens_mutates_replays_and_reopens() {
    let name = name(); let connection = connection();
    let (schema, programs) = bound(SOURCE);
    let mut engine = Engine::new_at(AnyStore::create_postgres(&connection, &name).unwrap(), schema, programs, 1000).unwrap();
    let sent = engine.mutate("put", Some("first"), context(7)).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { seq: 1, .. }), "{sent:?}");
    assert!(engine.mutate("put", Some("first"), context(7)).unwrap().replayed);
    assert_eq!(engine.mutate("put", Some("first"), context(8)).unwrap_err().code(), "E_ID_REUSED");
    let mut read = context(0); read.args.remove("n");
    assert_eq!(engine.query("peek", read.clone()).unwrap().data.field("n").unwrap(), &Value::Int(7));
    let identity = engine.store().store_identity().unwrap();
    drop(engine);
    let mut engine = Engine::open_at(AnyStore::open_postgres(&connection, &name).unwrap(), 1000).unwrap();
    assert_eq!(engine.store().store_identity().unwrap(), identity);
    assert_eq!(engine.store().seq().unwrap(), 1);
    assert!(engine.mutate("put", Some("first"), context(7)).unwrap().replayed);
    assert_eq!(engine.reader().unwrap().query("peek", read).unwrap().data.field("n").unwrap(), &Value::Int(7));
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn refused_schema_creates_no_namespace() {
    let connection = connection(); let name = name();
    let (schema, mut programs) = bound(SOURCE);
    programs[0].native = true;
    let error = Engine::new(AnyStore::create_postgres(&connection, &name).unwrap(), schema, programs).err().unwrap();
    assert!(matches!(error, RuntimeError::StoreUnsupported { family: "native" }));
    assert!(!Client::connect(&connection, postgres::NoTls).unwrap().query_one("SELECT to_regnamespace($1) IS NOT NULL", &[&name]).unwrap().get::<_,bool>(0));
}
#[test]
fn profile_names_each_evaluator_exclusion_and_allows_ephemeral() {
    let (schema, programs) = bound(SOURCE);
    let programs: BTreeMap<_,_> = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
    super::super::profile::admit(&schema, &programs).unwrap();
    for (kind, family) in [(ProgramKind::Job, "jobs"), (ProgramKind::Action, "actions")] {
        let mut p = programs.clone(); p.get_mut("put").unwrap().kind = kind;
        assert!(matches!(super::super::profile::admit(&schema, &p), Err(RuntimeError::StoreUnsupported { family: f }) if f == family));
    }
    for (change, family) in [
        (0, "union-sync"), (1, "time-publication"), (2, "assets"), (3, "routes"), (4, "schedules"),
    ] {
        let mut candidate = schema.clone();
        match change {
            0 => candidate.tables.get_mut("notes").unwrap().sync.as_mut().unwrap().also.push(crate::schema::SyncArm { audience: crate::schema::Audience::Column("owner".into()), horizon: None }),
            1 => candidate.tables.get_mut("notes").unwrap().not_before = Some("n".into()),
            2 => { candidate.tables.get_mut("notes").unwrap().columns.insert("photo".into(), crate::schema::ColumnType::Image { max: 100, once: false }); },
            3 => { candidate.routes.insert("hook".into(), crate::schema::routes::RouteSpec { path: "/hook".into(), service: None, work: Default::default(), wait_ms: 1000 }); },
            4 => candidate.schedules.push(crate::schema::Schedule { name: "tick".into(), every_ms: 1000, offset_ms: 0, target: "put".into(), service: None, months: 0 }),
            _ => unreachable!(),
        }
        assert!(matches!(super::super::profile::admit(&candidate, &programs), Err(RuntimeError::StoreUnsupported { family: f }) if f == family));
    }
    let (maintained, _) = bound(include_str!("../../../../../snapback4-lang/tests/fixtures/maintained-columns.q"));
    assert!(matches!(super::super::profile::admit(&maintained, &BTreeMap::new()), Err(RuntimeError::StoreUnsupported { family: "maintained-columns" })));
    let (schema, programs) = bound("table typing:\n  owner: principal\n  cap 50 by owner\n  ephemeral 4s\n  read <- allow\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  delete <- .owner = viewer\nquery peek():\n  return 1\n");
    let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
    super::super::profile::admit(&schema, &programs).unwrap();
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn defensive_family_refusal_aborts_without_consuming_operation_id() {
    let connection = connection(); let name = name(); let (schema, programs) = bound(SOURCE);
    let mut engine = Engine::new_at(AnyStore::create_postgres(&connection, &name).unwrap(), schema, programs, 1000).unwrap();
    // Bypass startup admission deliberately to reach the enum's runtime guard.
    engine.schema.tables.get_mut("notes").unwrap().columns.insert("photo".into(), crate::schema::ColumnType::Optional(Box::new(crate::schema::ColumnType::Image { max: 100, once: false })));
    let error = engine.mutate("put", Some("reserved"), context(7)).unwrap_err();
    assert!(matches!(error, RuntimeError::StoreUnsupported { family: "assets" }));
    assert_eq!(engine.store().seq().unwrap(), 0);
    assert_eq!(engine.store().applied_ops().unwrap(), 0);
    assert!(engine.store().rows("notes").unwrap().is_empty());
    engine.schema.tables.get_mut("notes").unwrap().columns.remove("photo");
    assert!(matches!(engine.mutate("put", Some("reserved"), context(7)).unwrap().state, WriteState::Sent { seq: 1, .. }));
}
