use super::*;
use std::time::Instant;

#[test]
#[ignore = "FH native scale measurement; explicitly pin to an idle CPU"]
fn sparse_fifty_thousand_and_eight_thousand_two_hundred_follows() {
    for (label, posts, authors) in [
        ("sparse-1100", 1100, 1),
        ("sparse-50000", 50_000, 1),
        ("follows-8200", 8200, 8200),
    ] {
        let mut e = engine();
        for start in (0..posts).step_by(256) {
            e.seed_at(
                (start..(start + 256).min(posts)).map(|n| {
                    let actor = if authors > 1 {
                        format!("a{n:05}")
                    } else if n < 1100 {
                        "quiet".into()
                    } else {
                        format!("u{:04}", n % 998)
                    };
                    post(&format!("p{n:05}"), &actor, n as i64)
                }),
                100,
            )
            .unwrap();
        }
        if authors > 1 {
            for start in (0..authors).step_by(256) {
                e.seed_at(
                    (start..(start + 256).min(authors)).map(|n| edge(&format!("a{n:05}"))),
                    100,
                )
                .unwrap();
            }
        } else {
            e.seed_at(
                [
                    edge("quiet"),
                    (
                        "reposts".into(),
                        object([
                            ("id", id("r-quiet")),
                            ("actorId", id("quiet")),
                            ("postId", id("p00000")),
                            ("at", Value::Int(1100)),
                        ]),
                    ),
                ],
                100,
            )
            .unwrap();
        }
        adopt(&mut e);
        let oracle = Oracle::freeze(&e);
        let expected = oracle
            .rows(&e)
            .into_iter()
            .map(|(_, id)| id)
            .collect::<Vec<_>>();
        let mut measurements = Vec::new();
        for sample in 0..7 {
            let mut r = Reader::new().unwrap();
            let start = Instant::now();
            let opening = r
                .opening("reader", "feed", 20, 1_000_000, Ceilings::default())
                .unwrap();
            let opening_meter = opening.metered;
            let mut q = opening.request;
            let mut ids = Vec::new();
            let mut after = None;
            let mut first_us = 0;
            let mut preparation = 0;
            let mut later_us = Vec::new();
            let mut meters = Vec::new();
            let mut max_storage = 0;
            loop {
                let began = Instant::now();
                let out = step(&mut r, &mut e, &q);
                let elapsed = began.elapsed().as_micros();
                max_storage = max_storage.max(r.accounted_bytes());
                meters.push(out.metered);
                match &out.answer.response {
                    Response::Page { items, next } => {
                        if ids.is_empty() {
                            first_us = start.elapsed().as_micros();
                        } else {
                            later_us.push(elapsed);
                        }
                        // Full oracle scans are outside all timed intervals.
                        if sample == 0 {
                            after = oracle.page(&e, items, after.as_ref());
                        }
                        ids.extend(items.iter().map(|i| i.id().to_owned()));
                        if next.is_none() {
                            break;
                        }
                    }
                    Response::Preparing { .. } | Response::Stalled { .. } => preparation += 1,
                    other => panic!("{other:?}"),
                }
                q.token = out.answer.response.next().map(str::to_owned);
            }
            assert_eq!(ids, expected);
            later_us.sort();
            measurements.push(serde_json::json!({"sample":sample,"first_page_us":first_us,"opening_meter":opening_meter,"preparation_requests":preparation,
                "later_page_median_us":later_us[later_us.len()/2],"later_page_max_us":later_us.last(),"requests":meters.len(),
                "max_storage_bytes":max_storage,"first_request_meter":meters[0],"last_request_meter":meters.last(),"total_read_meter":meters.iter().copied().fold(Metered::default(),budget::add),"events":ids.len()}));
            r.cancel("reader", &q.opening, Ceilings::default());
            let mut reclaimed = 0;
            while r.accounted_bytes() > 0 {
                let m = r.reclaim(1_000_000, Ceilings::default());
                assert!(budget::fits(Ceilings::default(), m));
                reclaimed += 1;
            }
            assert!(reclaimed <= 10);
        }
        println!(
            "FH_ROUND1 {}",
            serde_json::json!({"label":label,"measurements":measurements})
        );
    }
}
