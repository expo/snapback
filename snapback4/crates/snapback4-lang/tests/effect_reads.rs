//! The compiler's effect-only slice preserves every non-effect dependency.
use snapback4_lang::{bind::residency, Bound};

const TABLES: &str = "effect notify\ntable profiles:\n  principal: principal\n  displayName: text <=80\n  n: int\n  unique principal\n  cap 100\n  public 'profiles'\n  online only\ntable notes:\n  n: int\n  cap 100\n  public 'notes'\n  sync public\n  insert <- allow\n";

fn compile(body: &str) -> Bound {
    let source = format!("{TABLES}\nmutation probe(p: principal):\n{body}\n");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

#[test]
fn infallible_effect_payload_reads_are_server_only_with_source_sites() {
    for body in [
        "  emit notify { name: profiles[principal = viewer].displayName }",
        "  if not exists connected[p]:\n    emit notify { name: profiles[principal = viewer].displayName }",
        "  name = profiles[principal = viewer].displayName\n  alias = name\n  emit notify { alias }",
        "  if not exists connected[p]:\n    profile = profiles[principal = viewer]\n    name = profile.displayName\n    alias = name ?? 'Someone'\n    emit notify { text: 'From ' + lower(alias) }",
        "  if not exists connected[p]:\n    n = profiles[principal = viewer].n ?? 0\n    emit notify { ratio: n / 2, label: 3 * 7 }",
        "  if not exists connected[p]:\n    emit notify { exists: exists profiles[principal = viewer] }",
        "  for i in range(0, 2):\n    if not exists connected[p]:\n      name = profiles[principal = viewer].displayName\n      emit notify { name, i }\n    insert notes { n: i }",
        "  emit notify { name: profiles[principal = viewer].displayName } once [p]",
    ] {
        let bound = compile(body);
        let fact = &bound.schema.operations["probe"];
        let why = residency::operation_lines("probe", fact);
        assert_eq!(fact.predicts.as_deref(), Some("eligible"), "{body}\n{why}");
        assert_eq!(fact.effect_payload_reads.len(), 1, "{body}\n{why}");
        assert!(fact.sites.iter().all(|site| site.table != "profiles"), "{why}");
        assert!(why.contains("server-only, feeds an effect") && why.contains("schema.q:") && why.contains("charged on the server only"), "{why}");
        assert!(!fact.prediction_skips.is_empty());
    }
}

#[test]
fn total_text_payloads_keep_guarded_and_unguarded_mutations_eligible() {
    for expression in ["sha256(x ?? '')", "join([x ?? ''], '')"] {
        for guarded in [false, true] {
            let (guard, indent) = if guarded { ("  if not exists connected[p]:\n", "    ") } else { ("", "  ") };
            let bound = compile(&format!("{guard}{indent}x = profiles[principal = viewer].displayName\n{indent}emit notify {{ text: {expression} }}"));
            let fact = &bound.schema.operations["probe"];
            let why = residency::operation_lines("probe", fact);
            assert_eq!(fact.predicts.as_deref(), Some("eligible"), "{expression}, guarded={guarded}: {why}");
            assert_eq!(fact.effect_payload_reads.len(), 1, "{why}");
            assert!(fact.sites.iter().all(|site| site.table != "profiles"), "{why}");
            assert!(why.contains("server-only, feeds an effect"), "{why}");
        }
    }
}

#[test]
fn shared_reads_and_fallible_payload_work_still_cost_prediction() {
    for body in [
        "  if not exists connected[p]:\n    name = profiles[principal = viewer].displayName\n    if name != null:\n      emit notify { name }",
        "  name = profiles[principal = viewer].displayName\n  emit notify { name }\n  return name",
        "  n = profiles[principal = viewer].n ?? 0\n  emit notify { n }\n  insert notes { n }",
        "  name = profiles[principal = viewer].displayName\n  emit notify { name }\n  require name != null else MISSING",
        "  name = profiles[principal = viewer].displayName\n  unused = name\n  emit notify { name }",
        "  n = profiles[principal = viewer].n ?? 0\n  for i in range(0, n):\n    emit notify { n, i }",
        "  if not exists connected[p]:\n    emit notify { profile: profiles[principal = viewer] ! else MISSING }",
        "  if not exists connected[p]:\n    n = profiles[principal = viewer].n ?? 0\n    emit notify { ratio: 1 / n }",
        "  if not exists connected[p]:\n    n = profiles[principal = viewer].n ?? 0\n    emit notify { ratio: n / 0 }",
        "  if not exists connected[p]:\n    n = profiles[principal = viewer].n ?? 0\n    emit notify { remainder: n % 0 }",
        "  if not exists connected[p]:\n    n = profiles[principal = viewer].n ?? 0\n    emit notify { n: n + 1 }",
        "  n = 0\n  for i in range(0, 2):\n    insert notes { n }\n    n = profiles[principal = viewer].n ?? 0\n    emit notify { n }",
        "  n = 0\n  for i in range(0, 2):\n    n = profiles[principal = viewer].n ?? 0\n    emit notify { n }\n    if i = 0:\n      break\n    n = 0\n  return n",
    ] {
        let bound = compile(body);
        let fact = &bound.schema.operations["probe"];
        assert_eq!(fact.predicts.as_deref(), Some("never"), "{body}\n{}", residency::operation_lines("probe", fact));
        assert!(fact.effect_payload_reads.is_empty(), "{body}");
    }
}

#[test]
fn query_and_non_effect_point_reads_keep_their_residency() {
    let bound = compile("  return profiles[principal = viewer].displayName");
    assert_eq!(bound.schema.operations["probe"].predicts.as_deref(), Some("never"));
    let bound = snapback4_lang::compile(&[("schema.q".into(), format!("{TABLES}\nquery profile():\n  return profiles[principal = viewer]\n"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.schema.operations["profile"].runs.as_deref(), Some("server"));
}

#[test]
fn effect_presence_survives_the_slice_without_binder_source_metadata() {
    let bound = compile("  emit notify { profile: profiles[principal = viewer], online: exists connected[p] }");
    let inferred = residency::execution(&bound.schema, &bound.programs[0].program);
    assert!(inferred.connected_effects_only);
    assert_eq!(inferred.predicts.as_deref(), Some("eligible"));
    assert_eq!(inferred.prediction_skips, bound.schema.operations["probe"].prediction_skips);
    assert_eq!(inferred.effect_payload_reads.len(), 1);
}

#[test]
fn nested_coalescing_keeps_all_fallback_work_in_the_effect_slice() {
    let bound = compile("  if not exists connected[p]:\n    name = profiles[principal = viewer].displayName ?? profiles[principal = p].displayName ?? 'Someone'\n    emit notify { name }");
    let fact = &bound.schema.operations["probe"];
    assert_eq!(fact.predicts.as_deref(), Some("eligible"), "{}", residency::operation_lines("probe", fact));
    assert_eq!(fact.effect_payload_reads.len(), 2);
    let shared = compile("  name = profiles[principal = viewer].displayName ?? profiles[principal = p].displayName ?? 'Someone'\n  emit notify { name }\n  return name");
    assert_eq!(shared.schema.operations["probe"].predicts.as_deref(), Some("never"));
}

#[test]
fn clique_send_in_prediction_card_is_eligible_without_hoisting() {
    let blocks = snapback4_lang::guide::quarry(snapback4_lang::guide::card("prediction").unwrap());
    let bound = snapback4_lang::compile(&[("schema.q".into(), blocks.into_iter().find(|block| block.contains("mutation send(")).unwrap())]);
    assert!(bound.diagnostics.is_empty() && bound.notes.is_empty(), "{:?} {:?}", bound.diagnostics, bound.notes);
    assert_eq!(bound.schema.operations["send"].predicts.as_deref(), Some("eligible"));
    assert_eq!(bound.schema.operations["send"].effect_payload_reads.len(), 1);
}

#[test]
fn expiring_sum_point_reads_are_fallible_even_in_a_payload() {
    use snapback4_core::{Context, Engine, Value, WriteState, value::object};
    let source = "effect notify\ntable numbers:\n  owner: principal\n  n: int\n  expiresAt: time\n  cap 100\n  public 'numbers'\n  sync public\n  expire at .expiresAt\nview totals: sum numbers of .n by .owner\nmutation probe(p: principal):\n  if not exists connected[p]:\n    emit notify { total: totals[viewer] }\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let fact = &bound.schema.operations["probe"];
    assert_eq!(fact.predicts.as_deref(), Some("never"));
    assert!(fact.effect_payload_reads.is_empty());
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let max = 9_007_199_254_740_991;
    // The physical total is MAX. Once the negative contribution expires,
    // the live total is 2*MAX: a semantic refusal, not a meter difference.
    engine.seed([(max, 100), (-max, 1), (max, 100)].into_iter().enumerate().map(|(i, (n, expiry))| ("numbers".into(), object([
        ("id", Value::Id(format!("n{i}"))), ("owner", Value::Id("alice".into())), ("n", Value::Int(n)), ("expiresAt", Value::Int(expiry)),
    ])))).unwrap();
    let sent = engine.mutate("probe", None, Context::new("alice", [("p".into(), Value::Id("bob".into()))].into()).at(2)).unwrap();
    assert!(matches!(sent.state, WriteState::Failed { ref why, .. } if why.code == "E_OVERFLOW"), "{sent:?}");
    assert!(engine.effects(None, 10).unwrap().is_empty());
}
