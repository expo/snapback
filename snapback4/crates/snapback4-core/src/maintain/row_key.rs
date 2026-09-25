//! Row-keyed maintained view schema and predicate admission.
use super::*;
// @ref LLP 3000.015#3 — recipients are selected by one parent key, then evaluated individually.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RowKey {
    pub table: String,
    pub source_key: String,
    pub member_key: String,
    pub fanout: u64,
    pub predicate: Predicate,
}
impl RowKey {
    pub fn member_index(&self) -> String {
        format!("$view:{}", self.member_key)
    }
    pub fn live_member_index(&self) -> String {
        format!("$view:{}:live", self.member_key)
    }
    pub fn source_index(&self) -> String {
        format!("$view:{}", self.source_key)
    }
    pub fn range_index(&self, field: &str) -> String {
        format!("$view:{}:{field}", self.source_key)
    }
    pub fn fields(&self) -> BTreeSet<String> {
        let mut fields = BTreeSet::new();
        self.predicate.fields(&mut fields);
        fields
            .into_iter()
            .filter_map(|f| f.strip_prefix("$row.").map(str::to_owned))
            .collect()
    }
    pub fn matches(&self, source: &Value, member: &Value) -> bool {
        fn operand<'a>(o: &'a Operand, source: &'a Value, member: &'a Value) -> &'a Value {
            match o {
                Operand::Literal(v) => v,
                Operand::Field(f) => f
                    .strip_prefix("$row.")
                    .map_or_else(|| source.field(f), |f| member.field(f))
                    .unwrap_or(&Value::Null),
            }
        }
        fn evaluate(p: &Predicate, source: &Value, member: &Value) -> bool {
            match p {
                Predicate::Bool(v) => *v,
                Predicate::Field(f) => source.field(f) == Ok(&Value::Bool(true)),
                Predicate::Not(p) => !evaluate(p, source, member),
                Predicate::And(a, b) => evaluate(a, source, member) && evaluate(b, source, member),
                Predicate::Or(a, b) => evaluate(a, source, member) || evaluate(b, source, member),
                Predicate::Compare { op, left, right } => {
                    let (a, b) = (
                        operand(left, source, member),
                        operand(right, source, member),
                    );
                    match op.as_str() {
                        "=" => a == b,
                        "!=" => a != b,
                        "<" => a.total_cmp(b).is_lt(),
                        "<=" => !a.total_cmp(b).is_gt(),
                        ">" => a.total_cmp(b).is_gt(),
                        ">=" => !a.total_cmp(b).is_lt(),
                        _ => false,
                    }
                }
            }
        }
        evaluate(&self.predicate, source, member)
    }

    pub fn comparisons(&self) -> Vec<(String, String)> {
        fn visit(p: &Predicate, out: &mut Vec<(String, String)>) {
            match p {
                Predicate::And(a, b) => {
                    visit(a, out);
                    visit(b, out);
                }
                Predicate::Compare {
                    left: Operand::Field(a),
                    right: Operand::Field(b),
                    ..
                } => {
                    if let Some(field) = b.strip_prefix("$row.") {
                        out.push((a.clone(), field.into()));
                    } else if let Some(field) = a.strip_prefix("$row.") {
                        out.push((b.clone(), field.into()));
                    }
                }
                _ => {}
            }
        }
        let mut out = Vec::new();
        visit(&self.predicate, &mut out);
        out
    }
}
impl Maintain {
    pub fn work_table(&self) -> String {
        format!("$recount:{}", self.target)
    }
}
impl crate::schema::Schema {
    pub fn prepare_row_views(&mut self) {
        use crate::schema::{ColumnType as C, Index, Rules, public_table};
        use std::collections::BTreeMap;
        for m in &self.maintains {
            let Some(key) = &m.row_key else { continue };
            if let Some(t) = self.tables.get_mut(&key.table) {
                if let Some(expiry) = &t.expire {
                    t.indexes.insert(
                        key.live_member_index(),
                        Index::of(&[&key.member_key, expiry, "id"], false),
                    );
                }
                t.indexes.insert(
                    key.member_index(),
                    Index::of(&[&key.member_key, "id"], false),
                );
            }
            if let Some(t) = self.tables.get_mut(&m.source) {
                if let Some(expiry) = &t.expire {
                    t.indexes.insert(
                        key.range_index(expiry),
                        Index::of(&[&key.source_key, expiry, "id"], false),
                    );
                }
                t.indexes.insert(
                    key.source_index(),
                    Index::of(&[&key.source_key, "id"], false),
                );
                for (field, _) in key.comparisons() {
                    if field != key.source_key {
                        t.indexes.insert(
                            key.range_index(&field),
                            Index::of(&[&key.source_key, &field, "id"], false),
                        );
                    }
                }
            }
            let mut work = public_table(
                BTreeMap::from([
                    ("id".into(), C::Id),
                    ("cursor".into(), C::Optional(Box::new(C::Id))),
                    ("total".into(), C::Int),
                    ("parked".into(), C::Bool),
                ]),
                BTreeMap::from([
                    ("byId".into(), Index::of(&["id"], true)),
                    ("byReady".into(), Index::of(&["parked", "id"], false)),
                ]),
            );
            work.rules = Rules::deny();
            self.tables.insert(m.work_table(), work);
        }
    }
    pub fn check_row_view_audiences(&self) -> Result<(), crate::RuntimeError> {
        if self.maintains.iter().any(|m| m.row_key.as_ref().is_some_and(|k| !k.audience_supported(self, &m.source))) {
            return Err(crate::RuntimeError::Structural { code: "E_VIEW_KEY", message: "row-keyed source/member audiences are unsupported; use the same parent grant, a membership witness, or a public source (guide maintains)".into() });
        }
        Ok(())
    }
    pub fn is_recount_work(&self, name: &str) -> bool {
        self.maintains
            .iter()
            .any(|m| m.row_key.is_some() && m.work_table() == name)
    }
}

impl RowKey {
    /// Conservative implication, not a general theorem prover: either the source
    /// is public, both rows use the same parent grant, or the member itself is
    /// the source's membership witness. No source cardinality is read here.
    pub fn audience_supported(&self, schema: &crate::schema::Schema, source: &str) -> bool {
        use crate::schema::{RuleExpr as R, RuleTerm as T};
        let (Some(t), Some(u)) = (schema.tables.get(source), schema.tables.get(&self.table)) else { return false; };
        let read = t.rules.read.device_audience_rule();
        if read.is_uniformly_readable() { return true; }
        // A group grant must depend only on the parent, not on another source field.
        let R::Exists { table, index, key, equalities, .. } = read.as_ref() else { return false; };
        if !equalities.is_empty() || key.iter().any(|v| matches!(v, T::Field(f) if f != &self.source_key)) {
            return false;
        }
        let mut inherited = read.clone().into_owned();
        if let R::Exists { key, .. } = &mut inherited {
            for term in key {
                if *term == T::Field(self.source_key.clone()) { *term = T::Field(self.member_key.clone()); }
            }
        }
        let member_read = u.rules.read.device_audience_rule();
        if *member_read == inherited { return true; }
        if table != &self.table || u.expire.is_some() { return false; }
        let Some(index) = u.indexes.get(index) else { return false; };
        let fields = index.columns();
        if !index.unique || fields.len() != key.len() { return false; }
        let mut parent = false;
        let mut owner = false;
        for (field, term) in fields.iter().zip(key) {
            match term {
                T::Field(f) if f == &self.source_key && field == &self.member_key => parent = true,
                T::Viewer if *member_read == R::Eq(T::Field(field.clone()), T::Viewer)
                    || *member_read == R::Eq(T::Viewer, T::Field(field.clone())) => owner = true,
                _ => return false,
            }
        }
        parent && owner
    }

    pub fn validate(&self, schema: &crate::schema::Schema, m: &Maintain) -> Result<(), String> {
        use crate::schema::{ColumnType as C, Constraint, MaintainKind};
        let fail = || {
            "E_VIEW_KEY: use count T by U u where .parent = u.parent with exactly one shared reference equality, conjunctive T/U comparisons and source-only conditions; cap U by parent (guide maintains)".to_owned()
        };
        let (Some(t), Some(u), Some(target)) = (
            schema.table(&m.source),
            schema.table(&self.table),
            schema.table(&m.target),
        ) else {
            return Err(fail());
        };
        if !self.audience_supported(schema, &m.source) {
            return Err("E_VIEW_KEY: row-keyed source/member audiences are unsupported: make the entire source parent group readable to every member-row reader (use the same parent grant or membership witness), or use a public source (guide maintains)".into());
        }
        let mut projected = BTreeSet::from([
            "id".to_owned(),
            "member".into(),
            "value".into(),
            "recountPending".into(),
        ]);
        u.rules.read.fields(&mut projected);
        if target.columns.keys().cloned().collect::<BTreeSet<_>>() != projected {
            return Err(fail());
        }
        if ["member","value","recountPending"].iter().any(|f|u.columns.contains_key(*f)) || !u.maintained.is_empty()
            || m.source==self.table || schema.maintain_for(&self.table).is_some() || m.private.is_some() || m.kind!=MaintainKind::Count
            || m.by!=["member"] || m.filter.is_some() || !m.computed.is_empty() || target.rules.read!=u.rules.read
            || !u.constraints.iter().any(|c|matches!(c,Constraint::Cap {by,max} if by==&vec![self.member_key.clone()] && u64::from(*max)==self.fanout))
            || !matches!((t.columns.get(&self.source_key),u.columns.get(&self.member_key)),(Some(C::Ref {table:a}),Some(C::Ref {table:b})) if a==b)
            || target.columns.get("member")!=Some(&C::Ref {table:self.table.clone()}) || target.columns.get("value")!=Some(&C::Int)
            || target.columns.get("recountPending")!=Some(&C::Bool)
            || target.columns.iter().any(|(f,c)| !["member", "value", "recountPending"].contains(&f.as_str()) && u.columns.get(f)!=Some(c))
            || !target.indexes.get("byGroup").is_some_and(|i|i.unique && i.columns()==["member"])
            || target.sync.as_ref().is_some_and(|s|u.sync.as_ref().is_none_or(|us|s.audience!=us.audience) || s.horizon.is_some()) {return Err(fail());}
        if target
            .indexes
            .values()
            .any(|i| i.columns().iter().any(|f| f == "value"))
        {
            return Err("E_VIEW_KEY: row-keyed counts may be pending or awaiting expiry; read the value by member and check complete instead of indexing, ranking or probing by value (guide maintains)".into());
        }
        fn valid(
            p: &Predicate,
            t: &Table,
            u: &Table,
            k: &RowKey,
            conjunct: bool,
            keys: &mut usize,
        ) -> bool {
            let operand = |o: &Operand| match o {
                Operand::Literal(_) => true,
                Operand::Field(f) => f
                    .strip_prefix("$row.")
                    .map_or_else(|| t.columns.contains_key(f), |f| u.columns.contains_key(f)),
            };
            let source_only = |p: &Predicate| {
                let mut f = BTreeSet::new();
                p.fields(&mut f);
                f.iter().all(|f| !f.starts_with("$row."))
            };
            match p {
                Predicate::And(a, b) => {
                    valid(a, t, u, k, conjunct, keys) && valid(b, t, u, k, conjunct, keys)
                }
                Predicate::Or(a, b) => {
                    source_only(p)
                        && valid(a, t, u, k, false, keys)
                        && valid(b, t, u, k, false, keys)
                }
                Predicate::Not(p) => source_only(p) && valid(p, t, u, k, false, keys),
                Predicate::Bool(_) => true,
                Predicate::Field(f) => t.columns.get(f) == Some(&C::Bool),
                Predicate::Compare { op, left, right } => {
                    if !operand(left)
                        || !operand(right)
                        || !matches!(op.as_str(), "=" | "!=" | "<" | "<=" | ">" | ">=")
                    {
                        return false;
                    }
                    if source_only(p) {
                        return true;
                    }
                    let (Operand::Field(a), Operand::Field(b)) = (left, right) else {
                        return false;
                    };
                    let pair = b
                        .strip_prefix("$row.")
                        .filter(|_| !a.starts_with("$row."))
                        .map(|f| (a.as_str(), f))
                        .or_else(|| {
                            a.strip_prefix("$row.")
                                .filter(|_| !b.starts_with("$row."))
                                .map(|f| (b.as_str(), f))
                        });
                    let Some((a, b)) = pair else {
                        return false;
                    };
                    if !conjunct {
                        return false;
                    }
                    if op == "="
                        && matches!((t.columns.get(a),u.columns.get(b)),(Some(C::Ref {table:a}),Some(C::Ref {table:b})) if a==b)
                    {
                        if a != k.source_key || b != k.member_key {
                            return false;
                        }
                        *keys += 1;
                    }
                    t.columns.get(a).is_some_and(|a| {
                        u.columns
                            .get(b)
                            .is_some_and(|b| a.required() == b.required())
                    })
                }
            }
        }
        let mut keys = 0;
        if !valid(&self.predicate, t, u, self, true, &mut keys) || keys != 1 {
            return Err(fail());
        }
        Ok(())
    }
    /// A safe conjunctive comparison narrows a live recount before residual filtering.
    pub fn live_range(&self, member: &Value) -> (String, crate::rows::Bounds) {
        fn find(p: &Predicate, k: &RowKey, u: &Value) -> Option<(String, crate::rows::Bounds)> {
            match p {
                Predicate::And(a, b) => find(a, k, u).or_else(|| find(b, k, u)),
                Predicate::Compare {
                    op,
                    left: Operand::Field(a),
                    right: Operand::Field(b),
                } if !a.starts_with("$row.") && a != &k.source_key => {
                    let f = b.strip_prefix("$row.")?;
                    let value = u.field(f).ok()?.clone();
                    if value == Value::Null {
                        return None;
                    }
                    let mut bounds = crate::rows::Bounds::default();
                    match op.as_str() {
                        ">" => bounds.gt = Some(value),
                        ">=" => bounds.gte = Some(value),
                        "<" => bounds.lt = Some(value),
                        "<=" => bounds.lte = Some(value),
                        _ => return None,
                    }
                    Some((k.range_index(a), bounds))
                }
                _ => None,
            }
        }
        find(&self.predicate, self, member)
            .unwrap_or((self.source_index(), crate::rows::Bounds::default()))
    }
}
