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
        assert_eq!(notes[0].rewrite, "pin a column with `where .col = value`, choose `by .col`, or read a `view` (see `snapback4 guide feeds`)");
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
        assert_eq!(note.rewrite, "keep read-time merges for a bounded small number of related principals; for Following, declare `maintain feed: timeline` (see `snapback4 guide feeds`); measure with `snapback4 check --cost`; if a held query answers this read, delete the merge");
        assert_eq!(note.guide, "feeds");
    }
}

#[test]
fn bounded_small_follow_merge_and_the_adoptable_recipe_are_clean() {
    let small = following_merge("follows", 5, "");
    assert!(small.notes.is_empty(), "{:?}", small.notes);
    let recipe = snapback4_lang::recipe::following("", "").unwrap();
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

#[test]
fn w6a_follow_edge_filter_names_incomplete_pages_and_prefixed_install() {
    let source = "table follows:\n  reader: principal\n  author: principal\n  unique byPair: reader, author\n  read <- allow\ntable events:\n  actorId: principal\n  at: time\n  by byTime: at, id\n  read <- allow\nquery following(c: cursor ?):\n  return events after c last 20 by byTime where .actorId = viewer or exists follows[viewer, .actorId]\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let note = bound.notes.iter().find(|n| n.code == "N_SPARSE_FILTER").unwrap();
    println!("{note}");
    assert_eq!(note.message, "events by byTime: this unscoped `where` pins no index prefix; pages come back short and incomplete when followed authors are sparse (`complete: false`)");
    assert_eq!(note.rewrite, "pin a column with `where .col = value`, choose `by .col`, or read a `view` (see `snapback4 guide feeds`)");
}

#[test]
fn w6a_prefixing_uses_syntax_and_preserves_literals_fields_and_locals() {
    let recipe = snapback4_lang::recipe::following("", "").unwrap();
    let extra = "\n-- posts follows copy must stay unchanged here\nfn echo(posts: text <=100): posts\nquery quoted():\n  return { posts: echo('posts follows copy'), copy: 'é posts' }\n";
    let source = format!("{recipe}{extra}");
    assert!(snapback4_lang::compile(&[("schema.q".into(), source.clone())]).diagnostics.is_empty());
    for prefix in ["feed", "social_2", "_f"] {
        let renamed = snapback4_lang::recipe::prefix_module(&source, prefix, "feed").unwrap();
        assert!(renamed.contains("-- posts follows copy must stay unchanged here"));
        assert!(renamed.contains("(posts: text <=100): posts"));
        assert!(renamed.contains("('posts follows copy'), copy: 'é posts' }"));
        assert!(renamed.contains("unique byReaderTime:"));
        let bound = snapback4_lang::compile(&[("feed.q".into(), renamed.clone())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert!(bound.notes.is_empty(), "{:?}", bound.notes);
        let (before, _) = snapback4_lang::parse_document("feed.q", &source);
        let (after, _) = snapback4_lang::parse_document("feed.q", &renamed);
        let names = |doc: snapback4_lang::ast::Document| doc.tables.into_iter().map(|t| t.name)
            .chain(doc.functions.into_iter().map(|f| f.name)).chain(doc.programs.into_iter().map(|p| p.name))
            .chain(doc.schedules.into_iter().map(|s| s.name)).collect::<Vec<_>>();
        assert_eq!(names(after), names(before).iter().map(|n| snapback4_lang::recipe::prefixed_name(prefix, n)).collect::<Vec<_>>());
    }
}

#[test]
fn w6r1_qualified_schedule_targets_rename_only_local_operations() {
    let recipe = snapback4_lang::recipe::following("", "").unwrap();
    for prefix in ["", "feed"] {
        for module in ["", "feed"] {
            let source = recipe.replace(": purgeRemoved\n", ": feed.purgeRemoved\n");
            let renamed = snapback4_lang::recipe::prefix_module(&source, prefix, module).unwrap();
            let target = format!("feed.{}", snapback4_lang::recipe::prefixed_name(prefix, "purgeRemoved"));
            assert!(renamed.contains(&format!(": {target}\n")), "{target}");
            let bound = snapback4_lang::compile(&[("feed.q".into(), renamed)]);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
            assert!(bound.notes.is_empty(), "{:?}", bound.notes);
        }
        for target in ["other.purgeRemoved", "external"] {
            let source = recipe.replace(": purgeRemoved\n", &format!(": {target}\n"));
            let renamed = snapback4_lang::recipe::prefix_module(&source, prefix, "feed").unwrap();
            assert!(renamed.contains(&format!(": {target}\n")), "external target must keep its meaning");
        }
    }
}

#[test]
fn w6r2_foreign_schedule_targets_keep_their_module_with_any_output_module() {
    let recipe = snapback4_lang::recipe::following("", "").unwrap();
    let foreign = recipe.replace(": purgeRemoved\n", ": other.purgeRemoved\n");
    for module in ["feed", "", "other"] {
        let renamed = snapback4_lang::recipe::prefix_module(&foreign, "feed", module).unwrap();
        let (doc, diagnostics) = snapback4_lang::parse_document("feed.q", &renamed);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let target = &doc.schedules[0].target;
        println!("output module={module:?}: target={target}");
        assert_eq!(target, "other.purgeRemoved");
        let external = "job purgeRemoved():\n  chunk p in feedRemovedEvents first 1 by byId:\n    delete feedRemovedEvents[id = p.id]\n".into();
        let bound = snapback4_lang::compile(&[("feed.q".into(), renamed), ("other.q".into(), external)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert_eq!(bound.schema.schedules[0].target, "other.purgeRemoved");
    }
}
