//! Structural IR helpers for derived authorization successor probes.

use serde_json::Value as Json;
use snapback2_core::search_key::IndexKeyExpr;
use snapback2_core::{
    Ceilings, Expr, Generation, LoopDomain, Program, ProjectJson, RuleExpr, Scan, Stmt,
};
use snapback2_core::{Schema, Table};
use std::collections::{BTreeMap, BTreeSet};

// @ref LLP 1002#templates-are-products — retained metadata must have proved
// carrier provenance; shape alone cannot distinguish a field from a disclosure.
#[derive(Clone)]
enum Origin {
    Unknown,
    CarrierPage(String),
    CarrierRow(String),
    CarrierField,
    ProtectedRow,
    Empty,
    Projection(BTreeMap<String, bool>),
    ProjectedPage(BTreeMap<String, bool>),
}

fn origin(
    value: &Expr,
    vars: &BTreeMap<String, Origin>,
    schema: &Schema,
    protected: &str,
) -> Origin {
    match value {
        Expr::Variable(name) => vars.get(name).cloned().unwrap_or(Origin::Unknown),
        Expr::Scan(scan)
            if scan.table != protected
                && schema
                    .tables
                    .get(&scan.table)
                    .is_some_and(|table| table.tombstones.iter().any(|t| t.table == protected)) =>
        {
            Origin::CarrierPage(scan.table.clone())
        }
        Expr::Field { base, name } => match origin(base, vars, schema, protected) {
            Origin::CarrierRow(table) if schema.tables[&table].columns.contains_key(name) => {
                Origin::CarrierField
            }
            _ => Origin::Unknown,
        },
        Expr::Get(read) if read.table == protected => Origin::ProtectedRow,
        Expr::Array(values) if values.is_empty() => Origin::Empty,
        Expr::Object(fields) => {
            let mut projection = BTreeMap::new();
            for (key, value) in fields {
                let protected = match origin(value, vars, schema, protected) {
                    Origin::CarrierField => false,
                    Origin::ProtectedRow => true,
                    _ => return Origin::Unknown,
                };
                projection.insert(key.clone(), protected);
            }
            Origin::Projection(projection)
        }
        _ => Origin::Unknown,
    }
}

// This intentionally recognizes only a straight-line carrier page projection.
// Unknown scalars, arrays, nested objects, control flow and aliased accumulators
// are ineligible, including values derived from a protected row's fields.
pub(super) fn policy_projection(
    program: &Program,
    schema: &Schema,
    protected: &str,
) -> Result<BTreeMap<String, bool>, String> {
    let unsupported = || {
        "policy probe needs a page of proved carrier fields and complete protected rows".to_owned()
    };
    let mut vars = BTreeMap::new();
    let mut accumulator = None;
    for statement in &program.body {
        match statement {
            Stmt::Const { name, value } | Stmt::Let { name, value } => {
                let value = origin(value, &vars, schema, protected);
                // An empty-array alias shares identity at runtime. Restrict its
                // creation to a literal so a later push cannot bypass the proof.
                if matches!(value, Origin::Empty) {
                    if !matches!(
                        statement,
                        Stmt::Const {
                            value: Expr::Array(_),
                            ..
                        } | Stmt::Let {
                            value: Expr::Array(_),
                            ..
                        }
                    ) || accumulator.is_some()
                    {
                        return Err(unsupported());
                    }
                    accumulator = Some(name.clone());
                }
                if vars.insert(name.clone(), value).is_some() {
                    return Err(unsupported());
                }
            }
            Stmt::Require { .. } => {}
            Stmt::For {
                binding,
                domain: LoopDomain::DerivedArray { value, .. },
                body,
            } => {
                let Origin::CarrierPage(table) = origin(value, &vars, schema, protected) else {
                    return Err(unsupported());
                };
                let mut local = vars.clone();
                if local
                    .insert(binding.clone(), Origin::CarrierRow(table))
                    .is_some()
                {
                    return Err(unsupported());
                }
                let mut pushed = false;
                for statement in body {
                    match statement {
                        Stmt::Const { name, value } => {
                            let value = origin(value, &local, schema, protected);
                            if local.insert(name.clone(), value).is_some() {
                                return Err(unsupported());
                            }
                        }
                        Stmt::Push { target, value }
                            if !pushed
                                && accumulator.as_ref() == Some(target)
                                && matches!(vars.get(target), Some(Origin::Empty)) =>
                        {
                            let Origin::Projection(fields) =
                                origin(value, &local, schema, protected)
                            else {
                                return Err(unsupported());
                            };
                            if !fields.values().any(|protected| *protected) {
                                return Err(unsupported());
                            }
                            vars.insert(target.clone(), Origin::ProjectedPage(fields));
                            pushed = true;
                        }
                        _ => return Err(unsupported()),
                    }
                }
                if !pushed {
                    return Err(unsupported());
                }
            }
            Stmt::Return(value) => {
                return match origin(value, &vars, schema, protected) {
                    Origin::ProjectedPage(fields) => Ok(fields),
                    _ => Err(unsupported()),
                };
            }
            _ => return Err(unsupported()),
        }
    }
    Err(unsupported())
}

pub(super) fn projected_policy_data(
    data: &Json,
    projection: &BTreeMap<String, bool>,
    table: &Table,
) -> Result<Json, String> {
    let Some(rows) = data.as_array() else {
        return Err("protected projection is not a page".into());
    };
    let mut expected = rows.clone();
    let mut found = false;
    for row in &mut expected {
        let Some(fields) = row.as_object_mut() else {
            return Err("protected projection row is not an object".into());
        };
        if fields.len() != projection.len()
            || !fields.keys().all(|key| projection.contains_key(key))
        {
            return Err("protected projection differs from its proved IR fields".into());
        }
        for (key, protected) in projection {
            if !protected {
                continue;
            }
            let value = fields.get_mut(key).unwrap();
            if value.is_null() {
                continue;
            }
            let Some(image) = value.as_object() else {
                return Err("protected projection is not a complete row".into());
            };
            if image.len() != table.columns.len()
                || !table.columns.keys().all(|key| image.contains_key(key))
            {
                return Err("protected projection contains an unrecognized row image".into());
            }
            *value = Json::Null;
            found = true;
        }
    }
    if !found {
        return Err("protected projection has no visible complete row image".into());
    }
    Ok(Json::Array(expected))
}

pub(super) struct PolicyCounts {
    pub rows: usize,
    pub protected_images: usize,
    pub nulled_images: usize,
}

pub(super) fn require_policy_filtered(
    delivery: &Json,
    subject: &str,
    expected: &Json,
    projection: &BTreeMap<String, bool>,
) -> Result<PolicyCounts, String> {
    if delivery["state"] != "complete" {
        return Err(format!(
            "{subject} did not resolve through the replacement table policy: {delivery}"
        ));
    }
    if delivery.get("data") != Some(expected) {
        return Err(format!(
            "{subject} did not preserve proved carrier metadata and redact protected images: {delivery}"
        ));
    }
    let rows = delivery["data"]
        .as_array()
        .ok_or_else(|| format!("{subject} omitted its policy page"))?;
    let mut counts = PolicyCounts {
        rows: rows.len(),
        protected_images: 0,
        nulled_images: 0,
    };
    for row in rows {
        for (key, protected) in projection {
            if *protected {
                if row[key].is_null() {
                    counts.nulled_images += 1;
                } else {
                    counts.protected_images += 1;
                }
            }
        }
    }
    Ok(counts)
}

pub(super) struct PreparedPolicySuccessor {
    pub project: ProjectJson,
    pub retired_held_search: usize,
    pub stale_held_search_refused: bool,
}

pub(super) fn prepare_policy_successor(
    base: &ProjectJson,
    protected_table: &str,
) -> Result<PreparedPolicySuccessor, String> {
    let mut project = base.clone();
    project
        .schema
        .tables
        .get_mut(protected_table)
        .ok_or_else(|| format!("protected table {protected_table} disappeared"))?
        .rules
        .read = RuleExpr::Deny;

    // The deliberately stale clone is the negative witness: a replacement
    // rule may invalidate compiler-derived held-search eligibility.
    let stale_held_search_refused = Generation::certify(&project, Ceilings::default())
        .is_err_and(|errors| {
            errors.iter().any(|(_, error)| {
                error.code == "E_ARGS_TYPE"
                    && error.message
                        == "held_search does not exactly match canonical authorization discovery and the actual merge"
            })
        });
    let retired_held_search = retire_held_search_for_table(&mut project, protected_table);
    if retired_held_search > 0 && !stale_held_search_refused {
        return Err(format!(
            "stale held-search descriptor for {protected_table} was not refused"
        ));
    }
    Generation::certify(&project, Ceilings::default())
        .map_err(|errors| format!("policy successor did not certify: {errors:?}"))?;
    Ok(PreparedPolicySuccessor {
        project,
        retired_held_search,
        stale_held_search_refused,
    })
}

pub(super) fn program_has_membership_guard_dependency(
    program: &Program,
    membership_table: &str,
    membership_index: &str,
) -> bool {
    let mut membership_values = BTreeSet::new();
    for statement in &program.body {
        match statement {
            Stmt::Const { name, value }
            | Stmt::Let { name, value }
            | Stmt::Assign { name, value } => {
                if expression_depends_on_membership(
                    value,
                    membership_table,
                    membership_index,
                    &membership_values,
                ) {
                    membership_values.insert(name.clone());
                } else {
                    membership_values.remove(name);
                }
            }
            Stmt::Require { condition, .. }
                if expression_depends_on_membership(
                    condition,
                    membership_table,
                    membership_index,
                    &membership_values,
                ) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn expression_depends_on_membership(
    expression: &Expr,
    membership_table: &str,
    membership_index: &str,
    membership_values: &BTreeSet<String>,
) -> bool {
    match expression {
        Expr::Variable(name) => membership_values.contains(name),
        Expr::Get(read) | Expr::Exists(read) => {
            read.table == membership_table && read.index == membership_index
        }
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => {
            expression_depends_on_membership(
                base,
                membership_table,
                membership_index,
                membership_values,
            )
        }
        Expr::Binary { left, right, .. } => {
            expression_depends_on_membership(
                left,
                membership_table,
                membership_index,
                membership_values,
            ) || expression_depends_on_membership(
                right,
                membership_table,
                membership_index,
                membership_values,
            )
        }
        Expr::Builtin { args, .. } | Expr::Array(args) => args.iter().any(|argument| {
            expression_depends_on_membership(
                argument,
                membership_table,
                membership_index,
                membership_values,
            )
        }),
        Expr::Object(fields) => fields.values().any(|value| {
            expression_depends_on_membership(
                value,
                membership_table,
                membership_index,
                membership_values,
            )
        }),
        Expr::Literal(_) | Expr::Input(_) | Expr::Scan(_) | Expr::Merge(_) => false,
    }
}

fn retire_held_search_for_table(project: &mut ProjectJson, table: &str) -> usize {
    let mut retired = 0;
    for program in &mut project.programs {
        visit_statements(&mut program.body, table, &mut retired);
    }
    retired
}

fn visit_statements(statements: &mut [Stmt], table: &str, retired: &mut usize) {
    for statement in statements {
        match statement {
            Stmt::Const { value, .. }
            | Stmt::Let { value, .. }
            | Stmt::Assign { value, .. }
            | Stmt::Push { value, .. }
            | Stmt::Return(value)
            | Stmt::Require {
                condition: value, ..
            }
            | Stmt::Insert { row: value, .. }
            | Stmt::Delete { key: value, .. }
            | Stmt::Emit { payload: value, .. } => visit_expr(value, table, retired),
            Stmt::Update { key, patch, .. } => {
                visit_expr(key, table, retired);
                visit_expr(patch, table, retired);
            }
            Stmt::Upsert { key, row, .. } => {
                visit_expr(key, table, retired);
                visit_expr(row, table, retired);
            }
            Stmt::If {
                condition,
                then_body,
                else_body,
            } => {
                visit_expr(condition, table, retired);
                visit_statements(then_body, table, retired);
                visit_statements(else_body, table, retired);
            }
            Stmt::For { domain, body, .. } => {
                match domain {
                    LoopDomain::Page(scan) => visit_scan(scan, table, retired),
                    LoopDomain::DerivedArray { value, .. } => visit_expr(value, table, retired),
                    LoopDomain::Recurse(recurse) => visit_expr(&mut recurse.seed, table, retired),
                    LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => {}
                }
                visit_statements(body, table, retired);
            }
            Stmt::Break | Stmt::Continue => {}
        }
    }
}

fn visit_expr(expression: &mut Expr, table: &str, retired: &mut usize) {
    match expression {
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => {
            visit_expr(base, table, retired)
        }
        Expr::Binary { left, right, .. } => {
            visit_expr(left, table, retired);
            visit_expr(right, table, retired);
        }
        Expr::Array(values) | Expr::Builtin { args: values, .. } => {
            values
                .iter_mut()
                .for_each(|value| visit_expr(value, table, retired));
        }
        Expr::Object(values) => values
            .values_mut()
            .for_each(|value| visit_expr(value, table, retired)),
        Expr::Get(read) | Expr::Exists(read) => read
            .key
            .iter_mut()
            .for_each(|value| visit_expr(value, table, retired)),
        Expr::Scan(scan) => visit_scan(scan, table, retired),
        Expr::Merge(merge) => {
            if merge
                .held_search
                .as_ref()
                .is_some_and(|held| held.table == table)
            {
                merge.held_search = None;
                *retired += 1;
            }
            for lane in &mut merge.lanes {
                visit_statements(&mut lane.setup, table, retired);
                visit_scan(&mut lane.scan, table, retired);
                if let Some(source) = &mut lane.source {
                    visit_scan(source, table, retired);
                }
            }
        }
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
    }
}

fn visit_scan(scan: &mut Scan, table: &str, retired: &mut usize) {
    for prefix in &mut scan.prefix {
        match prefix {
            IndexKeyExpr::Scalar(value) | IndexKeyExpr::WordPrefix { source: value, .. } => {
                visit_expr(value, table, retired)
            }
        }
    }
    [scan.after.as_deref_mut(), scan.before.as_deref_mut()]
        .into_iter()
        .flatten()
        .for_each(|value| visit_expr(value, table, retired));
    if let Some(range) = &mut scan.range {
        [
            range.gt.as_deref_mut(),
            range.gte.as_deref_mut(),
            range.lt.as_deref_mut(),
            range.lte.as_deref_mut(),
        ]
        .into_iter()
        .flatten()
        .for_each(|value| visit_expr(value, table, retired));
    }
}
