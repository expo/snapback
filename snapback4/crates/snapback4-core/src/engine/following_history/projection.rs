//! The existing compiler collector, evaluated once per selected event. No new IR.
use super::*;
use crate::{
    engine::runner::Runner,
    ir::*,
    meter::{Cut, Meter},
    schema::Schema,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub declaration: String,
    pub page_size: usize,
    pub cursor: Option<String>,
}
pub struct Plan<'a> {
    pub binding: Binding,
    pub(super) scan: &'a Scan,
    projections: Vec<(&'a str, &'a Expr)>,
}

/// A chain of compiler-generated, one-for-one collectors over one Following
/// scan. Authored filters, independent scans and effectful statements fail closed.
// @ref LLP 3000.026#9-exact-on-demand-history-design-handoff — project the declared view without altering its inbox program.
pub fn plan<'a>(schema: &Schema, p: &'a Program) -> Option<Plan<'a>> {
    if p.kind != ProgramKind::Query
        || p.native
        || schema.operations.get(&p.name).is_some_and(|f| f.held)
    {
        return None;
    }
    let mut previous: Option<&str> = None;
    let mut binding = None;
    let mut scan = None;
    let mut projections = Vec::new();
    let (last, rest) = p.body.split_last()?;
    if rest.len() % 2 != 0 {
        return None;
    }
    for pair in rest.chunks_exact(2) {
        let [
            Stmt::Let {
                name,
                value: Expr::Array(empty),
            },
            Stmt::For {
                binding: row,
                domain,
                body,
            },
        ] = pair
        else {
            return None;
        };
        let [Stmt::Push { target, value }] = body.as_slice() else {
            return None;
        };
        if !empty.is_empty()
            || name != target
            || !name.starts_with('$')
            || !point_value(schema, value, row, &p.args)
        {
            return None;
        }
        match (previous, domain) {
            (None, LoopDomain::Page(s)) => {
                let t = schema
                    .timelines
                    .iter()
                    .find(|t| t.table("Feed") == s.table)?;
                if s.index != "byReaderPage"
                    || s.order != Order::Desc
                    || s.prefix != [IndexKeyExpr::Scalar(Expr::Input(Input::Viewer))]
                    || s.before.is_some()
                    || s.range.is_some()
                    || s.merge_site.is_some()
                {
                    return None;
                }
                let Bound::Literal(n) = s.take else {
                    return None;
                };
                if !(1..=100).contains(&n) {
                    return None;
                }
                let cursor = match s.after.as_deref() {
                    None | Some(Expr::Literal(Value::Null)) => None,
                    Some(Expr::Variable(v)) => Some(v.clone()),
                    _ => return None,
                };
                scan = Some(s);
                binding = Some(Binding {
                    declaration: t.name.clone(),
                    page_size: n as usize,
                    cursor,
                });
            }
            (
                Some(prev),
                LoopDomain::DerivedArray {
                    value: Expr::Variable(v),
                    ..
                },
            ) if prev == v => {}
            _ => return None,
        }
        projections.push((row.as_str(), value));
        previous = Some(name);
    }
    if !matches!(last, Stmt::Return(Expr::Variable(v)) if Some(v.as_str()) == previous) {
        return None;
    }
    Some(Plan {
        binding: binding?,
        scan: scan?,
        projections,
    })
}
fn point_value(schema: &Schema, e: &Expr, row: &str, args: &BTreeMap<String, ArgType>) -> bool {
    let child = |e| point_value(schema, e, row, args);
    match e {
        Expr::Literal(_) | Expr::Input(Input::Viewer) => true,
        Expr::Variable(v) => v == row || args.contains_key(v),
        Expr::Field { base, .. } => child(base),
        Expr::Shape { base, fields } => child(base) && fields.values().all(child),
        Expr::Object(fields) => fields.values().all(child),
        Expr::Builtin {
            builtin: Builtin::OptionalField { .. },
            args,
        } => args.iter().all(child),
        Expr::Get(r) => {
            schema.table(&r.table).is_some_and(|t| {
                t.index(&r.index)
                    .is_some_and(|i| i.unique && i.is_plain() && i.components.len() == r.key.len())
                    && t.ephemeral.is_none()
                    && !t.is_expiring()
                    && schema.maintain_for(&r.table).is_none()
            }) && r.key.iter().all(child)
        }
        _ => false,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Witness {
    pub table: String,
    pub id: String,
    pub fields: Vec<String>,
}
impl Witness {
    pub fn bytes(&self) -> u64 {
        256 + (self.table.len()
            + self.id.len()
            + self.fields.iter().map(|s| s.len() + 32).sum::<usize>()) as u64
    }
}

pub(super) const LIMIT: Ceilings = Ceilings {
    examined: 64,
    index_entries: 128,
    rule_probes: 128,
    steps: 32768,
    heap_bytes: 8 << 20,
    output_bytes: 128 << 10,
    rows_written: 0,
};
pub(super) fn reservation() -> Metered {
    Metered {
        examined: LIMIT.examined,
        index_entries: LIMIT.index_entries,
        rule_probes: LIMIT.rule_probes,
        steps: LIMIT.steps,
        heap_bytes: LIMIT.heap_bytes,
        ..Default::default()
    }
}

pub(super) fn shape(
    tx: &Tx<'_>,
    schema: &Schema,
    p: &Plan<'_>,
    s: &Session,
    event: &Event,
    now: i64,
) -> Result<(Item, Vec<Witness>, Metered), RuntimeError> {
    let mut r = Runner::new(
        tx,
        schema,
        Context::new(&s.viewer, s.arguments.clone()).at(now),
        Meter::new(LIMIT, Cut::Abort),
        s.head,
    );
    r.following_witnesses = Some(Vec::new());
    let result = (|| {
        let mut value = crate::value::object([
            ("id", Value::Id(event.id.clone())),
            ("eventId", Value::Id(event.id.clone())),
            ("actorId", Value::Id(event.actor.clone())),
            ("authorId", Value::Id(event.author.clone())),
            ("postId", Value::Id(event.post.clone())),
            ("at", Value::Int(event.at)),
            ("repost", Value::Bool(event.repost)),
        ]);
        for (binding, expr) in &p.projections {
            r.meter
                .heap(super::super::runner::expression_copy(&value) + 256)?;
            r.env.insert((*binding).into(), value);
            value = r.expr(expr)?;
            r.env.remove(*binding);
        }
        r.charge_output(&value)?;
        // JSON materialization and the card wrapper are reserved before allocation.
        let witnesses = r
            .following_witnesses
            .as_ref()
            .unwrap()
            .iter()
            .map(Witness::bytes)
            .sum::<u64>();
        r.meter.heap(
            wire_heap(&value)
                + r.meter.used.output_bytes.saturating_mul(2)
                + witnesses.saturating_mul(2)
                + 512,
        )?;
        Ok(Item::Shaped {
            id: event.id.clone(),
            value: crate::wire::to_json(&value),
            authority: r.following_witnesses.as_ref().unwrap().clone(),
        })
    })();
    let mut used = r.metered();
    // Failed charges precede allocation; the rejected amount is not work kept.
    used.heap_bytes = used.heap_bytes.min(LIMIT.heap_bytes);
    used.examined = used.examined.min(LIMIT.examined);
    used.index_entries = used.index_entries.min(LIMIT.index_entries);
    used.rule_probes = used.rule_probes.min(LIMIT.rule_probes);
    used.steps = used.steps.min(LIMIT.steps);
    used.output_bytes = 0; // The pinned unit, including its envelope, owns output.
    match result {
        Ok(item) if item.retained_bytes() <= (1 << 20) => {
            Ok((item, r.following_witnesses.take().unwrap(), used))
        }
        Ok(_) => Ok((
            Item::Omitted {
                id: event.id.clone(),
                code: "E_FOLLOWING_ROW_TOO_LARGE",
            },
            Vec::new(),
            used,
        )),
        Err(RuntimeError::Bound { .. }) | Err(RuntimeError::AuthorizationBudget { .. }) => Ok((
            Item::Omitted {
                id: event.id.clone(),
                code: "E_FOLLOWING_ROW_TOO_LARGE",
            },
            Vec::new(),
            used,
        )),
        Err(e) => Err(e),
    }
}

pub(super) fn authorized(
    tx: &Tx<'_>,
    schema: &Schema,
    s: &Session,
    ws: &[Witness],
    now: i64,
) -> Result<(bool, Metered), RuntimeError> {
    let mut r = Runner::new(
        tx,
        schema,
        Context::new(&s.viewer, BTreeMap::new()).at(now),
        Meter::new(LIMIT, Cut::Abort),
        s.head,
    );
    for w in ws {
        schema.refuse_private(&w.table)?;
        let Some(table) = schema.table(&w.table) else {
            return Ok((false, r.metered()));
        };
        // Reauthorize the pinned image using current policy inputs only. A body
        // edit must not replace the image or inflate replay's work allowance.
        let mut fields = super::super::rules::deciding_fields(&w.table, table, &table.rules.read);
        fields.insert("id".into());
        fields.extend(table.written_by.values().map(|a| a.owner.clone()));
        let fields: Vec<String> = fields.into_iter().collect();
        r.meter.charge(crate::MeterKind::Examined, 1)?;
        let found = r.scan_authorized(
            &w.table,
            "byId",
            &[Value::Id(w.id.clone())],
            &Default::default(),
            crate::rows::Dir::Asc,
            1,
            true,
            false,
            #[cfg(feature = "server-search")]
            Some(&fields),
        )?;
        let Some((Some(row), _)) = found.into_iter().next() else {
            return Ok((false, r.metered()));
        };
        let value = row.into_value();
        for field in &w.fields {
            if !table.columns.contains_key(field) || table.engine_field(field) {
                return Ok((false, r.metered()));
            }
            if let Some(a) = table.written_by.get(field) {
                if !a.audience
                    && value.field(&a.owner).ok().and_then(|v| v.as_str().ok())
                        != Some(s.viewer.as_str())
                {
                    return Ok((false, r.metered()));
                }
            }
        }
    }
    let used = r.metered();
    Ok((true, used))
}

// JSON byte length does not price maps of small scalar fields. Include map
// nodes, vector capacities, strings and wrapper values in retained custody.
pub(super) fn json_heap(value: &serde_json::Value) -> u64 {
    use serde_json::Value as J;
    match value {
        J::Object(fields) => {
            128 + fields
                .iter()
                .map(|(k, v)| 256 + k.len() as u64 + json_heap(v))
                .sum::<u64>()
        }
        J::Array(values) => 128 + values.iter().map(|v| 64 + json_heap(v)).sum::<u64>(),
        J::String(s) => 64 + s.len() as u64,
        _ => 64,
    }
}

fn wire_heap(value: &Value) -> u64 {
    match value {
        Value::Row(fields) | Value::Map(fields) => {
            128 + fields
                .iter()
                .map(|(k, v)| 256 + k.len() as u64 + wire_heap(v))
                .sum::<u64>()
        }
        Value::Array(values) => 128 + values.iter().map(|v| 64 + wire_heap(v)).sum::<u64>(),
        Value::String(s) | Value::Id(s) => 64 + s.len() as u64,
        Value::Bytes(bytes) => 64 + bytes.len() as u64 * 2,
        _ => 64,
    }
}
