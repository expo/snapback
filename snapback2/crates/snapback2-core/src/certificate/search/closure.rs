//! Search and maintained-address closure pricing follows actual first-image custody.
use super::*;
use crate::bounds::{
    declared_column_value_max, declared_identity_max, declared_serialized_row_max,
};
use crate::collection_rewrite::{ByteShape, row_shape};

pub(crate) fn estimate(
    schema: &Schema,
    program: &Program,
    reads: &BTreeMap<String, ReadSite>,
    merges: &BTreeMap<String, MergeSite>,
) -> Option<ByteShape> {
    let mut scans = Vec::new();
    let mut plans = Vec::new();
    fn walk(body: &[Stmt], scans: &mut Vec<Scan>, plans: &mut Vec<Merge>) {
        for stmt in body {
            crate::certificate_policy::visit_statement_exprs(stmt, &mut |e| match e {
                Expr::Scan(s) => scans.push(s.clone()),
                Expr::Merge(m) => plans.push(m.clone()),
                _ => {}
            });
            match stmt {
                Stmt::If {
                    then_body,
                    else_body,
                    ..
                } => {
                    walk(then_body, scans, plans);
                    walk(else_body, scans, plans)
                }
                Stmt::For { body, .. } => walk(body, scans, plans),
                _ => {}
            }
        }
    }
    walk(&program.body, &mut scans, &mut plans);
    let search = scans.iter().any(|scan| {
        schema
            .table(&scan.table)
            .and_then(|t| t.index(&scan.index))
            .is_some_and(|i| i.derived_offset().is_some())
    });
    if !search && !consumes_maintained_domain(schema, program, reads) {
        return None;
    }
    if reads
        .values()
        .any(|r| declared_serialized_row_max(schema, &r.table) == u64::MAX)
        || program
            .args
            .values()
            .any(|a| crate::retention::argument_max(schema, a) == u64::MAX)
    {
        return Some(ByteShape::leaf(
            u64::MAX,
            "unbounded maintained reference domain",
        ));
    }
    let mut pools = BTreeMap::<String, u64>::new();
    let mut covered_rules = BTreeSet::new();
    let mut counted_merges = BTreeSet::new();
    for plan in &plans {
        let Some(site) = merges.get(&plan.site) else {
            continue;
        };
        let heads = plan
            .lanes
            .iter()
            .map(|l| reads.get(&l.scan.site).map_or(0, |r| r.max_calls))
            .sum::<u64>();
        let calls = plan
            .lanes
            .iter()
            .map(|l| {
                reads.get(&l.scan.site).map_or(0, |r| {
                    r.max_calls / l.source.as_ref().map_or(1, |s| s.take.maximum()).max(1)
                })
            })
            .max()
            .unwrap_or(0);
        let count = if site.uniform {
            heads.saturating_add(calls.saturating_mul(site.take + 2))
        } else {
            heads.saturating_mul(site.take + 3)
        };
        *pools.entry(plan.table().into()).or_default() += count;
        counted_merges.extend(site.lane_sites.iter().cloned());
        // The independently certified canonical plan uses the discovered membership
        // rows themselves as its rule witnesses, so those images already belong to the pool.
        if plan.held_search.is_some() {
            for lane in &plan.lanes {
                covered_rules.insert(lane.scan.site.clone());
                if let Some(source) = &lane.source {
                    covered_rules.insert(source.site.clone());
                }
            }
        }
    }
    let mut metadata = 0u64;
    let mut children = Vec::new();
    for scan in &scans {
        let Some(read) = reads.get(&scan.site) else {
            continue;
        };
        let Some(table) = schema.table(&scan.table) else {
            continue;
        };
        let Some(index) = table.index(&scan.index) else {
            continue;
        };
        if !counted_merges.contains(&scan.site) {
            *pools.entry(scan.table.clone()).or_default() +=
                read.max_calls.saturating_mul(read.take + 1);
        }
        let prefix = index
            .components
            .iter()
            .zip(&scan.prefix)
            .map(|(c, k)| match (c, k) {
                (IndexComponent::Column(n), _) => {
                    declared_column_value_max(schema, &scan.table, n).unwrap_or(0) + 12
                }
                (_, IndexKeyExpr::WordPrefix { source_max, .. }) => {
                    crate::search_key::word_prefix_wire_max(*source_max).unwrap_or(usize::MAX)
                        as u64
                }
                _ => u64::MAX / 16,
            })
            .fold(0u64, u64::saturating_add);
        let suffix = index
            .components
            .iter()
            .skip(scan.prefix.len())
            .filter_map(IndexComponent::column)
            .map(|n| declared_column_value_max(schema, &scan.table, n).unwrap_or(0) + 1)
            .sum::<u64>()
            + 12;
        let skeleton = serde_json::json!({"site":scan.site,"table":scan.table,"index":scan.index,"prefix":[],"order":scan.order,"take":read.take,"after":null,"before":null,"gt":null,"gte":null,"lt":null,"lte":null,"rule_hash":"0".repeat(64),"row_ids":[],"stop":"Exhausted","absence":false,"halo":null,"n2_suffix":null});
        let bounds = u64::from(scan.after.is_some())
            + u64::from(scan.before.is_some())
            + scan.range.as_ref().map_or(0, |r| {
                [&r.gt, &r.gte, &r.lt, &r.lte]
                    .into_iter()
                    .filter(|b| b.is_some())
                    .count() as u64
            });
        let references = read
            .take
            .saturating_mul(declared_identity_max(schema, &scan.table).saturating_add(1))
            + reference_bytes(schema, &scan.table);
        let bytes = (crate::value::canonical_json(&skeleton).len() as u64
            + prefix
            + suffix.saturating_mul(bounds + 1)
            + references)
            .saturating_mul(read.max_calls);
        metadata = metadata.saturating_add(bytes);
        children.push(ByteShape::leaf(
            bytes,
            format!(
                "{} × {} ranges: source descriptor, suffix bounds, row/halo references",
                scan.site, read.max_calls
            ),
        ));
        let probes = read
            .max_calls
            .saturating_mul(if read.hoist { 1 } else { read.take + 2 })
            .saturating_mul(read.rule_probes_per_candidate);
        let mut targets = BTreeSet::new();
        rule_targets(schema, &table.rules.read, &mut targets);
        if targets
            .iter()
            .any(|(table, _)| declared_serialized_row_max(schema, table) == u64::MAX)
        {
            return Some(ByteShape::leaf(
                u64::MAX,
                "unbounded maintained reference domain",
            ));
        }
        let widest = targets
            .iter()
            .filter_map(|(t, i)| {
                schema.table(t)?.index(i)?.scalar_columns().map(|cols| {
                    cols.iter()
                        .map(|n| declared_column_value_max(schema, t, n).unwrap_or(0))
                        .sum::<u64>()
                        + reference_bytes(schema, t)
                        + crate::value::canonical_json(i).len() as u64
                        + 64
                })
            })
            .max()
            .unwrap_or(0);
        // Rule verdict/absence envelopes; duplicate wire bytes remain priced even
        // though matching immutable row images share storage in both internal pools.
        let authority = probes.saturating_mul(widest.max(320));
        metadata = metadata.saturating_add(authority);
        children.push(ByteShape::leaf(authority,
            format!("{} × {probes} probes: separately serialized rule verdict/absence envelopes", scan.site)));
        if !covered_rules.contains(&scan.site) {
            for (t, _) in targets {
                *pools.entry(t).or_default() += probes;
            }
        }
    }
    // Point reads/enrichment are separate custody, even when their rows are not
    // returned. Price their actual declared names and transitive authority too.
    let scan_sites: BTreeSet<_> = scans.iter().map(|scan| scan.site.as_str()).collect();
    for read in reads
        .values()
        .filter(|r| !scan_sites.contains(r.site.as_str()))
    {
        *pools.entry(read.table.clone()).or_default() += read.max_calls;
        let Some(table) = schema.table(&read.table) else {
            continue;
        };
        let key = table
            .index(&read.index)
            .and_then(|i| i.scalar_columns())
            .map_or(0, |cols| {
                cols.iter()
                    .map(|n| declared_column_value_max(schema, &read.table, n).unwrap_or(0))
                    .sum::<u64>()
            });
        let point = read.max_calls.saturating_mul(key + reference_bytes(schema, &read.table) + 512);
        metadata = metadata.saturating_add(point);
        children.push(ByteShape::leaf(point,
            format!("{} × {} point reads: separately serialized keys, references and envelopes", read.site, read.max_calls)));
        let probes = read
            .max_calls
            .saturating_mul(read.rule_probes_per_candidate);
        let mut targets = BTreeSet::new();
        rule_targets(schema, &table.rules.read, &mut targets);
        for (target, index) in targets {
            if declared_serialized_row_max(schema, &target) == u64::MAX {
                return Some(ByteShape::leaf(
                    u64::MAX,
                    "unbounded maintained reference domain",
                ));
            }
            let width = schema
                .table(&target)
                .and_then(|t| {
                    t.index(&index)
                        .and_then(|i| i.scalar_columns())
                        .map(|cols| {
                            cols.iter()
                                .map(|n| declared_column_value_max(schema, &target, n).unwrap_or(0))
                                .sum::<u64>()
                        })
                })
                .unwrap_or(0);
            let authority = probes.saturating_mul(width + reference_bytes(schema, &target) + 512);
            metadata = metadata.saturating_add(authority);
            children.push(ByteShape::leaf(authority,
                format!("{} × {probes} probes on {target}: separately serialized authority envelopes", read.site)));
            *pools.entry(target).or_default() += probes;
        }
    }
    for (table, count) in pools {
        let row = declared_serialized_row_max(schema, &table);
        let envelope = reference_bytes(schema, &table) + 8;
        let bytes = count.saturating_mul(row + envelope);
        metadata = metadata.saturating_add(bytes);
        children.push(ByteShape::repeated(
            bytes,
            format!("{count} pooled {table} first images with table/id envelopes"),
            count,
            ByteShape::group(row + envelope, format!("{table} first-image custody"), vec![
                row_shape(schema, &table),
                ByteShape::leaf(envelope, format!("{table} table/id envelope")),
            ]),
        ));
    }
    let args = program
        .args
        .iter()
        .map(|(n, t)| {
            crate::value::canonical_json(n).len() as u64
                + crate::retention::argument_max(schema, t)
                + 2
        })
        .sum::<u64>();
    // Exact top-level shape plus schema hash, and issuing args retained by the operation.
    let root = crate::value::canonical_json(&crate::engine::ClosureReceipt::default()).len() as u64
        + 66
        + args;
    children.push(ByteShape::leaf(root, "closure root, schema hash and retained issuing arguments"));
    Some(ByteShape::group(
        metadata.saturating_add(root),
        if search {
            "search closure: whole row pool and actual issuing metadata"
        } else {
            "maintained-address closure: whole row pool and actual issuing metadata"
        },
        children,
    ))
}
fn reference_bytes(schema: &Schema, table: &str) -> u64 {
    (crate::value::canonical_json(&table).len() as u64)
        .saturating_add(declared_identity_max(schema, table))
        .saturating_add(20)
}
fn rule_targets(schema: &Schema, rule: &RuleExpr, out: &mut BTreeSet<(String, String)>) {
    match rule {
        RuleExpr::Exists { table, index, .. } => {
            if out.insert((table.clone(), index.clone())) {
                if let Some(target) = schema.table(table) {
                    rule_targets(schema, &target.rules.read, out);
                }
            }
        }
        RuleExpr::And(v) | RuleExpr::Or(v) => {
            for r in v {
                rule_targets(schema, r, out)
            }
        }
        RuleExpr::Not(r) => rule_targets(schema, r, out),
        _ => {}
    }
}

// @ref LLP 1001#maintained-addresses — reduction does not release receipt custody.
// Only programs consuming an expanded domain need this additional ordinary-read pricing.
fn consumes_maintained_domain(
    schema: &Schema,
    program: &Program,
    reads: &BTreeMap<String, ReadSite>,
) -> bool {
    let ordinary = Schema::default();
    if program.args.values().any(|arg| {
        crate::retention::argument_max(schema, arg) > crate::retention::argument_max(&ordinary, arg)
    }) {
        return true;
    }
    let mut targets = BTreeSet::new();
    for read in reads.values() {
        targets.insert((read.table.clone(), read.index.clone()));
        if let Some(table) = schema.table(&read.table) {
            rule_targets(schema, &table.rules.read, &mut targets);
        }
    }
    targets.iter().any(|(name, _)| {
        schema.table(name).is_some_and(|table| {
            table.columns.iter().any(|(column, kind)| {
                declared_column_value_max(schema, name, column).unwrap_or(0)
                    > crate::bounds::declared_column_max(kind)
            })
        })
    })
}
