//! Mixed-key sugar must preserve the named form's rules, paths and disclosure.
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

const SOURCE: &str = r#"table members:
  org: id
  principal: principal
  role: enum('admin', 'member')
  immutable org, principal
  unique org, principal
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync

table docs:
  org: id
  title: text
  read <- exists members[.org, viewer, role = 'admin']
  insert <- created members[.org, viewer, role = 'admin']
  online only

table invitations:
  org: id
  read <- exists members[.org, viewer, role = 'admin']
  insert <- exists members[.org, viewer, role = 'admin']
  online only

fn admin(org: id): exists members[org, viewer, role = 'admin']
query probe(org: id):
  return admin(org)
query point(org: id):
  return members[org, viewer, role = 'admin']
query doc(key: docs):
  return docs[key, title = 'secret']
mutation bootstrap(org: id, role: enum('admin', 'member')):
  insert members { org, principal: viewer, role }
  return insert docs { org, title: 'secret' }
mutation invite(org: id):
  return insert invitations { org }
"#;

fn named(source: &str) -> String {
    source.replace("members[.org, viewer,", "members[org = .org, principal = viewer,")
        .replace("members[org, viewer,", "members[org = org, principal = viewer,")
        .replace("docs[key,", "docs[id = key,")
}
fn compile_source(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn checked(source: &str) -> Bound {
    let b = compile_source(source);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn engine(source: &str) -> Engine {
    let b = checked(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn context(viewer: &str, name: &str, value: Value) -> Context {
    Context::new(viewer, BTreeMap::from([(name.into(), value)])).at(10)
}
fn id(value: &str) -> Value { Value::Id(value.into()) }

#[test]
fn mixed_rules_helpers_reads_and_created_lower_to_identical_schema_ir_and_audience() {
    let a = checked(SOURCE);
    let b = checked(&named(SOURCE));
    assert_eq!(serde_json::to_value(&a.schema).unwrap(), serde_json::to_value(&b.schema).unwrap());
    for (a, b) in a.programs.iter().zip(&b.programs) { assert_eq!(a.program, b.program); }
    assert_eq!(a.schema.tables["members"].sync.as_ref().unwrap().audience, snapback4_core::schema::Audience::Column("principal".into()));
    let snapback4_core::schema::RuleExpr::Exists { key, equalities, .. } = &a.schema.tables["docs"].rules.read else { panic!("expected probe") };
    assert_eq!((key.len(), equalities.len()), (2, 1));
    let snapback4_core::schema::RuleExpr::Created { key, equalities, .. } = &a.schema.tables["docs"].rules.insert else { panic!("expected created") };
    assert_eq!((key.len(), equalities.len()), (2, 1));
}

#[test]
fn mixed_and_named_forms_return_the_same_authorized_answers_and_write_outcomes() {
    let mut a = engine(SOURCE);
    let mut b = engine(&named(SOURCE));
    for e in [&mut a, &mut b] {
        e.seed([
            ("members".into(), snapback4_core::value::object([("id", id("ma")), ("org", id("admin")), ("principal", id("alice")), ("role", Value::String("admin".into()))])),
            ("members".into(), snapback4_core::value::object([("id", id("mm")), ("org", id("member")), ("principal", id("alice")), ("role", Value::String("member".into()))])),
            ("docs".into(), snapback4_core::value::object([("id", id("da")), ("org", id("admin")), ("title", Value::String("secret".into()))])),
            ("docs".into(), snapback4_core::value::object([("id", id("dm")), ("org", id("member")), ("title", Value::String("secret".into()))])),
        ]).unwrap();
    }
    for viewer in ["alice", "bob"] {
        for org in ["admin", "member", "missing"] {
            for op in ["probe", "point"] {
                let x = a.query(op, context(viewer, "org", id(org))).unwrap();
                let y = b.query(op, context(viewer, "org", id(org))).unwrap();
                assert_eq!(x.data, y.data);
                assert_eq!(x.metered, y.metered);
                if op == "probe" { assert_eq!(x.data, Value::Bool(viewer == "alice" && org == "admin")); }
                else { assert_eq!(x.data != Value::Null, viewer == "alice" && org == "admin"); }
            }
            let x = a.mutate("invite", None, context(viewer, "org", id(org)).with_ids(["invite".into()])).unwrap();
            let y = b.mutate("invite", None, context(viewer, "org", id(org)).with_ids(["invite".into()])).unwrap();
            assert_eq!(x.state, y.state);
            assert_eq!(matches!(x.state, WriteState::Sent { .. }), viewer == "alice" && org == "admin");
        }
        for key in ["da", "dm", "missing"] {
            let x = a.query("doc", context(viewer, "key", id(key))).unwrap();
            let y = b.query("doc", context(viewer, "key", id(key))).unwrap();
            assert_eq!(x.data, y.data);
            assert_eq!(x.data != Value::Null, viewer == "alice" && key == "da");
        }
    }
    for role in ["admin", "member"] {
        let ctx = Context::new("carol", BTreeMap::from([("org".into(), id(role)), ("role".into(), Value::String(role.into()))])).at(20).with_ids([format!("m-{role}"), format!("d-{role}")]);
        let x = a.mutate("bootstrap", None, ctx.clone()).unwrap();
        let y = b.mutate("bootstrap", None, ctx).unwrap();
        assert_eq!(x.state, y.state);
        assert_eq!(matches!(x.state, WriteState::Sent { .. }), role == "admin");
    }
}

#[test]
fn extra_rule_tests_keep_the_existing_sync_refusal() {
    let mixed = SOURCE.replace("  online only", "  sync");
    let a = compile_source(&mixed);
    let b = compile_source(&named(&mixed));
    let errors = |bound: Bound| bound.diagnostics.into_iter().map(|d| (d.code, d.message, d.rewrite)).collect::<Vec<_>>();
    let errors_a = errors(a);
    assert!(errors_a.iter().any(|d| d.0 == "E_SYNC"));
    assert_eq!(errors_a, errors(b), "residual role tests must not widen a device audience");
}

#[test]
fn positional_components_after_named_tests_have_an_ordered_rewrite() {
    for key in ["role = 'admin', org, viewer", "org, role = 'admin', viewer"] {
        let b = compile_source(&SOURCE.replace("members[org, viewer, role = 'admin']", &format!("members[{key}]")));
        let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_KEY_ORDER").unwrap();
        assert_eq!(d.rewrite, "members[org, viewer, role = 'admin']");
        assert!(d.site.line > 0);
        assert!(d.explanation_section().is_some());
        checked(&SOURCE.replace("members[org, viewer, role = 'admin']", &d.rewrite));
    }
}

#[test]
fn incomplete_ambiguous_and_non_unique_positional_prefixes_name_declared_keys() {
    for declarations in ["unique org, principal", "by byOrgPrincipal: org, principal", "unique org, principal\n  unique org, role"] {
        let source = SOURCE.replace("unique org, principal", declarations);
        let b = compile_source(&source);
        if declarations != "unique org, principal" {
            let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_POSITIONAL_SCAN").unwrap();
            assert!(!d.rewrite.contains("$intent:"));
            assert!(d.rewrite.contains("id =") || d.rewrite.contains("org ="));
        }
    }
    // One argument would resolve to id, but its type cannot complete the
    // declared two-column key. Two components against a three-column key
    // are a genuinely incomplete positional prefix.
    let source = SOURCE.replace("unique org, principal", "unique org, principal, role");
    let b = compile_source(&source);
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_POSITIONAL_SCAN").unwrap();
    assert!(d.message.contains("(org, principal, role)"));
    assert!(d.rewrite.contains("org =") && d.rewrite.contains("principal =") && d.rewrite.contains("role = 'admin'"));
}

#[test]
fn repeated_named_column_cannot_override_the_resolved_key() {
    let b = compile_source(&SOURCE.replace("members[org, viewer, role = 'admin']", "members[org, viewer, principal = 'mallory']"));
    assert!(b.diagnostics.iter().any(|d| d.message.contains("key repeats column principal")));
}

#[test]
fn nullable_unique_keys_still_count_toward_positional_ambiguity() {
    let source = SOURCE.replace("  unique org, principal", "  optional: id ?\n  unique org, optional\n  unique org, principal");
    let mixed = compile_source(&source);
    assert!(mixed.diagnostics.iter().any(|d| d.code == "E_QUARRY_POSITIONAL_SCAN" && d.message.contains("match 2 keys")));
    checked(&named(&source));
    let only_nullable = SOURCE.replace("  org: id", "  org: id ?");
    assert!(compile_source(&only_nullable).diagnostics.iter().any(|d| d.code == "E_QUARRY_POSITIONAL_SCAN" && d.message.contains("non-null columns")));
}

#[test]
fn mixed_write_targets_preserve_existing_named_target_admission() {
    for op in ["update", "delete", "upsert"] {
        let fields = if op == "delete" { "" } else { " { role: 'member' }" };
        let source = format!("{SOURCE}\nmutation change(org: id):\n  {op} members[org, viewer, role = 'admin']{fields}\n");
        // The current IR has no residual tests for private write lookup:
        // both forms refuse unless a full matching unique index exists.
        let a = compile_source(&source);
        let b = compile_source(&named(&source));
        let errors = |b: Bound| b.diagnostics.into_iter().map(|d| (d.code, d.message, d.rewrite)).collect::<Vec<_>>();
        let errors_a = errors(a);
        assert!(errors_a.iter().any(|d| d.0 == "E_QUARRY_WRITE_TESTS"));
        assert_eq!(errors_a, errors(b));
        let supported = source.replace("  unique org, principal\n", "  unique org, principal\n  unique byOrgPrincipalRole: org, principal, role\n");
        let a = checked(&supported);
        let b = checked(&named(&supported));
        assert_eq!(a.programs.last().unwrap().program, b.programs.last().unwrap().program);
        let mut engines = [engine(&supported), engine(&named(&supported))];
        for e in &mut engines {
            e.seed([("members".into(), snapback4_core::value::object([("id", id("m")), ("org", id("org")), ("principal", id("alice")), ("role", Value::String("admin".into()))]))]).unwrap();
            let result = e.mutate("change", None, context("alice", "org", id("org"))).unwrap();
            assert!(matches!(result.state, WriteState::Sent { .. }), "{op}: {:?}", result.state);
        }
        assert_eq!(engines[0].store().rows("members").unwrap(), engines[1].store().rows("members").unwrap());
    }
}

#[test]
fn extra_tested_write_targets_refuse_with_an_explicit_readable_check_rewrite() {
    for op in ["update", "delete", "upsert"] {
        let fields = if op == "delete" { "" } else { " { role: 'member' }" };
        let declaration = "mutation change(org: id):\n";
        let source = format!("{SOURCE}\n{declaration}  {op} members[org, viewer, role = 'admin']{fields}\n");
        let bound = compile_source(&source);
        assert!(!bound.programs.iter().any(|p| p.program.name == "change"), "no implicit pre-read program");
        let d = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_WRITE_TESTS").unwrap();
        assert_eq!(d.site.line as usize, source.lines().count());
        assert!(d.message.contains("a write target names one row by its key"), "{d}");
        assert_eq!(d.rewrite, format!("require exists members[org, viewer, role = 'admin'] else NOT_ADMIN\n{op} members[org, viewer]{fields}"));
        assert!(!d.mechanical);
        assert!(d.explanation_section().is_some());
        let fixed = format!("{SOURCE}\n{declaration}  {}\n", d.rewrite.replace('\n', "\n  "));
        checked(&fixed);
        let mut e = engine(&fixed);
        // The authored require refuses a missing row before the write; an
        // upsert cannot silently take its insert arm through this rewrite.
        let rejected = e.mutate("change", None, context("alice", "org", id("missing"))).unwrap();
        assert!(matches!(rejected.state, WriteState::Failed { why, .. } if why.code == "NOT_ADMIN"));
    }
}
