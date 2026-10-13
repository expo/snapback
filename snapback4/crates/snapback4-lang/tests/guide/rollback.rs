use super::*;

#[test]
fn every_packaged_card_has_consistent_release_rollback_claims() {
    for name in KEYWORDS {
        let text=card(name).unwrap();
        for paragraph in text.split("\n\n") {
            if !paragraph.to_ascii_lowercase().contains("rollback") {continue;}
            for obsolete in ["rows are lost", "values are lost", "enum value in use refuses", "preceding immutable release", "N−1", "N-1"] {
                assert!(!paragraph.contains(obsolete),"{name}: obsolete rollback claim: {paragraph}");
            }
        }
    }
    for name in ["deploy","evolution"] {assert!(card(name).unwrap().contains("dormant"));}
    for phrase in ["What the old release sees","NOT_FOUND","E_OP","Original dormant values restored"] {assert!(card("deploy").unwrap().contains(phrase),"{phrase}");}
}
