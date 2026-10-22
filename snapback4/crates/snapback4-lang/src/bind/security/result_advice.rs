//! Advisory lineage through compiled result/refusal expressions, never a proof.
// @ref LLP 3000.036.004#152-mutation-results-are-observations — projection is one observer, not a privacy boundary.
use super::*;
use snapback4_core::ir::{self,Expr,Stmt};
type Sources=BTreeSet<(String,String)>;
#[derive(Clone,Default)]
struct Flow{sources:Sources,fields:BTreeMap<String,Flow>}
impl Flow{
    fn all(&self)->Sources{self.sources.iter().cloned().chain(self.fields.values().flat_map(Flow::all)).collect()}
    fn union(xs:impl IntoIterator<Item=Flow>)->Self{Self{sources:xs.into_iter().flat_map(|f|f.all()).collect(),fields:BTreeMap::new()}}
    fn join(mut a:Flow,b:Flow)->Flow{a.sources.extend(b.sources);for(n,v)in b.fields{let old=a.fields.remove(&n).unwrap_or_default();a.fields.insert(n,Self::join(old,v));}a}
}
fn row(bound:&Bound,table:&str)->Flow{Flow{sources:Sources::new(),fields:bound.schema.tables.get(table).map(|t|t.columns.keys().map(|c|(c.clone(),Flow{sources:BTreeSet::from([(table.into(),c.clone())]),fields:BTreeMap::new()})).collect()).unwrap_or_default()}}
fn value(bound:&Bound,e:&Expr,env:&mut BTreeMap<String,Flow>,reads:&mut BTreeSet<String>,returned:&mut Sources,refusals:&mut Sources)->Flow{match e{
    Expr::Variable(n)=>env.get(n).cloned().unwrap_or_default(),
    Expr::Field{base,name}=>{let f=value(bound,base,env,reads,returned,refusals);f.fields.get(name).cloned().unwrap_or(Flow{sources:f.sources,fields:BTreeMap::new()})},
    Expr::Object(fields)=>Flow{sources:Sources::new(),fields:fields.iter().map(|(n,v)|(n.clone(),value(bound,v,env,reads,returned,refusals))).collect()},
    Expr::Shape{base,fields}=>{let _=value(bound,base,env,reads,returned,refusals);Flow{sources:Sources::new(),fields:fields.iter().map(|(n,v)|(n.clone(),value(bound,v,env,reads,returned,refusals))).collect()}},
    Expr::Get(r)=>{reads.insert(r.table.clone());row(bound,&r.table)},
    Expr::Scan(s)=>{reads.insert(s.table.clone());row(bound,&s.table)},
    Expr::Merge(m)=>{reads.insert(m.table().into());row(bound,m.table())},
    Expr::Array(xs)|Expr::Builtin{args:xs,..}=>{
        // ProjectFields is the engine's column gate, retaining row identity.
        if let Expr::Builtin{builtin:ir::Builtin::ProjectFields{table},..}=e{
            reads.insert(table.clone());let input=xs.first().map(|e|value(bound,e,env,reads,returned,refusals)).unwrap_or_default();return Flow::join(input,row(bound,table));
        }
        if let Expr::Builtin{builtin:ir::Builtin::OptionalField{field,..},..}=e{
            let f=value(bound,&xs[0],env,reads,returned,refusals);return f.fields.get(field).cloned().unwrap_or(Flow{sources:f.sources,fields:BTreeMap::new()});
        }
        if matches!(e,Expr::Builtin{builtin:ir::Builtin::ProjectFields{..}|ir::Builtin::RequireUncapped|ir::Builtin::First|ir::Builtin::Last|ir::Builtin::At|ir::Builtin::Sort{..},..})&&!xs.is_empty(){return value(bound,&xs[0],env,reads,returned,refusals);}
        Flow::union(xs.iter().map(|e|value(bound,e,env,reads,returned,refusals)))
    },
    Expr::Binary{left,right,..}=>{
        let a=value(bound,left,env,reads,returned,refusals);let b=value(bound,right,env,reads,returned,refusals);
        if matches!(&**left,Expr::Literal(snapback4_core::Value::Null))&&!b.fields.is_empty()||matches!(&**right,Expr::Literal(snapback4_core::Value::Null))&&!a.fields.is_empty(){Flow::default()}else{Flow::union([a,b])}
    },
    Expr::Unary{value:e,..}=>value(bound,e,env,reads,returned,refusals),
    Expr::Block{body,value:e}=>{statements(bound,body,env,reads,returned,refusals);value(bound,e,env,reads,returned,refusals)},
    _=>Flow::default(),
}}
fn statements(bound:&Bound,body:&[Stmt],env:&mut BTreeMap<String,Flow>,reads:&mut BTreeSet<String>,returned:&mut Sources,refusals:&mut Sources){for s in body{match s{
    Stmt::Const{name,value:e}|Stmt::Let{name,value:e}|Stmt::Assign{name,value:e}=>{let f=value(bound,e,env,reads,returned,refusals);env.insert(name.clone(),f);},
    Stmt::Push{target,value:e}=>{let f=value(bound,e,env,reads,returned,refusals);let old=env.remove(target).unwrap_or_default();env.insert(target.clone(),Flow::union([old,f]));},
    Stmt::Insert{table,row:Expr::Variable(n)}=>{let prior=env.remove(n).unwrap_or_default();env.insert(n.clone(),Flow::join(prior,row(bound,table)));},
    Stmt::InsertIfAbsent{table,row:payload,result}=>{
        let prior=value(bound,payload,env,reads,returned,refusals);let lineage=Flow::join(prior,row(bound,table));
        if let Expr::Variable(name)=payload{env.insert(name.clone(),lineage.clone());}
        env.insert(result.clone(),lineage);
    },
    Stmt::WriteTarget{target,result:Some(n),..}=>{reads.insert(target.table.clone());env.insert(n.clone(),row(bound,&target.table));},
    Stmt::Return(e)=>{returned.extend(value(bound,e,env,reads,&mut Sources::new(),refusals).all());},
    Stmt::Require{condition,..}|Stmt::Check{condition,..}=>{refusals.extend(value(bound,condition,env,reads,returned,&mut Sources::new()).all());},
    Stmt::If{condition,then_body,else_body}=>{
        let condition=value(bound,condition,env,reads,returned,refusals).all();
        // A private branch can choose both results and authored refusals.
        returned.extend(condition.iter().cloned());refusals.extend(condition);
        let mut other=env.clone();statements(bound,then_body,env,reads,returned,refusals);statements(bound,else_body,&mut other,reads,returned,refusals);
        for (n,f) in other{let old=env.remove(&n).unwrap_or_default();env.insert(n,Flow::join(old,f));}
    },
    Stmt::For{binding,domain,body}=>{match domain{
        ir::LoopDomain::Page(s)=>{reads.insert(s.table.clone());env.insert(binding.clone(),row(bound,&s.table));},
        ir::LoopDomain::DerivedArray{value:e,..}=>{let f=value(bound,e,env,reads,returned,refusals);env.insert(binding.clone(),f);},_=>{},
    }statements(bound,body,env,reads,returned,refusals);},_=>{},
}}}
pub(super) fn notes(bound:&Bound)->Vec<Diagnostic>{
    let flows=bound.programs.iter().map(|bp|{let(mut reads,mut returned,mut refusals)=(BTreeSet::new(),Sources::new(),Sources::new());statements(bound,&bp.program.body,&mut BTreeMap::new(),&mut reads,&mut returned,&mut refusals);(bp,reads,returned,refusals)}).collect::<Vec<_>>();
    let mut hidden:BTreeMap<(String,String),BTreeSet<String>>=BTreeMap::new();
    for (bp,reads,returned,_) in &flows{if bp.program.kind!=ir::ProgramKind::Query{continue;}
        for table in reads{if let Some(t)=bound.schema.tables.get(table){for c in t.columns.keys().filter(|c|c.as_str()!="id"){
            if !returned.contains(&(table.clone(),c.clone())){hidden.entry((table.clone(),c.clone())).or_default().insert(bp.program.name.clone());}
        }}}
    }
    let mut grouped=BTreeMap::<String,Vec<(Site,String)>>::new();
    for (bp,_,returned,refusals) in flows{
        for (kind,origins) in [("return/write result",returned),("refusal/branch",refusals)]{
            let mut groups:BTreeMap<String,Vec<String>>=BTreeMap::new();
            for (table,c) in origins{
                let t=&bound.schema.tables[&table];
                let projected=hidden.get(&(table.clone(),c.clone()));
                let ruled=t.column_reads.contains_key(&c)||t.written_by.get(&c).is_some_and(|g|!g.audience);
                if projected.is_none()&&!ruled{continue;}
                // A query's own narrowed result is not an alternate write observer.
                if bp.program.kind==ir::ProgramKind::Query&&kind=="return/write result"&&projected.is_none(){continue;}
                let reason=projected.map(|qs|format!("omitted by {}",qs.iter().cloned().collect::<Vec<_>>().join(", "))).unwrap_or_else(||"column-ruled".into());
                groups.entry(table).or_default().push(format!("{c} ({reason})"));
            }
            for (table,columns) in groups{grouped.entry(table).or_default().push((bp.site.clone(),format!("{} at {}: {kind} observes {}",bp.program.name,bp.site,columns.join(", "))));}
        }
    }
    grouped.into_iter().map(|(table,mut paths)|{
        paths.sort_by_key(|(site,_)|(site.file.clone(),site.line,site.col));
        Diagnostic::new(&paths[0].0,"N_COLUMN_RESULT_EXPOSURE",format!("{table}: {}; row audience: {}",paths.iter().map(|(_,text)|text.as_str()).collect::<Vec<_>>().join("; "),bound.schema.tables[&table].rules.read.quarry()),"confirm each operation's result/refusal audience from the spec; a query projection alone is not privacy. Use column read rules and independent intent; run snapback4 test").guide("security")
    }).collect()
}
