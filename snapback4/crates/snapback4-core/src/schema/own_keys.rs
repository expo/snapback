//! Explicit owner-key partitions reuse maintained writes and whole-partition sync.
// @ref LLP 3000.028#3.4 — existence only, immutable caller-owned public keys, opt-in and capability fenced.
use super::*;

pub fn target(source: &str) -> String { format!("$ownKeys:{source}") }
pub const OWNER_INDEX: &str = "$ownKeys";

fn caller_owned(rule: &RuleExpr, owner: &str) -> bool {
    match rule {
        RuleExpr::Deny => true,
        RuleExpr::Eq(RuleTerm::Field(field), RuleTerm::Viewer)
        | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(field)) => field == owner,
        RuleExpr::And(terms) => terms.iter().any(|r| caller_owned(r, owner)),
        RuleExpr::Or(terms) => !terms.is_empty() && terms.iter().all(|r| caller_owned(r, owner)),
        _ => false,
    }
}

pub fn keys(source: &Table, owner: &str) -> Result<Vec<String>, String> {
    let fail = |reason: &str| format!("own keys: {reason}");
    if source.is_expiring() || source.ephemeral.is_some() || source.through.is_some()
        || !source.rules.read.is_uniformly_readable()
        || !source.sync.as_ref().is_some_and(|s| s.audience == Audience::Public && s.horizon.is_some()) {
        return Err(fail("requires a non-expiring public source with a public sync window; online only does not acquire keys"));
    }
    if source.columns.get(owner) != Some(&ColumnType::Principal) {
        return Err(fail("the owner must be a required principal column"));
    }
    if !caller_owned(&source.rules.insert, owner) || !caller_owned(&source.rules.delete, owner)
        || !matches!(source.rules.update, RuleExpr::Deny) && !caller_owned(&source.rules.update, owner) {
        return Err(fail("every insert, update and delete rule must structurally prove .owner = viewer, or deny"));
    }
    let immutable: BTreeSet<_> = source.immutable_fields().collect();
    let Some(index) = source.indexes.values().find(|index| index.unique && index.is_plain()
        && index.columns().iter().any(|f| f == owner)
        && index.columns().iter().all(|f| f != "id" && f != "value" && immutable.contains(f.as_str())
            && source.columns.get(f).is_some_and(|t| !t.is_optional()) && !source.written_by.contains_key(f))) else {
        return Err(fail("needs a total unique key containing the owner, with immutable, audience-readable key fields (id and value are reserved)"));
    };
    Ok(std::iter::once(owner.to_owned()).chain(index.columns().into_iter().filter(|f| f != owner)).collect())
}

pub fn projection(source: &Table, owner: &str, by: &[String]) -> Table {
    let mut columns: BTreeMap<_, _> = by.iter().map(|f| (f.clone(), source.columns[f].clone())).collect();
    columns.insert("id".into(), ColumnType::Id);
    columns.insert("value".into(), ColumnType::Int);
    let mut table = public_table(columns, BTreeMap::from([
        ("byId".into(), Index::of(&["id"], true)),
        ("byGroup".into(), Index::of(&by.iter().map(String::as_str).collect::<Vec<_>>(), true)),
    ]));
    table.rules = Rules::deny();
    table.rules.read = RuleExpr::Eq(RuleTerm::Field(owner.into()), RuleTerm::Viewer);
    table.constraints = vec![Constraint::Unique { index: "byGroup".into() }];
    table.sync = Some(Sync { audience: Audience::Column(owner.into()), horizon: None, also: Vec::new() });
    table
}

pub fn validate(schema: &Schema, maintain: &Maintain) -> Result<(), String> {
    let Some(owner) = &maintain.own_keys else { return Ok(()); };
    let source = schema.table(&maintain.source).ok_or("own keys: missing source")?;
    let by = keys(source, owner)?;
    if maintain.by != by || maintain.target != target(&maintain.source)
        || maintain.kind != MaintainKind::Count || maintain.private.is_some() || maintain.row_key.is_some()
        || maintain.parent_key.is_some() || maintain.filter.is_some() || !maintain.computed.is_empty()
        || !maintain.aliases.is_empty() || maintain.readable.is_some()
        || schema.table(&maintain.target) != Some(&projection(source, owner, &by))
        || !source.indexes.get(OWNER_INDEX).is_some_and(|i| i == &Index::of(&by.iter().map(String::as_str).collect::<Vec<_>>(), false)) {
        return Err("own keys: requires the exact compiler-owned key projection and owner index".into());
    }
    Ok(())
}
