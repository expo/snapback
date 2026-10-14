use snapback4_lang::compile;
fn checked(source: &str) -> snapback4_lang::Bound { compile(&[("schema.q".into(), source.into())]) }
const REFS: &str = "table parents:\n  read <- allow\ntable kids:\n  parent: parents ? on delete keep\n  read <- allow\n  insert <- allow\n";
#[test]
fn optional_reference_checks_join_the_null_edge() {
    for condition in ["parent != null", "not (parent = null)", "null != parent"] {
        let b = checked(&format!("{REFS}mutation add(parent: parents ?):\n  if {condition}:\n    row = parents[parent] ! else NOT_FOUND\n  insert kids {{ parent }}\n"));
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        assert!(!b.notes.iter().any(|n| n.code == "N_REFERENCE_UNCHECKED"), "{:?}", b.notes);
    }
    for body in ["  if parent != null:\n    unused = true\n", "  if parent != null and skip:\n    row = parents[parent] ! else NOT_FOUND\n"] {
        let b = checked(&format!("{REFS}mutation add(parent: parents ?, other: parents ?, skip: bool):\n{body}  insert kids {{ parent }}\n"));
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        assert!(b.notes.iter().any(|n| n.code == "N_REFERENCE_UNCHECKED"), "{:?}", b.notes);
    }
}
#[test]
fn syntax_repairs_name_the_actual_form() {
    let b = checked("mutation add(body: text <=20 = 'hi'):\n  return body\n");
    assert!(b.diagnostics.iter().any(|d| d.rewrite.contains("body ?? 'hi'") && d.rewrite.contains("text <=20 ?")), "{:?}", b.diagnostics);
    let b = checked("mutation add(a: bool, b: bool):\n  require (a or\n    b)\n  else NOPE\n  return true\n");
    assert!(b.diagnostics.iter().any(|d| d.rewrite.contains("closing line") && d.rewrite.contains("else NOPE")), "{:?}", b.diagnostics);
    let b = checked("table parents:\n  public\ntable kids:\n  parent: parents on delete keep ?\n");
    assert!(b.diagnostics.iter().any(|d| d.rewrite == "parent: parents ? on delete keep"), "{:?}", b.diagnostics);
}
