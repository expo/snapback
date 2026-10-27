//! Wave-34 schema-first/section-hopping and starter re-read regression paths.
use std::{fs, path::PathBuf, process::{Command,Output}};
struct Project(PathBuf);
impl Project {
    fn new() -> Self { let dir=std::env::temp_dir().join(format!("tok3-{}",std::process::id()));let _=fs::remove_dir_all(&dir);fs::create_dir_all(dir.join("snapback")).unwrap();Self(dir) }
    fn cli(&self,args:&[&str])->Output {Command::new(env!("CARGO_BIN_EXE_snapback4")).args(args).current_dir(&self.0).env("SNAPBACK4_INIT_INSTALL","0").output().unwrap()}
}
impl Drop for Project {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
#[test]
fn wave34_codex_001_039_muse_019_018_recipe_index_and_starter_edit_regions() {
    let p=Project::new();
    let workflow=p.cli(&["guide","workflow"]);assert!(workflow.status.success());assert!(workflow.stdout.len()<=8001);
    let source=snapback4_lang::guide::quarry(snapback4_lang::guide::card("workflow").unwrap()).remove(0);
    fs::write(p.0.join("snapback/schema.q"),source).unwrap();
    let check=p.cli(&["check"]);assert!(check.status.success(),"{}",String::from_utf8_lossy(&check.stderr));
    let verdict=String::from_utf8_lossy(&check.stdout);assert!(verdict.lines().find(|s|s.starts_with("check: ok")).unwrap().contains("API index: `guide api generated`"));
    let index=p.cli(&["guide","api","generated"]);assert!(index.status.success());let index=String::from_utf8_lossy(&index.stdout);
    assert!(index.contains("board(c:")&&index.contains("usePage / useQuery")&&index.contains("approve(request:")&&index.contains("useMutation"),"{index}");
    for module in ["react","proof","client","auth"] {assert!(p.cli(&["guide","api",module]).status.success());}
    let init=p.cli(&["init","--web","--online","--password","--no-install"]);assert!(init.status.success(),"{}",String::from_utf8_lossy(&init.stderr));
    for file in ["staging.mjs","frontend-proof.mjs","probe-serve.mjs"] {assert!(fs::read_to_string(p.0.join("scripts").join(file)).unwrap().contains("// EDIT REGION:"),"{file}");}
    for file in ["launch.mjs","install.mjs","probe-check.mjs"] {assert!(fs::read_to_string(p.0.join("scripts").join(file)).unwrap().contains("// KEEP REGION:"),"{file}");}
}
#[test]
fn operation_index_does_not_suggest_paging_for_scalar_or_non_cursor_c() {
    let source="query scalar(c: cursor ?): return 1\nquery values(c: int): return [c]\n";
    let bound=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let emitted=snapback4_lang::emit::typescript(&bound);
    let index=emitted.split("// Full signatures").next().unwrap();
    assert!(!index.contains("usePage"),"{index}");
}
