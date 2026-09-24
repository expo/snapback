use snapback4_lang::compile;

const SCHEMA: &str = "table people:\n  public 'people'\ntable rooms:\n  public 'rooms'\ntable messages:\n  roomId: rooms\n  authorId: people\n  by byRoom: roomId, id\n  cap 100 by roomId\n  public 'messages'\ntable assets:\n  public 'assets'\ntable attachments:\n  assetId: assets\n  messageId: messages\n  cap 10 by messageId\n  public 'attachments'\n";

fn advice(query: &str) -> String {
    let bound = compile(&[("chat.q".into(), format!("{SCHEMA}{query}"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let notes = bound.notes.iter().filter(|note| note.code == "N_NO_CURSOR").collect::<Vec<_>>();
    assert_eq!(notes.len(), 1, "{:?}", bound.notes);
    assert!(notes[0].rewrite.contains("c: cursor ?") && notes[0].rewrite.contains("after c"));
    notes[0].rewrite.clone()
}

#[test]
fn pinned_room_page_keeps_continuation_advice_instead_of_narrowing_by_author() {
    let rewrite = advice("query page(roomId: rooms):\n  return messages[roomId] first 50 by byRoom\n");
    assert!(rewrite.contains("read the whole group with its where predicate and no page clause when its schema cap fits the examined ceiling; otherwise this page still needs continuation"), "{rewrite}");
    assert!(!rewrite.contains("authorId"), "{rewrite}");
    assert!(!rewrite.contains("declare `cap"), "{rewrite}");
}

#[test]
fn unpinned_room_page_names_its_declared_cap_not_the_first_reference() {
    let rewrite = advice("query page():\n  return messages first 50 by .id\n");
    assert!(rewrite.contains("messages where .roomId = roomId"), "{rewrite}");
    assert!(rewrite.contains("cap 100 by roomId"), "{rewrite}");
    assert!(!rewrite.contains("authorId"), "{rewrite}");
}

#[test]
fn attachments_page_names_its_message_cap_not_its_asset_reference() {
    let rewrite = advice("query page():\n  return attachments first 50 by .id\n");
    assert!(rewrite.contains("attachments where .messageId = messageId"), "{rewrite}");
    assert!(rewrite.contains("cap 10 by messageId"), "{rewrite}");
    assert!(!rewrite.contains("assetId"), "{rewrite}");
}

#[test]
fn unpinned_page_names_every_column_of_a_compound_cap() {
    let schema = SCHEMA.replace("cap 100 by roomId", "cap 100 by roomId, authorId");
    let bound = compile(&[("chat.q".into(), format!("{schema}query page():\n  return messages first 50 by .id\n"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let rewrite = &bound.notes.iter().find(|note| note.code == "N_NO_CURSOR").unwrap().rewrite;
    assert!(rewrite.contains("messages where .roomId = roomId and .authorId = authorId"), "{rewrite}");
    assert!(rewrite.contains("cap 100 by roomId, authorId"), "{rewrite}");
}

#[test]
fn a_page_without_a_cap_does_not_invent_one_from_a_reference() {
    let schema = SCHEMA.replace("  cap 10 by messageId\n", "");
    let bound = compile(&[("chat.q".into(), format!("{schema}query page():\n  return attachments first 50 by .id\n"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let rewrite = &bound.notes.iter().find(|note| note.code == "N_NO_CURSOR").unwrap().rewrite;
    assert!(rewrite.contains("attachments[id]"), "{rewrite}");
    assert!(!rewrite.contains("assetId") && !rewrite.contains("cap 50"), "{rewrite}");
}

#[test]
fn two_caps_choose_the_first_declared_group_not_the_smallest_cap() {
    let schema = SCHEMA.replace("cap 10 by messageId", "cap 10 by messageId\n  cap 3 by assetId");
    let bound = compile(&[("chat.q".into(), format!("{schema}query page():\n  return attachments first 50 by .id\n"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let rewrite = &bound.notes.iter().find(|note| note.code == "N_NO_CURSOR").unwrap().rewrite;
    assert!(rewrite.contains("attachments where .messageId = messageId"), "{rewrite}");
    assert!(rewrite.contains("cap 10 by messageId"), "{rewrite}");
    assert!(!rewrite.contains("assetId") && !rewrite.contains("cap 3"), "{rewrite}");
}
