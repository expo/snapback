//! Static table/index intersections used by the served invalidation probes.

use snapback2_core::{Certificate, Generation, RuleExpr};
use std::collections::BTreeSet;

pub(super) fn certificate_site_intersection(
    query: &Certificate,
    mutation: &Certificate,
    generation: &Generation,
) -> BTreeSet<(String, String)> {
    let mut reads = query
        .read_sites
        .iter()
        .map(|site| (site.table.clone(), site.index.clone()))
        .collect::<BTreeSet<_>>();
    for site in &query.read_sites {
        if let Some(table) = generation.schema.tables.get(&site.table) {
            collect_rule_reads(&table.rules.read, &mut reads);
        }
    }
    let writes = mutation
        .write_sites
        .iter()
        .flat_map(|site| {
            generation
                .schema
                .tables
                .get(&site.table)
                .into_iter()
                .flat_map(move |table| {
                    table
                        .indexes
                        .keys()
                        .cloned()
                        .map(move |index| (site.table.clone(), index))
                })
        })
        .collect::<BTreeSet<_>>();
    reads.intersection(&writes).cloned().collect()
}

fn collect_rule_reads(rule: &RuleExpr, reads: &mut BTreeSet<(String, String)>) {
    match rule {
        RuleExpr::Exists { table, index, .. } => {
            reads.insert((table.clone(), index.clone()));
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => {
            for rule in rules {
                collect_rule_reads(rule, reads);
            }
        }
        RuleExpr::Not(rule) => collect_rule_reads(rule, reads),
        RuleExpr::Public { .. }
        | RuleExpr::Allow
        | RuleExpr::Deny
        | RuleExpr::Eq(_, _)
        | RuleExpr::Ne(_, _) => {}
    }
}
