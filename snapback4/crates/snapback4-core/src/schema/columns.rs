//! Maintained fields and the resolved authority/identity/delivery dependency walk.
// @ref LLP 3000.007.001#2 — the binder and raw-schema admission share this walk.
use super::*;

pub const GROUP: &str = "$parent";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnOwner {
    pub table: String,
    pub column: String,
}

impl ColumnOwner {
    pub fn label(&self) -> String { format!("{}.{}", self.table, self.column) }
    // Bounded labels also keep a first contribution independent of parent state.
    pub fn target(&self) -> String { format!("$column:{}", digest(&(&self.table, &self.column))) }
}

impl Schema {
    fn private_owner(&self, name: &str) -> Option<&ColumnOwner> {
        // Privacy also holds before admission: a duplicate ordinary declaration
        // must never shadow a private one in a raw schema.
        self.maintains.iter().filter(|m| m.target == name).find_map(|m| m.private.as_ref())
    }

    pub fn visible(&self, name: &str) -> bool { self.private_owner(name).is_none() && !self.is_recount_work(name) }

    pub fn visible_tables(&self) -> impl Iterator<Item = (&String, &Table)> {
        self.tables.iter().filter(|(name, _)| self.visible(name))
    }

    // @ref LLP 3000.007.001#3.2 — identity remains on Table, which image-retention compares.
    pub fn public_projection(&self) -> Self {
        let mut schema = self.clone();
        // Inspection provenance is catalog side metadata, never device input.
        #[cfg(feature = "sqlite")]
        { schema.authored_indexes = Default::default(); }
        schema.prepare_receipt_dependencies();
        schema.receipt_dependencies.retain(|name, _| self.visible(name));
        schema.source_reservations.retain(|name, _| self.visible(name));
        schema.tables.retain(|name, _| self.visible(name));
        schema.maintains.retain(|m| self.visible(&m.target));
        schema
    }

    pub fn refuse_private(&self, name: &str) -> Result<(), crate::error::RuntimeError> {
        if self.is_recount_work(name) { return Err(crate::error::RuntimeError::Structural {code:"E_VIEW_KEY",message:"recount state is engine-owned; read the row-keyed view instead (guide maintains)".into()}); }
        if let Some(owner) = self.private_owner(name) {
            return Err(crate::error::RuntimeError::Structural { code: "E_MAINTAINED_COLUMN_PRIVATE",
                message: format!("{} is maintained by the engine; read the parent row or write the source rows (guide maintains)", owner.label()) });
        }
        Ok(())
    }

    /// A projected device schema deliberately has metadata without private maintains.
    /// Authoritative engines must have exactly one derivation for every owned field.
    pub fn validate_column_owners(&self) -> Result<(), crate::error::RuntimeError> {
        for (name,table) in self.visible_tables() {
            for column in table.maintained.keys() {
                if self.maintains.iter().filter(|m|m.private.as_ref().is_some_and(|o|&o.table == name && &o.column == column)).count() != 1 {
                    return Err(crate::error::RuntimeError::Schema(format!("{name}.{column} needs exactly one engine derivation; declare the column aggregate (guide maintains)")));
                }
            }
        }
        Ok(())
    }
}

impl Maintain {
    pub fn group_fields(&self) -> Vec<String> {
        if self.private.is_some() { vec![GROUP.into()] } else { self.by.clone() }
    }

    pub fn derivation_identity(&self) -> String { digest(&(&self.kind, &self.source, &self.filter, &self.by)) }
    pub fn label(&self) -> String { self.private.as_ref().map_or_else(|| self.target.clone(), ColumnOwner::label) }
}

struct Walk<'a> { schema: &'a Schema, issues: Vec<SchemaIssue> }
impl Walk<'_> {
    fn issue(&mut self, path: &str, label: &str) {
        self.issues.push(SchemaIssue { path: path.into(), message: format!("maintained column {label} is depended on by {path}; use an ordinary column for authority, identity, lifetime or delivery, or a separate maintain for an aggregate (guide maintains)") });
    }
    fn target(&mut self, table: &str, path: &str) {
        if self.schema.is_recount_work(table) {self.issues.push(SchemaIssue {path:path.into(),message:"E_VIEW_KEY: recount state is engine-owned; read the row-keyed view instead (guide maintains)".into()});}
        if let Some(owner) = self.schema.private_owner(table) { self.issue(path, &owner.label()); }
    }
    fn field(&mut self, table: &str, field: &str, path: &str) {
        if let Some(message) = self.schema.row_view_predicate_field(table, field) {
            self.issues.push(SchemaIssue { path: path.into(), message });
        }
        if self.schema.table(table).is_some_and(|t| t.maintained.contains_key(field)) { self.issue(path, &format!("{table}.{field}")); }
    }
    fn term(&mut self, table: &str, term: &RuleTerm, path: &str) {
        if let RuleTerm::Field(field) | RuleTerm::OldField(field) | RuleTerm::NextField(field) = term { self.field(table, field, path); }
    }
    fn index(&mut self, table: &str, index: &str, path: &str) {
        self.target(table, path);
        if let Some(definition) = self.schema.table(table) && let Some(index) = definition.index(index) {
            for field in definition.maintained.keys().filter(|field| index.uses_column(field)) { self.field(table, field, path); }
            for field in index.columns() {
                if let Some(message) = self.schema.row_view_predicate_field(table, &field) {
                    self.issues.push(SchemaIssue { path: path.into(), message });
                }
            }
        }
    }
    fn rule(&mut self, table: &str, rule: &RuleExpr, path: &str) {
        match rule {
            RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => {},
            RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) | RuleExpr::Compare(_,a,b) => { self.term(table,a,path); self.term(table,b,path); },
            RuleExpr::And(items) | RuleExpr::Or(items) => for item in items { self.rule(table,item,path); },
            RuleExpr::Not(item) => self.rule(table,item,path),
            RuleExpr::Exists { table: target, index, key, equalities, .. } | RuleExpr::Created { table: target, index, key, equalities, .. } => {
                self.index(target,index,path);
                for term in key { self.term(table,term,path); }
                for (field,term) in equalities { self.field(target,field,path); self.term(table,term,path); }
            }
        }
    }
}

/// Owned timeline rows are written only on the timeline's scoped transition
/// path, even if their stored ownership sets are forged. Mapped application
/// tables stay ordinary parents and sources: the mirror is not a source write,
/// so it never enters a transition, and delivery copies no parent fields.
// @ref LLP 3000.007.003#33-f3-the-following-recipes-contract-as-a-declaration — timeline writes require their scoped transition path.
pub fn timeline_issues(schema: &Schema) -> Vec<SchemaIssue> {
    let mut issues = Vec::new();
    for m in &schema.maintains {
        let Some(owner) = &m.private else { continue };
        for (role, table) in [("parent", &owner.table), ("source", &m.source)] {
            if let Some(timeline) = schema.timelines.iter().find(|t| t.owns(table)) {
                issues.push(SchemaIssue { path: format!("tables.{}.columns.{}", owner.table, owner.column),
                    message: format!("maintained column {} has timeline-owned {role} {table} in {}; the timeline writes its own tables, so use a table it maps, such as its posts, or an ordinary table (guide maintains)", owner.label(), timeline.name) });
            }
        }
    }
    issues
}

pub fn validate(schema: &Schema) -> Vec<SchemaIssue> {
    let mut walk = Walk { schema, issues: Vec::new() };
    walk.issues.extend(timeline_issues(schema));
    let mut targets = BTreeSet::new();
    for (position, m) in schema.maintains.iter().enumerate() {
        if !targets.insert(&m.target) {
            let label = schema.private_owner(&m.target).map_or_else(|| m.target.clone(), ColumnOwner::label);
            walk.issues.push(SchemaIssue { path: format!("maintains[{position}]"),
                message: format!("duplicate maintain target {label}; each target needs exactly one derivation (guide maintains)") });
        }
    }
    for (name, table) in schema.visible_tables() {
        for (field, identity) in &table.maintained {
            if identity.is_empty() || table.defaults.contains_key(field) || table.recorded.contains_key(field)
                || !matches!(table.columns.get(field), Some(ColumnType::Int | ColumnType::Decimal { .. } | ColumnType::Money { .. })) {
                walk.issue(&format!("tables.{name}.columns.{field}"), &format!("{name}.{field}"));
            }
        }
        for (effect, rule) in [("read", &table.rules.read), ("insert", &table.rules.insert), ("update", &table.rules.update), ("delete", &table.rules.delete)] {
            walk.rule(name, rule, &format!("tables.{name}.rules.{effect}"));
        }
        for (index_name,index) in &table.indexes {
            let path = format!("tables.{name}.indexes.{index_name}");
            if index.unique || schema.maintain_for(name).is_some_and(|m| m.row_key.is_some()) {
                walk.index(name,index_name,&path);
            }
            for component in &index.components {
                if let IndexComponent::WordPrefixes { fields, .. } = component { for field in fields { walk.field(name,field,&path); } }
                if let IndexComponent::Contribution(m) = component {
                    walk.target(&m.target,&path);
                    walk.target(&m.source,&path);
                    for field in m.dependencies() { walk.field(&m.source,&field,&path); }
        if let Some(k)=&m.row_key {for field in k.fields() {walk.field(&k.table,&field,&path);}}
                }
            }
        }
        for constraint in &table.constraints {
            let path = format!("tables.{name}.constraint");
            match constraint {
                Constraint::Unique { index } => walk.index(name,index,&path),
                Constraint::Cap { by: fields, .. } | Constraint::Immutable { fields } => for field in fields { walk.field(name,field,&path); },
                Constraint::Text { field, .. } => walk.field(name,field,&path),
                Constraint::FinalExistsOnInsert { table: target, index, key } => {
                    walk.index(target,index,&path);
                    for term in key { walk.term(name,term,&path); }
                },
                Constraint::AppendOnly | Constraint::Recorded | Constraint::Capabilities(_) => {},
            }
        }
        if let Some(field) = &table.expire { walk.field(name,field,&format!("tables.{name}.expire")); }
        for field in table.defaults.keys() { walk.field(name,field,&format!("tables.{name}.default")); }
        for (field,capture) in &table.recorded {
            let path = format!("tables.{name}.recorded.{field}");
            walk.field(name,&capture.reference,&path);
            walk.target(&capture.table,&path);
            walk.field(&capture.table,&capture.column,&path);
        }
        if let Some(sync) = &table.sync {
            let path = format!("tables.{name}.sync");
            if let Some(horizon) = &sync.horizon { walk.index(name,&horizon.by,&path); }
            match &sync.audience {
                Audience::Public => {},
                Audience::Column(field) => walk.field(name,field,&path),
                Audience::Target { table: target, prefix, principal } => {
                    walk.target(target,&path);
                    for field in prefix { walk.field(name,field,&path); walk.field(target,field,&path); }
                    walk.field(target,principal,&path);
                    // Resolved rule probes above carry the target index's actual columns.
                },
            }
        }
        for (field,kind) in &table.columns {
            if let ColumnType::Ref { table: target } = kind.required() { walk.target(target,&format!("tables.{name}.columns.{field}")); }
        }
    }
    for m in &schema.maintains {
        let path = format!("maintain {}",m.label());
        if let Some(rule) = &m.readable { walk.rule(&m.target,rule,&path); }
        if schema.maintain_for(&m.source).is_some() {
            walk.issues.push(SchemaIssue { path: path.clone(), message: format!("{path} takes generated source {}; use ordinary source rows; aggregate cascades are not supported (guide maintains)", schema.maintain_for(&m.source).unwrap().label()) });
        }
        for field in m.dependencies() { walk.field(&m.source,&field,&path); }
        if let Some(k)=&m.row_key {for field in k.fields() {walk.field(&k.table,&field,&path);}}
        if let Some(owner) = &m.private {
            if schema.maintain_for(&owner.table).is_some() {
                walk.issues.push(SchemaIssue { path, message: format!("maintained column {} belongs to generated table {}; declare it on an ordinary parent table instead (guide maintains)",owner.label(),owner.table) });
                continue;
            }
            let valid = m.target == owner.target() && m.by.len() == 1 && m.computed.is_empty() && m.readable.is_none()
                && schema.table(&owner.table).is_some_and(|t| t.maintained.get(&owner.column) == Some(&m.derivation_identity()))
                && schema.table(&m.source).is_some_and(|t| !t.is_expiring()
                    && t.columns.get(&m.by[0]).is_some_and(|kind| kind.required() == &ColumnType::Ref { table: owner.table.clone() }))
                && schema.table(&m.target).is_some_and(|t| t.sync.is_none() && t.rules == Rules::deny()
                    && schema.table(&owner.table).is_some_and(|parent|parent.columns.get(&owner.column) == t.columns.get("value")));
            if !valid { walk.issues.push(SchemaIssue { path, message: format!("{} requires one reference from a non-expiring ordinary source and a private engine-only target; use a separate maintain for expiring sources (guide maintains)",owner.label()) }); }
        }
    }
    walk.issues
}
