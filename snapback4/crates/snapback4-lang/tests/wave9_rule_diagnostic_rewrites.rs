use snapback4_lang::{compile, diag::SourceRewriteKind, Diagnostic};
use snapback4_core::{Context, Engine, Value, WriteState, value::object};

fn refusal(source: &str, code: &str) -> Diagnostic {
    let bound = compile(&[("schema.q".into(), source.into())]);
    bound.diagnostics.iter().find(|diagnostic| diagnostic.code == code).cloned()
        .unwrap_or_else(|| panic!("missing {code}; diagnostics: {:#?}", bound.diagnostics))
}

fn emitted_source_compiles(source: &str, authored: &str, diagnostic: &Diagnostic) -> String {
    let emitted = diagnostic.source_rewrite.as_ref().expect("a verified source rewrite");
    let repaired = source.replacen(authored, emitted, 1);
    assert_ne!(repaired, source, "fixture must contain the authored source");
    let bound = compile(&[("schema.q".into(), repaired.clone())]);
    assert!(bound.diagnostics.is_empty(), "emitted rewrite did not compile:\n{emitted}\n{:#?}", bound.diagnostics);
    repaired
}

fn classified(diagnostic: &Diagnostic, expected: SourceRewriteKind) {
    let actual = diagnostic.source_rewrite_kind.as_ref().expect("a concrete rewrite category");
    // This deliberately stays exhaustive: a new concrete rule-edit category
    // makes the golden fail to compile until it has a fixture and semantics case.
    match actual {
        SourceRewriteKind::MixedKey => assert_eq!(expected, SourceRewriteKind::MixedKey),
        SourceRewriteKind::MembershipBootstrap => assert_eq!(expected, SourceRewriteKind::MembershipBootstrap),
        SourceRewriteKind::WriteResultNarrowing => assert_eq!(expected, SourceRewriteKind::WriteResultNarrowing),
        SourceRewriteKind::NamedUpdate => assert_eq!(expected, SourceRewriteKind::NamedUpdate),
    }
}

#[test]
fn every_concrete_rule_rewrite_is_the_emitted_text_and_compiles_in_its_schema() {
    let positional = "table roles:\n  principal: principal\n  role: enum('staff', 'member')\n  unique principal, role\n  public 'roles'\ntable records:\n  owner: principal\n  read <- exists roles[viewer, role = 'staff']\n  online only\nquery visible():\n  return records first 10 by .id\n";
    let diagnostic = refusal(positional, "E_QUARRY_POSITIONAL_SCAN");
    classified(&diagnostic, SourceRewriteKind::MixedKey);
    assert_eq!(diagnostic.source_rewrite.as_deref(), Some("roles[principal = viewer, role = 'staff']"));
    emitted_source_compiles(positional, "roles[viewer, role = 'staff']", &diagnostic);

    let update = "table fees:\n  status: enum('pending', 'confirmed')\n  public 'fees'\n  update <- old.status = 'pending' and next.status = 'confirmed'\n  online only\nmutation transition(fee: fees, status: enum('pending', 'confirmed')):\n  update fees[fee] { status }\n  return null\n";
    let diagnostic = refusal(update, "E_QUARRY_RULE_OPERATOR");
    classified(&diagnostic, SourceRewriteKind::NamedUpdate);
    assert_eq!(diagnostic.source_rewrite.as_deref(), Some("update (old, next) <- (old.status = 'pending' and next.status = 'confirmed')"));
    emitted_source_compiles(update, "update <- old.status = 'pending' and next.status = 'confirmed'", &diagnostic);
}

#[test]
fn emitted_source_rewrites_match_independent_reference_semantics() {
    let positional = "table roles:\n  principal: principal\n  role: enum('staff', 'member')\n  unique principal, role\n  public 'roles'\ntable records:\n  owner: principal\n  read <- exists roles[viewer, role = 'staff']\n  online only\nquery visible():\n  return records first 10 by .id\n";
    let diagnostic = refusal(positional, "E_QUARRY_POSITIONAL_SCAN");
    let repaired = emitted_source_compiles(positional, "roles[viewer, role = 'staff']", &diagnostic);
    // Execute the actual compiler-emitted replacement over the independent
    // population-membership truth table.
    for has_pair in [false, true] {
        let bound = compile(&[("schema.q".into(), repaired.clone())]);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|program| program.program)).unwrap();
        let mut rows = vec![("records".into(), object([("id", Value::Id("record".into())), ("owner", Value::Id("owner".into()))]))];
        if has_pair {
            rows.push(("roles".into(), object([("id", Value::Id("role".into())), ("principal", Value::Id("alice".into())), ("role", Value::String("staff".into()))])));
        }
        engine.seed(rows).unwrap();
        let read = engine.query("visible", Context::new("alice", Default::default())).unwrap();
        let Value::Array(rows) = read.data else { panic!("expected page, got {:?}", read.data) };
        assert_eq!(!rows.is_empty(), has_pair);
    }

    let update = "table fees:\n  status: enum('pending', 'confirmed')\n  public 'fees'\n  update <- old.status = 'pending' and next.status = 'confirmed'\n  online only\nmutation transition(fee: fees, status: enum('pending', 'confirmed')):\n  update fees[fee] { status }\n  return null\n";
    let diagnostic = refusal(update, "E_QUARRY_RULE_OPERATOR");
    let repaired = emitted_source_compiles(update, "update <- old.status = 'pending' and next.status = 'confirmed'", &diagnostic);
    // Execute the actual named-update line for every old/next status pair.
    for old in ["pending", "confirmed"] {
        for next in ["pending", "confirmed"] {
            let bound = compile(&[("schema.q".into(), repaired.clone())]);
            let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|program| program.program)).unwrap();
            engine.seed([("fees".into(), object([("id", Value::Id("fee".into())), ("status", Value::String(old.into()))]))]).unwrap();
            let outcome = engine.mutate("transition", None, Context::new("alice", [
                ("fee".into(), Value::Id("fee".into())), ("status".into(), Value::String(next.into())),
            ].into())).unwrap();
            let allowed = matches!(outcome.state, WriteState::Sent { .. });
            let old_pending = old == "pending";
            let next_confirmed = next == "confirmed";
            assert_eq!(allowed, old_pending && next_confirmed, "{old} -> {next}: {outcome:?}");
        }
    }

    let parents = "table scenes:\n  revision: int\n  public 'scenes'\ntable boundaries:\n  revision: int\n  public 'boundaries'\ntable instructions:\n  scene: scenes\n  boundary: boundaries\n  revision: int\n  read <- .boundary.revision = .scene.revision\n  online only\nquery visible():\n  return instructions first 10 by .id\n";
    let diagnostic = refusal(parents, "E_QUARRY_RULE_HOP");
    let predicate = diagnostic.rewrite.split('`').skip(1).step_by(2)
        .find(|piece| piece.starts_with("exists boundaries["))
        .expect("the emitted stored-field predicate");
    let repaired = parents.replacen(".boundary.revision = .scene.revision", predicate, 1);
    let bound = compile(&[("schema.q".into(), repaired.clone())]);
    assert!(bound.diagnostics.is_empty(), "emitted stored-field predicate did not compile:\n{predicate}\n{:#?}", bound.diagnostics);
    // Execute the actual emitted predicate under the invariant named by the
    // guidance: the local revision equals the boundary revision at insert.
    for boundary in [1, 2] {
        for scene in [1, 2] {
            let bound = compile(&[("schema.q".into(), repaired.clone())]);
            let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|program| program.program)).unwrap();
            engine.seed([
                ("scenes".into(), object([("id", Value::Id("scene".into())), ("revision", Value::Int(scene))])),
                ("boundaries".into(), object([("id", Value::Id("boundary".into())), ("revision", Value::Int(boundary))])),
                ("instructions".into(), object([
                    ("id", Value::Id("instruction".into())), ("scene", Value::Id("scene".into())),
                    ("boundary", Value::Id("boundary".into())), ("revision", Value::Int(boundary)),
                ])),
            ]).unwrap();
            let read = engine.query("visible", Context::new("alice", Default::default())).unwrap();
            let Value::Array(rows) = read.data else { panic!("expected page, got {:?}", read.data) };
            assert_eq!(!rows.is_empty(), boundary == scene, "boundary={boundary}, scene={scene}");
        }
    }
}

#[test]
fn design_guidance_is_not_mislabeled_as_a_source_rewrite() {
    let expiry = "table hearings:\n  releaseAt: time\n  public 'hearings'\ntable notices:\n  hearing: hearings\n  read <- now >= .hearing.releaseAt\n  online only\n";
    let diagnostic = refusal(expiry, "E_QUARRY_RULE_OPERATOR");
    assert!(diagnostic.source_rewrite.is_none());
    assert!(!diagnostic.rewrite.contains("expire at .hearing"), "{diagnostic}");
    assert!(diagnostic.rewrite.contains("required time column") && diagnostic.rewrite.contains("not a reference hop"), "{diagnostic}");

    let parents = "table scenes:\n  revision: int\n  public 'scenes'\ntable boundaries:\n  revision: int\n  public 'boundaries'\ntable instructions:\n  scene: scenes\n  boundary: boundaries\n  revision: int\n  read <- .boundary.revision = .scene.revision\n  online only\n";
    let diagnostic = refusal(parents, "E_QUARRY_RULE_HOP");
    assert!(diagnostic.source_rewrite.is_none());
    assert!(diagnostic.rewrite.contains("stored-field invariant") && diagnostic.rewrite.contains("exists boundaries[id = .boundary, revision = .revision]")
        && diagnostic.rewrite.contains("exists scenes[id = .scene, revision = .revision]"), "{diagnostic}");
    assert!(!diagnostic.rewrite.contains("revision = exists"), "{diagnostic}");

    let operands = "table payments:\n  firstApprover: principal ?\n  public 'payments'\ntable ledger:\n  payment: payments\n  firstApprover: principal\n  insert <- .firstApprover = .payment.firstApprover\n  online only\n";
    let diagnostic = refusal(operands, "E_QUARRY_TYPE");
    assert!(diagnostic.source_rewrite.is_none());
    assert!(diagnostic.message.contains("principal") && diagnostic.message.contains("principal ?"), "{diagnostic}");
    assert!(!diagnostic.message.contains("viewer meets"), "{diagnostic}");
}

#[test]
fn nonunique_point_advice_distinguishes_rules_from_programs() {
    let schema = "table roles:\n  principal: principal\n  role: enum('staff', 'member')\n  by byPrincipal: principal\n  public 'roles'\n";
    let rule = format!("{schema}table records:\n  owner: principal\n  read <- exists roles[principal = viewer] by byPrincipal\n  online only\n");
    let diagnostic = refusal(&rule, "E_QUARRY_POINT_KEY");
    assert!(diagnostic.rewrite.contains("table rules cannot scan a population"), "{diagnostic}");
    assert!(!diagnostic.rewrite.contains("where … first N"), "{diagnostic}");

    let program = format!("{schema}query role(who: principal):\n  return exists roles[principal = who] by byPrincipal\n");
    let diagnostic = refusal(&program, "E_QUARRY_POINT_KEY");
    assert!(diagnostic.rewrite.contains("where … first N"), "{diagnostic}");
    assert!(!diagnostic.rewrite.contains("table rules cannot"), "{diagnostic}");
}

#[test]
fn wave10_mixed_extra_tests_and_nullable_upsert_rewrites_compile() {
    let schema = "table trades:\n  public 'trades'\ntable receipts:\n  trade: trades\n  side: enum('offer', 'want')\n  received: bool\n  unique trade, side\n  public 'receipts'\n";
    for tail in ["query received(trade: trades):\n  return exists receipts[trade, side = 'offer', received = true]\n", "table records:\n  trade: trades\n  read <- exists receipts[.trade, side = 'offer', received = true]\n  online only\n"] {
        let source = format!("{schema}{tail}");
        let d = refusal(&source, "E_QUARRY_POSITIONAL_SCAN");
        classified(&d, SourceRewriteKind::MixedKey);
        let old = if tail.starts_with("query") { "receipts[trade, side = 'offer', received = true]" } else { "receipts[.trade, side = 'offer', received = true]" };
        emitted_source_compiles(&source, old, &d);
        assert!(d.source_rewrite.unwrap().contains("trade = "));
    }
    let source = "table props:\n  label: text <=30\n  unique label\n  public 'props'\ntable uses:\n  prop: props\n  public 'uses'\nmutation add(label: text <=30):\n  p = upsert props[label = label] { label }\n  return insert uses { prop: p.id }\n";
    let d = refusal(source, "E_QUARRY_TYPE");
    classified(&d, SourceRewriteKind::WriteResultNarrowing);
    assert!(d.message.contains("upsert") && d.message.contains("unreadable") && d.rewrite.contains("rolls back"), "{d}");
    emitted_source_compiles(source, "p.id", &d);
    let row_source = source.replace("prop: p.id", "prop: p");
    let d = refusal(&row_source, "E_QUARRY_TYPE");
    classified(&d, SourceRewriteKind::WriteResultNarrowing);
    let repaired = row_source.replace("{ prop: p }", &format!("{{ prop: {} }}", d.source_rewrite.as_ref().unwrap()));
    let b = compile(&[("schema.q".into(), repaired)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
}

#[test]
fn wave10_emitted_service_bootstrap_compiles_and_has_no_tautology() {
    let source = "table staff:\n  principal: principal\n  unique principal\n  immutable principal\n  read <- exists staff[viewer]\n  insert <- .principal = viewer or exists staff[viewer]\n  sync\ntable records:\n  read <- exists staff[viewer]\n  sync\nmutation grant(principal: principal):\n  return insert staff { principal }\n";
    let d = refusal(source, "E_SYNC");
    classified(&d, SourceRewriteKind::MembershipBootstrap);
    assert!(d.rewrite.starts_with("insert <- exists staff[viewer];"), "{d}");
    assert!(d.rewrite.contains("mutation grantStaff"), "{d}");
    let snippet = d.rewrite.split_once("\n\nuse identity password\n").unwrap().1.split_once("\n\nMint").unwrap().0;
    let snippet_bound = compile(&[("schema.q".into(), format!("use identity password\n{snippet}"))]);
    assert!(snippet_bound.diagnostics.is_empty() && snippet_bound.notes.is_empty(), "{:#?} {:#?}", snippet_bound.diagnostics, snippet_bound.notes);
    let repaired = emitted_source_compiles(source, "insert <- .principal = viewer or exists staff[viewer]", &d);
    let bound = compile(&[("schema.q".into(), repaired)]);
    assert!(bound.notes.iter().all(|n| n.code != "N_UNREADABLE_PROBE"));
}

#[test]
fn wave10_id_order_and_fanout_point_alternatives_compile_from_emitted_text() {
    let source = "table tasks:\n  score: int\n  public 'tasks'\njob rescore():\n  for row in tasks by .score:\n    update tasks[row.id] { score: 1 }\n";
    let d = refusal(source, "E_JOB_CURSOR_INDEX");
    assert!(d.rewrite.starts_with("use `for row in tasks:`"), "{d}");
    let choices: Vec<_> = d.rewrite.split('`').skip(1).step_by(2).collect();
    let repaired = source.replace("for row in tasks by .score:", choices[0]);
    assert!(compile(&[("schema.q".into(), repaired)]).diagnostics.is_empty());
    let repaired = source.replace("  score: int\n", &format!("  score: int\n  {}\n", choices[1]));
    assert!(compile(&[("schema.q".into(), repaired)]).diagnostics.is_empty());

    let source = "table reviews:\n  owner: principal\n  read <- .owner = viewer\n  online only\nmutation inspect(id: reviews):\n  return count(reviews)\n";
    let d = refusal(source, "E_STRUCTURAL_FANOUT");
    let point = d.rewrite.split('`').skip(1).step_by(2).find(|part| *part == "reviews[id]").unwrap();
    let repaired = source.replace("count(reviews)", point);
    assert!(compile(&[("schema.q".into(), repaired)]).diagnostics.is_empty());
    assert!(d.rewrite.contains("maintained aggregate") && d.rewrite.contains("read rule admits"), "{d}");
}

#[test]
fn emitted_roster_recipe_preserves_an_online_rosters_extra_read_predicate() {
    let source = "table staff:\n  principal: principal\n  active: bool\n  unique principal\n  immutable principal\n  read <- .principal = viewer and .active\n  insert <- .principal = viewer or exists staff[viewer]\n  online only\ntable docs:\n  read <- exists staff[viewer]\n  sync\n";
    let d = refusal(source, "E_SYNC");
    let snippet = d.rewrite.split_once("\n\nuse identity password\n").unwrap().1.split_once("\n\nMint").unwrap().0;
    assert!(snippet.contains("  online only\n"), "{snippet}");
    assert!(snippet.contains(".principal = viewer and .active = true or viewer = 'service:ops'"), "{snippet}");
    let b = compile(&[("schema.q".into(), format!("use identity password\n{snippet}"))]);
    assert!(b.diagnostics.is_empty() && b.notes.is_empty(), "{:?} {:?}", b.diagnostics, b.notes);
    emitted_source_compiles(source, "insert <- .principal = viewer or exists staff[viewer]", &d);
}
