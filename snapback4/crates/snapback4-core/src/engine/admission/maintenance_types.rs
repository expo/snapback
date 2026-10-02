//! Structural receiver types and a returned-data allowlist, shared by Quarry
//! admission and native raw-program admission. No field-value provenance.
// @ref LLP 3000.015#3 — maintenance fields are query output, never computation.
use super::*;

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
struct Check<'a> {
    schema: &'a Schema,
    env: BTreeMap<String, Type>,
    // A use census, not origins: only collectors used exclusively as returned
    // data may project status in Push. Assignments and helper blocks cannot.
    uses: BTreeMap<String, bool>,
    outputs: BTreeSet<String>,
    validate: bool,
}
type Result<T> = std::result::Result<T, String>;

pub(super) fn check(schema: &Schema, program: &Program) -> Result<()> {
    if !schema.maintains.iter().any(|m| m.row_key.is_some()) { return Ok(()); }
    let arguments: BTreeMap<_, _> = program.args.iter().map(|(name, ty)| (name.clone(), argument_type(ty))).collect();
    let mut check = Check { schema, env: arguments.clone(), uses: BTreeMap::new(), outputs: BTreeSet::new(), validate: false };
    let query = program.kind == ProgramKind::Query;
    check.body(&program.body, query)?;
    check.outputs = check.uses.iter().filter(|(_, data)| **data).map(|(name, _)| name.clone()).collect();
    check.env = arguments;
    check.validate = true;
    check.body(&program.body, query).map(|_| ())
}
impl Check<'_> {
    fn use_name(&mut self, name: &str, data: bool) -> Type {
        self.uses.entry(name.into()).and_modify(|only| *only &= data).or_insert(data);
        self.env.get(name).cloned().unwrap_or(Type::Unknown)
    }
    fn field(&self, receiver: Type, field: &str, data: bool) -> Result<Type> {
        match receiver {
            Type::Row(table) => {
                if let Some(message) = self.schema.row_view_predicate_field(&table, field)
                    && self.validate && !(data && matches!(field, "recountPending" | "pending") && !self.schema.is_recount_work(&table)) {
                    return Err(message);
                }
                Ok(self.schema.table(&table).and_then(|t| t.columns.get(field)).map(column_type).unwrap_or(Type::Scalar))
            },
            Type::Shape(base, mut fields) => if field == "pending" { self.field(*base, field, data) } else { Ok(fields.remove(field).unwrap_or(Type::Unknown)) },
            Type::Object(mut fields) => Ok(fields.remove(field).unwrap_or(Type::Unknown)),
            Type::Unknown | Type::List(_) if self.validate => Err(format!("E_VIEW_KEY: cannot prove the receiver type of .{field}; maintenance-field access through an unknown, heterogeneous or recursively widened type is refused; project recountPending directly from a maintained row in the query result, or compute with value/member fields (guide maintains)")),
            _ => Ok(Type::Unknown),
        }
    }
    // Whole-value comparison/order would implicitly inspect every row field.
    // Null tests and cardinality inspect presence only and do not use this path.
    fn comparable(&self, ty: &Type) -> Result<()> {
        if !self.validate { return Ok(()); }
        match ty {
            Type::Row(table) => if let Some(message) = self.schema.row_view_predicate_field(table, "recountPending") { return Err(message); },
            Type::Object(fields) => for value in fields.values() { self.comparable(value)?; },
            Type::Shape(base, fields) => { self.comparable(base)?; for value in fields.values() { self.comparable(value)?; } },
            Type::List(item) => self.comparable(item)?,
            Type::Unknown => { self.field(Type::Unknown, "recountPending", false)?; },
            _ => {},
        }
        Ok(())
    }
    fn read(&mut self, read: &Read) -> Result<Type> {
        if self.schema.is_recount_work(&read.table) && self.validate {
            return Err(format!("E_VIEW_KEY: {} is private maintenance state; use value or member fields of the public view (guide maintains)", read.table));
        }
        for e in &read.key { self.expr(e, false)?; }
        if let Some(index) = self.schema.table(&read.table).and_then(|t| t.index(&read.index)) {
            for field in index.columns() { self.field(Type::Row(read.table.clone()), &field, false)?; }
        }
        Ok(Type::Row(read.table.clone()))
    }
    fn scan(&mut self, scan: &Scan) -> Result<Type> {
        let row = self.read(&Read { site: scan.site.clone(), table: scan.table.clone(), index: scan.index.clone(), key: vec![], provenance: scan.provenance })?;
        if let Bound::Arg { name, .. } = &scan.take { self.use_name(name, false); }
        let mut values: Vec<&Expr> = scan.prefix.iter().map(|p| match p { IndexKeyExpr::Scalar(e) | IndexKeyExpr::WordPrefix(e) => e }).collect();
        values.extend(scan.after.as_deref()); values.extend(scan.before.as_deref());
        if let Some(range) = &scan.range { values.extend(range.gt.iter().chain(&range.gte).chain(&range.lt).chain(&range.lte).map(Box::as_ref)); }
        for e in values { self.expr(e, false)?; }
        if let Some(filter) = &scan.filter {
            let old = self.env.insert("$filter".into(), row.clone());
            self.expr(filter, false)?;
            if let Some(old) = old { self.env.insert("$filter".into(), old); } else { self.env.remove("$filter"); }
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
                let returned = self.body(body, false)?;
                Ok(returned.join(self.expr(value, false)?))
            },
            Expr::Array(values) => { let mut item = Type::Empty; for value in values { item = item.join(self.expr(value, data)?); } Ok(item.list()) },
            Expr::Object(fields) | Expr::Shape { fields, .. } => {
                let mut types = BTreeMap::new();
                let base = if let Expr::Shape { base, .. } = expr { Some(self.expr(base, false)?) } else { None };
                for (name, value) in fields { types.insert(name.clone(), self.expr(value, data)?); }
                Ok(match base { Some(base) => Type::Shape(Box::new(base), types), None => Type::Object(types) })
            },
            Expr::Unary { value, .. } => { let ty = self.expr(value, false)?; self.comparable(&ty)?; Ok(Type::Scalar) },
            Expr::Binary { left, right, .. } => {
                let a = self.expr(left, false)?; let b = self.expr(right, false)?;
                if !matches!(a, Type::Empty) && !matches!(b, Type::Empty) { self.comparable(&a)?; self.comparable(&b)?; }
                Ok(Type::Scalar)
            },
            Expr::Builtin { builtin, args } => {
                let first = args.first().map(|arg| self.expr(arg, false)).transpose()?.unwrap_or(Type::Unknown);
                if matches!(builtin, Builtin::Sum | Builtin::ExtremumOf { .. }) {
                    let old = self.env.insert("$filter".into(), first.item());
                    let mut projection = Type::Scalar;
                    for arg in args.iter().skip(1) { projection = self.expr(arg, false)?; }
                    if let Some(old) = old { self.env.insert("$filter".into(), old); } else { self.env.remove("$filter"); }
                    return Ok(if matches!(builtin, Builtin::ExtremumOf { .. }) { projection } else { Type::Scalar });
                }
                let mut types = vec![first.clone()];
                for arg in args.iter().skip(1) { types.push(self.expr(arg, false)?); }
                match builtin {
                    Builtin::OptionalField { field } => self.field(first, field, data),
                    Builtin::ProjectFields { .. } => Ok(first),
                    Builtin::First | Builtin::Last | Builtin::At => Ok(first.item()),
                    Builtin::Slice => Ok(first),
                    Builtin::Concat => Ok(types.into_iter().fold(Type::Empty, Type::join)),
                    Builtin::Sort { keys } => {
                        for key in keys { let ty = self.field(first.clone().item(), &key.field, false)?; self.comparable(&ty)?; }
                        Ok(first)
                    },
                    Builtin::Group { field, .. } => {
                        let item = first.item();
                        let key = self.field(item.clone(), field, false)?;
                        self.comparable(&key)?;
                        Ok(Type::Object(BTreeMap::from([("key".into(), key), ("items".into(), item.list())])).list())
                    },
                    Builtin::Extremum { field, .. } => self.field(first.item(), field, false),
                    // These choose an operand, so never erase a row's type.
                    Builtin::Min | Builtin::Max => Ok(types.into_iter().fold(Type::Empty, Type::join)),
                    _ => Ok(Type::Scalar),
                }
            },
            Expr::Merge(merge) => {
                if let Some(position) = &merge.position { for e in position.after.iter() { self.expr(e, false)?; } }
                let mut item = Type::Empty;
                for lane in &merge.lanes {
                    let source = match &lane.source {
                        None => self.scan(&lane.scan)?.item(), Some(LaneSource::Scan(scan)) => self.scan(scan)?.item(),
                        Some(LaneSource::List { value, .. }) => self.expr(value, false)?.item(),
                        Some(LaneSource::Range { start, end_exclusive, .. }) => { self.expr(start, false)?; self.expr(end_exclusive, false)?; Type::Scalar },
                    };
                    self.env.insert(lane.binding.clone(), source);
                    self.body(&lane.setup, false)?;
                    for e in lane.guard.iter().chain(&lane.distinct) { self.expr(e, false)?; }
                    let row = self.scan(&lane.scan)?.item();
                    self.env.insert("$project".into(), row.clone());
                    let projected = if let Some(project) = &lane.project { self.expr(project, data && merge.order_keys.is_empty())? } else { row };
                    for key in &merge.order_keys { self.field(projected.clone(), key, false)?; }
                    item = item.join(projected);
                }
                Ok(item.list())
            },
        }
    }
    fn bind(&mut self, name: &str, ty: Type) { let old = self.env.remove(name).unwrap_or_default(); self.env.insert(name.into(), old.join(ty)); }
    fn body(&mut self, body: &[Stmt], query: bool) -> Result<Type> {
        let mut returned = Type::Empty;
        for stmt in body {
            match stmt {
                Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value } => { let ty = self.expr(value, false)?; self.env.insert(name.clone(), ty); },
                Stmt::Push { target, value } => { let ty = self.expr(value, query && self.outputs.contains(target))?; self.bind(target, ty.list()); },
                Stmt::Return(e) => returned = returned.join(self.expr(e, query)?),
                Stmt::Require { condition, .. } => { self.expr(condition, false)?; },
                Stmt::Check { condition, current } => { self.read(current)?; self.expr(condition, false)?; },
                Stmt::If { condition, then_body, else_body } => {
                    self.expr(condition, false)?;
                    let before = self.env.clone();
                    returned = returned.join(self.body(then_body, query)?);
                    let then = std::mem::replace(&mut self.env, before);
                    returned = returned.join(self.body(else_body, query)?);
                    for (name, ty) in then { self.bind(&name, ty); }
                },
                Stmt::For { binding, domain, body } => {
                    let ty = match domain {
                        LoopDomain::Page(scan) => self.scan(scan)?.item(),
                        LoopDomain::DerivedArray { value, .. } => self.expr(value, false)?.item(),
                        LoopDomain::ArgList { name, .. } => self.use_name(name, false).item(),
                        LoopDomain::Recurse(r) => { self.expr(&r.seed, false)?; self.field(Type::Row(r.table.clone()), &r.next_field, false)?; Type::Row(r.table.clone()) },
                        LoopDomain::ExpressionRange { start, end_exclusive } => { self.expr(start, false)?; self.expr(end_exclusive, false)?; Type::Scalar },
                        LoopDomain::LiteralRange { .. } => Type::Scalar,
                    };
                    self.bind(binding, ty);
                    loop {
                        let prior = self.env.clone();
                        returned = returned.join(self.body(body, query)?);
                        for (name, ty) in &prior { self.bind(name, ty.clone()); }
                        if self.env == prior { break; }
                    }
                },
                Stmt::WriteTarget { target, patch, condition, result, .. } => {
                    let row = self.read(target)?; self.expr(patch, false)?;
                    if let Some(c) = condition { self.bind(&c.old, row.clone()); self.body(&c.setup, false)?; self.expr(&c.value, false)?; }
                    if let Some(name) = result { self.bind(name, row); }
                },
                Stmt::Insert { row, .. } => { self.expr(row, false)?; },
                Stmt::InsertIfAbsent { table, row, result } => { self.expr(row, false)?; self.bind(result, Type::Row(table.clone())); },
                Stmt::Update { key, patch, .. } | Stmt::Upsert { key, row: patch, .. } => { self.expr(key, false)?; self.expr(patch, false)?; },
                Stmt::Delete { key, .. } => { self.expr(key, false)?; },
                Stmt::DeleteTarget { target } => { self.read(target)?; },
                Stmt::Emit { payload, once, .. } => { self.expr(payload, false)?; if let Some(e) = once { self.expr(e, false)?; } },
                Stmt::Break | Stmt::Continue => {},
            }
        }
        Ok(returned)
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
