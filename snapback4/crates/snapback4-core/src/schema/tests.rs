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
