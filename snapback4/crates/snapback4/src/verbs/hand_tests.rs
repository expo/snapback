use super::*;
#[test]
fn bound_explanation_is_once_per_run_and_keeps_every_located_rewrite() {
    use snapback4_lang::{Diagnostic, Site};
    let diagnostics = [
        Diagnostic::new(&Site::new("schema.q",1,1), "E_QUARRY_BOUND", "first unbounded read", "cap 10 by owner").guide("bounds"),
        Diagnostic::new(&Site::new("schema.q",2,1), "E_QUARRY_BOUND", "second unbounded read", "cap 20 by team").guide("bounds"),
        Diagnostic::new(&Site::new("schema.q",3,1), "E_QUARRY_BOUND", "third unbounded read", "first 5 by byId").guide("reads"),
        Diagnostic::new(&Site::new("schema.q",4,1), "E_QUARRY_BOUND", "fourth unbounded read", "first 9 by byId").guide("reads"),
    ];
    let report = diagnostic_reports(&diagnostics, "", true).join("\n");
    assert_eq!(report.matches("Full card:").count(),1, "{report}");
    for diagnostic in diagnostics { assert!(report.contains(&diagnostic.to_string()), "every located rewrite survives"); }
}
