//! Scenario dimensions, independent of the channel recorder. A case is selected
//! for equality only when the principal's authority and visible input agree.
use crate::paired_worlds::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Ceilings, Engine};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Principal { Blind, InsertOnly, SelfReadable, WitnessDependent, Writer }
impl Principal {
    pub fn who(self) -> &'static str { match self {
        Self::Blind => "blind", Self::InsertOnly => "inserter", Self::SelfReadable => "alice",
        Self::WitnessDependent => "reader", Self::Writer => "bob",
    } }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadRule { Owner, Witness, Ordinal, Deny }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hidden { Sibling, Witness, Counter, Cap, Following }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Write { Insert, Absent, Upsert, Position, Update, Delete }
impl Write {
    pub fn name(self) -> &'static str { match self {
        Self::Insert => "add", Self::Absent => "absent", Self::Upsert => "put",
        Self::Position => "position", Self::Update => "edit", Self::Delete => "remove",
    } }
    fn statement(self) -> &'static str { match self {
        Self::Insert => "return insert messages { parent, body }",
        Self::Absent => "return insert messages { parent, body } if absent",
        Self::Upsert => "return upsert messages[parent = parent, body = body] {}",
        Self::Position => "return upsert messages[parent = parent, ordinal = n] { body }",
        Self::Update => "return update messages[parent = parent, ordinal = n] { body }",
        Self::Delete => "delete messages[parent = parent, ordinal = n]",
    } }
}
pub struct Case { pub label: String, pub pair: Pair }

pub fn schema(principal: Principal, read: ReadRule, deferred: bool, cap: bool) -> String {
    let owner = if matches!(principal, Principal::SelfReadable | Principal::Writer) { "viewer" } else { "'bob'" };
    let insert = if deferred { ".ordinal = 0" } else if matches!(principal, Principal::Blind | Principal::WitnessDependent) { "deny" } else { "allow" };
    let read = match read { ReadRule::Owner => ".owner = viewer", ReadRule::Witness => "exists grants[parent = .parent, who = viewer]", ReadRule::Ordinal => ".ordinal != 1", ReadRule::Deny => "deny" };
    // Witness and ordinal rules are deliberately online: the device cannot
    // invent a delivery audience for them. Owner rules exercise both stores.
    let residency = if read == ".owner = viewer" { "sync to .owner" } else { "online only" };
    let mut source = format!("table parents:\n  public\n  sync public\ntable grants:\n  parent: parents\n  who: principal\n  unique parent, who\n  read <- deny\n  online only\ntable messages:\n  parent: parents\n  owner: principal default {owner}\n  ordinal: sequence by parent\n  body: text <=40\n  unique parent, body\n  unique parent, ordinal\n  immutable owner\n  read <- {read}\n  insert <- {insert}\n  update <- deny\n  delete <- deny\n  {residency}\n");
    if cap { source.push_str("  cap 1 by parent\n"); }
    for op in writes() { source.push_str(&format!("mutation {}(parent: parents, body: text <=40, n: int):\n  {}\n", op.name(), op.statement())); }
    source.push_str("query one(parent: parents, n: int):\n  return messages[parent = parent, ordinal = n]\nquery page(parent: parents, c: cursor ?):\n  return messages where .parent = parent after c first 1 by .ordinal\n");
    source
}
pub fn writes() -> [Write; 6] { [Write::Insert, Write::Absent, Write::Upsert, Write::Position, Write::Update, Write::Delete] }
pub fn row(id: &str, owner: &str, ordinal: i64, body: &str) -> (String, Json) {
    ("messages".into(), json!({"id":id,"parent":"p","owner":owner,"ordinal":ordinal,"body":body}))
}
fn counters(world: usize, e: &mut Engine) {
    use snapback4_core::rows::Rows;
    let tx = e.store_mut().transaction().unwrap();
    let floor = tx.sequence_value("parents", "p").unwrap();
    tx.set_sequence("parents", "p", floor.max(if world == 0 { 0 } else { 5 })).unwrap();
    tx.commit().unwrap();
}
/// Cross principal × rule × hidden input × write × addressed key. The
/// exclusions are semantic: changed read authority or authorized allocation
/// isn't noninterference. Those outcomes have separate positive oracles.
pub fn cases() -> Vec<Case> {
    let mut cases = vec![];
    for principal in [Principal::Blind, Principal::InsertOnly, Principal::SelfReadable, Principal::WitnessDependent, Principal::Writer] {
        for read in [ReadRule::Owner, ReadRule::Witness, ReadRule::Ordinal, ReadRule::Deny] {
            for hidden in [Hidden::Sibling, Hidden::Witness, Hidden::Counter, Hidden::Cap, Hidden::Following] {
                for op in writes() {
                    for own_key in [false, true] {
                        // Only owner rules have a distinct owned address in
                        // this family; avoid counting identical worlds twice.
                        if own_key && read != ReadRule::Owner { continue; }
                        let readable = read == ReadRule::Owner && matches!(principal, Principal::SelfReadable | Principal::Writer);
                        let insert_denied = matches!(principal, Principal::Blind | Principal::WitnessDependent);
                        // Ordinal 1 is the unreadable witness for ordinal rules;
                        // do not move it to 2 in the following-sibling scenario.
                        if hidden == Hidden::Following && read != ReadRule::Owner { continue; }
                        // Witness variation with permitted insertion changes
                        // authority; check that separately, never normalize it.
                        if hidden == Hidden::Witness && !insert_denied { continue; }
                        // Successful readable insertion may expose its assigned
                        // ordinal. Cap's one-bit residual has its own oracle.
                        if readable && !insert_denied && matches!(op, Write::Insert | Write::Absent | Write::Upsert) { continue; }
                        let who = principal.who();
                        let hidden_owner = if principal == Principal::Writer { "carol" } else { "bob" };
                        let mut seeds: [Seed; 2] = [vec![], vec![]];
                        let own = read == ReadRule::Owner && (own_key || hidden == Hidden::Following);
                        if own { for seed in &mut seeds { seed.push(row("own", who, 1, "own")); } }
                        let ordinal = if own { 2 } else { 1 };
                        match hidden {
                            Hidden::Witness => seeds[1].push(("grants".into(), json!({"id":"grant","parent":"p","who":who}))),
                            Hidden::Counter => {},
                            _ => seeds[1].push(row("hidden", hidden_owner, ordinal, "target")),
                        }
                        let n = if own_key && own { 1 } else { ordinal };
                        let body = if own_key && own { "own" } else { "target" };
                        let mut pair = Pair::new(schema(principal, read, false, hidden == Hidden::Cap), seeds, who, Operation::new(op.name(), json!({"parent":"p","body":body,"n":n}), who))
                            .query("one", json!({"parent":"p","n":n})).query("page", json!({"parent":"p","c":null}));
                        pair.trusted = true;
                        if hidden == Hidden::Counter { pair.prepare = Some(counters); }
                        cases.push(Case { label: format!("{principal:?}/{read:?}/{hidden:?}/{op:?}/own={own_key}"), pair });
                    }
                }
            }
        }
    }
    // Deferred denial: the witness can grant readability but the eventual
    // ordinal still denies insertion. Exercise default and tight allowances.
    for deferred in [false, true] {
        for op in [Write::Insert, Write::Absent] {
            for entries in [None, Some(0), Some(1), Some(2)] {
                let mut pair = Pair::new(schema(Principal::WitnessDependent, ReadRule::Witness, deferred, false), [vec![], vec![("grants".into(), json!({"id":"grant","parent":"p","who":"alice"}))]], "alice", Operation::new(op.name(), json!({"parent":"p","body":"fresh","n":1}), "alice"))
                    .query("one", json!({"parent":"p","n":1})).query("page", json!({"parent":"p","c":null}));
                pair.trusted = true;
                pair.ceilings = entries.map(|index_entries| Ceilings { index_entries, ..Default::default() });
                cases.push(Case { label: format!("witness/deferred={deferred}/{op:?}/entries={entries:?}"), pair });
            }
        }
    }
    cases
}
/// The same generated statement after 512 × 32 index writes; default ceiling.
pub fn at_default_boundary(case: &mut Case) {
    let op = case.pair.operations[0].name.clone();
    let statement = writes().into_iter().find(|w| w.name() == op).unwrap().statement();
    case.pair.source.push_str("table scratch:\n  n: int\n  public\n  insert <- allow\n  online only\n");
    for n in 0..31 { case.pair.source.push_str(&format!("  by ix{n}: n, id\n")); }
    case.pair.source.push_str("mutation burn(parent: parents, body: text <=40, n: int):\n");
    for n in 0..512 { case.pair.source.push_str(&format!("  insert scratch {{ id: 'scratch{n}', n: {n} }}\n")); }
    case.pair.source.push_str(&format!("  {statement}\n"));
    case.pair.operations[0].name = "burn".into();
    case.pair.ceilings = None;
    case.label.push_str("/512x32");
}

pub fn boundary_cases() -> Vec<Case> {
    cases().into_iter().filter(|case|
        (case.label.starts_with("WitnessDependent/Witness/Witness/") && case.label.ends_with("own=false"))
        || (case.label.starts_with("witness/") && case.label.ends_with("entries=None"))
        || case.label.starts_with("SelfReadable/Owner/Sibling/Position/")
    ).map(|mut case| { at_default_boundary(&mut case); case }).collect()
}

/// Grok's readable-candidate probe: own, hidden and fresh sequence addresses,
/// crossed with the reported tight counter-read allowances.
pub fn address_cases() -> Vec<Case> {
    let mut cases = vec![];
    for principal in [Principal::SelfReadable, Principal::Writer] {
        for ordinal in [1, 2, 9] {
            for entries in [None, Some(0), Some(1), Some(2), Some(8)] {
                let who = principal.who();
                let hidden_owner = if who == "bob" { "carol" } else { "bob" };
                let own = row("own", who, 1, "own");
                let mut pair = Pair::new(schema(principal, ReadRule::Owner, false, false),
                    [vec![own.clone()], vec![own, row("hidden", hidden_owner, 2, "hidden")]], who,
                    Operation::new("position", json!({"parent":"p","body":"probe","n":ordinal}), who))
                    .query("one", json!({"parent":"p","n":ordinal})).query("page", json!({"parent":"p","c":null}));
                pair.trusted = true;
                pair.ceilings = entries.map(|index_entries| Ceilings { index_entries, ..Default::default() });
                cases.push(Case { label: format!("address/{principal:?}/{ordinal}/entries={entries:?}"), pair });
            }
        }
    }
    cases
}

/// Compound write rules keep their final authority fixed while an unreadable
/// first witness changes the evaluation path. Each rule is crossed with all
/// effects, sequence/ordinary columns, read authority and probe exhaustion.
pub fn compound_write_case(shape: &str, effect: &str, sequence: bool, readable: bool, reads: usize, ceiling: Option<u64>) -> Case {
    let first = "exists grants[parent = .parent, who = viewer, kind = 'first']";
    let stable = "exists grants[parent = .parent, who = viewer, kind = 'stable']";
    let missing = "exists grants[parent = .parent, who = viewer, kind = 'missing']";
    let rule = match shape {
        "and-denied" => format!("{first} and {missing}"),
        "or-allowed" => format!("{first} or {stable}"),
        "or-public-allowed" => format!("{first} or exists grants[parent = .parent, who = .owner, kind = 'first'] or viewer = 'alice'"),
        "or-denied" => format!("({first} or {missing}) and {missing}"),
        "and-allowed" => format!("({first} and {stable}) or {stable}"),
        _ => unreachable!(),
    };
    let statement = match effect {
        "insert" => "return insert messages { parent, body: 'probe' }",
        "update" => "return update messages[id = 'own'] { body: 'probe' }",
        "delete" => "delete messages[id = 'own']",
        _ => unreachable!(),
    };
    let source = format!("table parents:
  public
  online only
table grants:
  parent: parents
  who: principal
  kind: text <=10
  unique parent, who, kind
  read <- deny
  online only
table burnRows:
  parent: parents
  read <- exists grants[parent = .parent, who = viewer, kind = 'stable']
  online only
table messages:
  parent: parents
  ordinal: {ordinal}
  body: text <=40
  read <- {read}
  {effect} <- {rule}
  online only
mutation probe(parent: parents):
  for i in range(0, {reads}):
    seen = burnRows[id = 'burn']
  {statement}
", ordinal = if sequence { "sequence by parent" } else { "int default 0" }, read = if readable { "allow" } else { "deny" });
    let source = if shape == "or-public-allowed" {
        source.replace("  body: text <=40\n", "  owner: principal default 'bob'\n  body: text <=40\n")
    } else { source };
    let mut common = vec![
        ("burnRows".into(), json!({"id":"burn","parent":"p"})),
        ("grants".into(), json!({"id":"stable","parent":"p","who":"alice","kind":"stable"})),
    ];
    if effect != "insert" { common.push(("messages".into(), json!({"id":"own","parent":"p","ordinal":1,"body":"old"}))); }
    let mut hidden = common.clone();
    hidden.push(("grants".into(), json!({"id":"secret","parent":"p","who":"alice","kind":"first"})));
    let mut pair = Pair::new(source, [common, hidden], "alice", Operation::new("probe", json!({"parent":"p"}), "alice"));
    pair.trusted = true;
    pair.ceilings = ceiling.map(|rule_probes| Ceilings { rule_probes, ..Default::default() });
    Case { label: format!("{shape}/{effect}/sequence={sequence}/readable={readable}/reads={reads}/probes={ceiling:?}"), pair }
}

pub fn compound_write_cases() -> Vec<Case> {
    let mut cases = vec![];
    for shape in ["and-denied", "or-denied", "and-allowed", "or-allowed"] {
        for effect in ["insert", "update", "delete"] {
            for sequence in [false, true] {
                for readable in [false, true] {
                    for (reads, ceiling) in [(0, None), (0, Some(0)), (0, Some(1)), (0, Some(2)), (0, Some(3)), (8191, None)] {
                        cases.push(compound_write_case(shape, effect, sequence, readable, reads, ceiling));
                    }
                }
            }
        }
    }
    cases
}
