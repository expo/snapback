//! App-farm wave 2 (snapback4@0.4.17): rule-language friction. Every
//! rewrite these tests reach is applied mechanically and compiled again, so a
//! repair can never print a form that is itself refused (LLP 3000.036 §12).
use snapback4_core::{Context, Engine, Value, WriteState};
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

fn first(source: &str, code: &str) -> Diagnostic {
    let b = bound(source);
    b.diagnostics.iter().find(|d| d.code == code && d.cascade_of.is_none()).unwrap_or_else(|| panic!("{code}: {:#?}", b.diagnostics)).clone()
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

/// The source line a diagnostic points at, trimmed.
fn line_at(source: &str, d: &Diagnostic) -> String {
    source.lines().nth(d.site.line.saturating_sub(1) as usize).unwrap_or("").trim().to_owned()
}

/// A rewrite must never hand the author back what they wrote.
fn assert_not_identical(source: &str, d: &Diagnostic) {
    let line = line_at(source, d);
    let rewrite = d.rewrite.trim().trim_matches('`');
    assert_ne!(rewrite, line, "the rewrite repeats the source line: {d}");
    for quoted in d.rewrite.split('`').skip(1).step_by(2) {
        assert_ne!(quoted.trim(), line, "a quoted rewrite repeats the source line: {d}");
    }
}

// ---- R8: money and decimal order in insert rules ----

const TIPS: &str = "table tips:
  owner: principal
  amount: money USD
  fee: money USD
  share: decimal 3
  read <- .owner = viewer
  insert <- .owner = viewer and .amount >= 100 and .amount <= 50000 and .fee <= .amount and .share < 1000
  online only
mutation tip(amount: money USD, fee: money USD, share: decimal 3):
  return insert tips { owner: viewer, amount, fee, share }
";

#[test]
fn insert_rules_order_money_and_decimal_in_minor_units_and_the_engine_enforces_it() {
    let b = clean(TIPS);
    let capabilities = b.schema.required_capabilities();
    assert!(capabilities.contains("insert-rule-order") && capabilities.contains("insert-rule-order-units"), "{capabilities:?}");
    assert!(snapback4_core::schema::validate(&b.schema).is_empty());
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let run = |engine: &mut Engine, amount: i64, fee: i64, share: i64| {
        let outcome = engine.mutate("tip", None, Context::new("alice", args(&[("amount", Value::Int(amount)), ("fee", Value::Int(fee)), ("share", Value::Int(share))]))).unwrap();
        match outcome.state { WriteState::Sent { .. } => "sent".to_owned(), WriteState::Failed { why, .. } => why.code }
    };
    assert_eq!(run(&mut engine, 100, 30, 5), "sent");
    assert_eq!(run(&mut engine, 99, 30, 5), "E_RULE");
    assert_eq!(run(&mut engine, 50001, 30, 5), "E_RULE");
    assert_eq!(run(&mut engine, 500, 501, 5), "E_RULE");
    assert_eq!(run(&mut engine, 500, 5, 1000), "E_RULE");
    // An int/time-only schema does not ask for the new capability.
    let plain = clean("table r:\n  owner: principal\n  n: int\n  read <- .owner = viewer\n  insert <- .n >= 1\n  online only\n");
    assert!(!plain.schema.required_capabilities().contains("insert-rule-order-units"));
}

#[test]
fn mismatched_ordered_insert_terms_get_a_rewrite_that_differs_from_the_source() {
    for (columns, rule, says) in [
        ("a: money USD\n  b: money EUR", ".a <= .b", "its own type"),
        ("a: money USD\n  b: int", ".a <= .b", "one type"),
        ("a: decimal 2\n  b: decimal 3", ".a < .b", "its own type"),
        ("a: time\n  b: int", ".a <= .b", "one type"),
        ("a: text\n  b: int", ".a <= 3", "its own type"),
        ("a: bool\n  b: int", ".b <= .a", "its own type"),
    ] {
        let source = format!("table t:\n  owner: principal\n  {columns}\n  read <- .owner = viewer\n  insert <- {rule}\n  online only\n");
        let d = first(&source, "E_QUARRY_TYPE");
        assert!(d.rewrite.contains(says), "{rule}: {d}");
        assert!(!d.rewrite.contains("or a column with an integer literal"), "{rule}: {d}");
        assert_not_identical(&source, &d);
    }
}

#[test]
fn the_core_refuses_ordered_insert_columns_of_two_types() {
    use snapback4_core::schema::{RuleExpr, RuleTerm, validate};
    let b = clean("table t:\n  owner: principal\n  a: money USD\n  b: money EUR\n  read <- .owner = viewer\n  insert <- .a >= 1\n  online only\n");
    let mut schema = b.schema.clone();
    schema.tables.get_mut("t").unwrap().rules.insert = RuleExpr::Compare(snapback4_core::ir::BinaryOp::Gte, RuleTerm::Field("a".into()), RuleTerm::Field("b".into()));
    assert!(validate(&schema).iter().any(|issue| issue.message.contains("ordered comparisons")), "{:?}", validate(&schema));
}

// ---- R9: read-rule hop rewrites compile as printed ----

/// Apply a read-hop rewrite to `table` in `source` the way an author would.
fn apply_hop_rewrite(source: &str, table: &str, rewrite: &str) -> String {
    let quoted: Vec<&str> = rewrite.split('`').skip(1).step_by(2).collect();
    let mut lines: Vec<String> = source.lines().map(str::to_owned).collect();
    let header = lines.iter().position(|l| l.starts_with(&format!("table {table}:")) || l.starts_with(&format!("view {table}:")))
        .unwrap_or_else(|| panic!("no {table} in {source}"));
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
        } else if let Some(by) = piece.strip_prefix("by ") {
            let at = header;
            let (head, _) = lines[at].split_once(" by ").expect("a view by clause");
            lines[at] = format!("{head} by {by}");
        } else if piece.split_once(": ").is_some_and(|(name, ty)| name.chars().all(char::is_alphanumeric) && !ty.contains('[')) {
            inserted.push(format!("  {piece}"));
        } else if piece.starts_with("read through") {
            // An alternative, not part of this repair.
        } else {
            panic!("an unapplied rewrite piece `{piece}` in {rewrite}");
        }
    }
    for (offset, line) in inserted.into_iter().enumerate() {
        lines.insert(header + 1 + offset, line);
    }
    lines.join("\n") + "\n"
}

const SLOTS: &str = "use personas alice, bob
table ministries:
  coordinator: principal
  immutable coordinator
  unique coordinator
  public 'ministries are public'
  insert <- .coordinator = viewer
  online only
table slots:
  ministry: ministries
  immutable ministry
  public 'slots are public'
  insert <- .ministry.coordinator = viewer
  online only
";

#[test]
fn every_read_hop_rewrite_compiles_as_printed() {
    let availability = |columns: &str, rule: &str, tail: &str| format!("{SLOTS}table availability:\n  slot: slots\n  volunteer: principal\n{columns}  immutable slot, volunteer\n  read <- {rule}\n  insert <- .volunteer = viewer\n  {tail}\n");
    let cases = [
        // 055: two hops on an online-only table: copy the reference, probe one hop.
        ("availability", availability("", ".volunteer = viewer or .slot.ministry.coordinator = viewer", "online only"), "exists ministries[.ministry, coordinator = viewer]"),
        // One hop: probe the parent directly, no copy.
        ("availability", availability("  ministry: ministries\n", ".volunteer = viewer or .ministry.coordinator = viewer", "online only"), "exists ministries[.ministry, coordinator = viewer]"),
        // A synced table copies the deciding principal (a column audience).
        ("availability", availability("", ".slot.ministry.coordinator = viewer", "sync"), ".coordinator = viewer"),
        ("availability", availability("  ministry: ministries\n", ".ministry.coordinator = viewer", "sync"), ".coordinator = viewer"),
        // A hop inside a probe key copies the value the key needs.
        ("availability", availability("", "exists ministries[id = .slot.ministry, coordinator = viewer]", "online only"), "exists ministries[id = .ministry, coordinator = viewer]"),
        // A literal comparison probes the parent with that literal.
        ("availability", availability("", ".slot.ministry.coordinator = 'service:audit'", "online only"), "coordinator = 'service:audit'"),
    ];
    for (table, source, expected) in cases {
        let d = first(&source, "E_QUARRY_RULE_HOP");
        assert!(d.rewrite.contains(expected), "{source}\n{d}");
        assert_not_identical(&source, &d);
        let repaired = apply_hop_rewrite(&source, table, &d.rewrite);
        let b = bound(&repaired);
        assert!(b.diagnostics.is_empty(), "the rewrite does not compile:\n{repaired}\n{:#?}", b.diagnostics);
    }
}

#[test]
fn a_view_hop_rewrite_groups_by_the_deciding_reference_and_probes_it() {
    let source = "use personas alice, bob
table elections:
  status: enum('draft', 'open', 'closed')
  public 'elections are public'
  insert <- allow
  online only
table positions:
  election: elections
  immutable election
  public 'positions are public'
  insert <- allow
  online only
table votes:
  election: elections
  position: positions
  voter: principal
  immutable election, position, voter
  read <- .voter = viewer
  insert <- .voter = viewer
  online only
view results: count votes by .position
  read <- .position.election.status = 'closed'
";
    let d = first(source, "E_QUARRY_RULE_HOP");
    assert!(d.rewrite.contains("by .position, .election") && d.rewrite.contains("exists elections[.election, status = 'closed']"), "{d}");
    assert!(!d.rewrite.contains("declare"), "a view declares no columns: {d}");
    clean(&apply_hop_rewrite(source, "results", &d.rewrite));
    // One hop on a view: the probe alone (009's second round).
    let one = source.replace("count votes by .position\n  read <- .position.election.status", "count votes by .election, .position\n  read <- .election.status");
    let d = first(&one, "E_QUARRY_RULE_HOP");
    assert!(d.rewrite.contains("exists elections[.election, status = 'closed']") && !d.rewrite.contains("copy"), "{d}");
    clean(&apply_hop_rewrite(&one, "results", &d.rewrite));
}

#[test]
fn a_hop_copy_names_the_mutable_link_it_depends_on() {
    let source = format!("{}table availability:\n  slot: slots\n  volunteer: principal\n  immutable slot, volunteer\n  read <- .slot.ministry.coordinator = viewer\n  insert <- .volunteer = viewer\n  online only\n", SLOTS.replace("  immutable ministry\n", ""));
    let d = first(&source, "E_QUARRY_RULE_HOP");
    assert!(d.rewrite.contains("while slots.ministry cannot change"), "{d}");
    clean(&apply_hop_rewrite(&source, "availability", &d.rewrite));
}

// ---- #16 (analysis numbering): note false positives ----

#[test]
fn a_unique_audience_key_is_one_row_per_group_and_gets_no_horizon_note() {
    let source = "table members:
  principal: principal
  role: text
  unique principal
  read <- .principal = viewer
  sync to .principal
";
    let b = clean(source);
    assert!(!b.notes.iter().any(|n| n.code == "N_NO_HORIZON"), "{:#?}", b.notes);
    // Without the unique key the group can grow, and the note stays.
    let b = clean(&source.replace("  unique principal\n", ""));
    assert!(b.notes.iter().any(|n| n.code == "N_NO_HORIZON"), "{:#?}", b.notes);
}

#[test]
fn a_where_every_row_passes_is_named_as_the_sparse_filter_repair() {
    let source = "table beds:
  ward: text
  floor: int ?
  public
  online only
query beds(c: cursor ?):
  return beds where .ward != null first 20 by .id after c
";
    let b = clean(source);
    let n = b.notes.iter().find(|n| n.code == "N_SPARSE_FILTER").unwrap_or_else(|| panic!("{:#?}", b.notes));
    assert!(n.rewrite.contains("drop this `where`") && n.rewrite.contains(".ward is required"), "{n}");
    assert_eq!(n.guide, "reads");
    // An optional column is a real filter: no tautology claim.
    let b = clean(&source.replace(".ward != null", ".floor != null"));
    let n = b.notes.iter().find(|n| n.code == "N_SPARSE_FILTER").unwrap();
    assert!(!n.rewrite.contains("drop this"), "{n}");
    // `why N_SPARSE_FILTER` explains the read, not the feeds reference.
    let why = snapback4_lang::guide::explain_code("N_SPARSE_FILTER").unwrap();
    assert!(why.contains("drop a `where` that every row passes") && !why.contains("E_TIMELINE_IMPORT"), "{why}");
}

// ---- #10: references and rows in programs ----

const LESSONS: &str = "table slots:
  day: text
  teacher: principal
  hidden: bool
  read <- not .hidden
  insert <- .teacher = viewer
  online only
table lessons:
  slot: slots
  student: principal
  read <- .student = viewer
  insert <- .student = viewer
  delete <- .student = viewer
  update <- .student = viewer
  online only
query mine(c: cursor ?):
  return lessons where .student = viewer first 20 by .id after c { id, day: .slot.day }
query teacherOf(id: lessons):
  k = lessons[id] ! else NOT_FOUND
  return k.slot.teacher
mutation cancel(id: lessons):
  k = lessons[id] ! else NOT_FOUND
  require k.slot.day != 'mon' else TOO_LATE
  delete k
mutation move(id: lessons, to: slots):
  k = lessons[id] ! else NOT_FOUND
  update k { slot: to }
";

#[test]
fn a_reference_field_reads_its_row_and_a_row_variable_is_a_write_target() {
    use snapback4_core::value::object;
    let b = clean(LESSONS);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let slot = |id: &str, day: &str, hidden: bool| ("slots".to_owned(), object([("id", Value::Id(id.into())), ("day", Value::String(day.into())), ("teacher", Value::Id("tess".into())), ("hidden", Value::Bool(hidden))]));
    let lesson = |id: &str, slot: &str| ("lessons".to_owned(), object([("id", Value::Id(id.into())), ("slot", Value::Id(slot.into())), ("student", Value::Id("alice".into()))]));
    engine.seed([slot("s1", "tue", false), slot("s2", "mon", false), slot("s3", "wed", true), lesson("l1", "s1"), lesson("l2", "s2"), lesson("l3", "s3"), lesson("l4", "gone")]).unwrap();
    let page = engine.query("mine", Context::new("alice", args(&[("c", Value::Null)]))).unwrap().data;
    let days: BTreeMap<String, Value> = match page { Value::Array(rows) => rows.into_iter().map(|row| (row.field("id").unwrap().clone(), row.field("day").unwrap().clone()))
        .map(|(id, day)| (match id { Value::Id(id) => id, other => panic!("{other:?}") }, day)).collect(), other => panic!("{other:?}") };
    // Readable rows read through; a hidden or missing row reads null, as `slots[.slot].day` does.
    assert_eq!(days["l1"], Value::String("tue".into()));
    assert_eq!(days["l3"], Value::Null, "a hidden slot discloses nothing");
    assert_eq!(days["l4"], Value::Null);
    let teacher = engine.query("teacherOf", Context::new("alice", args(&[("id", Value::Id("l1".into()))]))).unwrap().data;
    assert_eq!(teacher, Value::Id("tess".into()));
    let run = |engine: &mut Engine, op: &str, pairs: &[(&str, Value)]| match engine.mutate(op, None, Context::new("alice", args(pairs))).unwrap().state {
        WriteState::Sent { .. } => "sent".to_owned(), WriteState::Failed { why, .. } => why.code };
    assert_eq!(run(&mut engine, "cancel", &[("id", Value::Id("l2".into()))]), "TOO_LATE");
    assert_eq!(run(&mut engine, "cancel", &[("id", Value::Id("l1".into()))]), "sent");
    assert_eq!(run(&mut engine, "cancel", &[("id", Value::Id("l1".into()))]), "NOT_FOUND");
    assert_eq!(run(&mut engine, "move", &[("id", Value::Id("l2".into())), ("to", Value::Id("s1".into()))]), "sent");
    // Another student's delete is refused by the delete rule, as `delete lessons[k]` is.
    assert_eq!(match engine.mutate("cancel", None, Context::new("bob", args(&[("id", Value::Id("l2".into()))]))).unwrap().state {
        WriteState::Sent { .. } => "sent".to_owned(), WriteState::Failed { why, .. } => why.code }, "NOT_FOUND");
}

#[test]
fn a_row_variable_write_that_is_not_a_row_names_the_spelling_that_works() {
    let base = "table tasks:\n  owner: principal\n  read <- .owner = viewer\n  delete <- .owner = viewer\n  online only\n";
    for (body, says) in [
        ("  delete tasks\n", "delete tasks[id]"),
        ("  delete id\n", "delete t[id]"),
        ("  delete nothing\n", "row = t[id] ! else NOT_FOUND"),
        ("  k = tasks[id]\n  delete k\n", "k = tasks[id] ! else NOT_FOUND"),
    ] {
        let source = format!("{base}mutation drop(id: tasks):\n{body}");
        let d = first(&source, "E_QUARRY_UNKNOWN");
        assert!(d.rewrite.contains(says), "{body}: {d}");
        assert_not_identical(&source, &d);
    }
}

// ---- #3: a staff grant makes a page complete for staff, per caller ----

fn tickets(staff_read: &str, grant: &str) -> String {
    format!("table staff:
  principal: principal
  role: text
  unique principal
  {staff_read}
  online only
table tickets:
  owner: principal
  title: text
  read <- .owner = viewer or {grant}
  online only
query all(c: cursor ?):
  return tickets first 2 by .id after c
query everything(c: cursor ?):
  return tickets first 50 by .id after c
")
}

fn seeded(source: &str) -> Engine {
    use snapback4_core::value::object;
    let b = clean(source);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let ticket = |id: &str, owner: &str| ("tickets".to_owned(), object([("id", Value::Id(id.into())), ("owner", Value::Id(owner.into())), ("title", Value::String(id.into()))]));
    engine.seed([
        ("staff".to_owned(), object([("id", Value::Id("s1".into())), ("principal", Value::Id("tess".into())), ("role", Value::String("manager".into()))])),
        ("staff".to_owned(), object([("id", Value::Id("s2".into())), ("principal", Value::Id("ian".into())), ("role", Value::String("intern".into()))])),
        ticket("t1", "alice"), ticket("t2", "bob"), ticket("t3", "alice"), ticket("t4", "carl"),
    ]).unwrap();
    engine
}

fn page(engine: &mut Engine, query: &str, viewer: &str) -> snapback4_core::QueryOutcome {
    engine.query(query, Context::new(viewer, args(&[("c", Value::Null)]))).unwrap()
}

#[test]
fn a_staff_grant_makes_the_page_complete_for_staff_only() {
    let mut engine = seeded(&tickets("read <- .principal = viewer", "exists staff[viewer]"));
    // The granted page answers exactly as the same page over readable rows.
    let mut open = seeded(&tickets("read <- .principal = viewer", "true"));
    for query in ["all", "everything"] {
        let staff = page(&mut engine, query, "tess");
        let all = page(&mut open, query, "tess");
        assert!(staff.complete, "{query}: staff page is decided once");
        assert_eq!((&staff.data, staff.complete, &staff.next), (&all.data, all.complete, &all.next), "{query}");
        // The same walk: only the grant's static probe charge differs.
        assert_eq!((staff.metered.examined, staff.metered.index_entries), (all.metered.examined, all.metered.index_entries), "{query}");
        assert_eq!(staff.metered.rule_probes, all.metered.rule_probes + 1, "{query}: one static probe for the grant");
        // Everyone else walks per row, as before: own rows, never complete.
        let alice = page(&mut engine, query, "alice");
        assert!(!alice.complete, "{query}");
        assert_eq!(alice.data.as_array().unwrap().iter().filter(|row| row.field("owner").unwrap() != &Value::Id("alice".into())).count(), 0);
    }
}

#[test]
fn a_grant_the_caller_cannot_read_is_not_used() {
    // A hidden roster: whether tess is staff is not hers to learn from `complete`.
    let mut hidden = seeded(&tickets("read <- deny", "exists staff[viewer]"));
    let staff = page(&mut hidden, "everything", "tess");
    assert_eq!(staff.data.as_array().unwrap().len(), 4, "the rule still grants every row");
    assert!(!staff.complete, "an unreadable grant never decides the page");
    // A roster readable to its own members, and a role named by an equality.
    let mut roster = seeded(&tickets("read <- exists staff[viewer]", "exists staff[viewer]"));
    assert!(page(&mut roster, "everything", "tess").complete);
    let mut managers = seeded(&tickets("read <- exists staff[principal = viewer]", "exists staff[principal = viewer, role = 'manager']"));
    assert!(page(&mut managers, "everything", "tess").complete);
    let intern = page(&mut managers, "everything", "ian");
    assert!(!intern.complete && intern.data.as_array().unwrap().is_empty());
    // A negated probe is never a grant.
    let mut negated = seeded(&tickets("read <- .principal = viewer", "not exists staff[viewer]"));
    assert!(!page(&mut negated, "everything", "alice").complete);
}

#[test]
fn a_service_seat_reads_a_complete_page() {
    let mut engine = seeded(&tickets("read <- .principal = viewer", "viewer = 'service:audit'"));
    let service = page(&mut engine, "everything", "service:audit");
    assert!(service.complete);
    assert_eq!(service.data.as_array().unwrap().len(), 4);
    assert!(!page(&mut engine, "everything", "alice").complete);
}

const KILN: &str = "table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table firings:
  name: text
  public 'p'
  insert <- exists staff[viewer]
  online only
table pieces:
  owner: principal
  firing: firings
  done: bool
  cap 50 by firing
  read <- .owner = viewer or exists staff[viewer]
  update <- .owner = viewer or exists staff[viewer]
  online only
query queue(c: cursor ?):
  require exists staff[viewer] else NOT_STAFF
  return pieces last 50 by .id after c
mutation finishFiring(firing: firings): server
  require exists staff[viewer] else NOT_STAFF
  for row in pieces where .firing = firing first 50 by .id:
    update pieces[row] { done: true }
";

#[test]
fn a_required_grant_decides_a_staff_console_and_a_staff_only_mutation_pass() {
    use snapback4_core::value::object;
    let b = clean(KILN);
    assert!(!b.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"), "a guarded staff page is complete for every caller that reaches it: {:#?}", b.notes);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let piece = |id: &str, owner: &str, firing: &str| ("pieces".to_owned(), object([("id", Value::Id(id.into())), ("owner", Value::Id(owner.into())), ("firing", Value::Id(firing.into())), ("done", Value::Bool(false))]));
    engine.seed([
        ("staff".to_owned(), object([("id", Value::Id("s1".into())), ("principal", Value::Id("tess".into()))])),
        ("firings".to_owned(), object([("id", Value::Id("f1".into())), ("name", Value::String("bisque".into()))])),
        piece("p1", "alice", "f1"), piece("p2", "bob", "f1"), piece("p3", "alice", "f2"),
    ]).unwrap();
    let queue = page(&mut engine, "queue", "tess");
    assert!(queue.complete && queue.data.as_array().unwrap().len() == 3);
    let run = |engine: &mut Engine, viewer: &str| match engine.mutate("finishFiring", None, Context::new(viewer, args(&[("firing", Value::Id("f1".into()))]))).unwrap().state {
        WriteState::Sent { .. } => "sent".to_owned(), WriteState::Failed { why, .. } => why.code };
    assert_eq!(run(&mut engine, "alice"), "NOT_STAFF");
    assert_eq!(run(&mut engine, "tess"), "sent");
    let done = page(&mut engine, "queue", "tess").data;
    let done: Vec<_> = done.as_array().unwrap().iter().filter(|row| row.field("done").unwrap() == &Value::Bool(true)).map(|row| row.field("id").unwrap().clone()).collect();
    assert_eq!(done.len(), 2, "both owners' pieces in the firing, and only those: {done:?}");
}

#[test]
fn a_grant_guard_that_does_not_dominate_the_pass_still_refuses_it() {
    // The guard after the loop, and a program that can revoke its own grant.
    for (from, to) in [
        ("  require exists staff[viewer] else NOT_STAFF\n  for row in pieces where .firing = firing first 50 by .id:\n    update pieces[row] { done: true }\n",
         "  for row in pieces where .firing = firing first 50 by .id:\n    update pieces[row] { done: true }\n  require exists staff[viewer] else NOT_STAFF\n"),
        ("  require exists staff[viewer] else NOT_STAFF\n  for row",
         "  require exists staff[viewer] else NOT_STAFF\n  delete staff[principal = viewer]\n  for row"),
    ] {
        let source = KILN.replace(from, to).replace("  read <- .principal = viewer\n  online only\ntable firings", "  read <- .principal = viewer\n  delete <- .principal = viewer\n  online only\ntable firings");
        assert_ne!(source, KILN.replace("  read <- .principal = viewer\n  online only\ntable firings", "  read <- .principal = viewer\n  delete <- .principal = viewer\n  online only\ntable firings"));
        let d = first(&source, "E_STRUCTURAL_FANOUT");
        assert!(d.rewrite.contains("does not lift this"), "{d}");
    }
    // Without any guard, the refusal names the guard to add.
    let unguarded = KILN.replace("mutation finishFiring(firing: firings): server\n  require exists staff[viewer] else NOT_STAFF\n", "mutation finishFiring(firing: firings): server\n");
    let d = first(&unguarded, "E_STRUCTURAL_FANOUT");
    assert!(d.rewrite.contains("require exists staff[viewer] else FORBIDDEN"), "{d}");
}

// ---- #11 (analysis #12): owner-or-assignee lists print one query per party ----

#[test]
fn a_two_party_list_prints_the_authors_query_once_per_party_and_it_compiles() {
    let table = "table tasks:
  owner: principal
  assignee: principal
  title: text
  done: bool
  at: time
  read <- .owner = viewer or .assignee = viewer
  insert <- .owner = viewer
  online only
";
    for query in [
        "query mine(c: cursor ?):\n  return tasks where .owner = viewer or .assignee = viewer last 20 by .at after c\n",
        "query mine(c: cursor ?):\n  return tasks last 20 by .at after c\n",
        "query mine(open: bool, c: cursor ?):\n  return tasks where .done = open and (.owner = viewer or .assignee = viewer) last 20 by .at after c { id, title }\n",
    ] {
        let source = format!("{table}{query}");
        let b = bound(&source);
        let n = b.notes.iter().find(|n| n.code == "N_NEVER_COMPLETE").unwrap_or_else(|| panic!("{:#?}", b.notes));
        let declarations = n.rewrite.split_once("in the client:\n").unwrap_or_else(|| panic!("{n}")).1;
        assert!(declarations.contains("query mineAsOwner(") && declarations.contains("query mineAsAssignee("), "{n}");
        let repaired = format!("{table}{declarations}\n");
        let b = clean(&repaired);
        assert!(!b.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"), "{repaired}\n{:#?}", b.notes);
        assert_eq!(b.programs.len(), 2);
    }
}

