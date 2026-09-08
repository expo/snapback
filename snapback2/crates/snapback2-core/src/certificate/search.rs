//! Independent search expression bounds and held-plan correspondence.
// @ref LLP 1001#unicode-search-foundation — issuing Q belongs to bounded source expressions, never indexed fields.
// @ref LLP 1012#indexed-held-search — discovery may enumerate exactly the source rule's witnesses.
use super::*;
use crate::Value;
use crate::schema::{ColumnType, IndexComponent, RuleTerm};

#[derive(Clone, Debug, PartialEq, Eq)]
enum Fact {
    Text(usize, bool),
    Row(String),
    Object(BTreeMap<String, Fact>),
    List(Box<Fact>),
    Unknown,
}
#[derive(Clone, Default)]
struct Env {
    facts: BTreeMap<String, Fact>,
    values: BTreeMap<String, Meaning>,
    audit: std::rc::Rc<std::cell::RefCell<SearchAudit>>,
    calls: u64,
}
impl std::ops::Deref for Env {
    type Target = BTreeMap<String, Fact>;
    fn deref(&self) -> &Self::Target {
        &self.facts
    }
}
impl std::ops::DerefMut for Env {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.facts
    }
}
// Captured values, not expressions to resolve against a later name environment.
// An alias of an argument remains that argument when its original name is shadowed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
enum Meaning {
    Argument(String),
    Viewer,
    Literal(Value),
    Lane,
    Field(Box<Meaning>, String),
    Object(BTreeMap<String, Meaning>),
    Binary(BinaryOp, Box<Meaning>, Box<Meaning>),
    Unary(UnaryOp, Box<Meaning>),
    Select(Box<Meaning>, Box<Meaning>, Box<Meaning>),
}
fn meaning(e: &Expr, env: &Env) -> Option<Meaning> {
    Some(match e {
        Expr::Variable(n) => return env.values.get(n).cloned(),
        Expr::Input(Input::Viewer) => Meaning::Viewer,
        Expr::Literal(v) => Meaning::Literal(v.clone()),
        Expr::Object(m) => Meaning::Object(
            m.iter()
                .map(|(n, e)| Some((n.clone(), meaning(e, env)?)))
                .collect::<Option<_>>()?,
        ),
        Expr::Binary { op, left, right } => Meaning::Binary(
            *op,
            Box::new(meaning(left, env)?),
            Box::new(meaning(right, env)?),
        ),
        Expr::Unary { op, value } => Meaning::Unary(*op, Box::new(meaning(value, env)?)),
        Expr::Field { base, name } => match meaning(base, env)? {
            Meaning::Object(m) => return m.get(name).cloned(),
            base => Meaning::Field(Box::new(base), name.clone()),
        },
        _ => return None,
    })
}
fn lane_invariant(value: &Meaning) -> bool {
    match value {
        Meaning::Lane => false,
        Meaning::Field(base, _) => lane_invariant(base),
        Meaning::Object(m) => m.values().all(lane_invariant),
        Meaning::Binary(_, a, b) => lane_invariant(a) && lane_invariant(b),
        Meaning::Unary(_, a) => lane_invariant(a),
        Meaning::Select(c, a, b) => lane_invariant(c) && lane_invariant(a) && lane_invariant(b),
        _ => true,
    }
}
fn capture(s: &Schema, env: &mut Env, name: &str, e: &Expr) {
    let f = fact(s, e, env);
    let value = meaning(e, env);
    env.insert(name.to_owned(), f);
    env.values.remove(name);
    if let Some(value) = value {
        env.values.insert(name.to_owned(), value);
    }
}
fn merge_env(target: &mut Env, a: &Env, b: &Env) {
    for key in a.keys().chain(b.keys()) {
        target.insert(
            key.clone(),
            join(
                a.get(key).unwrap_or(&Fact::Unknown),
                b.get(key).unwrap_or(&Fact::Unknown),
            ),
        );
    }
    target.values = a
        .values
        .iter()
        .filter(|(k, v)| b.values.get(*k) == Some(*v))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
}
fn arg(t: &ArgType) -> Fact {
    match t {
        ArgType::Text { max, .. } => Fact::Text(*max as usize, false),
        ArgType::Optional(t) => match arg(t) {
            Fact::Text(n, _) => Fact::Text(n, true),
            f => f,
        },
        ArgType::List { of: Some(t), .. } => Fact::List(Box::new(arg(t))),
        _ => Fact::Unknown,
    }
}
fn column(t: &ColumnType) -> Fact {
    match t {
        ColumnType::Text { max } => Fact::Text(*max as usize, false),
        ColumnType::Optional(t) => match column(t) {
            Fact::Text(n, _) => Fact::Text(n, true),
            f => f,
        },
        ColumnType::List { of, .. } => Fact::List(Box::new(column(of))),
        _ => Fact::Unknown,
    }
}
fn fact(s: &Schema, e: &Expr, env: &Env) -> Fact {
    match e {
        Expr::Literal(Value::String(s)) => Fact::Text(s.chars().count(), false),
        Expr::Variable(v) => env.get(v).cloned().unwrap_or(Fact::Unknown),
        Expr::Get(r) => Fact::Row(r.table.clone()),
        Expr::Field { base, name } => match fact(s, base, env) {
            Fact::Row(t) => s
                .table(&t)
                .and_then(|t| t.columns.get(name))
                .map(column)
                .unwrap_or(Fact::Unknown),
            Fact::Object(m) => m.get(name).cloned().unwrap_or(Fact::Unknown),
            _ => Fact::Unknown,
        },
        Expr::Object(m) => Fact::Object(
            m.iter()
                .map(|(k, v)| (k.clone(), fact(s, v, env)))
                .collect(),
        ),
        _ => Fact::Unknown,
    }
}
fn join(a: &Fact, b: &Fact) -> Fact {
    match (a, b) {
        (Fact::Text(a, ao), Fact::Text(b, bo)) => Fact::Text((*a).max(*b), *ao || *bo),
        _ if a == b => a.clone(),
        _ => Fact::Unknown,
    }
}
fn narrow(e: &Expr, env: &mut Env, truth: bool) {
    if let Expr::Unary {
        op: UnaryOp::Not,
        value,
    } = e
    {
        return narrow(value, env, !truth);
    }
    if let Expr::Binary { op, left, right } = e {
        let present = matches!(op, BinaryOp::Ne) && truth || matches!(op, BinaryOp::Eq) && !truth;
        if present {
            for (v, n) in [(left, right), (right, left)] {
                if matches!(n.as_ref(), Expr::Literal(Value::Null)) {
                    if let Some(target) = meaning(v, env) {
                        fn present(f: &mut Fact, value: &Meaning, target: &Meaning) {
                            if value == target {
                                if let Fact::Text(_, optional) = f {
                                    *optional = false;
                                }
                            }
                            if let (Fact::Object(facts), Meaning::Object(values)) = (f, value) {
                                for (key, f) in facts {
                                    if let Some(v) = values.get(key) {
                                        present(f, v, target);
                                    }
                                }
                            }
                        }
                        for (name, value) in &env.values {
                            if let Some(f) = env.facts.get_mut(name) {
                                present(f, value, &target);
                            }
                        }
                    }
                }
            }
        }
    }
}
fn error(site: &str, message: &str) -> CheckError {
    CheckError{site:Some(site.into()),code:"E_ARGS_TYPE".into(),message:message.into(),rewrite:"equality-bind wordPrefixes with one declared present bounded text expression and its exact inferred maximum; keep addresses and suffixes scalar".into()}
}

#[derive(Clone, Default)]
pub(crate) struct SearchAudit {
    read_meanings: BTreeMap<String, Option<Meaning>>,
}
fn audit(schema: &Schema, program: &Program) -> SearchAudit {
    analyze(schema, program).1
}
pub(super) fn validate(schema: &Schema, program: &Program) -> Vec<CheckError> {
    analyze(schema, program).0
}
fn analyze(schema: &Schema, program: &Program) -> (Vec<CheckError>, SearchAudit) {
    let mut env = Env {
        facts: program
            .args
            .iter()
            .map(|(n, t)| (n.clone(), arg(t)))
            .collect(),
        values: program
            .args
            .keys()
            .map(|n| (n.clone(), Meaning::Argument(n.clone())))
            .collect(),
        audit: Default::default(),
        calls: 1,
    };
    let mut errors = Vec::new();
    let mut sites = BTreeSet::new();
    statements(schema, &program.body, &mut env, &mut errors, &mut sites);
    let audit = env.audit.borrow().clone();
    (errors, audit)
}
fn statements(
    s: &Schema,
    body: &[Stmt],
    env: &mut Env,
    errors: &mut Vec<CheckError>,
    sites: &mut BTreeSet<String>,
) {
    for stmt in body {
        match stmt {
            Stmt::Const { name, value }
            | Stmt::Let { name, value }
            | Stmt::Assign { name, value } => {
                expression(s, value, env, errors, sites);
                capture(s, env, name, value);
            }
            Stmt::If {
                condition,
                then_body,
                else_body,
            } => {
                expression(s, condition, env, errors, sites);
                let mut a = env.clone();
                let mut b = env.clone();
                narrow(condition, &mut a, true);
                narrow(condition, &mut b, false);
                statements(s, then_body, &mut a, errors, sites);
                statements(s, else_body, &mut b, errors, sites);
                let condition = meaning(condition, env);
                merge_env(env, &a, &b);
                if let Some(condition) = condition {
                    for (name, left) in &a.values {
                        if let Some(right) = b.values.get(name) {
                            if left != right {
                                env.values.insert(
                                    name.clone(),
                                    Meaning::Select(
                                        Box::new(condition.clone()),
                                        Box::new(left.clone()),
                                        Box::new(right.clone()),
                                    ),
                                );
                            }
                        }
                    }
                }
            }
            Stmt::Require { condition, .. } => {
                expression(s, condition, env, errors, sites);
                narrow(condition, env, true);
            }
            Stmt::For {
                binding,
                domain,
                body,
            } => {
                let mut inner = env.clone();
                // Loop-carried assignments cannot be certified from only the first iteration.
                fn assigned(body: &[Stmt], out: &mut BTreeSet<String>) {
                    for stmt in body {
                        match stmt {
                            Stmt::Assign { name, .. } | Stmt::Push { target: name, .. } => {
                                out.insert(name.clone());
                            }
                            Stmt::If {
                                then_body,
                                else_body,
                                ..
                            } => {
                                assigned(then_body, out);
                                assigned(else_body, out);
                            }
                            Stmt::For { body, .. } => assigned(body, out),
                            _ => {}
                        }
                    }
                }
                let mut changed = BTreeSet::new();
                assigned(body, &mut changed);
                for name in changed {
                    inner.values.remove(&name);
                    inner.insert(name, Fact::Unknown);
                }
                let f = match domain {
                    LoopDomain::Page(scan) => {
                        check_scan(s, scan, env, errors, sites);
                        Fact::Row(scan.table.clone())
                    }
                    LoopDomain::DerivedArray { value, .. } => {
                        expression(s, value, env, errors, sites);
                        match fact(s, value, env) {
                            Fact::List(v) => *v,
                            _ => Fact::Unknown,
                        }
                    }
                    LoopDomain::ArgList { name, .. } => match env.get(name) {
                        Some(Fact::List(f)) => *f.clone(),
                        _ => Fact::Unknown,
                    },
                    LoopDomain::Recurse(r) => {
                        expression(s, &r.seed, env, errors, sites);
                        Fact::Row(r.table.clone())
                    }
                    _ => Fact::Unknown,
                };
                inner.calls = env.calls.saturating_mul(match domain {
                    LoopDomain::Page(scan) => scan.take.maximum(),
                    LoopDomain::ArgList { max, .. } | LoopDomain::DerivedArray { max, .. } => {
                        u64::from(*max)
                    }
                    LoopDomain::LiteralRange {
                        start,
                        end_exclusive,
                    } => end_exclusive.saturating_sub(*start).max(0) as u64,
                    LoopDomain::Recurse(r) => {
                        crate::growth::geometric_sum(u64::from(r.fanout), r.depth)
                    }
                });
                inner.insert(binding.clone(), f);
                inner.values.remove(binding);
                statements(s, body, &mut inner, errors, sites);
                let prior = env.clone();
                merge_env(env, &prior, &inner);
            }
            Stmt::Push { target, value } => {
                expression(s, value, env, errors, sites);
                env.values.remove(target);
            }
            Stmt::Return(e)
            | Stmt::Insert { row: e, .. }
            | Stmt::Delete { key: e, .. }
            | Stmt::Emit { payload: e, .. } => expression(s, e, env, errors, sites),
            Stmt::Update { key, patch, .. }
            | Stmt::Upsert {
                key, row: patch, ..
            } => {
                expression(s, key, env, errors, sites);
                expression(s, patch, env, errors, sites)
            }
            Stmt::Break | Stmt::Continue => {}
        }
    }
}
fn expression(
    s: &Schema,
    e: &Expr,
    env: &Env,
    errors: &mut Vec<CheckError>,
    sites: &mut BTreeSet<String>,
) {
    match e {
        Expr::Scan(scan) => check_scan(s, scan, env, errors, sites),
        Expr::Merge(m) => {
            check_held(s, m, env, errors);
            for lane in &m.lanes {
                let mut inner = env.clone();
                if let Some(source) = &lane.source {
                    check_scan(s, source, env, errors, sites);
                    inner.insert(lane.binding.clone(), Fact::Row(source.table.clone()));
                    inner.values.insert(lane.binding.clone(), Meaning::Lane);
                    inner.calls = inner.calls.saturating_mul(source.take.maximum());
                }
                statements(s, &lane.setup, &mut inner, errors, sites);
                check_scan(s, &lane.scan, &inner, errors, sites);
            }
        }
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => {
            expression(s, base, env, errors, sites)
        }
        Expr::Binary { left, right, .. } => {
            expression(s, left, env, errors, sites);
            expression(s, right, env, errors, sites)
        }
        Expr::Array(v) | Expr::Builtin { args: v, .. } => {
            for v in v {
                expression(s, v, env, errors, sites)
            }
        }
        Expr::Object(m) => {
            for v in m.values() {
                expression(s, v, env, errors, sites)
            }
        }
        Expr::Get(r) | Expr::Exists(r) => {
            for v in &r.key {
                expression(s, v, env, errors, sites)
            }
        }
        _ => {}
    }
}
fn check_scan(
    s: &Schema,
    scan: &Scan,
    env: &Env,
    errors: &mut Vec<CheckError>,
    sites: &mut BTreeSet<String>,
) {
    let Some(index) = s.table(&scan.table).and_then(|t| t.index(&scan.index)) else {
        return;
    };
    if let Some(offset) = index.derived_offset() {
        if !sites.insert(scan.site.clone()) {
            errors.push(error(
                &scan.site,
                "a derived read site must identify one issuing expression",
            ));
        }
        if scan.prefix.len() <= offset {
            errors.push(error(
                &scan.site,
                "derived component must be equality-bound",
            ));
        }
    }
    for (component, key) in index.components.iter().zip(&scan.prefix) {
        match (component, key) {
            (IndexComponent::Column(_), IndexKeyExpr::Scalar(_)) => {}
            (
                IndexComponent::WordPrefixes { contract, .. },
                IndexKeyExpr::WordPrefix {
                    source,
                    source_max,
                    contract: c,
                },
            ) => {
                env.audit.borrow_mut().read_meanings.insert(
                    scan.site.clone(),
                    meaning(source, env).filter(lane_invariant),
                );
                if c != contract || fact(s, source, env) != Fact::Text(*source_max, false) {
                    errors.push(error(&scan.site,"search source_max must equal the independently inferred present text bound"));
                }
            }
            _ => errors.push(error(
                &scan.site,
                "index key tag does not match its component",
            )),
        }
        expression(s, key.expression(), env, errors, sites);
    }
    for e in [scan.after.as_deref(), scan.before.as_deref()]
        .into_iter()
        .flatten()
    {
        expression(s, e, env, errors, sites)
    }
    if let Some(r) = &scan.range {
        for e in [&r.gt, &r.gte, &r.lt, &r.lte].into_iter().flatten() {
            expression(s, e, env, errors, sites)
        }
    }
}

fn invariant(e: &Expr, binding: &str) -> bool {
    match e {
        Expr::Literal(_) | Expr::Input(Input::Viewer) => true,
        Expr::Variable(n) => n != binding,
        _ => false,
    }
}
fn term_expr(t: &RuleTerm) -> Option<Expr> {
    match t {
        RuleTerm::Viewer => Some(Expr::Input(Input::Viewer)),
        RuleTerm::Literal(v) => Some(Expr::Literal(v.clone())),
        _ => None,
    }
}
fn check_held(s: &Schema, m: &Merge, env: &Env, errors: &mut Vec<CheckError>) {
    let Some(held) = &m.held_search else { return };
    if rederive_held(s, m, env).as_ref() != Some(held.as_ref()) {
        errors.push(error(&m.site,"held_search does not exactly match canonical authorization discovery and the actual merge"));
    }
}
fn rederive_held(s: &Schema, m: &Merge, env: &Env) -> Option<HeldSearchDescriptor> {
    if m.lanes.len() != 1 {
        return None;
    }
    let lane = &m.lanes[0];
    let scan = &lane.scan;
    let source = lane.source.as_ref()?;
    if !lane.setup.is_empty()
        || scan.before.is_some()
        || scan.range.is_some()
        || source.after.is_some()
        || source.before.is_some()
        || source.range.is_some()
    {
        return None;
    }
    let table = s.table(&scan.table)?;
    let index = table.index(&scan.index)?;
    let offset = index.derived_offset()?;
    if scan.prefix.len() != offset + 1 {
        return None;
    }
    let IndexKeyExpr::WordPrefix {
        source: term,
        contract,
        source_max,
    } = &scan.prefix[offset]
    else {
        return None;
    };
    let mut lane_env = env.clone();
    lane_env.values.insert(lane.binding.clone(), Meaning::Lane);
    if !lane_invariant(&meaning(term, &lane_env)?) {
        return None;
    }
    let suffix = index.suffix_columns(offset + 1)?;
    if suffix.last().map(String::as_str) != Some("id") {
        return None;
    }
    let RuleExpr::Exists {
        table: auth_table,
        index: auth_index,
        key,
        ..
    } = &table.rules.read
    else {
        return None;
    };
    if auth_table != &source.table {
        return None;
    }
    let membership = s.table(auth_table)?;
    let auth = membership.index(auth_index)?;
    let columns = auth.scalar_columns()?;
    if !auth.unique || columns.len() != key.len() {
        return None;
    }
    let discovery = membership.index(&source.index)?.scalar_columns()?;
    if source.prefix.len() > discovery.len() {
        return None;
    }
    let pins = discovery
        .iter()
        .zip(&source.prefix)
        .map(|(n, v)| Some((n.clone(), meaning(v.scalar()?, env)?)))
        .collect::<Option<BTreeMap<_, _>>>()?;
    if !pins.values().all(lane_invariant) {
        return None;
    }
    let scopes = index.components[..offset]
        .iter()
        .zip(&scan.prefix)
        .map(|(c, k)| Some((c.column()?.clone(), meaning(k.scalar()?, &lane_env)?)))
        .collect::<Option<BTreeMap<_, _>>>()?;
    let mut accounted = BTreeSet::new();
    let mut mapped = BTreeSet::new();
    for (column, key) in columns.iter().zip(key) {
        match key {
            RuleTerm::Field(field) => {
                let value = scopes.get(field)?;
                match value {
                    Meaning::Field(base, name)
                        if base.as_ref() == &Meaning::Lane && name == column =>
                    {
                        if pins.contains_key(column) {
                            return None;
                        }
                        mapped.insert(field.clone());
                    }
                    e if lane_invariant(e) && pins.get(column) == Some(e) => {
                        accounted.insert(column.clone());
                    }
                    _ => return None,
                }
            }
            t => {
                if pins.get(column) != Some(&meaning(&term_expr(t)?, env)?) {
                    return None;
                }
                accounted.insert(column.clone());
            }
        }
    }
    if pins.keys().any(|k| !accounted.contains(k)) {
        return None;
    }
    for (field, value) in &scopes {
        if !mapped.contains(field) && !lane_invariant(value) {
            return None;
        }
    }
    if !s.rule_input_is_readable(auth_table, auth_index, key) {
        return None;
    }
    Some(HeldSearchDescriptor {
        table: scan.table.clone(),
        index: scan.index.clone(),
        term: HeldSearchTerm {
            source: term.clone(),
            contract: *contract,
            source_max: *source_max,
        },
        scope: index.components[..offset]
            .iter()
            .zip(&scan.prefix)
            .map(|(c, k)| HeldSearchScope {
                column: c.column().unwrap().clone(),
                value: k.scalar().unwrap().clone(),
            })
            .collect(),
        suffix,
        order: scan.order,
        take: scan.take.clone(),
        after: scan.after.clone(),
        discovery: HeldSearchDiscovery {
            scan: source.clone(),
            binding: lane.binding.clone(),
            authorization_index: auth_index.clone(),
        },
    })
}

/// A shared page reserve needs equal derived meaning and independent ordinary scopes.
/// Equal full scope tuples coalesce at execution; distinct tuples partition rows.
pub(crate) fn disjoint_merge(schema: &Schema, merge: &Merge) -> bool {
    let Some(first) = merge.lanes.first() else {
        return false;
    };
    let Some(index) = schema
        .table(&first.scan.table)
        .and_then(|t| t.index(&first.scan.index))
    else {
        return false;
    };
    let Some(offset) = index.derived_offset() else {
        return true;
    };
    let mut meaning = None;
    for lane in &merge.lanes {
        if !lane.setup.is_empty() {
            return false;
        }
        let Some(IndexKeyExpr::WordPrefix {
            source,
            contract,
            source_max,
        }) = lane.scan.prefix.get(offset)
        else {
            return false;
        };
        if !invariant(source, &lane.binding) {
            return false;
        }
        let key = match source {
            Expr::Literal(Value::String(s)) => {
                match crate::unicode::search_query_token(s, *source_max, &mut Default::default()) {
                    Ok(t) => format!("literal:{contract:?}:{t:?}"),
                    Err(_) => return false,
                }
            }
            e => format!("expr:{contract:?}:{}", crate::value::canonical_json(e)),
        };
        if meaning.as_ref().is_some_and(|old| old != &key) {
            return false;
        }
        meaning = Some(key);
    }
    true
}

pub(super) fn derivation_bound(
    schema: &Schema,
    program: &Program,
    writes: &[WriteSite],
    maintained: &BTreeMap<String, u64>,
    reads: &BTreeMap<String, ReadSite>,
) -> crate::engine::search_index::Derivation {
    use crate::engine::search_index::{Derivation, table_write_bound};
    let audit = audit(schema, program);
    let mut out = crate::engine::search_index::Derivation::default();
    for w in writes {
        if let Some(t) = schema.table(&w.table) {
            let mut b = table_write_bound(
                schema,
                &w.table,
                t,
                w.kind != WriteKind::Delete,
                w.kind != WriteKind::Insert,
            );
            b.steps = b.steps.saturating_mul(w.max_rows);
            out.add(b);
        }
    }
    for (name, count) in maintained {
        if let Some(t) = schema.table(name) {
            let mut b = table_write_bound(schema, name, t, true, true);
            b.steps = b.steps.saturating_mul(*count);
            out.add(b);
        }
    }
    let mut normalized = BTreeSet::new();
    let mut resolved = BTreeSet::new();
    let mut descriptors = 0u64;
    fn walk(body: &[Stmt], visit: &mut impl FnMut(&Expr)) {
        for stmt in body {
            crate::certificate_policy::visit_statement_exprs(stmt, visit);
            match stmt {
                Stmt::If {
                    then_body,
                    else_body,
                    ..
                } => {
                    walk(then_body, visit);
                    walk(else_body, visit)
                }
                Stmt::For { body, .. } => walk(body, visit),
                _ => {}
            }
        }
    }
    walk(&program.body, &mut |e| {
        if let Expr::Scan(scan) = e {
            let calls = reads.get(&scan.site).map_or(1, |r| r.max_calls);
            for k in &scan.prefix {
                if let IndexKeyExpr::WordPrefix {
                    source, source_max, ..
                } = k
                {
                    let q = *source_max as u64;
                    let captured = audit.read_meanings.get(&scan.site).and_then(Option::as_ref);
                    let stable = captured.is_some();
                    let key = captured
                        .map(|v| crate::value::canonical_json(&(v, source_max)))
                        .unwrap_or_else(|| crate::value::canonical_json(source));
                    let norm_calls = if stable {
                        u64::from(normalized.insert(key.clone()))
                    } else {
                        calls
                    };
                    let resolve_calls = if stable && writes.is_empty() && maintained.is_empty() {
                        u64::from(resolved.insert((scan.table.clone(), scan.index.clone(), key)))
                    } else {
                        calls
                    };
                    let steps = (crate::unicode::normalization_step_bound(*source_max)
                        .unwrap_or(usize::MAX) as u64)
                        .saturating_add(6 * q)
                        .saturating_mul(norm_calls)
                        .saturating_add(4 * q * resolve_calls);
                    descriptors = descriptors.saturating_add((8 * q + 256).saturating_mul(calls));
                    out.add(Derivation {
                        steps,
                        scratch: (crate::unicode::normalization_scratch_bytes(*source_max)
                            .unwrap_or(usize::MAX) as u64)
                            .saturating_add(40 * q)
                            .saturating_add(descriptors),
                    });
                }
            }
        }
    });
    out
}

#[cfg(test)]
pub(crate) mod tests;

pub(crate) mod closure;
