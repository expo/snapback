//! Closed admission and schema-fixed prices for transactional live authority.
// @ref LLP 3000.014.000#2-surface-and-admission — never widen an unsupported whole rule.
use super::references::OnDelete;
use super::*;
use reservations::Price;
use through::LIVE_CHILDREN;

pub fn has_live(schema: &Schema) -> bool {
    schema
        .tables
        .values()
        .any(|t| t.through.as_ref().is_some_and(|t| t.live.is_some()))
}
pub fn parent(schema: &Schema, name: &str) -> bool {
    schema.children(name).any(|(_, _, t)| t.live.is_some())
}
fn nonnull(source: &Table, term: &RuleTerm) -> bool {
    match term {
        RuleTerm::Viewer => true,
        RuleTerm::Literal(value) => *value != Value::Null,
        RuleTerm::Field(field) => source.columns.get(field).is_some_and(|t| !t.is_optional()),
        _ => false,
    }
}
fn scalar(kind: &ColumnType) -> bool {
    !matches!(
        kind.required(),
        ColumnType::List { .. }
            | ColumnType::ListRange { .. }
            | ColumnType::Json { .. }
            | ColumnType::Image { .. }
            | ColumnType::Video { .. }
            | ColumnType::File { .. }
    )
}
fn term(source: &Table, term: &RuleTerm) -> bool {
    match term {
        RuleTerm::Viewer => true,
        RuleTerm::Literal(value) => matches!(value,Value::Null|Value::Bool(_)|Value::Int(_)|Value::String(_)|Value::Id(_)|Value::Bytes(_)),
        RuleTerm::Field(field) => {
            source.columns.get(field).is_some_and(scalar) && !source.engine_field(field)
        }
        _ => false,
    }
}
fn rule(schema: &Schema, source: &Table, expr: &RuleExpr, targets: &mut Vec<String>) -> bool {
    match expr {
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => true,
        RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) => term(source, a) && term(source, b),
        RuleExpr::And(xs) | RuleExpr::Or(xs) => xs.iter().all(|e| rule(schema, source, e, targets)),
        RuleExpr::Not(x) => rule(schema, source, x, targets),
        RuleExpr::Exists {
            table,
            index,
            key,
            equalities,
            ..
        } => {
            targets.push(table.clone());
            let Some(target) = schema.table(table) else {
                return false;
            };
            let Some(index) = target.index(index) else {
                return false;
            };
            index.unique
                && index.is_plain()
                && index.columns().len() == key.len()
                && key.iter().all(|t| term(source, t))
                && index.columns().iter().zip(key).all(|(f, t)| {
                    target
                        .columns
                        .get(f)
                        .is_some_and(|k| !k.is_optional() || nonnull(source, t))
                })
                && equalities.iter().all(|(field, t)| {
                    target.columns.get(field).is_some_and(scalar)
                        && !target.engine_field(field)
                        && term(source, t)
                })
        }
        _ => false,
    }
}
fn endpoint(schema: &Schema, name: &str, allow_child: bool, probe: bool) -> bool {
    let Some(t) = schema.table(name) else {
        return false;
    };
    schema.visible(name) && t.ephemeral.is_none() && t.expire.is_none() && t.not_before.is_none()
        && t.recorded.is_empty() && t.maintained.is_empty() && t.written_by.is_empty() && t.sequences.is_empty()
        && (allow_child || t.through.is_none())
        && (probe || !t.on_delete.values().any(|a| a.writes()))
        && !schema.timelines.iter().any(|tl| tl.owns(name) || tl.maps(name))
        && !schema.maintains.iter().any(|m| m.source == name || m.target == name || m.row_key.as_ref().is_some_and(|k| k.table == name))
        && (probe || !schema.receipts.iter().any(|f| [&f.scope,&f.messages,&f.members,&f.runs].iter().any(|n| n.as_str() == name)))
        && (probe || !schema.synced().any(|(_,_,sync)| matches!(&sync.audience, Audience::Target { table, .. } if table == name)))
}
/// Maximum owned encoded key, including tags/terminators and escaped payload.
pub(crate) fn key_column(kind: &ColumnType) -> Option<u64> {
    use ColumnType::*;
    Some(match kind.required() {
        Id | Principal | Ref { .. } => 2 * 144 + 3,
        Text { max } => u64::from(*max).checked_mul(8)?.checked_add(3)?,
        Bytes { max } => u64::from(*max).checked_mul(2)?.checked_add(3)?,
        Enum { variants } => (variants.iter().map(|s| s.len()).max().unwrap_or(0) as u64)
            .checked_mul(2)?
            .checked_add(3)?,
        Bool => 2,
        Int | IntRange { .. } | Time | Decimal { .. } | Money { .. } => 16,
        _ => return None,
    })
}
pub fn key_shapes(table_name: &str, table: &Table) -> bool {
    table.indexes.iter().all(|(name, index)| {
        index.is_plain()
            && name.len().saturating_add(table_name.len()) <= crate::rows::MAX_INDEX_LABEL_BYTES
            && index
                .columns()
                .iter()
                .try_fold(key_column(&ColumnType::Id).unwrap(), |n, f| {
                    n.checked_add(key_column(table.columns.get(f)?)?)
                })
                .is_some_and(|n| n <= crate::rows::MAX_INDEX_KEY_BYTES as u64)
    })
}

pub fn validate(schema: &Schema) -> Vec<SchemaIssue> {
    let mut out = Vec::new();
    for (name, child) in &schema.tables {
        let Some(edge) = child.through.as_ref().filter(|t| t.live.is_some()) else {
            continue;
        };
        let mut fail = |message: &str| {
            out.push(SchemaIssue { path: format!("tables.{name}.through"), message: format!("live parent: {message}; use guide rule-recipes current-roster for manual maintenance") })
        };
        let n = edge.live.unwrap();
        let matching = child
            .constraints
            .iter()
            .filter_map(|c| match c {
                Constraint::Cap { by, max } if by == &[edge.reference.clone()] => Some(*max),
                _ => None,
            })
            .min();
        if n == 0 || matching != Some(n) {
            fail("declare cap N by the immutable parent reference and retain its exact bound");
        }
        if !endpoint(schema, name, true, false) || !endpoint(schema, &edge.parent, false, false) {
            fail(
                "endpoints must be ordinary nonexpiring tables without derivations, receipt-family roles, private owners, audience-target roles or writing reference actions",
            );
        }
        if schema.children(name).next().is_some() {
            fail("live and captured descendants of a live child are not admitted");
        }
        if child
            .on_delete
            .get(&edge.reference)
            .is_some_and(|a| *a != OnDelete::Restrict)
        {
            fail("the live reference requires on delete restrict");
        }
        if child
            .sync
            .as_ref()
            .is_some_and(|s| s.horizon.is_some() || s.is_union())
            || child.leave == LeavePolicy::DeliveredHistory
        {
            fail("live sync requires one all-current until-revoked audience, without a horizon");
        }
        if child.index(LIVE_CHILDREN).is_none_or(|i| {
            !i.is_plain() || i.unique || i.columns() != [edge.reference.clone(), "id".into()]
        }) {
            fail("missing plain nonunique $liveChildren [reference,id] index");
        }
        let private_key=|fields:&[String]|fields.iter().any(|f|child.engine_field(f));
        if child.indexes.values().any(|i|i.unique && private_key(&i.columns())) || child.constraints.iter().any(|c|match c {
            Constraint::Immutable{fields}=>private_key(fields),
            Constraint::Cap{by,..}=>private_key(by),Constraint::Text{field,..}=>child.engine_field(field),_=>false,
        }) {fail("ordinary constraints and unique keys must use authored cells, not mutable live inputs");}
        if !key_shapes(name, child) {
            fail(
                "live children need plain indexes whose declared maximum keys fit; narrow indexed scalar bounds or use the manual form",
            );
        }
        let mut pending = vec![edge.parent.clone()];
        let mut seen = BTreeSet::new();
        while let Some(target) = pending.pop() {
            if !seen.insert(target.clone()) {
                continue;
            }
            if !endpoint(schema, &target, false, true) {
                fail(
                    "the transitive read-probe graph must be ordinary and nonexpiring, without live/captured, derived or private inputs",
                );
                break;
            }
            if !rule(
                schema,
                &schema.tables[&target],
                &schema.tables[&target].rules.read,
                &mut pending,
            ) {
                fail(
                    "parent authority must use direct scalar comparisons and total keyed ordinary probes; no live hops or optional keys without structural non-null terms",
                );
                break;
            }
        }
        #[cfg(feature = "sqlite")]
        if edge_price(schema, name).is_none() || write_price(schema, &edge.parent).is_none() {
            fail("live maintenance price overflows its representation");
        }
    }
    out
}

/// Full schema only. Device projections consume exported prices, never rebuild them.
// @ref LLP 3000.014.000#5-reservation-and-accounting-contract — decode, key buffers and retained event storage coexist.
pub fn edge_price(schema: &Schema, name: &str) -> Option<Price> {
    let child = schema.table(name)?;
    let edge = child.through.as_ref()?;
    let n = u64::from(edge.live?);
    let d = crate::rows::disclosed::decode_reservation(child);
    if d == u64::MAX {
        return None;
    }
    let k = crate::rows::MAX_INDEX_KEY_BYTES as u64;
    let (mut b, mut w) = (0_u64, 0_u64);
    for index in child.indexes.values() {
        let width = index.columns().len() as u64;
        w = w.checked_add(width)?;
        b = b.checked_add(4 * k + 128 * (width + 1) + 512)?;
    }
    let a = u64::from(child.sync.is_some());
    let m = 1024 + 4 * k + 4 * name.len().max(edge.parent.len()) as u64;
    let e = (2 * a)
        .checked_mul(d)?
        .checked_add((2 * a + 4).checked_mul(m)?)?
        .max(reservations::event_envelope(d, a, m, 0).1);
    let steps = (n + 1).checked_mul(
        64 + 8 * (edge.fields.len() as u64 + child.columns.len() as u64 + w) + 4 * a,
    )?;
    let heap = (n + 1)
        .checked_mul(d + k + 256)?
        .checked_add(4_u64.checked_mul(d)?)?
        .checked_add(2 * b)?
        .checked_add(n.checked_mul(e)?)?;
    Some([
        steps,
        2_u64
            .checked_mul(n)?
            .checked_mul(child.indexes.len() as u64)?,
        n + 1,
        n,
        heap,
        0,
        0,
    ])
}
pub fn retained_event_heap(schema: &Schema, name: &str) -> Option<u64> {
    let child = schema.table(name)?;
    let edge = child.through.as_ref()?;
    let a = u64::from(child.sync.is_some());
    let d = crate::rows::disclosed::decode_reservation(child);
    let m = 1024
        + 4 * crate::rows::MAX_INDEX_KEY_BYTES as u64
        + 4 * name.len().max(edge.parent.len()) as u64;
    u64::from(edge.live?).checked_mul(
        (2 * a)
            .checked_mul(d)?
            .checked_add((2 * a + 4).checked_mul(m)?)?,
    )
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveReservation {
    pub price: Price,
    pub retained_heap: u64,
    pub children: Vec<String>,
}
pub fn write_price(schema: &Schema, source: &str) -> Option<LiveReservation> {
    let mut result = LiveReservation::default();
    for (name, _, _) in schema.children(source).filter(|(_, _, t)| t.live.is_some()) {
        let price = edge_price(schema, name)?;
        for (to, n) in result.price.iter_mut().zip(price) {
            *to = to.checked_add(n)?;
        }
        result.retained_heap = result
            .retained_heap
            .checked_add(retained_event_heap(schema, name)?)?;
        result.children.push(name.clone());
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn key_bound_includes_tag_escaped_bytes_and_appended_id() {
        let mut table=public_table([("id".into(),ColumnType::Id),("blob".into(),ColumnType::Bytes{max:877})].into(),[("byId".into(),Index::of(&["id"],true))].into());table.indexes.insert("byBlob".into(),Index::of(&["blob"],false));
        assert!(key_shapes("rows",&table));
        let row=crate::value::object([("blob",Value::Bytes(vec![0;877]))]);let id="\0".repeat(144);
        assert_eq!(crate::rows::index_key(&table.indexes["byBlob"],&row,&id).len(),crate::rows::MAX_INDEX_KEY_BYTES);
        table.columns.insert("blob".into(),ColumnType::Bytes{max:878});assert!(!key_shapes("rows",&table));
    }
}
