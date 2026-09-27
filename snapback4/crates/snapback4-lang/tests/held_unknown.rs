//! @ref LLP 3000.021#3.1 — a conservative note, not a dispatch or authorization change.
use snapback4_lang::{Bound, compile, guide};
use snapback4_core::ir::{Expr, Stmt};

const COMPARATIVE: &str = include_str!("history/comparative.q");
const TABLES: &str = "table rows:\n  owner: principal\n  text: text <=100\n  search text\n  public 'held rows'\n  sync last 10 by .id\ntable remote:\n  owner: principal\n  target: rows ?\n  unique owner\n  text: text <=100\n  public 'remote rows'\n";
fn bound(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
fn notes(bound: &Bound) -> Vec<&snapback4_lang::Diagnostic> {
    bound.notes.iter().filter(|note| note.code == "N_HELD_UNKNOWN").collect()
}

#[test]
fn comparative_bare_history_and_separate_decorations_compile_without_notes() {
    let bound = bound(COMPARATIVE);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert!(!bound.schema.operations["history"].held);
    assert!(bound.schema.operations["searchHeld"].held);
    let history = &bound.programs.iter().find(|p| p.program.name == "history").unwrap().program;
    assert!(snapback4_core::ir::read_sites(history).iter().all(|read| read.table == "messages"));
    assert!(matches!(history.body.as_slice(), [Stmt::Return(Expr::Scan(_))]), "history must return the bare stored rows: {:?}", history.body);
}

#[test]
fn guide_histories_are_bare_pages_without_membership_requirements() {
    for (card, query) in [("app", "thread"), ("sync", "history"), ("receipts", "history")] {
        let source = guide::quarry(guide::card(card).unwrap()).into_iter()
            .find(|source| source.contains(&format!("query {query}("))).unwrap();
        let bound = bound(&source);
        assert!(!bound.schema.operations[query].held, "{card}");
        let history = &bound.programs.iter().find(|p| p.program.name == query).unwrap().program;
        assert!(matches!(history.body.as_slice(), [Stmt::Return(Expr::Scan(_))]), "{card}: {:?}", history.body);
    }
}

fn check_held_parent_note(read: &str, pins_parent: bool) {
    for sync in ["", "  online only\n", "  sync\n", "  sync last 10 by .id\n"] {
        let source = format!("table folders:\n  name: text <=40\n  public 'folders are public'\n{sync}table files:\n  folder: folders\n  name: text <=80\n  immutable folder\n  read through .folder\n  sync\nquery heldFile(id: files, folder: folders, c: cursor ?) held:\n  return {read}\n");
        let bound = bound(&source);
        assert!(bound.schema.tables["files"].sync.is_some());
        let notes = notes(&bound);
        if !pins_parent || sync.contains("sync") { assert!(notes.is_empty(), "{read}: {notes:?}"); }
        else {
            assert_eq!(notes.len(), 1, "{read}: {notes:?}");
            assert!(notes[0].message.contains("folders has no sync"));
            assert_eq!(source.lines().nth(notes[0].site.line as usize - 1).unwrap(), format!("  return {read}"));
            assert_eq!(notes[0].rewrite, "move the read to its own query, or drop `held`");
        }
    }
}

#[test]
fn held_read_through_point_does_not_note_parent() {
    check_held_parent_note("files[id]", false);
}

#[test]
fn held_read_through_exists_does_not_note_parent() {
    check_held_parent_note("exists files[id]", false);
}

#[test]
fn held_read_through_unpinned_pages_do_not_note_parent() {
    for read in ["files last 10 by .id after c", "files last 10 by .folder, .id after c"] {
        check_held_parent_note(read, false);
    }
}

#[test]
fn held_parent_pinned_page_notes_only_an_unsynced_parent() {
    check_held_parent_note("files where .folder = folder last 10 by .id after c", true);
}

#[test]
fn held_parent_key_aggregate_notes_only_an_unsynced_parent() {
    for sync in ["", "  online only\n", "  sync\n", "  sync last 10 by .id\n"] {
        let source = format!("table folders:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n{sync}table files:\n  folder: folders\n  immutable folder\n  read through .folder\n  sync\nview counts: count files by .folder\nquery heldCount(folder: folders) held:\n  return counts[folder]\n");
        let bound = bound(&source);
        assert!(bound.schema.tables["files"].sync.is_some());
        assert!(bound.schema.maintain_for("counts").unwrap().parent_key.is_some());
        // The view's own unsynced-source advice must not hide a missing parent note.
        let notes: Vec<_> = notes(&bound).into_iter().filter(|note| note.message.contains("folders has no sync")).collect();
        if sync.contains("sync") { assert!(notes.is_empty(), "{notes:?}"); }
        else {
            assert_eq!(notes.len(), 1, "{notes:?}");
            assert_eq!(source.lines().nth(notes[0].site.line as usize - 1).unwrap(), "  return counts[folder]");
            assert_eq!(notes[0].rewrite, "move the read to its own query, or drop `held`");
        }
    }
}

#[test]
fn held_connected_reads_note_presence_in_helpers_shapes_and_branches() {
    for body in [
        "query q(p: principal) held:\n  return connected[p]\n",
        "query q(p: principal) held:\n  return exists connected[p]\n",
        "fn online(p: principal):\n  return connected[p]\nquery q(p: principal) held:\n  return online(p)\n",
        "shape online = { *, connections: connected[.owner] }\nquery q(key: rows) held:\n  return rows[key] online\n",
        "query q(p: principal, readIt: bool) held:\n  if readIt:\n    return connected[p]\n  return 0\n",
    ] {
        let source = format!("{TABLES}{body}");
        let bound = bound(&source);
        let notes = notes(&bound);
        assert_eq!(notes.len(), 1, "{source}\n{notes:?}");
        assert!(notes[0].message.contains("connected is server presence"));
        assert!(source.lines().nth(notes[0].site.line as usize - 1).unwrap().contains("connected["));
        assert_eq!(notes[0].rewrite, "move the read to its own query, or drop `held`");
        assert!(self::notes(&self::bound(&source.replace(" held:", ":"))).is_empty());
    }
}

#[test]
fn comparative_decorated_held_history_names_its_unsynced_reaction_read() {
    let source = format!("{COMPARATIVE}\nquery historyHeld(conversation: conversations, c: cursor ?) held:\n  require exists members[conversation, viewer] else NOT_MEMBER\n  return messages where .conversation = conversation last 20 by .ordinal after c {{ *, receipt: receipt(.), author: profiles[principal = .sender], quoteRow: messages[.quote], myReaction: reactions[message = .id, principal = viewer] }}\n");
    let bound = bound(&source);
    let notes = notes(&bound);
    assert_eq!(notes.len(), 1, "{notes:?}");
    let note = notes[0];
    assert!(note.message.contains("historyHeld") && note.message.contains("reactions"));
    assert_eq!(note.site.file, "schema.q");
    assert!(source.lines().nth(note.site.line as usize - 1).unwrap().contains("myReaction:"));
    assert!(note.message.contains("when that read is needed"));
    assert_eq!(note.rewrite, "move the read to its own query, or drop `held`");
    assert_eq!(note.guide, "sync");
}

#[test]
fn may_read_walk_covers_helpers_shapes_branches_nested_points_and_exists() {
    for body in [
        "query q(key: remote) held:\n  return remote[id = key]\n",
        "query q(key: remote) held:\n  return exists remote[id = key]\n",
        "query q(key: remote) held:\n  return rows[remote[id = key].target]\n",
        "query q(key: remote, readIt: bool) held:\n  if readIt:\n    return remote[id = key].text\n  return 'no read'\n",
        "fn decoration(key: remote):\n  return remote[id = key]\nquery q(key: remote) held:\n  return decoration(key)\n",
        "shape decorated = { *, decoration: remote[owner = .owner] }\nquery q(key: rows) held:\n  return rows[key] decorated\n",
        "query q(c: cursor ?) held:\n  return rows last 5 by .id after c { *, found: exists remote[owner = .owner] }\n",
        "query q(c: cursor ?) held:\n  return rows where exists remote[owner = .owner] last 5 by .id after c\n",
    ] {
        for declaration in ["", "  online only\n"] {
            let source = format!("{TABLES}{declaration}{body}");
            let bound = bound(&source);
            let notes = notes(&bound);
            assert_eq!(notes.len(), 1, "{source}\n{notes:?}");
            assert!(notes[0].message.contains("remote has no sync"));
            // The note points into the expanded read, not the table declaration.
            assert!(notes[0].site.line > (TABLES.lines().count() + declaration.lines().count()) as u32);
        }
    }
}

#[test]
fn effective_sync_covers_online_views_and_ephemeral_tables() {
    for (declarations, read, table) in [
        ("view totals: count rows by .owner\n  online only\n", "totals[viewer]", "totals"),
        ("table typing:\n  owner: principal\n  read <- .owner = viewer\n  ephemeral 4s\n", "typing[key]", "typing"),
    ] {
        let source = format!("{TABLES}{declarations}query q(key: id) held:\n  return {read}\n");
        let bound = compile(&[("schema.q".into(), source)]);
        if table == "typing" {
            assert!(bound.diagnostics.iter().any(|note| note.code == "E_QUARRY_EPHEMERAL"));
        } else { assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics); }
        assert!(notes(&bound).iter().any(|note| note.message.contains(&format!("{table} has no sync"))), "{:?}", bound.notes);
    }
    let synced = bound(&format!("{TABLES}view totals: count rows by .owner\nquery q() held:\n  return totals[viewer]\n"));
    assert!(synced.schema.tables["totals"].sync.is_some());
    assert!(notes(&synced).is_empty());
}

#[test]
fn horizons_words_and_ordinary_remote_queries_do_not_get_held_unknown() {
    let source = format!("{TABLES}query page(c: cursor ?) held:\n  return rows last 20 by .id after c\nquery search(q: text <=100, c: cursor ?) held:\n  return rows matching q last 20 by .id after c\nquery online(key: remote):\n  return remote[id = key]\n");
    let bound = bound(&source);
    assert!(notes(&bound).is_empty(), "{:?}", bound.notes);
}

#[test]
fn held_word_directory_does_not_get_order_advice_but_other_pages_still_do() {
    let source = format!("{COMPARATIVE}\nquery wrongOrder(conversation: conversations, c: cursor ?) held:\n  return messages where .conversation = conversation first 20 by .at after c\n");
    let bound = bound(&source);
    let order: Vec<_> = bound.notes.iter().filter(|note| note.code == "N_SYNC_ORDER").collect();
    assert!(order.iter().any(|note| note.message.contains("wrongOrder")), "{order:?}");
    assert!(!order.iter().any(|note| note.message.contains("searchHeld")), "{order:?}");
}

#[test]
fn guides_own_held_examples_have_no_unknown_note() {
    for name in guide::KEYWORDS {
        for source in guide::quarry(guide::card(name).unwrap()).into_iter().filter(|source| source.contains(" held:")) {
            let source = if source.lines().any(|line| line.starts_with("table ")) { source } else { format!("{}\n{source}", guide::language()) };
            let bound = bound(&source);
            assert!(notes(&bound).is_empty(), "card {name}: {:?}", bound.notes);
        }
    }
}
