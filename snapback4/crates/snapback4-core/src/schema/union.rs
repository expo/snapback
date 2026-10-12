//! Union audiences: the `E_SYNC` rules a union of audiences must meet.
use super::*;

/// A union of audiences (LLP 3000.036.000.000 §2.2): the audience rule is
/// exactly the `or` of the arms, each a whole disjunct; principal-column
/// arms and at most one group arm; each arm with its own index and no window or expiry.
// @ref LLP 3000.036.000.000#2.2 — every disjunct is one arm and every arm one disjunct, so each partition's recipients are readers and every reader has a partition.
pub(super) fn validate(schema: &Schema, table_name: &str, table: &Table, sync: &Sync, path: &str, issues: &mut Vec<SchemaIssue>) {
    let issue = |issues: &mut Vec<SchemaIssue>, message: String| issues.push(SchemaIssue { path: path.to_owned(), message });
    let arms: Vec<(&Audience, Option<&Horizon>)> = sync.arms().collect();
    // @ref LLP 3000.036.000.000#8 — union arms have no acquisition windows or direct/inherited expiry.
    if sync.horizon.is_some() || sync.also.iter().any(|arm| arm.horizon.is_some()) {
        issue(issues, "union audiences cannot have `last N by ...`; use `online only` to keep the read rule and queries, or remove the sync window to replicate every readable row when no other excluded expiry/window scope remains".into());
        return;
    }
    let line = sync.line_in(table);
    let mut scopes = vec![table_name.to_owned()];
    if let Audience::Target { table, .. } = &sync.audience { scopes.push(table.clone()); }
    for root in scopes {
        let mut name = root.as_str();
        let mut seen = BTreeSet::new();
        while seen.insert(name) {
            let Some(scope) = schema.table(name) else { break };
            if scope.is_expiring() {
                issue(issues, format!("{line}: union audiences cannot expire: {name} has direct or inherited `expire at`; use `online only` to keep the read rule, expiry and queries"));
                return;
            }
            if scope.sync.as_ref().is_some_and(|sync| sync.horizon.is_some() || sync.also.iter().any(|arm| arm.horizon.is_some())) {
                issue(issues, format!("{line}: union audiences cannot depend on windowed scope {name} (direct or inherited); use `online only` to keep the read rule and queries"));
                return;
            }
            let Some(through) = &scope.through else { break };
            name = &through.parent;
        }
    }
    if sync.also.iter().any(|arm| !matches!(arm.audience, Audience::Column(_))) {
        issue(issues, format!("{line}: a union's further arms are principal columns; its one group audience is its first arm"));
        return;
    }
    if matches!(sync.audience, Audience::Public) {
        issue(issues, format!("{line}: a union cannot include `public`; keep shared and private rows in two tables (guide sync)"));
        return;
    }
    let mut columns = BTreeSet::new();
    for (audience, _) in &arms {
        if let Audience::Column(column) = audience {
            if !columns.insert(column.as_str()) { issue(issues, format!("{line} names .{column} twice")); }
            match table.columns.get(column) {
                Some(ColumnType::Principal) => {}
                Some(kind) => issue(issues, format!("{line}: .{column} needs a principal column, not {kind}")),
                None => issue(issues, format!("{line} names an undeclared column .{column}")),
            }
        }
    }
    // The exclusions of §8: each would need its own retention design.
    if table.through.is_some() { issue(issues, format!("{line}: a table that reads through its parent cannot sync to a union; use `online only`")); }
    if let Some((child, _)) = schema.tables.iter().find(|(_, child)| child.through.as_ref().is_some_and(|through| through.parent == table_name)) {
        issue(issues, format!("{line}: {child} reads through {table_name}, and a child cannot inherit a union audience; make {child} `online only` or sync {table_name} to one audience"));
    }
    if table.leave == LeavePolicy::DeliveredHistory { issue(issues, format!("{line}: `retain delivered-history` cannot apply to a union; a left group's retained rows and a column arm's current rows would share the group's markers")); }
    if table.written_by.values().any(|authority| !authority.audience) { issue(issues, format!("{line}: a union cannot carry private field owners (`written by` without `readable by audience`)")); }
    if schema.timelines.iter().any(|timeline| timeline.posts.first().is_some_and(|t| t == table_name) || timeline.reposts.first().is_some_and(|t| t == table_name)) {
        issue(issues, format!("{line}: a timeline's table cannot sync to a union"));
    }
    if schema.maintains.iter().any(|maintain| maintain.source == table_name && (maintain.row_key.is_some() || maintain.own_keys.is_some())) {
        issue(issues, format!("{line}: a row-keyed view or `with own keys` cannot read a union source"));
    }
    if table.ephemeral.is_some() { issue(issues, format!("{line}: an ephemeral table does not sync")); }
    // The rule is exactly the `or` of the arms.
    let audience_rule = table.rules.read.sync_audience_rule(table_name, table);
    let disjuncts = audience_rule.disjuncts();
    let arm_rule = |audience: &Audience, disjunct: &RuleExpr| match (audience, disjunct) {
        (Audience::Column(column), RuleExpr::Eq(RuleTerm::Field(field), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(field))) => field == column,
        (Audience::Target { table: target, prefix, .. }, RuleExpr::Exists { table, key, equalities, .. }) => table == target && equalities.is_empty()
            && key == &prefix.iter().cloned().map(RuleTerm::Field).chain([RuleTerm::Viewer]).collect::<Vec<_>>(),
        _ => false,
    };
    let exact = matches!(audience_rule.as_ref(), RuleExpr::Or(_)) && disjuncts.len() == arms.len()
        && disjuncts.iter().all(|disjunct| arms.iter().filter(|(audience, _)| arm_rule(audience, disjunct)).count() == 1)
        && arms.iter().all(|(audience, _)| disjuncts.iter().filter(|disjunct| arm_rule(audience, disjunct)).count() == 1);
    if !exact {
        issue(issues, format!("{line} is only sound when the read rule is exactly `{}`; it reads under `{}`",
            arms.iter().map(|(audience, _)| match audience {
                Audience::Column(column) => format!(".{column} = viewer"),
                Audience::Target { table, prefix, .. } => format!("exists {table}[{}]", prefix.iter().map(|c| format!(".{c}, ")).collect::<String>() + "viewer"),
                Audience::Public => "public".into(),
            }).collect::<Vec<_>>().join(" or "), table.rules.read.quarry()));
        return;
    }
    if let Audience::Target { table: target_name, principal, .. } = &sync.audience {
        let Some(target) = schema.table(target_name) else {
            issue(issues, format!("sync to {target_name} names an unknown table"));
            return;
        };
        if target.columns.get(principal) != Some(&ColumnType::Principal) {
            issue(issues, format!("sync to {target_name} reads principals from {target_name}.{principal}, which is not a principal column"));
        }
        match audience_binding(schema, table_name, table, sync) {
            Err(why) => issue(issues, why),
            Ok(binding) => target_grant_issues(schema, table_name, target_name, target, principal, &binding, &mut |message| issue(issues, message)),
        }
    }
    for (audience, _) in &arms {
        sync_index_issues(table_name, table, sync, audience, None, &mut |message| issue(issues, message));
    }
}
