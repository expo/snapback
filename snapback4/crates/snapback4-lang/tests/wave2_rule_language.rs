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

