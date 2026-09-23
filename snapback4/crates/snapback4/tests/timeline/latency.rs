use super::common::*;
use snapback4_core::{Context,Value,WriteState};

#[test]
#[ignore = "isolated 20-sample measurement; run explicitly, without concurrent builds"]
fn following_and_posting_latency_envelope() {
    let mut p=Pair::new();
    for who in ["sparse","dense","celebrityReader","ordinary","celebrity"] {p.register(who);}
    for n in 0..500 {p.register(&format!("a{n}"));p.follow("dense",&format!("a{n}"));}
    for n in 0..5 {p.follow("sparse",&format!("a{n}"));p.follow("celebrityReader",&format!("a{n}"));p.follow(&format!("a{n}"),"ordinary");}
    for n in 0..900 {
        let who=if n<500 {format!("a{n}")} else {let who=format!("f{n}");p.register(&who);who};
        p.follow(&who,"celebrity");
    }
    p.follow("celebrityReader","celebrity");
    for n in 0..25 {p.publish("a0",&format!("s{n}"));p.publish("celebrity",&format!("c{n}"));}
    p.equal();
    for (label,e) in [("recipe",&mut p.recipe),("F3",&mut p.declared)] {
        for reader in ["sparse","dense","celebrityReader"] {
            let mut times=Vec::new();let mut last=None;
            for n in 0..23 {
                let start=std::time::Instant::now();
                let page=e.query("following",Context::new(reader,Default::default()).at(100000)).unwrap();
                if n>=3 {times.push(start.elapsed().as_secs_f64()*1000.0);}
                assert!(page.complete);assert_eq!(page.data.as_array().unwrap().len(),20);last=Some(page);
            }
            times.sort_by(f64::total_cmp);
            let (cold,_)=e.snapshot_at(reader,100000).unwrap();
            println!("LATENCY {label} reader={reader} p95_ms={:.4} cold_rows={} cold_json_bytes={} metered={:?}",times[18],cold.len(),serde_json::to_vec(&cold).unwrap().len(),last.unwrap().metered);
        }
        for actor in ["ordinary","celebrity"] {
            let mut times=Vec::new();let mut last=None;
            for n in 0..23 {
                let ctx=Context::new(actor,[("postId".into(),Value::Id(format!("new-{actor}-{n}")))].into()).at(100001+n);
                let start=std::time::Instant::now();let out=e.mutate("publish",None,ctx).unwrap();
                if n>=3 {times.push(start.elapsed().as_secs_f64()*1000.0);}
                assert!(matches!(out.state,WriteState::Sent{..}));last=Some(out);
            }
            times.sort_by(f64::total_cmp);println!("LATENCY {label} actor={actor} p95_ms={:.4} metered={:?}",times[18],last.unwrap().metered);
        }
    }
}
