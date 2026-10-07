use snapback4_core::{Context, Engine, Value, WriteState, value::object};
use snapback4_lang::compile;

fn engine(source: &str) -> Engine {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn ctx(who: &str, args: &[(&str, Value)]) -> Context {
    Context::new(who, args.iter().map(|(k,v)| (k.to_string(), v.clone())).collect()).at(100).with_ids(["new".into()])
}
const SOURCE: &str = include_str!("fixtures/rx/reactions.q");
fn seed(e: &mut Engine, who: &str) {
    e.load([
        ("conversations".into(), object([("id", id("c")), ("owner", id("alice"))])),
        ("members".into(), object([("id", id("member")), ("conversation", id("c")), ("principal", id(who))])),
        ("messages".into(), object([("id", id("m")), ("conversation", id("c")), ("deleted", Value::Bool(false)), ("until", Value::Null)])),
    ]).unwrap();
}
#[test]
fn table_membership_enforces_mutation_without_explicit_require() {
    assert!(!SOURCE.contains("require "));
    let mut e = engine(SOURCE);
    seed(&mut e, "alice");
    let args = [("message", id("m")), ("emoji", Value::String("like".into()))];
    for (viewer, allowed) in [("bob",false),("alice",true)] {
        let out = e.mutate("setReaction", None, ctx(viewer,&args)).unwrap();
        assert_eq!(matches!(out.state,WriteState::Sent { .. }),allowed,"{out:?}");
    }
    let removed = e.mutate("leave", None, ctx("alice", &[("conversation",id("c")),("principal",id("alice"))])).unwrap();
    assert!(matches!(removed.state,WriteState::Sent { .. }));
    let out = e.mutate("setReaction",None,ctx("alice",&args)).unwrap();
    assert!(matches!(out.state,WriteState::Failed { .. }),"{out:?}");
}
#[test]
fn hidden_absent_expired_and_soft_deleted_messages_cannot_authorize() {
    for mode in ["hidden", "absent", "expired", "deleted"] {
        let mut e = engine(SOURCE);
        if mode != "absent" { seed(&mut e, if mode == "hidden" { "bob" } else { "alice" }); }
        if mode == "deleted" { e.mutate("remove", None, ctx("alice",&[("message",id("m"))])).unwrap(); }
        if mode == "expired" {
            // Fresh engine permits the actual expired image without the read-through lifetime fence.
            e = engine(SOURCE);
            e.load([
                ("members".into(),object([("id",id("member")),("conversation",id("c")),("principal",id("alice"))])),
                ("messages".into(),object([("id",id("m")),("conversation",id("c")),("deleted",Value::Bool(false)),("until",Value::Int(50))])),
            ]).unwrap();
        }
        let out = e.mutate("setReaction",None,ctx("alice", &[("message",id("m")),("emoji",Value::String("like".into()))])).unwrap();
        let WriteState::Failed { why, .. } = out.state else { panic!("{mode}: {out:?}") };
        assert_eq!(why.code,"NOT_FOUND", "{mode}: {why:?}");
    }
}

fn chain_source(rule: &str, final_rule: bool) -> String {
    format!("table roots:\n  owner: principal\n  value: text <=200\n  until: time ?\n  read <- .owner = viewer\n  expire at .until\ntable parents:\n  root: roots ?\n  owner: principal\n  read <- .owner = viewer\ntable witnesses:\n  value: text <=200\n  unique value\n  public\ntable children:\n  parent: parents ?\n  public\n  {}\nmutation add(parent: parents ?):\n  insert children {{ id: 'child', parent }}\n", if final_rule { format!("insert <- allow\n  after insert <- exists witnesses[value = .parent.root.value]") } else { format!("insert <- {rule}") })
}
#[test]
fn every_chain_failure_is_unknown_even_under_negation_and_has_identical_logical_meter() {
    for rule in [".parent.root.value != 'no'", "not (.parent.root.value = 'no')", ".parent.root.value = null", "not exists witnesses[value = .parent.root.value]"] {
        let mut outcomes = Vec::new();
        for mode in ["absent-parent","hidden-parent","absent-root","hidden-root","hidden-large-root","expired-root","null-parent","null-root"] {
            let mut e = engine(&chain_source(rule,false));
            if !matches!(mode,"absent-parent"|"null-parent") {
                e.load([("parents".into(),object([("id",id("p")),("root",if mode=="null-root" {Value::Null} else {id("r")}), ("owner",id(if mode=="hidden-parent" {"bob"} else {"alice"}))]))]).unwrap();
            }
            if !matches!(mode,"absent-parent"|"absent-root"|"null-parent"|"null-root") {
                e.load([("roots".into(),object([("id",id("r")),("owner",id(if mode.starts_with("hidden-") {"bob"} else {"alice"})),("value",Value::String(if mode=="hidden-large-root" {"x".repeat(200)} else {"yes".into()})),("until",if mode=="expired-root" {Value::Int(50)} else {Value::Null})]))]).unwrap();
            }
            let out = e.mutate("add",None,ctx("alice", &[("parent", if mode=="null-parent" {Value::Null} else {id("p")})])).unwrap();
            assert!(matches!(out.state,WriteState::Failed { .. }),"{rule}, {mode}: {out:?}");
            assert_eq!(out.metered.rule_probes,if rule.contains("exists") {3} else {2});
            if mode != "null-parent" { outcomes.push((out.state,out.metered)); }
        }
        for outcome in &outcomes[1..] { assert_eq!(outcomes[0],*outcome,"{rule}"); }
    }
}
#[test]
fn final_hops_resolve_at_transaction_end_and_rollback_without_disclosure() {
    let online = SOURCE.lines().filter(|line| !line.trim_start().starts_with("sync")).collect::<Vec<_>>().join("
")
        .replace("insert <- created conversations[.conversation] or exists members[.conversation, viewer]", "insert <- allow");
    let mut e = engine(&online);
    seed(&mut e,"bob");
    let before = e.mutate("obligation",None,ctx("alice", &[("id",id("o")),("message",id("m"))])).unwrap();
    assert!(matches!(before.state,WriteState::Failed { .. }));
    let after = e.mutate("joinAtEnd",None,ctx("alice", &[("id",id("o")),("message",id("m")),("conversation",id("c"))])).unwrap();
    assert!(matches!(after.state,WriteState::Sent { .. }),"{after:?}");
    let mut outcomes = Vec::new();
    for hidden in [false,true] {
        let mut e = engine(&chain_source("",true));
        if hidden { e.load([("parents".into(),object([("id",id("p")),("root",id("r")),("owner",id("bob"))]))]).unwrap(); }
        let out = e.mutate("add",None,ctx("alice",&[("parent",id("p"))])).unwrap();
        assert!(matches!(out.state,WriteState::Failed { .. }));
        assert_eq!(out.metered.rule_probes,2);
        outcomes.push((out.state,out.metered));
    }
    assert_eq!(outcomes[0],outcomes[1]);
}
#[test]
fn every_occurrence_prepays_its_depth_even_when_short_circuited() {
    use snapback4_core::Ceilings;
    for (rule, count) in [("false and .parent.root.value = 'yes'",2),(".parent.root.value = .parent.root.value",4),("not exists witnesses[value = .parent.root.value]",3)] {
        let mut e = engine(&chain_source(rule,false));
        e.set_ceilings(Ceilings {rule_probes: count-1,..Ceilings::default()});
        let out = e.mutate("add",None,ctx("alice",&[("parent",id("p"))])).unwrap();
        let WriteState::Failed { why, .. } = out.state else { panic!("{out:?}") };
        assert_eq!(why.code,"E_BOUND","{rule}: {why:?}");
    }
}

#[test]
fn null_field_of_an_authorized_row_is_an_ordinary_value() {
    let source = chain_source(".parent.root.value = null",false).replace("value: text <=200\n  until", "value: text <=200 ?\n  until");
    let mut e = engine(&source);
    e.load([
        ("parents".into(),object([("id",id("p")),("root",id("r")),("owner",id("alice"))])),
        ("roots".into(),object([("id",id("r")),("owner",id("alice")),("value",Value::Null),("until",Value::Null)])),
    ]).unwrap();
    let out = e.mutate("add",None,ctx("alice",&[("parent",id("p"))])).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
    assert_eq!(out.metered.rule_probes,2);
}

#[test]
fn named_update_chains_check_both_images_and_delete_checks_the_old_row() {
    let source = "table roots:\n  owner: principal\n  public\ntable parents:\n  root: roots\n  public\ntable children:\n  parent: parents\n  public\n  update (old, next) <- old.parent.root.owner = viewer and next.parent.root.owner = viewer\n  delete <- .parent.root.owner = viewer\nmutation move(id: children, parent: parents):\n  update children[id] { parent }\nmutation drop(id: children):\n  delete children[id]\n";
    for (old,next,allowed) in [("a","a",true),("a","b",false),("b","a",false)] {
        let mut e = engine(source);
        let mut rows = vec![];
        for (key,owner) in [("a","alice"),("b","bob")] {
            rows.push(("roots".into(),object([("id",id(key)),("owner",id(owner))])));
            rows.push(("parents".into(),object([("id",id(key)),("root",id(key))])));
        }
        rows.push(("children".into(),object([("id",id("child")),("parent",id(old))])));
        e.load(rows).unwrap();
        let out = e.mutate("move",None,ctx("alice",&[("id",id("child")),("parent",id(next))])).unwrap();
        assert_eq!(matches!(out.state,WriteState::Sent{..}),allowed,"{old}->{next}: {out:?}");
        let out = e.mutate("drop",None,ctx("alice",&[("id",id("child"))])).unwrap();
        assert_eq!(matches!(out.state,WriteState::Sent{..}),old=="a","{old}: {out:?}");
    }
}
