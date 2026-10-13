use super::*;

#[test]
fn intentional_input_cases_and_later_operations_are_not_fixture_drift() {
    let p = Project::new();
    p.source("use personas alice\nquery answer(n: int 1..5):\n  return n\n");
    fs::create_dir(p.0.join("fixtures")).unwrap();
    let cases = [
        r#"{"op":"answer","args":{"n":6},"expect":"E_INPUT"}"#,
        r#"{"op":"answer","args":{},"expect":"E_INPUT"}"#,
        r#"{"op":"answer","args":{"n":"wrong"},"expect":"E_INPUT"}"#,
        r#"{"op":"answer","args":{"n":2,"extra":1},"expect":"E_INPUT"}"#,
    ].join("\n");
    fs::write(p.0.join("fixtures/test.cases.jsonl"), &cases).unwrap();
    let out = p.run(&["check", "--json"]);
    assert!(out.status.success(), "{out:?}");
    assert!(!parsed(&out)["notes"].as_array().unwrap().iter().any(|n| n["code"] == "N_FIXTURE_ARGUMENT_DRIFT"));
    let test = p.run(&["test", "--fixture", "fixtures"]);
    assert!(test.status.success(), "{test:?}");
    fs::write(p.0.join("fixtures/test.cases.jsonl"), format!("{cases}\n{{\"op\":\"later\",\"args\":{{}}}}\n{{\"op\":\"answer\",\"args\":{{\"n\":6}},\"expect\":\"sent\"}}\n")).unwrap();
    let out = p.run(&["check", "--json"]);
    let json = parsed(&out);
    let notes: Vec<_> = json["notes"].as_array().unwrap().iter().filter(|n| n["code"] == "N_FIXTURE_ARGUMENT_DRIFT").collect();
    assert_eq!(notes.len(), 1, "{json}");
    let test = p.run(&["test", "--fixture", "fixtures"]);
    assert!(!test.status.success());
    let text = String::from_utf8_lossy(&test.stderr);
    assert!(text.contains("unknown operation later"), "{test:?}");
    assert!(!p.store().exists());
}

#[test]
fn production_readiness_groups_dependents_and_collapses_persona_identity() {
    let p = Project::new();
    let source = "use identity password\ntable staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  insert <- exists staff[viewer]\n  online only\ntable rooms:\n  read <- allow\n  insert <- exists staff[viewer]\n  online only\ntable bookings:\n  read <- allow\n  insert <- exists staff[viewer]\n  online only\nmutation staffer(principal: principal):\n  return insert staff { principal }\nmutation room():\n  return insert rooms {}\nmutation booking():\n  return insert bookings {}\n";
    p.source(source);
    let out = p.run(&["check", "--json"]);
    assert!(out.status.success(), "{out:?}");
    let json = parsed(&out);
    let notes: Vec<_> = json["notes"].as_array().unwrap().iter().filter(|n| n["code"] == "N_NO_PRODUCTION_WRITER").collect();
    assert_eq!(notes.len(), 1, "{json}");
    let msg = notes[0]["message"].as_str().unwrap();
    assert!(msg.starts_with("staff:") && msg.contains("bookings, rooms depend on it"), "{msg}");
    p.source(&source.replace("use identity password", "use personas alice"));
    let out = p.run(&["check", "--json"]);
    let json = parsed(&out);
    let notes: Vec<_> = json["notes"].as_array().unwrap().iter().filter(|n| n["code"] == "N_NO_PRODUCTION_WRITER").collect();
    assert_eq!(notes.len(), 1, "{json}");
    assert!(notes[0]["message"].as_str().unwrap().starts_with("persona-only: no production identity"));
    for seat in ["ops", "not a seat", ""] {
        p.source(&source.replace("insert <- exists staff[viewer]", &format!("insert <- viewer = 'service:{seat}' or exists staff[viewer]")));
        let out = p.run(&["check", "--json"]); assert!(out.status.success(), "{out:?}");
        let json = parsed(&out);
        let count = json["notes"].as_array().unwrap().iter().filter(|n| n["code"] == "N_NO_PRODUCTION_WRITER").count();
        assert_eq!(count, usize::from(seat != "ops"), "{seat}: {json}");
    }
}

#[test]
fn fixture_constraints_keep_the_column_and_code_instead_of_not_found() {
    let p = Project::new();
    p.source("table proofs:\n  version: int 1..\n  label: text <=30\n  unique label else DUPLICATE\n  public 'proofs'\nquery versions():\n  return proofs first 10 by .id\n");
    fs::create_dir(p.0.join("fixtures")).unwrap();
    for (rows, expected) in [
        (r#"{"id":"p","version":0,"label":"a"}"#, "proofs.version"),
        ("{\"id\":\"p1\",\"version\":1,\"label\":\"a\"}\n{\"id\":\"p2\",\"version\":1,\"label\":\"a\"}", "DUPLICATE"),
    ] {
        fs::write(p.0.join("fixtures/proofs.jsonl"), rows).unwrap();
        let out = p.run(&["test", "--fixture", "fixtures"]);
        assert!(!out.status.success());
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        assert!(text.contains(expected) && !text.contains("NOT_FOUND"), "{text}");
        assert!(text.contains("E_CONSTRAINT") || text.contains("DUPLICATE"), "{text}");
    }
    assert!(!p.store().exists());
}
