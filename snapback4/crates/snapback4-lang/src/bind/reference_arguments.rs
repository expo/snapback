//! A table-typed argument is an id with a stronger name. Storing it in a
//! reference column still does not prove that the target row exists.

use super::catalog::Catalog;
use crate::{
    ast::{Expr, FunctionBody, ProgramKind, ReadExpr, Stmt, TypeKind, WriteOp},
    diag::{Diagnostic, Site},
};
use snapback4_core::schema::{Constraint, RuleExpr, RuleTerm, Schema};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone)]
struct Candidate {
    argument: String,
    target: String,
    child: String,
    column: String,
    op: WriteOp,
    site: Site,
    checked: bool,
}

#[derive(Clone)]
struct Flow {
    /// Arguments whose name still denotes the mutation input, rather than a
    /// later binding with the same spelling.
    inputs: BTreeSet<String>,
    checked: BTreeSet<String>,
}

/// Name a likely missing existence check. Known helpers count only when their
/// body actually looks up the argument; passing an id through does not.
// @ref LLP 3000.039#7 — reference types validate id shape, never target
// existence; `N_REFERENCE_UNCHECKED` points to the explicit lookup form.
pub(super) fn notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for doc in &catalog.documents {
        for program in doc
            .programs
            .iter()
            .filter(|program| program.kind == ProgramKind::Mutation && !program.native)
        {
            let arguments: BTreeMap<String, String> = program
                .args
                .iter()
                .filter_map(|arg| match &arg.type_.kind {
                    TypeKind::Ref { table } => Some((arg.name.clone(), table.clone())),
                    _ => None,
                })
                .collect();
            if arguments.is_empty() {
                continue;
            }

            let mut candidates = Vec::new();
            let flow = Flow {
                inputs: arguments.keys().cloned().collect(),
                checked: BTreeSet::new(),
            };
            let body: Vec<_> = program
                .prelude
                .iter()
                .chain(&program.body)
                .cloned()
                .collect();
            flow_statements(catalog, schema, &arguments, &body, flow, &mut candidates);

            let mut emitted = BTreeSet::new();
            for candidate in candidates {
                if candidate.checked
                    || write_contract_checks(schema, &candidate)
                    || !emitted.insert(candidate.argument.clone())
                {
                    continue;
                }
                notes.push(Diagnostic::new(&candidate.site, "N_REFERENCE_UNCHECKED",
                    format!("mutation {} stores argument {} directly in {}.{}, but never looks up {}[{}]: a reference accepts any well-formed id even when the row is absent", program.name, candidate.argument, candidate.child, candidate.column, candidate.target, candidate.argument),
                    format!("bind `parent = {}[{}] ! else NOT_FOUND` before the write, then store `parent.id`; keep the direct id only when dangling references are intentional", candidate.target, candidate.argument)).guide("types"));
            }
        }
    }
    notes
}

/// Follow only paths that can reach a write. A lookup fact joins by
/// intersection, so one conditional arm, a short-circuited operand, or a
/// possibly-empty loop can never authorize a later candidate.
fn flow_statements(
    catalog: &Catalog,
    schema: &Schema,
    arguments: &BTreeMap<String, String>,
    body: &[Stmt],
    mut flow: Flow,
    candidates: &mut Vec<Candidate>,
) -> Option<Flow> {
    for statement in body {
        match statement {
            Stmt::Bind { names, value, .. } => {
                flow_expression(catalog, schema, arguments, value, &mut flow, candidates);
                for name in names {
                    flow.inputs.remove(name);
                    flow.checked.remove(name);
                }
            }
            Stmt::Expr { value, .. } => {
                flow_expression(catalog, schema, arguments, value, &mut flow, candidates)
            }
            Stmt::Require { condition, .. } => {
                let (admitted, _) =
                    flow_condition(catalog, schema, arguments, condition, flow, candidates);
                flow = admitted;
            }
            Stmt::Return { value, .. } => {
                flow_expression(catalog, schema, arguments, value, &mut flow, candidates);
                return None;
            }
            Stmt::Emit { payload, once, .. } => {
                flow_expression(catalog, schema, arguments, payload, &mut flow, candidates);
                if let Some(once) = once {
                    flow_expression(catalog, schema, arguments, once, &mut flow, candidates);
                }
            }
            Stmt::If {
                condition,
                then_body,
                else_body,
                ..
            } => {
                let (then_entry, else_entry) =
                    flow_condition(catalog, schema, arguments, condition, flow, candidates);
                let then_flow = flow_statements(
                    catalog,
                    schema,
                    arguments,
                    then_body,
                    then_entry,
                    candidates,
                );
                let else_flow = flow_statements(
                    catalog,
                    schema,
                    arguments,
                    else_body,
                    else_entry,
                    candidates,
                );
                flow = join_flows(then_flow, else_flow)?;
            }
            Stmt::For {
                name, domain, body, ..
            } => {
                flow_expression(catalog, schema, arguments, domain, &mut flow, candidates);
                let mut iteration = flow.clone();
                iteration.inputs.remove(name);
                iteration.checked.remove(name);
                let _ = flow_statements(catalog, schema, arguments, body, iteration, candidates);
                // The domain may be empty, so body facts are never carried out.
            }
            Stmt::As {
                principal, body, ..
            } => {
                flow_expression(catalog, schema, arguments, principal, &mut flow, candidates);
                flow = flow_statements(catalog, schema, arguments, body, flow, candidates)?;
            }
            Stmt::Break { .. } | Stmt::Continue { .. } => return None,
        }
    }
    Some(flow)
}

fn join_flows(left: Option<Flow>, right: Option<Flow>) -> Option<Flow> {
    match (left, right) {
        (Some(mut left), Some(right)) => {
            left.inputs.retain(|name| right.inputs.contains(name));
            left.checked.retain(|name| right.checked.contains(name));
            Some(left)
        }
        (Some(flow), None) | (None, Some(flow)) => Some(flow),
        (None, None) => None,
    }
}

fn flow_expression(
    catalog: &Catalog,
    schema: &Schema,
    arguments: &BTreeMap<String, String>,
    expression: &Expr,
    flow: &mut Flow,
    candidates: &mut Vec<Candidate>,
) {
    let child = |value: &Expr, flow: &mut Flow, candidates: &mut Vec<Candidate>| {
        flow_expression(catalog, schema, arguments, value, flow, candidates)
    };
    match expression {
        Expr::Read(read) | Expr::Exists { read, .. } => {
            flow_read(catalog, schema, arguments, read, flow, candidates);
            for (name, target) in arguments {
                if flow.inputs.contains(name)
                    && target == &read.table
                    && read_checks_target_id(schema, read, name, target)
                {
                    flow.checked.insert(name.clone());
                }
            }
        }
        Expr::Created { read, .. } => flow_read(catalog, schema, arguments, read, flow, candidates),
        Expr::Unary { value, .. }
        | Expr::Member { base: value, .. }
        | Expr::Assert { value, .. }
        | Expr::ShapeUse { base: value, .. }
        | Expr::Walk { seed: value, .. } => child(value, flow, candidates),
        Expr::Binary { op, left, right, .. }
            if matches!(op.as_str(), "and" | "or" | "??") => {
            child(left, flow, candidates);
            if lazy_right_must_run(op, left) {
                child(right, flow, candidates);
            } else {
                flow_conditional_expression(catalog, schema, arguments, right, flow, candidates);
            }
        }
        Expr::Binary { left, right, .. } => {
            child(left, flow, candidates);
            child(right, flow, candidates);
        }
        Expr::Array { items, .. } => {
            for value in items {
                child(value, flow, candidates);
            }
        }
        Expr::Call { name, args, .. } => {
            for value in args {
                child(value, flow, candidates);
            }
            for (position, argument) in args.iter().enumerate() {
                let Expr::Name { name: argument, .. } = argument else {
                    continue;
                };
                let Some(target) = arguments
                    .get(argument)
                    .filter(|_| flow.inputs.contains(argument))
                else {
                    continue;
                };
                if helper_looks_up(
                    catalog,
                    schema,
                    name,
                    position,
                    target,
                    &mut BTreeSet::new(),
                ) {
                    flow.checked.insert(argument.clone());
                }
            }
        }
        Expr::Object { fields, .. } => {
            for value in fields.iter().filter_map(|field| field.value.as_ref()) {
                child(value, flow, candidates);
            }
        }
        Expr::Shape { base, fields, .. } => {
            child(base, flow, candidates);
            for field in fields {
                if let crate::ast::ShapeField::Field { value, .. } = field {
                    flow_conditional_expression(catalog, schema, arguments, value, flow, candidates);
                }
            }
        }
        Expr::If {
            condition,
            then,
            otherwise,
            ..
        } => {
            let (mut then_flow, mut else_flow) = flow_condition(
                catalog,
                schema,
                arguments,
                condition,
                flow.clone(),
                candidates,
            );
            child(then, &mut then_flow, candidates);
            child(otherwise, &mut else_flow, candidates);
            *flow = join_flows(Some(then_flow), Some(else_flow)).unwrap();
        }
        Expr::Write {
            op,
            table,
            keys,
            fields,
            condition,
            site,
            ..
        } => {
            for key in keys {
                child(&key.value, flow, candidates);
            }
            for value in fields.iter().filter_map(|field| field.value.as_ref()) {
                child(value, flow, candidates);
            }
            if let Some(condition) = condition {
                child(condition, flow, candidates);
            }
            record_write(
                catalog, arguments, flow, *op, table, fields, site, candidates,
            );
        }
        Expr::Merge(merge) => {
            if let Some(value) = &merge.matching {
                child(value, flow, candidates);
            }
            if let Some(value) = &merge.filter {
                flow_conditional_expression(catalog, schema, arguments, value, flow, candidates);
            }
            if let Some(value) = &merge.cursor {
                child(value, flow, candidates);
            }
            for lane in &merge.lanes {
                for value in &lane.prefix {
                    child(value, flow, candidates);
                }
                if let Some(value) = &lane.distinct {
                    flow_conditional_expression(catalog, schema, arguments, value, flow, candidates);
                }
                if let Some((_, value)) = &lane.loop_ {
                    child(value, flow, candidates);
                }
                if let Some(value) = &lane.admission {
                    flow_conditional_expression(catalog, schema, arguments, value, flow, candidates);
                }
                if let Some(fields) = &lane.project {
                    for field in fields {
                        if let crate::ast::ShapeField::Field { value, .. } = field {
                            flow_conditional_expression(catalog, schema, arguments, value, flow, candidates);
                        }
                    }
                }
                if let Some(read) = &lane.planned {
                    flow_conditional_read(catalog, schema, arguments, read, flow, candidates);
                }
                if let Some((_, read)) = &lane.nulls {
                    flow_conditional_read(catalog, schema, arguments, read, flow, candidates);
                }
            }
        }
        Expr::Name { .. } | Expr::Focal { .. } | Expr::Literal { .. } => {}
    }
}

/// Facts on boolean edges. This preserves the useful distinction between
/// `require ready and checked(parent)` (the check is mandatory on the true
/// edge) and `require ready or checked(parent)` (it can still be skipped).
fn flow_condition(
    catalog: &Catalog,
    schema: &Schema,
    arguments: &BTreeMap<String, String>,
    expression: &Expr,
    flow: Flow,
    candidates: &mut Vec<Candidate>,
) -> (Flow, Flow) {
    match expression {
        Expr::Unary { op, value, .. } if op == "not" => {
            let (yes, no) =
                flow_condition(catalog, schema, arguments, value, flow, candidates);
            (no, yes)
        }
        Expr::Binary {
            op, left, right, ..
        } if op == "and" => {
            let (left_yes, left_no) =
                flow_condition(catalog, schema, arguments, left, flow, candidates);
            let (right_yes, right_no) =
                flow_condition(catalog, schema, arguments, right, left_yes, candidates);
            (
                right_yes,
                join_flows(Some(left_no), Some(right_no)).unwrap(),
            )
        }
        Expr::Binary {
            op, left, right, ..
        } if op == "or" => {
            let (left_yes, left_no) =
                flow_condition(catalog, schema, arguments, left, flow, candidates);
            let (right_yes, right_no) =
                flow_condition(catalog, schema, arguments, right, left_no, candidates);
            (
                join_flows(Some(left_yes), Some(right_yes)).unwrap(),
                right_no,
            )
        }
        // @ref LLP 3000.036.002#7 — storing null needs no target lookup;
        // intersect that edge with the checked non-null edge after the if.
        Expr::Binary { op, left, right, .. } if op == "=" || op == "!=" => {
            let mut evaluated = flow;
            flow_expression(catalog, schema, arguments, expression, &mut evaluated, candidates);
            let mut yes = evaluated.clone();
            let mut no = evaluated;
            let name = match (left.as_ref(), right.as_ref()) {
                (Expr::Name { name, .. }, Expr::Literal { value: crate::ast::Literal::Null, .. })
                | (Expr::Literal { value: crate::ast::Literal::Null, .. }, Expr::Name { name, .. }) => Some(name),
                _ => None,
            };
            if let Some(name) = name.filter(|name| yes.inputs.contains(*name)) {
                if op == "=" { yes.checked.insert(name.clone()); }
                else { no.checked.insert(name.clone()); }
            }
            (yes, no)
        }
        _ => {
            let mut evaluated = flow;
            flow_expression(
                catalog,
                schema,
                arguments,
                expression,
                &mut evaluated,
                candidates,
            );
            (evaluated.clone(), evaluated)
        }
    }
}

fn flow_read(
    catalog: &Catalog,
    schema: &Schema,
    arguments: &BTreeMap<String, String>,
    read: &ReadExpr,
    flow: &mut Flow,
    candidates: &mut Vec<Candidate>,
) {
    for value in read.computed.values() {
        flow_conditional_expression(catalog, schema, arguments, value, flow, candidates);
    }
    for key in &read.keys {
        flow_expression(catalog, schema, arguments, &key.value, flow, candidates);
    }
    for seek in &read.seeks {
        flow_expression(catalog, schema, arguments, &seek.value, flow, candidates);
    }
    if let Some(value) = &read.filter {
        flow_conditional_expression(catalog, schema, arguments, value, flow, candidates);
    }
    if let Some(range) = &read.range
        && let Some(value) = &range.cursor
    {
        flow_expression(catalog, schema, arguments, value, flow, candidates);
    }
    if let Some(value) = &read.matching {
        flow_expression(catalog, schema, arguments, value, flow, candidates);
    }
}

/// A row mapper runs only after a live, readable source row exists. Traverse it
/// to diagnose writes inside the expression, but never carry facts to code
/// after a scan that may be empty or wholly hidden.
fn flow_conditional_expression(catalog: &Catalog, schema: &Schema, arguments: &BTreeMap<String, String>, expression: &Expr, flow: &Flow, candidates: &mut Vec<Candidate>) {
    let mut conditional = flow.clone();
    flow_expression(catalog, schema, arguments, expression, &mut conditional, candidates);
}

fn flow_conditional_read(catalog: &Catalog, schema: &Schema, arguments: &BTreeMap<String, String>, read: &ReadExpr, flow: &Flow, candidates: &mut Vec<Candidate>) {
    let mut conditional = flow.clone();
    flow_read(catalog, schema, arguments, read, &mut conditional, candidates);
}

fn record_write(
    catalog: &Catalog,
    arguments: &BTreeMap<String, String>,
    flow: &Flow,
    op: WriteOp,
    table: &str,
    fields: &[crate::ast::ObjectField],
    site: &Site,
    candidates: &mut Vec<Candidate>,
) {
    if op == WriteOp::Delete {
        return;
    }
    let Some(child) = catalog.tables.get(table) else {
        return;
    };
    for field in fields {
        let Some(kind) = child.columns.get(&field.name) else {
            continue;
        };
        let TypeKind::Ref { table: target } = &kind.kind else {
            continue;
        };
        let argument = match &field.value {
            Some(Expr::Name { name, .. }) => name,
            None => &field.name,
            _ => continue,
        };
        if !flow.inputs.contains(argument) || arguments.get(argument) != Some(target) {
            continue;
        }
        candidates.push(Candidate {
            argument: argument.clone(),
            target: target.clone(),
            child: table.to_owned(),
            column: field.name.clone(),
            op,
            site: site.clone(),
            checked: flow.checked.contains(argument),
        });
    }
}

/// Inline one reference-valued helper parameter symbolically. Recursion proves
/// nothing by itself, and every successful path must perform the lookup.
fn helper_looks_up(catalog: &Catalog, schema: &Schema, name: &str, position: usize, target: &str, stack: &mut BTreeSet<String>) -> bool {
    if !stack.insert(name.to_owned()) { return false }
    let found = catalog.functions.get(name).and_then(|function| {
        let parameter = &function.args.get(position)?.name;
        Some(match &function.body {
            FunctionBody::Expression(value) => expression_must_lookup(catalog, schema, value, &BTreeSet::from([parameter.clone()]), target, stack),
            FunctionBody::Block(body) => statements_must_lookup(catalog, schema, body, parameter, target, stack),
        })
    }).unwrap_or(false);
    stack.remove(name);
    found
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct HelperState {
    /// Names that still definitely denote the helper's original formal value.
    aliases: BTreeSet<String>,
    checked: bool,
}

#[derive(Default)]
struct HelperFlow {
    normal: Option<HelperState>,
    returned: Option<HelperState>,
    broken: Option<HelperState>,
    continued: Option<HelperState>,
}

fn statements_must_lookup(catalog: &Catalog, schema: &Schema, body: &[Stmt], parameter: &str, target: &str, stack: &mut BTreeSet<String>) -> bool {
    let entry = HelperState { aliases: BTreeSet::from([parameter.to_owned()]), checked: false };
    let flow = helper_statements(catalog, schema, body, entry, target, stack);
    // A well-typed block helper returns explicitly, but count a fallthrough or
    // malformed escaping loop edge conservatively as a successful unchecked
    // exit. This proof is never what makes such a helper valid.
    join_helper_states(
        join_helper_states(flow.returned, flow.normal),
        join_helper_states(flow.broken, flow.continued),
    ).is_some_and(|state| state.checked)
}

fn helper_statements(catalog: &Catalog, schema: &Schema, body: &[Stmt], entry: HelperState, target: &str, stack: &mut BTreeSet<String>) -> HelperFlow {
    let mut flow = HelperFlow { normal: Some(entry), ..HelperFlow::default() };
    for statement in body {
        let Some(state) = flow.normal.take() else { break };
        let next = helper_statement(catalog, schema, statement, state, target, stack);
        flow.normal = next.normal;
        flow.returned = join_helper_states(flow.returned, next.returned);
        flow.broken = join_helper_states(flow.broken, next.broken);
        flow.continued = join_helper_states(flow.continued, next.continued);
    }
    flow
}

fn helper_statement(catalog: &Catalog, schema: &Schema, statement: &Stmt, mut state: HelperState, target: &str, stack: &mut BTreeSet<String>) -> HelperFlow {
    let normal = |state| HelperFlow { normal: Some(state), ..HelperFlow::default() };
    match statement {
        Stmt::Bind { names, value, .. } => {
            let alias = names.len() == 1 && matches!(value, Expr::Name { name, .. } if state.aliases.contains(name));
            helper_expression(catalog, schema, value, &mut state, target, stack);
            for name in names { state.aliases.remove(name); }
            if alias { state.aliases.insert(names[0].clone()); }
            normal(state)
        }
        Stmt::Expr { value, .. } => {
            helper_expression(catalog, schema, value, &mut state, target, stack);
            normal(state)
        }
        Stmt::Require { condition, .. } => {
            let (yes, _) = helper_condition(catalog, schema, condition, state, target, stack);
            normal(yes)
        }
        Stmt::Return { value, .. } => {
            helper_expression(catalog, schema, value, &mut state, target, stack);
            HelperFlow { returned: Some(state), ..HelperFlow::default() }
        }
        Stmt::Emit { payload, once, .. } => {
            helper_expression(catalog, schema, payload, &mut state, target, stack);
            if let Some(once) = once { helper_expression(catalog, schema, once, &mut state, target, stack); }
            normal(state)
        }
        Stmt::If { condition, then_body, else_body, .. } => {
            let (then_entry, else_entry) = helper_condition(catalog, schema, condition, state, target, stack);
            join_helper_flows(
                helper_statements(catalog, schema, then_body, then_entry, target, stack),
                helper_statements(catalog, schema, else_body, else_entry, target, stack),
            )
        }
        Stmt::For { name, domain, body, .. } => {
            helper_for(catalog, schema, name, domain, body, state, target, stack)
        }
        Stmt::As { principal, body, .. } => {
            helper_expression(catalog, schema, principal, &mut state, target, stack);
            helper_statements(catalog, schema, body, state, target, stack)
        }
        Stmt::Break { .. } => HelperFlow { broken: Some(state), ..HelperFlow::default() },
        Stmt::Continue { .. } => HelperFlow { continued: Some(state), ..HelperFlow::default() },
    }
}

fn helper_for(catalog: &Catalog, schema: &Schema, name: &str, domain: &Expr, body: &[Stmt], mut state: HelperState, target: &str, stack: &mut BTreeSet<String>) -> HelperFlow {
    helper_expression(catalog, schema, domain, &mut state, target, stack);
    if matches!(domain, Expr::Array { items, .. } if items.is_empty()) {
        return HelperFlow { normal: Some(state), ..HelperFlow::default() };
    }
    let outer_alias = state.aliases.contains(name);
    let mut first = state.clone();
    first.aliases.remove(name);
    let mut header = first.clone();
    let mut returned = None;
    let mut broken = None;
    let mut iteration_exit = None;
    loop {
        let body_flow = helper_statements(catalog, schema, body, header.clone(), target, stack);
        returned = join_helper_states(returned, body_flow.returned);
        broken = join_helper_states(broken, body_flow.broken);
        let back = join_helper_states(body_flow.normal, body_flow.continued);
        iteration_exit = join_helper_states(iteration_exit, back.clone());
        let Some(mut back) = back else { break };
        // Every iteration introduces a fresh loop binding. Assigning that name
        // cannot restore or mutate the shadowed outer formal.
        back.aliases.remove(name);
        let next = join_helper_states(Some(first.clone()), Some(back)).unwrap();
        if next == header { break }
        header = next;
    }
    let restore = |state: Option<HelperState>| state.map(|mut state| {
        if outer_alias { state.aliases.insert(name.to_owned()); } else { state.aliases.remove(name); }
        state
    });
    let normal = join_helper_states(
        Some(state),
        join_helper_states(restore(iteration_exit), restore(broken)),
    );
    HelperFlow { normal, returned, ..HelperFlow::default() }
}

fn helper_condition(catalog: &Catalog, schema: &Schema, expression: &Expr, state: HelperState, target: &str, stack: &mut BTreeSet<String>) -> (HelperState, HelperState) {
    match expression {
        Expr::Unary { op, value, .. } if op == "not" => {
            let (yes, no) = helper_condition(catalog, schema, value, state, target, stack);
            (no, yes)
        }
        Expr::Binary { op, left, right, .. } if op == "and" => {
            let (left_yes, left_no) = helper_condition(catalog, schema, left, state, target, stack);
            let (right_yes, right_no) = helper_condition(catalog, schema, right, left_yes, target, stack);
            (right_yes, join_helper_states(Some(left_no), Some(right_no)).unwrap())
        }
        Expr::Binary { op, left, right, .. } if op == "or" => {
            let (left_yes, left_no) = helper_condition(catalog, schema, left, state, target, stack);
            let (right_yes, right_no) = helper_condition(catalog, schema, right, left_no, target, stack);
            (join_helper_states(Some(left_yes), Some(right_yes)).unwrap(), right_no)
        }
        _ => {
            let mut evaluated = state;
            helper_expression(catalog, schema, expression, &mut evaluated, target, stack);
            (evaluated.clone(), evaluated)
        }
    }
}

fn helper_expression(catalog: &Catalog, schema: &Schema, expression: &Expr, state: &mut HelperState, target: &str, stack: &mut BTreeSet<String>) {
    if !state.checked && expression_must_lookup(catalog, schema, expression, &state.aliases, target, stack) {
        state.checked = true;
    }
}

fn join_helper_states(left: Option<HelperState>, right: Option<HelperState>) -> Option<HelperState> {
    match (left, right) {
        (Some(mut left), Some(right)) => {
            left.aliases.retain(|name| right.aliases.contains(name));
            left.checked &= right.checked;
            Some(left)
        }
        (Some(state), None) | (None, Some(state)) => Some(state),
        (None, None) => None,
    }
}

fn join_helper_flows(left: HelperFlow, right: HelperFlow) -> HelperFlow {
    HelperFlow {
        normal: join_helper_states(left.normal, right.normal),
        returned: join_helper_states(left.returned, right.returned),
        broken: join_helper_states(left.broken, right.broken),
        continued: join_helper_states(left.continued, right.continued),
    }
}

fn expression_must_lookup(catalog: &Catalog, schema: &Schema, expression: &Expr, aliases: &BTreeSet<String>, target: &str, stack: &mut BTreeSet<String>) -> bool {
    let child = |value: &Expr, stack: &mut BTreeSet<String>| expression_must_lookup(catalog, schema, value, aliases, target, stack);
    match expression {
        Expr::Read(read) | Expr::Exists { read, .. } if read.table == target && read_checks_target_alias(schema, read, aliases, target) => true,
        Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } => read.keys.iter().any(|key| child(&key.value, stack)),
        Expr::Unary { value, .. } | Expr::Member { base: value, .. } | Expr::Assert { value, .. } | Expr::ShapeUse { base: value, .. } => child(value, stack),
        Expr::Binary { op, left, right, .. } if matches!(op.as_str(), "and" | "or" | "??") =>
            child(left, stack) || lazy_right_must_run(op, left) && child(right, stack),
        Expr::Binary { left, right, .. } => child(left, stack) || child(right, stack),
        Expr::Array { items, .. } => items.iter().any(|value| child(value, stack)),
        Expr::Call { name, args, .. } => args.iter().any(|value| child(value, stack))
            || args.iter().enumerate().any(|(position, argument)| matches!(argument, Expr::Name { name, .. } if aliases.contains(name))
                && helper_looks_up(catalog, schema, name, position, target, stack)),
        Expr::Object { fields, .. } => fields.iter().filter_map(|field| field.value.as_ref()).any(|value| child(value, stack)),
        // Shape fields are row mappers and may never run when the base is
        // empty or hidden. Only evaluating the base is mandatory.
        Expr::Shape { base, .. } => child(base, stack),
        Expr::If { condition, then, otherwise, .. } => child(condition, stack) || (child(then, stack) && child(otherwise, stack)),
        Expr::Walk { seed, .. } => child(seed, stack),
        Expr::Write { keys, fields, condition, .. } => keys.iter().any(|key| child(&key.value, stack))
            || fields.iter().filter_map(|field| field.value.as_ref()).any(|value| child(value, stack))
            || condition.as_deref().is_some_and(|value| child(value, stack)),
        Expr::Merge(_) | Expr::Name { .. } | Expr::Focal { .. } | Expr::Literal { .. } => false,
    }
}

/// A small truth evaluator used only to establish that a lazy right operand
/// must run. Unknown values stay unknown; the always-evaluated left operand's
/// lookup is handled independently above.
fn constant_bool(expression: &Expr) -> Option<bool> {
    match expression {
        Expr::Literal { value: crate::ast::Literal::Bool(value), .. } => Some(*value),
        Expr::Unary { op, value, .. } if op == "not" => constant_bool(value).map(|value| !value),
        Expr::Binary { op, left, right, .. } if op == "and" => match (constant_bool(left), constant_bool(right)) {
            (Some(false), _) | (_, Some(false)) => Some(false),
            (Some(true), value) => value,
            (value, Some(true)) => value,
            _ => None,
        },
        Expr::Binary { op, left, right, .. } if op == "or" => match (constant_bool(left), constant_bool(right)) {
            (Some(true), _) | (_, Some(true)) => Some(true),
            (Some(false), value) => value,
            (value, Some(false)) => value,
            _ => None,
        },
        _ => None,
    }
}

fn lazy_right_must_run(op: &str, left: &Expr) -> bool {
    match op {
        "and" => constant_bool(left) == Some(true),
        "or" => constant_bool(left) == Some(false),
        "??" => matches!(left, Expr::Literal { value: crate::ast::Literal::Null, .. }),
        _ => false,
    }
}

fn read_checks_target_id(schema: &Schema, read: &ReadExpr, parameter: &str, target: &str) -> bool {
    read_checks_target(schema, read, target, |value| matches!(value, Expr::Name { name, .. } if name == parameter))
}

fn read_checks_target_alias(schema: &Schema, read: &ReadExpr, aliases: &BTreeSet<String>, target: &str) -> bool {
    read_checks_target(schema, read, target, |value| matches!(value, Expr::Name { name, .. } if aliases.contains(name)))
}

fn read_checks_target(schema: &Schema, read: &ReadExpr, target: &str, is_parameter: impl Fn(&Expr) -> bool) -> bool {
    if read.keys.iter().any(|key| key.column.as_deref() == Some("id") && is_parameter(&key.value)) { return true }
    if read.keys.iter().any(|key| key.column.is_some()) { return false }
    let index = read.index.as_deref().or(Some("byId")).and_then(|name| schema.table(target)?.index(name));
    index.is_some_and(|index| index.columns().iter().zip(&read.keys).any(|(column, key)| column == "id" && is_parameter(&key.value)))
}

fn write_contract_checks(schema: &Schema, candidate: &Candidate) -> bool {
    let Some(table) = schema.table(&candidate.child) else { return false };
    if table.through.as_ref().is_some_and(|through| through.reference == candidate.column) { return true }
    let rule_checks = |rule: &RuleExpr| rule_checks_target(schema, rule, &candidate.target, &candidate.column);
    let final_exists = || table.constraints.iter().any(|constraint| {
        matches!(constraint, Constraint::FinalExistsOnInsert { table, index, key }
            if table == &candidate.target && probe_checks_target_id(schema, table, index, key, &[], &candidate.column))
    });
    match candidate.op {
        WriteOp::Insert => rule_checks(&table.rules.insert) || final_exists(),
        WriteOp::Update => rule_checks(&table.rules.update),
        WriteOp::Upsert => (rule_checks(&table.rules.insert) || final_exists()) && rule_checks(&table.rules.update),
        WriteOp::Delete => true,
    }
}

fn rule_checks_target(schema: &Schema, rule: &RuleExpr, target: &str, column: &str) -> bool {
    match rule {
        RuleExpr::And(items) => items.iter().any(|item| rule_checks_target(schema, item, target, column)),
        RuleExpr::Or(items) => !items.is_empty() && items.iter().all(|item| rule_checks_target(schema, item, target, column)),
        RuleExpr::Not(_) => false,
        RuleExpr::Eq(left, right) | RuleExpr::Ne(left, right) | RuleExpr::Compare(_, left, right) => {
            [left, right].iter().any(|term| term_looks_up_column(term, column))
        }
        RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
            table == target && probe_checks_target_id(schema, table, index, key, equalities, column)
        }
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => false,
    }
}

/// A target probe through an alias does not establish the stored reference id.
fn probe_checks_target_id(schema: &Schema, target: &str, index: &str, key: &[RuleTerm], equalities: &[(String, RuleTerm)], column: &str) -> bool {
    let indexed_id = schema.table(target).and_then(|table| table.index(index)).is_some_and(|index| {
        index.columns().iter().zip(key).any(|(target_column, term)| target_column == "id" && term_reads_new_column(term, column))
    });
    indexed_id || equalities.iter().any(|(target_column, term)| target_column == "id" && term_reads_new_column(term, column))
}

/// Only the image being stored proves the new argument exists. An old-image
/// field or reference hop checks the row's previous parent and says nothing
/// about the replacement supplied by this mutation.
fn term_reads_new_column(term: &RuleTerm, column: &str) -> bool {
    matches!(term, RuleTerm::Field(field) | RuleTerm::NextField(field) if field == column)
        || term_looks_up_column(term, column)
}

fn term_looks_up_column(term: &RuleTerm, column: &str) -> bool {
    term.reference_source().is_some_and(|(source, old)| source == column && !old)
}
