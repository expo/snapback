#[path = "../../snapback4-sim/tests/papercuts/cases.rs"]
mod cases;
use cases::*;

fn bound(source: &str) -> snapback4_lang::Bound {
    snapback4_lang::compile(&[("schema.q".into(), source.into())])
}

#[test]
fn w9c_bounded_emit_only_shapes_compile() {
    for (name, body, _) in LOOPS {
        let b = bound(&loop_source(body));
        for d in &b.diagnostics { println!("{name}: {d}"); }
        assert!(b.diagnostics.is_empty(), "{name}: {:?}", b.diagnostics);
        assert_eq!(b.schema.operations["send"].predicts.as_deref(), Some("eligible"));
    }
}

#[test]
fn w9c_writes_nested_in_derived_loops_still_refuse() {
    let filtered = LOOPS.iter().find(|(name, _, _)| *name == "filtered").unwrap().1;
    for body in [
        "update batches[batchId] { recipients: [p] }",
        "if p != viewer:
      update batches[batchId] { recipients: [p] }",
        "for n in range(0, 1):
      update batches[batchId] { recipients: [p] }",
        "changed = touch(batchId, p)",
        "emit notify { changed: touch(batchId, p) }",
    ] {
        let source = loop_source(&filtered.replace("emit notify { recipient: p }", body)) + "fn touch(batchId: batches, p: principal):
  update batches[batchId] { recipients: [p] }
  return true
";
        let b = bound(&source);
        assert_eq!(b.diagnostics.len(), 1, "{body}: {:?}", b.diagnostics);
        let d = &b.diagnostics[0];
        assert_eq!(d.code, "E_STRUCTURAL_FANOUT", "{body}: {d}");
        assert!(d.rewrite.contains("members[] first 3 by byPrincipal"), "{d}");
        println!("{body}: {d}");
    }
}

#[test]
fn w9c_unique_hook_uses_require_code_validation() {
    for code in ["badCode", "E_HANDLE_TAKEN"] {
        let ordinary = bound(&format!("mutation check():
  require false else {code}
"));
        let unique = bound(&profiles(&format!(" else {code}")));
        assert_eq!(unique.diagnostics.len(), 1, "{:?}", unique.diagnostics);
        assert_eq!(unique.diagnostics[0].code, ordinary.diagnostics[0].code);
        assert_eq!(unique.diagnostics[0].message, ordinary.diagnostics[0].message);
    }
    for code in ["HANDLE_TAKEN", "APP_42"] {
        let b = bound(&profiles(&format!(" else {code}")));
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    }
}
