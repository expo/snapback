//! SEC5: specification questions include every audience instead of proposing rule copies.
use snapback4_lang::{compile,security};
fn bound(source:&str)->snapback4_lang::Bound{
    let b=compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
}
const ROLES:&str="table roles:\n  principal: principal\n  role: enum('coach','parent','clinician')\n  unique principal\n  read <- .principal = viewer\n  insert <- viewer = 'service:operator'\n  online only\n";
fn restates(source:&str)->Vec<snapback4_lang::Diagnostic>{
    security::analyze(&bound(source)).notes.into_iter().filter(|n|n.code=="N_INVARIANT_RESTATES_RULE").collect()
}
#[test]
fn weaker_copies_get_role_and_row_questions_but_independent_alternatives_stay_quiet(){
    let source=format!("{ROLES}table notes:\n  athlete: principal\n  status: enum('draft','shared')\n  read <- exists roles[viewer,role = 'coach'] and .status = 'shared'\n  online only\ninvariant notes.read only exists roles[viewer,role = 'coach']\n");
    let notes=restates(&source);assert_eq!(notes.len(),1);
    assert!(notes[0].message.contains("roles.role = 'coach'"),"{:?}",notes);
    assert!(notes[0].message.contains(".status")&&notes[0].message.contains("'shared'"));
    assert!(notes[0].message.contains("Should the spec allow")&&notes[0].message.contains("other people's rows"));
    assert!(restates(&source.replace("invariant notes.read only exists roles[viewer,role = 'coach']","invariant notes.read only .athlete = viewer")).is_empty());
    assert!(restates("table notes:\n  owner: principal\n  read <- .owner = viewer\n  online only\ninvariant notes.read only .owner = viewer or viewer = 'service:operator'\n").is_empty());
}
#[test]
fn column_mirror_accounts_for_role_probe_implying_roster_membership(){
    let source=format!("{ROLES}table notes:\n  body: text <=80\n  read <- exists roles[viewer]\n  read (body) <- exists roles[viewer,role = 'clinician']\n  online only\ninvariant notes.body read only exists roles[viewer,role = 'clinician']\n");
    let notes=restates(&source);assert_eq!(notes.len(),1,"{notes:?}");
    assert!(notes[0].message.contains("Rule notes.body.read")&&notes[0].message.contains("'clinician'"));
}
#[test]
fn self_row_probe_rewording_and_named_probe_weakening_are_advisory_only(){
    let source="table homes:\n  homeowner: principal\n  read <- exists homes[.id, homeowner = viewer]\n  online only\ninvariant homes.read only .homeowner = viewer\n";
    let b=bound(source);let before=security::analyze(&b);
    assert_eq!(before.notes.iter().filter(|n|n.code=="N_INVARIANT_RESTATES_RULE").count(),1);
    // The lint-only self-probe normalization is not borrowed by the prover.
    assert_eq!(before.invariants[0].direct_rule,security::Status::Unproved);
    let source=format!("{ROLES}table teams:\n  read <- allow\n  online only\ntable grants:\n  principal: principal\n  team: teams\n  unique principal\n  read <- .principal = viewer\n  online only\ntable notes:\n  team: teams\n  read <- exists grants[viewer,team = .team]\n  online only\ninvariant notes.read only exists grants[viewer]\n");
    assert_eq!(restates(&source).len(),1);
}
#[test]
fn denied_gates_do_not_generate_vacuous_restatement_advice(){
    assert!(restates("table hidden:\n  owner: principal\n  read <- deny\n  online only\ninvariant hidden.read only .owner = viewer\n").is_empty());
}
#[test]
fn questionnaire_includes_excluded_roles_every_column_and_relationship_context(){
    let b=bound(&format!("{ROLES}table notes:\n  athlete: principal\n  status: enum('draft','shared')\n  body: text <=80\n  read <- exists roles[viewer,role = 'coach']\n  online only\n"));
    let draft=security::draft(&b);
    for role in ["coach","parent","clinician"]{
        assert!(draft.lines().any(|l|l.contains("Q notes.read /")&&l.contains(&format!("'{role}'"))),"{draft}");
        for column in ["athlete","status","body"]{
            assert!(draft.lines().any(|l|l.contains(&format!("Q notes.{column} ("))&&l.contains(&format!("'{role}'"))),"{draft}");
        }
    }
    assert!(draft.contains(".athlete (principal)")&&draft.contains("draft / shared"));
    assert!(draft.contains("a signed-in user with no role or relationship"));
    assert!(!draft.lines().any(|l|l.contains("invariant notes.")),"no proposed invariant or rule copies");
    assert!(draft.lines().all(|l|l.is_empty()||l.starts_with("--")));
}
#[test]
fn each_column_audience_retains_row_and_lifecycle_conditions(){
    let source=format!("{ROLES}table notes:\n  athlete: principal\n  status: enum('draft','shared')\n  body: text <=80\n  read <- .athlete = viewer or exists roles[viewer,role = 'coach']\n  read (body) <- (.athlete = viewer or exists roles[viewer,role = 'clinician']) and .status = 'shared'\n  online only\ninvariant notes.body read only .athlete = viewer or exists roles[viewer,role = 'clinician']\n");
    let notes=restates(&source);assert_eq!(notes.len(),1,"{notes:?}");
    // Every distributed alternative keeps the conjunctive column condition.
    for question in notes[0].message.split("Rule notes.body.read").skip(1){
        assert!(question.contains(".status")&&question.contains("'shared'"),"{question}");
    }
}

#[test]
fn category_with_an_author_is_not_invented_as_a_role_roster(){
    let b=bound("table events:\n  author: principal\n  kind: enum('concussion','other')\n  read <- .author = viewer\n  online only\n");
    assert!(!security::draft(&b).contains("events.kind = 'concussion'"));
}
