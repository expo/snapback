use snapback4_lang::compile;

const SCHEMA: &str = "table messages:\n  roomId: id\n  at: time\n  by byRoom: roomId, at, id\n  cap 100 by roomId\n  public 'messages'\n";

#[test]
fn cursor_advice_preserves_the_top_n_and_offers_only_continuation() {
    for page in ["messages first 50 by .id", "messages[roomId] last 50 by byRoom"] {
        let source = format!("{SCHEMA}query page(roomId: id):\n  return {page}\n");
        let bound = compile(&[("chat.q".into(), source.clone())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let notes = bound.notes.iter().filter(|note| note.code == "N_NO_CURSOR").collect::<Vec<_>>();
        assert_eq!(notes.len(), 1, "{:?}", bound.notes);
        let note = notes[0];
        assert!(note.message.contains("cannot continue") && !note.message.contains("complete"));
        assert!(note.site.file == "chat.q" && note.site.line > 1, "{note}");
        assert!(note.rewrite.contains("if the screen pages") && note.rewrite.contains("c: cursor ?") && note.rewrite.contains("after c"));
        assert!(!note.rewrite.contains("cap ") && !note.rewrite.contains("narrow"));
        let fixed = source.replace("roomId: id):", "roomId: id, c: cursor ?):").replace(page, &format!("{page} after c"));
        let fixed = compile(&[("chat.q".into(), fixed)]);
        assert!(fixed.diagnostics.is_empty() && fixed.notes.is_empty(), "{:?} {:?}", fixed.diagnostics, fixed.notes);
    }
}

#[test]
fn composed_first_and_last_previews_have_no_cursor_note() {
    for expression in [
        "{ latest: messages last 1 by .at }",
        "{ oldest: (messages first 1 by .at), latest: messages last 1 by .at }",
        "{ preview: (messages[roomId] last 1 by byRoom), rows: messages[roomId] last 10 by byRoom after c }",
    ] {
        let source = format!("{SCHEMA}query page(roomId: id, c: cursor ?):\n  return {expression}\n");
        let bound = compile(&[("chat.q".into(), source)]);
        assert!(bound.diagnostics.is_empty() && bound.notes.is_empty(), "{:?} {:?}", bound.diagnostics, bound.notes);
    }
}
