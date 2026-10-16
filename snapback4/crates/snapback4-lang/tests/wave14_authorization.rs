//! RULES4: intent is distinct from table authority; missing proof never means disjoint roles.
use snapback4_lang::compile;
fn notes(source: &str) -> Vec<snapback4_lang::Diagnostic> {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b.notes.into_iter().filter(|n| ["N_WRITE_DENIED", "N_REQUIRE_REFUSED"].contains(&n.code.as_str())).collect()
}
const ROWS: &str = "table rows:\n  owner: principal\n  body: text <=80\n  unique owner\n  read <- allow\n  insert <- .owner = viewer\n  delete <- .owner = viewer\n  online only\n";
#[test]
fn insert_and_delete_caller_contradictions_name_the_rule_layer() {
    for (effect, write) in [("insert", "insert rows { owner, body: 'x' }"), ("delete", "delete rows[owner = owner]")] {
        let ns = notes(&format!("{ROWS}mutation wrong(owner: principal):\n  require owner != viewer else NOT_OTHER\n  {write}\n"));
        assert_eq!(ns.len(), 1, "{ns:?}");
        assert_eq!(ns[0].code, "N_WRITE_DENIED");
        assert!(ns[0].message.contains(&format!("{effect} rule")), "{ns:?}");
        let ns = notes(&format!("{ROWS}mutation right(owner: principal):\n  require owner = viewer else OWNER_ONLY\n  {write}\n"));
        assert!(ns.is_empty(), "{ns:?}");
    }
}
const STAFF: &str = "table staff:\n  principal: principal\n  role: enum('guide', 'office')\n  unique principal\n  read <- .principal = viewer\n  online only\ntable rows:\n  owner: principal\n  body: text <=80\n  unique owner\n  read <- allow\n  insert <- exists staff[viewer]\n  update <- exists staff[viewer]\n  delete <- exists staff[viewer]\n  online only\n";
#[test]
fn a_mixed_intent_gate_explains_the_missing_table_authority_for_every_effect() {
    for write in ["insert rows { owner, body: 'x' }", "update rows[owner = owner] { body: 'x' }", "upsert rows[owner = owner] { owner, body: 'x' }", "delete rows[owner = owner]"] {
        let src = format!("{STAFF}mutation change(owner: principal):\n  require owner = viewer or exists staff[principal = viewer, role = 'office'] else GUIDE_ONLY\n  {write}\n");
        let mixed = src.replace("staff[principal = viewer, role = 'office']", "staff[viewer, role = 'office']");
        assert!(notes(&mixed).iter().any(|n| n.code == "N_REQUIRE_REFUSED"), "mixed positional/named probe: {mixed}");
        let ns = notes(&src);
        assert!(ns.iter().any(|n| n.code == "N_REQUIRE_REFUSED" && n.message.contains("missing authority proof")), "{write}: {ns:?}");
        let gated = src.replace("  require owner", "  require exists staff[viewer] else STAFF_ONLY\n  require owner");
        assert!(notes(&gated).iter().all(|n| n.code != "N_REQUIRE_REFUSED"), "{write}");
    }
}
#[test]
fn roles_may_overlap_and_opaque_gates_and_jobs_stay_quiet() {
    for body in [
        "mutation sameRole(owner: principal):\n  require exists staff[viewer, role = 'office'] else OFFICE_ONLY\n  insert rows { owner, body: 'x' }\n",
        "mutation business(owner: principal):\n  require owner != viewer else OTHER\n  insert rows { owner, body: 'x' }\n",
        "job systemWrite(owner: principal):\n  for r in rows:\n    require owner = viewer or exists staff[viewer] else ROLE\n    insert rows { owner, body: 'x' }\n",
    ] { assert!(notes(&format!("{STAFF}{body}")).is_empty(), "{body}"); }
}
#[test]
fn explicit_require_metadata_does_not_classify_lookup_assertions_as_requires() {
    let b = compile(&[("schema.q".into(), format!("{ROWS}mutation guarded(owner: principal):\n  r = rows[owner = owner] ! else MISSING\n  require r.owner = viewer else OWNER_ONLY\n  delete rows[owner = owner]\n"))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(b.refusal_sites.iter().filter(|((kind, _),_)| kind == "$program").count(), 1);
    assert!(b.refusal_sites.values().any(|value| value == "mutation require"));
    assert!(b.refusal_sites.values().any(|value| value.contains("r.owner = viewer") && value.contains("else OWNER_ONLY")));
}

#[test]
fn missing_role_proof_is_advisory_and_overlapping_roles_still_pass_at_runtime() {
    use snapback4_core::{Context, Engine, WriteState, wire};
    use serde_json::json;
    let src = format!("{STAFF}mutation change(owner: principal):\n  require owner = viewer or exists staff[principal = viewer, role = 'office'] else GUIDE_ONLY\n  return insert rows {{ owner, body: 'x' }}\n");
    for staff in [false, true] {
        let b = compile(&[("schema.q".into(), src.clone())]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        assert!(b.notes.iter().any(|n| n.code == "N_REQUIRE_REFUSED"));
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
        if staff {
            let row = wire::row_from_json(&e.schema().tables["staff"], &json!({"id":"member", "principal":"alice", "role":"guide"})).unwrap();
            e.seed(vec![("staff".into(), row)]).unwrap();
        }
        let outcome=e.mutate("change", None, Context::new("alice", [("owner".into(),snapback4_core::Value::Id("alice".into()))].into())).unwrap();
        if staff { assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}"); }
        else { assert!(matches!(outcome.state, WriteState::Failed { ref why, .. } if why.code == "E_RULE"), "{outcome:?}"); }
    }
}

#[test]
fn helper_requires_keep_their_own_source_site_for_caller_layer_attribution() {
    let source = format!("{ROWS}fn ownerGate(owner: principal):\n  require owner = viewer else E_RULE\n  return owner\nmutation guarded(owner: principal):\n  who = ownerGate(owner)\n  return insert rows {{ owner: who, body: 'x' }}\n");
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(b.refusal_sites.values().any(|v| v == "program require"));
    assert!(b.refusal_sites.values().any(|v| v.contains("owner = viewer") && v.contains("else E_RULE")));
}

#[test]
fn unreachable_and_oversized_caller_branches_stay_quiet() {
    for guard in [
        "require false or exists staff[viewer] else STAFF_ONLY".to_owned(),
        "require owner != viewer else OTHER\n  require owner = viewer or exists staff[viewer] else STAFF_ONLY".to_owned(),
        format!("require {} or exists staff[viewer] or owner != viewer else STAFF_ONLY", std::iter::repeat_n("owner = viewer", 65).collect::<Vec<_>>().join(" or ")),
    ] {
        let ns=notes(&format!("{STAFF}mutation change(owner: principal):\n  {guard}\n  return insert rows {{ owner, body: 'x' }}\n"));
        assert!(ns.iter().all(|n|n.code != "N_REQUIRE_REFUSED"), "{guard}: {ns:?}");
    }
}
#[test]
fn intrinsic_id_probe_never_proves_an_external_id_key_probe() {
    let source = "table grants:\n  external: id\n  unique external\n  read <- allow\n  online only\ntable records:\n  key: id\n  owner: principal\n  read <- allow\n  insert <- exists grants[external = .key]\n  online only\nmutation change(g: id, owner: principal):\n  require exists grants[g] else NO_ID\n  require owner = viewer or exists grants[external = g] else NO_EXTERNAL\n  return insert records { key: g, owner }\n";
    assert!(notes(source).iter().any(|n|n.code=="N_REQUIRE_REFUSED"));
}
#[test]
fn captured_clause_uses_authored_read_through_and_parentheses() {
    let source="table parents:\n  read <- allow\n  online only\ntable children:\n  parent: parents\n  immutable parent\n  read through .parent\n  online only\nmutation guarded(owner: principal):\n  require (owner = viewer) else OWNER_ONLY\n  return null\n";
    let b=compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert_eq!(b.refusal_sites.get(&("$clause".into(),"schema.q:7:3".into())).map(String::as_str),Some("read through .parent"));
    assert!(b.refusal_sites.values().any(|v|v=="require (owner = viewer) else OWNER_ONLY"));
    assert!(b.refusal_sites.values().all(|v|!v.contains("$readThrough")));
}

#[test]
fn exact_current_roster_recipe_rolls_back_a_transfer_cut_after_work_begins() {
    use snapback4_core::{Context, Engine, Value, WriteState, wire};
    use serde_json::json;
    let source=snapback4_lang::guide::quarry(snapback4_lang::guide::card("rule-recipes").unwrap()).into_iter().find(|s|s.contains("table rosterFolders:")).unwrap();
    let b=compile(&[("schema.q".into(),source)]);
    assert!(b.diagnostics.is_empty() && b.notes.is_empty(),"{:?} {:?}",b.diagnostics,b.notes);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let mut rows=vec![("departments",json!({"id":"old","title":"Old"})),("departments",json!({"id":"new","title":"New"})),("rosterFolders",json!({"id":"folder","department":"old"}))];
    for i in 0..20 { rows.push(("rosterFiles",json!({"id":format!("file-{i}"),"folder":"folder","department":"old","body":"private"}))); }
    let rows=rows.into_iter().map(|(table,row)|(table.into(),wire::row_from_json(&e.schema().tables[table],&row).unwrap())).collect();
    e.seed(rows).unwrap();
    let before=e.store().rows("rosterFiles").unwrap();
    let ordinary=e.ceilings();let mut small=ordinary;small.rows_written=3;e.set_ceilings(small);
    let ctx=||Context::new("service:ops",[("folder".into(),Value::Id("folder".into())),("department".into(),Value::Id("new".into()))].into());
    let refused=e.mutate("transferRosterFolder",None,ctx()).unwrap();
    assert!(matches!(&refused.state,WriteState::Failed { why,.. } if why.code=="E_BOUND"),"{refused:?}");
    assert!(refused.metered.rows_written > 1, "the cut must follow parent and child writes: {:?}", refused.metered);
    assert_eq!(e.store().rows("rosterFiles").unwrap(),before);
    assert_eq!(e.store().rows("rosterFolders").unwrap()[0].field("department").unwrap(),&Value::Id("old".into()));
    e.set_ceilings(ordinary);
    assert!(matches!(e.mutate("transferRosterFolder",None,ctx()).unwrap().state,WriteState::Sent { .. }));
    assert!(e.store().rows("rosterFiles").unwrap().iter().all(|r|r.field("department").unwrap()==&Value::Id("new".into())));
}
