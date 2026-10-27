//! Compile independent question declarations together, retaining their original sites.
// @ref LLP 3000.036.004.000.000#exact-work-reuse — preserve independent compiler results and line-one sites.
use super::*;

pub(super) enum Candidate {
    Bound(security::Invariant),
    Source(String, bool),
    Time(String, String, bool),
}

// Every declaration is still parsed at line one of the same virtual filename.
// This preserves nested expression sites as well as the hashed invariant site.
// A failed batch falls back to the original independent compiler for each line.
pub(super) fn resolve(sources:&[(String,String)],proposals:Vec<(usize,Candidate)>)->Vec<(usize,security::Invariant)> {
    let lines=proposals.iter().filter_map(|(_,p)|match p{Candidate::Source(line,_)|Candidate::Time(line,_,_)=>Some(line),_=>None}).collect::<std::collections::BTreeSet<_>>();
    let mut selected=sources.to_vec();
    selected.extend(lines.iter().map(|line|("$dx11-question.q".into(),format!("{line}\n"))));
    let compiled=if lines.is_empty(){None}else{Some(snapback4_lang::compile(&selected))};
    let batch=compiled.as_ref().filter(|b|b.diagnostics.is_empty()).map(|b|b.invariants.iter().filter(|i|i.site.file=="$dx11-question.q").cloned().collect::<Vec<_>>()).filter(|v|v.len()==lines.len());
    let bound=if let Some(batch)=batch{
        lines.iter().zip(batch).map(|(line,mut inv)|{inv.site.file=format!("$derived/dx11/{}",hash(line.as_bytes()));((*line).clone(),Some(inv))}).collect::<BTreeMap<_,_>>()
    }else{lines.iter().map(|line|((*line).clone(),candidate(sources,line))).collect()};
    proposals.into_iter().filter_map(|(index,p)|match p{
        Candidate::Bound(inv)=>Some((index,inv)),
        Candidate::Time(line,column,movable)=>bound.get(&line).cloned().flatten().map(|mut inv|{
            inv.site.file=inv.site.file.replace("/dx11/",if movable{"/sec13-anchor/"}else{"/sec13-event/"});
            inv.column=Some(column);(index,inv)
        }),
        Candidate::Source(line,absence)=>bound.get(&line).cloned().flatten().map(|mut inv|{
            if absence{inv.site.file=inv.site.file.replace("/dx11/","/sec11-absence/");}(index,inv)
        }),
    }).collect()
}

#[cfg(test)]mod tests {
    use super::*;
    #[test]fn batched_questions_match_individual_compilation_including_expression_sites(){
        let sources=vec![("schema.q".into(),"table docs:\n  owner: principal\n  approved: bool default false\n  read <- .owner = viewer\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved: true}\n".into())];
        for lines in [vec!["invariant docs.read only .owner = viewer","invariant docs.approve only .approved","invariant docs.read only .owner = viewer"],vec!["invariant docs.read only .owner = viewer","invariant missing.read only deny"]]{
            let actual=resolve(&sources,lines.iter().enumerate().map(|(i,line)|(i,Candidate::Source((*line).into(),false))).collect());
            let expected=lines.iter().enumerate().filter_map(|(i,line)|candidate(&sources,line).map(|inv|(i,inv))).collect::<Vec<_>>();
            assert_eq!(serde_json::to_value(actual).unwrap(),serde_json::to_value(expected).unwrap());
        }
    }
}
