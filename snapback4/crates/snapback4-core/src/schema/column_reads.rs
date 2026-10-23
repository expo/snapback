//! Payload authority is narrower than row authority, never a write grant.
// @ref LLP 3000.036#22-colr-column-read-rules-0435-proposal — one admission and projection contract on every host.
use super::*;

impl RuleExpr {
    pub fn column_row_local(&self) -> bool {
        match self {
            Self::Allow | Self::Deny | Self::Public { .. } => true,
            Self::Eq(a, b) | Self::Ne(a, b) => [a, b].iter().all(|t| {
                matches!(
                    t,
                    RuleTerm::Field(_) | RuleTerm::Viewer | RuleTerm::Literal(_)
                )
            }),
            Self::And(xs) | Self::Or(xs) => xs.iter().all(Self::column_row_local),
            Self::Not(x) => x.column_row_local(),
            _ => false,
        }
    }
}

struct NoProbe;
impl crate::engine::rules::Probe for NoProbe {
    fn exists(
        &mut self,
        _: &str,
        _: &str,
        _: &[Value],
        _: &[(String, Value)],
    ) -> Result<bool, crate::error::RuntimeError> {
        Ok(false)
    }
    fn created(&mut self, _: &str, _: &str, _: &[Value]) -> bool {
        false
    }
}

impl Table {
    pub fn read_optional(&self, field: &str) -> bool {
        self.private_field(field) || self.column_reads.contains_key(field)
    }
    pub fn column_server_reads(&self) -> bool {
        self.column_reads.values().any(|r| !r.column_row_local())
    }
    /// No external witness is inferred from an omitted device cell.
    pub fn local_column_readable(&self, field: &str, row: &Value, viewer: Option<&str>) -> bool {
        let Some(rule) = self.column_reads.get(field) else {
            return true;
        };
        let Some(viewer) = viewer else { return false };
        rule.column_row_local()
            && crate::engine::rules::evaluate(
                rule,
                viewer,
                None,
                &row_image(row, self),
                false,
                &mut NoProbe,
            )
            .unwrap_or(false)
    }
}

struct Walk<'a> {
    schema: &'a Schema,
    issues: Vec<SchemaIssue>,
}
impl Walk<'_> {
    fn issue(&mut self, path: &str, message: String) {
        self.issues.push(SchemaIssue { path: path.into(), message: format!("column read: {message}; use an ordinary public key or a separate entity for structural data (guide rules)") });
    }
    fn field(&mut self, table: &str, field: &str, path: &str) {
        if self
            .schema
            .table(table)
            .is_some_and(|t| t.column_reads.contains_key(field))
        {
            self.issue(path, format!("{table}.{field} is protected and cannot decide authority, identity, lifetime, order or derived storage"));
        }
    }
    fn term(&mut self, table: &str, term: &RuleTerm, path: &str) {
        match term {
            RuleTerm::Field(f) | RuleTerm::OldField(f) | RuleTerm::NextField(f) => {
                self.field(table, f, path)
            }
            RuleTerm::Reference { column, .. } | RuleTerm::ReferenceChain { column, .. } => {
                self.field(table, column, path);
                for (target, field) in term.references() {
                    self.field(target, field, path);
                }
            }
            _ => {}
        }
    }
    fn rule(&mut self, table: &str, rule: &RuleExpr, path: &str) {
        match rule {
            RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) | RuleExpr::Compare(_, a, b) => {
                self.term(table, a, path);
                self.term(table, b, path);
            }
            RuleExpr::And(xs) | RuleExpr::Or(xs) => {
                for x in xs {
                    self.rule(table, x, path);
                }
            }
            RuleExpr::Not(x) => self.rule(table, x, path),
            RuleExpr::Exists {
                table: target,
                index,
                key,
                equalities,
                ..
            }
            | RuleExpr::Created {
                table: target,
                index,
                key,
                equalities,
                ..
            } => {
                if let Some(index) = self.schema.table(target).and_then(|t| t.index(index)) {
                    for field in index.columns() {
                        self.field(target, &field, path);
                    }
                }
                for term in key {
                    self.term(table, term, path);
                }
                for (field, term) in equalities {
                    self.field(target, field, path);
                    self.term(table, term, path);
                }
            }
            _ => {}
        }
    }
    fn column_rule(&mut self, name: &str, rule: &RuleExpr, path: &str) {
        let valid_term = |t: &RuleTerm| {
            matches!(
                t,
                RuleTerm::Field(_) | RuleTerm::Viewer | RuleTerm::Literal(_)
            )
        };
        if rule.any_term(&|t| !valid_term(t)) {
            self.issue(path,"column rules use current row fields, viewer and literals; use a unique exists probe for a parent".into());
        }
        match rule {
            RuleExpr::Created { .. } | RuleExpr::Compare(..) => self.issue(
                path,
                "column rules use the read grammar, without created or ordered comparisons".into(),
            ),
            RuleExpr::And(xs) | RuleExpr::Or(xs) => {
                for x in xs {
                    self.column_rule(name, x, path);
                }
            }
            RuleExpr::Not(x) => self.column_rule(name, x, path),
            _ => {}
        }
        // Owner-private fields are also inadmissible policy inputs.
        let mut private = false;
        if let Some(table) = self.schema.table(name) {
            private |= rule.any_term(&|t| matches!(t,RuleTerm::Field(f) if table.private_field(f)));
        }
        if let RuleExpr::Exists {
            table: target,
            index,
            equalities,
            ..
        } = rule
            && let Some(target) = self.schema.table(target)
        {
            private |= equalities.iter().any(|(f, _)| target.private_field(f))
                || target
                    .index(index)
                    .is_some_and(|i| i.columns().iter().any(|f| target.private_field(f)));
        }
        if private {
            self.issue(
                path,
                "column rules cannot depend on owner-private fields".into(),
            );
        }
    }
}

/// Raw catalogs and the binder share the complete resolved dependency census.
pub fn validate(schema: &Schema) -> Vec<SchemaIssue> {
    if schema.tables.values().all(|t| t.column_reads.is_empty()) {
        return Vec::new();
    }
    let mut walk = Walk {
        schema,
        issues: Vec::new(),
    };
    for (name, table) in &schema.tables {
        let path = format!("tables.{name}.column_reads");
        for (field, rule) in &table.column_reads {
            let path = format!("tables.{name}.columns.{field}");
            if field == "id" || !table.columns.contains_key(field) || table.engine_field(field) {
                walk.issue(&path,"a column rule names an ordinary declared payload column, never id or a capture".into());
            }
            super::validate_rule(schema, table, rule, false, false, &path, &mut walk.issues);
            walk.column_rule(name, rule, &path);
            walk.rule(name, rule, &path);
        }
        for rule in [
            &table.rules.read,
            &table.rules.insert,
            &table.rules.update,
            &table.rules.delete,
        ] {
            walk.rule(name, rule, &path);
        }
        for rule in table.column_writes.values().chain(table.frozen_columns.values()){walk.rule(name,rule,&path);}
        for index in table.indexes.values() {
            for field in table.column_reads.keys().filter(|f| index.uses_column(f)) {
                walk.field(name, field, &path);
            }
        }
        for c in &table.constraints {
            match c {
                Constraint::Cap { by: fields, .. } => {
                    for f in fields {
                        walk.field(name, f, &path);
                    }
                }
                Constraint::FinalExistsOnInsert {
                    table: target,
                    index,
                    key,
                } => {
                    if let Some(index) = schema.table(target).and_then(|t| t.index(index)) {
                        for f in index.columns() {
                            walk.field(target, &f, &path);
                        }
                    }
                    for term in key {
                        walk.term(name, term, &path);
                    }
                }
                _ => {}
            }
        }
        for f in table
            .expire
            .iter()
            .chain(table.not_before.iter())
            .chain(table.sequences.keys())
            .chain(table.sequences.values())
        {
            walk.field(name, f, &path);
        }
        for authority in table.written_by.values() {
            walk.field(name, &authority.owner, &path);
        }
        for capture in table.recorded.values() {
            walk.field(name, &capture.reference, &path);
            walk.field(&capture.table, &capture.column, &path);
        }
        if let Some(t) = &table.through {
            walk.field(name, &t.reference, &path);
            for field in t.fields.values() {
                walk.field(&t.parent, field, &path);
            }
        }
        if let Some(sync) = &table.sync {
            for (a, _) in sync.arms() {
                for f in a.columns() {
                    walk.field(name, &f, &path);
                }
                if let Audience::Target {
                    table: target,
                    principal,
                    ..
                } = a
                {
                    walk.field(target, principal, &path);
                }
            }
        }
    }
    for m in &schema.maintains {
        let path = format!("maintain {}", m.label());
        for field in m.dependencies() {
            walk.field(&m.source, &field, &path);
        }
        if let Some(key) = &m.row_key {
            for field in key.fields() {
                walk.field(&key.table, &field, &path);
            }
        }
        if let Some(rule) = &m.readable {
            walk.rule(&m.target, rule, &path);
        }
    }
    for t in &schema.timelines {
        let path = format!("timeline {}", t.name);
        for mapping in [&t.authors[..], &t.posts[..], &t.reposts[..], &t.edges[..]] {
            for field in &mapping[1..] {
                walk.field(&mapping[0], field, &path);
            }
        }
        if let Some(filter) = &t.filter {
            let mut fields = BTreeSet::new();
            filter.fields(&mut fields);
            for f in fields {
                walk.field(&t.posts[0], &f, &path);
            }
        }
    }
    for f in &schema.receipts {
        for (table, fields) in [
            (
                &f.messages,
                vec![
                    &f.message_group,
                    &f.position,
                    &f.sender,
                    &f.delivered_field,
                    &f.seen_field,
                ],
            ),
            (
                &f.members,
                vec![&f.group, &f.principal, &f.counter, &f.floor, &f.count],
            ),
            (&f.runs, vec![&f.run_group]),
        ] {
            for field in fields {
                walk.field(table, field, "receipts");
            }
        }
    }
    walk.issues
}
