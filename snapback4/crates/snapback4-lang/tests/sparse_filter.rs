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
        assert_eq!(notes[0].message, "entries by byTime: this unscoped `where` pins no index prefix; sparse matches can exhaust the row meter and return short `complete: false` pages");
        assert_eq!(notes[0].rewrite, "pin a leading index key, or run `snapback4 init --recipe feeds` for Following (followed authors, own posts and reposts)");
    }
}

fn following_merge(source_table: &str, take: u32, filter: &str) -> snapback4_lang::Bound {
    let source = format!("table {source_table}:\n  reader: principal\n  author: principal\n  unique byPair: reader, author\n  cap 1000 by reader\n  public 'follow graph'\n  online only\ntable entries:\n  actor: principal\n  at: time\n  by byActorTime: actor, at, id\n  public 'posts'\n  online only\nquery following(c: cursor ?):\n  return merge entries after c last 20 by byActorTime:\n    [viewer]\n    [f.author] for f in {source_table}[viewer] first {take} by byPair\n");
    let source = source.replace("last 20 by byActorTime:", &format!("last 20 by byActorTime{filter}:"));
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

#[test]
fn follow_driven_wide_merge_names_the_cost_and_adoption_command() {
    for (table, filter) in [("follows", ""), ("subscriptions", ""), ("follows", " where .at > 0")] {
        let bound = following_merge(table, 1000, filter);
        let note = bound.notes.iter().find(|n| n.code == "N_WIDE_MERGE").unwrap();
        println!("{note}");
        assert_eq!(note.message, "query following: read cost grows with the number of related principals (up to 1001 lanes); a read past the 8,192 examined ceiling returns `complete: false`");
        assert_eq!(note.rewrite, "keep read-time merges for a bounded small number of related principals; for Following, `snapback4 init --recipe feeds`; measure with `snapback4 test --cost`");
        assert_eq!(note.guide, "feeds");
    }
}

#[test]
fn bounded_small_follow_merge_and_the_adoptable_recipe_are_clean() {
    let small = following_merge("follows", 5, "");
    assert!(small.notes.is_empty(), "{:?}", small.notes);
    let recipe = snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).remove(0);
    let bound = snapback4_lang::compile(&[("schema.q".into(), recipe)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
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
