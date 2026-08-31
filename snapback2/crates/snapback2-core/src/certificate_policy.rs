//! Structural admission and certified rule-uniformity for data programs.

use crate::certificate::{CheckError, Checker};
use crate::ir::*;
use crate::schema::{RuleExpr, RuleTerm, Schema};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct CappedSite {
    site: String,
    table: String,
    index: String,
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

    fn sensitive_sites(&self) -> BTreeSet<CappedSite> {
        self.pages.union(&self.structural).cloned().collect()
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
        RuleExpr::Exists { key, .. } => {
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
    pub(crate) fn structural_errors(&self, program: &Program) -> Vec<CheckError> {
        let mut errors = Vec::new();
        validate_statements(self, program, &program.body, &mut errors);
        let mut flow = CompletenessFlow {
            schema: self.schema,
            env: BTreeMap::new(),
            errors: &mut errors,
        };
        flow.statements(&program.body, &BTreeSet::new());
        errors
    }
}

struct CompletenessFlow<'a, 'b> {
    schema: &'a Schema,
    env: BTreeMap<String, Fact>,
    errors: &'b mut Vec<CheckError>,
}

impl CompletenessFlow<'_, '_> {
    fn statements(&mut self, statements: &[Stmt], control: &BTreeSet<CappedSite>) {
        for statement in statements {
            match statement {
                Stmt::Const { name, value } | Stmt::Let { name, value } => {
                    let fact = self.expr(value);
                    self.env.insert(name.clone(), fact);
                }
                Stmt::Assign { name, value } => {
                    let mut fact = self.expr(value);
                    fact.structural.extend(control.iter().cloned());
                    self.env.insert(name.clone(), fact);
                }
                Stmt::Push { target, value } => {
                    let fact = self.expr(value);
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
                    self.statements(then_body, &nested_control);
                    let then_env = self.env.clone();
                    self.env = before;
                    self.statements(else_body, &nested_control);
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
                    nested_control.extend(domain.sensitive_sites());
                    let previous = self.env.insert(binding.clone(), Fact::default());
                    self.statements(body, &nested_control);
                    if let Some(previous) = previous {
                        self.env.insert(binding.clone(), previous);
                    } else {
                        self.env.remove(binding);
                    }
                }
                Stmt::Return(value) => {
                    let fact = self.expr(value);
                    self.refuse_sink("returned result", &fact.structural, control);
                }
                Stmt::Require { condition, .. } => {
                    let fact = self.expr(condition).made_structural();
                    self.refuse_sink("require branch", &fact.structural, control);
                }
                Stmt::Insert { row, .. } => {
                    let fact = self.expr(row);
                    self.refuse_sink("inserted value", &fact.structural, control);
                }
                Stmt::Update { key, patch, .. } => {
                    let mut fact = self.expr(key);
                    fact.merge(self.expr(patch));
                    self.refuse_sink("updated value", &fact.structural, control);
                }
                Stmt::Upsert { key, row, .. } => {
                    let mut fact = self.expr(key);
                    fact.merge(self.expr(row));
                    self.refuse_sink("upserted value", &fact.structural, control);
                }
                Stmt::Delete { key, .. } => {
                    let fact = self.expr(key);
                    self.refuse_sink("deleted key", &fact.structural, control);
                }
                Stmt::Emit { payload, .. } => {
                    let fact = self.expr(payload);
                    self.refuse_sink("emitted value", &fact.structural, control);
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
            Expr::Field { base, name } => {
                let fact = self.expr(base);
                if name == "hasMore" {
                    fact.made_structural()
                } else {
                    Fact {
                        structural: fact.structural,
                        ..Fact::default()
                    }
                }
            }
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
                    Builtin::Slice | Builtin::Concat | Builtin::Sort { .. } => fact,
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
    ) {
        let sites: BTreeSet<_> = structural.union(control).cloned().collect();
        for site in sites {
            self.errors.push(CheckError {
                code: "E_STRUCTURAL_COUNT".to_owned(),
                message: format!(
                    "{sink} depends on capped-only site {}; its read rule is not uniform over the scanned prefix",
                    site.site
                ),
                rewrite: format!(
                    "denormalize the authorization scope onto {} and include it in the {} prefix so the rule is uniform, or declare maintain.count({}, {{ by: [...], as: ..., readable: ... }}) and read the maintained aggregate",
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
) {
    for statement in statements {
        match statement {
            Stmt::Insert { table, .. }
            | Stmt::Update { table, .. }
            | Stmt::Upsert { table, .. }
            | Stmt::Delete { table, .. } => {
                if table.starts_with('_') {
                    errors.push(CheckError {
                        code: "E_SCHEMA_RESERVED".to_owned(),
                        message: format!("program names reserved table {table}"),
                        rewrite: "use an application table name that does not begin with '_'"
                            .to_owned(),
                    });
                }
                if program.kind == ProgramKind::Query {
                    errors.push(CheckError {
                        code: "E_WRITE_IN_QUERY".to_owned(),
                        message: "a query cannot write durable data".to_owned(),
                        rewrite: "move the write into a mutation".to_owned(),
                    });
                }
                if !table.starts_with('_') && checker.schema.table(table).is_none() {
                    errors.push(CheckError {
                        code: "E_UNBOUND_SCAN".to_owned(),
                        message: format!("write requires missing table {table}"),
                        rewrite: "declare the table in the schema".to_owned(),
                    });
                }
            }
            Stmt::Emit { .. } if program.kind == ProgramKind::Query => {
                errors.push(CheckError {
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
                validate_statements(checker, program, then_body, errors);
                validate_statements(checker, program, else_body, errors);
            }
            Stmt::For { body, .. } => validate_statements(checker, program, body, errors),
            _ => {}
        }
        visit_statement_exprs(statement, &mut |expression| {
            validate_expr(checker, program, expression, errors)
        });
    }
}

fn validate_expr(
    checker: &Checker<'_>,
    program: &Program,
    expression: &Expr,
    errors: &mut Vec<CheckError>,
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
            validate_read(checker, &read.table, &read.index, errors)
        }
        Expr::Scan(scan) => {
            validate_read(checker, &scan.table, &scan.index, errors);
            if let Bound::Arg { name, .. } = &scan.take
                && !program.args.contains_key(name)
            {
                errors.push(CheckError {
                    code: "E_UNBOUND_SCAN".to_owned(),
                    message: format!("scan {} take arg {name} is not declared", scan.site),
                    rewrite: "declare the bounded take argument on the program".to_owned(),
                });
            }
        }
        _ => {}
    }
}

fn validate_read(checker: &Checker<'_>, table: &str, index: &str, errors: &mut Vec<CheckError>) {
    let error = if table.starts_with('_') {
        Some(CheckError {
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

fn visit_statement_exprs(statement: &Stmt, visit: &mut impl FnMut(&Expr)) {
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
            LoopDomain::Recurse(recurse) => {
                walk_expr(
                    &Expr::Get(Read {
                        site: recurse.site.clone(),
                        table: recurse.table.clone(),
                        index: recurse.index.clone(),
                        key: vec![*recurse.seed.clone()],
                        provenance: recurse.provenance,
                    }),
                    visit,
                );
            }
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
