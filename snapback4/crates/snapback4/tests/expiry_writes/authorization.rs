use super::*;
use snapback4_core::{Ceilings, ir::{Expr, Stmt}, value::object};

const BASE: &str = r#"
table records:
  key: text <=30
  amount: int
  until: time ?
  unique byKey: key
  expire at .until
  read <- exists grants[.id, viewer]
  insert <- allow
  update <- allow
  delete <- allow
  online only
table grants:
  record: records
  principal: principal
  unique record, principal
  public
  online only
table work:
  record: records
  read <- exists grants[.record, viewer]
  online only
"#;

const FORMS: &[(&str, &str)] = &[
    ("updateId", "update records[id = 'target'] { amount: 2 }"),
    ("updateKey", "update records[key = 'key'] { amount: 2 }"),
    ("upsertId", "upsert records[id = 'target'] { key: 'key', amount: 2, until: null }"),
    ("upsertKey", "upsert records[key = 'key'] { amount: 2, until: null }"),
    ("deleteKey", "delete records[key = 'key']"),
    ("deleteId", "delete records[id = 'target']"),
    ("insertId", "insert records { id: 'target', key: 'other', amount: 2, until: null }"),
    ("insertKey", "insert records { id: 'new', key: 'key', amount: 2, until: null }"),
    ("quietId", "insert records { id: 'target', key: 'other', amount: 2, until: null } if absent"),
    ("quietKey", "insert records { id: 'new', key: 'key', amount: 2, until: null } if absent"),
];

fn bound(expiring: bool) -> snapback4_lang::Bound {
    let mut source = BASE.to_owned();
    if !expiring { source = source.replace("  expire at .until\n", ""); }
    for (name, statement) in FORMS.iter().copied().chain([("warm", "return null")]) {
        source.push_str(&format!("\nmutation {name}(n: int): server\n  for i in range(0, n):\n    prior = work['work']\n  {statement}\n  return null\n"));
    }
    let mut b = compile(&source);
    // Old serialized by-id Update/Upsert remain executable, independently of
    // the current compiler's WriteTarget lowering. Cover that boundary too.
    for (original, name) in [("updateId", "legacyUpdate"), ("upsertId", "legacyUpsert"), ("deleteKey", "rawDeleteTargetId")] {
        let mut p = b.programs.iter().find(|p| p.program.name == original).unwrap().clone();
        p.program.name = name.into();
        let target = p.program.body.iter_mut().find(|stmt| matches!(stmt, Stmt::WriteTarget { .. } | Stmt::DeleteTarget { .. })).unwrap();
        *target = match target.clone() {
            Stmt::WriteTarget { target, patch, upsert: false, .. } => Stmt::Update { table: target.table, key: target.key[0].clone(), patch },
            Stmt::WriteTarget { target, .. } => Stmt::Upsert { table: target.table, key: target.key[0].clone(), row: Expr::Literal(record("target", Value::Null)) },
            Stmt::DeleteTarget { mut target } => { target.index = "byId".into(); target.key = vec![Expr::Literal(Value::Id("target".into()))]; Stmt::DeleteTarget { target } }
            _ => unreachable!(),
        };
        b.programs.push(p);
    }
    b
}

fn record(id: &str, until: Value) -> Value {
    object([("id", Value::Id(id.into())), ("key", Value::String("key".into())), ("amount", Value::Int(1)), ("until", until)])
}

fn engine(b: &snapback4_lang::Bound, world: &str) -> Engine {
    let mut e = Engine::memory(b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap();
    let mut rows = vec![
        ("work".into(), object([("id", Value::Id("work".into())), ("record", Value::Id("permitted".into()))])),
        ("grants".into(), object([("id", Value::Id("grant".into())), ("record", Value::Id("permitted".into())), ("principal", Value::Id("alice".into()))])),
    ];
    match world {
        "hidden" => rows.push(("records".into(), record("target", Value::Null))),
        "expired-id" => rows.push(("records".into(), record("target", Value::Int(1)))),
        "expired-siblings" => rows.extend((0..9_000).map(|n| ("records".into(), record(&format!("old{n:05}"), Value::Int(1))))),
        "absent" => (),
        _ => unreachable!(),
    }
    e.load(rows).unwrap();
    e
}

fn call(e: &mut Engine, name: &str, probes: i64) -> snapback4_core::engine::MutationOutcome {
    e.mutate(name, None, Context::new("alice", BTreeMap::from([("n".into(), Value::Int(probes))])).at(100).with_ids(["new".into()])).unwrap()
}

fn pairs(probes: i64) {
    let mut checked = 0;
    for expiring in [false, true] {
        let b = bound(expiring);
        if probes != 0 {
            let warm = call(&mut engine(&b, "absent"), "warm", probes);
            assert!(matches!(warm.state, WriteState::Sent { .. }), "{warm:?}");
            assert_eq!(warm.metered.rule_probes, 8_192, "the prelude really spends the default allowance");
        }
        for name in FORMS.iter().map(|(name, _)| *name).chain(["legacyUpdate", "legacyUpsert", "rawDeleteTargetId"]) {
            let mut baseline = None;
            for world in if expiring { & ["absent", "hidden", "expired-id", "expired-siblings"][..] } else { & ["absent", "hidden"][..] } {
                let mut e = engine(&b, world);
                if probes == 0 { e.set_ceilings(Ceilings { rule_probes: 0, ..Ceilings::default() }); }
                let before = e.store().rows("records").unwrap();
                let out = call(&mut e, name, probes);
                assert_eq!(e.store().rows("records").unwrap(), before, "{name}/{world}: refusal rolls back storage");
                let WriteState::Failed { why, .. } = &out.state else { panic!("{name}/{world}/{probes}/{expiring}: {out:?}") };
                assert_eq!(why.code, "E_BOUND", "{name}/{world}/{probes}/{expiring}: {out:?}");
                assert!(why.message.contains("rule"), "authorization must refuse before lookup or expiry charges: {out:?}");
                let attempted = if matches!(name, "insertId" | "insertKey" | "quietId" | "quietKey") { 1 } else { 0 };
                assert_eq!(out.metered.rule_probes, probes as u64 + attempted, "fixed insert reservation records the attempted charge before any lookup");
                let whole = serde_json::to_value(&out).unwrap();
                if let Some(prior) = baseline.replace(whole.clone()) { assert_eq!(whole, prior, "{name}/{world}/{probes}/{expiring}"); }
                checked += 1;
            }
        }
    }
    assert_eq!(checked, 78);
}

#[test]
fn every_write_target_reserves_authorization_with_zero_rule_probe_budget() { pairs(0); }

#[test]
fn every_write_target_reserves_authorization_after_8192_real_rule_probes() { pairs(8_192); }

#[test]
fn write_targets_reserve_even_the_read_probes_that_would_short_circuit() {
    let mut b = bound(true);
    let table = b.schema.tables.get_mut("records").unwrap();
    let read = table.rules.read.clone();
    table.rules.read = snapback4_core::schema::RuleExpr::And(vec![read.clone(), read]);
    for name in FORMS.iter().map(|(name, _)| *name).chain(["legacyUpdate", "legacyUpsert", "rawDeleteTargetId"]) {
        let mut baseline = None;
        for world in ["absent", "hidden"] {
            let mut e = engine(&b, world);
            // The first probe would deny: executing the rule could spend just
            // one, but target-independent reservation must allow both probes.
            e.set_ceilings(Ceilings { rule_probes: 1, ..Ceilings::default() });
            let before = e.store().rows("records").unwrap();
            let out = call(&mut e, name, 0);
            assert!(matches!(&out.state, WriteState::Failed { why, .. } if why.code == "E_BOUND" && why.message.contains("rule")), "{name}/{world}: {out:?}");
            assert_eq!(out.metered.rule_probes, if matches!(name, "insertId" | "insertKey" | "quietId" | "quietKey") { 2 } else { 0 });
            assert_eq!(e.store().rows("records").unwrap(), before);
            let whole = serde_json::to_value(&out).unwrap();
            if let Some(prior) = baseline.replace(whole.clone()) { assert_eq!(whole, prior, "{name}"); }
        }
    }
}

#[test]
fn alternate_key_delete_requires_read_authority_even_when_delete_is_allowed() {
    for expiring in [false, true] {
        let b = bound(expiring);
        let mut e = engine(&b, "hidden");
        let before = e.store().rows("records").unwrap();
        let hidden = call(&mut e, "deleteKey", 0);
        let absent = call(&mut engine(&b, "absent"), "deleteKey", 0);
        assert!(matches!(&hidden.state, WriteState::Failed { why, .. } if why.code == "NOT_FOUND"), "{hidden:?}");
        assert_eq!(serde_json::to_value(&hidden).unwrap(), serde_json::to_value(&absent).unwrap());
        assert_eq!(e.store().rows("records").unwrap(), before, "delete <- allow never substitutes for alternate-key read authority");
        // Positive control: granting the read permits exactly that deletion.
        e.load([("grants".into(), object([("id", Value::Id("visible".into())), ("record", Value::Id("target".into())), ("principal", Value::Id("alice".into()))]))]).unwrap();
        assert!(matches!(call(&mut e, "deleteKey", 0).state, WriteState::Sent { .. }));
        assert!(e.store().rows("records").unwrap().is_empty());
    }
}
