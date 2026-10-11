//! App-farm wave 1 (workstream B): rule-language and diagnostic friction.
//! Each diagnostic names the construct and renders its repair from the
//! author's own tables and columns (LLP 3000.036 §11).
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::{Bound, Diagnostic, compile};
use std::collections::BTreeMap;

fn bound(source: &str) -> Bound {
    compile(&[("schema.q".into(), source.into())])
}

fn one(source: &str, code: &str) -> Diagnostic {
    let b = bound(source);
    let found: Vec<_> = b.diagnostics.iter().filter(|d| d.code == code && d.cascade_of.is_none()).collect();
    assert_eq!(found.len(), 1, "{code}: {:#?}", b.diagnostics);
    found[0].clone()
}

fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics);
    b
}

fn note(source: &str, code: &str) -> Diagnostic {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics);
    b.notes.iter().find(|d| d.code == code).unwrap_or_else(|| panic!("{code}: {:#?}", b.notes)).clone()
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

const RATINGS: &str = "table ratings:
  owner: principal
  stars: int
  startsAt: time
  endsAt: time
  read <- .owner = viewer
  insert <- .owner = viewer and .stars >= 1 and .stars <= 5 and .endsAt > .startsAt
  online only
mutation rate(stars: int, startsAt: time, endsAt: time):
  return insert ratings { owner: viewer, stars, startsAt, endsAt }
";

#[test]
fn insert_rules_order_the_rows_own_required_columns_and_the_engine_enforces_it() {
    let b = clean(RATINGS);
    assert!(b.schema.required_capabilities().contains("insert-rule-order"));
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let run = |engine: &mut Engine, stars: i64, starts: i64, ends: i64| {
        let outcome = engine.mutate("rate", None, Context::new("alice", args(&[("stars", Value::Int(stars)), ("startsAt", Value::Int(starts)), ("endsAt", Value::Int(ends))]))).unwrap();
        match outcome.state { WriteState::Sent { .. } => "sent".to_owned(), WriteState::Failed { why, .. } => why.code }
    };
    assert_eq!(run(&mut engine, 3, 10, 20), "sent");
    assert_eq!(run(&mut engine, 0, 10, 20), "E_RULE");
    assert_eq!(run(&mut engine, 6, 10, 20), "E_RULE");
    assert_eq!(run(&mut engine, 3, 20, 10), "E_RULE");
}

#[test]
fn rule_operators_name_what_rules_evaluate_and_move_the_check_into_the_mutation() {
    let table = |rule: &str, column: &str| format!("table shifts:\n  owner: principal\n  startsAt: time\n  stars: int ?\n  bid: int\n  step: int\n  {column}\n  read <- .owner = viewer\n  {rule}\n  online only\n");
    for (rule, what, rewrite) in [
        ("insert <- .startsAt > now", "the clock", "`require startsAt > now else INVALID_STARTS_AT`"),
        ("delete <- .startsAt > now", "the clock", "`row = shifts[id] ! else NOT_FOUND` then `require row.startsAt > now else INVALID_STARTS_AT`"),
        ("delete <- .bid >= 3", "an ordered comparison", "`require row.bid >= 3 else INVALID_BID`"),
        // An unnamed update rule holds before and after: its named form keeps both (LLP 3000.036 §13.6).
        ("update <- .bid >= 3", "an ordered comparison", "`update (old, next) <- old.bid >= 3 and next.bid >= 3`"),
        ("update (old, next) <- next.bid >= old.bid + old.step", "arithmetic", "`require bid >= row.bid + row.step else INVALID_BID`"),
        ("insert <- .bid > 0 and isOpen(.bid)", "a helper or function call", "`require isOpen(bid) else INVALID_BID`"),
    ] {
        let source = table(rule, "x: int") + "fn isOpen(n: int): n > 0\n";
        let d = one(&source, "E_QUARRY_RULE_OPERATOR");
        assert!(d.message.contains(what) && d.message.contains("shifts"), "{rule}: {d}");
        assert!(d.rewrite.contains(rewrite), "{rule}: {d}");
        assert_eq!(d.guide, "rules");
    }
    let read = one(&table("insert <- .owner = viewer", "x: int").replace("read <- .owner = viewer", "read <- .bid >= 1"), "E_QUARRY_RULE_OPERATOR");
    assert!(read.rewrite.contains("shifts where .bid >= 1"), "{read}");
    let optional = bound(&table("insert <- .stars >= 1", "x: int"));
    assert!(optional.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.message.contains("null")), "{:#?}", optional.diagnostics);
}

#[test]
fn require_carries_an_optional_message_to_the_refusal() {
    let b = clean("table books:
  owner: principal
  stars: int
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation rate(stars: int):
  require stars >= 1 else BAD_STARS 'Stars must be at least one'
  return insert books { owner: viewer, stars }
");
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let outcome = engine.mutate("rate", None, Context::new("alice", args(&[("stars", Value::Int(0))]))).unwrap();
    let WriteState::Failed { why, .. } = outcome.state else { panic!("sent") };
    assert_eq!(why.code, "BAD_STARS");
    assert_eq!(why.message, "Stars must be at least one");
    // The presence assertion takes the same message.
    clean("table books:
  owner: principal
  read <- .owner = viewer
  online only
query mine(b: books):
  row = books[b] ! else MISSING 'That book is gone'
  return row
");
}

#[test]
fn a_table_rule_else_code_says_rules_refuse_e_rule_and_moves_the_name_to_require() {
    let d = one("table managers:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table books:
  owner: principal
  read <- .owner = viewer
  insert <- exists managers[principal = viewer] else NOT_MANAGER
  online only
", "E_QUARRY_SYNTAX");
    assert!(d.message.contains("E_RULE") && d.message.contains("no `else`"), "{d}");
    assert!(d.rewrite.contains("require exists managers[principal = viewer] else NOT_MANAGER"), "{d}");
}

#[test]
fn reserved_words_are_named_at_their_declaration() {
    for (source, word, rename) in [
        ("table notes:\n  owner: principal\n  read: bool default false\n  read <- .owner = viewer\n  online only\n", "read", "isRead"),
        ("table notes:\n  by: principal\n  read <- .by = viewer\n  online only\n", "by", "author"),
        ("table notes:\n  owner: principal\n  after: int\n  read <- .owner = viewer\n  online only\n", "after", "afterAt"),
        ("table updates:\n  owner: principal\n  read <- .owner = viewer\n  delete <- .owner = viewer\n  online only\nmutation removeUpdate(update: updates):\n  delete updates[update]\n", "update", "change"),
        ("query q(x: int):\n  walk = x + 1\n  return walk\n", "walk", "outing"),
        ("query q(x: int):\n  for viewer in range(0, x):\n    return viewer\n", "viewer", "who"),
    ] {
        let d = one(source, "E_QUARRY_RESERVED");
        assert!(d.message.contains(&format!("`{word}` is a reserved word")), "{d}");
        assert!(d.rewrite.contains(rename), "{d}");
    }
    let why = snapback4_lang::guide::explain_code("E_QUARRY_RESERVED").unwrap();
    assert!(why.contains("`read`") && why.contains("`viewer`") && why.contains("Rename it"), "{why}");
}

const IDEAS: &str = "table ideas:
  title: text <= 50
  public
  sync public last 100 by .id
table comments:
  idea: ideas
  body: text <= 100
  at: time
  public
  sync public last 100 by .at, .id
view voteCount: count comments by idea
  public
";

#[test]
fn a_page_inside_an_object_ends_at_the_next_field() {
    clean(&format!("{IDEAS}query detail(idea: ideas):
  row = ideas[idea] ! else NOT_FOUND
  return {{ idea: row, comments: comments where .idea = idea first 50 by .at, votes: voteCount[idea] }}
"));
    let d = one(&format!("{IDEAS}query bare(idea: ideas):\n  return comments where .idea = idea first 50 by .at, id\n"), "E_QUARRY_SYNTAX");
    assert!(d.message.contains("starts with a dot") && d.rewrite == "by .at, .id", "{d}");
}

#[test]
fn syntax_rewrites_use_the_authors_own_line() {
    let sync = one("table posts:\n  createdAt: time\n  public\n  sync public last 100 by createdAt, id\n", "E_QUARRY_SYNTAX");
    assert_eq!(sync.rewrite, "last 100 by .createdAt, .id", "{sync}");
    let week = one("query q():\n  return 1w\n", "E_QUARRY_SYNTAX");
    assert!(week.message.contains("`1w` is not a duration") && week.rewrite == "write 7d", "{week}");
    let sum = one("table stints:\n  game: id\n  minutes: int\n  public\n  online only\nview totals: sum stints where .minutes > 0 of .minutes by .game\n  public\n", "E_QUARRY_SYNTAX");
    assert_eq!(sum.rewrite, "view totals: sum stints of .minutes where .minutes > 0 by .game", "{sum}");
    let not = one("table slots:\n  tutor: principal\n  public\n  online only\nmutation book(s: slots):\n  slot = slots[s] ! else NOT_FOUND\n  require not slot.tutor = viewer else SELF_BOOK\n", "E_QUARRY_TYPE");
    assert!(not.message.contains("binds tighter") && not.rewrite.contains("slot.tutor != x"), "{not}");
}

#[test]
fn a_bound_row_addresses_itself_in_reads_as_in_writes() {
    clean("table slots:
  owner: principal
  name: text <= 20
  read <- .owner = viewer
  update <- .owner = viewer
  online only
mutation rename(slot: slots, name: text <= 20):
  s = slots[slot] ! else NOT_FOUND
  update slots[s] { name: name }
  return slots[s]
");
}

#[test]
fn probe_keys_and_covered_unique_keys() {
    let d = one("table pieces:
  author: principal
  read <- .author = viewer
  online only
table critiques:
  piece: pieces
  read <- exists pieces[.id = .piece, author = viewer]
  online only
", "E_QUARRY_UNKNOWN");
    assert_eq!(d.rewrite, "exists pieces[.piece, author = viewer]", "{d}");
    // Named equalities covering two total unique keys test one row either way.
    clean("table plots:
  name: text <= 20
  public
  online only
table assignments:
  plot: plots
  gardener: principal
  unique plot
  unique gardener
  read <- .gardener = viewer
  online only
table notes:
  plot: plots
  read <- exists assignments[plot = .plot, gardener = viewer]
  online only
");
}

#[test]
fn nested_predicates_say_dot_is_the_inner_row() {
    let d = one("table contests:
  title: text <= 50
  public
  sync public last 100 by .id
table entries:
  contest: contests
  title: text <= 50
  public
  sync public last 100 by .id
query all(c: cursor ?):
  return contests where .title != '' first 20 by .id after c { id, title, entries: entries where .contest = .id first 10 by .id }
", "E_QUARRY_TYPE");
    assert!(d.message.contains("predicate's own row") && d.rewrite.contains("entries[contest = .id]"), "{d}");
}

#[test]
fn a_read_rule_hop_shows_the_table_rule_repair() {
    let b = bound("table seasons:
  manager: principal
  read <- .manager = viewer
  online only
table boxes:
  season: seasons
  immutable season
  read <- exists seasons[.season, manager = viewer]
  online only
table items:
  box: boxes
  immutable box
  read <- exists seasons[id = .box.season, manager = viewer]
  online only
");
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_RULE_HOP").unwrap_or_else(|| panic!("{:#?}", b.diagnostics));
    assert!(d.rewrite.contains("declare `season: seasons`") && d.rewrite.contains("exists boxes[.box, season = .season]") && d.rewrite.contains("read through .box"), "{d}");
    assert!(!d.rewrite.contains("require"), "a read rule repair is table-rule syntax: {d}");
}

#[test]
fn a_query_reading_a_deny_aggregate_is_noted() {
    let n = note("table questions:
  author: principal
  public
  online only
table votes:
  question: questions
  voter: principal
  public
  online only
maintain voteCounts: count votes by question
  read <- deny
query list(c: cursor ?):
  return questions where .author != viewer first 20 by .id after c { *, votes: voteCounts[.id] }
", "N_READ_DENIED");
    assert!(n.message.contains("voteCounts") && n.message.contains("deny"), "{n}");
}

#[test]
fn a_job_sweep_does_not_leak_compiler_facts() {
    let b = bound("effect randomDraw
table raffles:
  status: enum('open', 'drawing', 'drawn') default 'open'
  drawAt: time
  public 'public'
  update <- deny
  online only
table tickets:
  raffle: raffles
  public 'public'
  online only
table winners:
  raffle: raffles
  unique raffle
  public 'public'
  online only
job drawDue():
  for r in raffles:
    if r.status = 'open' and r.drawAt <= now:
      if exists tickets[raffle = r.id]:
        update raffles[r.id] { status: 'drawing' }
        emit randomDraw { raffle: r.id } once [r.id, r.drawAt]
      else:
        update raffles[r.id] { status: 'drawn' }
    else if r.status = 'drawing' and exists winners[raffle = r.id]:
      update raffles[r.id] { status: 'drawn' }
schedule drawEveryMinute every 1m: drawDue
");
    assert!(b.diagnostics.iter().all(|d| !d.message.contains('$')), "{:#?}", b.diagnostics);
    assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics);
}

#[test]
fn never_complete_names_the_missing_pin_as_code() {
    let two_party = note("table swaps:
  requester: principal
  owner: principal
  at: time
  read <- .requester = viewer or .owner = viewer
  online only
query mine(c: cursor ?):
  return swaps where .at > 0 first 20 by .id after c
", "N_NEVER_COMPLETE");
    assert!(two_party.rewrite.contains("swaps where .requester = viewer") && two_party.rewrite.contains("swaps where .owner = viewer"), "{two_party}");
    let parent = note("table boards:
  owner: principal
  read <- .owner = viewer
  online only
table members:
  board: boards
  principal: principal
  unique board, principal
  read <- .principal = viewer
  online only
table cards:
  board: boards
  read <- exists members[.board, viewer]
  online only
table comments:
  board: boards
  card: cards
  read <- exists members[.board, viewer]
  online only
query discussion(card: cards, c: cursor ?):
  return comments where .card = card first 20 by .id after c
", "N_NEVER_COMPLETE");
    assert!(parent.rewrite.contains("cardRow = cards[card] ! else NOT_FOUND") && parent.rewrite.contains(".board = cardRow.board"), "{parent}");
    let staff_source = "table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table tickets:
  owner: principal
  read <- .owner = viewer or exists staff[viewer]
  online only
query inbox(c: cursor ?):
  require exists staff[viewer] else NOT_STAFF
  return tickets first 20 by .id after c
";
    // LLP 3000.036 §12.1: the required, readable grant decides the page for
    // every caller who reaches it, so the guarded inbox has no note; unguarded,
    // the note says staff pages are complete.
    let guarded = bound(staff_source);
    assert!(guarded.diagnostics.is_empty() && !guarded.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"), "{:#?}", guarded.notes);
    let staff = note(&staff_source.replace("  require exists staff[viewer] else NOT_STAFF\n", ""), "N_NEVER_COMPLETE");
    assert!(staff.message.contains("except for callers `exists staff[viewer]` admits") && staff.rewrite.contains("complete: true"), "{staff}");
}

#[test]
fn a_capacity_check_over_private_rows_names_a_count_view_over_the_authors_table() {
    let b = bound("table shifts:
  slots: int
  public 'public'
  online only
table signups:
  shift: shifts
  volunteer: principal
  read <- .volunteer = viewer
  insert <- .volunteer = viewer
  online only
mutation signUp(shift: shifts):
  s = shifts[shift] ! else NOT_FOUND
  require count(signups where .shift = shift) < s.slots else SHIFT_FULL
  return insert signups { shift, volunteer: viewer }
");
    let d = b.diagnostics.iter().find(|d| d.code == "E_STRUCTURAL_FANOUT").unwrap_or_else(|| panic!("{:#?}", b.diagnostics));
    assert!(d.rewrite.contains("view signupsCount: count signups by shift") && d.rewrite.contains("require signupsCount[shift] < limit"), "{d}");
    assert!(d.message.contains("point read of a full unique key"), "{d}");
}

#[test]
fn a_total_over_partly_readable_rows_is_not_offered_a_first_n_page_alone() {
    let d = one("table games:
  coach: principal
  public 'public'
  online only
table stints:
  game: games
  player: principal
  minutes: int
  read <- .player = viewer
  online only
query total(game: games):
  return sum(stints where .game = game, .minutes)
", "E_QUARRY_BOUND");
    assert!(d.message.contains("a total over rows") && d.rewrite.contains("pin .player") && d.rewrite.contains("view stintsTotal: sum stints of .minutes by .game") && d.rewrite.contains("stintsTotal[game]"), "{d}");
}
