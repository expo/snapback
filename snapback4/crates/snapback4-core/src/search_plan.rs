//! Shared server search admission and schema-aware recovery queries.
use crate::{ir::*, engine::rules};

// @ref LLP 3000.024#decision — the certificate must classify the running plan.
pub fn eligible(schema: &crate::schema::Schema, merge: &Merge) -> bool {
    if merge.view.is_some() { return false; }
    let [lane] = merge.lanes.as_slice() else { return false };
    let Some(source) = lane.source.as_ref().and_then(LaneSource::scan) else { return false };
    let Some(Expr::Field { base, name }) = &lane.distinct else { return false };
    // The intent membership form has one scalar scope. Keep arbitrary authored
    // expressions/lanes on their existing evaluator.
    matches!(base.as_ref(), Expr::Variable(binding) if binding == &lane.binding)
        && lane.setup.is_empty() && lane.guard.is_none() && lane.project.is_none()
        && source.take == Bound::Meter && source.filter.is_none()
        // Retained read-through rows can have a denied live parent. Their word
        // enumeration keeps the existing private/retained evaluator.
        && schema.tables[&lane.scan.table].through.is_none()
        // Oversized declarations keep the old actual-size metered evaluator
        // until both compact head and emitted-row admission support it.
        && crate::rows::disclosed::decode_reservation(&schema.tables[&lane.scan.table]) <= crate::Ceilings::default().heap_bytes
        && rules::scan_visibility(schema, source).uniform
        && rules::scan_visibility(schema, &lane.scan).uniform
        && matches!(lane.scan.prefix.first(), Some(IndexKeyExpr::Scalar(Expr::Field { base, name: field }))
            if field == name && matches!(base.as_ref(), Expr::Variable(binding) if binding == &lane.binding))
        && matches!(lane.scan.prefix.last(), Some(IndexKeyExpr::WordPrefix(_)))
        && lane.scan.prefix[1..lane.scan.prefix.len()-1].iter().all(|key| matches!(key, IndexKeyExpr::Scalar(Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_))))
}

mod print;
use print::{Names,expr,scan};
use crate::schema::Schema;

/// A grouped recovery expression, in the same argument/local scope as the read.
/// Cursor arguments change domains: callers must reset them before switching forms.
// @ref LLP 3000.024#6 — both existence and preview retain every search predicate.
pub fn grouped(schema: &Schema, merge: &Merge, bindings: &Bindings) -> Option<String> {
    let [lane]=merge.lanes.as_slice() else {return None};
    let source=lane.source.as_ref()?.scan()?;
    let scope = lane.distinct.as_ref().or_else(||lane.scan.prefix.first()?.scalar())?;
    let Expr::Field {name:field,..}=scope else {return None};
    if !lane.setup.is_empty() || lane.guard.is_some() || lane.project.is_some() {return None;}
    let mut names=bindings.clone();
    names.insert("$filter".into(),String::new());
    names.insert(lane.binding.clone(),String::new());
    let mut source=source.clone();
    source.after=lane.scan.after.clone();
    let filter=source.filter.take();
    let group_filter=match filter { Some(f)=>Some(expr(schema,&f,&names)?),None=>None };
    let groups=scan(schema,&source,&names,Some(&lane.scan.take),true)?;
    let existence=scan(schema,&lane.scan,&names,Some(&Bound::Meter),false)?;
    let hits=scan(schema,&lane.scan,&names,Some(&Bound::Literal(3)),false)?;
    let group_filter=group_filter.map_or(String::new(),|f|format!("({f}) and "));
    Some(format!("return {groups} where {group_filter}exists ({existence}) {{ {field}, hits: {hits} }}"))
}

/// Keep direction, take, order, search text, cursor and every predicate while
/// adding the actual source read rule. This is an expression, with no prose.
pub fn scoped(schema: &Schema, original: &Scan, bindings: &Bindings) -> Option<String> {
    let mut names=bindings.clone();names.insert("$filter".into(),String::new());
    let mut text=print::scan_mode(schema,original,&names,None,true,true,None)?;
    let rule=schema.tables.get(&original.table)?.rules.read.quarry();
    let has_predicates=original.prefix.iter().any(|k|matches!(k,IndexKeyExpr::Scalar(_))) || original.filter.is_some() || original.range.is_some();
    text.push_str(if has_predicates {" and "} else {" where "});
    text.push_str(&format!("({rule})"));
    Some(format!("return {text}"))
}

/// Compiler temporaries retain their source expression for check-time repairs.
pub type Bindings = std::collections::BTreeMap<String,String>;
pub fn bindings(schema: &Schema, program: &Program) -> Bindings {
    fn expression(schema: &Schema, e: &Expr, names: &mut Bindings) {
        match e {
            Expr::Block {body,value}=>{body_bindings(schema,body,names);expression(schema,value,names);}
            Expr::Array(xs)|Expr::Builtin {args:xs,..}=>for x in xs {expression(schema,x,names)},
            Expr::Object(xs)=>for x in xs.values() {expression(schema,x,names)},
            Expr::Shape {base,fields}=>{expression(schema,base,names);for x in fields.values() {expression(schema,x,names);}},
            Expr::Binary {left,right,..}=>{expression(schema,left,names);expression(schema,right,names);}
            Expr::Unary {value,..}|Expr::Field {base:value,..}=>expression(schema,value,names),
            _=>{},
        }
    }
    fn body_bindings(schema: &Schema, body: &[Stmt], names: &mut Bindings) {
        for s in body {
            match s {
                Stmt::Let {name,value}|Stmt::Const {name,value}=>{
                    expression(schema,value,names);
                    if name.starts_with('$') && let Some(text)=expr(schema,value,names) {names.insert(name.clone(),text);}
                }
                Stmt::Return(e)|Stmt::Assign {value:e,..}|Stmt::Push {value:e,..}=>expression(schema,e,names),
                Stmt::If {then_body,else_body,..}=>{body_bindings(schema,then_body,names);body_bindings(schema,else_body,names);}
                Stmt::For {domain,body,..}=>{
                    if let LoopDomain::DerivedArray {value,..}=domain {expression(schema,value,names);}
                    body_bindings(schema,body,names);
                }
                _=>{},
            }
        }
    }
    let mut names=Names::new();body_bindings(schema,&program.body,&mut names);names
}

/// A runtime refusal can quote the evaluated internal needle instead of exposing
/// a compiler-only local. Author parameters remain parameters in the repair.
pub(crate) fn runtime_bindings(schema: &Schema, values: &std::collections::BTreeMap<String,crate::Value>) -> Bindings {
    values.iter().filter(|(name,_)|name.starts_with('$')).filter_map(|(name,v)|Some((name.clone(),expr(schema,&Expr::Literal(v.clone()),&Names::new())?))).collect()
}

/// Remove decoration while retaining the membership predicate and every hit filter.
pub fn bare(schema: &Schema, merge: &Merge, bindings: &Bindings) -> Option<String> {
    let [lane]=merge.lanes.as_slice() else {return None};
    if !lane.setup.is_empty() || lane.guard.is_some() || lane.project.is_some() {return None;}
    let source=lane.source.as_ref()?.scan()?;
    if source.filter.is_some() {return None;}
    let Expr::Field {name:member_field,..}=lane.distinct.as_ref()? else {return None};
    let index=schema.tables.get(&lane.scan.table)?.index(&lane.scan.index)?;
    let message_field=index.components.first()?.column()?;
    let mut names=bindings.clone();names.insert("$filter".into(),String::new());
    let mut text=print::scan_mode(schema,&lane.scan,&names,None,true,true,Some(0))?;
    let source_index=schema.tables.get(&source.table)?.index(&source.index)?;
    let mut pins=source_index.components.iter().zip(&source.prefix).map(|(c,k)|
        Some(format!("{} = {}",c.column()?,expr(schema,k.scalar()?,&names)?))).collect::<Option<Vec<_>>>()?;
    pins.push(format!("{member_field} = .{message_field}"));
    let has_predicates=lane.scan.prefix.iter().skip(1).any(|k|matches!(k,IndexKeyExpr::Scalar(_))) || lane.scan.filter.is_some() || lane.scan.range.is_some();
    text.push_str(if has_predicates {" and "}else{" where "});
    text.push_str(&format!("exists {}[{}]",source.table,pins.join(", ")));
    Some(format!("return {text}"))
}
