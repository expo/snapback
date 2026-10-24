//! Structural workflow questions; no inferred specification and no new gates.
// @ref LLP 3000.036.004#171-presence-and-lifecycle-questions — decisions require explicit product intent.
use super::*;
fn state(w:&Write<'_>,bound:&Bound)->bool{
    w.op==WriteOp::Update&&w.fields.iter().any(|f|matches!(bound.schema.tables[&w.table].columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Enum{..})))
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
            w.keys.iter().any(|target|crate::print::expression(&target.value)==crate::print::expression(&k.value))||matches!(&k.value,Expr::Member{base,name,..} if name=="id"&&same_target(base,w))))
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
pub(super) fn notes(bound:&Bound,writes:&[Write<'_>],out:&mut Vec<Diagnostic>){
    for (table,t) in bound.schema.visible_tables(){
        let transitions=writes.iter().filter(|w|w.table==*table&&state(w,bound)).collect::<Vec<_>>();
        if transitions.is_empty(){continue;}
        for (column,kind) in &t.columns {
            let approval=["approv","authoriz"].iter().any(|part|column.to_lowercase().contains(part));
            let recorded=writes.iter().any(|w|w.table==*table&&w.op==WriteOp::Update&&w.fields.iter().any(|f|f.name==*column&&match (kind.required(),field_value(f)) {
                (ColumnType::Bool,Some(Expr::Literal{value:ast::Literal::Bool(true),..}))=>true,
                (ColumnType::Time,Some(e))=>!matches!(e,Expr::Literal{value:ast::Literal::Null,..}|Expr::Member{..}),_=>false,
            }));
            let proxies=writes.iter().filter(|w|w.table==*table&&w.fields.iter().any(|f|f.name==*column)).flat_map(|w|w.fields.iter()).filter(|f|f.name!=*column&&matches!(t.columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Enum{..}|ColumnType::Bool|ColumnType::Principal|ColumnType::Time))).filter(|f|!matches!(field_value(f),Some(Expr::Member{..}))).map(|f|f.name.clone()).collect::<BTreeSet<_>>();
            let atomic=writes.iter().any(|w|w.table==*table&&w.fields.iter().any(|f|f.name==*column&&matches!((kind.required(),field_value(f)),(ColumnType::Bool,Some(Expr::Literal{value:ast::Literal::Bool(true),..}))|(ColumnType::Time,Some(Expr::Name{..}))))&&w.fields.iter().any(|f|matches!(f.name.as_str(),"status"|"stage"|"phase"|"state"|"decision"|"approval")&&matches!(t.columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Enum{..}))&&matches!(field_value(f),Some(Expr::Literal{value:ast::Literal::Str(_),..}))));
            let rule_use=super::super::columns::rules(t).any(|rule|rule.any_term(&|term|matches!(term,RuleTerm::Field(name) if name==column||proxies.contains(name))));
            let consumed=atomic||rule_use||writes.iter().filter(|w|!(w.table==*table&&w.fields.iter().any(|f|f.name==*column&&matches!((kind.required(),field_value(f)),(ColumnType::Bool,Some(Expr::Literal{value:ast::Literal::Bool(true),..}))|(ColumnType::Time,Some(Expr::Name{..})))))).any(|w|inspected(w,table,column)||proxies.iter().any(|proxy|inspected(w,table,proxy)));
            if approval&&recorded&&!consumed {
                note(out,&transitions[0].site,"N_APPROVAL_NOT_ENFORCED",format!("{table}.{column}: approval is recorded but no lifecycle transition inspects it; is this an informational record or a required approval?"),"require this approval before its governed effect; or record `check --ack-security ID --reason 'informational approval record: <spec rationale>'` for this individual decision");
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
    approval_tables(bound,writes,out);
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

fn audience(rule:&RuleExpr)->RuleExpr{match rule{
    RuleExpr::And(parts)=>RuleExpr::And(parts.iter().map(audience).collect()),
    RuleExpr::Or(parts)=>RuleExpr::Or(parts.iter().map(audience).collect()),
    r if super::super::operation::safe(r)=>r.clone(),_=>RuleExpr::Allow,
}}
fn approval_tables(bound:&Bound,writes:&[Write<'_>],out:&mut Vec<Diagnostic>) {
    for (name,t) in bound.schema.visible_tables().filter(|(n,_)|["approv","authoriz"].iter().any(|s|n.to_lowercase().contains(s))) {
        let creators=writes.iter().filter(|w|w.table==*name&&matches!(w.op,WriteOp::Insert|WriteOp::Upsert)).collect::<Vec<_>>();
        if creators.is_empty()||matches!(t.rules.insert,RuleExpr::Deny){continue;}
        let writer=RuleExpr::And(vec![audience(&t.rules.insert),RuleExpr::Or(creators.iter().map(|w|audience(&w.gate)).collect())]);
        if kernel::implies(&RuleExpr::Allow,&writer)==Ok(true){continue;}
        if bound.schema.tables.values().any(|other|super::super::columns::rules(other).any(|rule|kernel::dependencies(rule).contains(name))){continue;}
        if writes.iter().filter(|w|w.table!=*name).any(|w|conditions(&w.context).iter().any(|c|reads(c).contains(name))){continue;}
        // An approval recorded atomically with any referenced parent effect
        // is an audit record of that effect, not an unused prerequisite.
        if creators.iter().any(|c|writes.iter().any(|w|std::ptr::eq(w.p,c.p)&&w.op==WriteOp::Update&&!w.fields.is_empty()&&t.columns.values().any(|kind|matches!(kind.required(),ColumnType::Ref{table} if table==&w.table)))){continue;}
        for (reference,kind) in &t.columns {let ColumnType::Ref{table:parent}=kind.required()else{continue;};
            let effects=writes.iter().filter(|w|w.table!=*name&&(w.table==*parent&&state(w,bound)||matches!(w.op,WriteOp::Insert|WriteOp::Upsert)&&bound.schema.tables[&w.table].columns.values().any(|k|matches!(k.required(),ColumnType::Ref{table} if table==parent)))).collect::<Vec<_>>();
            if effects.iter().any(|w|kernel::implies(&audience(&w.gate),&writer)!=Ok(true)) {
                note(out,&creators[0].site,"N_APPROVAL_NOT_ENFORCED",format!("{name}.{reference}: a separately authorized approval for {parent} is recorded but no effect requires it; is it informational?"),"require the matching approval row before the governed parent/child effect; or record `check --ack-security ID --reason 'informational approval record: <spec rationale>'`");break;
            }
        }
    }
}
