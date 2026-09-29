use std::{fs,process::Command};
#[test]
fn check_reports_each_field_owner_and_visibility() {
    let dir=std::env::temp_dir().join(format!("sb4-check-fields-{}",std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    let source=r#"table marks:
  principal: principal
  privateMark: int default 0 written by .principal
  sharedMark: int default 0 written by .principal readable by audience
  public 'marks'
  sync public last 10 by .id
"#;
    fs::write(dir.join("snapback/schema.q"),source).unwrap();
    for json in [false,true] {
        let mut cmd=Command::new(env!("CARGO_BIN_EXE_snapback4"));cmd.current_dir(&dir).arg("check");if json {cmd.arg("--json");} else {cmd.arg("--verbose");}
        let out=cmd.output().unwrap();let text=String::from_utf8(out.stdout).unwrap();
        assert!(out.status.success(),"{text}\n{}",String::from_utf8_lossy(&out.stderr));
        for line in ["marks.privateMark: written by .principal; visibility: private to owner","marks.sharedMark: written by .principal; visibility: readable by audience"] {
            assert_eq!(text.matches(line).count(),1,"{text}");
        }
        if json {assert_eq!(serde_json::from_str::<serde_json::Value>(&text).unwrap()["fieldAuthority"].as_array().unwrap().len(),2);}
    }
    fs::remove_dir_all(dir).unwrap();
}
