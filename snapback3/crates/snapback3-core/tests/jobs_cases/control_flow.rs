use super::*;

#[test]
fn break_ends_the_sweep_return_ends_the_job_and_continue_keeps_scanning() {
    for (flow, expected_first, expected_state) in [
        (Stmt::Break, 1, "running"),
        (Stmt::Return(Expr::Literal(Value::Null)), 1, "done"),
        (Stmt::Continue, 100, "running"),
    ] {
        let mut p = job(100);
        let mut second = p.body[0].clone();
        if let Stmt::For {
            domain: LoopDomain::Page(scan),
            ..
        } = &mut second
        {
            scan.site = "second".into();
        }
        if let Stmt::For { body, .. } = &mut p.body[0] {
            body.push(flow);
            body.push(Stmt::Require {
                site: None,
                condition: Expr::Literal(Value::Bool(false)),
                code: "UNREACHABLE".into(),
            });
        }
        p.body.push(second);
        let mut rt = Runtime::open(Store::memory().unwrap(), generation(schema(), p)).unwrap();
        let ids = (0..100).map(|n| format!("{n:03}")).collect::<Vec<_>>();
        seed(&mut rt, &ids.iter().map(String::as_str).collect::<Vec<_>>());
        let id = start(&mut rt);
        let first = rt.run_chunk(&id).unwrap().job;
        assert_eq!(first.rows_written["items"], expected_first);
        assert_eq!(first.state, expected_state);
        assert!(first.cursor.is_none());
        assert!(first.upper_key.is_none());
        if expected_state == "running" {
            assert_eq!(first.sweep, 1);
            let done = rt.run_chunk(&id).unwrap().job;
            assert_eq!(done.state, "done");
            assert_eq!(done.rows_written["items"], expected_first + 100);
        } else {
            assert_eq!(first.sweep, 2);
            assert_eq!(values(&mut rt)["001"], 0);
        }
    }
}
