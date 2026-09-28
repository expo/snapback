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
    for needle in ["16,384 examined", "rule checked per row", "one row, one rule check", "inner recipient work must fit one chunk", "first 50 is only a partial preview", "no partial digest commits"] {
        assert!(text.contains(needle), "{text}");
    }
    assert!(!text.contains("8,192 examined"), "job work has the job ceiling: {text}");
    assert!(!text.contains("system job: read rules pass"), "retain each scan's visibility: {text}");
}

#[test]
fn unrelated_job_costs_keep_visibility_without_digest_advice() {
    let project = Project::new();
    let schema = "table records:\n  owner: principal\n  read <- .owner = viewer\n  online only\n";
    for body in [
        "job sweep():\n  for r in records:\n    continue\n",
        "fn harmless(): 1\njob sweep():\n  for r in records:\n    n = harmless()\n",
        "fn owned(reader: principal):\n  n = 0\n  for r in records[owner = reader]:\n    n = n + 1\n  return n\njob sweep():\n  for r in records:\n    n = owned(r.owner)\n",
    ] {
        project.source(&(schema.to_owned() + body));
        for args in [vec!["why", "sweep"], vec!["check", "--cost"]] {
            let output = project.run(&args);
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            let text = String::from_utf8(output.stdout).unwrap();
            assert!(text.contains("rule checked per row"), "{text}");
            for unrelated in ["system job: read rules pass", "digest", "partial preview", "inner recipient", "helper keeps viewer authority"] {
                assert!(!text.contains(unrelated), "{text}");
            }
        }
    }
}
