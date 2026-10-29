use snapback4_lang::compile;

const SCHEMA: &str = "use identity password\ntable entries:\n  owner: principal\n  price: money USD read <- .owner = viewer\n  paid: bool read <- .owner = viewer\n  dueAt: time\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\n";
fn errors(source: &str) -> Vec<snapback4_lang::Diagnostic> {
    compile(&[("schema.q".into(), format!("{SCHEMA}{source}"))]).diagnostics
}
#[test]
fn nullable_private_repairs_bind_present_values_and_compile() {
    for (field, expression, fixed) in [
        ("price", "r.price > 0", "value > 0"),
        ("paid", "not r.paid", "not value"),
        ("paid", "r.paid and r.paid", "value and value"),
    ] {
        let prefix = "mutation inspect(entry: entries):\n  r = entries[entry] ! else NOT_FOUND\n  require r.owner = viewer else NOT_ALLOWED\n";
        let bad = errors(&format!("{prefix}  return {expression}\n"));
        let diagnostic = bad.iter().find(|d| d.code == "E_QUARRY_TYPE").expect("private value remains optional");
        assert!(diagnostic.rewrite.contains("! else MISSING_VALUE"), "{diagnostic:?}");
        assert!(diagnostic.rewrite.contains("hidden") || diagnostic.rewrite.contains("private"), "{diagnostic:?}");
        let good = errors(&format!("{prefix}  value = r.{field} ! else MISSING_VALUE\n  return {fixed}\n"));
        assert!(good.is_empty(), "{good:?}");
    }
}
