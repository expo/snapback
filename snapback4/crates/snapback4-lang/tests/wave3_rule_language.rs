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

// ---- #22: which refusal fires first, and how to get the author's code ----

const RIDES: &str = "table rides:\n  seats: int\n  public 'p'\n  insert <- allow\n  online only\ntable joins:\n  ride: rides\n  rider: principal\n  immutable ride, rider\n  unique ride, rider else ALREADY_JOINED\n  read <- .rider = viewer\n  insert <- .rider = viewer\n  online only\nview joinCount: count joins by ride\n  read <- allow\n";

fn refusal(engine: &mut Engine, op: &str, viewer: &str, pairs: &[(&str, Value)]) -> String {
    use snapback4_core::WriteState;
    match engine.mutate(op, None, Context::new(viewer, args(pairs))).unwrap().state {
        WriteState::Sent { result, .. } => format!("sent {}", snapback4_core::wire::to_json(&result)),
        WriteState::Failed { why, .. } => why.code,
    }
}

#[test]
fn requires_run_in_program_order_before_the_write_that_checks_unique() {
    use snapback4_core::value::object;
    let mutations = "mutation join(ride: rides):\n  r = rides[ride] ! else NOT_FOUND\n  require joinCount[ride] < r.seats else RIDE_FULL\n  return insert joins { ride, rider: viewer }\nmutation joinOnce(ride: rides):\n  require not exists joins[ride, viewer] else ALREADY_JOINED\n  r = rides[ride] ! else NOT_FOUND\n  require joinCount[ride] < r.seats else RIDE_FULL\n  return insert joins { ride, rider: viewer }\nmutation joinQuietly(ride: rides):\n  j = insert joins { ride, rider: viewer } if absent\n  require j != null else ALREADY_JOINED\n  return j\n";
    let b = clean(&format!("{RIDES}{mutations}"));
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("rides".to_owned(), object([("id", Value::Id("r1".into())), ("seats", Value::Int(1))]))]).unwrap();
    let ride = [("ride", Value::Id("r1".into()))];
    assert!(refusal(&mut engine, "join", "carol", &ride).starts_with("sent"));
    // 038: the full ride's `require` runs before the insert's unique check.
    assert_eq!(refusal(&mut engine, "join", "carol", &ride), "RIDE_FULL");
    // The author's code first: a `require` on the caller's own (readable) row.
    assert_eq!(refusal(&mut engine, "joinOnce", "carol", &ride), "ALREADY_JOINED");
    // 072: `if absent` answers null on a clash, never the unique code; require it.
    assert_eq!(refusal(&mut engine, "joinQuietly", "carol", &ride), "ALREADY_JOINED");
}

#[test]
fn a_unique_clash_with_a_row_the_caller_cannot_read_is_e_rule() {
    use snapback4_core::value::object;
    // 069: another student's booking is hidden, so `else SLOT_TAKEN` does not name it.
    let source = "table bookings:\n  slot: int\n  student: principal\n  unique slot else SLOT_TAKEN\n  read <- .student = viewer\n  insert <- .student = viewer\n  online only\nmutation book(slot: int):\n  return insert bookings { slot, student: viewer }\n";
    let b = clean(source);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("bookings".to_owned(), object([("id", Value::Id("k1".into())), ("slot", Value::Int(3)), ("student", Value::Id("ann".into()))]))]).unwrap();
    assert_eq!(refusal(&mut engine, "book", "bob", &[("slot", Value::Int(3))]), "E_RULE");
    assert_eq!(refusal(&mut engine, "book", "ann", &[("slot", Value::Int(3))]), "SLOT_TAKEN");
}

// ---- #25 (I3): constraint refusals name their clause and line in development ----

#[test]
fn constraint_refusals_record_their_clause_for_the_dev_log() {
    use snapback4_core::assets::{Asset, AssetKind};
    use snapback4_core::engine::refusal_trace::RefusalTrace;
    use snapback4_core::{WriteState, value::object};
    let source = "use server\ntable items:\n  owner: principal\n  name: text <= 40\n  kind: text <= 10\n  photo: image <=1000 ?\n  unique owner, name else ALREADY_HAVE\n  immutable kind\n  cap 3 by owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\nmutation add(name: text <= 40, photo: image <=1000 ?):\n  return insert items { owner: viewer, name, kind: 'a', photo }\nmutation rekind(item: items):\n  update items[item] { kind: 'b' }\n";
    let b = clean(source);
    let sites = b.refusal_sites.clone();
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.store().record_asset(&Asset { id: "pic".into(), owner: "ann".into(), kind: AssetKind::Image, content_type: "image/png".into(), bytes: 24, width: Some(1), height: Some(1), duration: None, created_at: 0, home: None, released_at: None }).unwrap();
    engine.seed([("items".to_owned(), object([("id", Value::Id("i0".into())), ("owner", Value::Id("ann".into())), ("name", Value::String("old".into())), ("kind", Value::String("a".into())), ("photo", Value::Null)]))]).unwrap();
    let mut run = |op: &str, id: &str, pairs: &[(&str, Value)]| {
        let trace = RefusalTrace::default();
        let state = engine.mutate(op, None, Context::new("ann", args(pairs)).with_ids([id.into()]).at(1).with_refusal_trace(trace.clone())).unwrap().state;
        let code = match state { WriteState::Sent { .. } => "sent".to_owned(), WriteState::Failed { why, .. } => why.code };
        (code, trace.take().map(|cause| (cause.clause.clone(), sites.get(&(cause.table.clone(), cause.clause.clone())).cloned())))
    };
    let photo = Value::Map(BTreeMap::from([("id".into(), Value::Id("pic".into()))]).into());
    assert_eq!(run("add", "i1", &[("name", Value::String("new".into())), ("photo", photo.clone())]).0, "sent");
    let line = |n: usize| Some(format!("schema.q:{n}:3"));
    // 036: a unique clash names its `unique … else` line, not "cause not instrumented".
    assert_eq!(run("add", "i2", &[("name", Value::String("new".into())), ("photo", Value::Null)]), ("ALREADY_HAVE".into(), Some(("unique owner, name".into(), line(7)))));
    // 048: an asset another row holds names its column.
    let (code, cause) = run("add", "i3", &[("name", Value::String("third".into())), ("photo", photo)]);
    assert_eq!((code.as_str(), cause.as_ref().map(|c| c.0.as_str())), ("E_ASSET_PLACED", Some("asset photo")));
    assert!(cause.unwrap().1.is_some_and(|site| site.starts_with("schema.q:6:")));
    // A cap and an immutable column name theirs too.
    assert_eq!(run("add", "i3b", &[("name", Value::String("third".into())), ("photo", Value::Null)]).0, "sent");
    assert_eq!(run("add", "i4", &[("name", Value::String("fourth".into())), ("photo", Value::Null)]), ("E_CONSTRAINT".into(), Some(("cap owner".into(), line(9)))));
    assert_eq!(run("rekind", "i5", &[("item", Value::Id("i0".into()))]), ("E_CONSTRAINT".into(), Some(("immutable kind".into(), line(8)))));
}

// ---- #14: a total over partly readable rows gets a view recipe in the author's names ----

#[test]
fn a_total_over_partly_readable_rows_renders_a_view_that_compiles_and_counts_every_row() {
    use snapback4_core::value::object;
    let schema = "table staff:\n  principal: principal\n  role: text <= 20\n  unique principal\n  read <- .principal = viewer\n  online only\ntable requests:\n  owner: principal\n  dept: text <= 20\n  amount: money USD\n  read <- .owner = viewer or exists staff[principal = viewer, role = 'finance']\n  insert <- .owner = viewer\n  online only\n";
    for (query, view) in [
        // 062: a role-based dashboard total.
        ("query deptTotal(dept: text <= 20):\n  return sum(requests where .dept = dept, .amount)\n", "view requestsTotal: sum requests of .amount by .dept"),
        // 007: a count.
        ("query deptTotal(dept: text <= 20):\n  return count(requests where .dept = dept)\n", "view requestsCount: count requests by .dept"),
    ] {
        let d = first(&format!("{schema}{query}"), "E_QUARRY_BOUND");
        let pieces: Vec<&str> = d.rewrite.split('`').skip(1).step_by(2).collect();
        assert!(pieces.contains(&view), "{d}");
        let read = pieces.iter().find(|p| p.starts_with("read <- ")).unwrap();
        let lookup = pieces.iter().find(|p| p.ends_with("[dept]")).unwrap();
        let repaired = format!("{schema}{view}\n  {read}\nquery deptTotal(dept: text <= 20):\n  return {lookup}\n");
        let b = clean(&repaired);
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let request = |id: &str, owner: &str, amount: i64| ("requests".to_owned(), object([("id", Value::Id(id.into())), ("owner", Value::Id(owner.into())), ("dept", Value::String("ops".into())), ("amount", Value::Int(amount))]));
        engine.seed([
            ("staff".to_owned(), object([("id", Value::Id("s1".into())), ("principal", Value::Id("fran".into())), ("role", Value::String("finance".into()))])),
            request("r1", "ann", 100), request("r2", "bob", 250),
        ]).unwrap();
        let total = engine.query("deptTotal", Context::new("fran", args(&[("dept", Value::String("ops".into()))]))).unwrap();
        assert_eq!(total.data, Value::Int(if view.contains("sum") { 350 } else { 2 }), "finance reads the whole department's total:\n{repaired}");
    }
}
