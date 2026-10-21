//! Wave-21 regressions: ordinary v2 edits must survive rollback/forward.
use super::*;
const OLD:&str="table items:\n  input: int\n  public 'fixture'\n  insert <- allow\n  update <- allow\n  online only\nmutation edit():\n  update items['a'] {input: 2}\n";
fn next()->String {OLD.replace("  input: int", "  label: int\n  input: int")+"backfill items label(input: int):\n  {label: input * 10}\nmutation editBoth():\n  update items['a'] {input: 2, label: 20}\nmutation editNative():\n  update items['a'] {input: 2, label: 99}\n"}
#[test]
fn wave21_native_v2_edits_refresh_fingerprint_without_rederiving_authored_output() {
    let new=next();let mut e=engine(&new);
    seed(&mut e,"items",json!({"id":"a","input":1,"label":10}));write(&mut e,"editNative");
    for _ in 0..2 {adopt(&mut e,OLD,1).unwrap();adopt(&mut e,&new,2).unwrap();assert_eq!(field(&mut e,"items","a","label"),Value::Int(99));}
}
#[test]
fn wave21_migrated_v2_edits_refresh_inputs_and_preserve_current_output() {
    let new=next();let mut e=engine(OLD);seed(&mut e,"items",json!({"id":"a","input":1}));adopt(&mut e,&new,2).unwrap();write(&mut e,"editBoth");
    for _ in 0..2 {adopt(&mut e,OLD,1).unwrap();adopt(&mut e,&new,2).unwrap();assert_eq!(field(&mut e,"items","a","label"),Value::Int(20));}
}
#[test]
fn wave21_recompute_agreement_adopts_legacy_native_marker_but_disagreement_refuses() {
    for label in [20,99] {
        let new=next();let mut e=engine(&new);seed(&mut e,"items",json!({"id":"a","input":1,"label":label}));adopt(&mut e,OLD,1).unwrap();write(&mut e,"edit");
        let result=adopt(&mut e,&new,2);
        if label==20 {result.unwrap();assert_eq!(field(&mut e,"items","a","label"),Value::Int(20));}else {assert!(result.unwrap_err().to_string().contains("recomputation differs"));}
    }
}
#[test]
fn wave21_nullable_rename_absence_is_not_a_conflict_in_either_direction() {
    let old="table items:\n  title: text <=40 ?\n  public 'fixture'\n  online only\n";
    let new="table items:\n  name: text <=40 ? renamed from title\n  public 'fixture'\n  online only\n";
    let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","title":"first"}));adopt(&mut e,new,2).unwrap();assert_eq!(field(&mut e,"items","a","name"),Value::String("first".into()));
    adopt(&mut e,old,1).unwrap();seed(&mut e,"items",json!({"id":"b","title":"old client"}));adopt(&mut e,new,2).unwrap();assert_eq!(field(&mut e,"items","b","name"),Value::String("old client".into()));
    adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","b","title"),Value::String("old client".into()));
}

#[test]
fn wave21_hidden_inputs_keep_their_native_fingerprint_on_unrelated_active_writes() {
    let new=next();let hidden=new.replace("  input: int\n", "").replace("mutation edit():\n  update items['a'] {input: 2}\n", "").replace("mutation editBoth():\n  update items['a'] {input: 2, label: 20}\n", "").replace("{input: 2, label: 99}","{label:99}");
    let mut e=engine(&new);seed(&mut e,"items",json!({"id":"a","input":1,"label":99}));
    adopt(&mut e,&hidden,3).unwrap();write(&mut e,"editNative");adopt(&mut e,OLD,1).unwrap();adopt(&mut e,&new,2).unwrap();
    assert_eq!(field(&mut e,"items","a","label"),Value::Int(99));
}
#[test]
fn wave21_reversed_existing_output_accepts_exact_recomputation() {
    let old=OLD.replace("  input: int","  label: int\n  input: int").replace("{input: 2}","{input:2,label:20}");
    let new=old.clone()+"backfill items label(input: int):\n  {label:input * 10}\n";
    let mut e=engine(&old);seed(&mut e,"items",json!({"id":"a","input":1,"label":0}));
    adopt(&mut e,&new,2).unwrap();adopt(&mut e,&old,1).unwrap();write(&mut e,"edit");adopt(&mut e,&new,2).unwrap();
    assert_eq!(field(&mut e,"items","a","label"),Value::Int(20));
}
