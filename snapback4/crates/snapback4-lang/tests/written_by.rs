use snapback4_lang::{compile, guide};
const SOURCE: &str = include_str!("fixtures/written-by.q");
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
#[test]
fn field_authority_binds_and_survives_schema_roundtrip() {
    for audience in [false,true] {
        let source = SOURCE.replace("written by .principal", if audience { "written by .principal readable by audience" } else { "written by .principal" });
        let b=bound(&source);
        let a=&b.schema.tables["members"].written_by["readUpTo"];
        assert_eq!(a.owner,"principal"); assert_eq!(a.audience,audience);
        let decoded: snapback4_core::Schema = serde_json::from_str(&serde_json::to_string(&b.schema).unwrap()).unwrap();
        assert_eq!(decoded,b.schema);
        assert!(b.schema.required_capabilities().contains("field-authority"));
        let types=snapback4_lang::emit::typescript(&b);
        assert!(types.contains(if audience { "readUpTo: number" } else { "readUpTo?: number" }),"{types}");
    }
}
#[test]
fn field_authority_refusals_have_rewrites_and_explanations() {
    for replacement in ["written by .role", "written by .missing", "written by principal", "written .principal", "written by .principal readable audience", "readable by audience", "written by .principal written by .principal", "written by .principal readable by nobody"] {
        let b=compile(&[("bad.q".into(), SOURCE.replace("written by .principal",replacement))]);
        let d=b.diagnostics.iter().find(|d|d.code=="E_FIELD_AUTHORITY").unwrap_or_else(||panic!("{replacement}: {:?}",b.diagnostics));
        assert!(!d.rewrite.is_empty());
        assert!(guide::explain_code(&d.code).unwrap().contains("written by"));
        assert!(d.explanation_section().is_some());
    }
    for source in [SOURCE.replace(" default 0", ""),SOURCE.replace("  unique conversationId, principal", "  by byMark: readUpTo\n  unique conversationId, principal"),SOURCE.replace("principal: principal", "principal: principal ?")] {
        let b=compile(&[("bad.q".into(),source)]);
        assert!(b.diagnostics.iter().any(|d|d.code=="E_FIELD_AUTHORITY" && !d.rewrite.is_empty()),"{:?}",b.diagnostics);
    }
}
#[test]
fn ordered_named_transition_is_admitted_but_read_rules_stay_equalities() {
    let row="update <- exists members[conversationId = .conversationId, principal = viewer, role = 'admin']";
    for op in [">=",">","<=","<"] {
        let b=bound(&SOURCE.replace(row,&format!("update (old, next) <- next.readUpTo {op} old.readUpTo")));
        assert!(b.schema.tables["members"].update_transition);
        assert!(b.schema.tables["members"].rules.update.quarry().contains(op));
    }
    let b=compile(&[("bad.q".into(), SOURCE.replace("read <- exists members[.conversationId, viewer]", "read <- .readUpTo > 0"))]);
    assert!(b.diagnostics.iter().any(|d|!d.rewrite.is_empty()));
}

#[test]
fn ordinary_update_rules_cannot_guess_private_values() {
    let source = "table records:\n  owner: principal\n  secret: int default 0 written by .owner\n  label: int default 0\n  read <- public\n  update <- .secret = .label\nmutation guess(id: records, label: int):\n  update records[id] { label }\n";
    let b = compile(&[("guess.q".into(), source.into())]);
    let d = b.diagnostics.iter().find(|d| d.code == "E_FIELD_AUTHORITY").unwrap_or_else(|| panic!("{:?}", b.diagnostics));
    assert!(d.message.contains("named update (old, next)"), "{d:?}");
    assert!(!d.rewrite.is_empty());
    bound(&source.replace("update <- .secret = .label", "update (old, next) <- next.secret = next.label"));
    bound(&source.replace("written by .owner", "written by .owner readable by audience"));
}

#[test]
fn private_equality_term_refuses_in_a_read_rule() {
    let source = SOURCE.replace("read <- exists members[.conversationId, viewer]", "read <- .readUpTo = 0");
    let b = compile(&[("private-read.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_FIELD_AUTHORITY" && !d.rewrite.is_empty()), "{:?}", b.diagnostics);
}

#[test]
fn writes_card_splits_the_read_mark_section() {
    let card = guide::card("writes").unwrap();
    assert!(card.contains("behavior.\n\n## Writing a member's read mark\n"));
    let section = snapback4_lang::diag::Diagnostic::new(&Default::default(), "E_FIELD_AUTHORITY", "private field", "omit it")
        .guide("writes").explanation_section().unwrap();
    assert!(section.contains("## Writing a member's read mark"), "{section}");
}

#[test]
fn private_derivations_and_rule_probes_refuse_and_visibility_changes_reacquire() {
    for extra in ["view leaked: sum members of .readUpTo by .conversationId\n  read <- allow\n  online only\n", "table leaks:\n  key: members\n  read <- exists members[id = .key, readUpTo = 13]\n"] {
        let b=compile(&[("bad.q".into(),format!("{SOURCE}\n{extra}"))]);
        assert!(b.diagnostics.iter().any(|d|d.code=="E_FIELD_AUTHORITY" && !d.rewrite.is_empty()),"{:?}",b.diagnostics);
    }
    let source=format!("{SOURCE}\nview leaked: count members where .readUpTo > 0 by .conversationId\n  read <- allow\n  online only\n");
    let b=compile(&[("bad.q".into(),source)]);
    assert!(b.diagnostics.iter().any(|d|d.code=="E_FIELD_AUTHORITY"),"{:?}",b.diagnostics);
    let old=bound(&SOURCE.replace(" written by .principal", ""));
    let new=bound(SOURCE);
    assert!(snapback4_core::successor::classify(&old.schema,&new.schema).iter().any(|step|step.change==snapback4_core::successor::Change::RuleChange));
    assert!(!snapback4_core::successor::keeps_literal_default_images(&old.schema,&new.schema));
    let mut encoded=serde_json::to_value(&new.schema).unwrap();
    for table in encoded["tables"].as_object_mut().unwrap().values_mut() {
        table["constraints"].as_array_mut().unwrap().retain(|c|c.get("Capabilities").is_none());
    }
    assert!(serde_json::from_value::<snapback4_core::Schema>(encoded).is_err());
}
