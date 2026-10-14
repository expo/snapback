use snapback4_lang::{compile, Diagnostic};
use snapback4_lang::diag::Site;
const SCHEMA: &str = include_str!("../../snapback4-sim/tests/search_merge/schema.q");
#[test]
fn w10c_empty_search_card_paves_the_directory_branch() {
    let card = snapback4_lang::guide::card("search").unwrap();
    assert!(card.contains("An empty needle, including whitespace or punctuation that folds to no terms,"));
    assert!(card.contains("reset the cursor when changing the search text."));
    assert!(card.contains("return profiles matching q after c first 20 by .handle"));
    assert!(card.contains("if q = '': return []"));
    assert!(!card.contains("query allPeople"));
}

#[test]
fn r1a_conjunctive_scope_rule_gets_the_matching_merge_envelope() {
    let source = format!("{}\nquery all(q: text <=100, c: cursor ?):\n  return messages matching q after c last 50 by byWords\n", SCHEMA.replace("roomId: id", "roomId: text <=40").replace("  sync to members[.roomId]\n", "").replace("read <- exists members[.roomId, viewer]\n  insert <- allow", "read <- exists members[.roomId, viewer] and .roomId != 'archived'\n  insert <- allow"));
    let b = compile(&[("schema.q".into(), source.clone())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let note = b.notes.iter().find(|n| n.code == "N_NEVER_COMPLETE" && n.message.starts_with("query all:")).unwrap();
    println!("{note}");
    let line = source.lines().position(|line| line.starts_with("query all")).unwrap() as u32 + 1;
    assert_eq!(*note, Diagnostic::new(&Site::new("schema.q", line, 1), "N_NEVER_COMPLETE", "query all: analyzer limitation: the page over messages[..] by byWords is never `complete` — the read rule `exists members[.roomId, viewer] and .roomId != 'archived'` reads .roomId, which the scan does not pin, so the server cannot tell \"no more\" from \"more you may not read\"", "messages matching q where exists members[.roomId, viewer] and .roomId != 'archived' last 50 by .at, .id after c — one verdict per scope; complete while every head opens and the page fits in one read; or read the page on the device").guide("search"));
    let replacement = note.rewrite.split(" — ").next().unwrap();
    let repaired = compile(&[("schema.q".into(), source.replace("messages matching q after c last 50 by byWords", replacement))]);
    assert!(repaired.diagnostics.is_empty() && repaired.notes.is_empty(), "{:?} {:?}", repaired.diagnostics, repaired.notes);
    let nonuniform = compile(&[("schema.q".into(), source.replace(".roomId != 'archived'", ".body != 'archived'"))]);
    let note = nonuniform.notes.iter().find(|n| n.code == "N_NEVER_COMPLETE" && n.message.starts_with("query all:")).unwrap();
    assert_eq!(note.guide, "reads", "a scope cannot decide the body conjunct");
}
