use snapback4_core::{Context, Engine, Value, WriteState, value::object, identity};
use snapback4_core::engine::refusal_trace::RefusalTrace;
use snapback4_lang::compile;

fn engine(source: &str) -> Engine {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn refused(state: WriteState) -> snapback4_core::Refusal {
    let WriteState::Failed { why, .. } = state else { panic!("expected refusal: {state:?}") };
    why
}

#[test]
fn service_bootstraps_a_synced_roster_without_a_service_partition() {
    let source = "table staff:\n  principal: principal\n  unique principal else ALREADY_STAFF\n  immutable principal\n  read <- exists staff[viewer] or viewer = 'service:ops'\n  insert <- viewer = 'service:ops' or exists staff[viewer]\n  delete <- viewer = 'service:ops'\n  sync\ntable records:\n  body: text <=40\n  read <- exists staff[viewer]\n  sync\nmutation grant(who: principal):\n  return insert staff { principal: who }\nmutation revoke(who: principal):\n  s = staff[who] ! else NOT_FOUND\n  delete staff[s]\n  return null\n";
    let mut e = engine(source);
    let args = |who: &str| [("who".into(), Value::Id(who.into()))].into();
    assert_eq!(refused(e.mutate("grant", None, Context::new("user:alice", args("user:alice"))).unwrap().state).code, "E_RULE");
    assert!(e.store().rows("staff").unwrap().is_empty());
    e.seed([("records".into(), object([("id", Value::Id("r".into())), ("body", Value::String("private".into()))]))]).unwrap();
    let seat = identity::service_session(e.store(), "ops", 1000, 1).unwrap();
    let capability = identity::resolve(e.store(), &seat.token, 1001).unwrap().unwrap();
    assert_eq!(capability.0, "service:ops");
    assert!(matches!(e.mutate("grant", None, Context::new(&capability.0, args("user:alice"))).unwrap().state, WriteState::Sent { .. }));
    assert!(matches!(e.mutate("grant", None, Context::new("user:alice", args("user:bob"))).unwrap().state, WriteState::Sent { .. }));
    assert_eq!(refused(e.mutate("grant", None, Context::new("service:ops", args("user:bob"))).unwrap().state).code, "ALREADY_STAFF");
    assert_eq!(e.snapshot_at("user:bob", 1002).unwrap().0.len(), 3);
    assert!(e.snapshot_at("user:outsider", 1002).unwrap().0.is_empty());
    assert!(e.snapshot_at("service:ops", 1002).unwrap().0.is_empty(), "a service read grant never creates a partition");
    let head = e.seq().unwrap();
    assert!(matches!(e.mutate("revoke", None, Context::new("service:ops", args("user:bob"))).unwrap().state, WriteState::Sent { .. }));
    assert!(e.snapshot_at("user:bob", 1003).unwrap().0.is_empty());
    let stream = e.stream_at("user:bob", head, 100, 1003).unwrap();
    assert!(stream.events.iter().any(|event| event.kind == "scope" && event.data == Some(Value::Array(vec![]))), "{:?}", stream.events);
    assert!(identity::resolve(e.store(), &seat.token, seat.expires_at).unwrap().is_none());
    identity::close_session(e.store(), &seat.token).unwrap();
    assert!(identity::resolve(e.store(), &seat.token, 1002).unwrap().is_none());
    assert!(identity::custom_session(e.store(), "service:ops", "account", 1000, 1).is_err());
}

#[test]
fn only_whole_positive_service_branches_prove_membership_grants() {
    for branch in ["viewer != 'service:ops'", "not (viewer = 'service:ops')", "viewer = 'user:ops'", ".principal = viewer or viewer = 'service:ops'"] {
        let source = format!("table staff:\n  principal: principal\n  unique principal\n  immutable principal\n  read <- exists staff[viewer]\n  insert <- {branch}\n  sync\n");
        let b = compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_SYNC"), "{branch}: {:?}", b.diagnostics);
    }
    let source = "table staff:\n  principal: principal\n  unique principal\n  read <- exists staff[viewer]\n  insert <- viewer = 'service:ops'\n  update <- viewer = 'service:ops'\n  sync\n";
    assert!(compile(&[("schema.q".into(), source.into())]).diagnostics.is_empty());
}

#[test]
fn parent_and_filtered_seat_lookups_have_private_trace_evidence() {
    let source = "table parents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  insert <- allow\n  online only\ntable children:\n  parent: parents\n  immutable parent\n  read through .parent\n  insert <- viewer = 'service:ops'\n  online only\nmutation child(parent: parents):\n  return insert children { parent }\nquery lookup(parent: parents):\n  return parents[parent] ! else NOT_FOUND\n";
    let mut e = engine(source);
    e.seed([("parents".into(), object([("id", Value::Id("p".into())), ("owner", Value::Id("user:alice".into()))]))]).unwrap();
    let trace = RefusalTrace::default();
    let args = || [("parent".into(), Value::Id("p".into()))].into();
    let refusal = refused(e.mutate("child", None, Context::new("service:ops", args()).with_refusal_trace(trace.clone())).unwrap().state);
    assert_eq!(refusal.code, "E_RULE");
    assert!(!refusal.message.contains("unread parent"));
    let cause = trace.take().unwrap();
    assert_eq!(cause.table, "parents");
    assert_eq!(cause.viewer, "service:ops");
    assert!(cause.clause.contains("insert into children needs unread parent parents"), "{cause:?}");
    assert_eq!(cause.phase, "read rule");
    let refusal = e.query("lookup", Context::new("service:ops", args()).with_refusal_trace(trace.clone())).unwrap_err();
    assert_eq!(refusal.code, "NOT_FOUND");
    let cause = trace.take().unwrap();
    assert_eq!((cause.table.as_str(), cause.clause.as_str(), cause.viewer.as_str()), ("parents", "read rule", "service:ops"));
    assert!(!cause.terminal);
}

#[test]
fn named_unique_conflicts_are_checked_under_current_readability() {
    let source = "table things:\n  key: text <=10\n  open: bool\n  read <- .open\n  insert <- allow\n  update <- allow\n  unique key else TAKEN\n  online only\nmutation add(key: text <=10):\n  return insert things { key, open: true }\nmutation hide(id: things):\n  update things[id] { open: false }\n  return null\n";
    let mut e = engine(source);
    e.seed([("things".into(), object([("id", Value::Id("one".into())), ("key", Value::String("same".into())), ("open", Value::Bool(true))]))]).unwrap();
    let args = || [("key".into(), Value::String("same".into()))].into();
    assert_eq!(refused(e.mutate("add", None, Context::new("user:alice", args())).unwrap().state).code, "TAKEN");
    e.mutate("hide", None, Context::new("user:alice", [("id".into(), Value::Id("one".into()))].into())).unwrap();
    assert_eq!(refused(e.mutate("add", None, Context::new("user:alice", args())).unwrap().state).code, "E_RULE");
    assert_eq!(e.store().rows("things").unwrap().len(), 1);
}

#[test]
fn fixture_constraint_refusal_is_atomic_and_names_the_column() {
    let mut e = engine("table proofs:\n  version: int 1..\n  public 'proofs'\n");
    let rows = [1, 0].into_iter().enumerate().map(|(n, v)| ("proofs".into(), object([("id", Value::Id(format!("p{n}"))), ("version", Value::Int(v))])));
    let why = e.seed(rows).unwrap_err();
    assert_eq!(why.code(), "E_CONSTRAINT");
    assert!(why.to_string().contains("proofs.version"), "{why}");
    assert!(e.store().rows("proofs").unwrap().is_empty());
}
