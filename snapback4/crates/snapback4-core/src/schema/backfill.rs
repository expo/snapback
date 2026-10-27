//! Historical row transforms, separate from application-callable programs.
// @ref LLP 3000.000.000.002#2-language — the compiler and raw-schema boundary share a closed expression fragment.
use super::*;
use crate::ir::{Builtin, Expr, Program, ProgramKind, Stmt};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Backfill {
    pub table: String,
    pub name: String,
    pub inputs: BTreeMap<String, ColumnType>,
    pub outputs: BTreeSet<String>,
    pub program: Program,
}
impl Backfill {
    pub fn key(&self) -> String { digest(&self.normalized()) }
    pub fn down_key(&self) -> String { digest(&("down", self.normalized())) }
    pub fn normalized(&self) -> Self {
        // Locations are diagnostic metadata, never transformation identity.
        let mut normalized = self.clone();
        fn expr(e: &mut Expr) {
            match e {
                Expr::Get(r) | Expr::Exists(r) => { r.site.clear(); for e in &mut r.key { expr(e); } }
                Expr::Scan(r) => {
                    r.site.clear();
                    for k in &mut r.prefix { if let crate::ir::IndexKeyExpr::Scalar(e)=k {expr(e);} }
                    if let Some(e)=&mut r.filter {expr(e);}
                    if let Some(r)=&mut r.range {for e in [&mut r.gt,&mut r.gte,&mut r.lt,&mut r.lte].into_iter().flatten(){expr(e);}}
                }
                Expr::Field { base, .. } | Expr::Unary { value: base, .. } => expr(base),
                Expr::Array(es) | Expr::Builtin { args: es, .. } => { for e in es { expr(e); } }
                Expr::Object(fs) => { for e in fs.values_mut() { expr(e); } }
                Expr::Shape { base, fields } => { expr(base); for e in fields.values_mut() { expr(e); } }
                Expr::Binary { left, right, .. } => { expr(left); expr(right); }
                Expr::Block { body, value } => { statements(body); expr(value); }
                _ => (),
            }
        }
        fn statements(body: &mut [Stmt]) {
            for s in body {
                match s {
                    Stmt::Let { value, .. } | Stmt::Const { value, .. } | Stmt::Assign { value, .. } | Stmt::Return(value) => expr(value),
                    Stmt::Require { condition, site, .. } => { *site=None; expr(condition); },
                    Stmt::If { condition, then_body, else_body } => { expr(condition); statements(then_body); statements(else_body); }
                    _ => (),
                }
            }
        }
        statements(&mut normalized.program.body);
        normalized
    }
    pub fn admit(&self, schema: &Schema) -> Result<(), String> {
        let table = schema.table(&self.table).ok_or("backfill names an absent table")?;
        if table.ephemeral.is_some() || schema.maintain_for(&self.table).is_some() { return Err("backfill requires an authoritative durable table".into()); }
        if self.program.kind != ProgramKind::Query || self.program.native || self.outputs.is_empty() { return Err("backfill must produce a nonempty object patch".into()); }
        for c in &self.outputs {
            let kind = table.columns.get(c).ok_or_else(||format!("backfill output {}.{c} is not declared",self.table))?;
            if c=="id" || table.engine_field(c) || table.sequences.contains_key(c) || table.maintained.contains_key(c) || table.expire.as_ref()==Some(c) || table.not_before.as_ref()==Some(c) || !scalar(kind) {
                return Err(format!("backfill output {}.{c} must be an authoritative scalar, not an asset, lifetime or captured field",self.table));
            }
        }
        if !body(&self.program.body,schema) { return Err("backfill expressions allow deterministic scalar transforms, unique point lookups and bounded existence; no viewer, clock, ids, row collections, loops or writes".into()); }
        Ok(())
    }
    pub fn admit_down(&self, schema: &Schema) -> Result<(), String> {
        let table = schema.table(&self.table).ok_or("down projection names an absent current table")?;
        if table.ephemeral.is_some() || schema.maintain_for(&self.table).is_some() { return Err("down projection requires an authoritative durable table".into()); }
        if self.program.kind != ProgramKind::Query || self.program.native || self.outputs.is_empty() { return Err("down projection must produce a nonempty object patch".into()); }
        if self.outputs.contains("id") { return Err("down projection cannot replace row identity".into()); }
        for c in &self.outputs {
            if table.columns.get(c).is_some_and(|kind| !native_scalar(kind)) || table.engine_field(c) || table.sequences.contains_key(c) || table.maintained.contains_key(c) || table.expire.as_ref()==Some(c) || table.not_before.as_ref()==Some(c) {
                return Err(format!("down native preimage {}.{c} must be an authoritative scalar without reference, asset or lifetime custody; use a typed bridge",self.table));
            }
        }
        if !body(&self.program.body,schema) { return Err("down expressions allow deterministic scalar transforms, unique point lookups and bounded existence; no viewer, clock, ids, row collections, loops or writes".into()); }
        Ok(())
    }
}
pub(super) fn validate_downs(schema:&Schema)->Vec<SchemaIssue>{
    let mut issues=Vec::new();let mut names=BTreeSet::new();let mut outputs=BTreeSet::new();
    for f in &schema.downfills {
        if let Err(message)=f.admit_down(schema){issues.push(SchemaIssue{path:format!("downfills.{}.{}",f.table,f.name),message});}
        if !names.insert((&f.table,&f.name))||f.outputs.iter().any(|c|!outputs.insert((&f.table,c))){issues.push(SchemaIssue{path:format!("downfills.{}.{}",f.table,f.name),message:"down projections require distinct names and disjoint outputs".into()});}
    }issues
}
fn native_scalar(k: &ColumnType) -> bool {
    match k {ColumnType::Optional(k)=>native_scalar(k),ColumnType::Ref{..}=>false,_=>scalar(k)}
}
fn scalar(k: &ColumnType) -> bool {
    match k {
        ColumnType::Optional(k) => scalar(k),
        ColumnType::Image { .. } | ColumnType::Video { .. } | ColumnType::File { .. } | ColumnType::List { .. } | ColumnType::ListRange { .. } => false,
        _ => true,
    }
}
fn body(stmts: &[Stmt], s: &Schema) -> bool {
    stmts.iter().all(|stmt| match stmt {
        Stmt::Let { value, .. } | Stmt::Const { value, .. } | Stmt::Assign { value, .. } | Stmt::Return(value) => expr(value,s),
        Stmt::Require { condition, .. } => expr(condition,s),
        Stmt::If { condition, then_body, else_body } => expr(condition,s) && body(then_body,s) && body(else_body,s),
        _ => false,
    })
}
fn expr(e: &Expr, s: &Schema) -> bool {
    match e {
        Expr::Builtin{builtin:Builtin::FileText,args}=>args.len()==1 && args.iter().all(|e|expr(e,s)),
        Expr::Literal(_) | Expr::Variable(_) => true,
        Expr::Input(_) | Expr::Merge(_) => false,
        Expr::Scan(r) => s.table(&r.table).and_then(|t|t.index(&r.index)).is_some_and(|i|i.is_plain() && r.prefix.len()<=i.components.len() && (r.range.is_none() || r.prefix.len()<i.components.len())) && r.existence && r.after.is_none() && r.before.is_none() && r.prefix.iter().all(|k| k.scalar().is_some_and(|e|expr(e,s))) && r.filter.as_ref().is_none_or(|e|expr(e,s)) && r.range.as_ref().is_none_or(|r|[&r.gt,&r.gte,&r.lt,&r.lte].iter().all(|e|e.as_ref().is_none_or(|e|expr(e,s)))),
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => expr(base,s),
        Expr::Array(es) => es.iter().all(|e|expr(e,s)),
        Expr::Object(es) => es.values().all(|e|expr(e,s)),
        Expr::Shape { base, fields } => expr(base,s) && fields.values().all(|e|expr(e,s)),
        Expr::Binary { left, right, .. } => expr(left,s) && expr(right,s),
        Expr::Block { body: stmts, value } => body(stmts,s) && expr(value,s),
        Expr::Get(r) | Expr::Exists(r) => s.table(&r.table).is_some_and(|t| t.index(&r.index).is_some_and(|i|i.unique && i.is_plain() && i.components.len()==r.key.len())) && r.key.iter().all(|e|expr(e,s)),
        Expr::Builtin { builtin, args } => matches!(builtin,
            Builtin::RequireUncapped | Builtin::ProjectFields { .. } | Builtin::OptionalField { .. } | Builtin::Len | Builtin::Count | Builtin::Slice | Builtin::Concat | Builtin::Lower | Builtin::Trim | Builtin::Text(_) | Builtin::Sha256 | Builtin::First | Builtin::Last | Builtin::At | Builtin::Min | Builtin::Max | Builtin::Divide { .. } | Builtin::Civil(_) | Builtin::Calendar { .. }
        ) && args.len()==builtin.arity() && args.iter().all(|e|expr(e,s)),
    }
}

// @ref LLP 3000.000.000.003#3-one-release-evolution — identity renames may widen scalar domains, never coerce or narrow them.
pub fn rename_accepts(old: &ColumnType, new: &ColumnType) -> bool {
    use ColumnType::*;
    if old == new { return true; }
    match (old,new) {
        (Optional(a),Optional(b)) => rename_accepts(a,b),
        (Optional(_),_) => false,
        (a,Optional(b)) => rename_accepts(a,b),
        (Text{max:a},Text{max:b}) => b>=a,
        (IntRange{min:a,max:b},IntRange{min:c,max:d}) => c<=a && d>=b,
        (IntRange{..},Int) => true,
        (Enum{variants:a},Enum{variants:b}) => a.iter().all(|v|b.contains(v)),
        _ => false,
    }
}

/// Text minima/formats belong to table constraints, outside ColumnType.
pub fn rename_column_accepts(old:&crate::schema::Table,old_name:&str,new:&crate::schema::Table,new_name:&str)->bool {
    let (Some(a),Some(b))=(old.columns.get(old_name),new.columns.get(new_name))else{return false};
    if !rename_accepts(a,b){return false;}
    let text=|table:&crate::schema::Table,name:&str|table.constraints.iter().find_map(|c|match c{crate::schema::Constraint::Text{field,min,format}if field==name=>Some((*min,format.clone())),_=>None}).unwrap_or((0,None));
    let (amin,af)=text(old,old_name);let(bmin,bf)=text(new,new_name);
    bmin<=amin&&(bf.is_none()||bf==af)
}
