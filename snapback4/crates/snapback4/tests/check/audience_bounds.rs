use super::*;

#[test]
fn builder_why_names_inherited_horizon_and_the_jobs_actual_meter() {
    let project = Project::new();
    project.source(include_str!("../../../../experiments/p19-one-query/builder.q"));
    let table = project.run(&["why", "ownLikes"]);
    assert!(table.status.success());
    let text = String::from_utf8(table.stdout).unwrap();
    for needle in ["sync public", "inherited from likes without a horizon", "offline aggregate/absence coverage", "replica census", "guide offline-interactions"] {
        assert!(text.contains(needle), "{text}");
    }
    let job = project.run(&["why", "digest"]);
    assert!(job.status.success());
    let text = String::from_utf8(job.stdout).unwrap();
    for needle in ["16,384 examined", "system job: read rules pass", "inner recipient work must fit one chunk", "first 50 is only a partial preview", "no partial digest commits"] {
        assert!(text.contains(needle), "{text}");
    }
    assert!(!text.contains("8,192 examined"), "job work has the job ceiling: {text}");
}
