//! Questions about evidence representations and explicitly authored empty tests.
// @ref LLP 3000.036.004.000#10-sec10-approvals-and-deterministic-exploration — names ask questions; empty-text guards need a nonblank decision.
use super::*;
fn evidence(name:&str)->bool{["photo","scan","sketch","image"].iter().any(|s|name.to_lowercase().contains(s))}
fn justification(name:&str)->bool{["reason","consent","assessment","recommendation"].iter().any(|s|name.to_lowercase().contains(s))}
pub(super) fn notes(bound:&Bound,writes:&[Write<'_>],out:&mut Vec<Diagnostic>){
    for (name,t) in bound.schema.visible_tables(){
        for (column,kind) in &t.columns {
            if matches!(kind.required(),ColumnType::Text{..})&&evidence(column){
                note(out,&Site::default(),"N_TEXT_EVIDENCE",format!("{name}.{column}: text names photo/scan/sketch evidence; is verified uploaded media required, or is this deliberately a text reference?"),"use an `image` column and image argument for verified, owner-bound uploads; make it required at the governed boundary so the upload gate can check it; retain text only for an intentional reference");
            }
            if kind.contains_asset()&&!t.column_reads.contains_key(column)&&!t.column_reads.is_empty(){
                note(out,&Site::default(),"N_MEDIA_PRIVATE_FIELDS",format!("{name}.{column}: media has the whole-row audience while {} have narrower column audiences; can this scan expose those private fields?",t.column_reads.keys().cloned().collect::<Vec<_>>().join(", ")),"apply the private audience to this media column too (`image read <- <policy>`; guide rule-recipes), or declare independent media read intent and test the broader audience");
            }
        }
    }
    let mut seen=BTreeSet::new();
    for w in writes {for condition in conditions(&w.context){walk(condition,|e|{
        if let Expr::Binary{op,left,right,..}=e&&matches!(op.as_str(),"!="|"=") {
            for (value,empty) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())] {
                if !matches!(empty,Expr::Literal{value:ast::Literal::Str(s),..} if s.is_empty()){continue;}
                let mut unsafe_text=false;
                walk(value,|part|match part {
                    Expr::Name{name,..} if justification(name)||w.fields.iter().any(|f|justification(&f.name)&&field_value(f).is_some_and(|e|uses(e,name)))=>{unsafe_text|=w.p.args.iter().any(|a|a.name==*name&&matches!(a.type_.kind,TypeKind::Text{min:None|Some(0),..}));},
                    Expr::Member{base,name,..} if justification(name)=>{unsafe_text|=reads(base).iter().any(|table|bound.schema.table(table).is_some_and(|t|matches!(t.columns.get(name).map(ColumnType::required),Some(ColumnType::Text{..}))&&!t.constraints.iter().any(|c|matches!(c,snapback4_core::schema::Constraint::Text{field,min,..} if field==name&&*min>0))));},_=>{}
                });
                let trimmed=matches!(value,Expr::Call{name,args,..} if name=="trim"&&args.len()==1);
                if unsafe_text&&!trimmed&&seen.insert((w.name.clone(),crate::print::expression(value))){
                    note(out,&w.site,"N_BLANK_TEXT_GUARD",format!("{}: a reason/consent/assessment is compared with empty text but whitespace still passes; is nonblank evidence required?",w.name),"require `trim(value) != ''` for the same justification before its governed write, or use `text 1..N` for every supplied justification; acknowledge an intentional whitespace-sensitive comparison with check --ack-security ID --reason '<spec rationale>'");
                }
            }
        }
        if let Expr::Binary{op,left,right,..}=e&&op=="-"&&[left.as_ref(),right.as_ref()].iter().all(|e|matches!(e,Expr::Call{name,..} if name=="month"))&&seen.insert((w.name.clone(),"month arithmetic".into())) {
            note(out,&w.site,"N_CALENDAR_DURATION",format!("{}: subtracting month() values loses the year and day; is this an elapsed-age or calendar-anniversary window?",w.name),"compare full timestamps or an explicit calendar deadline, including year and day; declare window intent and test an old date across a year boundary");
        }
    });}}
}
