//! @ref LLP 3000.013#2.2 — a positional point resolves from argument types.
use snapback4_lang::{compile, Bound};

fn model(keys: usize) -> String {
    format!("table other:\n  public\n  online only\ntable conversations:\n  slug: text <=80\n  owner: principal\n{}{}  public\n  insert <- allow\n  update <- allow\n  delete <- allow\n  online only\n", if keys > 0 { "  unique bySlug: slug\n" } else { "" }, if keys > 1 { "  unique byOwner: owner\n" } else { "" })
}
fn bound(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn ok(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{source}\n{:?}", b.diagnostics);
    b
}
fn selected(source: &str, index: &str) {
    let b = ok(source);
    assert!(b.programs[0].selections().values().any(|s| s.starts_with(&format!("selected {index} ("))), "{:?}", b.programs[0].selections());
}

#[test]
fn identity_and_unique_key_type_matrix() {
    let mut cases = Vec::new();
    for keys in 0..=2 {
        for ty in ["id", "conversations", "other", "principal", "text <=80"] {
            let source = format!("{}query q(x: {ty}):\n  return conversations[x]\n", model(keys));
            let b = bound(&source);
            eprintln!("keys={keys}, type={ty}: {:?}; {:?}", b.diagnostics.iter().map(|d| (&d.code, &d.message)).collect::<Vec<_>>(), b.programs.iter().flat_map(|p| p.selections().values()).collect::<Vec<_>>());
            cases.push((source, ty, keys));
        }
    }
    for (source, ty, keys) in cases {
            let b = bound(&source);
            match ty {
                "id" | "conversations" => selected(&source, "byId"),
                "text <=80" if keys >= 1 => selected(&source, "bySlug"),
                "principal" if keys >= 2 => selected(&source, "byOwner"),
                _ => assert!(!b.diagnostics.is_empty(), "{source}"),
            }
    }
}

#[test]
fn cal31_four_reads_and_two_rules() {
    // The lost draft is reconstructed: implicit id + unique slug are the two
    // one-column keys reported in cal31, not two authored secondary keys.
    let source = format!("{}query byId(x: id):\n  return conversations[x]\nquery byRef(x: conversations):\n  return conversations[x]\nquery bySlug(x: text <=80):\n  return conversations[x]\nquery has(x: conversations):\n  return exists conversations[x]\ntable links:\n  conversation: conversations\n  read <- exists conversations[.conversation]\n  insert <- created conversations[.conversation]\n  online only\n", model(1));
    let b = bound(&source);
    eprintln!("cal31 reconstruction: {:?}", b.diagnostics);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    for (name, index) in [("byId", "byId"), ("byRef", "byId"), ("bySlug", "bySlug"), ("has", "byId")] {
        let program = b.programs.iter().find(|p| p.program.name == name).unwrap();
        let sites = snapback4_core::ir::read_sites(&program.program);
        assert_eq!(sites[0].index, index);
    }
    for rule in [&b.schema.tables["links"].rules.read, &b.schema.tables["links"].rules.insert] {
        match rule {
            snapback4_core::schema::RuleExpr::Exists { index, .. } | snapback4_core::schema::RuleExpr::Created { index, .. } => assert_eq!(index, "byId"),
            _ => panic!("expected point rule: {rule:?}"),
        }
    }
    // The plain id form must keep identity alongside secondary unique keys.
    selected(&format!("{}query q(x: id):\n  return conversations[x]\n", model(1)), "byId");
}

#[test]
fn rule_pair_disambiguates_by_ordered_types() {
    let source = "table conversations:\n  read <- exists members[.id, viewer]\n  online only\ntable members:\n  conversation: conversations\n  principal: principal\n  unique pair: conversation, principal\n  unique reverse: principal, conversation\n  public\n  online only\n";
    let b = ok(source);
    assert!(format!("{:?}", b.schema.tables["conversations"].rules.read).contains("pair"));
}

#[test]
fn writes_and_mixed_keys_keep_identity_despite_secondary_uniques() {
    for ty in ["id", "conversations", "principal", "text <=80"] {
        for verb in ["update", "upsert", "delete"] {
            let body = if verb == "delete" { "" } else { " { slug: 'updated' }" };
            ok(&format!("{}mutation m(x: {ty}):\n  {verb} conversations[x]{body}\n", model(2)));
        }
    }
    for ty in ["id", "conversations"] {
        selected(&format!("{}query q(x: {ty}):\n  return conversations[x, owner = viewer]\n", model(2)), "byId");
    }
    ok(&format!("{}table links:\n  conversation: conversations\n  read <- exists conversations[.conversation, owner = viewer]\n  online only\n", model(2)));
}

#[test]
fn foreign_reference_selects_its_declared_key_but_cannot_select_identity() {
    let model = model(2).replace("  owner: principal", "  owner: principal\n  parent: other\n  unique byParent: parent");
    selected(&format!("{model}query q(x: other):\n  return conversations[x]\n"), "byParent");
    let b = bound(&format!("{model}query q(x: other):\n  return conversations[id = x]\n"));
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"));
    // Generic id still means identity even when another generic-id column fits.
    let model = model.replace("parent: other", "parent: id");
    selected(&format!("{model}query q(x: id):\n  return conversations[x]\n"), "byId");
}

#[test]
fn same_type_candidates_refuse_and_offer_named_repairs_in_every_context() {
    let schema = model(1).replace("  owner: principal", "  owner: principal\n  alias: text <=40\n  unique byAlias: alias");
    for body in ["query q(x: text <=40):\n  return conversations[x]", "query q(x: text <=40):\n  return exists conversations[x]",
        "mutation m(x: text <=40):\n  update conversations[x] { owner: viewer }", "mutation m(x: text <=40):\n  delete conversations[x]"] {
        let source = format!("{schema}{body}\n");
        let b = bound(&source);
        let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_POSITIONAL_SCAN").unwrap();
        assert!(d.message.contains("conversations[slug = x]") && d.message.contains("conversations[alias = x]"), "{d:?}");
        assert!(d.mechanical && !d.rewrite.is_empty(), "{d:?}");
        ok(&source.replace("conversations[x]", &d.rewrite));
    }
    let source = format!("{schema}table links:\n  slug: text <=40\n  read <- exists conversations[.slug]\n  online only\n");
    let b = bound(&source);
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_POSITIONAL_SCAN").unwrap();
    assert!(d.message.contains("conversations[slug = .slug]") && d.message.contains("conversations[alias = .slug]"));
    ok(&source.replace("conversations[.slug]", &d.rewrite));
    // A text literal can name a slug or an identity; never infer intent from its bytes.
    let source = format!("{}query q():\n  return conversations['x']\n", model(1));
    let b = bound(&source);
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_POSITIONAL_SCAN").unwrap();
    assert!(d.message.contains("conversations[id = 'x']") && d.message.contains("conversations[slug = 'x']"));
    ok(&source.replace("conversations['x']", &d.rewrite));
}

#[test]
fn rules_apply_the_same_scalar_matrix_and_nullable_admission() {
    for keys in 0..=2 {
        for ty in ["id", "conversations", "other", "principal", "text <=80"] {
            let source = format!("{}table links:\n  x: {ty}\n  read <- exists conversations[.x]\n  insert <- created conversations[.x]\n  online only\n", model(keys));
            let b = bound(&source);
            let allowed = matches!(ty, "id" | "conversations") || ty == "principal" && keys == 2 || ty == "text <=80" && keys >= 1;
            assert_eq!(b.diagnostics.is_empty(), allowed, "{source}\n{:?}", b.diagnostics);
        }
    }
    let source = model(2).replace("slug: text <=80", "slug: text <=80 ?");
    for (ty, guard, allowed) in [("text <=80", "", true), ("text <=80 ?", "", false), ("text <=80 ?", "  require x != null else MISSING\n", true)] {
        let b = bound(&format!("{source}query q(x: {ty}):\n{guard}  return conversations[x]\n"));
        assert_eq!(b.diagnostics.is_empty(), allowed, "{:?}", b.diagnostics);
        if !allowed { assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_NULL_KEY")); }
    }
}

#[test]
fn cal31_seventh_message_is_payload_typing_and_must_still_refuse() {
    let source = format!("{}mutation m(x: id):\n  return insert conversations {{ slug: x, owner: viewer }}\n", model(1));
    let b = bound(&source);
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_TYPE").unwrap();
    assert_eq!(d.message, "conversations.slug is text <=80; got id");
    assert_eq!(d.rewrite, "write text <=80 into slug");
    // Supplying a text slug repairs the payload while preserving its unique constraint.
    ok(&source.replace("m(x: id)", "m(x: text <=80)"));
}

#[test]
fn nested_identity_keys_bind_once_within_one_second() {
    let mut expression = "x".to_owned();
    for _ in 0..8 { expression = format!("conversations[{expression}].id"); }
    let source = format!("{}query q(x: conversations):\n  return {expression}\n", model(1));
    let start = std::time::Instant::now();
    let b = ok(&source);
    let elapsed = start.elapsed();
    eprintln!("eight nested typed identity keys: {elapsed:?}");
    assert!(elapsed < std::time::Duration::from_secs(1), "nested key binding regressed: {elapsed:?}");
    assert_eq!(snapback4_core::ir::read_sites(&b.programs[0].program).len(), 8, "one runtime read per authored key");
}

#[test]
fn bound_key_reuse_preserves_allocation_order_and_one_helper_effect() {
    use snapback4_core::{Context, Engine, Value, WriteState, value::object};
    let source = "table conversations:\n  public\n  online only\ntable members:\n  conversation: conversations\n  principal: principal\n  role: text <=20\n  unique pair: conversation, principal\n  unique reverse: principal, conversation\n  public\n  online only\ntable events:\n  public\n  insert <- allow\n  online only\nfn nextPrincipal():\n  insert events {}\n  return viewer\nmutation q():\n  return members[new, nextPrincipal()EXTRA]\n";
    for extra in ["", ", role = 'admin'"] {
        let b = ok(&source.replace("EXTRA", extra));
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed([("members".into(), object([
            ("id", Value::Id("member".into())), ("conversation", Value::Id("first".into())),
            ("principal", Value::Id("alice".into())), ("role", Value::String("admin".into())),
        ]))]).unwrap();
        let result = engine.mutate("q", None, Context::new("alice", Default::default()).with_ids(["first".into(), "second".into()])).unwrap();
        let WriteState::Sent { result, .. } = result.state else { panic!("{result:?}") };
        assert_eq!(result.field("id").unwrap(), &Value::Id("member".into()));
        let events = engine.store().rows("events").unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].field("id").unwrap(), &Value::Id("second".into()));
    }
}
