//! The `file` type (LLP 3000.038): its allow-list names only verifiable,
//! script-free media types; `once` does not apply; its fields are the
//! server's facts; `file` stays usable as a table name.
use snapback4_lang::compile;

fn diagnostics(source: &str) -> Vec<String> {
    compile(&[("schema.q".into(), source.into())]).diagnostics.iter().map(|d| format!("{} {} | {}", d.code, d.message, d.rewrite)).collect()
}

const OK: &str = "use server\ntable receipts:\n  owner: principal\n  scan: file <=10000000 ('application/pdf', 'image/jpeg') ?\n  notes: [file <=2000000] <=4 ?\n  read <- .owner = viewer\n  insert <- .owner = viewer\nmutation attach(scan: file <=10000000 ('application/pdf', 'image/jpeg')):\n  require scan.bytes <= 5000000 else TOO_BIG\n  require scan.type = 'application/pdf' else NOT_PDF\n  label = scan.name\n  return insert receipts { owner: viewer, scan }\n";

#[test]
fn the_type_compiles_with_and_without_an_allow_list() {
    let bound = compile(&[("schema.q".into(), OK.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let scan = &bound.schema.tables["receipts"].columns["scan"];
    assert_eq!(scan.to_string(), "file <=10000000 ('application/pdf', 'image/jpeg') ?");
    assert_eq!(bound.schema.tables["receipts"].columns["notes"].to_string(), "[file <=2000000] <=4 ?");
    let ts = snapback4_lang::emit::typescript(&bound);
    assert!(ts.contains("{ id: string; bytes?: number; type?: string; name?: string | null }"), "{ts}");
}

#[test]
fn script_bearing_and_unverifiable_types_are_refused_at_the_column() {
    for (listed, needle) in [("'text/html'", "script"), ("'image/svg+xml'", "script"), ("'application/xhtml+xml'", "script"), ("'application/x-msdownload'", "cannot verify"), ("'Application/PDF'", "lowercase")] {
        let found = diagnostics(&format!("table docs:\n  doc: file <=1000 ({listed})\n  read <- allow\n"));
        assert!(found.iter().any(|d| d.contains(needle)), "{listed}: {found:?}");
    }
    let found = diagnostics("table docs:\n  doc: file <=1000 ('application/pdf', 'application/pdf')\n  read <- allow\n");
    assert!(found.iter().any(|d| d.contains("twice")), "{found:?}");
    let found = diagnostics("table docs:\n  doc: file <=1000 ()\n  read <- allow\n");
    assert!(found.iter().any(|d| d.contains("at least one media type")), "{found:?}");
}

#[test]
fn once_does_not_apply_to_files() {
    let found = diagnostics("table docs:\n  doc: file <=1000 once\n  read <- allow\n");
    assert!(found.iter().any(|d| d.contains("once is only specified for image columns") && d.contains("remove once")), "{found:?}");
}

#[test]
fn file_fields_are_the_servers_facts() {
    let found = diagnostics("use server\ntable docs:\n  doc: file <=1000\n  read <- allow\n  insert <- allow\nmutation add(doc: file <=1000):\n  w = doc.width\n  return insert docs { doc }\n");
    assert!(found.iter().any(|d| d.contains("files have no field width") && d.contains("id, bytes, type, name")), "{found:?}");
}

#[test]
fn a_file_is_not_an_image() {
    let found = diagnostics("use server\ntable docs:\n  photo: image <=1000\n  read <- allow\n  insert <- allow\nmutation add(doc: file <=1000):\n  return insert docs { photo: doc }\n");
    assert!(found.iter().any(|d| d.contains("image") && d.contains("got file")), "{found:?}");
}

#[test]
fn a_table_named_file_is_still_a_reference() {
    let bound = compile(&[("schema.q".into(), "table file:\n  title: text <=10\n  read <- allow\ntable links:\n  target: file\n  read <- allow\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.schema.tables["links"].columns["target"].to_string(), "file");
}
