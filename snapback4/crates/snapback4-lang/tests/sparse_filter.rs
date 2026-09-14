fn check(read: &str) -> snapback4_lang::Bound {
    let source = format!("table entries:\n  actor: principal\n  at: time\n  body: text <=500\n  by byTime: at, id\n  by byActorTime: actor, at, id\n  read <- allow\nquery following(c: cursor ?):\n  return {read}\n");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

#[test]
fn unscoped_sparse_filters_name_the_feed_recipe() {
    for predicate in [".actor = viewer", ".actor = viewer or .body = 'hello'", ".at = 1 or .actor = viewer"] {
        let bound = check(&format!("entries after c last 20 by byTime where {predicate}"));
        let notes: Vec<_> = bound.notes.iter().filter(|n| n.code == "N_SPARSE_FILTER").collect();
        assert_eq!(notes.len(), 1, "{predicate}: {:?}", bound.notes);
        assert_eq!(notes[0].guide, "feeds");
        println!("{}", notes[0]);
    }
}

#[test]
fn scoped_or_prefix_pinned_reads_do_not_get_the_sparse_note() {
    for read in [
        "entries[viewer] after c last 20 by byActorTime where .body = 'hello' or .at = 1",
        "entries[at > 1] after c last 20 by byTime where .actor = viewer",
        "entries after c last 20 by byTime where .at = 1 and .actor = viewer",
        "entries after c last 20 by byTime where .at = 1 or .at = 2",
        "entries after c last 20 by byTime where true",
        "entries after c last 20 by byTime",
        "entries after c last 20 by byTime where .at > 1",
    ] {
        let bound = check(read);
        assert!(!bound.notes.iter().any(|n| n.code == "N_SPARSE_FILTER"), "{read}: {:?}", bound.notes);
    }
}
