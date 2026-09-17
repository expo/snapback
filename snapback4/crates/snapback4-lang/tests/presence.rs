//! Presence may decide effects, but never the rows or result a device predicts.
use snapback4_core::schema::SiteClass;
use snapback4_lang::{Bound, bind::residency, guide};

const TABLE: &str = "effect notify\ntable notes:\n  n: int\n  unique byN: n\n  public 'notes'\n  sync public\n  insert <- allow\n  update <- allow\n  delete <- allow\n";
const REWRITE: &str = "decide only the emit with presence; read it on the server in a service mutation for anything else";

fn compile(body: &str) -> Bound {
    let source = format!("{TABLE}\nmutation probe(p: principal):\n{body}\n");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

#[test]
fn presence_effects_card_and_language_send_predict() {
    for (source, name) in [(guide::quarry(guide::card("effects").unwrap()).remove(0), "send"), (guide::language(), "sendBrief")] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let fact = &bound.schema.operations[name];
        println!("{}", residency::operation_lines(name, fact));
        assert_eq!(fact.predicts.as_deref(), Some("eligible"));
        assert_eq!(serde_json::to_value(fact).unwrap()["connected_effects_only"], true);
        assert!(residency::operation_lines(name, fact).contains("connected: decides effects only — the server decides who is notified at commit"));
        assert!(snapback4_lang::emit::typescript(&bound).contains("connected: decides effects only"));
    }
}

#[test]
fn presence_aliases_payloads_and_nested_emit_arms_predict() {
    for body in [
        "  insert notes { n: 1 }\n  emit notify { count: connected[p] }",
        "  n = connected[p]\n  n = n\n  counts = [0]\n  counts = counts + [n]\n  insert notes { n: 1 }\n  emit notify { counts }",
        "  absent = not exists connected[p]\n  insert notes { n: 1 }\n  if absent:\n    if p != viewer:\n      emit notify { p }\n    else:\n      emit notify { self: true }\n  else if exists connected[viewer]:\n    emit notify { self: false }",
        "  for i in range(0, 2):\n    insert notes { n: i }\n    if p != viewer and not exists connected[p]:\n      emit notify { p }",
        "  insert notes { n: 1 }\n  if not exists connected[p] and p != viewer:\n    emit notify { count: connected[p] }\n  else if exists connected[viewer] and p = viewer:\n    emit notify { self: true }",
        "  insert notes { n: 1 }\n  emit notify { n: 2 if exists connected[p] else 3 }",
        "  insert notes { n: 1 }\n  row = notes[1]\n  if not exists connected[p]:\n    emit notify { row }",
    ] {
        let bound = compile(body);
        let fact = &bound.schema.operations["probe"];
        assert_eq!(fact.predicts.as_deref(), Some("eligible"), "{body}\n{}", residency::operation_lines("probe", fact));
    }
}

#[test]
fn presence_non_effect_uses_keep_precise_server_reasons() {
    for (name, body, usage) in [
        ("require", "  require exists connected[p] else X", "decides a require X"),
        ("write", "  if exists connected[p]:\n    insert notes { n: 1 }", "decides a write"),
        ("return", "  return connected[p]", "decides the returned value"),
        ("alias", "  n = connected[p]\n  insert notes { n }", "decides a write row"),
        ("break", "  for i in range(0, 2):\n    if exists connected[p]:\n      break\n    insert notes { n: i }", "decides break"),
        ("key", "  emit notify { row: notes[connected[p]] }", "decides a read key"),
        ("implicit", "  n = 0\n  if exists connected[p]:\n    n = 1\n  insert notes { n }", "decides an assignment"),
        ("effect_assignment", "  n = 0\n  if exists connected[p]:\n    n = 1\n  emit notify { n }", "decides an assignment"),
        ("push", "  ns = [0]\n  ns = ns + [connected[p]]\n  insert notes { n: count(ns) }", "decides a write row"),
        ("loop", "  for i in range(0, connected[p]):\n    emit notify { i }", "decides a loop domain"),
        ("continue", "  for i in range(0, 2):\n    if exists connected[p]:\n      continue\n    insert notes { n: i }", "decides continue"),
        ("loop_carried", "  n = 0\n  for i in range(0, 2):\n    insert notes { n }\n    n = connected[p]", "decides a write row"),
        ("break_exit", "  n = 0\n  for i in range(0, 2):\n    n = connected[p]\n    if i = 0:\n      break\n    n = 0\n  insert notes { n }", "decides a write row"),
        ("continue_exit", "  n = 0\n  for i in range(0, 2):\n    insert notes { n }\n    n = connected[p]\n    if i = 0:\n      continue\n    n = 0", "decides a write row"),
        ("update", "  update notes[connected[p]] { n: 1 }", "decides a write key"),
        ("patch", "  update notes[1] { n: connected[p] }", "decides a write patch"),
        ("delete", "  delete notes[connected[p]]", "decides a write key"),
        ("upsert", "  upsert notes[1] { n: connected[p] }", "decides a write patch"),
        ("absent", "  insert notes { n: connected[p] } if absent", "decides a write row"),
        ("condition", "  update notes[1] { n: 2 } if exists connected[p]", "decides a write condition"),
        ("filter", "  emit notify { rows: notes first 2 by byN where .n = connected[p] }", "decides a read condition"),
        ("else_write", "  if exists connected[p]:\n    emit notify { p }\n  else:\n    insert notes { n: 1 }", "decides a write"),
    ] {
        let bound = compile(body);
        let fact = &bound.schema.operations["probe"];
        println!("{name}:\n{}", residency::operation_lines("probe", fact));
        assert_eq!(fact.predicts.as_deref(), Some("never"), "{name}");
        assert!(fact.sites.iter().any(|site| site.class == SiteClass::Server && site.reason.contains(usage) && site.reason.contains("connected[p]") && site.rewrite == REWRITE), "{name}: {fact:?}");
    }
}

#[test]
fn presence_class_change_notes_only_report_lost_eligibility() {
    let before = compile("  emit notify { n: connected[p] }");
    let after = compile("  return connected[p]");
    let notes = residency::change_notes(&after, &before.schema.operations);
    assert!(notes.iter().any(|note| note.code == "N_NOT_PREDICTABLE" && note.message.contains("returned value") && note.rewrite == REWRITE));
    assert!(residency::change_notes(&before, &after.schema.operations).is_empty());
}

#[test]
fn r1p_helpers_in_conditions_and_payloads_keep_population_admission() {
    let mut missing = Vec::new();
    for helper in [
        "fn visit():\n  for r in notes first 1 by byN:\n    update notes[r.id] { n: r.n }\n  return true\n",
        "fn visit():\n  for r in notes first 10 by byN:\n    return true\n  return false\n",
    ] {
        for body in ["  if visit():\n    emit notify { ok: true }", "  emit notify { ok: visit() }", "  if visit():\n    return true"] {
            let source = format!("{TABLE}\n{helper}\nmutation probe():\n{body}\n");
            let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
            println!("{source}\n{:?}", bound.diagnostics);
            if !bound.diagnostics.iter().any(|d| d.code == "E_STRUCTURAL_FANOUT" && d.message.contains("no cap")) { missing.push(source.clone()); }
            let positive = snapback4_lang::compile(&[("schema.q".into(), source.replace("mutation probe():", "mutation probe(): server"))]);
            assert!(positive.diagnostics.is_empty(), "{:?}", positive.diagnostics);
        }
    }
    assert!(missing.is_empty(), "admitted uncapped helper loops:\n{}", missing.join("\n"));
}

#[test]
fn r1p_condition_setup_retains_ten_steps() {
    use snapback4_core::{Context, Engine, Ceilings, Value, WriteState};
    let bound = compile("  if true and true:\n    return 1");
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.set_ceilings(Ceilings { steps: 10, ..Ceilings::default() });
    let outcome = engine.mutate("probe", None, Context::new("alice", [("p".into(), Value::Id("bob".into()))].into()).at(1)).unwrap();
    println!("ten-step probe: {outcome:?}");
    assert!(matches!(outcome.state, WriteState::Sent { result: Value::Int(1), .. }));
    assert_eq!(outcome.metered.steps, 10);
}

#[test]
fn r1p_two_conditions_keep_distinct_error_sites() {
    use snapback4_core::{Context, Engine, Ceilings, Value, WriteState};
    let bound = compile("  if p = viewer and slice('abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz', 0, 70) != '':\n    return 1\n  if p != viewer and slice('abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz', 0, 70) != '':\n    return 2");
    let mut sites = Vec::new();
    for p in ["alice", "bob"] {
        let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        // A tiny heap ceiling cuts inside the selected condition's setup.
        engine.set_ceilings(Ceilings { heap_bytes: 40, ..Ceilings::default() });
        let outcome = engine.mutate("probe", None, Context::new("alice", [("p".into(), Value::Id(p.into()))].into()).at(1)).unwrap();
        let WriteState::Failed { why, .. } = outcome.state else { panic!("{outcome:?}") };
        println!("condition p={p}: {why:?}");
        sites.push(why.site.unwrap());
    }
    assert_ne!(sites[0], sites[1]);
    assert!(sites.iter().all(|site| site.starts_with("probe:")), "{sites:?}");
}

#[test]
fn r1p_presence_division_is_a_refusal_dependency() {
    let bound = compile("  insert notes { n: 1 }\n  emit notify { ratio: 1 / connected[p] }");
    let fact = &bound.schema.operations["probe"];
    println!("{}", residency::operation_lines("probe", fact));
    assert_eq!(fact.predicts.as_deref(), Some("never"));
    assert!(fact.sites.iter().any(|s| s.reason.contains("fallible")));
}

#[test]
fn r1p_fallible_and_variable_size_presence_evaluation_never_predicts() {
    let mut missing = Vec::new();
    for body in [
        "  insert notes { n: 1 }\n  emit notify { count: connected[p] + 1 }",
        "  n = connected[p]\n  n = n + 1\n  counts = [0]\n  counts = counts + [n]\n  insert notes { n: 1 }\n  emit notify { counts }",
        "  insert notes { n: 1 }\n  if not exists connected[p] and p != viewer:\n    emit notify { count: connected[p] + 1 }\n  else if exists connected[viewer] and p = viewer:\n    emit notify { self: true }",
        "  insert notes { n: 1 }\n  if not exists connected[p]:\n    emit notify { row: notes[1] }",
        "  emit notify { n: connected[p] * 9007199254740991 }",
        "  emit notify { n: 0 - connected[p] }",
        "  emit notify { n: slice('abc', 0, connected[p]) }",
        "  if not exists connected[p]:\n    emit notify { key: new }",
        "  if not exists connected[p]:\n    emit notify { n: 1 / 0 }",
        "  emit notify { digest: sha256('high-entropy-token') if exists connected[p] else 'not-sent' }",
        "  emit notify { text: 'a long value' if exists connected[p] else '' }",
        "  emit notify { values: [1, 2] if exists connected[p] else [1] }",
        "  if exists connected[p]:\n    emit notify { row: notes[1] ! else MISSING }",
    ] {
        let bound = compile(body);
        let fact = &bound.schema.operations["probe"];
        println!("totality: {body}\n{}", residency::operation_lines("probe", fact));
        if fact.predicts.as_deref() != Some("never") || !fact.sites.iter().any(|s| s.reason.contains("fallible") || s.reason.contains("variable-size") || s.reason.contains("a require")) { missing.push(body); }
    }
    assert!(missing.is_empty(), "eligible unsafe evaluation:\n{}", missing.join("\n"));
}
