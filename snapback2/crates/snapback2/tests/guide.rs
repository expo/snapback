mod common;

use common::{Project, json_stdout};

#[test]
fn refusal_code_guide_prints_the_wrong_and_right_pair() {
    let project = Project::new();
    let output = project.run(&["guide", "E_BOUND_TAKE_REQUIRED", "--json"]);
    assert!(output.status.success());
    let page = json_stdout(&output);
    let content = page["content"].as_str().unwrap();
    assert!(content.contains("db.scan(todos.byOwner, [ctx.viewer])"));
    assert!(content.contains("{ take: 50 }"));
}
