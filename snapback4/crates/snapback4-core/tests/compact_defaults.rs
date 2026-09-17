//! Every skip predicate in the backend's derived source files has both states.
use serde::{Serialize, de::DeserializeOwned};
use snapback4_core::{compact, ir::*, schema::*, maintain::{CalendarKey, Predicate}, Value};
use std::{collections::BTreeMap, fmt::Debug};

fn round<T: Serialize + DeserializeOwned + PartialEq + Debug>(value: &T) {
    let restored: T = compact::from_slice(&compact::to_vec(value).unwrap()).unwrap();
    assert_eq!(&restored, value);
    let restored: T = snapback4_core::json_codec::from_text(&snapback4_core::json_codec::to_text(value).unwrap()).unwrap();
    assert_eq!(&restored, value);
}
fn pair<T: Serialize + DeserializeOwned + PartialEq + Debug>(covered: &mut Vec<String>, fields: &[(&str, &str)], absent: T, present: T) {
    round(&absent); round(&present);
    let off = serde_json::to_value(&absent).unwrap();
    let on = serde_json::to_value(&present).unwrap();
    for (field, pointer) in fields {
        assert!(off.pointer(pointer).is_none(), "{} {field} should skip: {off}", std::any::type_name::<T>());
        assert!(on.pointer(pointer).is_some(), "{} {field} should be present: {on}", std::any::type_name::<T>());
        covered.push((*field).to_owned());
    }
}
fn literal() -> Expr { Expr::Literal(Value::Bool(true)) }
fn scan() -> Scan {
    serde_json::from_value(serde_json::json!({"site":"s","table":"t","index":"byId","prefix":[],"order":"Asc","take":{"Literal":1},"provenance":"Const"})).unwrap()
}
fn table() -> Table {
    Table { residency: Residency::default(), defaults: BTreeMap::new(), columns: BTreeMap::new(), indexes: BTreeMap::new(), rules: Rules::deny(), constraints: vec![], leave: LeavePolicy::UntilRevoked, sync: None, expire: None }
}
fn residency() -> Residency { Residency { online_only: true, inferred: true, inherited_from: Some("source".into()) } }

#[test]
fn every_backend_skip_predicate_round_trips_in_both_states() {
    let mut covered = Vec::new();
    let mut check = |fields, off, on| pair(&mut covered, fields, off, on);
    let mut full = Schema::default();
    full.auth.password = true;
    full.effects = vec!["send".into()];
    full.schedules = vec![Schedule { name: "night".into(), every_ms: 1000, offset_ms: 0, target: "job".into(), service: None }];
    full.operations.insert("q".into(), Execution::default());
    full.unique_refusals.insert("t".into(), BTreeMap::from([("i".into(), UniqueRefusal { code: "TAKEN".into(), message: "taken".into() })]));
    full.action_specs.insert("a".into(), ActionSpec::default());
    full.effect_specs.insert("e".into(), WorkSpec::default());
    full.routes.insert("r".into(), serde_json::from_value(serde_json::json!({"path":"/r"})).unwrap());
    check(&[("auth","/auth"),("effects","/effects"),("schedules","/schedules"),("operations","/operations"),("unique_refusals","/unique_refusals"),("action_specs","/action_specs"),("effect_specs","/effect_specs"),("routes","/routes")], Schema::default(), full);
    pair(&mut covered, &[("held","/held"),("components","/components"),("runs","/runs"),("predicts","/predicts"),("connected_effects_only","/connected_effects_only"),("prediction_guards","/prediction_guards")], Execution::default(), Execution {
        held: true, components: vec![Component { field: "x".into(), statements: vec![0] }], runs: Some("device".into()), predicts: Some("eligible".into()), connected_effects_only: true, prediction_guards: vec!["g".into()], ..Execution::default()
    });
    pair(&mut covered, &[("online_only","/online_only"),("inferred","/inferred"),("inherited_from","/inherited_from")], Residency::default(), residency());
    let off = Schedule { name: "n".into(), every_ms: 1, offset_ms: 0, target: "j".into(), service: None };
    pair(&mut covered, &[("service","/service")], off.clone(), Schedule { service: Some("service:s".into()), ..off });
    let sync = Sync { audience: Audience::Public, horizon: None };
    pair(&mut covered, &[("horizon","/horizon")], sync.clone(), Sync { horizon: Some(Horizon { last: 3, by: "byId".into() }), ..sync.clone() });
    pair(&mut covered, &[("residency","/residency"),("defaults","/defaults"),("sync","/sync"),("expire","/expire")], table(), Table {
        residency: residency(), defaults: BTreeMap::from([("x".into(), ColumnDefault::Literal(Value::Int(2)))]), sync: Some(sync), expire: Some("at".into()), ..table()
    });
    pair(&mut covered, &[("once","/Image/once")], ColumnType::Image { max: 2, once: false }, ColumnType::Image { max: 2, once: true });
    for created in [false, true] {
        let make = |equalities| if created { RuleExpr::Created { table: "t".into(), index: "i".into(), key: vec![], provenance: KeyProvenance::Const, equalities } }
            else { RuleExpr::Exists { table: "t".into(), index: "i".into(), key: vec![], provenance: KeyProvenance::Const, equalities } };
        pair(&mut covered, &[("equalities", if created { "/Created/equalities" } else { "/Exists/equalities" })], make(vec![]), make(vec![("x".into(), RuleTerm::Literal(Value::Int(2)))]));
    }
    pair(&mut covered, &[("format","/Text/format")], Constraint::Text { field: "x".into(), min: 0, format: None }, Constraint::Text { field: "x".into(), min: 0, format: Some(TextFormat::Handle) });
    let calendar = CalendarKey { function: "day".into(), column: "at".into(), millis: 86_400_000, offset: 0 };
    pair(&mut covered, &[("offset","/offset")], calendar.clone(), CalendarKey { offset: 123, ..calendar.clone() });
    let maintain = Maintain { filter: None, computed: BTreeMap::new(), residency: Residency::default(), kind: MaintainKind::Count, source: "t".into(), by: vec![], target: "count".into(), readable: None };
    pair(&mut covered, &[("filter","/filter"),("computed","/computed"),("residency","/residency")], maintain.clone(), Maintain { filter: Some(Predicate::Bool(true)), computed: BTreeMap::from([("day".into(), calendar)]), residency: residency(), ..maintain });
    let route: RouteSpec = serde_json::from_value(serde_json::json!({"path":"/route"})).unwrap();
    assert_eq!(route.wait_ms, 5_000);
    pair(&mut covered, &[("service","/service")], route.clone(), RouteSpec { service: Some("service:s".into()), ..route });
    let response = routes::RouteResponse { status: 200, headers: vec![], body_hex: String::new(), application_refusal: None };
    pair(&mut covered, &[("application_refusal","/applicationRefusal")], response.clone(), routes::RouteResponse { application_refusal: Some("closed".into()), ..response });
    let program = Program { name: "q".into(), kind: ProgramKind::Query, args: BTreeMap::new(), read_time_granularity_ms: None, body: vec![Stmt::Return(literal())], native: false };
    pair(&mut covered, &[("native","/native")], program.clone(), Program { native: true, ..program });
    pair(&mut covered, &[("min","/Text/min"),("format","/Text/format")], ArgType::Text { min: 0, max: 30, format: None }, ArgType::Text { min: 2, max: 30, format: Some(TextFormat::Url) });
    pair(&mut covered, &[("of","/List/of")], ArgType::List { of: None, max: 2 }, ArgType::List { of: Some(Box::new(ArgType::Int)), max: 2 });
    pair(&mut covered, &[("site","/Require/site")], Stmt::Require { condition: literal(), code: "NO".into(), site: None }, Stmt::Require { condition: literal(), code: "NO".into(), site: Some("s".into()) });
    pair(&mut covered, &[("existence","/existence"),("filter","/filter"),("opaque_cursor","/opaque_cursor")], scan(), Scan { existence: true, filter: Some(Box::new(literal())), opaque_cursor: true, ..scan() });
    let lane = MergeLane { setup: vec![], scan: scan(), source: None, binding: "i".into() };
    pair(&mut covered, &[("setup","/setup")], lane.clone(), MergeLane { setup: vec![Stmt::Let { name: "x".into(), value: literal() }], ..lane });
    // A new skip predicate, even on an already-covered field name in another
    // type, adds a count and fails until its absent/present pair is supplied.
    let mut declared = Vec::new();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    fn sources(path: &std::path::Path, out: &mut Vec<String>) {
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() { sources(&path, out); }
            else if path.extension().is_some_and(|e| e == "rs") { out.push(std::fs::read_to_string(path).unwrap()); }
        }
    }
    let mut texts = Vec::new();
    for name in ["ir", "schema", "maintain"] {
        texts.push(std::fs::read_to_string(root.join(format!("{name}.rs"))).unwrap());
        let path = root.join(name);
        if path.is_dir() { sources(&path, &mut texts); }
    }
    for source in texts {
        assert!(!source.contains("skip_deserializing"), "compact fields must be consumed by their derive");
        for tail in source.split("skip_serializing").skip(1) {
            assert!(tail.starts_with("_if"), "only conditional skips call SerializeStruct::skip_field");
        }
        for tail in source.split("skip_serializing_if").skip(1) {
            let after = tail.split_once(")]").unwrap().1.trim_start().strip_prefix("pub ").unwrap_or(tail.split_once(")]").unwrap().1.trim_start());
            declared.push(after.split(':').next().unwrap().trim().to_owned());
        }
    }
    covered.sort(); declared.sort();
    assert_eq!(covered, declared);
    println!("compact skip audit: {} predicates, each absent and present", covered.len());
}

#[test]
fn declared_route_and_container_defaults_apply_to_absent_positions() {
    let route: RouteSpec = serde_json::from_value(serde_json::json!({"path":"/route"})).unwrap();
    let mut bytes = compact::to_vec(&route).unwrap();
    assert!(bytes.ends_with(&[1, 0x88, 0x27])); // Present wait_ms = 5,000.
    bytes.truncate(bytes.len() - 3); bytes.push(0);
    assert_eq!(compact::from_slice::<RouteSpec>(&bytes).unwrap(), route);
    assert_eq!(compact::from_slice::<WorkPolicy>(&[0, 0, 0, 0]).unwrap(), WorkPolicy::default());
}
