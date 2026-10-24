//! A family command expands to current individual, source-bound records.
// @ref LLP 3000.036.004#18-wave-26-security-decisions-dx9 — review questions lead, and gates never enter the audience family.
use super::*;
use snapback4_lang::Diagnostic;

pub(super) fn audience(code: &str) -> bool {
    !gated(code) && matches!(code, "N_INVARIANT_RESTATES_RULE" | "N_ROLE_WIDE_READ" | "N_ROLE_WIDE_WRITE" | "N_BROAD_READ")
}
pub(super) fn family(notes: &[Diagnostic], identities: &[(String,String,String)]) -> Option<String> {
    let mut members = notes.iter().zip(identities).filter(|(note,_)| audience(&note.code))
        .map(|(_, (id,source,_))| (id,source)).collect::<Vec<_>>();
    if members.is_empty() { return None; }
    members.sort();
    Some(format!("audience:{}", hash(&serde_json::to_vec(&(ANALYZER,members)).unwrap())))
}
pub(in crate::verbs) fn count(dispositions: &[Disposition]) -> usize {
    let audience = dispositions.iter().any(|d| !d.acknowledged && d.family.is_some());
    usize::from(audience) + dispositions.iter().filter(|d| !d.acknowledged && d.family.is_none()
        && crate::note_rank::tier(&d.code)==crate::note_rank::Tier::Review).count()
}
pub(in crate::verbs) fn print(dispositions: &[Disposition], notes: &[Diagnostic]) {print!("{}",render(dispositions,notes));}
pub(in crate::verbs) fn render(dispositions: &[Disposition], notes: &[Diagnostic]) -> String {
    use std::fmt::Write;
    let mut output=String::new();
    let mut ordered=notes.iter().zip(dispositions).collect::<Vec<_>>();
    ordered.sort_by_key(|(n,_)|(crate::note_rank::summary_order(&n.code),n.site.file.clone(),n.site.line,n.site.col));
    let members=ordered.iter().filter(|(_,d)|d.family.is_some()&&!d.acknowledged).collect::<Vec<_>>();
    if let Some((_,first))=members.first().copied() {
        let codes=members.iter().map(|(n,_)|n.code.as_str()).collect::<std::collections::BTreeSet<_>>().into_iter().collect::<Vec<_>>().join(", ");
        writeln!(&mut output,"decision audience ({codes}): Are these {} row/column audiences, roles and lifecycle states intended?",members.len()).unwrap();
        for (n,_) in &members {
            // The expanded branch cross-product stays in JSON. One question
            // names the source subject without repeating every equivalent path.
            let subject = n.message.split(" matches or weakens").next().unwrap_or(&n.message)
                .split(": ").next().unwrap_or(&n.message);
            writeln!(&mut output,"  ? {}: Is {} intended?",n.site,subject.trim_end_matches('.')).unwrap();
        }
        writeln!(&mut output,"  Intended: snapback4 check --ack-security {} --reason '<spec rationale>'",first.family.as_deref().unwrap()).unwrap();
        writeln!(&mut output,"  Narrower: restrict the listed rules; declare independent intent; run snapback4 test. Full audiences: check --json.").unwrap();
    }
    for (n,d) in ordered {
        if d.acknowledged { writeln!(&mut output,"security reviewed {} {}: {}",d.id,d.code,d.reason.as_deref().unwrap_or("")).unwrap(); continue; }
        if d.family.is_some() { continue; }
        if crate::note_rank::tier(&n.code)!=crate::note_rank::Tier::Review { continue; }
        let subject=n.message.split(": ").next().unwrap_or(&n.message);
        let concise=match n.code.as_str() {
            "N_COLUMN_RESULT_EXPOSURE"=>format!("{subject}: should operation results/refusals expose protected or projected-out columns to every admitted caller"),
            _=>n.message.trim_end_matches(['.', '?']).to_owned(),
        };
        let question=concise.trim_end_matches(['.', '?']);
        writeln!(&mut output,"decision {} at {}: {question}; is this intended?",d.code,d.site).unwrap();
        let repair=match n.code.as_str() {
            "N_COLUMN_RESULT_EXPOSURE"=>"restrict result/refusal audiences with column rules and independent intent; run snapback4 test",
            "N_ARGUMENT_GRANT"=>"validate the recipient's current role and relationship; caller authority alone is insufficient",
            _=>n.rewrite.as_str(),
        };
        writeln!(&mut output,"  Repair: {repair}").unwrap();
        writeln!(&mut output,"  Intended: snapback4 check --ack-security {} --reason '<spec rationale>'{}",d.id,if d.gated {" (required before check can pass)"}else{""}).unwrap();
    }
    output
}

#[cfg(test)]mod tests {
 use super::*;
 #[test]fn every_gate_is_one_decision_and_never_a_family_member(){
  for code in snapback4_lang::security::GATED_NOTE_CODES {
   assert!(!audience(code));
   let n=Diagnostic::new(&Default::default(),*code,"explicit review required","repair enforcement");
   let d=Disposition{family:None,id:"id".into(),code:(*code).into(),site:"schema.q:1:1".into(),gated:true,acknowledged:false,reason:None,scope:"test".into()};
   let text=render(&[d],&[n]);assert_eq!(text.matches(code).count(),1,"{text}");assert!(text.contains("is this intended?")&&text.contains("Repair:")&&text.contains("Intended:"));
  }
  for code in ["N_DERIVED_WRITE_AUTHORITY","N_CALLER_TIME","N_OPTIONAL_EVIDENCE","N_APPROVAL_NOT_ENFORCED","E_SECURITY_REVIEW"] {assert!(!audience(code));}
 }
}
