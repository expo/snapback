//! Bounded reservations for the total point-read slice omitted by prediction.
//! Only opaque prices travel to devices; the authoritative host rebuilds them.
// @ref LLP 3000.013#12.3 — skipped payload work has a shared declared allowance.
use super::{Schema, reservations::Price};
use crate::ir::*;
use std::collections::{BTreeMap, BTreeSet};

// A growing loop-carried value has no finite fixed point. Reject it instead of
// silently truncating its price. Saturation also makes adversarial bounds safe.
const LIMIT: u64 = 1 << 40;
fn sum(a:u64,b:u64)->u64 {a.saturating_add(b).min(LIMIT)}
fn mul(a:u64,b:u64)->u64 {a.saturating_mul(b).min(LIMIT)}
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Bound { heap:u64, deps:u64 }
#[derive(Default)]
struct Cost { nodes:u64, heap:u64, work:u64, reads:u64, probes:u64 }
impl Cost {
    fn value(&mut self,b:Bound) { self.nodes=sum(self.nodes,1); self.heap=sum(self.heap,sum(b.heap,mul(b.deps,256))); }
    fn price(&self)->Price {
        // Expression visits and bounded authorization use node fees; only
        // builtins with an explicit byte-work charge add that work.
        // Eight copies cover expression, binding, rule/key and presence frames;
        // collection capacities and text expansion are included in Bound.
        [sum(mul(self.nodes,16),mul(self.work,4)),0,self.reads,0,
         sum(mul(self.nodes,2048),mul(self.heap,8)),0,self.probes]
    }
}
fn argument(a:&ArgType)->Option<u64> { Some(match a {
    ArgType::Optional(a)=>argument(a)?,
    ArgType::Text{max,..}=>mul(*max as u64,4),
    ArgType::Bytes{max}=>*max as u64,
    ArgType::Id|ArgType::Principal|ArgType::Ref{..}=>144,
    ArgType::Int|ArgType::Bool|ArgType::Time|ArgType::Decimal{..}|ArgType::Money{..}=>0,
    ArgType::Enum{variants}=>variants.iter().map(|s|s.len() as u64).max().unwrap_or(0),
    ArgType::Json{max_bytes}=>mul(*max_bytes as u64,128),
    ArgType::List{of:Some(of),max}=>mul(*max as u64,sum(64,argument(of)?)),
    ArgType::Image{..}|ArgType::Video{..}=>16384,
    _=>return None,
}) }
fn literal(v:&crate::Value)->u64 {
    use crate::Value;
    match v {
        Value::String(s)|Value::Id(s)=>s.len() as u64,
        Value::Bytes(b)=>b.len() as u64,
        Value::Array(a)=>a.iter().fold(mul(a.len() as u64,64),|n,v|sum(n,literal(v))),
        Value::Row(m)|Value::Map(m)=>m.iter().fold(128,|n,(k,v)|sum(n,sum(128+k.len() as u64,literal(v)))),
        _=>0,
    }
}
fn presence_expr(e:&Expr)->u64 {
    match e {
        Expr::Builtin{builtin,args}=>args.iter().map(presence_expr).fold(u64::from(matches!(builtin,Builtin::Connected)),sum),
        Expr::Field{base,..}|Expr::Unary{value:base,..}=>presence_expr(base),
        Expr::Array(a)=>a.iter().map(presence_expr).fold(0,sum),
        Expr::Object(f)=>f.values().map(presence_expr).fold(0,sum),
        Expr::Shape{base,fields}=>fields.values().map(presence_expr).fold(presence_expr(base),sum),
        Expr::Binary{left,right,..}=>sum(presence_expr(left),presence_expr(right)),
        Expr::Get(r)|Expr::Exists(r)=>r.key.iter().map(presence_expr).fold(0,sum),
        Expr::Block{body,value}=>sum(presence_body(body),presence_expr(value)),
        _=>0,
    }
}
fn presence_body(body:&[Stmt])->u64 {
    body.iter().map(|s|match s {
        Stmt::Const{value,..}|Stmt::Let{value,..}|Stmt::Assign{value,..}|Stmt::Return(value)=>presence_expr(value),
        Stmt::Emit{payload,once,..}=>sum(presence_expr(payload),once.as_ref().map_or(0,presence_expr)),
        Stmt::If{condition,then_body,else_body}=>sum(presence_expr(condition),sum(presence_body(then_body),presence_body(else_body))),
        Stmt::For{domain,body,..}=>{
            let n=presence_body(body);
            if n==0 {return 0;}
            let limit=match domain {
                LoopDomain::LiteralRange{start,end_exclusive}=>end_exclusive.saturating_sub(*start).max(0) as u64,
                LoopDomain::Page(Scan{take:crate::ir::Bound::Literal(n),..})=>*n as u64,
                LoopDomain::ArgList{max,..}|LoopDomain::DerivedArray{max,..}=>*max as u64,
                _=>LIMIT,
            };
            mul(n,limit)
        }
        _=>0,
    }).fold(0,sum)
}
struct Analysis<'a> { schema:&'a Schema, env:BTreeMap<String,Bound>, blocked:BTreeSet<String>, definitions:BTreeMap<String,Vec<Expr>>, dep_limit:u64 }
impl Analysis<'_> {
    // A bounded derived loop copies one element, not its accumulating source
    // array. Join all definitions, following cycles only once. Nested/growing
    // element values still need the ordinary finite expression bound.
    fn element(&self, e:&Expr, seen:&mut BTreeSet<String>)->Option<Bound> {
        let values=match e {
            Expr::Variable(n)=>{
                if !seen.insert(n.clone()) { return Some(Bound::default()); }
                let out=self.definitions.get(n)?.iter().map(|e|self.element(e,seen)).collect::<Option<Vec<_>>>()?;
                seen.remove(n); out
            }
            Expr::Array(items)=>items.iter().map(|e|self.expr(e,&mut Cost::default())).collect::<Option<Vec<_>>>()?,
            Expr::Builtin{builtin:Builtin::Concat,args}=>args.iter().map(|e|self.element(e,seen)).collect::<Option<Vec<_>>>()?,
            Expr::Literal(crate::Value::Array(items))=>items.iter().map(|v|Bound{heap:literal(v),deps:0}).collect(),
            _=>return None,
        };
        Some(values.into_iter().fold(Bound::default(),|a,b|Bound{heap:a.heap.max(b.heap),deps:a.deps.max(b.deps)}))
    }
    fn expr(&self,e:&Expr,c:&mut Cost)->Option<Bound> {
        let mut b=Bound::default();
        match e {
            Expr::Literal(v)=>b.heap=literal(v),
            Expr::Variable(n)=>b=*self.env.get(n)?,
            Expr::Input(Input::Viewer|Input::NewId)=>b.heap=144,
            Expr::Input(Input::Now|Input::ReadTime)=>{},
            Expr::Field{base,..}=>b=self.expr(base,c)?,
            Expr::Array(items)=>{
                b.heap=mul(items.len() as u64,64);
                for e in items {let v=self.expr(e,c)?;b.heap=sum(b.heap,v.heap);b.deps=sum(b.deps,v.deps);}
            }
            Expr::Object(fields)|Expr::Shape{fields,..}=>{
                b.heap=128;
                if let Expr::Shape{base,..}=e {b=self.expr(base,c)?;}
                for (k,e) in fields {let v=self.expr(e,c)?;b.heap=sum(b.heap,sum(128+k.len() as u64,v.heap));b.deps=sum(b.deps,v.deps);}
            }
            Expr::Unary{value,..}=>{b.deps=self.expr(value,c)?.deps;}
            Expr::Binary{left,right,..}=>{b.deps=sum(self.expr(left,c)?.deps,self.expr(right,c)?.deps);}
            Expr::Get(r)|Expr::Exists(r)=>{
                let table=self.schema.table(&r.table)?;
                // Live counts, expiry and read-through authorization can walk
                // data-dependent populations. Their reads retain normal residency.
                if table.is_expiring() || !table.maintained.is_empty() || table.through.is_some() || self.schema.maintain_for(&r.table).is_some_and(|m| m.row_key.is_some() || m.parent_key.is_some() || self.schema.tables[&m.source].is_expiring() || self.schema.tables[&m.source].through.is_some()) {return None;}
                let probes=crate::engine::rules::rule_probes(&table.rules.read);
                // Probe scratch and expiry depend on the referenced table graph.
                // Keep these uncommon payloads in the ordinary interpreter.
                if probes!=0 {return None;}
                for e in &r.key {b.deps=sum(b.deps,self.expr(e,c)?.deps);}
                c.reads=sum(c.reads,1);
                // Rule evaluation is prepaid by point authorization. Its static
                // tree still contributes to the shared omitted-read allowance.
                c.nodes=sum(c.nodes,crate::json_codec::to_vec(&table.rules.read).ok()?.len() as u64);
                b.heap=crate::engine::row_copy_ceiling(table);
                c.heap=sum(c.heap,mul(b.heap,4));
                if matches!(e,Expr::Exists(_)) {b.heap=0;}
            }
            Expr::Builtin{builtin,args}=>{
                let mut inputs=Vec::new();
                for e in args {let v=self.expr(e,c)?;b.deps=sum(b.deps,v.deps);inputs.push(v.heap);}
                let first=inputs.first().copied().unwrap_or(0);
                b.heap=match builtin {
                    Builtin::Connected=>{b.deps=sum(b.deps,1);0},
                    Builtin::Count|Builtin::Len|Builtin::Divmod{..}=>0,
                    Builtin::Sha256=>{c.work=sum(c.work,sum(first,1));64},
                    Builtin::Lower=>mul(first,3),
                    Builtin::Trim|Builtin::Slice|Builtin::First|Builtin::Last|Builtin::At=>first,
                    Builtin::Min|Builtin::Max=>inputs.into_iter().max().unwrap_or(0),
                    Builtin::Concat=>sum(mul(inputs.len() as u64,128),mul(inputs.into_iter().fold(0,sum),8)),
                    Builtin::Join=>sum(first,mul(first,inputs.get(1).copied().unwrap_or(0))),
                    _=>return None,
                };
            }
            _=>return None,
        }
        if b.heap>=LIMIT || b.deps>=LIMIT {return None;}
        c.value(b); Some(b)
    }
    fn merge(&mut self,n:&str,b:Bound)->bool {
        if self.blocked.contains(n) {return false;}
        let old=self.env.entry(n.into()).or_default();
        let changed=b.heap>old.heap || b.deps>old.deps;
        old.heap=old.heap.max(b.heap);old.deps=old.deps.max(b.deps);changed
    }
    fn definitions(&mut self,body:&[Stmt],guards:u64)->bool {
        let before=self.env.clone();let blocked=self.blocked.len();
        let mut changed=false;
        for s in body {match s {
            Stmt::Const{name,value}|Stmt::Let{name,value}|Stmt::Assign{name,value}=>{
                if let Some(mut b)=self.expr(value,&mut Cost::default()) {b.deps=sum(b.deps,guards).min(self.dep_limit);changed|=self.merge(name,b);}
            }
            Stmt::For{binding,domain,body}=>{
                let heap=match domain {
                    LoopDomain::Page(s)=>self.schema.table(&s.table).map(crate::engine::row_copy_ceiling),
                    LoopDomain::LiteralRange{..}|LoopDomain::ExpressionRange{..}=>Some(0),
                    LoopDomain::ArgList{name,..}=>self.env.get(name).map(|b|b.heap),
                    LoopDomain::DerivedArray{value,..}=>self.element(value,&mut BTreeSet::new()).map(|b|b.heap),
                    _=>None,
                };
                if let Some(heap)=heap {changed|=self.merge(binding,Bound{heap,deps:0});}
                changed|=self.definitions(body,guards);
            }
            Stmt::InsertIfAbsent{table,result,..}|Stmt::WriteTarget{target:Read{table,..},result:Some(result),..}=>{
                if let Some(t)=self.schema.table(table) {changed|=self.merge(result,Bound{heap:crate::engine::row_copy_ceiling(t),deps:0});}
            }
            Stmt::If{condition,then_body,else_body}=>{
                let deps=self.expr(condition,&mut Cost::default()).map_or(0,|b|b.deps);
                let coalesce=match condition {
                    Expr::Binary{op:BinaryOp::Eq,left,right} if **right==Expr::Literal(crate::Value::Null) && else_body.is_empty()=>match left.as_ref() {
                        Expr::Variable(n) if n.starts_with("$or") && matches!(then_body.last(),Some(Stmt::Assign{name,..}) if name==n)=>self.env.get(n).map(|v|(n.clone(),v.deps)),
                        _=>None,
                    },_=>None,
                };
                let g=sum(guards,deps);changed|=self.definitions(then_body,g);changed|=self.definitions(else_body,g);
                // The coalescing owner already contains its condition's
                // dependencies. Do not repeatedly add that same guard on each
                // abstract fixed-point pass. Keep the old arm and every new
                // fallback dependency; other fallback locals stay conservative.
                if let Some((n,old))=coalesce {if let Some(b)=self.env.get_mut(&n) {b.deps=old.max(b.deps.saturating_sub(deps));}}
            }
            Stmt::Push{target,..}=>{changed|=self.blocked.insert(target.clone());self.env.remove(target);}
            _=>{},
        }} changed && (self.env!=before || self.blocked.len()!=blocked)
    }
    fn invalidate(&mut self, body:&[Stmt])->bool {
        let mut changed=false;
        for s in body {match s {
            Stmt::Const{name,value}|Stmt::Let{name,value}|Stmt::Assign{name,value}=>{
                if self.expr(value,&mut Cost::default()).is_none() {changed|=self.blocked.insert(name.clone());self.env.remove(name);}
            }
            Stmt::For{body,..}=>changed|=self.invalidate(body),
            Stmt::If{then_body,else_body,..}=>{changed|=self.invalidate(then_body);changed|=self.invalidate(else_body);}
            _=>{},
        }} changed
    }
    fn statement(&self,s:&Stmt,c:&mut Cost)->Option<()> {
        c.nodes=sum(c.nodes,1);
        match s {
            Stmt::Const{name,value}|Stmt::Let{name,value}|Stmt::Assign{name,value}=>{
                let v=self.expr(value,c)?;c.value(v);c.heap=sum(c.heap,name.len() as u64);
            }
            Stmt::Emit{payload,once,..}=>{let v=self.expr(payload,c)?;c.value(v);if let Some(key)=once {let b=self.expr(key,&mut Cost::default())?;c.value(Bound{heap:0,deps:b.deps});}}
            Stmt::If{condition,then_body,else_body}=>{
                // Runtime once-key inserts cannot be hidden inside a restoring
                // payload scope. Such a presence arm stays server-only.
                fn once(body:&[Stmt])->bool {body.iter().any(|s|match s {Stmt::Emit{once:Some(_),..}=>true,Stmt::If{then_body,else_body,..}=>once(then_body)||once(else_body),_=>false})}
                if once(then_body)||once(else_body) {return None;}
                self.expr(condition,c)?;
                for s in then_body.iter().chain(else_body) {self.statement(s,c)?;}
            }
            _=>return None,
        } Some(())
    }
    fn sites(&self,body:&[Stmt],prefix:&str,skips:&BTreeSet<&str>,guards:u64,out:&mut BTreeMap<String,Price>)->Option<()> {
        for (i,s) in body.iter().enumerate() {
            let site=format!("{prefix}:{}",i+1);
            if skips.contains(site.as_str()) {
                let mut cost=Cost::default();self.statement(s,&mut cost)?;cost.heap=sum(cost.heap,mul(guards,512));out.insert(site,cost.price());continue;
            }
            match s {
                Stmt::If{condition,then_body,else_body}=>{let deps=self.expr(condition,&mut Cost::default()).map_or(1,|b|b.deps);let g=sum(guards,deps);self.sites(then_body,&format!("{site}:then"),skips,g,out)?;self.sites(else_body,&format!("{site}:else"),skips,g,out)?;}
                Stmt::For{body,..}=>self.sites(body,&site,skips,guards,out)?,
                _=>{},
            }
        } Some(())
    }
}
/// None means the erased slice lacks a finite, store-independent allowance.
pub fn prices(schema:&Schema,p:&Program,skips:&[String])->Option<BTreeMap<String,Price>> {
    if skips.is_empty() {return Some(BTreeMap::new());}
    fn definitions(body:&[Stmt], out:&mut BTreeMap<String,Vec<Expr>>) {
        for s in body {match s {
            Stmt::Const{name,value}|Stmt::Let{name,value}|Stmt::Assign{name,value}=>out.entry(name.clone()).or_default().push(value.clone()),
            Stmt::For{body,..}=>definitions(body,out),
            Stmt::If{then_body,else_body,..}=>{definitions(then_body,out);definitions(else_body,out);},
            _=>{},
        }}
    }
    let mut defs=BTreeMap::new();definitions(&p.body,&mut defs);
    let mut a=Analysis{schema,env:BTreeMap::new(),blocked:BTreeSet::new(),definitions:defs,dep_limit:presence_body(&p.body)};
    for (n,t) in &p.args {if let Some(heap)=argument(t) {a.env.insert(n.clone(),Bound{heap,deps:0});}}
    for _ in 0..128 {
        if !a.definitions(&p.body,0) {
            while a.invalidate(&p.body) {}
            let mut out=BTreeMap::new();a.sites(&p.body,&p.name,&skips.iter().map(String::as_str).collect(),0,&mut out)?;return Some(out);
        }
    }
    None
}
