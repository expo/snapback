use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

fn bound(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn context(n: usize) -> Context {
    Context::new("alice", BTreeMap::from([("peers".into(), Value::Array(vec![Value::Id("bob".into()); n]))]))
        .with_ids(["group".into()])
}

#[test]
fn existing_maximum_accepts_empty_and_refuses_overflow() {
    let b = bound("mutation createGroup(peers: [principal] <=49):\n  return peers\n");
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for n in [0, 1, 49] {
        assert!(matches!(e.mutate("createGroup", None, context(n)).unwrap().state, WriteState::Sent { .. }));
    }
    let refused = e.mutate("createGroup", None, context(50)).unwrap();
    assert!(format!("{refused:?}").contains("peers has more than 49 items"));
}

#[test]
fn canonical_tags_keep_legacy_bytes_and_split_requires_people() {
    let language = bound(&snapback4_lang::guide::language());
    let tag_bytes = r#"{"List":{"of":{"Text":{"max":20}},"max":8}}"#;
    assert_eq!(serde_json::to_string(&language.schema.tables["rooms"].columns["tags"]).unwrap(), tag_bytes);
    let create = language.programs.iter().find(|p| p.program.name == "createRoom").unwrap();
    assert!(matches!(&create.program.args["tags"], snapback4_core::ir::ArgType::List { max: 8, .. }));
    let split = language.programs.iter().find(|p| p.program.name == "split").unwrap();
    assert!(matches!(&split.program.args["people"], snapback4_core::ir::ArgType::ListRange { min: 1, max: 8, .. }));
    let types = snapback4_lang::guide::quarry(snapback4_lang::guide::card("types").unwrap());
    let types = bound(types.iter().find(|block| block.contains("table everything:")).unwrap());
    assert_eq!(serde_json::to_string(&types.schema.tables["everything"].columns["tags"]).unwrap(), tag_bytes);
}

#[test]
fn ranged_list_arguments_enforce_both_inclusive_bounds() {
    let b = bound("mutation createGroup(peers: [principal] 1..49):\n  return peers\n");
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for n in [1, 49] {
        assert!(matches!(e.mutate("createGroup", None, context(n)).unwrap().state, WriteState::Sent { .. }));
    }
    for (n, message) in [(0, "peers needs at least 1 item"), (50, "peers has more than 49 items")] {
        let refused = e.mutate("createGroup", None, context(n)).unwrap();
        let WriteState::Failed { why, .. } = refused.state else { panic!("{refused:?}"); };
        assert_eq!(why.code, "E_INPUT");
        assert!(why.message.contains(message), "{:?}", why);
    }
}

#[test]
fn range_is_accepted_in_columns_helpers_nested_lists_and_action_results() {
    bound("use server\ntable groups:\n  peers: [principal] 1..49\n  nested: [[int] 1..2] 1..3 ?\n  public\nfn roster(peers: [principal] 1..49): peers\nquery one(id: groups):\n  return groups[id] { peers }\naction invite(peers: [principal] 1..49) returns { peers: [principal] 1..49 }\n");
}

#[test]
fn malformed_list_bounds_are_clear() {
    for (range, message) in [("2..1", "minimum"), ("-1..49", "nonnegative"), ("4294967296..4294967296", "4294967295")] {
        let b = compile(&[("schema.q".into(), format!("query q(peers: [principal] {range}):\n  return peers\n"))]);
        assert!(b.diagnostics.iter().any(|d| d.message.contains(message)), "{range}: {:?}", b.diagnostics);
    }
}

#[test]
fn incomplete_and_fractional_bounds_have_specific_diagnostics() {
    for range in ["1", "1.", "1...2"] {
        let b = compile(&[("schema.q".into(), format!("query q(xs: [int] {range}):\n  return xs\n"))]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_SYNTAX"
            && d.message.contains("list bounds") && d.rewrite.contains("[T] a..b")), "{range}: {:?}", b.diagnostics);
    }
    for range in ["1.5..8", "1..8.5", "<=1.5"] {
        let b = compile(&[("schema.q".into(), format!("query q(xs: [int] {range}):\n  return xs\n"))]);
        assert!(b.diagnostics.iter().any(|d| d.message == "list bounds must be integers; fractional bounds are not allowed"), "{range}: {:?}", b.diagnostics);
    }
}

#[test]
fn raw_schema_refuses_reversed_column_bounds_at_every_depth() {
    use snapback4_core::schema::{self, ColumnType as C};
    let base = bound("table groups:\n  peers: [principal] <=49\n  public\n").schema;
    for (min, max, valid) in [(2, 1, false), (1, 1, true), (0, 0, true)] {
        let range = C::ListRange { of: Box::new(C::Principal), min, max };
        for kind in [range.clone(), C::Optional(Box::new(range.clone())),
            C::List { of: Box::new(range.clone()), max: 2 },
            C::ListRange { of: Box::new(C::Optional(Box::new(range))), min: 1, max: 2 }] {
            let mut schema = base.clone();
            schema.tables.get_mut("groups").unwrap().columns.insert("peers".into(), kind);
            let issues = schema::validate(&schema);
            if valid { assert!(issues.is_empty(), "{issues:?}"); }
            else { assert!(issues.iter().any(|issue| issue.path == "tables.groups.columns.peers"
                && issue.message == "list minimum must not exceed its maximum"), "{issues:?}"); }
            assert_eq!(Engine::memory(schema, []).is_ok(), valid);
        }
    }
}

#[test]
fn zero_minimum_preserves_bytes_and_positive_minimum_has_a_strict_tag() {
    use serde_json::json;
    let source = "use server\ntable groups:\n  peers: [principal] <=49\n  public\nquery q(peers: [principal] <=49):\n  return peers\naction a() returns { peers: [principal] <=49 }\n";
    let old = bound(source);
    let zero = bound(&source.replace("<=49", "0..49"));
    assert_eq!(serde_json::to_vec(&old.schema).unwrap(), serde_json::to_vec(&zero.schema).unwrap());
    assert_eq!(serde_json::to_vec(&old.programs[0].program).unwrap(), serde_json::to_vec(&zero.programs[0].program).unwrap());
    assert_eq!(serde_json::to_string(&old.schema.tables["groups"].columns["peers"]).unwrap(), r#"{"List":{"of":"Principal","max":49}}"#);
    assert_eq!(serde_json::to_string(&old.programs[0].program.args["peers"]).unwrap(), r#"{"List":{"of":"Principal","max":49}}"#);
    let positive = bound(&source.replace("<=49", "1..49"));
    let expected = json!({"ListRange":{"of":"Principal","min":1,"max":49}});
    assert_eq!(serde_json::to_value(&positive.schema.tables["groups"].columns["peers"]).unwrap(), expected);
    assert_eq!(serde_json::to_value(&positive.programs[0].program.args["peers"]).unwrap(), expected);
    assert_eq!(serde_json::to_value(&positive.schema.action_specs["a"].returns.as_ref().unwrap()["peers"]).unwrap(), expected);
    assert!(matches!(positive.programs[0].result, snapback4_lang::types::Ty::List(_, 49)));
}

#[test]
fn optional_nested_minima_and_element_types_are_checked() {
    use snapback4_core::{engine::validate::validate_arg, wire::from_json};
    use serde_json::json;
    let b = bound("query q(peers: [[principal] 1..2] 1..3 ?):\n  return peers\n");
    let ty = &b.programs[0].program.args["peers"];
    for raw in [json!(null), json!([["bob"]]), json!([["bob", "carol"]])] {
        validate_arg(&b.schema, ty, &from_json(ty, &raw).unwrap(), "peers").unwrap();
    }
    for raw in [json!([]), json!([[]]), json!([["a", "b", "c"]]), json!([["a"], ["b"], ["c"], ["d"]])] {
        assert_eq!(validate_arg(&b.schema, ty, &from_json(ty, &raw).unwrap(), "peers").unwrap_err().code(), "E_INPUT");
    }
    assert!(from_json(ty, &json!([[123]])).is_err());
    let bad = compile(&[("schema.q".into(), "query q(peers: [principal ?] 1..2):\n  return peers\n".into())]);
    assert!(bad.diagnostics.iter().any(|d| d.message.contains("element types cannot be optional")));
    let bad = compile(&[("schema.q".into(), "fn f(xs: [int] 1..2): xs\nquery q(xs: [principal] 1..2):\n  return f(xs)\n".into())]);
    assert!(bad.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"));
}

#[test]
fn seeded_optional_nested_columns_enforce_each_bound_without_partial_writes() {
    use serde_json::json;
    let b = bound("table groups:\n  peers: [[principal] 1..2] 1..3 ?\n  public\n  insert <- allow\n  update <- allow\n");
    for (raw, valid) in [(json!(null), true), (json!([["bob"]]), true), (json!([["a", "b"]]), true),
        (json!([]), false), (json!([[]]), false), (json!([["a", "b", "c"]]), false),
        (json!([["a"], ["b"], ["c"], ["d"]]), false)] {
        let mut e = Engine::memory(b.schema.clone(), []).unwrap();
        let row = snapback4_core::wire::row_from_json(&b.schema.tables["groups"], &json!({"id":"g", "peers":raw})).unwrap();
        let validation = snapback4_core::engine::validate::validate_row(&b.schema, "groups", &row);
        assert_eq!(validation.is_ok(), valid);
        if !valid { assert_eq!(validation.unwrap_err().code(), "E_INPUT"); }
        let result = e.seed([("groups".into(), row)]);
        assert_eq!(result.is_ok(), valid, "{result:?}");
        // Trusted seed imports preserve the real constraint cause instead of
        // masking invalid source data as a missing addressed-upsert target.
        if !valid {
            let error = result.unwrap_err();
            assert_eq!(error.code(), "E_CONSTRAINT");
            assert!(error.to_string().contains("peers"), "{error}");
            assert!(e.store().rows("groups").unwrap().is_empty());
        }
        assert_eq!(e.store().rows("groups").unwrap().len(), usize::from(valid));
    }
}

#[test]
fn action_settlement_checks_both_bounds() {
    use snapback4_core::engine::actions::ActionSettled;
    use serde_json::json;
    let b = bound("use server\naction invite() returns { peers: [principal] 1..2 }\n");
    for n in 0..=3 {
        let mut e = Engine::memory(b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap();
        e.request_action("invite", "call", Context::new("dev:alice", BTreeMap::new()).at(0)).unwrap();
        let token = e.claim_actions("service:worker", None, 1, 1000, 1, 0).unwrap().remove(0).session.token;
        let result = e.settle_action("call", "service:worker", &token, ActionSettled::Done(json!({"peers":vec!["bob";n]})), 1).unwrap();
        if n == 0 || n == 3 {
            assert_eq!(result.error_code.as_deref(), Some("E_ACTION_RESULT"));
            assert!(result.error.unwrap().contains("result field peers does not match its declared type or bound"));
        } else { assert_eq!(result.result, Some(json!({"peers":vec!["bob";n]}))); }
    }
}

#[test]
fn generated_client_and_handler_types_snapshot() {
    let b = bound("use server\nmutation createGroup(peers: [principal] 1..49):\n  return peers\naction invite(peers: [principal] 1..49) returns { peers: [principal] 1..49 }\n");
    let client = snapback4_lang::emit::typescript(&b);
    let handler = snapback4_lang::emit::server_typescript(&b);
    assert!(client.contains("Bounds: peers: [principal] 1..49."), "{client}");
    for (name, actual) in [("api", client), ("server", handler)] {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests/fixtures/list-lower-bounds.{name}.txt"));
        if std::env::var_os("SNAPBACK4_UPDATE_LIST_SNAPSHOTS").is_some() { std::fs::write(&path, &actual).unwrap(); }
        assert_eq!(actual, std::fs::read_to_string(&path).unwrap(), "{name}");
    }
}

#[test]
fn generated_bounds_preserve_nested_element_constraints() {
    let b = bound("query q(names: [[text 1..20 format handle] 1..2] <=3 ?, cursors: [cursor] 1..2):\n  return names\n");
    let api = snapback4_lang::emit::typescript(&b);
    assert!(api.contains("Bounds: cursors: [cursor] 1..2; names: [[text 1..20 format handle] 1..2] <=3 ?."), "{api}");
}

#[test]
fn adoption_checks_existing_rows_before_narrowing_and_allows_widening() {
    use snapback4_core::successor::{Change, classify};
    let source = "table groups:\n  peers: [principal] <=49\n  public\n";
    let old = bound(source);
    let new = bound(&source.replace("<=49", "1..49"));
    assert_eq!(classify(&old.schema, &new.schema)[0].change, Change::Narrowing);
    assert_eq!(classify(&new.schema, &old.schema)[0].change, Change::Additive);
    for n in [0, 1] {
        let mut e = Engine::memory(old.schema.clone(), []).unwrap();
        e.seed([("groups".into(), snapback4_core::value::object([
            ("id", Value::Id("g".into())), ("peers", Value::Array(vec![Value::Id("bob".into()); n]))
        ]))]).unwrap();
        let adoption = e.adopt(new.schema.clone(), []);
        assert_eq!(adoption.is_ok(), n == 1, "{adoption:?}");
        if n == 0 { let error = adoption.unwrap_err(); assert_eq!(error.code(), "E_ADOPT"); assert!(error.to_string().contains("peers"), "{error}"); }
        else { e.adopt(old.schema.clone(), []).unwrap(); }
        assert_eq!(e.store().rows("groups").unwrap().len(), 1);
    }
}
