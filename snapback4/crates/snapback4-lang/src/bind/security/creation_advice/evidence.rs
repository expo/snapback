//! Questions about evidence representations and explicitly authored empty tests.
// @ref LLP 3000.036.004.000#10-sec10-approvals-and-deterministic-exploration — names ask questions; empty-text guards need a nonblank decision.
use super::*;
fn text(kind:&ColumnType)->bool{match kind.required(){ColumnType::Text{..}=>true,ColumnType::List{of,..}|ColumnType::ListRange{of,..}=>text(of),_=>false}}
fn evidence(name:&str)->bool{["photo","scan","sketch","image","drawing","blueprint","picture","snapshot"].iter().any(|s|name.to_lowercase().contains(s))}
fn justification(name:&str)->bool{["reason","consent","assessment","recommendation"].iter().any(|s|name.to_lowercase().contains(s))}
fn nonempty_tests<'a>(e:&'a Expr,negated:bool,out:&mut Vec<&'a Expr>){match e{
    Expr::Unary{op,value,..} if op=="not"=>nonempty_tests(value,!negated,out),
    Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>{nonempty_tests(left,negated,out);nonempty_tests(right,negated,out);},
    Expr::Binary{op,..} if op=="!="&&!negated||op=="="&&negated=>out.push(e),_=>{},
}}
fn validates(e:&Expr,value:&Expr,negated:bool)->bool{match e{
    Expr::Unary{op,value:e,..} if op=="not"=>validates(e,value,!negated),
    Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>{
        let a=validates(left,value,negated);let b=validates(right,value,negated);
        if (op=="and")!=negated{a||b}else{a&&b}
    },
    Expr::Binary{op,left,right,..} if (op=="!="&&!negated||op=="="&&negated)&&(matches!(left.as_ref(),Expr::Literal{value:ast::Literal::Str(s),..} if s.is_empty())||matches!(right.as_ref(),Expr::Literal{value:ast::Literal::Str(s),..} if s.is_empty()))=>{
        [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].iter().any(|(trimmed,empty)|matches!(empty,Expr::Literal{value:ast::Literal::Str(s),..} if s.is_empty())&&matches!(trimmed,Expr::Call{name,args,..} if name=="trim"&&args.len()==1&&crate::print::expression(&args[0])==crate::print::expression(value)))
    },
    Expr::Binary{op,left,right,..} if ["<","<=",">",">=","=","!="].contains(&op.as_str())=>{
        [(left.as_ref(),right.as_ref(),false),(right.as_ref(),left.as_ref(),true)].iter().any(|(length,limit,reverse)|{
            let matches=matches!(length,Expr::Call{name,args,..} if (name=="count"||name=="len")&&args.len()==1&&matches!(&args[0],Expr::Call{name,args,..} if name=="trim"&&args.len()==1&&crate::print::expression(&args[0])==crate::print::expression(value)));
            let Some(limit)=duration_number(limit)else{return false;};if !matches{return false;}
            let (a,b)=if *reverse{(limit,0)}else{(0,limit)};
            let accepts_zero=match op.as_str(){"<"=>a<b,"<="=>a<=b,">"=>a>b,">="=>a>=b,"="=>a==b,_=>a!=b};
            accepts_zero==negated
        })
    },_=>false,
}}
pub(super) fn notes(bound:&Bound,writes:&[Write<'_>],out:&mut Vec<Diagnostic>){
    for (name,t) in bound.schema.visible_tables(){
        for (column,kind) in &t.columns {
            if text(kind)&&evidence(column){
                note(out,&Site::default(),"N_TEXT_EVIDENCE",format!("{name}.{column}: text names photo/scan/sketch evidence; is verified uploaded media required, or is this deliberately a text reference?"),"use an `image` column (or an image list) and matching image argument for verified, owner-bound uploads; make it required at the governed boundary so the upload gate can check it; retain text only for an intentional reference");
            }
            let narrower=if kind.contains_asset(){let media=super::super::columns::admission(t,Some(column));t.columns.keys().filter(|other|*other!=column&&kernel::implies(&media,&super::super::columns::admission(t,Some(other)))!=Ok(true)).cloned().collect::<Vec<_>>()}else{Vec::new()};
            if !narrower.is_empty(){
                note(out,&Site::default(),"N_MEDIA_PRIVATE_FIELDS",format!("{name}.{column}: media has a broader audience than {}; can this scan expose those private fields?",narrower.join(", ")),"apply the private audience to this media column too (`image read <- <policy>`; guide rule-recipes), or declare independent media read intent and test the broader audience");
            }
        }
    }
    // A mandatory field on a separately attached child does not require a
    // child when the parent is created. The CLI must replay committed absence.
    for (child,t) in bound.schema.visible_tables(){
        let media=t.columns.iter().filter(|(_,k)|k.contains_asset()).map(|(n,_)|n.clone()).collect::<Vec<_>>();
        if media.is_empty()||!writes.iter().any(|w|w.table==*child&&matches!(w.op,WriteOp::Insert|WriteOp::Upsert)){continue;}
        for (reference,kind) in &t.columns {
            let ColumnType::Ref{table:parent}=kind.required()else{continue;};
            let creators=writes.iter().filter(|w|w.table==*parent&&w.op==WriteOp::Insert).collect::<Vec<_>>();
            if creators.is_empty(){continue;}
            note(out,&creators[0].site,"N_CHILD_EVIDENCE_PRESENCE",format!("{parent}: creations {} do not require attached {child}[{reference} = parent].{}; must media exist when the parent is created?",creators.iter().map(|w|w.name.clone()).collect::<BTreeSet<_>>().into_iter().collect::<Vec<_>>().join(", "),media.join(",")),"require the verified upload and create the linked evidence atomically when the spec requires it; keep deliberate draft/optional attachments optional and answer the concrete replay");
        }
    }
    let mut seen=BTreeSet::new();
    for w in writes {
        let guards=conditions(&w.context);let mut tests=Vec::new();for guard in &guards{nonempty_tests(guard,false,&mut tests);}
        for e in tests {if let Expr::Binary{left,right,..}=e {
            for (value,empty) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())] {
                if !matches!(empty,Expr::Literal{value:ast::Literal::Str(s),..} if s.is_empty()){continue;}
                let mut unsafe_text=false;
                walk(value,|part|match part {
                    Expr::Name{name,..} if justification(name)||w.fields.iter().any(|f|justification(&f.name)&&field_value(f).is_some_and(|e|uses(e,name)))=>{unsafe_text|=w.p.args.iter().any(|a|a.name==*name&&matches!(a.type_.kind,TypeKind::Text{min:None|Some(0),..}));},
                    Expr::Member{base,name,..} if justification(name)=>{unsafe_text|=reads(base).iter().any(|table|bound.schema.table(table).is_some_and(|t|matches!(t.columns.get(name).map(ColumnType::required),Some(ColumnType::Text{..}))&&!t.constraints.iter().any(|c|matches!(c,snapback4_core::schema::Constraint::Text{field,min,..} if field==name&&*min>0))));},_=>{}
                });
                let trimmed=matches!(value,Expr::Call{name,args,..} if name=="trim"&&args.len()==1);
                let row_minimum=writes.iter().filter(|other|std::ptr::eq(other.p,w.p)&&(other.site==w.site||other.site.file==w.site.file&&other.site.line<w.site.line&&ordinary_unconditional(other.p,&other.site))).any(|other|other.fields.iter().any(|f|field_value(f).is_some_and(|e|crate::print::expression(e)==crate::print::expression(value))&&bound.schema.tables[&other.table].constraints.iter().any(|c|matches!(c,snapback4_core::schema::Constraint::Text{field,min,..} if field==&f.name&&*min>0))));
                if unsafe_text&&!trimmed&&!row_minimum&&!guards.iter().any(|guard|validates(guard,value,false))&&seen.insert((w.name.clone(),crate::print::expression(value))){
                    note(out,&w.site,"N_BLANK_TEXT_GUARD",format!("{}: a reason/consent/assessment is compared with empty text but whitespace still passes; is nonblank evidence required?",w.name),"require `trim(value) != ''` for the same justification before its governed write, or use `text 1..N` for every supplied justification; acknowledge an intentional whitespace-sensitive comparison with check --ack-security ID --reason '<spec rationale>'");
                }
            }
        }
        }
        for condition in guards{walk(condition,|e|{
        if let Expr::Binary{op,left,right,..}=e&&["+","-","*","/","%"].contains(&op.as_str())&&[left.as_ref(),right.as_ref()].iter().any(|e|matches!(e,Expr::Call{name,..} if name=="month"))&&seen.insert((w.name.clone(),"month arithmetic".into())) {
            note(out,&w.site,"N_CALENDAR_DURATION",format!("{}: month() arithmetic retains the year but drops day-of-month precision; is this a month bucket or an exact anniversary window?",w.name),"compare full timestamps or an explicit calendar anniversary deadline when day precision is required; declare window intent and test the beginning of the offset month");
        }
    });}
    }
}
