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
