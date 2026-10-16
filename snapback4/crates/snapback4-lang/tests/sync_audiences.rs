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
    assert!(refused.message.contains("one group") && refused.rewrite.starts_with("insert <- .principal = viewer and exists staff[viewer];") && refused.rewrite.contains("service:ops"), "{refused:?}");
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

// @ref LLP 3000.036.000.000#2.2 — the shapes the farms asked for sync as unions; what is not a whole audience is refused with the branch named.
#[test]
fn union_read_rules_sync_and_what_is_not_a_whole_audience_is_refused() {
    use snapback4_core::schema::SyncArm;
    // Two parties: a union of two column arms, inferred or spelled.
    let two = "table orders:\n  customer: principal\n  seller: principal\n  read <- .customer = viewer or .seller = viewer\n  insert <- .customer = viewer\n  sync\n";
    let bound = clean(two);
    let sync = bound.schema.tables["orders"].sync.clone().unwrap();
    assert_eq!((sync.audience.clone(), sync.also.clone()), (Audience::Column("customer".into()), vec![SyncArm { audience: Audience::Column("seller".into()), horizon: None }]));
    assert_eq!(sync.line(), "sync to .customer or .seller");
    assert!(bound.schema.required_capabilities().contains("union-audience"));
    assert_eq!(clean(&two.replace("  sync\n", "  sync to .seller or .customer\n")).schema.tables["orders"].sync, Some(sync));
    // Naming one branch disagrees, and the rewrite is the union.
    let one = refusal(&two.replace("  sync\n", "  sync to .customer\n"));
    assert!(one.message.contains("disagrees") && one.rewrite.lines().nth(1).is_some_and(|line|line.trim()=="sync to .customer or .seller"), "{one:?}");
    // An owner beside a group: the group arm first, with its grant rules.
    let shares = "table plants:\n  owner: principal\n  read <- .owner = viewer or exists shares[.id, viewer]\n  insert <- .owner = viewer\n  sync\ntable shares:\n  plant: plants\n  principal: principal\n  unique plant, principal\n  immutable plant, principal\n  read <- .principal = viewer\n  insert <- created plants[.plant] or exists shares[.plant, viewer]\n  sync\n";
    let sync = clean(shares).schema.tables["plants"].sync.clone().unwrap();
    assert_eq!(sync.audience, Audience::Target { table: "shares".into(), prefix: vec!["id".into()], principal: "principal".into() });
    assert_eq!(sync.line(), "sync to .owner or shares[.id] by .principal");
    // The group arm keeps its grant rule: an owner who is not a member grants nothing.
    let grant = refusal(&shares.replace("created plants[.plant] or exists shares[.plant, viewer]", "exists plants[id = .plant, owner = viewer]"));
    assert!(grant.message.contains("independent grant"), "{grant:?}");
    // An owner beside a role: the roster is the empty-group arm.
    let staff = "table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  insert <- deny\n  sync\ntable requests:\n  tenant: principal\n  read <- .tenant = viewer or exists staff[viewer]\n  insert <- .tenant = viewer\n  sync\n";
    let sync = clean(staff).schema.tables["requests"].sync.clone().unwrap();
    assert_eq!(sync.audience, Audience::Target { table: "staff".into(), prefix: vec![], principal: "principal".into() });
    assert_eq!(sync.line(), "sync by .principal");
    // Printed lines name the recipient, so they bind when the target has
    // several principal columns (round 3, GPT finding 4).
    let two_principals = shares.replace("  principal: principal\n  unique plant, principal", "  principal: principal\n  inviter: principal\n  unique plant, principal").replace("  sync\ntable shares:", "  sync by .principal\ntable shares:");
    let printed = clean(&two_principals).schema.tables["plants"].sync.clone().unwrap().line();
    assert_eq!(printed, "sync to .owner or shares[.id] by .principal");
    clean(&two_principals.replace("  sync by .principal\ntable shares:", &format!("  {printed}\ntable shares:")));
    // Every union window is refused, including named and equal-prefix forms.
    for window in ["last 1 by .at", "last 1 by byAt"] {
        let source = two.replace("  sync\n", &format!("  at: time\n  by byAt: customer, at, id\n  sync {window}\n"));
        let d = refusal(&source);
        assert!(d.message.contains("union audiences cannot have"), "{d:?}");
        let replacement=d.rewrite.lines().nth(1).unwrap().trim();
        assert_eq!(replacement,"sync","{d:?}");
        clean(&source.replace(&format!("sync {window}"), replacement));
        clean(&source.replace(&format!("sync {window}"), "sync"));
    }
    // Repeated branches, in either equality order, are one arm each (round 2, GPT finding 4).
    for rule in [".customer = viewer or viewer = .customer or .seller = viewer", ".customer = viewer or .customer = viewer"] {
        clean(&two.replace(".customer = viewer or .seller = viewer", rule));
    }
    // A branch with an extra condition is not a whole audience.
    let partial = refusal(&two.replace("read <- .customer = viewer or .seller = viewer", "read <- .customer = viewer or (.seller = viewer and .customer = .seller)"));
    assert!(partial.message.contains("do not make private rows public") && partial.rewrite.contains("is not") && partial.rewrite.contains("`.customer = viewer`"), "{partial:?}");
    // Two group audiences are refused.
    let groups = "table a:\n  principal: principal\n  unique principal\n  read <- exists a[viewer]\n  insert <- deny\n  sync\ntable b:\n  principal: principal\n  unique principal\n  read <- exists b[viewer]\n  insert <- deny\n  sync\ntable notes:\n  read <- exists a[viewer] or exists b[viewer]\n  insert <- deny\n  sync\n";
    assert!(refusal(groups).message.contains("at most one group audience"));
    // A union source keeps its aggregates online; a union-synced aggregate is refused even when hand-built.
    let counted = clean(&format!("{two}view orderCount: count orders by .customer\n  read <- .customer = viewer\n"));
    assert!(counted.schema.tables["orderCount"].sync.is_none(), "an aggregate over a union inherits no audience");
    let mut schema = clean(&format!("{two}view orderCount: count orders by .seller\n  read <- .seller = viewer\n  online only\n")).schema;
    let view = schema.tables.get_mut("orderCount").unwrap();
    view.sync = Some(snapback4_core::schema::Sync { audience: Audience::Column("seller".into()), horizon: None, also: vec![SyncArm { audience: Audience::Column("seller".into()), horizon: None }] });
    assert!(snapback4_core::schema::validate(&schema).iter().any(|issue| issue.message.contains("cannot sync to a union")));
    // The exclusions: delivered history, a public branch.
    assert!(refusal(&two.replace("  sync\n", "  retain delivered-history\n  sync\n")).message.contains("delivered-history"));
    assert!(refusal(&two.replace(".customer = viewer or .seller = viewer", "public or .seller = viewer")).code == "E_SYNC");
}

#[test]
fn the_sharing_card_holds_each_recipe_the_refusals_point_to() {
    let card = snapback4_lang::guide::card("sharing").unwrap();
    for recipe in ["### An owner or a team", "**A buyer and a seller.**", "**A tenant and the staff.**", "**An org roster.**", "**A team the owner manages, and children of the team.**", "**Open groups.**", "**A staff console, online.**", "### A group's private list, complete", "### An explicit parties table", "### Separate tables for tenant and staff"] {
        assert!(card.contains(recipe), "{recipe}");
    }
    let reference = card.split_once("## Reference").unwrap().1;
    assert!(reference.find("online only").unwrap() < reference.find("**An org roster.**").unwrap());
    assert!(reference.find("**A staff console, online.**").unwrap() < reference.find("**An org roster.**").unwrap());
    assert!(reference.contains("never predict") && reference.contains("E_OFFLINE") && reference.contains("union"));
    // Union recipes, the online staff console, explicit membership alternatives,
    // open groups and the private group list; tests/guide.rs compiles them too.
    let blocks = snapback4_lang::guide::quarry(card);
    assert_eq!(blocks.len(), 12);
    for block in &blocks { clean(block); }
    // The union recipes really sync as unions.
    for block in &blocks[..4] {
        assert!(clean(block).schema.tables.values().any(|table| table.sync.as_ref().is_some_and(|sync| sync.is_union())), "{block}");
    }
    // The sync card and the code's explanation point here.
    assert!(snapback4_lang::guide::card("sync").unwrap().contains("`guide sharing`"));
    assert!(snapback4_lang::guide::explain_code("E_SYNC").unwrap().contains("guide sharing"));
}

#[test]
fn equal_union_window_prefixes_are_refused_with_a_working_repair() {
    let source = "table grants:\n  owner: principal\n  person: principal\n  unique owner, person\n  immutable owner, person\n  read <- exists grants[.owner, viewer]\n  insert <- exists grants[.owner, viewer]\n  sync by .person\ntable notes:\n  owner: principal\n  at: time\n  read <- .owner = viewer or exists grants[.owner, viewer]\n  insert <- .owner = viewer and exists grants[.owner, viewer]\n  sync by .person last 1 by .at\n";
    let d = refusal(source);
    assert!(d.message.contains("union audiences cannot have"), "{d:?}");
    let replacement=d.rewrite.lines().nth(1).unwrap().trim();
    assert_eq!(replacement,"sync by .person");
    clean(&source.replace("sync by .person last 1 by .at", replacement));
    clean(&source.replace("sync by .person last 1 by .at", "sync by .person"));
}


#[test]
fn inherited_expiry_on_a_group_target_still_refuses_the_union() {
    let source = "table roots:\n  owner: principal\n  until: time ?\n  immutable owner, until\n  expire at .until\n  read <- .owner = viewer\n  sync\ntable staff:\n  parent: roots\n  principal: principal\n  immutable parent, principal\n  unique principal\n  read through .parent\n  insert <- exists staff[viewer]\n  sync\ntable notes:\n  owner: principal\n  at: time\n  read <- .owner = viewer or exists staff[viewer]\n  insert <- .owner = viewer\n  sync\n";
    let baseline = clean(&source.replace(".owner = viewer or exists staff[viewer]", "exists staff[viewer]"));
    assert!(baseline.schema.tables["staff"].is_expiring());
    let bound = compile(source);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_SYNC" && d.message.contains("cannot expire")), "{:?}", bound.diagnostics);
}
