use snapback4_lang::{compile, Bound};

const TABLES: &str = "table orgs:\n  public\ntable conversations:\n  org: orgs\n  public\ntable members:\n  conversation: conversations\n  principal: principal\n  unique conversation, principal\n  public\ntable messages:\n  conversation: conversations\n  owner: principal\n  secret: int default 0 written by .owner\n  public\ntable reactions:\n  message: messages\n  principal: principal\n  public\n";

fn bind(rule: &str) -> Bound {
    compile(&[("schema.q".into(), format!("{TABLES}  {rule}\n"))])
}
fn accepted(rule: &str) {
    let b = bind(rule);
    assert!(b.diagnostics.is_empty(), "{rule}: {:?}", b.diagnostics);
}

#[test]
fn current_depth_one_comparisons_and_probe_keys() {
    for rule in [
        "insert <- .message.conversation != null",
        "insert <- messages[.message].conversation != null",
        "insert <- .principal = viewer and exists members[.message.conversation, viewer]",
        "update <- .principal = viewer and exists members[.message.conversation, viewer]",
        "delete <- exists members[conversation = .message.conversation, principal = viewer]",
    ] { accepted(rule); }
}

#[test]
fn accept_depth_two_and_three_and_explicit_lookups() {
    for rule in [
        "insert <- .message.conversation.org != null",
        "insert <- .message.conversation.org.id != null",
        "insert <- conversations[messages[.message].conversation].org != null",
        "update (old, next) <- old.message.conversation.org = next.message.conversation.org",
    ] { accepted(rule); }
}

#[test]
fn accept_final_insert_hop() {
    accepted("after insert <- exists members[.message.conversation, viewer]");
}

#[test]
fn refuse_private_targets_and_over_depth() {
    for rule in ["insert <- .message.secret = 0", "insert <- .message.conversation.org.id.id != null"] {
        let b = bind(rule);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_RULE_HOP"), "{rule}: {:?}", b.diagnostics);
    }
}

#[test]
fn named_id_lookups_and_focal_paths_lower_identically() {
    let a = bind("insert <- .message.conversation.org != null");
    let b = bind("insert <- conversations[id = messages[id = .message].conversation].org != null");
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert_eq!(a.schema,b.schema);
}

#[test]
fn refusals_explain_private_maintained_ephemeral_and_read_positions() {
    for (source, reason, lookup) in [
        (format!("{TABLES}  insert <- .message.secret = 0\n"), "private", "messages[id = message]"),
        ("table parents:\n  total: count sources by parent\n  public\ntable sources:\n  parent: parents\n  public\ntable children:\n  parent: parents\n  public\n  insert <- .parent.total = 0\n".into(), "maintained", "parents[id = parent]"),
        ("table sources:\n  owner: principal\n  public\nview totals: count sources by .owner\ntable children:\n  total: totals\n  public\n  insert <- .total.value = 0\n".into(), "maintained", "totals[owner = owner]"),
        ("table presence:\n  owner: principal\n  public\n  cap 10 by owner\n  ephemeral 4s\ntable children:\n  presence: presence\n  public\n  insert <- .presence.owner = viewer\n".into(), "ephemeral", "presence[id = presence]"),
    ] {
        let b = compile(&[("schema.q".into(),source)]);
        let d = b.diagnostics.iter().find(|d| d.code=="E_QUARRY_RULE_HOP").expect(&format!("{:?}",b.diagnostics));
        assert!(d.message.contains(reason),"{d:?}");
        assert!(d.rewrite.contains(lookup) && d.rewrite.contains("require ") && d.rewrite.contains("! else FORBIDDEN"),"{d:?}");
        assert!(!d.rewrite.contains("table[") && !d.rewrite.contains(".ref"),"{d:?}");
    }
    // @ref LLP 3000.036#11 — a read rule's repair is table-rule syntax (copy the
    // immutable deciding value, check it at insert, probe one hop), never a
    // mutation `require`, which would not guard reads.
    let b = compile(&[("schema.q".into(),format!("{}  read <- .message.owner = viewer\n",TABLES.trim_end_matches("  public\n")))]);
    let d = b.diagnostics.iter().find(|d| d.code=="E_QUARRY_RULE_HOP").expect(&format!("{:?}",b.diagnostics));
    assert!(d.message.contains("read through"),"{d:?}");
    // LLP 3000.036 §12: one hop on a table that does not sync probes the parent directly.
    assert!(d.rewrite.contains("read through .message") && d.rewrite.contains("read <- exists messages[.message, owner = viewer]") && !d.rewrite.contains("require "),"{d:?}");
    let repaired = compile(&[("schema.q".into(),format!("{}  read <- exists messages[.message, owner = viewer]\n",TABLES.trim_end_matches("  public\n")))]);
    assert!(repaired.diagnostics.is_empty(), "{:?}", repaired.diagnostics);
}

#[test]
fn private_and_deep_refusal_repairs_compile_as_mutation_checks() {
    for (rule, args) in [
        ("insert <- not (.message.secret = 0)","message: messages"),
        ("insert <- .message.conversation.org.id.id != null","message: messages"),
    ] {
        let b = bind(rule);
        let d = b.diagnostics.iter().find(|d|d.code=="E_QUARRY_RULE_HOP").unwrap();
        if rule.contains("secret") { assert!(d.rewrite.contains("require rule_parent_0.owner = viewer else FORBIDDEN"), "{d:?}"); }
        let body = d.rewrite.lines().map(|l| format!("  {l}")).collect::<Vec<_>>().join("\n");
        let repaired = compile(&[("repair.q".into(),format!("{TABLES}mutation check({args}):\n{body}\n  return true\n"))]);
        assert!(repaired.diagnostics.is_empty(),"{}\n{:?}",d.rewrite,repaired.diagnostics);
    }
}

#[test]
fn raw_schema_chains_validate_every_link_and_fence_every_new_position() {
    use snapback4_core::{schema::{self, RuleTerm, RuleHop, RuleExpr, Constraint}, Value};
    let b = bind("insert <- .message.conversation.org != null");
    assert!(b.schema.required_capabilities().contains("rule-reference-v2"));
    let bytes = snapback4_core::json_codec::to_text(&b.schema).unwrap();
    let decoded: schema::Schema = snapback4_core::json_codec::from_text(&bytes).unwrap();
    assert_eq!(b.schema,decoded);
    for hops in [vec![],vec![RuleHop{table:"messages".into(),field:"secret".into()},RuleHop{table:"orgs".into(),field:"id".into()}],vec![RuleHop{table:"orgs".into(),field:"id".into()};4]] {
        let mut s = b.schema.clone();
        s.tables.get_mut("reactions").unwrap().rules.insert = RuleExpr::Ne(RuleTerm::ReferenceChain {column:"message".into(),hops,old:false},RuleTerm::Literal(Value::Null));
        assert!(schema::validate(&s).iter().any(|i|i.message.contains("E_QUARRY_RULE_HOP")));
    }
    let final_only = bind("after insert <- exists members[.message.conversation, viewer]");
    assert!(final_only.schema.required_capabilities().contains("rule-reference-v2"));
    assert!(!final_only.schema.required_capabilities().contains("rule-reference"));
    let mut s = final_only.schema;
    let Constraint::FinalExistsOnInsert {key,..} = s.tables.get_mut("reactions").unwrap().constraints.last_mut().unwrap() else {panic!()};
    key[0] = RuleTerm::Reference {column:"message".into(),table:"messages".into(),field:"secret".into(),old:false};
    assert!(schema::validate(&s).iter().any(|i|i.message.contains("E_QUARRY_RULE_HOP")));
}

#[test]
fn certificates_list_every_hop_occurrence_and_final_dependency() {
    let source = include_str!("fixtures/rx/reactions.q");
    let b = compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let endorsement = &b.schema.operations["endorse"];
    assert_eq!(endorsement.predicts.as_deref(),Some("eligible"));
    let hops: Vec<_> = endorsement.sites.iter().filter(|s|s.kind=="rule reference").map(|s|s.table.as_str()).collect();
    assert_eq!(hops,vec!["reactions","messages","reactions","messages","conversations"]);
    let final_hops: Vec<_> = b.schema.operations["obligation"].sites.iter().filter(|s|s.kind=="rule reference").map(|s|s.table.as_str()).collect();
    assert_eq!(final_hops,vec!["messages"]);
}

#[test]
fn maintained_target_repair_uses_its_real_group_key() {
    let prefix = "table sources:\n  owner: principal\n  public\nview totals: count sources by .owner\ntable children:\n  total: totals\n  public\n";
    let b = compile(&[("schema.q".into(),format!("{prefix}  insert <- .total.value = 0\n"))]);
    let repair = &b.diagnostics.iter().find(|d|d.code=="E_QUARRY_RULE_HOP").unwrap().rewrite;
    let body = repair.lines().map(|line|format!("  {line}")).collect::<Vec<_>>().join("\n");
    let fixed = compile(&[("schema.q".into(),format!("{prefix}mutation check(owner: principal):\n{body}\n  return true\n"))]);
    assert!(fixed.diagnostics.is_empty(),"{repair}\n{:?}",fixed.diagnostics);
}
