//! Structural admission and certified rule-uniformity for data programs.

use crate::certificate::{CheckError, Checker};
use crate::ir::*;
use crate::schema::{ColumnType, RuleExpr, RuleTerm, Schema};
use crate::value::{I53_MAX, I53_MIN, Value};
use std::collections::{BTreeMap, BTreeSet};

mod cursors;
#[path = "certificate_policy/fanout.rs"]
pub(crate) mod fanout;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct CappedSite {
    site: String,
    table: String,
    index: String,
}

/// A read-site label is an identity for one exact authored access. The
/// certificate and runtime key metadata by that label, so every semantic
/// field must agree when raw IR repeats it; only the label itself is omitted.
#[derive(Clone, Debug, PartialEq, Eq)]
enum ReadSiteShape {
    Point(Read),
    Range(Scan),
    Recurse(Recurse),
}

impl ReadSiteShape {
    fn point(read: &Read) -> Self {
        let mut read = read.clone();
        read.site.clear();
        Self::Point(read)
    }

    fn range(scan: &Scan) -> Self {
        let mut scan = scan.clone();
        scan.site.clear();
        Self::Range(scan)
    }

    fn recurse(recurse: &Recurse) -> Self {
        let mut recurse = recurse.clone();
        recurse.site.clear();
        Self::Recurse(recurse)
    }
}

#[derive(Clone, Default)]
struct Fact {
    pages: BTreeSet<CappedSite>,
    structural: BTreeSet<CappedSite>,
}

impl Fact {
    fn merge(&mut self, other: Self) {
        self.pages.extend(other.pages);
        self.structural.extend(other.structural);
    }

    fn made_structural(mut self) -> Self {
        self.structural.append(&mut self.pages);
        self
    }
}

pub(crate) fn uniform_visibility(schema: &Schema, scan: &Scan) -> bool {
    let Some(table) = schema.table(&scan.table) else {
        return false;
    };
    let Some(index) = table.index(&scan.index) else {
        return false;
    };
    let pinned: BTreeSet<_> = index
        .columns
        .iter()
        .take(scan.prefix.len())
        .cloned()
        .collect();
    let mut used = BTreeSet::new();
    rule_fields(&table.rules.read, &mut used);
    used.is_subset(&pinned)
}

fn rule_fields(rule: &RuleExpr, out: &mut BTreeSet<String>) {
    match rule {
        RuleExpr::Eq(left, right) | RuleExpr::Ne(left, right) => {
            for term in [left, right] {
                if let RuleTerm::Field(name) = term {
                    out.insert(name.clone());
                }
            }
        }
        RuleExpr::Exists { key, .. } | RuleExpr::Created { key, .. } => {
            for term in key {
                if let RuleTerm::Field(name) = term {
                    out.insert(name.clone());
                }
            }
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => {
            rules.iter().for_each(|rule| rule_fields(rule, out));
        }
        RuleExpr::Not(rule) => rule_fields(rule, out),
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => {}
    }
}

impl Checker<'_> {
    pub(crate) fn structural_errors(
        &self,
        program: &Program,
    ) -> (Vec<CheckError>, BTreeSet<String>) {
        let mut errors: Vec<_> = crate::cap::schema_errors(self.schema)
            .into_iter()
            .map(|(site, mut e)| {
                e.site = Some(site);
                e
            })
            .collect();
        let (fanout_errors, complete) = if self.job_chunk {
            (Vec::new(), BTreeSet::new())
        } else {
            fanout::check(self.schema, program)
        };
        errors.extend(fanout_errors);
        let mut sites = BTreeMap::new();
        let mut bindings = BTreeMap::new();
        validate_statements(
            self,
            program,
            &program.body,
            &mut errors,
            &mut sites,
            &mut bindings,
        );
        let mut flow = CompletenessFlow {
            schema: self.schema,
            env: BTreeMap::new(),
            errors: &mut errors,
        };
        flow.statements(&program.body, &BTreeSet::new(), &BTreeSet::new());
        (errors, complete)
    }
}

struct CompletenessFlow<'a, 'b> {
    schema: &'a Schema,
    env: BTreeMap<String, Fact>,
    errors: &'b mut Vec<CheckError>,
}

impl CompletenessFlow<'_, '_> {
    fn statements(
        &mut self,
        statements: &[Stmt],
        control: &BTreeSet<CappedSite>,
        loop_pages: &BTreeSet<CappedSite>,
    ) {
        for statement in statements {
            match statement {
                Stmt::Const { name, value } | Stmt::Let { name, value } => {
                    let fact = self.expr(value);
                    self.env.insert(name.clone(), fact);
                }
                Stmt::Assign { name, value } => {
                    let mut fact = self.expr(value);
                    fact.structural.extend(control.iter().cloned());
                    fact.structural.extend(loop_pages.iter().cloned());
                    self.env.insert(name.clone(), fact);
                }
                Stmt::Push { target, value } => {
                    // @ref LLP 1001#3-read-and-write-states-no-silent-states — collected visible pages stay returnable while structural uses refuse.
                    let mut fact = self.expr(value);
                    fact.pages.extend(loop_pages.iter().cloned());
                    fact.structural.extend(control.iter().cloned());
                    self.env.entry(target.clone()).or_default().merge(fact);
                }
                Stmt::If {
                    condition,
                    then_body,
                    else_body,
                } => {
                    let condition = self.expr(condition).made_structural();
                    let mut nested_control = control.clone();
                    nested_control.extend(condition.structural);
                    let mut branch_targets = BTreeSet::new();
                    assigned_targets(then_body, &mut branch_targets);
                    assigned_targets(else_body, &mut branch_targets);
                    let before = self.env.clone();
                    self.statements(then_body, &nested_control, loop_pages);
                    let then_env = self.env.clone();
                    self.env = before;
                    self.statements(else_body, &nested_control, loop_pages);
                    merge_env(&mut self.env, then_env);
                    for target in branch_targets {
                        self.env
                            .entry(target)
                            .or_default()
                            .structural
                            .extend(nested_control.iter().cloned());
                    }
                }
                Stmt::For {
                    binding,
                    domain,
                    body,
                } => {
                    let domain = self.domain(domain);
                    let mut nested_control = control.clone();
                    nested_control.extend(domain.structural.iter().cloned());
                    let mut nested_loop_pages = loop_pages.clone();
                    nested_loop_pages.extend(domain.pages.iter().cloned());
                    let previous = self.env.insert(binding.clone(), Fact::default());
                    self.statements(body, &nested_control, &nested_loop_pages);
                    if let Some(previous) = previous {
                        self.env.insert(binding.clone(), previous);
                    } else {
                        self.env.remove(binding);
                    }
                }
                Stmt::Return(value) => {
                    let fact = self.expr(value);
                    self.refuse_sink("returned result", &fact.structural, control, loop_pages);
                }
                Stmt::Require { condition, .. } => {
                    let fact = self.expr(condition).made_structural();
                    self.refuse_sink("require branch", &fact.structural, control, loop_pages);
                }
                Stmt::Insert { row, .. } => {
                    // @ref LLP 1001#3-read-and-write-states-no-silent-states — durable/effect sinks cannot erase capped-page provenance.
                    let fact = self.expr(row).made_structural();
                    self.refuse_sink("inserted value", &fact.structural, control, loop_pages);
                }
                Stmt::Update { key, patch, .. } => {
                    let mut fact = self.expr(key);
                    fact.merge(self.expr(patch));
                    let fact = fact.made_structural();
                    self.refuse_sink("updated value", &fact.structural, control, loop_pages);
                }
                Stmt::Upsert { key, row, .. } => {
                    let mut fact = self.expr(key);
                    fact.merge(self.expr(row));
                    let fact = fact.made_structural();
                    self.refuse_sink("upserted value", &fact.structural, control, loop_pages);
                }
                Stmt::Delete { key, .. } => {
                    let fact = self.expr(key).made_structural();
                    self.refuse_sink("deleted key", &fact.structural, control, loop_pages);
                }
                Stmt::Emit { payload, .. } => {
                    let fact = self.expr(payload).made_structural();
                    self.refuse_sink("emitted value", &fact.structural, control, loop_pages);
                }
                Stmt::Break | Stmt::Continue => {}
            }
        }
    }

    fn domain(&mut self, domain: &LoopDomain) -> Fact {
        match domain {
            LoopDomain::Page(scan) => self.scan_fact(scan),
            LoopDomain::DerivedArray { value, .. } => self.expr(value),
            LoopDomain::Recurse(recurse) => self.expr(&recurse.seed),
            LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => Fact::default(),
        }
    }

    fn expr(&mut self, expression: &Expr) -> Fact {
        match expression {
            Expr::Variable(name) => self.env.get(name).cloned().unwrap_or_default(),
            Expr::Field { base, .. } => self.expr(base),
            Expr::Binary { left, right, .. } => {
                let mut fact = self.expr(left);
                fact.merge(self.expr(right));
                fact.made_structural()
            }
            Expr::Unary { value, .. } => self.expr(value).made_structural(),
            Expr::Array(values) => self.exprs(values),
            Expr::Object(values) => self.exprs(values.values()),
            Expr::Builtin { builtin, args } => {
                let fact = self.exprs(args);
                match builtin {
                    Builtin::Slice
                    | Builtin::Concat
                    | Builtin::Sort { .. }
                    | Builtin::DedupeById { .. } => fact,
                    Builtin::Len
                    | Builtin::Min
                    | Builtin::Max
                    | Builtin::DeterministicShare
                    | Builtin::Count
                    | Builtin::Sum
                    | Builtin::CountCapped => fact.made_structural(),
                    Builtin::Divmod { .. } | Builtin::MentionTokens => Fact {
                        structural: fact.structural,
                        ..Fact::default()
                    },
                }
            }
            Expr::Scan(scan) => self.scan_fact(scan),
            Expr::Get(read) | Expr::Exists(read) => self.exprs(&read.key),
            Expr::Literal(_) | Expr::Input(_) => Fact::default(),
        }
    }

    fn exprs<'a>(&mut self, values: impl IntoIterator<Item = &'a Expr>) -> Fact {
        let mut fact = Fact::default();
        for value in values {
            fact.merge(self.expr(value));
        }
        fact
    }

    fn scan_fact(&self, scan: &Scan) -> Fact {
        if uniform_visibility(self.schema, scan) {
            return Fact::default();
        }
        Fact {
            pages: BTreeSet::from([CappedSite {
                site: scan.site.clone(),
                table: scan.table.clone(),
                index: scan.index.clone(),
            }]),
            structural: BTreeSet::new(),
        }
    }

    fn refuse_sink(
        &mut self,
        sink: &str,
        structural: &BTreeSet<CappedSite>,
        control: &BTreeSet<CappedSite>,
        loop_pages: &BTreeSet<CappedSite>,
    ) {
        let sites: BTreeSet<_> = structural
            .union(control)
            .chain(loop_pages)
            .cloned()
            .collect();
        for site in sites {
            self.errors.push(CheckError {
                site: None,
                code: "E_STRUCTURAL_COUNT".to_owned(),
                message: format!(
                    "{sink} depends on capped-only site {}; its read rule is not uniform over the scanned prefix",
                    site.site
                ),
                rewrite: format!(
                    "denormalize the authorization scope onto {} and include it in the {} prefix so the rule is uniform, or declare maintain totals = count {} by <scope> and read the maintained aggregate",
                    site.table, site.index, site.table
                ),
            });
        }
    }
}

fn merge_env(target: &mut BTreeMap<String, Fact>, source: BTreeMap<String, Fact>) {
    for (name, fact) in source {
        target.entry(name).or_default().merge(fact);
    }
}

fn assigned_targets(statements: &[Stmt], targets: &mut BTreeSet<String>) {
    for statement in statements {
        match statement {
            Stmt::Const { name, .. }
            | Stmt::Let { name, .. }
            | Stmt::Assign { name, .. }
            | Stmt::Push { target: name, .. } => {
                targets.insert(name.clone());
            }
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                assigned_targets(then_body, targets);
                assigned_targets(else_body, targets);
            }
            Stmt::For { body, .. } => assigned_targets(body, targets),
            Stmt::Return(_)
            | Stmt::Require { .. }
            | Stmt::Insert { .. }
            | Stmt::Update { .. }
            | Stmt::Upsert { .. }
            | Stmt::Delete { .. }
            | Stmt::Emit { .. }
            | Stmt::Break
            | Stmt::Continue => {}
        }
    }
}

fn validate_statements(
    checker: &Checker<'_>,
    program: &Program,
    statements: &[Stmt],
    errors: &mut Vec<CheckError>,
    sites: &mut BTreeMap<String, ReadSiteShape>,
    bindings: &mut BTreeMap<String, StaticBinding>,
) {
    for statement in statements {
        match statement {
            Stmt::Insert { table, row } | Stmt::Upsert { table, row, .. } => {
                validate_write_expression(checker, program, table, row, false, bindings, errors);
            }
            Stmt::Update { table, patch, .. } => {
                validate_write_expression(checker, program, table, patch, true, bindings, errors);
            }
            _ => {}
        }
        if let Stmt::Update { patch, .. } = statement
            && expression_contains_field(patch, "id")
        {
            errors.push(CheckError {
                site: None,
                code: "E_SCHEMA_ID_RESERVED".to_owned(),
                message: "update patches cannot contain id".to_owned(),
                rewrite: "remove id from the update patch".to_owned(),
            });
        }
        if let Stmt::Upsert { key, row, .. } = statement
            && upsert_identity_matches(key, row, bindings) == Some(false)
        {
            errors.push(CheckError {
                site: None,
                code: "E_SCHEMA_ID_RESERVED".to_owned(),
                message: "upsert key and row id must be one identity".to_owned(),
                rewrite:
                    "bind the identity once and use that binding for both the upsert key and row id"
                        .to_owned(),
            });
        }
        match statement {
            Stmt::Require { code, .. } if code.starts_with("E_AUTH_") => {
                errors.push(CheckError {
                    site: None,
                    code: "E_OP_RESERVED".to_owned(),
                    message: format!(
                        "application refusal code {code} uses the reserved E_AUTH_* namespace"
                    ),
                    rewrite: "use an application-owned refusal code without the E_AUTH_ prefix"
                        .to_owned(),
                });
            }
            Stmt::Insert { table, .. }
            | Stmt::Update { table, .. }
            | Stmt::Upsert { table, .. }
            | Stmt::Delete { table, .. } => {
                if table.starts_with('_') {
                    errors.push(CheckError {
                        site: None,
                        code: "E_SCHEMA_RESERVED".to_owned(),
                        message: format!("program names reserved table {table}"),
                        rewrite: "use an application table name that does not begin with '_'"
                            .to_owned(),
                    });
                }
                if program.kind == ProgramKind::Query {
                    errors.push(CheckError {
                        site: None,
                        code: "E_WRITE_IN_QUERY".to_owned(),
                        message: "a query cannot write durable data".to_owned(),
                        rewrite: "move the write into a mutation".to_owned(),
                    });
                }
                if !table.starts_with('_') && checker.schema.table(table).is_none() {
                    errors.push(CheckError {
                        site: None,
                        code: "E_UNBOUND_SCAN".to_owned(),
                        message: format!("write requires missing table {table}"),
                        rewrite: "declare the table in the schema".to_owned(),
                    });
                }
            }
            Stmt::Emit { .. } if program.kind == ProgramKind::Query => {
                errors.push(CheckError {
                    site: None,
                    code: "E_EMIT_IN_QUERY".to_owned(),
                    message: "a query cannot emit an effect".to_owned(),
                    rewrite: "move emit into a mutation".to_owned(),
                });
            }
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                validate_statements(
                    checker,
                    program,
                    then_body,
                    errors,
                    sites,
                    &mut bindings.clone(),
                );
                validate_statements(
                    checker,
                    program,
                    else_body,
                    errors,
                    sites,
                    &mut bindings.clone(),
                );
                let mut assigned = BTreeSet::new();
                assigned_targets(then_body, &mut assigned);
                assigned_targets(else_body, &mut assigned);
                bindings.retain(|name, _| !assigned.contains(name));
            }
            Stmt::For {
                binding,
                domain,
                body,
            } => {
                if let LoopDomain::Recurse(recurse) = domain {
                    register_site(
                        sites,
                        errors,
                        &recurse.site,
                        ReadSiteShape::recurse(recurse),
                    );
                    validate_read(checker, &recurse.table, &recurse.index, errors);
                    if recurse.depth > MAX_RECURSE_DEPTH {
                        errors.push(CheckError {
                            site: None,
                            code: "E_UNBOUND_LOOP".to_owned(),
                            message: format!(
                                "recurse depth {} exceeds maximum {}",
                                recurse.depth, MAX_RECURSE_DEPTH
                            ),
                            rewrite: format!("reduce recurse depth to at most {MAX_RECURSE_DEPTH}"),
                        });
                    }
                }
                let mut body_bindings = bindings.clone();
                match domain {
                    LoopDomain::Page(scan) => {
                        body_bindings
                            .insert(binding.clone(), StaticBinding::Row(scan.table.clone()));
                    }
                    LoopDomain::Recurse(recurse) => {
                        body_bindings
                            .insert(binding.clone(), StaticBinding::Row(recurse.table.clone()));
                    }
                    _ => {
                        body_bindings.remove(binding);
                    }
                }
                validate_statements(checker, program, body, errors, sites, &mut body_bindings);
                let mut assigned = BTreeSet::new();
                assigned_targets(body, &mut assigned);
                bindings.retain(|name, _| !assigned.contains(name));
            }
            _ => {}
        }
        visit_statement_exprs(statement, &mut |expression| {
            validate_expr(checker, program, expression, errors, sites, bindings)
        });
        match statement {
            Stmt::Const { name, value }
            | Stmt::Let { name, value }
            | Stmt::Assign { name, value } => {
                bindings.insert(name.clone(), StaticBinding::Expr(value.clone()));
            }
            Stmt::Push { target, .. } => {
                bindings.remove(target);
            }
            _ => {}
        }
    }
}

#[derive(Clone, Debug)]
enum StaticBinding {
    Expr(Expr),
    Row(String),
}

fn upsert_identity_matches(
    key: &Expr,
    row: &Expr,
    bindings: &BTreeMap<String, StaticBinding>,
) -> Option<bool> {
    let mut seen = BTreeSet::new();
    match resolve_row_container(row, bindings, &mut seen) {
        Expr::Object(fields) => fields.get("id").and_then(|id| {
            if expression_consumes_new_id(id) {
                Some(false)
            } else if id == key {
                Some(true)
            } else if let (Expr::Literal(id), Expr::Literal(key)) = (id, key) {
                Some(id == key)
            } else {
                None
            }
        }),
        Expr::Literal(crate::value::Value::Row(fields) | crate::value::Value::Map(fields)) => {
            fields
                .get("id")
                .map(|id| matches!(key, Expr::Literal(key) if key == id))
        }
        _ => None,
    }
}

fn resolve_row_container<'a>(
    expression: &'a Expr,
    bindings: &'a BTreeMap<String, StaticBinding>,
    seen: &mut BTreeSet<String>,
) -> &'a Expr {
    if let Expr::Variable(name) = expression
        && seen.insert(name.clone())
        && let Some(StaticBinding::Expr(value)) = bindings.get(name)
    {
        return resolve_row_container(value, bindings, seen);
    }
    expression
}

fn expression_consumes_new_id(expression: &Expr) -> bool {
    let mut consumes = false;
    walk_expr(expression, &mut |nested| {
        consumes |= matches!(nested, Expr::Input(Input::NewId));
    });
    consumes
}

fn expression_contains_field(expression: &Expr, name: &str) -> bool {
    match expression {
        Expr::Object(fields) => fields.contains_key(name),
        Expr::Literal(crate::value::Value::Row(fields) | crate::value::Value::Map(fields)) => {
            fields.contains_key(name)
        }
        _ => false,
    }
}

fn validate_expr(
    checker: &Checker<'_>,
    program: &Program,
    expression: &Expr,
    errors: &mut Vec<CheckError>,
    sites: &mut BTreeMap<String, ReadSiteShape>,
    bindings: &BTreeMap<String, StaticBinding>,
) {
    match expression {
        Expr::Input(input) => {
            let invalid = match input {
                Input::Viewer => false,
                Input::Now | Input::NewId => program.kind != ProgramKind::Mutation,
                Input::ReadTime => {
                    program.kind != ProgramKind::Query || program.read_time_granularity_ms.is_none()
                }
            };
            if invalid {
                errors.push(CheckError {
                    site: None,
                    code: "E_AMBIENT_TIME".to_owned(),
                    message: format!(
                        "modeled input {input:?} is not declared for this program kind"
                    ),
                    rewrite:
                        "bind now/newId in a mutation intent or declare query readTime granularity"
                            .to_owned(),
                });
            }
        }
        Expr::Get(read) | Expr::Exists(read) => {
            register_site(sites, errors, &read.site, ReadSiteShape::point(read));
            validate_read(checker, &read.table, &read.index, errors);
            validate_point_key_arity(checker, read, errors);
        }
        Expr::Scan(scan) => {
            register_site(sites, errors, &scan.site, ReadSiteShape::range(scan));
            validate_read(checker, &scan.table, &scan.index, errors);
            cursors::validate_scan_cursors(checker, program, scan, bindings, errors);
            if let Bound::Arg { name, .. } = &scan.take
                && !program.args.contains_key(name)
            {
                errors.push(CheckError {
                    site: None,
                    code: "E_UNBOUND_SCAN".to_owned(),
                    message: format!("scan {} take arg {name} is not declared", scan.site),
                    rewrite: "declare the bounded take argument on the program".to_owned(),
                });
            }
        }
        Expr::Field { base, name } => {
            let fact = static_expression_fact(
                checker.schema,
                program,
                base,
                bindings,
                &mut BTreeSet::new(),
            );
            if matches!(unwrap_static_type(&fact.kind), StaticType::List { .. }) {
                // @ref LLP 1001#3-read-and-write-states-no-silent-states — a
                // page is a list, not an object carrying hidden pagination state.
                errors.push(CheckError {
                    site: None,
                    code: "E_ARGS_TYPE".to_owned(),
                    message: format!(
                        ".{name} is read from a list (a page); lists have no fields"
                    ),
                    rewrite: format!(
                        "iterate the page (`for (const row of page)`) or take an element before reading `.{name}`"
                    ),
                });
            } else if let StaticType::Asset(kind) = unwrap_static_type(&fact.kind)
                && asset_member_type(*kind, name).is_none()
            {
                // @ref LLP 1006#3-authoring-surface — asset values are closed objects at static and runtime boundaries.
                errors.push(CheckError {
                    site: None,
                    code: "E_ARGS_TYPE".to_owned(),
                    message: format!(".{name} is not a field on {kind} assets"),
                    rewrite: format!(
                        "read one of {}",
                        match kind {
                            crate::assets::AssetKind::Image => "id, width, or height",
                            crate::assets::AssetKind::Video => "id, width, height, or duration",
                        }
                    ),
                });
            }
        }
        Expr::Builtin { builtin, args } if args.len() != builtin.arity() => {
            errors.push(CheckError {
                site: None,
                code: "E_OPAQUE".to_owned(),
                message: format!(
                    "builtin {builtin:?} requires {} arguments, received {}",
                    builtin.arity(),
                    args.len()
                ),
                rewrite: "use the builtin's declared argument count".to_owned(),
            });
        }
        Expr::Literal(value) if !literal_is_i53(value) => {
            errors.push(CheckError {
                site: None,
                code: "E_OPAQUE".to_owned(),
                message: "literal contains an integer outside the i53 value model".to_owned(),
                rewrite: "use integers from -9007199254740991 through 9007199254740991".to_owned(),
            });
        }
        _ => {}
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum StaticType {
    Unknown,
    Null,
    Cursor,
    WireId,
    Id,
    Principal,
    Ref(String),
    Text,
    Bytes,
    Asset(crate::assets::AssetKind),
    Int,
    Bool,
    Json,
    Enum,
    Decimal,
    Row(String),
    Object,
    List {
        of: Box<StaticType>,
        len: Option<usize>,
    },
    Optional(Box<StaticType>),
}

#[derive(Clone, Debug)]
struct StaticFact {
    kind: StaticType,
    invalid_id_arithmetic: bool,
}

impl StaticFact {
    fn plain(kind: StaticType) -> Self {
        Self {
            kind,
            invalid_id_arithmetic: false,
        }
    }
}

fn validate_write_expression(
    checker: &Checker<'_>,
    program: &Program,
    table_name: &str,
    expression: &Expr,
    patch: bool,
    bindings: &BTreeMap<String, StaticBinding>,
    errors: &mut Vec<CheckError>,
) {
    let Some(table) = checker.schema.table(table_name) else {
        return;
    };
    let mut seen = BTreeSet::new();
    let expression = resolve_static_expression(expression, bindings, &mut seen);
    match expression {
        Expr::Object(fields) => {
            for (field, value) in fields {
                let Some(expected) = table.columns.get(field) else {
                    continue;
                };
                validate_write_value(
                    checker.schema,
                    program,
                    table_name,
                    field,
                    expected,
                    value,
                    bindings,
                    errors,
                );
            }
        }
        Expr::Literal(Value::Row(fields) | Value::Map(fields)) => {
            for (field, value) in fields {
                let Some(expected) = table.columns.get(field) else {
                    continue;
                };
                if !literal_matches_column(value, expected) {
                    errors.push(write_type_error(table_name, field, expected));
                }
            }
        }
        _ if !patch => {
            let fact = static_expression_fact(
                checker.schema,
                program,
                expression,
                bindings,
                &mut BTreeSet::new(),
            );
            if !matches!(
                fact.kind,
                StaticType::Unknown | StaticType::Json | StaticType::Row(_) | StaticType::Object
            ) {
                errors.push(CheckError {
                    site: None,
                    code: "E_ARGS_TYPE".to_owned(),
                    message: format!("write to {table_name} requires a row object"),
                    rewrite: format!("write an object whose fields match {table_name}"),
                });
            }
        }
        _ => {}
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_write_value(
    schema: &Schema,
    program: &Program,
    table: &str,
    field: &str,
    expected: &ColumnType,
    expression: &Expr,
    bindings: &BTreeMap<String, StaticBinding>,
    errors: &mut Vec<CheckError>,
) {
    let fact = static_expression_fact(schema, program, expression, bindings, &mut BTreeSet::new());
    if fact.invalid_id_arithmetic {
        errors.push(CheckError {
            site: None,
            code: "E_ARGS_ID_TEXT".to_owned(),
            message: format!("{table}.{field} applies numeric addition to an Id scalar"),
            rewrite: "keep each Id in a separate Id/Ref field instead of adding it".to_owned(),
        });
    } else if matches_static_column(&fact.kind, expected) == Some(false) {
        errors.push(write_type_error(table, field, expected));
    }
}

fn write_type_error(table: &str, field: &str, expected: &ColumnType) -> CheckError {
    let id_position = matches!(
        unwrap_column_type(expected),
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. }
    );
    CheckError {
        site: None,
        code: if id_position {
            "E_ARGS_ID_SCALAR"
        } else {
            "E_ARGS_TYPE"
        }
        .to_owned(),
        message: format!("write value for {table}.{field} does not match {expected:?}"),
        rewrite: if id_position {
            format!(
                "replace {table}.{field} with Input::NewId in a mutation or an Id/Ref argument or field"
            )
        } else {
            format!("write a {expected:?} value to {table}.{field}")
        },
    }
}

fn static_expression_fact(
    schema: &Schema,
    program: &Program,
    expression: &Expr,
    bindings: &BTreeMap<String, StaticBinding>,
    seen: &mut BTreeSet<String>,
) -> StaticFact {
    let expression = resolve_static_expression(expression, bindings, seen);
    match expression {
        Expr::Literal(value) => StaticFact::plain(static_literal_type(value)),
        Expr::Variable(name) => StaticFact::plain(match bindings.get(name) {
            Some(StaticBinding::Row(table)) => StaticType::Row(table.clone()),
            _ => program
                .args
                .get(name)
                .map(static_arg_type)
                .unwrap_or(StaticType::Unknown),
        }),
        Expr::Input(Input::Viewer) => StaticFact::plain(StaticType::Principal),
        Expr::Input(Input::Now | Input::ReadTime) => StaticFact::plain(StaticType::Int),
        Expr::Input(Input::NewId) => StaticFact::plain(StaticType::Id),
        Expr::Field { base, name } => {
            let base = resolve_static_expression(base, bindings, &mut seen.clone());
            match base {
                Expr::Get(read) => StaticFact::plain(
                    schema
                        .table(&read.table)
                        .and_then(|table| table.columns.get(name))
                        .map(static_column_type)
                        .unwrap_or(StaticType::Unknown),
                ),
                Expr::Object(fields) => fields.get(name).map_or_else(
                    || StaticFact::plain(StaticType::Unknown),
                    |value| {
                        static_expression_fact(schema, program, value, bindings, &mut seen.clone())
                    },
                ),
                Expr::Literal(Value::Row(fields) | Value::Map(fields)) => fields
                    .get(name)
                    .map(|value| StaticFact::plain(static_literal_type(value)))
                    .unwrap_or_else(|| StaticFact::plain(StaticType::Unknown)),
                _ => {
                    let base =
                        static_expression_fact(schema, program, base, bindings, &mut seen.clone());
                    match unwrap_static_type(&base.kind) {
                        StaticType::Row(table_name) => StaticFact::plain(
                            schema
                                .table(table_name)
                                .and_then(|table| table.columns.get(name))
                                .map(static_column_type)
                                .unwrap_or(StaticType::Unknown),
                        ),
                        StaticType::Asset(kind) => StaticFact::plain(
                            asset_member_type(*kind, name).unwrap_or(StaticType::Unknown),
                        ),
                        _ => StaticFact::plain(StaticType::Unknown),
                    }
                }
            }
        }
        Expr::Array(values) => StaticFact::plain(StaticType::List {
            of: Box::new(common_static_type(values.iter().map(|value| {
                static_expression_fact(schema, program, value, bindings, &mut seen.clone()).kind
            }))),
            len: Some(values.len()),
        }),
        Expr::Object(_) => StaticFact::plain(StaticType::Object),
        Expr::Binary { op, left, right } => {
            let left = static_expression_fact(schema, program, left, bindings, &mut seen.clone());
            let right = static_expression_fact(schema, program, right, bindings, &mut seen.clone());
            let kind = match op {
                BinaryOp::Eq
                | BinaryOp::Ne
                | BinaryOp::SameValueZero
                | BinaryOp::Lt
                | BinaryOp::Lte
                | BinaryOp::Gt
                | BinaryOp::Gte
                | BinaryOp::And
                | BinaryOp::Or => StaticType::Bool,
                BinaryOp::Add | BinaryOp::Sub | BinaryOp::Mul => {
                    common_static_type([left.kind.clone(), right.kind.clone()])
                }
            };
            StaticFact {
                kind,
                invalid_id_arithmetic: left.invalid_id_arithmetic
                    || right.invalid_id_arithmetic
                    || (matches!(op, BinaryOp::Add)
                        && (is_static_id(&left.kind) || is_static_id(&right.kind))),
            }
        }
        Expr::Unary { value, .. } => static_expression_fact(schema, program, value, bindings, seen),
        Expr::Builtin { builtin, args } => {
            let facts = args
                .iter()
                .map(|value| {
                    static_expression_fact(schema, program, value, bindings, &mut seen.clone())
                })
                .collect::<Vec<_>>();
            let invalid_id_arithmetic = facts.iter().any(|fact| fact.invalid_id_arithmetic);
            let kind = match builtin {
                Builtin::Len
                | Builtin::DeterministicShare
                | Builtin::Count
                | Builtin::Sum
                | Builtin::CountCapped => StaticType::Int,
                Builtin::MentionTokens => StaticType::List {
                    of: Box::new(StaticType::Text),
                    len: None,
                },
                Builtin::Divmod { .. } => StaticType::Object,
                Builtin::Slice => StaticType::List {
                    of: Box::new(StaticType::Unknown),
                    len: None,
                },
                Builtin::Sort { .. } | Builtin::DedupeById { .. } => facts
                    .first()
                    .map(|fact| fact.kind.clone())
                    .unwrap_or(StaticType::Unknown),
                Builtin::Min | Builtin::Max => {
                    common_static_type(facts.iter().map(|fact| fact.kind.clone()))
                }
                Builtin::Concat => {
                    if facts.iter().all(|fact| {
                        matches!(unwrap_static_type(&fact.kind), StaticType::List { .. })
                    }) {
                        StaticType::List {
                            of: Box::new(StaticType::Unknown),
                            len: None,
                        }
                    } else if facts
                        .iter()
                        .any(|fact| matches!(unwrap_static_type(&fact.kind), StaticType::Text))
                    {
                        StaticType::Text
                    } else {
                        common_static_type(facts.iter().map(|fact| fact.kind.clone()))
                    }
                }
            };
            StaticFact {
                kind,
                invalid_id_arithmetic,
            }
        }
        Expr::Get(read) => StaticFact::plain(StaticType::Row(read.table.clone())),
        Expr::Scan(scan) => StaticFact::plain(StaticType::List {
            of: Box::new(StaticType::Row(scan.table.clone())),
            len: None,
        }),
        Expr::Exists(_) => StaticFact::plain(StaticType::Bool),
    }
}

fn resolve_static_expression<'a>(
    expression: &'a Expr,
    bindings: &'a BTreeMap<String, StaticBinding>,
    seen: &mut BTreeSet<String>,
) -> &'a Expr {
    if let Expr::Variable(name) = expression
        && seen.insert(name.clone())
        && let Some(StaticBinding::Expr(value)) = bindings.get(name)
    {
        return resolve_static_expression(value, bindings, seen);
    }
    expression
}

fn static_literal_type(value: &Value) -> StaticType {
    match value {
        Value::Null => StaticType::Null,
        Value::Bool(_) => StaticType::Bool,
        Value::Int(_) => StaticType::Int,
        Value::String(_) => StaticType::Text,
        Value::Id(_) => StaticType::WireId,
        Value::Bytes(_) => StaticType::Bytes,
        Value::Row(_) | Value::Map(_) => StaticType::Object,
        Value::Array(values) => StaticType::List {
            of: Box::new(common_static_type(values.iter().map(static_literal_type))),
            len: Some(values.len()),
        },
    }
}

fn static_column_type(value: &ColumnType) -> StaticType {
    match value {
        ColumnType::Id => StaticType::Id,
        ColumnType::Principal => StaticType::Principal,
        ColumnType::Ref { table } => StaticType::Ref(table.clone()),
        ColumnType::Text { .. } => StaticType::Text,
        ColumnType::Bytes { .. } => StaticType::Bytes,
        ColumnType::Image { .. } => StaticType::Asset(crate::assets::AssetKind::Image),
        ColumnType::Video { .. } => StaticType::Asset(crate::assets::AssetKind::Video),
        ColumnType::Int | ColumnType::Time => StaticType::Int,
        ColumnType::Enum { .. } => StaticType::Enum,
        ColumnType::Decimal { .. } | ColumnType::Money { .. } => StaticType::Decimal,
        ColumnType::Bool => StaticType::Bool,
        ColumnType::Json { .. } => StaticType::Json,
        ColumnType::Optional(inner) => StaticType::Optional(Box::new(static_column_type(inner))),
        ColumnType::List { of, .. } => StaticType::List {
            of: Box::new(static_column_type(of)),
            len: None,
        },
    }
}

fn static_arg_type(value: &ArgType) -> StaticType {
    match value {
        ArgType::Cursor => StaticType::Cursor,
        ArgType::Id => StaticType::Id,
        ArgType::Principal => StaticType::Principal,
        ArgType::Ref { table } => StaticType::Ref(table.clone()),
        ArgType::Text { .. } => StaticType::Text,
        ArgType::Bytes { .. } => StaticType::Bytes,
        ArgType::Image { .. } => StaticType::Asset(crate::assets::AssetKind::Image),
        ArgType::Video { .. } => StaticType::Asset(crate::assets::AssetKind::Video),
        ArgType::Int | ArgType::Time => StaticType::Int,
        ArgType::Enum { .. } => StaticType::Enum,
        ArgType::Decimal { .. } | ArgType::Money { .. } => StaticType::Decimal,
        ArgType::Bool => StaticType::Bool,
        ArgType::Json { .. } => StaticType::Json,
        ArgType::Optional(inner) => StaticType::Optional(Box::new(static_arg_type(inner))),
        ArgType::List { of, .. } => StaticType::List {
            of: Box::new(
                of.as_deref()
                    .map(static_arg_type)
                    .unwrap_or(StaticType::Unknown),
            ),
            len: None,
        },
        ArgType::Scalar => StaticType::Unknown,
    }
}

fn unwrap_static_type(value: &StaticType) -> &StaticType {
    match value {
        StaticType::Optional(inner) => unwrap_static_type(inner),
        value => value,
    }
}

fn unwrap_column_type(value: &ColumnType) -> &ColumnType {
    match value {
        ColumnType::Optional(inner) => unwrap_column_type(inner),
        value => value,
    }
}

fn asset_member_type(kind: crate::assets::AssetKind, name: &str) -> Option<StaticType> {
    match (kind, name) {
        // @ref LLP 1006#1-the-move — the closed asset record and wire expose id as a string, not a nominal row Id.
        (_, "id") => Some(StaticType::Text),
        (_, "width" | "height") | (crate::assets::AssetKind::Video, "duration") => {
            Some(StaticType::Int)
        }
        _ => None,
    }
}

fn common_static_type(values: impl IntoIterator<Item = StaticType>) -> StaticType {
    let mut values = values.into_iter();
    let Some(first) = values.next() else {
        return StaticType::Unknown;
    };
    values
        .all(|value| value == first)
        .then_some(first)
        .unwrap_or(StaticType::Unknown)
}

fn is_static_id(value: &StaticType) -> bool {
    matches!(
        unwrap_static_type(value),
        StaticType::WireId | StaticType::Id | StaticType::Principal | StaticType::Ref(_)
    )
}

fn matches_static_column(actual: &StaticType, expected: &ColumnType) -> Option<bool> {
    if matches!(
        unwrap_static_type(actual),
        StaticType::Unknown | StaticType::Json
    ) {
        return None;
    }
    match expected {
        ColumnType::Optional(inner) => {
            if matches!(actual, StaticType::Null) {
                Some(true)
            } else {
                matches_static_column(unwrap_static_type(actual), inner)
            }
        }
        ColumnType::List { of, .. } => match unwrap_static_type(actual) {
            StaticType::List { of: actual, .. } => matches_static_column(actual, of),
            _ => Some(false),
        },
        ColumnType::Json { .. } => Some(true),
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => {
            Some(is_static_id(actual))
        }
        ColumnType::Text { .. } => Some(matches!(
            unwrap_static_type(actual),
            StaticType::Text | StaticType::Enum
        )),
        ColumnType::Bytes { .. } => Some(matches!(unwrap_static_type(actual), StaticType::Bytes)),
        ColumnType::Image { .. } => Some(matches!(
            unwrap_static_type(actual),
            StaticType::Asset(crate::assets::AssetKind::Image)
        )),
        ColumnType::Video { .. } => Some(matches!(
            unwrap_static_type(actual),
            StaticType::Asset(crate::assets::AssetKind::Video)
        )),
        ColumnType::Int | ColumnType::Time => {
            Some(matches!(unwrap_static_type(actual), StaticType::Int))
        }
        ColumnType::Enum { .. } => Some(matches!(
            unwrap_static_type(actual),
            StaticType::Text | StaticType::Enum
        )),
        ColumnType::Decimal { .. } | ColumnType::Money { .. } => Some(matches!(
            unwrap_static_type(actual),
            StaticType::Int | StaticType::Decimal
        )),
        ColumnType::Bool => Some(matches!(unwrap_static_type(actual), StaticType::Bool)),
    }
}

fn literal_matches_column(value: &Value, expected: &ColumnType) -> bool {
    matches_static_column(&static_literal_type(value), expected).unwrap_or(true)
}

fn register_site(
    sites: &mut BTreeMap<String, ReadSiteShape>,
    errors: &mut Vec<CheckError>,
    site: &str,
    shape: ReadSiteShape,
) {
    if let Some(existing) = sites.get(site) {
        if existing != &shape {
            errors.push(CheckError {
                site: None,
                code: "E_TRACE_SUBSET".to_owned(),
                message: format!(
                    "read site {site} is reused for incompatible shapes {existing:?} and {shape:?}"
                ),
                rewrite: "give every distinct read a unique site label".to_owned(),
            });
        }
    } else {
        sites.insert(site.to_owned(), shape);
    }
}

fn literal_is_i53(value: &Value) -> bool {
    match value {
        Value::Int(value) => (I53_MIN..=I53_MAX).contains(value),
        Value::Array(values) => values.iter().all(literal_is_i53),
        Value::Row(values) | Value::Map(values) => values.values().all(literal_is_i53),
        Value::Null | Value::Bool(_) | Value::String(_) | Value::Id(_) | Value::Bytes(_) => true,
    }
}

fn validate_read(checker: &Checker<'_>, table: &str, index: &str, errors: &mut Vec<CheckError>) {
    let error = if table.starts_with('_') {
        Some(CheckError {
            site: None,
            code: "E_SCHEMA_RESERVED".to_owned(),
            message: format!("program reads reserved table {table}"),
            rewrite: "use the dedicated runtime verb for engine-owned data".to_owned(),
        })
    } else if checker
        .schema
        .table(table)
        .and_then(|table| table.index(index))
        .is_none()
    {
        Some(CheckError {
            site: None,
            code: "E_UNBOUND_SCAN".to_owned(),
            message: format!("read requires missing index {table}.{index}"),
            rewrite: "declare the composite index in the schema".to_owned(),
        })
    } else {
        None
    };
    if let Some(error) = error {
        errors.push(error);
    }
}

fn validate_point_key_arity(checker: &Checker<'_>, read: &Read, errors: &mut Vec<CheckError>) {
    let Some(index) = checker
        .schema
        .table(&read.table)
        .and_then(|table| table.index(&read.index))
    else {
        return;
    };
    if read.key.len() == index.columns.len() {
        return;
    }
    errors.push(CheckError {
        site: None,
        code: "E_ARGS_TYPE".to_owned(),
        message: format!(
            "point read {} key supplies {} components but {}.{} has {} columns",
            read.site,
            read.key.len(),
            read.table,
            read.index,
            index.columns.len(),
        ),
        rewrite: format!(
            "supply exactly {} key components when reading {}.{}",
            index.columns.len(),
            read.table,
            read.index,
        ),
    });
}

/// Every expression a statement holds directly (bodies excluded), each walked in full.
pub(crate) fn visit_statement_exprs(statement: &Stmt, visit: &mut impl FnMut(&Expr)) {
    match statement {
        Stmt::Const { value, .. }
        | Stmt::Let { value, .. }
        | Stmt::Assign { value, .. }
        | Stmt::Push { value, .. }
        | Stmt::Return(value) => walk_expr(value, visit),
        Stmt::If { condition, .. } => walk_expr(condition, visit),
        Stmt::For { domain, .. } => match domain {
            LoopDomain::Page(scan) => walk_expr(&Expr::Scan(scan.clone()), visit),
            LoopDomain::DerivedArray { value, .. } => walk_expr(value, visit),
            LoopDomain::Recurse(recurse) => walk_expr(&recurse.seed, visit),
            LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => {}
        },
        Stmt::Require { condition, .. } => walk_expr(condition, visit),
        Stmt::Insert { row, .. } => walk_expr(row, visit),
        Stmt::Update { key, patch, .. } => {
            walk_expr(key, visit);
            walk_expr(patch, visit);
        }
        Stmt::Upsert { key, row, .. } => {
            walk_expr(key, visit);
            walk_expr(row, visit);
        }
        Stmt::Delete { key, .. } => walk_expr(key, visit),
        Stmt::Emit { payload, .. } => walk_expr(payload, visit),
        Stmt::Break | Stmt::Continue => {}
    }
}

fn walk_expr(expression: &Expr, visit: &mut impl FnMut(&Expr)) {
    visit(expression);
    match expression {
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => walk_expr(base, visit),
        Expr::Binary { left, right, .. } => {
            walk_expr(left, visit);
            walk_expr(right, visit);
        }
        Expr::Array(values) | Expr::Builtin { args: values, .. } => {
            values.iter().for_each(|value| walk_expr(value, visit));
        }
        Expr::Object(values) => values.values().for_each(|value| walk_expr(value, visit)),
        Expr::Get(read) | Expr::Exists(read) => {
            read.key.iter().for_each(|value| walk_expr(value, visit));
        }
        Expr::Scan(scan) => {
            scan.prefix.iter().for_each(|value| walk_expr(value, visit));
            [scan.after.as_deref(), scan.before.as_deref()]
                .into_iter()
                .flatten()
                .for_each(|value| walk_expr(value, visit));
            if let Some(range) = &scan.range {
                [
                    range.gt.as_deref(),
                    range.gte.as_deref(),
                    range.lt.as_deref(),
                    range.lte.as_deref(),
                ]
                .into_iter()
                .flatten()
                .for_each(|value| walk_expr(value, visit));
            }
        }
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
    }
}
