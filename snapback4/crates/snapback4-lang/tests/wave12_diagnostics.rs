use snapback4_lang::compile;

#[test]
fn project_builtins_are_reserved_for_parameters_locals_and_loop_bindings() {
    for (source, name) in [
        ("query q(now: time):\n  return now\n", "now"),
        ("mutation m():\n  now = 1\n  return now\n", "now"),
        ("mutation m(commit: time):\n  return commit\n", "commit"),
        ("mutation m():\n  commit = now\n  return commit\n", "commit"),
        ("mutation m(new: text):\n  return new\n", "new"),
        ("mutation m():\n  new = 1\n  return new\n", "new"),
        ("mutation m():\n  for new in range(0, 1):\n    return new\n", "new"),
        ("query q(viewer: principal):\n  return viewer\n", "viewer"),
        ("mutation m():\n  viewer = 'alice'\n  return viewer\n", "viewer"),
        ("fn helper(viewer: principal):\n  return viewer\n", "viewer"),
    ] {
        let bound = compile(&[("schema.q".into(), source.into())]);
        let diagnostic = bound
            .diagnostics
            .iter()
            .find(|d| d.code == "E_QUARRY_RESERVED")
            .unwrap_or_else(|| panic!("{name}: {:?}", bound.diagnostics));
        assert!(diagnostic.message.contains(&format!("`{name}`")), "{diagnostic}");
    }
}

#[test]
fn repeated_identity_declarations_name_both_method_sets() {
    let same_file = compile(&[(
        "schema.q".into(),
        "use identity password\nuse identity guests\n".into(),
    )]);
    assert_eq!(same_file.diagnostics.len(), 1, "{:?}", same_file.diagnostics);
    let diagnostic = &same_file.diagnostics[0];
    assert_eq!(diagnostic.code, "E_QUARRY_IDENTITY_DUPLICATE");
    assert_eq!(diagnostic.site.line, 2);
    assert!(
        diagnostic.message.contains("password") && diagnostic.message.contains("guests"),
        "{diagnostic}"
    );

    let across_files = compile(&[
        ("schema.q".into(), "use identity guests\n".into()),
        ("accounts.q".into(), "use identity\n".into()),
    ]);
    assert_eq!(across_files.diagnostics.len(), 1, "{:?}", across_files.diagnostics);
    let diagnostic = &across_files.diagnostics[0];
    assert_eq!(diagnostic.site.file, "accounts.q");
    assert!(
        diagnostic.message.contains("guests")
            && diagnostic.message.contains("password and guests"),
        "{diagnostic}"
    );
}

fn diagnostic(source: &str, code: &str) -> snapback4_lang::Diagnostic {
    let bound = compile(&[("schema.q".into(), source.into())]);
    bound
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == code)
        .cloned()
        .unwrap_or_else(|| panic!("missing {code}: {:#?}", bound.diagnostics))
}

fn replace_and_compile(source: &str, authored: &str, replacement: &str) {
    let repaired = source.replacen(authored, replacement, 1);
    assert_ne!(repaired, source, "fixture does not contain {authored:?}");
    let bound = compile(&[("schema.q".into(), repaired)]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
}

#[test]
fn sql_habits_name_quarry_order_and_emit_compiling_rewrites() {
    let count = "table logs:\n  kind: text <=20\n  public 'logs'\nquery total():\n  return count logs where .kind = 'error'\n";
    let d = diagnostic(count, "E_QUARRY_SYNTAX");
    assert!(d.message.contains("aggregates take parentheses"), "{d}");
    replace_and_compile(count, "count logs where .kind = 'error'", &d.rewrite);

    let ascending = "table logs:\n  at: time\n  public 'logs'\nquery recent():\n  return logs first 20 by .at desc\n";
    let d = diagnostic(ascending, "E_QUARRY_SYNTAX");
    assert!(d.message.contains("first 20 by .at") && d.message.contains("ascending"), "{d}");
    assert!(d.rewrite.starts_with("logs last 20 by .at") && !d.rewrite.contains("desc"), "{d}");
    replace_and_compile(ascending, "logs first 20 by .at desc", &d.rewrite);

    let descending = "table logs:\n  at: time\n  public 'logs'\nquery recent():\n  return logs last 20 by .at desc\n";
    let d = diagnostic(descending, "E_QUARRY_SYNTAX");
    assert!(d.message.contains("last 20 by .at") && d.message.contains("descending"), "{d}");
    assert!(d.rewrite.starts_with("logs last 20 by .at") && !d.rewrite.contains("desc"), "{d}");
    replace_and_compile(descending, "logs last 20 by .at desc", &d.rewrite);

    let shaped = compile(&[
        ("schema.q".into(), "table logs:\n  at: time\n  public 'logs'\nquery recent():\n  return logs last 20 by .at desc\n".into()),
        ("shapes.q".into(), "shape desc = { id }\n".into()),
    ]);
    assert!(shaped.diagnostics.is_empty(), "{:#?}", shaped.diagnostics);
}

#[test]
fn cross_table_identity_names_the_wrong_reference_before_scan_advice() {
    let source = "table secrets:\n  public 'secrets'\ntable rolls:\n  public 'rolls'\nquery wrong(secret: secrets):\n  r = secrets[secret] ! else NOT_FOUND\n  return exists rolls[r.id]\n";
    let d = diagnostic(source, "E_QUARRY_POSITIONAL_SCAN");
    assert!(d.message.contains("`r.id` is a secrets reference"), "{d}");
    assert!(d.message.contains("rolls key position 1 expects a rolls reference"), "{d}");

    let ambiguous = "table secrets:\n  public 'secrets'\ntable rolls:\n  primary: secrets\n  backup: secrets\n  unique primary\n  unique backup\n  public 'rolls'\nquery wrong(secret: secrets):\n  return rolls[secret]\n";
    let d = diagnostic(ambiguous, "E_QUARRY_POSITIONAL_SCAN");
    assert!(d.message.contains("candidate keys"), "{d}");
    assert!(!d.message.contains("keyed by its own id"), "{d}");

    let later_mismatch = "table secrets:\n  public 'secrets'\ntable rolls:\n  secret: secrets\n  number: int\n  unique secret, number\n  public 'rolls'\nquery wrong(secret: secrets):\n  return rolls[secret, 'bad']\n";
    let d = diagnostic(later_mismatch, "E_QUARRY_POSITIONAL_SCAN");
    assert!(d.message.contains("no declared unique key accepting these positional argument types"), "{d}");
    assert!(!d.message.contains("is a secrets reference") && !d.message.contains("key position"), "{d}");

    let wrong_composite_source = "table users:\n  public 'users'\ntable secrets:\n  public 'secrets'\ntable rolls:\n  secret: secrets\n  number: int\n  unique secret, number\n  public 'rolls'\nquery wrong(user: users):\n  return rolls[user, 1]\n";
    let d = diagnostic(wrong_composite_source, "E_QUARRY_POSITIONAL_SCAN");
    assert!(d.message.contains("`user` is a users reference") && d.message.contains("key position 1 expects a secrets reference"), "{d}");
    assert!(d.rewrite.contains("replace `user` with a secrets reference") && !d.rewrite.contains("rolls reference"), "{d}");
}

#[test]
fn positional_type_selection_keeps_row_to_id_context_after_choosing_by_id() {
    for key in ["row", "(row if choose else row)"] {
        let source = format!(
            "table items:\n  public 'items'\nquery present(id: items, choose: bool):\n  row = items[id] ! else NOT_FOUND\n  return exists items[{key}]\n"
        );
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{key}: {:#?}", bound.diagnostics);
    }
    for read in ["items['']", "items[''] by byId"] {
        let source = format!("table items:\n  public 'items'\nquery present():\n  return exists {read}\n");
        let d = diagnostic(&source, "E_QUARRY_TYPE");
        assert!(d.message.contains("empty text literal cannot be an id"), "{read}: {d}");
    }
}

#[test]
fn nested_single_candidate_reads_keep_the_bind_once_path() {
    let mut key = "id".to_owned();
    // Deep enough to expose recursive duplicate binding while staying below
    // the language's existing nested-assert diagnostic expansion ceiling.
    for _ in 0..6 {
        key = format!("(items[{key}] ! else NOT_FOUND).id");
    }
    let source = format!(
        "table items:\n  public 'items'\nquery nested(id: items):\n  return items[{key}]\n"
    );
    let bound = compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
}

#[test]
fn invalid_search_keeps_the_table_symbol_for_later_references() {
    let source = "table businesses:\n  category: int\n  search category\n  public 'businesses'\nquery one(id: businesses):\n  return businesses[id]\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.iter().any(|d| d.message.contains("search category requires a text or enum column on businesses")), "{:#?}", bound.diagnostics);
    assert!(!bound.diagnostics.iter().any(|d| d.message.contains("unknown table businesses")), "{:#?}", bound.diagnostics);
}

#[test]
fn multiline_require_rewrite_preserves_the_authored_refusal_code() {
    let source = "query choose(a: bool, b: bool):\n  require (a or\n    b)\n    else NOPE\n  return 1\n";
    let d = diagnostic(source, "E_QUARRY_SYNTAX");
    assert!(d.rewrite.contains("else NOPE"), "{d}");
    assert!(!d.rewrite.contains("NOT_ALLOWED"), "{d}");
    let replacement = d.rewrite.split('`').skip(1).step_by(2)
        .find(|part| part.starts_with("require ")).expect("the one-line require repair");
    replace_and_compile(source, "require (a or\n    b)\n    else NOPE", replacement);
}

#[test]
fn reviewed_disclosure_silences_only_the_maintain_delta_note() {
    let source = "table events:\n  owner: principal\n  category: text <=20\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- allow\nmaintain totals: count events by category\n  read <- allow\n";
    let warned = compile(&[("schema.q".into(), source.into())]);
    assert!(warned.notes.iter().any(|note| note.code == "N_MAINTAIN_DELTA"), "{:#?}", warned.notes);
    let reviewed = compile(&[(
        "schema.q".into(),
        source.replace("  read <- allow\n", "  read <- allow\n  disclosure reviewed 'product staff intentionally see category totals'\n"),
    )]);
    assert!(reviewed.diagnostics.is_empty(), "{:#?}", reviewed.diagnostics);
    assert!(reviewed.notes.iter().all(|note| note.code != "N_MAINTAIN_DELTA"), "{:#?}", reviewed.notes);

    for line in [
        "  disclosure reviewed ''\n",
        "  disclosure reviewed 'first review'\n  disclosure reviewed 'second review'\n",
    ] {
        let rejected = compile(&[(
            "schema.q".into(),
            source.replace("  read <- allow\n", &format!("  read <- allow\n{line}")),
        )]);
        assert!(rejected.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_SYNTAX"), "{:#?}", rejected.diagnostics);
    }
}

#[test]
fn structural_fanout_leads_with_a_direct_viewer_predicate() {
    let source = "table bottles:\n  organizer: principal\n  read <- .organizer = viewer\n  update <- .organizer = viewer\ntable shares:\n  bottle: bottles\n  member: principal\n  organizer: principal\n  cap 120 by bottle\n  read <- .member = viewer or .organizer = viewer\n  update <- .organizer = viewer\nmutation cancel(bottle: bottles):\n  b = bottles[bottle] ! else NOT_FOUND\n  require b.organizer = viewer else NOT_ORGANIZER\n  for share in shares where .bottle = bottle:\n    update shares[share.id] { member: share.member }\n";
    let d = diagnostic(source, "E_STRUCTURAL_FANOUT");
    assert!(d.rewrite.starts_with("First add `.member = viewer`"), "{d}");
    let predicate = d
        .rewrite
        .split('`')
        .nth(1)
        .expect("the direct viewer predicate");
    assert_eq!(predicate, ".member = viewer");
    replace_and_compile(
        source,
        "shares where .bottle = bottle",
        &format!("shares where {predicate} and .bottle = bottle"),
    );
}

#[test]
fn unreadable_probe_names_an_existing_require_read_path() {
    let source = "table notes:\n  author: principal\n  read <- .author = viewer\ntable gatecodes:\n  note: notes\n  unique note\n  read <- exists notes[.note, author = viewer]\nmutation setCode(note: notes):\n  row = notes[note] ! else NOT_FOUND\n  require row.author = viewer else NOT_AUTHOR\n  if exists gatecodes[note]:\n    return 1\n  return 0\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    let note = bound.notes.iter().find(|note| note.code == "N_UNREADABLE_PROBE")
        .unwrap_or_else(|| panic!("{:#?}", bound.notes));
    assert!(note.message.contains("require/read path already established a readable notes row"), "{note}");

    for guard in [
        "require not exists notes[note] else PRESENT",
        "require exists notes[note] or other else NOT_ALLOWED",
    ] {
        let source = format!("table notes:\n  author: principal\n  read <- .author = viewer\ntable gatecodes:\n  note: notes\n  unique note\n  read <- exists notes[.note, author = viewer]\nmutation setCode(note: notes, other: bool):\n  {guard}\n  if exists gatecodes[note]:\n    return 1\n  return 0\n");
        let bound = compile(&[("schema.q".into(), source)]);
        let note = bound.notes.iter().find(|note| note.code == "N_UNREADABLE_PROBE")
            .unwrap_or_else(|| panic!("{guard}: {:#?}", bound.notes));
        assert!(!note.message.contains("require/read path already established"), "{guard}: {note}");
    }
}

#[test]
fn delete_restrict_note_opens_the_matching_guide_section() {
    let source = "table parents:\n  read <- allow\n  delete <- allow\ntable children:\n  parent: parents\n  read <- allow\nmutation drop(parent: parents):\n  delete parents[parent]\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    let note = bound.notes.iter().find(|note| note.code == "N_DELETE_RESTRICTED")
        .unwrap_or_else(|| panic!("{:#?}", bound.notes));
    assert!(note.rewrite.contains("guide writes --section \"On delete restrict\""), "{note}");
    assert!(snapback4_lang::guide::card("writes").unwrap().contains("## On delete restrict"));
}
