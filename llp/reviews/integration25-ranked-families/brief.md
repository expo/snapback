Review this pending Integration 25 correction to Snapback 4. Read-only review: do not change files or run mutations. Identify material correctness regressions only, with file/line and concrete trigger; otherwise say no material finding. The accepted contract keeps source-bound advisory audience-family decisions complete and singular, individual gates at review tier, and existing gate/authority priorities ahead of lower-ranked questions. It distinguishes rule-enforced intent from whole-protocol proof. These changes must preserve acknowledgement identities and classifications. Review the complete decisions renderer below and the focused diff. You have not seen the author's reasoning.

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
    // @ref LLP 3000.036.004#16.5-review-clarification-exact-detector-and-command-boundaries — grouping must preserve gate/authority priority.
    ordered.sort_by_key(|(n,_)|(crate::note_rank::summary_order(&n.code),n.site.file.clone(),n.site.line,n.site.col));
    let members=ordered.iter().filter(|(_,d)|d.family.is_some()&&!d.acknowledged).collect::<Vec<_>>();
    let mut family_output=String::new();
    if let Some((_,first))=members.first().copied() {
        let codes=members.iter().map(|(n,_)|n.code.as_str()).collect::<std::collections::BTreeSet<_>>().into_iter().collect::<Vec<_>>().join(", ");
        writeln!(&mut family_output,"decision audience ({codes}): Are these {} row/column audiences, roles and lifecycle states intended?",members.len()).unwrap();
        for (n,_) in &members {
            // The expanded branch cross-product stays in JSON. One question
            // names the source subject without repeating every equivalent path.
            let subject = n.message.split(" matches or weakens").next().unwrap_or(&n.message)
                .split(": ").next().unwrap_or(&n.message);
            writeln!(&mut family_output,"  ? {}: Is {} intended?",n.site,subject.trim_end_matches('.')).unwrap();
        }
        writeln!(&mut family_output,"  Intended: snapback4 check --ack-security {} --reason '<spec rationale>'",first.family.as_deref().unwrap()).unwrap();
        writeln!(&mut family_output,"  Narrower: restrict the listed rules; declare independent intent; run snapback4 test. Full audiences: check --json.").unwrap();
    }
    let mut family_printed=false;
    for (n,d) in ordered {
        if d.acknowledged { writeln!(&mut output,"security reviewed {} {}: {}",d.id,d.code,d.reason.as_deref().unwrap_or("")).unwrap(); continue; }
        if d.family.is_some() {
            if !family_printed {output.push_str(&family_output);family_printed=true;}
            continue;
        }
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
 #[test]fn authority_and_gates_precede_one_complete_audience_family(){
  let codes=["N_BROAD_READ","N_PRIVILEGE_ESCALATION","N_OPTIONAL_UPLOAD_CREATE","N_INVARIANT_RESTATES_RULE"];
  let notes=codes.iter().map(|code|Diagnostic::new(&Default::default(),*code,"subject: review authority","repair enforcement")).collect::<Vec<_>>();
  let dispositions=codes.iter().map(|code|Disposition{family:audience(code).then(||"audience:family".into()),id:(*code).into(),code:(*code).into(),site:"schema.q:1:1".into(),gated:gated(code),acknowledged:false,reason:None,scope:"test".into()}).collect::<Vec<_>>();
  let text=render(&dispositions,&notes);
  assert!(text.find("decision N_OPTIONAL_UPLOAD_CREATE").unwrap()<text.find("decision N_PRIVILEGE_ESCALATION").unwrap(),"{text}");
  assert!(text.find("decision N_PRIVILEGE_ESCALATION").unwrap()<text.find("decision audience").unwrap(),"{text}");
  assert_eq!(text.matches("decision audience").count(),1,"{text}");
  assert!(text.contains("Are these 2 row/column audiences")&&text.contains("audience:family"),"{text}");
 }
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

DIFF
diff --git a/snapback4/crates/snapback4/src/verbs/security_reviews/decisions.rs b/snapback4/crates/snapback4/src/verbs/security_reviews/decisions.rs
index c4aa21808a..d3780f4590 100644
--- a/snapback4/crates/snapback4/src/verbs/security_reviews/decisions.rs
+++ b/snapback4/crates/snapback4/src/verbs/security_reviews/decisions.rs
@@ -23,24 +23,30 @@ pub(in crate::verbs) fn render(dispositions: &[Disposition], notes: &[Diagnostic
     use std::fmt::Write;
     let mut output=String::new();
     let mut ordered=notes.iter().zip(dispositions).collect::<Vec<_>>();
+    // @ref LLP 3000.036.004#16.5-review-clarification-exact-detector-and-command-boundaries — grouping must preserve gate/authority priority.
     ordered.sort_by_key(|(n,_)|(crate::note_rank::summary_order(&n.code),n.site.file.clone(),n.site.line,n.site.col));
     let members=ordered.iter().filter(|(_,d)|d.family.is_some()&&!d.acknowledged).collect::<Vec<_>>();
+    let mut family_output=String::new();
     if let Some((_,first))=members.first().copied() {
         let codes=members.iter().map(|(n,_)|n.code.as_str()).collect::<std::collections::BTreeSet<_>>().into_iter().collect::<Vec<_>>().join(", ");
-        writeln!(&mut output,"decision audience ({codes}): Are these {} row/column audiences, roles and lifecycle states intended?",members.len()).unwrap();
+        writeln!(&mut family_output,"decision audience ({codes}): Are these {} row/column audiences, roles and lifecycle states intended?",members.len()).unwrap();
         for (n,_) in &members {
             // The expanded branch cross-product stays in JSON. One question
             // names the source subject without repeating every equivalent path.
             let subject = n.message.split(" matches or weakens").next().unwrap_or(&n.message)
                 .split(": ").next().unwrap_or(&n.message);
-            writeln!(&mut output,"  ? {}: Is {} intended?",n.site,subject.trim_end_matches('.')).unwrap();
+            writeln!(&mut family_output,"  ? {}: Is {} intended?",n.site,subject.trim_end_matches('.')).unwrap();
         }
-        writeln!(&mut output,"  Intended: snapback4 check --ack-security {} --reason '<spec rationale>'",first.family.as_deref().unwrap()).unwrap();
-        writeln!(&mut output,"  Narrower: restrict the listed rules; declare independent intent; run snapback4 test. Full audiences: check --json.").unwrap();
+        writeln!(&mut family_output,"  Intended: snapback4 check --ack-security {} --reason '<spec rationale>'",first.family.as_deref().unwrap()).unwrap();
+        writeln!(&mut family_output,"  Narrower: restrict the listed rules; declare independent intent; run snapback4 test. Full audiences: check --json.").unwrap();
     }
+    let mut family_printed=false;
     for (n,d) in ordered {
         if d.acknowledged { writeln!(&mut output,"security reviewed {} {}: {}",d.id,d.code,d.reason.as_deref().unwrap_or("")).unwrap(); continue; }
-        if d.family.is_some() { continue; }
+        if d.family.is_some() {
+            if !family_printed {output.push_str(&family_output);family_printed=true;}
+            continue;
+        }
         if crate::note_rank::tier(&n.code)!=crate::note_rank::Tier::Review { continue; }
         let subject=n.message.split(": ").next().unwrap_or(&n.message);
         let concise=match n.code.as_str() {
@@ -62,6 +68,16 @@ pub(in crate::verbs) fn render(dispositions: &[Disposition], notes: &[Diagnostic
 
 #[cfg(test)]mod tests {
  use super::*;
+ #[test]fn authority_and_gates_precede_one_complete_audience_family(){
+  let codes=["N_BROAD_READ","N_PRIVILEGE_ESCALATION","N_OPTIONAL_UPLOAD_CREATE","N_INVARIANT_RESTATES_RULE"];
+  let notes=codes.iter().map(|code|Diagnostic::new(&Default::default(),*code,"subject: review authority","repair enforcement")).collect::<Vec<_>>();
+  let dispositions=codes.iter().map(|code|Disposition{family:audience(code).then(||"audience:family".into()),id:(*code).into(),code:(*code).into(),site:"schema.q:1:1".into(),gated:gated(code),acknowledged:false,reason:None,scope:"test".into()}).collect::<Vec<_>>();
+  let text=render(&dispositions,&notes);
+  assert!(text.find("decision N_OPTIONAL_UPLOAD_CREATE").unwrap()<text.find("decision N_PRIVILEGE_ESCALATION").unwrap(),"{text}");
+  assert!(text.find("decision N_PRIVILEGE_ESCALATION").unwrap()<text.find("decision audience").unwrap(),"{text}");
+  assert_eq!(text.matches("decision audience").count(),1,"{text}");
+  assert!(text.contains("Are these 2 row/column audiences")&&text.contains("audience:family"),"{text}");
+ }
  #[test]fn every_gate_is_one_decision_and_never_a_family_member(){
   for code in snapback4_lang::security::GATED_NOTE_CODES {
    assert!(!audience(code));
diff --git a/snapback4/packages/snapback4/test/security-packed.test.mjs b/snapback4/packages/snapback4/test/security-packed.test.mjs
index d55cdf5470..0f9fdc6390 100644
--- a/snapback4/packages/snapback4/test/security-packed.test.mjs
+++ b/snapback4/packages/snapback4/test/security-packed.test.mjs
@@ -112,9 +112,11 @@ test('check keeps invariant details behind verbose and preserves complete JSON',
  const binary=process.env.SNAPBACK4_BIN||join(root,'target/debug/snapback4');
  const invoke=(...args)=>{const r=spawnSync(binary,args,{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);return r;};
  const compact=invoke('check'),text=compact.stdout+compact.stderr;
- assert.match(text,/security: \d+ proved, \d+ refuted, \d+ unproved/);
- assert.equal((text.match(/— N_INVARIANT_RESTATES_RULE:/g)||[]).length,1,'restating sites share one table questionnaire');
- assert.match(text,/8 underlying questions/);
+ assert.match(text,/security: 0 proved, 0 refuted; 8 enforced by rule \(additional paths not proved\); 0 other unproved/);
+ assert.equal((text.match(/decision audience \(N_INVARIANT_RESTATES_RULE\)/g)||[]).length,1,'restating sites share one source-bound questionnaire');
+ assert.match(text,/Are these 8 row\/column audiences/);
+ assert.equal((text.match(/  \? schema\.q:/g)||[]).length,8);
+ assert.match(text,/check --ack-security audience:[a-f0-9]+ --reason/);
  assert.match(text,/snapback4 test/);assert.match(text,/snapback4 audit/);
  assert.doesNotMatch(text,/security Unproved:|counterexample \{/);
  const full=invoke('check','--verbose');assert.match(full.stdout+full.stderr,/whole-protocol noninterference/);
@@ -133,5 +135,7 @@ test('an escalation note stays visible above repeated broad-read advice', {timeo
  assert.match(result.stdout,/N_PRIVILEGE_ESCALATION/);
  const broad=result.stdout.indexOf('N_BROAD_READ');
  assert.ok(broad<0||result.stdout.indexOf('N_PRIVILEGE_ESCALATION')<broad);
- assert.equal((result.stdout.match(/— N_BROAD_READ:/g)||[]).length,9,'every likely-hole audience survives the cap');
+ assert.equal((result.stdout.match(/decision audience \(N_BROAD_READ\)/g)||[]).length,1,'one complete audience family');
+ assert.match(result.stdout,/Are these 9 row\/column audiences/);
+ assert.equal((result.stdout.match(/  \? schema\.q:/g)||[]).length,9,'every likely-hole audience survives the cap');
 });
