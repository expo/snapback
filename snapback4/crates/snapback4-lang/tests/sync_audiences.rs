//! The sharing shapes the wave-1 builders met at `E_SYNC` (LLP 3000.036.000):
//! each either compiles, or refuses once at the line to edit with a rewrite
//! that compiles when applied to the same tables.
use snapback4_core::schema::Audience;

fn compile(source: &str) -> snapback4_lang::Bound {
    snapback4_lang::compile(&[("schema.q".into(), source.into())])
}

fn clean(source: &str) -> snapback4_lang::Bound {
    let bound = compile(source);
    assert!(bound.diagnostics.is_empty(), "{source}\n{:?}", bound.diagnostics);
    bound
}

fn refusal(source: &str) -> snapback4_lang::Diagnostic {
    let bound = compile(source);
    let sync: Vec<_> = bound.diagnostics.iter().filter(|d| d.code == "E_SYNC").collect();
    assert_eq!(sync.len(), 1, "{:?}", bound.diagnostics);
    sync[0].clone()
}

const TEAM: &str = "table boards:
  owner: principal
  name: text <=100
  read <- exists members[.id, viewer]
  insert <- .owner = viewer
  sync

table members:
  board: boards
  principal: principal
  unique board, principal
  immutable board, principal
  cap 50 by board
  read <- exists members[.board, viewer]
  insert <- created boards[.board] or exists boards[id = .board, owner = viewer]
  sync

table cards:
  board: boards
  title: text <=100
  at: time
  immutable board
  read <- exists members[.board, viewer]
  insert <- exists members[.board, viewer]
  sync last 100 by .at
";

#[test]
fn an_owner_managed_membership_refuses_once_at_its_insert_rule_with_the_conjunction() {
    let refused = refusal(TEAM);
    // At `members`' insert rule (line 15), naming every table it governs.
    assert_eq!((refused.site.line, refused.guide.as_str()), (15, "sync"), "{refused:?}");
    for table in ["boards", "members", "cards"] { assert!(refused.message.contains(table), "{refused:?}"); }
    assert!(refused.message.contains("independent grant") && refused.message.contains("`exists members[.board, viewer]`") && refused.message.contains("`exists boards[.board, owner = viewer]` proves neither"), "{}", refused.message);
    assert_eq!(refused.rewrite, "insert <- created boards[.board] or (exists boards[.board, owner = viewer] and exists members[.board, viewer])");
    clean(&TEAM.replace("  insert <- created boards[.board] or exists boards[id = .board, owner = viewer]", &format!("  {}", refused.rewrite)));
    // Without a created branch, the rewrite names the bootstrap branch too.
    let owner_only = TEAM.replace("created boards[.board] or exists boards[id = .board, owner = viewer]", "exists boards[id = .board, owner = viewer]");
    let refused = refusal(&owner_only);
    assert!(refused.rewrite.starts_with("insert <- exists boards[.board, owner = viewer] and exists members[.board, viewer]") && refused.rewrite.contains("`or created boards[.board]`"), "{}", refused.rewrite);
    // A movable grant is refused at the update rule, once.
    let movable = TEAM.replace("exists boards[id = .board, owner = viewer]", "exists members[.board, viewer]").replace("  immutable board, principal\n", "  update <- .principal = viewer\n");
    let refused = refusal(&movable);
    assert!(refused.site.line == 12 && refused.message.contains("can retarget") && refused.message.contains("changes board, principal on members") && refused.rewrite.starts_with("immutable board, principal"), "{refused:?}");
}

#[test]
fn a_global_roster_is_an_audience_with_one_group() {
    let roster = "table staff:
  principal: principal
  unique principal
  cap 100
  read <- exists staff[viewer]
  insert <- exists staff[viewer]
  sync

table notes:
  body: text <=100
  at: time
  read <- exists staff[viewer]
  insert <- exists staff[viewer]
  sync last 100 by .at
";
    let bound = clean(roster);
    for table in ["staff", "notes"] {
        assert_eq!(bound.schema.tables[table].sync.as_ref().unwrap().audience, Audience::Target { table: "staff".into(), prefix: vec![], principal: "principal".into() });
    }
    // Joining yourself is still refused, at the roster's insert rule, with
    // the grant probe that the empty group spells as `exists staff[viewer]`.
    let refused = refusal(&roster.replacen("  insert <- exists staff[viewer]\n", "  insert <- .principal = viewer\n", 1));
    assert_eq!(refused.site.line, 6);
    assert!(refused.message.contains("one group") && refused.rewrite == "insert <- .principal = viewer and exists staff[viewer]", "{refused:?}");
}

#[test]
fn a_member_reading_its_own_row_is_its_own_witness() {
    let plain = TEAM.replace("created boards[.board] or exists boards[id = .board, owner = viewer]", "created boards[.board] or exists members[.board, viewer]");
    let own = plain.replace("  read <- exists members[.board, viewer]\n  insert <- created", "  read <- .principal = viewer or exists members[.board, viewer]\n  insert <- created");
    assert_ne!(plain, own);
    let (plain, own) = (clean(&plain), clean(&own));
    assert_eq!(plain.schema.tables["members"].sync, own.schema.tables["members"].sync);
    // The server still evaluates the rule as written.
    assert_ne!(plain.schema.tables["members"].rules.read, own.schema.tables["members"].rules.read);
    // A literal or an optional key column is not a witness: still a union.
    let other = TEAM.replace("created boards[.board] or exists boards[id = .board, owner = viewer]", "created boards[.board] or exists members[.board, viewer]")
        .replace("  read <- exists members[.board, viewer]\n  insert <- created", "  read <- .principal = viewer or exists members[.board, 'dev:admin']\n  insert <- created");
    assert!(compile(&other).diagnostics.iter().any(|d| d.code == "E_SYNC"));
}

const HOP: &str = "table teams:
  read <- exists members[.id, viewer]
  insert <- allow
  sync

table members:
  team: teams
  principal: principal
  unique team, principal
  immutable team, principal
  cap 50 by team
  read <- exists members[.team, viewer]
  insert <- created teams[.team] or exists members[.team, viewer]
  sync

table standups:
  team: teams
  at: time
  immutable team
  read <- exists members[.team, viewer]
  insert <- exists members[.team, viewer]
  sync last 100 by .at

table blockers:
  standup: standups
  at: time
  by byStandup: standup, at, id
  immutable standup
  read <- exists members[.standup.team, viewer]
  insert <- exists members[.standup.team, viewer]
  sync last 500 by byStandup
";

#[test]
fn a_named_window_index_works_on_a_hopped_audience_and_inline_ones_get_both_repairs() {
    let bound = clean(HOP);
    let blockers = &bound.schema.tables["blockers"];
    let sync = blockers.sync.as_ref().unwrap();
    assert_eq!(sync.audience, Audience::Target { table: "members".into(), prefix: vec!["$standup.team".into()], principal: "principal".into() });
    // The inherited group leads, then the named index's order.
    assert_eq!(blockers.indexes[&sync.horizon.as_ref().unwrap().by].columns(), ["$standup.team", "standup", "at", "id"]);
    // The same order through the explicit read-through spelling.
    clean(&HOP.replace("  read <- exists members[.standup.team, viewer]\n", "  read through .standup\n"));
    // An inline audience must lead with its own column; both repairs compile.
    let inline = HOP.replace("  sync last 100 by .at\n", "  by byAt: at, id\n  sync last 100 by byAt\n");
    let refused = refusal(&inline);
    assert!(refused.message.contains("horizon index byAt (at, id) must lead with the audience column team"), "{refused:?}");
    assert!(refused.rewrite.starts_with("last 100 by .at, .id  -- in place of `last 100 by byAt`") && refused.rewrite.ends_with("`by byAt: team, at, id`"), "{}", refused.rewrite);
    clean(&inline.replace("  sync last 100 by byAt\n", "  sync last 100 by .at, .id\n"));
    clean(&inline.replace("  by byAt: at, id\n", "  by byAt: team, at, id\n"));
}

#[test]
fn union_read_rules_get_the_recipe_for_their_shape() {
    // Two parties: a parties table, spelled against these columns.
    let two = "table orders:\n  customer: principal\n  seller: principal\n  read <- .customer = viewer or .seller = viewer\n  insert <- .customer = viewer\n  sync\n";
    let refused = refusal(two);
    assert!(refused.message.contains("do not make private rows public"));
    for word in ["`table ordersParties:`", "`insert <- created orders[.item]`", "`after insert <- exists ordersParties[item = .id, party = .customer]`", "party = .seller]", "two parties", "`online only`"] {
        assert!(refused.rewrite.contains(word), "{word}: {}", refused.rewrite);
    }
    clean("table orders:\n  customer: principal\n  seller: principal\n  read <- exists ordersParties[.id, viewer]\n  insert <- .customer = viewer\n  after insert <- exists ordersParties[item = .id, party = .customer]\n  after insert <- exists ordersParties[item = .id, party = .seller]\n  sync\ntable ordersParties:\n  item: orders\n  party: principal\n  unique item, party\n  immutable item, party\n  read <- exists ordersParties[.item, viewer]\n  insert <- created orders[.item]\n  sync\n");
    // An owner beside a group: fold the owner into the group.
    let shares = "table plants:\n  owner: principal\n  read <- .owner = viewer or exists shares[.id, viewer]\n  insert <- .owner = viewer\n  sync\ntable shares:\n  plant: plants\n  principal: principal\n  unique plant, principal\n  immutable plant, principal\n  read <- .principal = viewer\n  insert <- exists plants[id = .plant, owner = viewer]\n  sync\n";
    let refused = refusal(shares);
    for word in ["drop `.owner = viewer`", "`read <- exists shares[.id, viewer]`", "`after insert <- exists shares[plant = .id, principal = .owner]`", "`insert <- created plants[.plant] or exists shares[.plant, viewer]`"] {
        assert!(refused.rewrite.contains(word), "{word}: {}", refused.rewrite);
    }
    clean(&shares.replace("  read <- .owner = viewer or exists shares[.id, viewer]\n", "  read <- exists shares[.id, viewer]\n  after insert <- exists shares[plant = .id, principal = .owner]\n")
        .replace("  insert <- exists plants[id = .plant, owner = viewer]\n", "  insert <- created plants[.plant] or exists shares[.plant, viewer]\n"));
    // An owner beside a role: one table per audience; union stays refused.
    let staff = "table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  insert <- deny\n  sync\ntable requests:\n  tenant: principal\n  read <- .tenant = viewer or exists staff[viewer]\n  insert <- .tenant = viewer\n  sync\n";
    let refused = refusal(staff);
    assert!(refused.rewrite.contains("an owner plus a role (exists staff[viewer])") && refused.rewrite.contains("which sync does not deliver") && refused.rewrite.contains("(guide sharing: an owner plus staff)"), "{}", refused.rewrite);
    // An explicit audience naming one disjunct is still a union: refused.
    assert!(compile(&staff.replace("  read <- .tenant = viewer or exists staff[viewer]\n  insert <- .tenant = viewer\n  sync\n", "  read <- .tenant = viewer or exists staff[viewer]\n  insert <- .tenant = viewer\n  sync to .tenant\n")).diagnostics.iter().any(|d| d.code == "E_SYNC"));
}

#[test]
fn the_sharing_card_holds_each_recipe_the_refusals_point_to() {
    let card = snapback4_lang::guide::card("sharing").unwrap();
    for recipe in ["**An org roster.**", "**A team the owner manages, and children of the team.**", "**Two parties (buyer and seller).**", "**An owner plus staff.**", "**A staff console, online.**"] {
        assert!(card.contains(recipe), "{recipe}");
    }
    // The opening example and the five recipes (LLP 3000.036 §12.1 adds the
    // online staff console); tests/guide.rs compiles every card's blocks too.
    let blocks = snapback4_lang::guide::quarry(card);
    assert_eq!(blocks.len(), 6);
    for block in &blocks { clean(block); }
    // The sync card and the code's explanation point here.
    assert!(snapback4_lang::guide::card("sync").unwrap().contains("`guide sharing`"));
    assert!(snapback4_lang::guide::explain_code("E_SYNC").unwrap().contains("guide sharing"));
}
