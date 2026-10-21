//! Caller-clock advice follows argument flow to fields used by clock guards.
// @ref LLP 3000.036.004#123-actionable-authority-advice — advice never changes admission or proof status.
use super::*;
use ast::{Expr,Stmt,ProgramKind};
fn walk(expr:&Expr,mut f:impl FnMut(&mut Expr)){let mut expr=expr.clone();super::super::intent_walk::expression(&mut expr,&mut f);}
fn has_now(expr:&Expr)->bool{let mut found=false;walk(expr,|e|if matches!(e,Expr::Name{name,..} if name=="now"){found=true;});found}
fn row_table(expr:&Expr)->Option<&str>{match expr{Expr::Assert{value,..}=>row_table(value),Expr::Read(r)=>Some(&r.table),_=>None}}
fn resolve(expr:&Expr,env:&BTreeMap<String,Expr>)->Expr{let mut e=expr.clone();super::super::intent_walk::expression(&mut e,&mut |e|if let Expr::Name{name,..}=e&&let Some(v)=env.get(name){*e=v.clone();});e}
fn deadlines(body:&[Stmt],env:&mut BTreeMap<String,Expr>,out:&mut BTreeSet<(String,String)>){
    fn inspect(expr:&Expr,out:&mut BTreeSet<(String,String)>){walk(expr,|e|{
        // A query's .field is scoped to its read table, not a named row alias.
        // Nested read filters receive their own context through this same walk.
        if let Expr::Read(read)|Expr::Exists{read,..}|Expr::Created{read,..}=e&&let Some(filter)=&read.filter{
            let mut filter=*filter.clone();let mut row=read.clone();row.filter=None;
            super::super::intent_walk::expression(&mut filter,&mut |e|match e{
                Expr::Read(r)|Expr::Exists{read:r,..}|Expr::Created{read:r,..}=>r.filter=None,
                Expr::Member{base,..} if matches!(base.as_ref(),Expr::Focal{..})=>*base=Box::new(Expr::Read(row.clone())),_=>{}
            });
            inspect(&filter,out);
        }
        if let Expr::Binary{op,left,right,..}=e&&matches!(op.as_str(),"<"|">"|"<="|">=")&&(has_now(left)||has_now(right)){
            for side in [left,right]{walk(side,|e|if let Expr::Member{base,name,..}=e&&let Some(table)=row_table(base){out.insert((table.into(),name.clone()));});}
        }
    });}
    for s in body{match s{
        Stmt::Bind{names,value,..}=>{let v=resolve(value,env);inspect(&v,out);if names.len()==1{env.insert(names[0].clone(),v);}},
        Stmt::Require{condition,..}|Stmt::Expr{value:condition,..}|Stmt::Return{value:condition,..}=>inspect(&resolve(condition,env),out),
        Stmt::If{condition,then_body,else_body,..}=>{inspect(&resolve(condition,env),out);deadlines(then_body,&mut env.clone(),out);deadlines(else_body,&mut env.clone(),out);},
        Stmt::For{name,domain,body,..}=>{inspect(&resolve(domain,env),out);let mut local=env.clone();if let Expr::Read(r)=domain{local.insert(name.clone(),Expr::Read(r.clone()));}deadlines(body,&mut local,out);},
        Stmt::As{body,..}=>deadlines(body,&mut env.clone(),out),_=>{}
    }}
}
fn contains_arg(expr:&Expr,arg:&str)->bool{let mut found=false;walk(expr,|e|if matches!(e,Expr::Name{name,..} if name==arg){found=true;});found}
// Only a direct clock/argument plus fixed literal offsets is a bound. General
// arithmetic can erase or invert the argument and supplies no such evidence.
fn affine(expr:&Expr,name:&str)->bool{match expr{
    Expr::Name{name:n,..}=>n==name,
    Expr::Binary{op,left,right,..} if op=="+"||op=="-"=>affine(left,name)&&matches!(right.as_ref(),Expr::Literal{value:ast::Literal::Number(_),..})||op=="+"&&affine(right,name)&&matches!(left.as_ref(),Expr::Literal{value:ast::Literal::Number(_),..}),_=>false,
}}
fn argument_affine(expr:&Expr,arg:&str)->bool{
    if affine(expr,arg){return true;}
    match expr{
        Expr::Binary{op,left,right,..} if op=="??"=>argument_affine(left,arg)&&affine(right,"now"),
        Expr::Binary{op,left,right,..} if op=="+"||op=="-"=>argument_affine(left,arg)&&matches!(right.as_ref(),Expr::Literal{value:ast::Literal::Number(_),..})||op=="+"&&argument_affine(right,arg)&&matches!(left.as_ref(),Expr::Literal{value:ast::Literal::Number(_),..}),_=>false,
    }
}
// Both disjuncts must bound the caller's clock. A guard in a sibling branch,
// after the write, or an `arg != null` test is not a server-clock bound.
fn bounds(expr:&Expr,arg:&str)->u8{match expr{
    Expr::Unary{op,value,..} if op=="not"=>if matches!(value.as_ref(),Expr::Binary{op,..} if matches!(op.as_str(),"<"|">"|"<="|">=")){let b=bounds(value,arg);((b&1)<<1)|((b&2)>>1)}else{0},
    Expr::Binary{op,left,right,..} if op=="and"=>bounds(left,arg)|bounds(right,arg),
    Expr::Binary{op,left,right,..} if op=="or"=>bounds(left,arg)&bounds(right,arg),
    Expr::Binary{op,left,right,..} if matches!(op.as_str(),"<"|">"|"<="|">="|"=")=>{
        if op=="="&&((matches!(left.as_ref(),Expr::Name{name,..} if name==arg)&&matches!(right.as_ref(),Expr::Literal{value:ast::Literal::Null,..}))||(matches!(right.as_ref(),Expr::Name{name,..} if name==arg)&&matches!(left.as_ref(),Expr::Literal{value:ast::Literal::Null,..}))){return 3;}
        let forward=argument_affine(left,arg)&&affine(right,"now");
        let reverse=argument_affine(right,arg)&&affine(left,"now");
        if !forward&&!reverse{0}else if op=="="{3}else if (op=="<"||op=="<=")==forward{2}else{1}
    },_=>0,
}}
// Propagate only finite affine directional bounds anchored at builtin now.
// A cycle of caller arguments cannot manufacture a server-clock anchor.
fn bounded_arguments(context:&ast::ProgramDecl,args:&[&str])->BTreeSet<String>{
    type Edge=(String,String,u8);
    fn variable(expr:&Expr,args:&[&str])->Option<String>{
        if affine(expr,"now"){return Some("now".into());}
        args.iter().find(|a|argument_affine(expr,a)).map(|a|a.to_string())
    }
    fn edges(expr:&Expr,args:&[&str])->BTreeSet<Edge>{match expr{
        Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>{let a=edges(left,args);let b=edges(right,args);if op=="and"{a.union(&b).cloned().collect()}else{a.intersection(&b).cloned().collect()}},
        Expr::Binary{op,left,right,..} if matches!(op.as_str(),"<"|"<="|">"|">="|"=")=>{
            let (Some(a),Some(b))=(variable(left,args),variable(right,args))else{return BTreeSet::new();};
            let direction=if op=="="{3}else if op=="<"||op=="<="{2}else{1};
            BTreeSet::from([(a.clone(),b.clone(),direction),(b,a,((direction&1)<<1)|((direction&2)>>1))])
        },_=>BTreeSet::new(),
    }}
    let guards=context.body.iter().filter_map(|s|if let Stmt::Require{condition,..}=s{Some(condition)}else{None}).collect::<Vec<_>>();
    let mut known=args.iter().map(|a|(a.to_string(),guards.iter().fold(0,|b,c|b|bounds(c,a)))).collect::<BTreeMap<_,_>>();known.insert("now".into(),3);
    let links=guards.iter().flat_map(|g|edges(g,args)).collect::<BTreeSet<_>>();
    loop{let mut changed=false;for (a,b,direction) in &links{
        let inherited=known.get(b).copied().unwrap_or(0)&direction;
        let entry=known.entry(a.clone()).or_default();let next=*entry|inherited;if next!=*entry{*entry=next;changed=true;}
    }if !changed{break;}}
    known.into_iter().filter(|(_,mask)|*mask!=0).map(|(name,_)|name).collect()
}
pub(super) fn notes(documents:&[ast::Document],catalog:&Catalog,bound:&Bound)->Vec<Diagnostic>{
    let mut fields=BTreeSet::new();
    for (name,t) in bound.schema.visible_tables(){for field in t.expire.iter().chain(t.not_before.iter()){fields.insert((name.clone(),field.clone()));}}
    for doc in documents{for p in &doc.programs{
        let mut p=p.clone();
        if p.kind==ProgramKind::Job{super::super::intent_walk::statements(&mut p.body,&mut |e|if let Expr::Name{name,..}=e&&matches!(name.as_str(),"periodEnd"|"periodStart"){*name="now".into();});}
        let mut env=BTreeMap::new();deadlines(&p.prelude,&mut env,&mut fields);deadlines(&p.body,&mut env,&mut fields);
    }}
    for doc in documents{for f in &doc.functions{
        let mut env=BTreeMap::new();
        match &f.body{
            ast::FunctionBody::Block(body)=>deadlines(body,&mut env,&mut fields),
            ast::FunctionBody::Expression(value)=>deadlines(&[Stmt::Return{value:value.clone(),site:f.site.clone()}],&mut env,&mut fields),
        }
    }}
    let mut out=Vec::new();
    for doc in documents{for p in &doc.programs{if p.kind!=ProgramKind::Mutation{continue;}
        let times=p.args.iter().filter(|a|matches!(a.type_.kind,ast::TypeKind::Time)).map(|a|a.name.as_str()).collect::<Vec<_>>();if times.is_empty(){continue;}
        let mut seen=BTreeSet::new();
        for (write,context) in super::authority_walk::writes(catalog,p){let Expr::Write{table,fields:written,site,..}=write else{continue;};
            let requirements=catalog.tables.get(&table).map(|info|super::operation::requirements(catalog,info,&context)).unwrap_or_default();
            if requirements.iter().any(|r|!r.disjuncts().is_empty()&&r.disjuncts().iter().all(|b|b.service_grant().is_some())){continue;}
            let bounded=bounded_arguments(&context,&times);
            for field in written{if !fields.contains(&(table.clone(),field.name.clone()))||!matches!(bound.schema.table(&table).and_then(|t|t.columns.get(&field.name)).map(|t|t.required()),Some(snapback4_core::schema::ColumnType::Time)){continue;}
                let value=field.value.unwrap_or(Expr::Name{name:field.name.clone(),site:field.site});
                for arg in &times{if !contains_arg(&value,arg)||bounded.contains(*arg)||!seen.insert((table.clone(),field.name.clone(),arg.to_string())){continue;}
                    out.push(Diagnostic::new(&site,"N_CALLER_TIME",format!("{}: caller time {arg} flows into {table}.{}, which controls a server-clock deadline, without a dominating bound against now",p.name,field.name),"derive this deadline from server now, or validate the supplied time against now and the permitted window before writing it").guide("security"));
                }
            }
        }
    }}out
}
