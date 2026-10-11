use super::*;

fn target_sync_schema(content_optional: bool, audience_optional: bool) -> Schema {
    let optional_id = |optional| if optional { ColumnType::Optional(Box::new(ColumnType::Id)) } else { ColumnType::Id };
    let mut audience = public_table(BTreeMap::from([("id".into(), ColumnType::Id), ("room".into(), optional_id(audience_optional)), ("principal".into(), ColumnType::Principal)]), BTreeMap::from([(BY_ID.into(), Index::of(&["id"], true)), ("byRoomPrincipal".into(), Index::of(&["room", "principal"], true)), ("byPrincipalRoom".into(), Index::of(&["principal", "room", "id"], false))]));
    audience.rules.insert = RuleExpr::Deny;
    audience.rules.update = RuleExpr::Deny;
    let mut content = public_table(BTreeMap::from([("id".into(), ColumnType::Id), ("room".into(), optional_id(content_optional))]), BTreeMap::from([(BY_ID.into(), Index::of(&["id"], true)), ("byRoom".into(), Index::of(&["room", "id"], false))]));
    content.sync = Some(Sync { audience: Audience::Target { table: "memberships".into(), prefix: vec!["room".into()], principal: "principal".into() }, horizon: None });
    Schema { tables: BTreeMap::from([("memberships".into(), audience), ("messages".into(), content)]), ..Schema::default() }
}

#[test]
fn target_sync_group_keys_are_required_in_raw_schemas() {
    assert!(validate(&target_sync_schema(false, false)).is_empty());
    for schema in [target_sync_schema(true, false), target_sync_schema(false, true)] {
        let issues = validate(&schema);
        assert!(issues.iter().any(|issue| issue.path == "tables.messages.sync" && issue.message.contains("needs required group keys")), "{issues:?}");
    }
}

// LLP 3000.036 §1 A: diagnostics print rule literals as Quarry, not tagged JSON.
#[test]
fn rule_literals_print_as_quarry() {
    let rule = RuleExpr::Or(vec![
        RuleExpr::Eq(RuleTerm::Field("approved".into()), RuleTerm::Literal(Value::Bool(true))),
        RuleExpr::Ne(RuleTerm::Field("rank".into()), RuleTerm::Literal(Value::Int(3))),
        RuleExpr::Ne(RuleTerm::Field("closedAt".into()), RuleTerm::Literal(Value::Null)),
    ]);
    assert_eq!(rule.quarry(), ".approved = true or .rank != 3 or .closedAt != null");
}

fn probe(table: &str, index: &str, key: Vec<RuleTerm>) -> RuleExpr {
    RuleExpr::Exists { table: table.into(), index: index.into(), key, provenance: crate::ir::KeyProvenance::Shape, equalities: Vec::new() }
}

// LLP 3000.036.000 §3.1: a member row is its own witness; nothing else is absorbed.
#[test]
fn sync_audience_absorbs_only_a_same_row_self_witness() {
    let schema = target_sync_schema(false, false);
    let members = &schema.tables["memberships"];
    let group = probe("memberships", "byRoomPrincipal", vec![RuleTerm::Field("room".into()), RuleTerm::Viewer]);
    let own = RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer);
    let service = RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Literal(Value::Id("service:push".into())));
    for rule in [RuleExpr::Or(vec![own.clone(), group.clone()]), RuleExpr::Or(vec![group.clone(), own.clone()]), RuleExpr::Or(vec![own.clone(), group.clone(), service])] {
        assert_eq!(rule.sync_audience_rule("memberships", members).as_ref(), &group, "{}", rule.quarry());
    }
    // Another table's probe, a literal key term or a non-unique index proves nothing about this row.
    let literal = probe("memberships", "byRoomPrincipal", vec![RuleTerm::Literal(Value::Id("r1".into())), RuleTerm::Viewer]);
    let mut loose = members.clone();
    loose.indexes.insert("byRoomPrincipal".into(), Index::of(&["room", "principal"], false));
    for (table, rule) in [("messages", RuleExpr::Or(vec![own.clone(), group.clone()])), ("memberships", RuleExpr::Or(vec![own.clone(), literal]))] {
        let definition = &schema.tables[table];
        assert_eq!(rule.sync_audience_rule(table, definition).as_ref(), &rule);
    }
    let rule = RuleExpr::Or(vec![own, group]);
    assert_eq!(rule.sync_audience_rule("memberships", &loose).as_ref(), &rule);
}

// LLP 3000.036.000 §3.2: a roster with no group columns is one group; a member may add others.
#[test]
fn a_roster_without_group_columns_grants_through_membership_only() {
    let roster = |insert: RuleExpr| {
        let mut staff = public_table(BTreeMap::from([("id".into(), ColumnType::Id), ("principal".into(), ColumnType::Principal)]), BTreeMap::from([(BY_ID.into(), Index::of(&["id"], true)), ("byPrincipal".into(), Index::of(&["principal"], true))]));
        staff.rules.read = probe("staff", "byPrincipal", vec![RuleTerm::Viewer]);
        staff.rules.insert = insert;
        staff.rules.update = RuleExpr::Deny;
        staff.sync = Some(Sync { audience: Audience::Target { table: "staff".into(), prefix: vec![], principal: "principal".into() }, horizon: None });
        Schema { tables: BTreeMap::from([("staff".into(), staff)]), ..Schema::default() }
    };
    let member = probe("staff", "byPrincipal", vec![RuleTerm::Viewer]);
    assert!(validate(&roster(member.clone())).is_empty(), "{:?}", validate(&roster(member.clone())));
    for open in [RuleExpr::Allow, RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer), RuleExpr::Or(vec![member.clone(), RuleExpr::Allow])] {
        let schema = roster(open);
        let issues = validate(&schema);
        assert!(issues.iter().any(|issue| issue.message.contains("independent grant") && issue.message.contains("`exists staff[viewer]`")), "{issues:?}");
        let binding = audience_binding(&schema, "staff", &schema.tables["staff"], schema.tables["staff"].sync.as_ref().unwrap()).unwrap();
        let repair = audience_grant_repair(&schema, "staff", &binding, false).unwrap();
        assert!(repair.rule.contains("exists staff[viewer]") && repair.created.is_none(), "{repair:?}");
    }
}

// LLP 3000.036.000 §2.2: the printed repair keeps guarded branches and conjoins the probe to the rest.
#[test]
fn the_grant_repair_conjoins_the_probe_to_each_unguarded_branch() {
    let mut schema = target_sync_schema(false, false);
    let owner = probe("rooms", "byId", vec![RuleTerm::Field("room".into())]);
    let member = probe("memberships", "byRoomPrincipal", vec![RuleTerm::Field("room".into()), RuleTerm::Viewer]);
    schema.tables.get_mut("memberships").unwrap().rules.insert = RuleExpr::Or(vec![member.clone(), owner.clone()]);
    let binding = audience_binding(&schema, "messages", &schema.tables["messages"], schema.tables["messages"].sync.as_ref().unwrap()).unwrap();
    let repair = audience_grant_repair(&schema, "memberships", &binding, false).unwrap();
    assert_eq!(repair.rule, "insert <- exists memberships[.room, viewer] or (exists rooms[.room] and exists memberships[.room, viewer])");
    assert_eq!(repair.unguarded, vec!["exists rooms[.room]".to_owned()]);
    schema.tables.get_mut("memberships").unwrap().rules.insert = RuleExpr::Or(vec![member, RuleExpr::And(vec![owner.clone(), RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer)])]);
    let repair = audience_grant_repair(&schema, "memberships", &binding, false).unwrap();
    assert!(repair.rule.ends_with("(exists rooms[.room] and .principal = viewer and exists memberships[.room, viewer])"), "{}", repair.rule);
}
