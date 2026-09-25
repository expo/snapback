//! Lifetime-bound rule inputs, distinct from historical recorded attribution.
// @ref LLP 3000.014#4-the-capture — captures have their parent's type and activation lifecycle.
use super::*;

pub const PARENT_DEADLINE: &str = "$parentDeadline";
pub const DEADLINE: &str = "$deadline";
pub const CHILDREN: &str = "$children";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Through {
    pub reference: String,
    pub parent: String,
    /// Child engine field -> immediate parent field (including its captures).
    pub fields: BTreeMap<String, String>,
    pub identity: String,
    pub expiring: bool,
}

impl Table {
    pub fn engine_field(&self, field: &str) -> bool {
        self.recorded.contains_key(field)
            || self.through.as_ref().is_some_and(|t| {
                t.fields.contains_key(field) || matches!(field, DEADLINE | PARENT_DEADLINE)
            })
    }
    /// One classification for every expiry gate, including inherited deadlines.
    pub fn is_expiring(&self) -> bool {
        self.expire.is_some() || self.through.as_ref().is_some_and(|t| t.expiring)
    }
    pub fn expiry_column(&self) -> Option<&str> {
        if self.through.is_some() && self.is_expiring() {
            Some(DEADLINE)
        } else {
            self.expire.as_deref()
        }
    }
    pub fn deadline(&self, row: &Value) -> Option<i64> {
        match self
            .expiry_column()
            .and_then(|field| row_image(row, self).field(field).ok().cloned())
        {
            Some(Value::Int(at)) => Some(at),
            _ => None,
        }
    }
    /// Never trust a restored effective instant; recompute from immutable capture.
    pub fn recompute_deadline(&self, row: &mut Value) -> Result<(), crate::error::RuntimeError> {
        if self.through.is_none() {
            return Ok(());
        }
        let authored = self
            .expire
            .as_ref()
            .and_then(|c| match row_image(row, self).field(c) {
                Ok(Value::Int(at)) => Some(*at),
                _ => None,
            });
        let parent = match row.field(PARENT_DEADLINE)? {
            Value::Int(at) => Some(*at),
            Value::Null => None,
            _ => {
                return Err(crate::error::RuntimeError::Input(
                    "captured parent deadline must be a time or null".into(),
                ));
            }
        };
        let deadline = authored
            .into_iter()
            .chain(parent)
            .min()
            .map(Value::Int)
            .unwrap_or(Value::Null);
        if let Value::Row(fields) | Value::Map(fields) = row {
            fields.insert(DEADLINE.into(), deadline);
        }
        Ok(())
    }
}

impl RuleExpr {
    pub fn map_fields(&self, map: &impl Fn(&str) -> String) -> Self {
        let term = |t: &RuleTerm| match t {
            RuleTerm::Field(f) => RuleTerm::Field(map(f)),
            _ => t.clone(),
        };
        match self {
            Self::Eq(a, b) => Self::Eq(term(a), term(b)),
            Self::Ne(a, b) => Self::Ne(term(a), term(b)),
            Self::And(xs) => Self::And(xs.iter().map(|r| r.map_fields(map)).collect()),
            Self::Or(xs) => Self::Or(xs.iter().map(|r| r.map_fields(map)).collect()),
            Self::Not(x) => Self::Not(Box::new(x.map_fields(map))),
            Self::Exists {
                table,
                index,
                key,
                provenance,
                equalities,
            } => Self::Exists {
                table: table.clone(),
                index: index.clone(),
                key: key.iter().map(term).collect(),
                provenance: *provenance,
                equalities: equalities
                    .iter()
                    .map(|(f, t)| (f.clone(), term(t)))
                    .collect(),
            },
            _ => self.clone(),
        }
    }
}

impl Schema {
    pub fn children(&self, parent: &str) -> impl Iterator<Item = (&String, &Table, &Through)> {
        self.tables.iter().filter_map(move |(name, t)| {
            t.through
                .as_ref()
                .filter(|c| c.parent == parent)
                .map(|c| (name, t, c))
        })
    }
    /// Stable ancestor order; admission rejects cycles before execution.
    pub fn through_order(&self) -> Vec<String> {
        fn depth(schema: &Schema, name: &str, seen: &mut BTreeSet<String>) -> usize {
            if !seen.insert(name.into()) {
                return 0;
            }
            schema
                .table(name)
                .and_then(|t| t.through.as_ref())
                .map_or(0, |t| 1 + depth(schema, &t.parent, seen))
        }
        let mut names: Vec<_> = self.tables.keys().cloned().collect();
        names.sort_by_key(|name| (depth(self, name, &mut BTreeSet::new()), name.clone()));
        names
    }
}

pub fn validate(schema: &Schema) -> Vec<SchemaIssue> {
    let mut issues = Vec::new();
    for (name, table) in &schema.tables {
        let Some(t) = &table.through else {
            continue;
        };
        let mut refuse = |message: String| {
            issues.push(SchemaIssue {
                path: format!("tables.{name}.through"),
                message,
            })
        };
        if table.leave == LeavePolicy::DeliveredHistory && table.columns.contains_key("retained") {
            refuse("read through delivered history reserves retained metadata; rename the column to wasRetained".into());
        }
        let Some(parent) = schema.table(&t.parent) else {
            refuse("read through needs an ordinary application parent table".into());
            continue;
        };
        if schema.maintain_for(&t.parent).is_some()
            || schema.timelines.iter().any(|tl| tl.owns(&t.parent))
            || !schema.visible(&t.parent)
        {
            refuse(
                "read through cannot target engine-owned rows; use an ordinary application parent"
                    .into(),
            );
        }
        if table.columns.get(&t.reference)
            != Some(&ColumnType::Ref {
                table: t.parent.clone(),
            })
            || table.defaults.contains_key(&t.reference)
            || !table.immutable_fields().any(|f| f == t.reference)
        {
            refuse(format!(
                "read through needs required `{0}: {1}` without a default and `immutable {0}`",
                t.reference, t.parent
            ));
        }
        let mut fields = BTreeSet::new();
        parent.rules.read.fields(&mut fields);
        let mapped: BTreeSet<_> = t.fields.values().cloned().collect();
        if fields != mapped
            || (parent
                .rules
                .read
                .map_fields(&|f| format!("${}.{f}", t.reference))
                != table.rules.read
                && !(parent.rules.read.is_uniformly_readable()
                    && table.rules.read.is_uniformly_readable()))
        {
            refuse("read through must preserve the parent's complete read rule and all captured inputs".into());
        }
        for (capture, field) in &t.fields {
            let kind = if field == "id" {
                Some(ColumnType::Ref {
                    table: t.parent.clone(),
                })
            } else {
                parent.columns.get(field).cloned()
            };
            if capture != &format!("${}.{field}", t.reference)
                || table.columns.get(capture) != kind.as_ref()
                || table.defaults.contains_key(capture)
                || !(field == "id"
                    || parent.engine_field(field)
                    || parent.immutable_fields().any(|f| f == field))
            {
                refuse(format!(
                    "captured {0}.{field} must be immutable and keep its stored type; add `immutable {field}` on {0}",
                    t.parent
                ));
            }
        }
        if parent
            .expire
            .as_ref()
            .is_some_and(|field| !parent.immutable_fields().any(|f| f == field))
        {
            refuse("the parent's authored deadline must be immutable".into());
        }
        if t.expiring != (table.expire.is_some() || parent.is_expiring())
            || table.is_expiring() && table.expiry_index().is_none()
        {
            refuse("read through needs the inherited expiry classification and effective deadline index".into());
        }
        for field in [PARENT_DEADLINE, DEADLINE] {
            if table.columns.get(field) != Some(&ColumnType::Optional(Box::new(ColumnType::Time)))
                || table.defaults.contains_key(field)
            {
                refuse(format!(
                    "read through needs the engine-owned optional time {field}, without a default"
                ));
            }
        }
        if table.index(CHILDREN).is_none_or(|i| {
            !i.is_plain()
                || i.unique
                || i.columns() != vec![t.reference.clone(), DEADLINE.into(), "id".into()]
        }) {
            refuse("read through needs its physical-child lifetime index".into());
        }
        let mut seen = BTreeSet::from([name.as_str()]);
        let mut p = t.parent.as_str();
        loop {
            if !seen.insert(p) {
                refuse("read through cycle; break the cycle with an ordinary read rule".into());
                break;
            }
            match schema.table(p).and_then(|t| t.through.as_ref()) {
                Some(t) => p = &t.parent,
                None => break,
            }
        }
    }
    issues
}
