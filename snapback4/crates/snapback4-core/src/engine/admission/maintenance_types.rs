//! Structural receiver types and a returned-data allowlist, shared by Quarry
//! admission and native raw-program admission. Scope-wide, never flow-sensitive.
// @ref LLP 3000.015#3 — maintenance fields are query output, never computation.
use super::*;

// The only whole-value forwarding primitives. Unknown future builtins deny by
// default; the census test forces their author to record an explicit decision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Inspection { Inspecting, NonInspecting }
fn builtin_inspection(builtin: &Builtin) -> Option<Inspection> {
    use Builtin::*;
    #[allow(unreachable_patterns)]
    match builtin {
        OptionalField { .. } | Len | Count | CountCapped | First | Last | At | Slice | Concat => Some(Inspection::NonInspecting),
        ProjectFields { .. } | ReceiptSettled { .. } | Calendar { .. } | Lower | Trim | Sha256 | Join
        | Group { .. } | Min | Max | Extremum { .. } | ExtremumOf { .. } | Divmod { .. }
        | Sort { .. } | MentionTokens | SearchPresent | DeterministicShare | Sum | Connected => Some(Inspection::Inspecting),
        #[cfg(feature = "sqlite")]
        JobAs | JobQuery { .. } => Some(Inspection::Inspecting),
        _ => None,
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
enum Type {
    #[default]
    Empty,
    Scalar,
    Row(String),
    Object(BTreeMap<String, Type>),
    Shape(Box<Type>, BTreeMap<String, Type>),
    List(Box<Type>),
    Unknown,
}
impl Type {
    fn list(self) -> Self { Self::List(Box::new(self)) }
    fn item(self) -> Self { match self { Self::List(t) => *t, Self::Empty => Self::Empty, _ => Self::Unknown } }
    fn join(self, other: Self) -> Self { self.join_at(other, 0) }
    fn join_at(self, other: Self, depth: usize) -> Self {
        if self == other { return self; }
        if depth == 16 { return Self::Unknown; }
        match (self, other) {
            (Self::Empty, t) | (t, Self::Empty) => t,
            (Self::List(a), Self::List(b)) => a.join_at(*b, depth + 1).list(),
            (Self::Shape(a, af), Self::Shape(b, bf)) => {
                let Self::Object(fields) = Self::Object(af).join_at(Self::Object(bf), depth + 1) else { return Self::Unknown; };
                Self::Shape(Box::new(a.join_at(*b, depth + 1)), fields)
            },
            (Self::Object(mut a), Self::Object(b)) => {
                for (name, t) in b { let prior = a.remove(&name).unwrap_or_default(); a.insert(name, prior.join_at(t, depth + 1)); }
                Self::Object(a)
            },
            _ => Self::Unknown,
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Output { Query, Forward, Effect }
struct Check<'a> {
    schema: &'a Schema,
    env: &'a mut BTreeMap<String, Type>,
    scope: &'a str,
    aliases: &'a BTreeMap<String, String>,
    focal: BTreeMap<String, Type>,
    // A use census, not origins: only collectors used exclusively as returned
    // data may project status in Push. Assignments and helper blocks cannot.
    uses: BTreeMap<String, bool>,
    outputs: BTreeSet<String>,
    validate: bool,
}
type Result<T> = std::result::Result<T, String>;

pub(super) fn check(schema: &Schema, program: &Program) -> Result<()> {
    check_scopes(schema, &[(program, &BTreeMap::new())]).into_iter().next().map_or(Ok(()), |(_, message)| Err(message))
}

// Quarry supplies identities shared by every expansion of a helper parameter,
// local declaration and block result, including calls in different operations.
// Raw IR already has distinct runtime names; no source identity is trusted there.
pub(super) fn check_scopes(schema: &Schema, scopes: &[(&Program, &BTreeMap<String, String>)]) -> Vec<(usize, String)> {
    if !schema.maintains.iter().any(|m| m.row_key.is_some()) { return vec![]; }
    let mut env = BTreeMap::new();
    let mut uses = vec![BTreeMap::new(); scopes.len()];
    // A monotone fixed point over ALL assignments, including unreachable ones.
    // No branch snapshots, assignment replacement or loop-transfer state.
    loop {
        let prior = env.clone();
        for (i, (program, aliases)) in scopes.iter().enumerate() {
            let mut check = Check { schema, env: &mut env, scope: &program.name, aliases, focal: BTreeMap::new(),
                uses: std::mem::take(&mut uses[i]), outputs: BTreeSet::new(), validate: false };
            for (name, ty) in &program.args { check.bind(name, argument_type(ty)); }
            check.body(&program.body, program_output(program)).expect("inference cannot refuse");
            uses[i] = check.uses;
        }
        if env == prior { break; }
    }
    scopes.iter().enumerate().filter_map(|(i, (program, aliases))| {
        let outputs = uses[i].iter().filter(|(_, data)| **data).map(|(name, _)| name.clone()).collect();
        let mut check = Check { schema, env: &mut env, scope: &program.name, aliases, focal: BTreeMap::new(),
            uses: BTreeMap::new(), outputs, validate: true };
        check.body(&program.body, program_output(program)).err().map(|message| (i, format!("{message}; locals keep every assigned maintenance type throughout their scope: use a separate variable for the row")))
    }).collect()
}
fn program_output(program: &Program) -> Output {
    if program.kind == ProgramKind::Query { Output::Query } else { Output::Effect }
}
impl Check<'_> {
    // @ref LLP 3000.015#3 — a query called by a job is computation, like a helper;
    // its own locals are isolated but its result retains its structural type.
    #[cfg(feature = "sqlite")]
    fn query_result(&self, program: &Program) -> Result<Type> {
        let mut env = BTreeMap::new();
        let aliases = BTreeMap::new();
        let mut uses = BTreeMap::new();
        loop {
            let prior = env.clone();
            let mut query = Check { schema: self.schema, env: &mut env, scope: &program.name, aliases: &aliases,
                focal: BTreeMap::new(), uses, outputs: BTreeSet::new(), validate: false };
            for (name, ty) in &program.args { query.bind(name, argument_type(ty)); }
            query.body(&program.body, Output::Forward)?;
            uses = query.uses;
            if env == prior { break; }
        }
        let outputs = uses.iter().filter(|(_, data)| **data).map(|(name, _)| name.clone()).collect();
        let mut query = Check { schema: self.schema, env: &mut env, scope: &program.name, aliases: &aliases,
            focal: BTreeMap::new(), uses: BTreeMap::new(), outputs, validate: self.validate };
        query.body(&program.body, Output::Forward)
    }

    fn key(&self, name: &str) -> String {
        self.aliases.get(name).cloned().unwrap_or_else(|| format!("operation/{}/{name}", self.scope))
    }
    fn use_name(&mut self, name: &str, data: bool) -> Type {
        self.uses.entry(name.into()).and_modify(|only| *only &= data).or_insert(data);
        let assigned = self.env.get(&self.key(name)).cloned();
        // Focal names have a lexical receiver, but raw IR can also assign to
        // their slot inside a Block. Such assignments participate like any local.
        if let Some(focal) = self.focal.get(name) { return focal.clone().join(assigned.unwrap_or_default()); }
        assigned.unwrap_or(if self.validate { Type::Unknown } else { Type::Empty })
    }
    fn field(&self, receiver: Type, field: &str, data: bool) -> Result<Type> {
        match receiver {
            Type::Empty if !self.validate => Ok(Type::Empty),
            Type::Row(table) => {
                if let Some(message) = self.schema.row_view_predicate_field(&table, field)
                    && self.validate && !(data && matches!(field, "recountPending" | "pending") && !self.schema.is_recount_work(&table)) {
                    return Err(message);
                }
                Ok(self.schema.table(&table).and_then(|t| t.columns.get(field)).map(column_type).unwrap_or(Type::Scalar))
            },
            Type::Shape(base, mut fields) => if field == "pending" { self.field(*base, field, data) } else { Ok(fields.remove(field).unwrap_or(if self.validate { Type::Unknown } else { Type::Empty })) },
            Type::Object(mut fields) => Ok(fields.remove(field).unwrap_or(if self.validate { Type::Unknown } else { Type::Empty })),
            Type::Unknown | Type::List(_) if self.validate => Err(format!("E_VIEW_KEY: cannot prove the receiver type of .{field}; maintenance-field access through an unknown, heterogeneous or recursively widened type is refused; project recountPending directly from a maintained row in the query result, or compute with value/member fields (guide maintains)")),
            _ => Ok(Type::Unknown),
        }
    }
    // Every inspecting use checks the complete structural type, not just its
    // outermost value or the result type of the consuming operation.
    fn inspect(&self, ty: &Type) -> Result<()> {
        if !self.validate { return Ok(()); }
        match ty {
            Type::Row(table) => if self.schema.row_view_predicate_field(table, "recountPending").is_some() {
                return Err(format!("E_VIEW_KEY: value contains {table}.recountPending/pending maintenance state; project the field you need first (value, member identity or copied member fields), then compute; return maintenance state only as query data (guide maintains)"));
            },
            Type::Object(fields) => for value in fields.values() { self.inspect(value)?; },
            Type::Shape(base, fields) => { self.inspect(base)?; for value in fields.values() { self.inspect(value)?; } },
            Type::List(item) => self.inspect(item)?,
            Type::Unknown => { self.field(Type::Unknown, "recountPending", false)?; },
            _ => {},
        }
        Ok(())
    }
    fn inspected(&mut self, expr: &Expr) -> Result<Type> {
        let ty = self.expr(expr, false)?;
        self.inspect(&ty)?;
        Ok(ty)
    }
    fn read(&mut self, read: &Read) -> Result<Type> {
        if self.schema.is_recount_work(&read.table) && self.validate {
            return Err(format!("E_VIEW_KEY: {} is private maintenance state; use value or member fields of the public view (guide maintains)", read.table));
        }
        for e in &read.key { self.inspected(e)?; }
        if let Some(index) = self.schema.table(&read.table).and_then(|t| t.index(&read.index)) {
            for field in index.columns() { self.field(Type::Row(read.table.clone()), &field, false)?; }
        }
        Ok(Type::Row(read.table.clone()))
    }
    fn scan(&mut self, scan: &Scan) -> Result<Type> {
        let row = self.read(&Read { site: scan.site.clone(), table: scan.table.clone(), index: scan.index.clone(), key: vec![], provenance: scan.provenance })?;
        if let Bound::Arg { name, .. } = &scan.take { let ty = self.use_name(name, false); self.inspect(&ty)?; }
        let mut values: Vec<&Expr> = scan.prefix.iter().map(|p| match p { IndexKeyExpr::Scalar(e) | IndexKeyExpr::WordPrefix(e) => e }).collect();
        values.extend(scan.after.as_deref()); values.extend(scan.before.as_deref());
        if let Some(range) = &scan.range { values.extend(range.gt.iter().chain(&range.gte).chain(&range.lt).chain(&range.lte).map(Box::as_ref)); }
        for e in values { self.inspected(e)?; }
        if let Some(filter) = &scan.filter {
            let old = self.focal.insert("$filter".into(), row.clone());
            self.inspected(filter)?;
            if let Some(old) = old { self.focal.insert("$filter".into(), old); } else { self.focal.remove("$filter"); }
        }
        Ok(row.list())
    }
    fn expr(&mut self, expr: &Expr, data: bool) -> Result<Type> {
        match expr {
            Expr::Literal(Value::Null) => Ok(Type::Empty),
            Expr::Literal(_) | Expr::Input(_) => Ok(Type::Scalar),
            Expr::Variable(name) => Ok(self.use_name(name, data)),
            Expr::Field { base, name } => { let receiver = self.expr(base, false)?; self.field(receiver, name, data) },
            Expr::Get(read) => self.read(read),
            Expr::Exists(read) => { self.read(read)?; Ok(Type::Scalar) },
            Expr::Scan(scan) => self.scan(scan),
            Expr::Block { body, value } => {
                // Blocks may hide helpers: every access inside is computation.
                // Row-valued helper results still keep their receiver type.
                let returned = self.body(body, Output::Forward)?;
                Ok(returned.join(self.expr(value, false)?))
            },
            Expr::Array(values) => { let mut item = Type::Empty; for value in values { item = item.join(self.expr(value, data)?); } Ok(item.list()) },
            Expr::Object(fields) | Expr::Shape { fields, .. } => {
                let mut types = BTreeMap::new();
                let base = if let Expr::Shape { base, .. } = expr { Some(self.expr(base, false)?) } else { None };
                for (name, value) in fields { types.insert(name.clone(), self.expr(value, data)?); }
                Ok(match base { Some(base) => Type::Shape(Box::new(base), types), None => Type::Object(types) })
            },
            Expr::Unary { value, .. } => { let ty = self.expr(value, false)?; self.inspect(&ty)?; Ok(Type::Scalar) },
            Expr::Binary { op, left, right } => {
                let a = self.expr(left, false)?; let b = self.expr(right, false)?;
                let presence = matches!(op, BinaryOp::Eq | BinaryOp::Ne | BinaryOp::SameValueZero)
                    && (matches!(a, Type::Empty) || matches!(b, Type::Empty));
                if !presence { self.inspect(&a)?; self.inspect(&b)?; }
                Ok(Type::Scalar)
            },
            Expr::Builtin { builtin, args } => {
                #[cfg(feature = "sqlite")]
                if let Builtin::JobQuery { program, all, .. } = builtin {
                    for arg in args { self.inspected(arg)?; }
                    let result = self.query_result(program)?;
                    return Ok(if *all { result } else {
                        Type::Object(BTreeMap::from([("data".into(), result), ("next".into(), Type::Scalar)]))
                    });
                }
                let first = args.first().map(|arg| self.expr(arg, false)).transpose()?.unwrap_or(Type::Unknown);
                if matches!(builtin, Builtin::Sum | Builtin::ExtremumOf { .. }) {
                    self.inspect(&first)?;
                    let old = self.focal.insert("$filter".into(), first.item());
                    let mut projection = Type::Scalar;
                    for arg in args.iter().skip(1) { projection = self.inspected(arg)?; }
                    if let Some(old) = old { self.focal.insert("$filter".into(), old); } else { self.focal.remove("$filter"); }
                    return Ok(if matches!(builtin, Builtin::ExtremumOf { .. }) { projection } else { Type::Scalar });
                }
                let mut types = vec![first.clone()];
                for arg in args.iter().skip(1) { types.push(self.expr(arg, false)?); }
                // Preserve specific field diagnostics before the whole-value
                // refusal (including undeclared/private sort and group keys).
                match builtin {
                    Builtin::Sort { keys } => for key in keys { self.field(first.clone().item(), &key.field, false)?; },
                    Builtin::Group { field, .. } | Builtin::Extremum { field, .. } => { self.field(first.clone().item(), field, false)?; },
                    _ => {},
                }
                let non_inspecting = builtin_inspection(builtin) == Some(Inspection::NonInspecting);
                for (index, ty) in types.iter().enumerate() {
                    let forwards = non_inspecting && match builtin {
                        // The text overload invokes concat_text/canonical_json.
                        Builtin::Concat => types.len() == 2 && types.iter().all(|t| matches!(t, Type::List(_))),
                        Builtin::OptionalField { .. } => index == 0,
                        // Len also accepts maps at runtime: a row's optional
                        // pending key must not become observable via map size.
                        Builtin::Len | Builtin::Count | Builtin::CountCapped | Builtin::First
                        | Builtin::Last | Builtin::At | Builtin::Slice => index == 0 && matches!(ty, Type::List(_)),
                        _ => false,
                    };
                    if !forwards { self.inspect(ty)?; }
                }
                match builtin {
                    Builtin::OptionalField { field } => self.field(first, field, data),
                    Builtin::ProjectFields { .. } => Ok(first),
                    Builtin::First | Builtin::Last | Builtin::At => Ok(first.item()),
                    Builtin::Slice => Ok(first),
                    Builtin::Concat => Ok(types.into_iter().fold(Type::Empty, Type::join)),
                    Builtin::Sort { keys } => {
                        for key in keys { let ty = self.field(first.clone().item(), &key.field, false)?; self.inspect(&ty)?; }
                        Ok(first)
                    },
                    Builtin::Group { field, .. } => {
                        let item = first.item();
                        let key = self.field(item.clone(), field, false)?;
                        self.inspect(&key)?;
                        Ok(Type::Object(BTreeMap::from([("key".into(), key), ("items".into(), item.list())])).list())
                    },
                    Builtin::Extremum { field, .. } => self.field(first.item(), field, false),
                    // These choose an operand, so never erase a row's type.
                    Builtin::Min | Builtin::Max => Ok(types.into_iter().fold(Type::Empty, Type::join)),
                    _ => Ok(Type::Scalar),
                }
            },
            Expr::Merge(merge) => {
                if let Some(position) = &merge.position { for e in position.after.iter() { self.inspected(e)?; } }
                let mut item = Type::Empty;
                for lane in &merge.lanes {
                    let source = match &lane.source {
                        None => self.scan(&lane.scan)?.item(), Some(LaneSource::Scan(scan)) => self.scan(scan)?.item(),
                        Some(LaneSource::List { value, .. }) => self.expr(value, false)?.item(),
                        Some(LaneSource::Range { start, end_exclusive, .. }) => { self.inspected(start)?; self.inspected(end_exclusive)?; Type::Scalar },
                    };
                    self.bind(&lane.binding, source);
                    self.body(&lane.setup, Output::Effect)?;
                    for e in lane.guard.iter().chain(&lane.distinct) { self.inspected(e)?; }
                    let row = self.scan(&lane.scan)?.item();
                    let old = self.focal.insert("$project".into(), row.clone());
                    let projected = if let Some(project) = &lane.project { self.expr(project, data && merge.order_keys.is_empty())? } else { row };
                    if let Some(old) = old { self.focal.insert("$project".into(), old); } else { self.focal.remove("$project"); }
                    for key in &merge.order_keys { let ty = self.field(projected.clone(), key, false)?; self.inspect(&ty)?; }
                    item = item.join(projected);
                }
                Ok(item.list())
            },
        }
    }
    fn bind(&mut self, name: &str, ty: Type) {
        if self.validate { return; } // Validation reads the completed scope types.
        let key = self.key(name);
        let old = self.env.remove(&key).unwrap_or_default();
        self.env.insert(key, old.join(ty));
    }
    fn body(&mut self, body: &[Stmt], output: Output) -> Result<Type> {
        let query = output == Output::Query;
        let mut returned = Type::Empty;
        for stmt in body {
            match stmt {
                Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value } => { let ty = self.expr(value, false)?; self.bind(name, ty); },
                Stmt::Push { target, value } => { let ty = self.expr(value, query && self.outputs.contains(target))?; self.bind(target, ty.list()); },
                Stmt::Return(e) => {
                    let ty = self.expr(e, query)?;
                    if output == Output::Effect { self.inspect(&ty)?; }
                    returned = returned.join(ty);
                },
                Stmt::Require { condition, .. } => { self.inspected(condition)?; },
                Stmt::Check { condition, current } => { self.read(current)?; self.inspected(condition)?; },
                Stmt::If { condition, then_body, else_body } => {
                    self.inspected(condition)?;
                    returned = returned.join(self.body(then_body, output)?);
                    returned = returned.join(self.body(else_body, output)?);
                },
                Stmt::For { binding, domain, body } => {
                    let ty = match domain {
                        LoopDomain::Page(scan) => self.scan(scan)?.item(),
                        LoopDomain::DerivedArray { value, .. } => self.expr(value, false)?.item(),
                        LoopDomain::ArgList { name, .. } => self.use_name(name, false).item(),
                        LoopDomain::Recurse(r) => { self.inspected(&r.seed)?; self.field(Type::Row(r.table.clone()), &r.next_field, false)?; Type::Row(r.table.clone()) },
                        LoopDomain::ExpressionRange { start, end_exclusive } => { self.inspected(start)?; self.inspected(end_exclusive)?; Type::Scalar },
                        LoopDomain::LiteralRange { .. } => Type::Scalar,
                    };
                    self.bind(binding, ty);
                    returned = returned.join(self.body(body, output)?);
                },
                Stmt::WriteTarget { target, patch, condition, result, .. } => {
                    let row = self.read(target)?; self.inspected(patch)?;
                    if let Some(c) = condition { self.bind(&c.old, row.clone()); self.body(&c.setup, Output::Effect)?; self.inspected(&c.value)?; }
                    if let Some(name) = result { self.bind(name, row); }
                },
                Stmt::Insert { table, row } => {
                    let ty = self.inspected(row)?;
                    // @ref LLP 3000.007#5.4 — completion supplies ordinary
                    // omitted fields. Extend the structural image monotonically;
                    // never replace an assigned type or erase maintenance taint.
                    if let Expr::Variable(name) = row && let Type::Object(mut fields) = ty {
                        let table = &self.schema.tables[table];
                        for (field, ty) in &table.columns {
                            if !fields.contains_key(field) && !table.engine_field(field)
                                && !crate::schema::timeline::is_slot(field) && !table.maintained.contains_key(field)
                                && (ty.is_optional() || table.defaults.contains_key(field)) {
                                fields.insert(field.clone(), completed_column_type(ty));
                            }
                        }
                        self.bind(name, Type::Object(fields));
                    }
                },
                Stmt::InsertIfAbsent { table, row, result } => { self.inspected(row)?; self.bind(result, Type::Row(table.clone())); },
                Stmt::Update { key, patch, .. } | Stmt::Upsert { key, row: patch, .. } => { self.inspected(key)?; self.inspected(patch)?; },
                Stmt::Delete { key, .. } => { self.inspected(key)?; },
                Stmt::DeleteTarget { target } => { self.read(target)?; },
                Stmt::Emit { payload, once, .. } => { self.inspected(payload)?; if let Some(e) = once { self.inspected(e)?; } },
                Stmt::Break | Stmt::Continue => {},
            }
        }
        Ok(returned)
    }
}
// Omitted values come only from null or schema literals, never a maintained
// row supplied by a caller. Keep collection/asset shape, but do not introduce
// unknown runtime JSON taint for these statically supplied ordinary defaults.
fn completed_column_type(column: &crate::schema::ColumnType) -> Type {
    use crate::schema::ColumnType;
    match column {
        ColumnType::Optional(t) => completed_column_type(t),
        ColumnType::List { of, .. } => completed_column_type(of).list(),
        ColumnType::Json { .. } => Type::Scalar,
        _ => column_type(column),
    }
}

fn column_type(column: &crate::schema::ColumnType) -> Type {
    use crate::schema::ColumnType;
    match column {
        ColumnType::Optional(t) => column_type(t),
        ColumnType::List { of, .. } => column_type(of).list(),
        ColumnType::Json { .. } => Type::Unknown,
        ColumnType::Image { .. } | ColumnType::Video { .. } => asset_type(),
        _ => Type::Scalar,
    }
}

fn argument_type(argument: &ArgType) -> Type {
    match argument {
        ArgType::Optional(t) => argument_type(t),
        ArgType::List { of, .. } => of.as_deref().map(argument_type).unwrap_or(Type::Unknown).list(),
        ArgType::Json { .. } => Type::Unknown,
        ArgType::Image { .. } | ArgType::Video { .. } => asset_type(),
        _ => Type::Scalar,
    }
}
fn asset_type() -> Type {
    Type::Object(["id", "width", "height", "duration", "bytes", "type"].map(|name| (name.into(), Type::Scalar)).into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Deserializer, de::{Visitor, value::Error}};

    // Ask the actual derived IR deserializer for its variant census. Adding a
    // builtin without a test specimen or an explicit classification fails here.
    struct Census<'a>(&'a mut Vec<&'static str>);
    impl<'de> Deserializer<'de> for Census<'_> {
        type Error = Error;
        fn deserialize_enum<V: Visitor<'de>>(self, _: &'static str, variants: &'static [&'static str], _: V) -> std::result::Result<V::Value, Error> {
            self.0.extend_from_slice(variants);
            Err(serde::de::Error::custom("census only"))
        }
        fn deserialize_any<V: Visitor<'de>>(self, _: V) -> std::result::Result<V::Value, Error> { Err(serde::de::Error::custom("enum only")) }
        serde::forward_to_deserialize_any! { bool i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 char str string bytes byte_buf option unit unit_struct newtype_struct seq tuple tuple_struct map struct identifier ignored_any }
    }
    #[test]
    fn every_builtin_has_an_explicit_inspection_classification() {
        use Builtin::*;
        let builtins = vec![ProjectFields { table: "t".into() }, ReceiptSettled { table: "t".into() }, OptionalField { field: "id".into() },
            Calendar { millis: 1 }, Len, Slice, Concat, Lower, Trim, Sha256, Join, Group { field: "id".into(), optional: false },
            First, Last, At, Min, Max, Extremum { field: "id".into(), max: false, domain: false }, ExtremumOf { max: false, domain: false },
            Divmod { remainder_sink: "r".into() }, Sort { keys: vec![] }, MentionTokens, SearchPresent, DeterministicShare, Count, Sum, CountCapped, Connected];
        #[cfg(feature = "sqlite")]
        let builtins = builtins.into_iter().chain([JobAs, JobQuery { program: Box::new(Program {
            name: "query".into(), kind: ProgramKind::Query, args: BTreeMap::new(), body: vec![],
            native: false, read_time_granularity_ms: None, returned_shapes: Default::default(),
        }), cursor: None, all: false }]);
        let mut variants = vec![];
        let _ = Builtin::deserialize(Census(&mut variants));
        let mut covered = BTreeSet::new();
        for builtin in builtins {
            assert!(builtin_inspection(&builtin).is_some(), "unclassified builtin: {builtin:?}; default is inspecting");
            let encoded = serde_json::to_value(&builtin).unwrap();
            covered.insert(encoded.as_str().map(str::to_owned).unwrap_or_else(|| encoded.as_object().unwrap().keys().next().unwrap().clone()));
        }
        assert_eq!(covered, variants.iter().map(|name| name.to_string()).collect());
        eprintln!("BG round7 builtin census: {} variants, all explicitly classified", variants.len());
    }
}
