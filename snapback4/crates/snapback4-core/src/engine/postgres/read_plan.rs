//! Conservative physical read planning. The Rust interpreter still executes,
//! authorizes and meters every read over these snapshot-local exact answers.
// @ref LLP 3000.009#4.2 — batching access never evaluates Quarry in SQL.
use super::store::{Tx, decode};
use crate::{RuntimeError, Value, Schema, Program, engine::Context, ir::*, rows::{Bounds, Dir}, schema::{RuleExpr, RuleTerm}};
use postgres::types::ToSql;
use std::collections::BTreeMap;

pub(super) const GET: &str = "SELECT data FROM r WHERE t = $1 AND id = $2";
pub(super) const ASC: &str = "SELECT r.data, i.k FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k ASC LIMIT $5";
pub(super) const DESC: &str = "SELECT r.data, i.k FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k DESC LIMIT $5";
#[derive(Clone, PartialEq, Eq)]
struct Access { table: String, index: String, id: String, lo: Vec<u8>, hi: Vec<u8>, dir: Dir, n: i64 }
impl Access {
    fn point(table: &str, index: &str, key: &[Value]) -> Option<Self> {
        if index == "byId" {
            return Some(Self { table: table.into(), index: index.into(), id: key.first()?.as_str().ok()?.into(), lo: vec![], hi: vec![], dir: Dir::Asc, n: 1 });
        }
        Self::range(table, index, key, Dir::Asc, 1)
    }
    fn range(table: &str, index: &str, key: &[Value], dir: Dir, n: i64) -> Option<Self> {
        let (lo,hi) = crate::rows::scan_range(key, &Bounds::default(), dir)?;
        Some(Self { table: table.into(), index: index.into(), id: String::new(), lo, hi, dir, n })
    }
    fn sql(&self) -> &'static str { if self.index == "byId" { GET } else if self.dir == Dir::Asc { ASC } else { DESC } }
    fn params(&self) -> Vec<&(dyn ToSql + Sync)> {
        if self.index == "byId" { vec![&self.table, &self.id] } else { vec![&self.table, &self.index, &self.lo, &self.hi, &self.n] }
    }
}
#[derive(Default)]
pub(super) struct Answers(Vec<(Access, Vec<(Value, Vec<u8>)>)>);
impl Answers {
    pub fn get(&self, table: &str, id: &str) -> Option<Option<Value>> {
        self.0.iter().find(|(a,_)| a.table == table && a.index == "byId" && a.id == id).map(|(_,v)| v.first().map(|(v,_)| v.clone()))
    }
    pub fn lookup(&self, table: &str, index: &str, key: &[Value]) -> Option<Option<Value>> {
        if index == "byId" && key.len() == 1 { return self.get(table,key[0].as_str().ok()?); }
        let (lo,hi) = crate::rows::scan_range(key, &Bounds::default(), Dir::Asc)?;
        self.scan(table,index,&lo,&hi,Dir::Asc,1).map(|v| v.first().map(|(v,_)|v.clone()))
    }
    pub fn scan(&self, table: &str, index: &str, lo: &[u8], hi: &[u8], dir: Dir, n: usize) -> Option<Vec<(Value,Vec<u8>)>> {
        self.0.iter().find(|(a,v)| a.table == table && a.index == index && a.lo == lo && a.hi == hi && a.dir == dir && (a.n as usize >= n || v.len() < a.n as usize))
            .map(|(_,v)| v.iter().take(n).cloned().collect())
    }
}
struct Root { access: Access, fields: BTreeMap<String,Value> }
pub(crate) struct Plan { roots: Vec<Root>, accesses: Vec<Access>, later: bool, schema: Schema, viewer: String }
impl Plan {
    pub fn new(schema: &Schema, program: &Program, context: &Context) -> Option<Self> {
        if schema.tables.values().any(|t|t.not_before.is_some()) { return None; }
        if program.native || program.kind != ProgramKind::Query || !matches!(context.request_credential_kind.as_deref()?, "guest"|"user"|"member"|"account"|"oidc"|"service") { return None; }
        let mut plan = Self { roots: vec![], accesses: vec![], later:false, schema:schema.clone(), viewer:context.viewer.clone() };
        plan.block(&program.body, context)?;
        if plan.roots.is_empty() { return None; }
        for root in &plan.roots {
            if !safe_table(schema,&root.access.table) || !plannable_rule(schema,&schema.tables[&root.access.table].rules.read) { return None; }
            match probes(schema,&root.access.table,&root.fields,&context.viewer) {
                Some(accesses) => for access in accesses { if !plan.accesses.contains(&access) { plan.accesses.push(access); } },
                None if root.access.n == 1 => plan.later = true,
                None => return None,
            }
        }
        let mut bytes = 0u64;
        let mut probes = 0u64;
        for root in &plan.roots {
            let rule = &schema.tables[&root.access.table].rules.read;
            probes = probes.saturating_add(super::super::rules::rule_probes(rule));
            bytes = bytes.saturating_add(probe_bytes(schema,rule));
        }
        for access in &plan.accesses {
            bytes = bytes.saturating_add(crate::rows::disclosed::decode_reservation(&schema.tables[&access.table]).saturating_add(256).saturating_mul(access.n as u64));
        }
        // Reuse the existing exact-prefetch allowance. Larger declarations and
        // probe fanouts retain the ordinary decoder admission path.
        if plan.accesses.len().saturating_add(probes as usize) > 16 || bytes > super::prefetch::PREFETCH_ROW_BYTES as u64 { return None; }
        Some(plan)
    }
    fn block(&mut self, body: &[Stmt], context: &Context) -> Option<()> {
        for stmt in body {
            match stmt {
                Stmt::Let { value,.. } | Stmt::Const { value,.. } | Stmt::Require { condition:value,.. } | Stmt::Return(value) => self.expr(value,context)?,
                _ => return None,
            }
        }
        Some(())
    }
    fn expr(&mut self, e: &Expr, c: &Context) -> Option<()> {
        match e {
            Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {},
            Expr::Builtin { builtin:Builtin::RequireUncapped,args } => for a in args { self.expr(a,c)?; },
            Expr::Binary { left,right,.. } => { self.expr(left,c)?; self.expr(right,c)?; },
            Expr::Unary { value,.. } => self.expr(value,c)?,
            Expr::Get(r) | Expr::Exists(r) => {
                let key = r.key.iter().map(|v| key(v,c)).collect::<Option<Vec<_>>>()?;
                let access = Access::point(&r.table,&r.index,&key)?;
                let fields = fields(&self.schema,&r.table,&r.index,&key)?;
                self.add(Root { access,fields });
            },
            Expr::Scan(s) if s.after.is_none() && s.before.is_none() && s.range.is_none() && s.filter.is_none() && s.merge_site.is_none() && !s.opaque_cursor => {
                if !super::super::rules::scan_visibility(&self.schema,s).uniform { return None; }
                let values = s.prefix.iter().map(|v| key(v.scalar()?,c)).collect::<Option<Vec<_>>>()?;
                let Bound::Literal(n) = s.take else { return None; };
                if n > 128 { return None; }
                let access = Access::range(&s.table,&s.index,&values,if s.order == Order::Asc {Dir::Asc} else {Dir::Desc}, i64::from(n)+1)?;
                let fields = fields(&self.schema,&s.table,&s.index,&values)?;
                self.add(Root { access, fields });
            },
            _ => return None,
        }
        Some(())
    }
    fn add(&mut self, root: Root) {
        if !self.accesses.contains(&root.access) { self.accesses.push(root.access.clone()); }
        self.roots.push(root);
    }
    pub fn execute(self, tx: &Tx<'_>, digest: &str) -> Result<crate::identity::facts::SessionFacts,RuntimeError> {
        let facts_sql = super::authority::session_facts_sql(tx.read_sessions.get());
        let digest_params: &[&(dyn ToSql + Sync)] = &[&digest];
        let params: Vec<_> = self.accesses.iter().map(Access::params).collect();
        let mut commands = vec![(facts_sql,digest_params)];
        commands.extend(self.accesses.iter().zip(&params).map(|(a,p)|(a.sql(),p.as_slice())));
        let mut results = tx.flight(&commands, if self.later { "" } else { "ROLLBACK" })?;
        let facts = super::authority::session_facts_rows(results.remove(0).rows);
        if !self.later { tx.finish_read_flight(); }
        if tx.needs_complete_facts(&facts) { return tx.complete_request_facts(digest); }
        for (access,result) in self.accesses.iter().zip(results) { insert(tx,access.clone(),result.rows)?; }
        if self.later { *tx.pending_read.borrow_mut() = Some(self); }
        Ok(facts)
    }
    pub(super) fn finish(self, tx: &Tx<'_>) -> Result<(),RuntimeError> {
            let mut next = Vec::new();
            for root in &self.roots {
                let answers = tx.read_cache.borrow();
                for (_, rows) in answers.0.iter().filter(|(a,_)| a == &root.access) {
                    for (row,_) in rows {
                        let image = crate::schema::row_image(row,&self.schema.tables[&root.access.table]);
                        let fields = self.schema.tables[&root.access.table].columns.keys().filter_map(|name| image.field(name).ok().map(|v|(name.clone(),v.clone()))).collect();
                        for access in probes(&self.schema,&root.access.table,&fields,&self.viewer).ok_or_else(|| RuntimeError::Store("incomplete physical read plan".into()))? {
                            if !self.accesses.contains(&access) && !next.contains(&access) { next.push(access); }
                        }
                    }
                }
            }
            let params: Vec<_> = next.iter().map(Access::params).collect();
            let commands: Vec<_> = next.iter().zip(&params).map(|(a,p)|(a.sql(),p.as_slice())).collect();
            let results = tx.flight(&commands,"ROLLBACK")?;
            tx.finish_read_flight();
            for (access,result) in next.into_iter().zip(results) { insert(tx,access,result.rows)?; }
        Ok(())
    }
}
fn insert(tx: &Tx<'_>, access: Access, rows: Vec<super::store::Row>) -> Result<(),RuntimeError> {
    let values = rows.iter().map(|row| Ok((decode(row.get(0))?, if access.index == "byId" {vec![]} else {row.get(1)}))).collect::<Result<_,RuntimeError>>()?;
    tx.read_cache.borrow_mut().0.push((access,values));
    Ok(())
}
fn key(e: &Expr,c: &Context) -> Option<Value> {
    match e { Expr::Literal(v) => Some(v.clone()), Expr::Variable(n) => c.args.get(n).cloned(), Expr::Input(Input::Viewer) => Some(Value::Id(c.viewer.clone())), _ => None }
}
fn fields(s: &Schema,t: &str,i: &str,key: &[Value]) -> Option<BTreeMap<String,Value>> {
    Some(s.table(t)?.index(i)?.columns().into_iter().zip(key.iter().cloned()).collect())
}
fn safe_table(s: &Schema,t: &str) -> bool {
    let Some(t) = s.table(t).filter(|_|s.maintain_for(t).is_none()) else { return false; };
    !crate::rows::disclosed::actual_size(t) && t.recorded.is_empty() && t.sequences.is_empty()
        && t.written_by.values().all(|a|a.audience) && t.ephemeral.is_none() && t.sync.is_none() && t.expire.is_none() && t.not_before.is_none() && t.through.is_none() && t.maintained.is_empty() && t.column_reads.is_empty() && !t.rules.read.has_reference()
}
fn probes(s: &Schema,t: &str,fields: &BTreeMap<String,Value>, viewer: &str) -> Option<Vec<Access>> {
    fn walk(s: &Schema,r: &RuleExpr,f: &BTreeMap<String,Value>,v: &str,out: &mut Vec<Access>) -> Option<()> {
        match r {
            RuleExpr::And(rs) | RuleExpr::Or(rs) => for r in rs {walk(s,r,f,v,out)?;},
            RuleExpr::Not(r) => walk(s,r,f,v,out)?,
            RuleExpr::Exists { table,index,key,.. } => {
                if !safe_table(s,table) { return None; }
                // This slice plans one rule-probe level. Nested probes fall back.
                if has_probe(&s.table(table)?.rules.read) { return None; }
                let values = key.iter().map(|t| match t { RuleTerm::Field(n) => f.get(n).cloned(), RuleTerm::Viewer => Some(Value::Id(v.into())), RuleTerm::Literal(x)=>Some(x.clone()), _=>None }).collect::<Option<Vec<_>>>()?;
                out.push(Access::point(table,index,&values)?);
            },
            RuleExpr::Created {..} => return None,
            _ => {},
        }
        Some(())
    }
    let mut out = Vec::new(); walk(s,&s.table(t)?.rules.read,fields,viewer,&mut out)?; Some(out)
}
fn probe_bytes(s: &Schema,r: &RuleExpr) -> u64 {
    match r {
        RuleExpr::And(rs)|RuleExpr::Or(rs) => rs.iter().fold(0u64,|n,r|n.saturating_add(probe_bytes(s,r))),
        RuleExpr::Not(r) => probe_bytes(s,r),
        RuleExpr::Exists {table,..} => crate::rows::disclosed::decode_reservation(&s.tables[table]).saturating_add(256),
        _ => 0,
    }
}
fn has_probe(r: &RuleExpr) -> bool {
    match r { RuleExpr::Exists {..}|RuleExpr::Created{..} => true, RuleExpr::And(rs)|RuleExpr::Or(rs)=>rs.iter().any(has_probe), RuleExpr::Not(r)=>has_probe(r), _=>false }
}

fn plannable_rule(s: &Schema,r: &RuleExpr) -> bool {
    match r {
        RuleExpr::And(rs)|RuleExpr::Or(rs) => rs.iter().all(|r|plannable_rule(s,r)),
        RuleExpr::Not(r) => plannable_rule(s,r),
        RuleExpr::Exists {table,key,equalities,..} => safe_table(s,table)
            && !has_probe(&s.tables[table].rules.read)
            && key.iter().chain(equalities.iter().map(|(_,v)|v)).all(|t| matches!(t,RuleTerm::Field(_)|RuleTerm::Viewer|RuleTerm::Literal(_))),
        RuleExpr::Created {..} => false,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "private Postgres"]
    fn serving_read_plan() {
        use crate::{Context,Engine,Value,identity,store_port::AnyStore,engine::DeliveryManifest};
        let source = include_str!("../../../../../reports/20261022-rt-a-round-trips/admitted-s1.q");
        let b = snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let schema = serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
        let programs: Vec<crate::Program> = b.programs.into_iter().map(|p|serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
        let store = AnyStore::create_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),&format!("rt6_read_{:x}",crate::ids::seed())).unwrap();
        let mut e = Engine::new_at(store,schema,programs,1000).unwrap();
        let session = identity::open_session(e.store(),"alice","guest",1000).unwrap();
        e.mutate("setup",None,Context::new("alice",Default::default()).at(1000)).unwrap();
        let args = [("key".into(),Value::Id("m1".into())),("at".into(),Value::Int(1))].into();
        e.mutate("seedMessage",None,Context::new("alice",args).at(1000)).unwrap();
        let digest=identity::session_digest(&session.token);
        for (op,args) in [("W1",[("message".into(),Value::Id("m1".into()))].into()),("W2",[("room".into(),Value::Id("r0001".into()))].into())] {
            let mut context=Context::new("alice",args).at(1000);context=context.with_request_credential("guest");
            let (out,_,_)=e.query_materialized_search_with_request(op,context,None,DeliveryManifest::Skip,&digest,|snap,_| {snap.request_authority(&digest,identity::ServiceSample{now:1000,supervisor_revision:0})?;Ok(())});
            assert!(out.is_ok(),"{op}: {out:?}");
        }
    }
}
