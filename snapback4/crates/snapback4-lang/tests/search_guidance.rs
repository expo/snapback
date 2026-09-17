use snapback4_lang::{compile, Diagnostic};
use snapback4_lang::diag::Site;
const SCHEMA: &str = include_str!("../../snapback4-sim/tests/search_merge/schema.q");
#[test]
fn w10c_empty_search_card_paves_the_directory_branch() {
    let card = snapback4_lang::guide::card("search").unwrap();
    assert!(card.contains("`matching ''` matches nothing, including when the needle contains only whitespace or punctuation."));
    assert!(card.contains("Use `allPeople` while the search box is empty and `people` once the user types."));
    assert!(card.contains("Reset the cursor when switching queries or changing the search text."));
    assert!(card.contains("return profiles after c first 20 by byId"));
}

#[test]
fn r1a_conjunctive_scope_rule_gets_the_matching_merge_envelope() {
    let source = format!("{}\nquery all(q: text <=100, c: cursor ?):\n  return messages matching q after c last 50 by byWords\n", SCHEMA.replace("roomId: id", "roomId: text <=40").replace("  sync to members[.roomId]\n", "").replace("read <- exists members[.roomId, viewer]\n  insert <- allow", "read <- exists members[.roomId, viewer] and .roomId != 'archived'\n  insert <- allow"));
    let b = compile(&[("schema.q".into(), source.clone())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let note = b.notes.iter().find(|n| n.code == "N_NEVER_COMPLETE" && n.message.starts_with("query all:")).unwrap();
    println!("{note}");
    let line = source.lines().position(|line| line.starts_with("query all")).unwrap() as u32 + 1;
    assert_eq!(*note, Diagnostic::new(&Site::new("schema.q", line, 1), "N_NEVER_COMPLETE", "query all: the page over messages[..] by byWords is never `complete` — the read rule `exists members[.roomId, viewer] and .roomId != 'archived'` reads .roomId, which the scan does not pin, so the server cannot tell \"no more\" from \"more you may not read\"", "merge messages matching q last 50 by byRoomWords: [m.roomId] for m in members[viewer] by byPrincipalRoom — one verdict per scope; complete while every head opens and the page fits in one read; or read the page on the device").guide("search"));
    let nonuniform = compile(&[("schema.q".into(), source.replace(".roomId != 'archived'", ".body != 'archived'"))]);
    let note = nonuniform.notes.iter().find(|n| n.code == "N_NEVER_COMPLETE" && n.message.starts_with("query all:")).unwrap();
    assert_eq!(note.guide, "reads", "a scope cannot decide the body conjunct");
}
