//! Source-only DX5 advice does not change the guide's executable authority.
// @ref LLP 3000.000.000.001#10-wave-20-loop-repairs-dx5 — expected source advice preserves every runtime authority assertion.
use snapback4_lang::Diagnostic;

pub fn remaining<'a>(source: &str, notes: &'a [Diagnostic]) -> Vec<&'a Diagnostic> {
    notes.iter().filter(|note| {
        if !matches!(note.code.as_str(), "N_LOOKUP_FILTERED" | "N_UNIQUE_HIDDEN") { return true; }
        let line = source.lines().nth(note.site.line.saturating_sub(1) as usize).expect("located source advice");
        assert_eq!(note.site.file, "schema.q");
        assert!(note.site.col > 0 && !note.mechanical);
        assert_eq!(note.guide, "rules");
        assert!(note.rewrite.contains("do not widen private rows"), "{note}");
        if note.code == "N_UNIQUE_HIDDEN" {
            assert!(line.contains("unique") && line.contains("else"), "{line}: {note}");
            assert!(note.message.contains("generic E_RULE"));
        } else {
            assert!(line.contains('[') || line.trim_start().starts_with("receipts "), "{line}: {note}");
            assert!(note.message.contains("read") && note.message.contains("hidden, expired or missing"));
        }
        false
    }).collect()
}
