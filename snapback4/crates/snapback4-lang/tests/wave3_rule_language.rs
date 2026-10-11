//! App-farm wave 3 (snapback4@0.4.18): rule-language friction (LLP 3000.036
//! §13). Each test pins `check` against the engine on the lanes' own shapes,
//! and every rewrite a test reaches is applied and compiled again.
use snapback4_core::{Context, Engine, Value};
use snapback4_lang::{Bound, Diagnostic, compile};
use std::collections::BTreeMap;

fn bound(source: &str) -> Bound {
    compile(&[("schema.q".into(), source.into())])
}

fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
    b
}

#[allow(dead_code)]
fn first(source: &str, code: &str) -> Diagnostic {
    let b = bound(source);
    b.diagnostics.iter().find(|d| d.code == code && d.cascade_of.is_none()).unwrap_or_else(|| panic!("{code}: {:#?}", b.diagnostics)).clone()
}

fn note<'a>(b: &'a Bound, code: &str) -> Option<&'a Diagnostic> {
    b.notes.iter().find(|n| n.code == code)
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

// ---- #3a: a guarded staff branch is complete, and `check` says so ----

/// Lanes 027 035 054 061 062 068 077 093 095: a read rule `owner or grant`,
/// and one query whose unpinned scan only grant holders reach.
fn desk(grant: &str, query: &str) -> String {
    format!("table staff:
  principal: principal
  role: text
  unique principal
  read <- .principal = viewer
  online only
table items:
  owner: principal
  at: int
  read <- .owner = viewer or {grant}
  online only
{query}")
}

fn engine(source: &str) -> Engine {
    use snapback4_core::value::object;
    let b = clean(source);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let item = |id: &str, owner: &str, at: i64| ("items".to_owned(), object([("id", Value::Id(id.into())), ("owner", Value::Id(owner.into())), ("at", Value::Int(at))]));
    engine.seed([
        ("staff".to_owned(), object([("id", Value::Id("s1".into())), ("principal", Value::Id("tess".into())), ("role", Value::String("manager".into()))])),
        ("staff".to_owned(), object([("id", Value::Id("s2".into())), ("principal", Value::Id("ian".into())), ("role", Value::String("intern".into()))])),
        item("i1", "alice", 1), item("i2", "bob", 2), item("i3", "alice", 3),
    ]).unwrap();
    engine
}

fn complete(engine: &mut Engine, viewer: &str) -> (bool, usize) {
    let outcome = engine.query("q", Context::new(viewer, args(&[("c", Value::Null)]))).unwrap();
    (outcome.complete, outcome.data.as_array().map_or(0, |rows| rows.len()))
}

#[test]
fn a_guarded_staff_branch_is_complete_and_check_agrees() {
    let staff = "exists staff[principal = viewer]";
    let manager = "exists staff[principal = viewer, role = 'manager']";
    let seat = "viewer = 'tess'";
    let cases = [
        // 027 061 068 095: `if G:` around the staff page.
        (staff, "query q(c: cursor ?):\n  if exists staff[principal = viewer]:\n    return items last 50 by .at, .id after c\n  return items where .owner = viewer last 50 by .at, .id after c\n"),
        // 061 095: an early exit for everyone else.
        (staff, "query q(c: cursor ?):\n  if not exists staff[principal = viewer]:\n    return []\n  return items last 50 by .at, .id after c\n"),
        // The early exit returns the caller's own rows instead.
        (staff, "query q(c: cursor ?):\n  if not exists staff[viewer]:\n    return items where .owner = viewer last 50 by .at, .id after c\n  return items last 50 by .at, .id after c\n"),
        // `else` of a negated guard.
        (staff, "query q(c: cursor ?):\n  if not exists staff[viewer]:\n    return []\n  else:\n    return items last 50 by .at, .id after c\n"),
        // 035 054 062: a role named by an equality (the probe binds the row, then compares).
        (manager, "query q(c: cursor ?):\n  if exists staff[principal = viewer, role = 'manager']:\n    return items last 50 by .at, .id after c\n  return items where .owner = viewer last 50 by .at, .id after c\n"),
        (manager, "query q(c: cursor ?):\n  if not exists staff[principal = viewer, role = 'manager']:\n    return []\n  return items last 50 by .at, .id after c\n"),
        (manager, "query q(c: cursor ?):\n  require exists staff[principal = viewer, role = 'manager'] else NOT_MANAGER\n  return items last 50 by .at, .id after c\n"),
        // 093: a viewer comparison; 077: its early-exit form.
        (seat, "query q(c: cursor ?):\n  if viewer = 'tess':\n    return items last 50 by .at, .id after c\n  return items where .owner = viewer last 50 by .at, .id after c\n"),
        (seat, "query q(c: cursor ?):\n  if viewer != 'tess':\n    return items where .owner = viewer last 50 by .at, .id after c\n  return items last 50 by .at, .id after c\n"),
        // The guard as one conjunct of a larger condition the compiler keeps whole.
        (manager, "query q(c: cursor ?):\n  if viewer != 'zed' and exists staff[principal = viewer, role = 'manager']:\n    return items last 50 by .at, .id after c\n  return []\n"),
    ];
    for (grant, query) in cases {
        let source = desk(grant, query);
        let b = clean(&source);
        assert!(note(&b, "N_NEVER_COMPLETE").is_none(), "every caller who reaches the page holds the grant:\n{source}\n{:#?}", b.notes);
        let mut engine = engine(&source);
        for viewer in ["tess", "alice", "ian", "zed"] {
            let pairs = [("c", Value::Null)];
            // A `require` refuses the others: they never reach a page.
            let Ok(outcome) = engine.query("q", Context::new(viewer, args(&pairs))) else { continue };
            assert!(outcome.complete, "{viewer}: check printed no note, so the runtime must answer complete:\n{source}");
        }
        assert_eq!(complete(&mut engine, "tess").1, 3, "{source}");
    }
}

#[test]
fn a_guard_that_does_not_imply_the_grant_keeps_the_note_and_the_runtime_agrees() {
    let manager = "exists staff[principal = viewer, role = 'manager']";
    let cases = [
        // Staff is weaker than the manager grant: an intern reaches the page.
        (manager, "query q(c: cursor ?):\n  if exists staff[principal = viewer]:\n    return items last 50 by .at, .id after c\n  return []\n", "ian"),
        // A different seat.
        ("viewer = 'tess'", "query q(c: cursor ?):\n  if viewer = 'ian':\n    return items last 50 by .at, .id after c\n  return []\n", "ian"),
        // An `or` proves neither disjunct.
        ("exists staff[viewer]", "query q(open: bool, c: cursor ?):\n  if exists staff[viewer] or open:\n    return items last 50 by .at, .id after c\n  return []\n", "alice"),
        // The early exit does not leave the block on every path.
        ("exists staff[viewer]", "query q(open: bool, c: cursor ?):\n  if not exists staff[viewer]:\n    if open:\n      return []\n  return items last 50 by .at, .id after c\n", "alice"),
        // A copy of the scan before the guard.
        ("exists staff[viewer]", "query q(c: cursor ?):\n  first = items last 50 by .at, .id after c\n  if not exists staff[viewer]:\n    return []\n  return first\n", "alice"),
    ];
    for (grant, query, outsider) in cases {
        let open = !query.contains("if open:");
        let source = desk(grant, query);
        let b = bound(&source);
        assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
        let n = note(&b, "N_NEVER_COMPLETE").unwrap_or_else(|| panic!("a caller without the grant reaches the page:\n{source}\n{:#?}", b.notes));
        assert!(n.message.contains("except for callers"), "{n}");
        let mut engine = engine(&source);
        let outcome = engine.query("q", Context::new(outsider, args(&[("c", Value::Null), ("open", Value::Bool(open))].into_iter().filter(|(k, _)| query.contains("open") || *k != "open").collect::<Vec<_>>()))).unwrap();
        assert!(!outcome.complete, "{outsider} reaches the page without the grant, so the runtime answers capped:\n{source}");
    }
}

#[test]
fn an_if_guarded_staff_pass_is_admitted_and_runs_for_staff() {
    use snapback4_core::WriteState;
    let source = desk("exists staff[principal = viewer]", "query q(c: cursor ?):\n  return items where .owner = viewer last 50 by .at, .id after c\nmutation sweep(): server\n  if not exists staff[viewer]:\n    return 0\n  n = 0\n  for row in items first 50 by .id:\n    update items[row] { at: 0 }\n    n = n + 1\n  return n\n")
        .replace("  read <- .owner = viewer or exists staff[principal = viewer]\n", "  read <- .owner = viewer or exists staff[principal = viewer]\n  update <- exists staff[principal = viewer]\n");
    let mut engine = engine(&source);
    let run = |engine: &mut Engine, viewer: &str| match engine.mutate("sweep", None, Context::new(viewer, args(&[]))).unwrap().state {
        WriteState::Sent { result, .. } => result, WriteState::Failed { why, .. } => panic!("{viewer}: {}", why.code) };
    assert_eq!(run(&mut engine, "alice"), Value::Int(0));
    assert_eq!(run(&mut engine, "tess"), Value::Int(3), "staff walk every row");
}

// ---- #3b: an owner-or-X list says what a test and a client do with it ----

#[test]
fn a_never_complete_note_says_how_tests_and_clients_treat_the_page() {
    let two_party = "table tasks:\n  owner: principal\n  assignee: principal\n  at: time\n  read <- .owner = viewer or .assignee = viewer\n  insert <- .owner = viewer\n  online only\nquery mine(c: cursor ?):\n  return tasks last 20 by .at after c\n";
    let b = bound(two_party);
    let n = note(&b, "N_NEVER_COMPLETE").unwrap_or_else(|| panic!("{:#?}", b.notes));
    for words in ["test.cases.jsonl", "the default passes it", "\"there may be more\", not an error", "one query per party"] {
        assert!(n.message.contains(words), "{words}: {n}");
    }
    // The per-party rewrite is still printed in full and still compiles.
    let declarations = n.rewrite.split_once("in the client:\n").unwrap_or_else(|| panic!("{n}")).1;
    let repaired = format!("{}{declarations}\n", two_party.split("query mine").next().unwrap());
    assert!(note(&clean(&repaired), "N_NEVER_COMPLETE").is_none(), "{repaired}");
    // With a grant, the line says who expects `complete`.
    let staffed = desk("exists staff[viewer]", "query q(c: cursor ?):\n  return items last 50 by .at, .id after c\n");
    let b = bound(&staffed);
    let n = note(&b, "N_NEVER_COMPLETE").unwrap();
    assert!(n.message.contains("run it as a caller `exists staff[viewer]` admits to expect `complete`") && n.message.contains("the complete form for everyone is the pin"), "{n}");
}

// ---- #4: the page rewrite and the horizon rewrite agree ----

/// Apply an `E_QUARRY_BOUND` page rewrite: the quoted page replaces the
/// bare read, and the query declares the cursor.
fn apply_page_rewrite(source: &str, d: &Diagnostic) -> String {
    let page = d.rewrite.split('`').skip(1).step_by(2).find(|piece| piece.contains(" after c")).unwrap_or_else(|| panic!("no page in {d}"));
    let line = source.lines().nth(d.site.line as usize - 1).unwrap();
    let read = line.trim().strip_prefix("return ").unwrap();
    let repaired = source.replace(line, &line.replace(read, page));
    let header = repaired.lines().rev().skip_while(|l| !l.contains(page)).find(|l| l.starts_with("query ")).unwrap().to_owned();
    let with_cursor = if header.contains("()") { header.replace("()", "(c: cursor ?)") } else { header.replace("):", ", c: cursor ?):") };
    repaired.replace(&header, &with_cursor)
}

/// Apply an `N_NO_HORIZON` rewrite: its sync line replaces the table's.
fn apply_horizon_rewrite(source: &str, n: &Diagnostic) -> String {
    let line = n.rewrite.split(", and read").next().unwrap().trim();
    let sync = source.lines().find(|l| l.trim_start().starts_with("sync") && line.starts_with(l.trim())).unwrap_or_else(|| panic!("{n}"));
    source.replace(sync, &format!("  {line}"))
}

#[test]
fn applying_the_page_rewrite_and_the_horizon_rewrite_in_either_order_draws_no_sync_order_note() {
    let tables = [
        ("table posts:\n  author: principal\n  body: text <= 200\n  public 'posts are public'\n  insert <- .author = viewer\n  sync public\n", "query feed():\n  return posts\n"),
        ("table posts:\n  author: principal\n  at: time\n  public 'posts are public'\n  insert <- .author = viewer\n  sync public\n", "query feed():\n  return posts\n"),
        ("table notes:\n  owner: principal\n  at: time\n  immutable owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync to .owner\n", "query mine():\n  return notes where .owner = viewer\n"),
    ];
    for (table, query) in tables {
        let source = format!("{table}{query}");
        // Page first, then the window.
        let paged = apply_page_rewrite(&source, &first(&source, "E_QUARRY_BOUND"));
        let b = bound(&paged);
        assert!(b.diagnostics.is_empty(), "{paged}\n{:#?}", b.diagnostics);
        let windowed = apply_horizon_rewrite(&paged, note(&b, "N_NO_HORIZON").unwrap_or_else(|| panic!("{paged}\n{:#?}", b.notes)));
        let b = clean(&windowed);
        assert!(note(&b, "N_SYNC_ORDER").is_none() && note(&b, "N_NO_HORIZON").is_none(), "{windowed}\n{:#?}", b.notes);
        // Window first (as the note asks of the bare table), then the page.
        let bare = format!("{table}query probe(c: cursor ?):\n  return {} last 5 by .id after c\n", if table.contains("notes") { "notes where .owner = viewer" } else { "posts" });
        let window = note(&bound(&bare), "N_NO_HORIZON").unwrap().clone();
        let windowed = apply_horizon_rewrite(&source, &window);
        let paged = apply_page_rewrite(&windowed, &first(&windowed, "E_QUARRY_BOUND"));
        let b = clean(&paged);
        assert!(note(&b, "N_SYNC_ORDER").is_none(), "{paged}\n{:#?}", b.notes);
    }
}

#[test]
fn a_sync_order_note_says_which_side_differs_with_its_fix() {
    let table = "table prices:\n  item: text\n  loggedAt: time\n  public 'p'\n  insert <- allow\n  sync public last 500 by .loggedAt\n";
    let cases = [
        ("query q(c: cursor ?):\n  return prices first 50 by .loggedAt after c\n", "only the direction differs", Some("query q(c: cursor ?):\n  return prices last 50 by .loggedAt after c\n")),
        ("query q(c: cursor ?):\n  return prices last 50 by .id after c\n", "the order differs", Some("query q(c: cursor ?):\n  return prices last 50 by .loggedAt, .id after c\n")),
        ("query q(item: text, c: cursor ?):\n  return prices where .item = item last 50 by .loggedAt after c\n", "the index prefix differs: the page pins .item", None),
    ];
    for (query, says, fixed) in cases {
        let source = format!("{table}{query}");
        let b = bound(&source);
        let n = note(&b, "N_SYNC_ORDER").unwrap_or_else(|| panic!("{source}\n{:#?}", b.notes));
        assert!(n.message.contains(says), "{says}: {n}");
        if let Some(fixed) = fixed {
            let quoted = n.message.split('`').skip(1).step_by(2).find(|piece| piece.starts_with("last ")).unwrap_or_else(|| panic!("{n}"));
            assert!(fixed.contains(quoted.trim_end_matches(", .id")), "the one-line fix `{quoted}`: {n}");
            assert!(note(&clean(&format!("{table}{fixed}")), "N_SYNC_ORDER").is_none(), "{fixed}");
        }
    }
    // An ascending page: the horizon rewrite also says to read it newest first.
    let source = "table prices:\n  item: text\n  loggedAt: time\n  public 'p'\n  insert <- allow\n  sync public\nquery q(c: cursor ?):\n  return prices first 50 by .loggedAt after c\n";
    let n = note(&bound(source), "N_NO_HORIZON").unwrap().clone();
    assert!(n.rewrite.starts_with("sync public last 500 by .loggedAt, and read q newest first"), "{n}");
}

// ---- #7: a unique-key equality is a bound; a covering bound needs no cursor ----

#[test]
fn a_pinned_unique_key_bounds_a_page_and_needs_no_cursor() {
    let schema = "table results:\n  challenge: text <= 40\n  winner: principal\n  unique challenge\n  public 'p'\n  online only\ntable subscriptions:\n  subscriber: principal\n  topic: enum('news', 'events', 'offers')\n  unique subscriber, topic\n  read <- .subscriber = viewer\n  insert <- .subscriber = viewer\n  online only\n";
    for query in [
        // 098: a unique key, at most one row.
        "query r(challenge: text):\n  return results where .challenge = challenge\n",
        // 058: the row's id.
        "query r(result: results):\n  return results where .id = result\n",
        // 041: a unique key over a three-value enum: three rows per subscriber.
        "query r():\n  return subscriptions where .subscriber = viewer\n",
        // A page at or above the bound needs no cursor either.
        "query r():\n  return subscriptions where .subscriber = viewer first 3 by .topic\n",
    ] {
        let source = format!("{schema}{query}");
        let b = clean(&source);
        assert!(note(&b, "N_NO_CURSOR").is_none(), "{source}\n{:#?}", b.notes);
    }
    // The bound is exact on the engine: every subscription comes back, complete.
    use snapback4_core::value::object;
    let b = clean(&format!("{schema}query r():\n  return subscriptions where .subscriber = viewer\n"));
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let sub = |id: &str, topic: &str| ("subscriptions".to_owned(), object([("id", Value::Id(id.into())), ("subscriber", Value::Id("ann".into())), ("topic", Value::String(topic.into()))]));
    engine.seed([sub("s1", "news"), sub("s2", "events"), sub("s3", "offers")]).unwrap();
    let outcome = engine.query("r", Context::new("ann", args(&[]))).unwrap();
    assert!(outcome.complete && outcome.data.as_array().unwrap().len() == 3, "{outcome:?}");
    // A smaller page still notes the missing cursor, and a nullable key bounds nothing.
    assert!(note(&clean(&format!("{schema}query r():\n  return subscriptions where .subscriber = viewer first 2 by .topic\n")), "N_NO_CURSOR").is_some());
    let nullable = "table tags:\n  owner: principal\n  slug: text <= 40 ?\n  unique slug\n  public 'p'\n  online only\nquery r(slug: text):\n  return tags where .slug = slug\n";
    first(nullable, "E_QUARRY_BOUND");
}

// ---- #17: every printed read-hop rewrite compiles and keeps the audience ----

/// Apply a read-hop rewrite to `table` the way an author would (the
/// wave-2 helper, for merged repairs too).
fn apply_hop_rewrite(source: &str, table: &str, rewrite: &str) -> String {
    let quoted: Vec<&str> = rewrite.split('`').skip(1).step_by(2).collect();
    let mut lines: Vec<String> = source.lines().map(str::to_owned).collect();
    let header = lines.iter().position(|l| l.starts_with(&format!("table {table}:"))).unwrap_or_else(|| panic!("no {table} in {source}"));
    let end = (header + 1..lines.len()).find(|&i| !lines[i].starts_with("  ")).unwrap_or(lines.len());
    let mut inserted = Vec::new();
    for piece in &quoted {
        if let Some(read) = piece.strip_prefix("read <- ") {
            let at = (header..end).find(|&i| lines[i].trim_start().starts_with("read <-")).expect("a read line");
            lines[at] = format!("  read <- {read}");
        } else if let Some(check) = piece.strip_prefix("insert <- … and ") {
            let at = (header..end).find(|&i| lines[i].trim_start().starts_with("insert <-")).expect("an insert line");
            lines[at] = format!("{} and {check}", lines[at]);
        } else if piece.starts_with("immutable ") {
            inserted.push(format!("  {piece}"));
        } else if piece.split_once(": ").is_some_and(|(name, ty)| name.chars().all(char::is_alphanumeric) && !ty.contains('[')) {
            inserted.push(format!("  {piece}"));
        } else if *piece == "online only" {
            let at = (header..end).find(|&i| lines[i].trim_start().starts_with("sync")).expect("a sync line");
            lines[at] = "  online only".into();
        } else if !piece.starts_with("read through") {
            panic!("an unapplied rewrite piece `{piece}` in {rewrite}");
        }
    }
    for (offset, line) in inserted.into_iter().enumerate() {
        lines.insert(header + 1 + offset, line);
    }
    lines.join("\n") + "\n"
}

const STATIONS: &str = "table events:\n  owner: principal\n  public 'events are public'\n  insert <- .owner = viewer\n  online only\ntable stations:\n  event: events\n  organizer: principal\n  lead: principal\n  immutable event\n  public 'stations are public'\n  insert <- .organizer = viewer\n  online only\n";

#[test]
fn a_rule_with_several_hops_gets_one_rewrite_that_compiles_and_keeps_its_readers() {
    use snapback4_core::value::object;
    let shifts = |rule: &str| format!("{STATIONS}table shifts:\n  station: stations\n  volunteer: principal\n  immutable station, volunteer\n  read <- {rule}\n  insert <- .volunteer = viewer\n  online only\nquery all(c: cursor ?):\n  return shifts first 50 by .id after c\n");
    let cases = [
        // 033: two one-hop disjuncts; the second hop was kept and refused again.
        (".volunteer = viewer or .station.organizer = viewer or .station.lead = viewer", vec!["vic", "olga", "leo"]),
        // 067: a two-hop chain beside a one-hop one.
        (".volunteer = viewer or .station.event.owner = viewer or .station.lead = viewer", vec!["vic", "evan", "leo"]),
        // 055: a hop inside a probe key, beside a plain hop.
        (".volunteer = viewer or exists stations[id = .station, organizer = viewer] or .station.lead = viewer", vec!["vic", "olga", "leo"]),
    ];
    for (rule, readers) in cases {
        let source = shifts(rule);
        let b = bound(&source);
        assert!(!b.diagnostics.iter().any(|d| d.code == "E_READ_THROUGH"), "a narrower rule is not a membership path, so `read through` is never the repair:\n{:#?}", b.diagnostics);
        let d = first(&source, "E_QUARRY_RULE_HOP");
        assert!(d.rewrite.contains("admits more readers than this rule"), "{d}");
        let repaired = apply_hop_rewrite(&source, "shifts", &d.rewrite);
        let b = clean(&repaired);
        // The repaired rule admits exactly the parties the hops named, and no one else.
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let mut shift = vec![("id", Value::Id("sh1".into())), ("station", Value::Id("st1".into())), ("volunteer", Value::Id("vic".into()))];
        if repaired.contains("  event: events\n  station") || repaired.lines().any(|l| l == "  event: events") && repaired.matches("event: events").count() > 1 { shift.push(("event", Value::Id("e1".into()))); }
        for copied in ["organizer", "lead"] { if repaired.contains(&format!("table shifts:\n  {copied}: principal")) { shift.push((copied, Value::Id(if copied == "lead" { "leo" } else { "olga" }.into()))); } }
        engine.seed([
            ("events".to_owned(), object([("id", Value::Id("e1".into())), ("owner", Value::Id("evan".into()))])),
            ("stations".to_owned(), object([("id", Value::Id("st1".into())), ("event", Value::Id("e1".into())), ("organizer", Value::Id("olga".into())), ("lead", Value::Id("leo".into()))])),
            ("shifts".to_owned(), object(shift)),
        ]).unwrap_or_else(|e| panic!("{repaired}\n{e:?}"));
        for viewer in ["vic", "olga", "leo", "evan", "zed"] {
            let rows = engine.query("all", Context::new(viewer, args(&[("c", Value::Null)]))).unwrap().data.as_array().unwrap().len();
            assert_eq!(rows == 1, readers.contains(&viewer), "{viewer} under {rule}:\n{repaired}");
        }
    }
}

#[test]
fn hops_naming_two_audiences_on_a_synced_table_get_the_online_form() {
    let source = format!("{STATIONS}table shifts:\n  station: stations\n  volunteer: principal\n  immutable station, volunteer\n  read <- .station.organizer = viewer or .station.lead = viewer\n  insert <- .volunteer = viewer\n  sync\n");
    let d = first(&source, "E_QUARRY_RULE_HOP");
    assert!(d.rewrite.contains("replace its sync line with `online only`"), "{d}");
    clean(&apply_hop_rewrite(&source, "shifts", &d.rewrite));
    // One hop on a synced table still copies the principal (one audience).
    let one = source.replace(" or .station.lead = viewer", "");
    let d = first(&one, "E_QUARRY_RULE_HOP");
    assert!(!d.rewrite.contains("online only") && d.rewrite.contains("read <- .organizer = viewer"), "{d}");
    clean(&apply_hop_rewrite(&one, "shifts", &d.rewrite));
}

// ---- #24 (I4): money in an update rule, one ordering rule, no policy change ----

#[test]
fn a_money_update_bound_has_one_rewrite_that_compiles_and_keeps_the_policy() {
    use snapback4_core::{WriteState, value::object};
    let source = "table budgets:\n  owner: principal\n  available: money USD\n  read <- .owner = viewer\n  insert <- .owner = viewer and .available >= 0\n  update <- .owner = viewer and .available >= 0\n  online only\nmutation spend(budget: budgets, available: money USD):\n  update budgets[budget] { available }\n";
    let d = first(source, "E_QUARRY_RULE_OPERATOR");
    assert!(d.message.contains("decimal or money"), "{d}");
    let named = d.rewrite.split('`').nth(1).unwrap();
    // 062: the rewrite keeps the owner check (it used to print the bound alone).
    assert_eq!(named, "update (old, next) <- old.owner = viewer and old.available >= 0 and next.owner = viewer and next.available >= 0", "{d}");
    let repaired = source.replace("  update <- .owner = viewer and .available >= 0", &format!("  {named}"));
    let b = clean(&repaired);
    // The engine enforces it in minor units, and only for the owner.
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("budgets".to_owned(), object([("id", Value::Id("b1".into())), ("owner", Value::Id("ann".into())), ("available", Value::Int(500))]))]).unwrap();
    let run = |engine: &mut Engine, viewer: &str, cents: i64| match engine.mutate("spend", None, Context::new(viewer, args(&[("budget", Value::Id("b1".into())), ("available", Value::Int(cents))]))).unwrap().state {
        WriteState::Sent { .. } => "sent".to_owned(), WriteState::Failed { why, .. } => why.code };
    assert_eq!(run(&mut engine, "ann", -1), "E_RULE");
    assert_eq!(run(&mut engine, "ann", 0), "sent");
    assert_ne!(run(&mut engine, "bob", 100), "sent");
    // A remaining mismatch names the mutation check, not a different bound (062's second rewrite).
    let mismatch = "table budgets:\n  owner: principal\n  available: money USD\n  floor: int\n  read <- .owner = viewer\n  update (old, next) <- old.owner = viewer and next.available >= old.floor\n  online only\n";
    let d = first(mismatch, "E_QUARRY_TYPE");
    assert!(d.rewrite.contains("require available >= row.floor else INVALID_AVAILABLE") && !d.rewrite.contains("update (old, next)"), "{d}");
}

// ---- #23 (I5): a reference field reads one hop; the rewrites read rows present ----

const GARDEN: &str = "table beds:\n  owner: principal\n  max: int\n  public 'p'\n  insert <- .owner = viewer\n  online only\ntable plantings:\n  bed: beds\n  crop: text <= 40\n  public 'p'\n  insert <- allow\n  online only\ntable harvests:\n  planting: plantings\n  grams: int\n  public 'p'\n  insert <- allow\n  online only\n";

#[test]
fn a_second_reference_hop_and_an_optional_comparison_get_rewrites_that_compile() {
    use snapback4_core::{WriteState, value::object};
    // 034: two hops print the two steps, by name.
    let source = format!("{GARDEN}query ownerOf(h: harvests):\n  r = harvests[h] ! else NOT_FOUND\n  return r.planting.bed.owner\n");
    let d = first(&source, "E_QUARRY_TYPE");
    let pieces: Vec<&str> = d.rewrite.split('`').skip(1).step_by(2).collect();
    assert_eq!(pieces[..2], ["planting = plantings[r.planting] ! else NOT_FOUND", "planting.bed.owner"], "{d}");
    clean(&source.replace("  return r.planting.bed.owner\n", &format!("  {}\n  return {}\n", pieces[0], pieces[1])));
    clean(&source.replace("  return r.planting.bed.owner\n", &format!("  {}\n  {}\n  return {}\n", pieces[0], pieces[2], pieces[3])));
    // 013: a reference field in a require reads its row present, never `?? 0`.
    let source = format!("{GARDEN}mutation harvest(planting: plantings, grams: int):\n  p = plantings[planting] ! else NOT_FOUND\n  require grams <= p.bed.max else TOO_MUCH\n  return insert harvests {{ planting, grams }}\n");
    let d = first(&source, "E_QUARRY_TYPE");
    assert!(!d.rewrite.contains("p.bed.max ?? 0") && d.rewrite.contains("`bed = beds[p.bed] ! else NOT_FOUND`") && d.rewrite.contains("`grams <= bed.max`"), "{d}");
    let repaired = source.replace("  require grams <= p.bed.max else TOO_MUCH\n", "  bed = beds[p.bed] ! else NOT_FOUND\n  require grams <= bed.max else TOO_MUCH\n");
    let b = clean(&repaired);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([
        ("beds".to_owned(), object([("id", Value::Id("b1".into())), ("owner", Value::Id("ann".into())), ("max", Value::Int(10))])),
        ("plantings".to_owned(), object([("id", Value::Id("p1".into())), ("bed", Value::Id("b1".into())), ("crop", Value::String("basil".into()))])),
        ("plantings".to_owned(), object([("id", Value::Id("p2".into())), ("bed", Value::Id("gone".into())), ("crop", Value::String("mint".into()))])),
    ]).unwrap();
    let run = |engine: &mut Engine, planting: &str, grams: i64| match engine.mutate("harvest", None, Context::new("ann", args(&[("planting", Value::Id(planting.into())), ("grams", Value::Int(grams))]))).unwrap().state {
        WriteState::Sent { .. } => "sent".to_owned(), WriteState::Failed { why, .. } => why.code };
    assert_eq!(run(&mut engine, "p1", 5), "sent");
    assert_eq!(run(&mut engine, "p1", 50), "TOO_MUCH");
    assert_eq!(run(&mut engine, "p2", 5), "NOT_FOUND", "a missing bed refuses; `?? 0` would have admitted it");
}
