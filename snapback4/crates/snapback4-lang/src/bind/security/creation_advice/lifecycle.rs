//! Structural workflow review questions; each approval disposition is individual.
// @ref LLP 3000.036.004#171-presence-and-lifecycle-questions — decisions require explicit product intent.
use super::*;
pub(super) fn state(w:&Write<'_>,bound:&Bound)->bool{
    matches!(w.op,WriteOp::Update|WriteOp::Upsert)&&w.fields.iter().any(|f|matches!(bound.schema.tables[&w.table].columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Enum{..}))&&!matches!(field_value(f),Some(Expr::Member{base,name,..}) if name==&f.name&&super::super::derived::same_resource(base,&w.table,&w.keys,w.p)))
}
fn inspected(w:&Write<'_>,table:&str,column:&str)->bool{
    conditions(&w.context).iter().any(|condition|{
        let mut found=false;walk(condition,|e|if let Expr::Member{base,name,..}=e&&name==column&&reads(base).contains(table){found=true;});found
    })
}
fn creation_state_guard(w:&Write<'_>,bound:&Bound)->bool{
    conditions(&w.context).into_iter().flat_map(conjunction).any(|e|if let Expr::Binary{op,left,right,..}=e&&op=="="{
        [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].iter().any(|(a,b)|{
            if let Expr::Member{base,name,..}=a&&same_target(base,w)&&bound.schema.tables[&w.table].columns.get(name).is_some_and(|k|matches!(k.required(),ColumnType::Enum{..})&&["status","stage","state"].contains(&name.as_str())||matches!(k.required(),ColumnType::Bool)&&["approv","authoriz"].iter().any(|s|name.to_lowercase().contains(s))){
                return bound.schema.tables[&w.table].defaults.get(name).is_some_and(|d|match b{
                    Expr::Literal{value:ast::Literal::Str(v),..}=>d.value(challenges::NOW,"$advisory")==snapback4_core::Value::String(v.clone()),
                    Expr::Literal{value:ast::Literal::Bool(v),..}=>d.value(challenges::NOW,"$advisory")==snapback4_core::Value::Bool(*v),_=>false
                });
            }false
        })
    }else{false})
}
fn requires_child(w:&Write<'_>,child:&str,reference:&str)->bool{
    conditions(&w.context).into_iter().flat_map(conjunction).any(|e|if let Expr::Exists{read,..}=e&&read.table==child{
        read.keys.iter().any(|k|k.column.as_deref()==Some(reference)&&(
            w.keys.iter().any(|target|target.column.as_deref().is_none_or(|column|column=="id")&&matches!(&target.value,Expr::Name{name,..} if w.p.args.iter().any(|arg|arg.name==*name&&matches!(&arg.type_.kind,TypeKind::Ref{table} if table==&w.table)))&&crate::print::expression(&target.value)==crate::print::expression(&k.value))||matches!(&k.value,Expr::Member{base,name,..} if name=="id"&&same_target(base,w))))
    }else{false})
}
fn clock(w:&Write<'_>)->bool{
    conditions(&w.context).into_iter().flat_map(conjunction).any(|c|{
        let mut matched=false;walk(c,|e|if let Expr::Binary{op,left,right,..}=e&&["<","<=",">",">="].contains(&op.as_str()){
            for (time,row) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())]{
                if !uses(time,"now"){continue;}
                walk(row,|e|if let Expr::Member{base,..}=e&&same_target(base,w){matched=true;});
            }
        });matched
    })
}
fn media_name(name:&str)->bool{["photo","image","scan","sketch","url"].iter().any(|s|name.to_lowercase().contains(s))}
pub(super) fn recording(kind:&ColumnType,value:Option<&Expr>)->bool{match (kind.required(),value){
    (ColumnType::Bool,Some(Expr::Literal{value:ast::Literal::Bool(true),..}))=>true,
    (ColumnType::Time,Some(e))=>!matches!(e,Expr::Literal{value:ast::Literal::Null,..}|Expr::Member{..}),_=>false,
}}
fn records(w:&Write<'_>,column:&str,kind:&ColumnType,t:&snapback4_core::schema::Table)->bool{
    if let Some(field)=w.fields.iter().find(|f|f.name==column){
        if let Some(value)=field_value(field)&&matches!(kind.required(),ColumnType::Bool|ColumnType::Time){return !matches!(simplify_boolean(value),Expr::Literal{value:ast::Literal::Bool(false)|ast::Literal::Null,..})&&!super::super::derived::same_stamp_copy(value,&w.table,&w.keys,w.p,column);}
        return recording(kind,field_value(field));
    }
    matches!(w.op,WriteOp::Insert|WriteOp::Upsert)&&t.defaults.get(column).is_some_and(|d|match (kind.required(),d.value(challenges::NOW,"$advisory")){(ColumnType::Bool,snapback4_core::Value::Bool(true))=>true,(ColumnType::Time,snapback4_core::Value::Int(_))=>true,_=>false})
}
fn certain_record(w:&Write<'_>,column:&str,kind:&ColumnType,t:&snapback4_core::schema::Table)->bool{
    if let Some(field)=w.fields.iter().find(|field|field.name==column){super::super::derived::fresh_recording(kind,field_value(field))}else{records(w,column,kind,t)}
}
fn derived_decision_fact(w:&Write<'_>,column:&str,kind:&ColumnType,t:&snapback4_core::schema::Table)->bool{
    if !matches!(kind.required(),ColumnType::Bool){return false;}
    fn stored(e:&Expr,p:&ast::ProgramDecl,locator:bool)->bool{match e{
        Expr::Literal{..}=>true,Expr::Name{name,..}=>name=="now"||name=="viewer"||locator&&p.args.iter().any(|arg|arg.name==*name&&matches!(arg.type_.kind,TypeKind::Ref{..}|TypeKind::Principal)),
        Expr::Assert{value,..}=>stored(value,p,locator),Expr::Member{base,..}=>stored(base,p,true),
        Expr::Read(read)=>read.keys.iter().all(|key|stored(&key.value,p,true))&&read.filter.as_deref().is_none_or(|filter|stored(filter,p,false)),
        Expr::Unary{value,..}=>stored(value,p,false),Expr::Binary{left,right,..}=>stored(left,p,false)&&stored(right,p,false),
        Expr::If{condition,then,otherwise,..}=>stored(condition,p,false)&&stored(then,p,false)&&stored(otherwise,p,false),_=>false,
    }}
    let Some(value)=w.fields.iter().find(|field|field.name==column).and_then(field_value)else{return false;};
    !matches!(value,Expr::Literal{..}|Expr::Name{..})&&stored(value,w.p,false)&&w.fields.iter().any(|field|field.name!=column&&["approv","authoriz"].iter().any(|part|field.name.to_lowercase().contains(part))&&t.columns.get(&field.name).is_some_and(|kind|super::super::derived::fresh_recording(kind,field_value(field))))
}
fn decision_effect(t:&snapback4_core::schema::Table,column:&str,f:&ast::ObjectField)->bool{
    let name=f.name.to_lowercase();
    if f.name==column||["approv","authoriz","consent","reason","note"].iter().any(|part|name.contains(part)){return false;}
    match (t.columns.get(&f.name).map(ColumnType::required),field_value(f)){
        (Some(ColumnType::Enum{..}),Some(Expr::Literal{value:ast::Literal::Str(_),..})) if ["status","stage","state","phase","decision"].iter().any(|suffix|name.ends_with(suffix))=>true,
        (Some(ColumnType::Text{..}|ColumnType::Enum{..}|ColumnType::Bool),Some(_))=>{let column=column.to_lowercase();["approv","authoriz"].iter().filter_map(|part|column.find(part)).any(|at|at>0&&name.starts_with(&column[..at]))},
        _=>false,
    }
}
fn guarded_boolean_decision(record:&Write<'_>,field:&ast::ObjectField,bound:&Bound)->bool{
    if ["approv","authoriz"].iter().any(|part|field.name.to_lowercase().contains(part)){return false;}
    if !matches!(bound.schema.tables[&record.table].columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Bool)){return false;}
    let Some(Expr::Literal{value:ast::Literal::Bool(after),..})=field_value(field)else{return false;};
    fn project(e:&Expr,record:&Write<'_>,column:&str,value:bool)->Option<bool>{match e{
        Expr::Literal{value:ast::Literal::Bool(value),..}=>Some(*value),
        Expr::Member{base,name,..} if name==column&&super::super::derived::same_resource(base,&record.table,&record.keys,record.p)=>Some(value),
        Expr::Unary{op,value:e,..} if op=="not"=>project(e,record,column,value).map(|value|!value),
        Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>{let a=project(left,record,column,value);let b=project(right,record,column,value);let decisive=op=="or";if a==Some(decisive)||b==Some(decisive){Some(decisive)}else if a.is_some()&&b.is_some(){Some(!decisive)}else{None}},
        Expr::Binary{op,left,right,..} if op=="="||op=="!="=>Some((project(left,record,column,value)?==project(right,record,column,value)?)==(op=="=")),_=>None,
    }}
    effective_conditions(&record.context,record.catalog).iter().any(|condition|{
        let mut uses=false;walk(condition,|e|if let Expr::Member{base,name,..}=e&&name==&field.name&&super::super::derived::same_resource(base,&record.table,&record.keys,record.p){uses=true;});
        uses&&project(condition,record,&field.name,*after)==Some(false)
    })
}
fn exclusive_decision(record:&Write<'_>,field:&ast::ObjectField,writes:&[Write<'_>],_bound:&Bound)->bool{
    if matches!(field_value(field),Some(Expr::Member{base,name,..}) if name==&field.name&&super::super::derived::same_resource(base,&record.table,&record.keys,record.p)){return false;}
    let authority=audience(&record.gate);
    !writes.iter().any(|other|other.table==record.table&&matches!(other.op,WriteOp::Update|WriteOp::Upsert)&&other.site!=record.site&&other.fields.iter().find(|candidate|candidate.name==field.name).and_then(field_value).is_some_and(|value|{
        if matches!(value,Expr::Member{base,name,..} if name==&field.name&&super::super::derived::same_resource(base,&other.table,&other.keys,other.p)){return false;}
        match (value,field_value(field)){(Expr::Literal{value:a,..},Some(Expr::Literal{value:b,..}))=>format!("{a:?}")==format!("{b:?}"),_=>true}
    })&&kernel::implies(&audience(&other.gate),&authority)!=Ok(true))
}
fn scalar_rule(rule:&RuleExpr,table:&str,column:&str,root:&str,negative:bool,bound:&Bound)->bool{
    let simplified=simplify_rule(rule);let rule=&simplified;
    let matches=|term:&RuleTerm|root==table&&matches!(term,RuleTerm::Field(name)|RuleTerm::OldField(name)|RuleTerm::NextField(name) if name==column)||term.references().last().is_some_and(|(owner,field)|owner==table&&field==column);
    match rule{
        RuleExpr::Not(rule)=>scalar_rule(rule,table,column,root,!negative,bound),
        RuleExpr::And(parts)|RuleExpr::Or(parts)=>parts.iter().any(|rule|scalar_rule(rule,table,column,root,negative,bound)),
        RuleExpr::Exists{table:owner,index,key,equalities,..} if owner==table&&!negative=>{let pairs=super::super::privilege::probe_pairs(bound,owner,index,key,equalities);pairs.iter().any(|(name,value)|name==column&&*value==RuleTerm::Literal(snapback4_core::Value::Bool(true)))&&pairs.iter().any(|(name,value)|*value==RuleTerm::Viewer&&matches!(bound.schema.tables[table].columns.get(name).map(ColumnType::required),Some(ColumnType::Principal)))},
        RuleExpr::Compare(_,left,right) if !negative&&matches!(bound.schema.tables[table].columns.get(column).map(ColumnType::required),Some(ColumnType::Time))=>matches(left)||matches(right),
        RuleExpr::Eq(left,right)|RuleExpr::Ne(left,right)=>[(left,right),(right,left)].iter().any(|(field,value)|{
            if !matches(field){return false;}let equal=matches!(rule,RuleExpr::Eq(..));match value{
                RuleTerm::Literal(snapback4_core::Value::Bool(value))=>(equal==*value)!=negative,
                RuleTerm::Literal(snapback4_core::Value::Null)=>(!equal)!=negative,_=>false,
            }
        }),_=>false,
    }
}
fn schema_scalar(effect:&Write<'_>,table:&str,column:&str,bound:&Bound,negative:bool)->bool{
    if !applicability_known(&effect.context,effect.catalog){return false;}
    let target=&bound.schema.tables[&effect.table];let row=if matches!(effect.op,WriteOp::Update|WriteOp::Upsert){&target.rules.update}else{&target.rules.insert};
    if scalar_rule(&super::approval_records::scoped_rule(row,effect,table,bound),table,column,&effect.table,negative,bound){return true;}
    let fields=effect.fields.iter().filter(|field|matches!(target.columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Enum{..}))&&!matches!(field_value(field),Some(Expr::Member{base,name,..}) if name==&field.name&&super::super::derived::same_resource(base,&effect.table,&effect.keys,effect.p))).collect::<Vec<_>>();
    let covers=|field:&&ast::ObjectField|target.column_writes.get(&field.name).is_some_and(|rule|scalar_rule(&super::approval_records::scoped_rule(rule,effect,table,bound),table,column,&effect.table,negative,bound))||negative&&target.frozen_columns.get(&field.name).is_some_and(|rule|scalar_rule(&super::approval_records::scoped_rule(rule,effect,table,bound),table,column,&effect.table,false,bound));
    if negative{!fields.is_empty()&&fields.iter().all(covers)}else{fields.iter().any(covers)}
}
fn caller_approval(condition:&Expr,table:&str,column:&str,bound:&Bound)->bool{
    let Some(principal)=super::super::privilege::global_principal(bound,table)else{return false;};let mut found=false;
    for probe in super::super::derived::approval_receipts(condition){walk(&probe,|e|if let Expr::Exists{read,..}=e&&read.table==table&&read.keys.iter().any(|key|key.column.as_deref()==Some(&principal)&&matches!(&key.value,Expr::Name{name,..} if name=="viewer")){
        found|=read.keys.iter().any(|key|key.column.as_deref()==Some(column)&&matches!(&key.value,Expr::Literal{value:ast::Literal::Bool(true),..}))||read.filter.as_deref().is_some_and(|filter|super::super::derived::approval_receipts(filter).iter().any(|positive|{let mut matches=false;walk(positive,|e|if let Expr::Member{base,name,..}=e&&name==column&&matches!(base.as_ref(),Expr::Focal{..}){matches=true;});matches}));
    });}found
}
fn parent_loop_guard(effect:&Write<'_>,table:&str,column:&str,bound:&Bound)->bool{
    fn expanded(catalog:&Catalog,value:&Expr,env:&BTreeMap<String,Expr>)->Expr{super::super::authority_walk::returned(catalog,&super::super::authority_walk::resolve(value,env),0)}
    fn unresolved(value:&Expr)->bool{let mut unknown=false;walk(value,|e|match e{Expr::Name{name,..} if name.starts_with("$advice_")=>unknown=true,Expr::Call{..}|Expr::If{..}=>unknown=true,_=>{}});unknown}
    fn scan(body:&[Stmt],binder:&str,column:&str,env:&mut BTreeMap<String,Expr>,catalog:&Catalog,depth:usize,names:&CallerArguments,facts:&mut BTreeMap<String,bool>)->(bool,bool){
        if depth>=32{return (false,false);}
        let resolve=|value:&Expr,env:&BTreeMap<String,Expr>|expanded(catalog,value,env);
        for stmt in body{
            let value=match stmt{Stmt::Bind{value,..}|Stmt::Expr{value,..}|Stmt::Return{value,..}=>Some(value),Stmt::Require{condition,..}|Stmt::If{condition,..}=>Some(condition),Stmt::For{domain,..}=>Some(domain),_=>None};
            if let Some(value)=value{
                let guards=super::super::authority_walk::helper_guards(catalog,value,env,depth);
                if !guards.is_empty(){let result=scan(&guards,binder,column,&mut env.clone(),catalog,depth+1,names,facts);if result.0||!result.1{return result;}}
            }
            if matches!(stmt,Stmt::Require{code,..} if code=="$advice:cut"){return (false,false);}
            match stmt{
            Stmt::Bind{names,value,..}=>{let value=resolve(value,env);for name in names{env.insert(name.clone(),if names.len()==1{value.clone()}else{Expr::Name{name:format!("$advice_loop_unknown:{name}"),site:value.site().clone()}});}},
            Stmt::Require{condition,code,..}=>{
                let condition=apply_facts(&resolve(condition,env),facts,names);if matches!(condition,Expr::Literal{value:ast::Literal::Bool(false),..}){return (false,false);}
                // Only complete authored conjuncts establish continuation facts.
                // A salvaged OR arm is use evidence, never an assumption.
                for part in conjunction(&condition){if let Some((key,value))=predicate_fact(part,names){if facts.insert(key,value).is_some_and(|old|old!=value){return (false,false);}}}
                for condition in condition_parts(&condition,code,catalog){
                    if super::super::derived::approval_receipts(&condition).iter().any(|positive|{let mut found=false;walk(positive,|e|if let Expr::Member{base,name,..}=e&&name==column&&matches!(base.as_ref(),Expr::Name{name,..} if name==binder){found=true;});found}){return (true,true);}
                }
            },
            Stmt::Break{..}|Stmt::Continue{..}|Stmt::Return{..}=>return (false,false),
            Stmt::If{condition,then_body,else_body,site}=>{
                let condition=apply_facts(&resolve(condition,env),facts,names);
                let unknown=unresolved(&condition);
                if unknown&&(super::super::authority_walk::contains_exit(then_body)||super::super::authority_walk::contains_exit(else_body)){return (false,false);}
                let (found,continues)=match condition{
                    Expr::Literal{value:ast::Literal::Bool(value),..}=>scan(if value{then_body}else{else_body},binder,column,env,catalog,depth+1,names,facts),
                    _=>{let mut yes=env.clone();let mut yes_facts=facts.clone();let mut no=env.clone();let mut no_facts=facts.clone();
                        if let Some((key,value))=predicate_fact(&condition,names){yes_facts.insert(key.clone(),value);no_facts.insert(key,!value);}
                        let a=scan(then_body,binder,column,&mut yes,catalog,depth+1,names,&mut yes_facts);let b=scan(else_body,binder,column,&mut no,catalog,depth+1,names,&mut no_facts);
                        if !a.1{*env=no;*facts=no_facts;}else if !b.1{*env=yes;*facts=yes_facts;}else{*facts=yes_facts.into_iter().filter(|(key,value)|no_facts.get(key)==Some(value)).collect();for name in yes.keys().chain(no.keys()).cloned().collect::<BTreeSet<_>>(){let value=match (yes.get(&name),no.get(&name)){(Some(a),Some(b)) if crate::print::expression(a)==crate::print::expression(b)=>a.clone(),_=>Expr::Name{name:format!("$advice_loop_unknown:{name}"),site:site.clone()}};env.insert(name,value);}}(a.0||b.0,a.1||b.1)},
                };if found&&!unknown{return (true,continues);}if !continues{return (false,false);}
            },
            Stmt::For{domain,body,site,..}=>{
                if !matches!(resolve(domain,env),Expr::Array{items,..} if items.is_empty()){
                    if super::super::authority_walk::contains_return(body){return (false,false);}
                    for name in super::super::authority_walk::branch_assignments(body){env.insert(name.clone(),Expr::Name{name:format!("$advice_loop_unknown:{name}"),site:site.clone()});}
                }
            },
            Stmt::As{body,..}=>{let result=scan(body,binder,column,&mut env.clone(),catalog,depth+1,names,&mut facts.clone());if result.0||!result.1{return result;}},_=>{},
        }}(false,true)
    }
    fn contains(stmt:&Stmt,site:&Site)->bool{let mut found=false;let mut body=vec![stmt.clone()];super::super::super::intent_walk::statements(&mut body,&mut |e|if e.site()==site{found=true;});found}
    fn prefix<'a>(body:&'a[Stmt],site:&Site,before:&mut Vec<&'a Stmt>)->bool{
        for stmt in body{if contains(stmt,site){return match stmt{
            Stmt::If{then_body,else_body,..}=>{let mut candidate=before.clone();if prefix(then_body,site,&mut candidate){*before=candidate;true}else{prefix(else_body,site,before)}},
            Stmt::For{body,..}|Stmt::As{body,..}=>prefix(body,site,before),_=>true,
        };}before.push(stmt);}false
    }
    let mut before=Vec::new();
    if !prefix(&effect.p.body,&effect.site,&mut before){
        let owner=effect.context.body.iter().filter_map(|stmt|if let Stmt::Require{code,site,..}=stmt&&code=="$callsite"{Some(site)}else{None}).find_map(|site|{let mut candidate=Vec::new();prefix(&effect.p.body,site,&mut candidate).then_some(candidate)});
        let Some(owner)=owner else{return false;};before=owner;
    }
    if effect.table==table||!bound.schema.tables[table].columns.values().any(|kind|matches!(kind.required(),ColumnType::Ref{table} if table==&effect.table)){return false;}
    let Some(mut facts)=context_facts(&effect.context,effect.catalog)else{return false;};let names=caller_names(effect.p);
    let domain_matches=|read:&ast::ReadExpr|{
        if read.table!=table||read.filter.as_deref().is_some_and(|filter|matches!(simplify_boolean(filter),Expr::Literal{value:ast::Literal::Bool(false),..})){return false;}
        let references=bound.schema.tables[table].columns.iter().filter(|(_,kind)|matches!(kind.required(),ColumnType::Ref{table} if table==&effect.table)).map(|(name,_)|name.clone()).collect::<BTreeSet<_>>();
        let selected=super::approval_records::pins(read,effect.p,bound).into_iter().filter(|(column,_)|references.contains(column)).collect::<Vec<_>>();
        if !selected.is_empty(){return selected.iter().any(|(column,_)|selected.iter().filter(|(candidate,_)|candidate==column).all(|(_,value)|super::approval_records::origin(value,effect.p,bound).is_some_and(|origin|super::approval_records::origin(&Expr::Read(ast::ReadExpr{cursor_prefix:None,computed:Default::default(),order_keys:Vec::new(),table:effect.table.clone(),keys:effect.keys.clone(),index:None,range:None,matching:None,filter:None,seeks:Vec::new(),site:effect.site.clone()}),effect.p,bound)==Some(origin.clone()))));}
        let mut unresolved_selection=!read.keys.is_empty();if let Some(filter)=&read.filter{walk(filter,|e|if matches!(e,Expr::Member{base,name,..} if matches!(base.as_ref(),Expr::Focal{..})&&references.contains(name)){unresolved_selection=true;});}!unresolved_selection
    };
    let mut env=BTreeMap::new();
    for stmt in before{match stmt{
        Stmt::Bind{names,value,..}=>{let value=expanded(effect.catalog,value,&env);for name in names{env.insert(name.clone(),if names.len()==1{value.clone()}else{Expr::Name{name:format!("$advice_loop_unknown:{name}"),site:value.site().clone()}});}},
        Stmt::For{domain,name,body,..}=>{if let Expr::Read(read)=expanded(effect.catalog,domain,&env)&&domain_matches(&read){let mut local=env.clone();local.remove(name);if scan(body,name,column,&mut local,effect.catalog,0,&names,&mut facts.clone()).0{return true;}}for name in super::super::authority_walk::branch_assignments(body){env.insert(name.clone(),Expr::Name{name:format!("$advice_loop_unknown:{name}"),site:domain.site().clone()});}},
        Stmt::If{condition,then_body,else_body,site}=>{
            let condition=apply_facts(&expanded(effect.catalog,condition,&env),&facts,&names);
            if let Expr::Literal{value:ast::Literal::Bool(value),..}=condition{let _=scan(if value{then_body}else{else_body},"","",&mut env,effect.catalog,0,&names,&mut facts);}else{for name in super::super::authority_walk::branch_assignments(then_body).into_iter().chain(super::super::authority_walk::branch_assignments(else_body)){env.insert(name.clone(),Expr::Name{name:format!("$advice_loop_unknown:{name}"),site:site.clone()});}}
        },_=>{},
    }}false
}
fn locked_approval_input(record:&Write<'_>,column:&str,writes:&[Write<'_>],bound:&Bound)->bool{
    let table=&record.table;
    bound.schema.tables[table].columns.keys().filter(|input|*input!=column&&!["status","stage","state","phase"].contains(&input.as_str())).any(|input|{
        if !scalar_enforced(record,table,input,bound,false){return false;}
        let edits=writes.iter().filter(|write|write.table==*table&&matches!(write.op,WriteOp::Update|WriteOp::Upsert)&&!std::ptr::eq(write.p,record.p)&&write.fields.iter().any(|field|field.name==*input)).collect::<Vec<_>>();
        !edits.is_empty()&&edits.iter().all(|write|applicability_known(&write.context,write.catalog)&&(scalar_enforced(write,table,column,bound,true)||schema_scalar(write,table,column,bound,true)||bound.schema.tables[table].frozen_columns.get(input).is_some_and(|rule|scalar_rule(&super::approval_records::scoped_rule(rule,write,table,bound),table,column,table,false,bound))||bound.schema.tables[table].column_writes.get(input).is_some_and(|rule|scalar_rule(&super::approval_records::scoped_rule(rule,write,table,bound),table,column,table,true,bound))))
    })
}
fn one_shot_decision(record:&Write<'_>,column:&str,writes:&[Write<'_>],bound:&Bound)->bool{
    writes.iter().any(|effect|super::approval_records::coexec(record,effect)&&effect.table!=record.table&&matches!(effect.op,WriteOp::Insert|WriteOp::Upsert)&&scalar_enforced(effect,&record.table,column,bound,true))
}
fn row_type<'a>(value:&Expr,p:&ast::ProgramDecl,bound:&'a Bound)->Option<String>{match value{
    Expr::Name{name,..}=>p.args.iter().find_map(|arg|if arg.name==*name&&let TypeKind::Ref{table}=&arg.type_.kind{Some(table.clone())}else{None}),
    Expr::Read(read)=>Some(read.table.clone()),Expr::Assert{value,..}=>row_type(value,p,bound),
    Expr::Member{base,name,..}=>{let table=row_type(base,p,bound)?;if name=="id"{Some(table)}else{match bound.schema.tables[&table].columns.get(name)?.required(){ColumnType::Ref{table}=>Some(table.clone()),_=>None}}},_=>None,
}}
fn resource_key(value:&Expr,p:&ast::ProgramDecl,bound:&Bound)->String{
    let mut value=value.clone();super::super::super::intent_walk::expression(&mut value,&mut |e|{
        if let Expr::Assert{value,..}=e{*e=*value.clone();}
        if let Expr::Member{base,name,..}=e&&name=="id"&&let Expr::Read(read)=base.as_ref()&&read.keys.len()==1&&read.filter.is_none()&&read.range.is_none()&&read.computed.is_empty()&&read.seeks.is_empty()&&read.matching.is_none()&&(read.keys[0].column.as_deref()==Some("id")||read.keys[0].column.is_none()&&row_type(&read.keys[0].value,p,bound).as_deref()==Some(&read.table)){*e=read.keys[0].value.clone();}
    });crate::print::expression(&value)
}
fn linked_decision_stamp(record:&Write<'_>,column:&str,writes:&[Write<'_>],bound:&Bound)->bool{
    if record.keys.len()!=1{return false;}
    let selected=resource_key(&record.keys[0].value,record.p,bound);
    writes.iter().filter(|other|super::approval_records::coexec(other,record)&&other.table!=record.table&&other.op==WriteOp::Update&&other.keys.len()==1).any(|other|{
        let read=Expr::Read(ast::ReadExpr{cursor_prefix:None,computed:Default::default(),order_keys:Vec::new(),table:other.table.clone(),keys:other.keys.clone(),index:None,range:None,matching:None,filter:None,seeks:Vec::new(),site:other.site.clone()});
        let linked=bound.schema.tables[&other.table].columns.iter().any(|(reference,kind)|matches!(kind.required(),ColumnType::Ref{table} if table==&record.table)&&resource_key(&Expr::Member{base:Box::new(read.clone()),name:reference.clone(),site:other.site.clone()},other.p,bound)==selected);
        linked&&other.fields.iter().any(|field|["approv","authoriz"].iter().any(|part|field.name.to_lowercase().contains(part))&&matches!(field_value(field),Some(Expr::Literal{value:ast::Literal::Bool(true),..}))&&writes.iter().any(|effect|scalar_enforced(effect,&other.table,&field.name,bound,false)))&&column.to_lowercase().contains("at")
    })
}
// Only a guard on the resource whose lifecycle is affected can consume its
// approval. Read audiences and another resource's validation are not enforcement.
pub(super) fn scalar_enforced(effect:&Write<'_>,table:&str,column:&str,bound:&Bound,negative:bool)->bool{
    let targets=super::approval_records::parent_values(effect,table,bound).into_iter().filter_map(|value|super::approval_records::origin(&value,effect.p,bound)).collect::<Vec<_>>();
    let conditions=effective_conditions(&effect.context,effect.catalog);if conditions.iter().any(|condition|matches!(condition,Expr::Literal{value:ast::Literal::Bool(false),..})){return false;}
    conditions.iter().any(|condition|{
        if !negative&&caller_approval(condition,table,column,bound){return true;}
        let condition=if negative{Expr::Unary{op:"not".into(),value:Box::new((*condition).clone()),site:condition.site().clone()}}else{(*condition).clone()};
        let mut found=false;let approval=matches!(bound.schema.tables[table].columns.get(column).map(ColumnType::required),Some(ColumnType::Bool|ColumnType::Time))&&["approv","authoriz"].iter().any(|part|column.to_lowercase().contains(part));let mut probes=if approval{super::super::derived::approval_receipts(&condition)}else{vec![condition.clone()]};
        if !negative&&matches!(bound.schema.tables[table].columns.get(column).map(ColumnType::required),Some(ColumnType::Time)){walk(&condition,|e|if matches!(e,Expr::Binary{op,..} if ["<","<=",">",">="].contains(&op.as_str())){probes.push(e.clone());});}for probe in probes{walk(&probe,|e|if let Expr::Member{base,name,..}=e&&name==column{
            found|=effect.table==table&&super::super::derived::same_resource(base,table,&effect.keys,effect.p)||super::approval_records::origin(base,effect.p,bound).is_some_and(|origin|targets.contains(&origin));
        });}found
    })
}
fn fresh_parent_child(w:&Write<'_>,parent:&str,bound:&Bound)->bool{
    w.fields.iter().filter(|f|matches!(bound.schema.tables[&w.table].columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Ref{table}) if table==parent)).filter_map(field_value).any(|value|{let mut fresh=false;walk(value,|e|if matches!(e,Expr::Write{op:WriteOp::Insert,table,..} if table==parent){fresh=true;});fresh})
}
pub(super) fn notes(bound:&Bound,writes:&[Write<'_>],out:&mut Vec<Diagnostic>){
    for (table,t) in bound.schema.visible_tables(){
        let transitions=writes.iter().filter(|w|w.table==*table&&state(w,bound)).collect::<Vec<_>>();
        let approval_effects=transitions.iter().copied().chain(writes.iter().filter(|w|w.table!=*table&&(matches!(w.op,WriteOp::Insert|WriteOp::Upsert)||state(w,bound))&&bound.schema.tables[&w.table].columns.values().any(|kind|matches!(kind.required(),ColumnType::Ref{table:parent} if parent==table))&&!fresh_parent_child(w,table,bound))).collect::<Vec<_>>();
        if approval_effects.is_empty(){continue;}
        for (column,kind) in &t.columns {
            let approval=["approv","authoriz"].iter().any(|part|column.to_lowercase().contains(part));
            let recorded=writes.iter().any(|w|w.table==*table&&records(w,column,kind,t));
            let proxies=writes.iter().filter(|w|w.table==*table&&w.fields.iter().any(|f|f.name==*column)).flat_map(|w|w.fields.iter()).filter(|f|f.name!=*column&&matches!(t.columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Enum{..}|ColumnType::Bool|ColumnType::Principal|ColumnType::Time))).filter(|f|!matches!(field_value(f),Some(Expr::Member{..}))).map(|f|f.name.clone()).collect::<BTreeSet<_>>();
            let atomic=writes.iter().any(|w|applicability_known(&w.context,w.catalog)&&w.table==*table&&(certain_record(w,column,kind,t)||derived_decision_fact(w,column,kind,t))&&(matches!(w.op,WriteOp::Insert|WriteOp::Upsert)&&t.defaults.iter().any(|(name,d)|["status","stage","state","phase","decision","approval"].iter().any(|suffix|name.to_lowercase().ends_with(suffix))&&matches!(t.columns.get(name).map(ColumnType::required),Some(ColumnType::Enum{..}))&&matches!(d.value(challenges::NOW,"$advisory"),snapback4_core::Value::String(value) if ["approved","authorized","authorised"].contains(&value.to_lowercase().as_str())))||w.fields.iter().any(|f|f.name!=*column&&(decision_effect(t,column,f)||guarded_boolean_decision(w,f,bound))&&exclusive_decision(w,f,writes,bound)&&(!matches!(w.op,WriteOp::Insert|WriteOp::Upsert)||!t.defaults.get(&f.name).is_some_and(|d|matches!(field_value(f),Some(Expr::Literal{value:ast::Literal::Str(value),..}) if d.value(challenges::NOW,"$advisory")==snapback4_core::Value::String(value.clone())))))));
            let others=approval_effects.iter().filter(|w|!(w.table==*table&&records(w,column,kind,t))).collect::<Vec<_>>();
            let frozen=!others.is_empty()&&others.iter().all(|w|scalar_enforced(w,table,column,bound,true)||schema_scalar(w,table,column,bound,true));
            let data_use=writes.iter().filter(|record|record.table==*table&&records(record,column,kind,t)).any(|record|locked_approval_input(record,column,writes,bound)||one_shot_decision(record,column,writes,bound)||linked_decision_stamp(record,column,writes,bound));
            let consumed=atomic||data_use||frozen||writes.iter().any(|effect|schema_scalar(effect,table,column,bound,false))||writes.iter().filter(|effect|state(effect,bound)).any(|effect|parent_loop_guard(effect,table,column,bound))||approval_effects.iter().filter(|w|!(w.table==*table&&records(w,column,kind,t))).any(|w|scalar_enforced(w,table,column,bound,false)||schema_scalar(w,table,column,bound,false)||proxies.iter().any(|proxy|scalar_enforced(w,table,proxy,bound,false)));
            let downstream=approval_effects.iter().filter(|effect|effect.table==*table||!writes.iter().any(|writer|writer.table==*table&&records(writer,column,kind,t)&&bound.schema.tables[&effect.table].columns.iter().any(|(reference,kind)|matches!(kind.required(),ColumnType::Ref{table:parent} if parent==table)&&requires_child(writer,&effect.table,reference)))).collect::<Vec<_>>();
            if approval&&recorded&&!consumed&&!downstream.is_empty() {
                note(out,&downstream[0].site,"N_APPROVAL_NOT_ENFORCED",format!("{table}.{column}: approval is recorded but no lifecycle effect inspects it; is this an informational record or a required approval?"),"require this approval before its governed effect; or record `check --ack-security ID --reason 'informational approval record: <spec rationale>'` for this individual decision");
            }
        }
        // A separately attached child's required field cannot require the child.
        for (child,c) in bound.schema.visible_tables(){for (reference,kind) in &c.columns{
            if !matches!(kind.required(),ColumnType::Ref{table:p} if p==table){continue;}
            let evidence=c.columns.iter().filter(|(name,k)|k.contains_asset()||media_name(name)&&matches!(k.required(),ColumnType::Text{..})).map(|(n,_)|n.clone()).collect::<Vec<_>>();
            if evidence.is_empty()||!writes.iter().any(|w|w.table==*child&&matches!(w.op,WriteOp::Insert|WriteOp::Upsert)){continue;}
            let unchecked=transitions.iter().filter(|w|!requires_child(w,child,reference)).collect::<Vec<_>>();
            if unchecked.is_empty(){continue;}
            note(out,&unchecked[0].site,"N_CHILD_EVIDENCE_PRESENCE",format!("{table}: transitions {} do not require attached {child}[{reference} = parent].{}; must a photo/file child exist before advancing? Text photo/URL fields are a name-based evidence question.",unchecked.iter().map(|w|w.name.clone()).collect::<BTreeSet<_>>().into_iter().collect::<Vec<_>>().join(", "),evidence.join(",")),&format!("if the spec requires evidence, declare independent parent integrity intent such as `invariant {table} always exists {child}[{reference} = .id]` (add the spec's draft-state exceptions); require the matching child at the governed boundary"));
        }}
    }
    super::approval_records::notes(bound,writes,out);
    for w in writes.iter().filter(|w|matches!(w.op,WriteOp::Insert|WriteOp::Update|WriteOp::Upsert)){
        let t=&bound.schema.tables[&w.table];
        for f in &w.fields{
            let Some(kind)=t.columns.get(&f.name)else{continue;};
            // Decisions inspecting this exact payload (including an approval
            // flag stored beside it) make later unrestricted edits reviewable.
            let approval_columns=t.columns.keys().filter(|c|["approv","authoriz"].iter().any(|s|c.to_lowercase().contains(s))).collect::<Vec<_>>();
            let protected=kind.contains_asset()&&(!approval_columns.is_empty()||t.columns.keys().any(|c|c=="stage"))
                ||writes.iter().any(|other|other.name!=w.name&&approves(other,bound)&&inspected(other,&w.table,&f.name));
            let state_guard=creation_state_guard(w,bound);
            if protected&&!state_guard{
                note(out,&w.site,"N_EDIT_AFTER_APPROVAL",format!("{}: {}.{} can change without a lifecycle/approval condition; should approved evidence or checked values remain editable?",w.name,w.table,f.name),&format!("declare column update intent for approved states or authorized reapproval; to freeze this value use `immutable {} when {}`; enforce replacement as well as removal, then test approve -> edit",f.name,approval_columns.iter().find_map(|c|match t.columns[*c].required(){ColumnType::Bool=>Some(format!(".{c} = true")),ColumnType::Time=>Some(format!(".{c} != null")),_=>None}).unwrap_or_else(||"<approved-state-policy>".into())));
            }
        }
        if state(w,bound)&&!clock(w)&&w.fields.iter().any(|f|matches!(field_value(f),Some(Expr::Literal{value:ast::Literal::Str(v),..}) if ["missed","overdue","expired"].contains(&v.as_str()))){
            note(out,&w.site,"N_TIME_TRANSITION",format!("{}: writes a missed/overdue/expired state without comparing server now; is the deadline actually past? (name-based question)",w.name),"require the specification's deadline against server now before changing the state; test immediately before and after it");
        }
        if state(w,bound)||matches!(w.op,WriteOp::Insert|WriteOp::Upsert){
            let mut guarded=std::collections::BTreeSet::new();
            for condition in conditions(&w.context){walk(condition,|e|if let Expr::Member{base,name,..}=e{
                for dep in reads(base){if bound.schema.tables.get(&dep).and_then(|t|t.columns.get(name)).is_some_and(|k|matches!(k.required(),ColumnType::Bool|ColumnType::Enum{..}))&&(!same_target(base,w)||dep!=w.table){guarded.insert((dep,name.clone()));}}
            });}
            for (dep,column) in guarded{if !writes.iter().any(|other|std::ptr::eq(other.p,w.p)&&other.table==dep&&other.fields.iter().any(|f|f.name==column)){
                note(out,&w.site,"N_GUARD_NOT_CONSUMED",format!("{}: checks {dep}.{column} but leaves it unchanged while changing {} state; could repeating this transition reuse that guard?",w.name,w.table),"if this state represents one-use consent/payment, consume it atomically or enforce the target source state; declare intent and test repeated transitions");
            }}
        }
        if state(w,bound){for (column,kind) in &t.columns{
            if matches!(kind.required(),ColumnType::Bool)&&inspected(w,&w.table,column)&&!w.fields.iter().any(|f|f.name==*column){
                note(out,&w.site,"N_GUARD_NOT_CONSUMED",format!("{}: checks {}.{column} but leaves it unchanged while changing state; could repeating this transition reuse the same authorization?",w.name,w.table),"if the guard represents one-use consent/payment, consume it atomically or require the source lifecycle state; declare intent and test repeated transitions");
            }
        }}
    }
    for w in writes{for f in &w.fields{let Some(value)=field_value(f)else{continue;};
        if matches!(bound.schema.tables[&w.table].columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Time)){walk(value,|e|if let Some(milliseconds)=duration_number(e)&&milliseconds>=365*86_400_000&&milliseconds%(365*86_400_000)==0{
            let days=milliseconds/86_400_000;
            note(out,&w.site,"N_CALENDAR_DURATION",format!("{}: {}.{} uses {days}d; does the spec mean fixed days or a calendar anniversary? Leap years differ. (duration question)",w.name,w.table,f.name),"decide fixed-duration versus calendar-anniversary intent; compute an explicit calendar deadline outside Quarry when needed, validate its bounds and test a leap-year interval");
        });}
        if matches!(bound.schema.tables[&w.table].columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Time))&&conditions(&w.context).iter().any(|c|uses(c,"now")&&w.p.args.iter().any(|a|uses(value,&a.name)&&uses(c,&a.name))){
            let dependencies=bound.schema.tables[&w.table].columns.values().filter_map(|k|if let ColumnType::Ref{table}=k.required(){Some(table)}else{None}).collect::<BTreeSet<_>>();
            for dep in dependencies{let deadlines=bound.schema.tables[dep].columns.iter().filter(|(name,k)|matches!(k.required(),ColumnType::Time)&&["due","deadline","until","expire"].iter().any(|s|name.to_lowercase().contains(s))).map(|(name,_)|name.clone()).collect::<Vec<_>>();
                if !deadlines.is_empty()&&!deadlines.iter().any(|c|inspected(w,dep,c)){
                    note(out,&w.site,"N_DEPENDENT_WINDOW",format!("{}: bounds {}.{} against now but does not compare dependent {dep}.{}; which deadline is the specification's window base? (name-based question)",w.name,w.table,f.name,deadlines.join(",")),"compare the actual written deadline with the dependent resource's bound as well as server now; declare independent window intent and test the boundary");
                }
            }
        }
    }}
}

pub(super) fn audience(rule:&RuleExpr)->RuleExpr{match rule{
    RuleExpr::And(parts)=>RuleExpr::And(parts.iter().map(audience).collect()),
    RuleExpr::Or(parts)=>RuleExpr::Or(parts.iter().map(audience).collect()),
    r if super::super::operation::safe(r)=>r.clone(),_=>RuleExpr::Allow,
}}