use crate::Operation;
use anyhow::Result;
use clap::Parser;
use hdrhistogram::Histogram;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Parser, Clone, serde::Serialize)]
pub struct Options {
    #[arg(long, default_value = "http://127.0.0.1:58080")]
    url: String,
    #[arg(long)]
    workload: String,
    #[arg(long, default_value_t = 0)]
    rate: u64,
    /// One outstanding request per worker; a capacity diagnostic, not an S1 rung.
    #[arg(long, conflicts_with = "rate")]
    closed_loop: bool,
    /// Linux process CPU counters sampled at the common measured boundaries.
    #[arg(long, value_delimiter = ',')]
    cpu_pids: Vec<u32>,
    /// Include live and reaped descendants of this Linux process (private PG).
    #[arg(long)]
    cpu_tree_root: Option<u32>,
    #[arg(long, default_value_t = 128)]
    workers: usize,
    #[arg(long, default_value_t = 100_000)]
    rows: u64,
    #[arg(long, default_value_t = 1000)]
    warmup_ms: u64,
    #[arg(long, default_value_t = 3000)]
    duration_ms: u64,
    #[arg(long, default_value = "disjoint")]
    keys: String,
    #[arg(long, default_value_t = 1000)]
    deadline_ms: u64,
    #[arg(long, default_value = "raw-pg", value_parser = ["raw-pg", "raw-pg-no-token", "supabase", "convex", "snapback"])]
    target: String,
}
struct Arrival {
    intended: Instant,
    measured: bool,
    seq: u64,
}
struct SliceStats {
    latency: Histogram<u64>,
    n: u64,
    errors: u64,
}
impl SliceStats {
    fn new() -> Self {
        Self {
            latency: Histogram::new(3).unwrap(),
            n: 0,
            errors: 0,
        }
    }
}
struct Stats {
    latency: Histogram<u64>,
    successful_latency: Histogram<u64>,
    service: Histogram<u64>,
    queue: Histogram<u64>,
    errors: BTreeMap<String, u64>,
    slices: BTreeMap<u64, SliceStats>,
    success: u64,
    total_success: u64,
    sent: u64,
    completed_in_window: u64,
}
impl Stats {
    fn new() -> Self {
        Self {
            latency: Histogram::new(3).unwrap(),
            successful_latency: Histogram::new(3).unwrap(),
            service: Histogram::new(3).unwrap(),
            queue: Histogram::new(3).unwrap(),
            errors: BTreeMap::new(),
            slices: BTreeMap::new(),
            success: 0,
            total_success: 0,
            sent: 0,
            completed_in_window: 0,
        }
    }
    fn merge(&mut self, rhs: Self) {
        self.latency.add(rhs.latency).unwrap();
        self.successful_latency.add(rhs.successful_latency).unwrap();
        self.service.add(rhs.service).unwrap();
        self.queue.add(rhs.queue).unwrap();
        for (key, n) in rhs.errors {
            *self.errors.entry(key).or_default() += n;
        }
        for (t_s, slice) in rhs.slices {
            let dst = self.slices.entry(t_s).or_insert_with(SliceStats::new);
            dst.latency.add(slice.latency).unwrap();
            dst.n += slice.n;
            dst.errors += slice.errors;
        }
        self.success += rhs.success;
        self.total_success += rhs.total_success;
        self.sent += rhs.sent;
        self.completed_in_window += rhs.completed_in_window;
    }
}
fn hist(h: &Histogram<u64>) -> Value {
    json!({"count":h.len(),"p50_ms":h.value_at_quantile(0.5) as f64/1e6,
        "p99_ms":h.value_at_quantile(0.99) as f64/1e6,"p999_ms":h.value_at_quantile(0.999) as f64/1e6,
        "max_ms":h.max() as f64/1e6,
        "buckets_ns":h.iter_recorded().map(|v|json!([v.value_iterated_to(),v.count_at_value()])).collect::<Vec<_>>()})
}
fn operation(o: &Options, worker: usize, seq: u64) -> Operation {
    let writing = o.workload == "W4" || o.workload == "W5";
    let principal = if writing {
        worker as i64
    } else {
        ((seq / o.workers as u64 + worker as u64 * 37) % 256) as i64
    };
    let room = (principal * 4 + (seq % 32) as i64) % 1024;
    let counter = if o.keys == "same"
        || o.keys == "sharded"
        || (o.keys == "hot1" && (seq / o.workers as u64 + worker as u64 * 37).is_multiple_of(100))
    {
        256
    } else {
        worker as i64
    };
    Operation {
        workload: o.workload.clone(),
        principal,
        room,
        message: room + 1 + ((seq.wrapping_mul(7919) % (o.rows / 1024)) * 1024) as i64,
        counter,
        body: String::new(),
    }
}
fn valid(op: &Operation, value: &Value) -> bool {
    let d = &value["data"];
    match op.workload.as_str() {
        "W1" => d["id"].as_i64() == Some(op.message) && d["room"].as_i64() == Some(op.room),
        "W2" => d.as_array().is_some_and(|a| {
            a.len() == 20
                && a.iter().all(|r| r["room"].as_i64() == Some(op.room))
                && a.windows(2)
                    .all(|w| w[0]["at"].as_i64() >= w[1]["at"].as_i64())
        }),
        "W3" => d
            .as_array()
            .is_some_and(|a| a.len() == 32 && a.iter().all(|r| r["unread"].as_i64().is_some())),
        "W4" | "W5" => d["id"].as_i64() == Some(op.counter) && d["n"].as_i64().is_some(),
        _ => false,
    }
}

// @ref LLP 3000.009.001.002#6-method-and-metrics — open-loop arrivals retain intended times; closed-loop capacity diagnostics are explicitly labelled.
pub async fn run(options: Options) -> Result<()> {
    anyhow::ensure!(
        (options.closed_loop || options.rate > 0)
            && options.duration_ms > 0
            && options.rows >= 32768
            && (1..=256).contains(&options.workers),
        "invalid load parameters"
    );
    anyhow::ensure!(
        ["W1", "W2", "W3", "W4", "W5"].contains(&options.workload.as_str()),
        "unknown workload"
    );
    anyhow::ensure!(
        ["disjoint", "same", "hot1", "sharded"].contains(&options.keys.as_str()),
        "unknown key mix"
    );
    let options = Arc::new(options);
    let tokens = Arc::new(if options.target != "raw-pg-no-token" {
        crate::supabase::tokens()?
    } else {
        Vec::new()
    });
    // Keep one idle connection per worker. Reqwest's default idle timeout is 90s,
    // which covers a trial, so measured calls reuse the TCP session (TCP_NODELAY).
    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(options.workers)
        .timeout(Duration::from_millis(options.deadline_ms))
        .tcp_nodelay(true)
        .build()?;
    let start = Instant::now() + Duration::from_millis(100);
    let measured_start = start + Duration::from_millis(options.warmup_ms);
    let end = measured_start + Duration::from_millis(options.duration_ms);
    let cpu_options = options.clone();
    let cpu_window = tokio::spawn(async move {
        tokio::time::sleep_until(measured_start.into()).await;
        let before = cpu_snapshot(&cpu_options.cpu_pids, cpu_options.cpu_tree_root);
        tokio::time::sleep_until(end.into()).await;
        let after = cpu_snapshot(&cpu_options.cpu_pids, cpu_options.cpu_tree_root);
        json!({"before":before,"after":after})
    });
    let mut senders = Vec::new();
    let mut tasks = Vec::new();
    for worker in 0..options.workers {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Arrival>();
        senders.push(tx);
        let (o, client, tokens) = (options.clone(), client.clone(), tokens.clone());
        tasks.push(tokio::spawn(async move {
            let mut stats = Stats::new();
            let mut seq = worker as u64;
            tokio::time::sleep_until(start.into()).await;
            loop {
                let a = if o.closed_loop {
                    let intended = Instant::now();
                    if intended >= end { break; }
                    let a = Arrival { intended, measured: intended >= measured_start, seq };
                    seq += o.workers as u64;
                    a
                } else {
                    match rx.recv().await { Some(a) => a, None => break }
                };
                let send = Instant::now();
                let queue = send.saturating_duration_since(a.intended);
                let error = if queue >= Duration::from_millis(o.deadline_ms) {
                    Some("expired_before_send".to_string())
                } else {
                    let op = operation(&o, worker, a.seq);
                    if a.measured {
                        stats.sent += 1;
                    }
                    let request = if o.target == "supabase" {
                        crate::supabase::request(&client, &o.url, &op, &tokens)
                    } else if o.target == "convex" {
                        crate::convex::request(&client, &o.url, &op, &tokens, &o.keys)
                    } else if o.target == "snapback" {
                        crate::snapback::request(&client, &o.url, &op, &tokens)
                    } else {
                        let request = client.post(format!("{}/op", o.url)).json(&op);
                        if o.target == "raw-pg" {
                            request.bearer_auth(&tokens[op.principal as usize])
                        } else {
                            request
                        }
                    };
                    match request.send().await {
                        Ok(response) => {
                            let code = response.status();
                            match response.bytes().await {
                                Ok(bytes) if code.is_success() => {
                                    match serde_json::from_slice::<Value>(&bytes) {
                                        Ok(value) => {
                                            let value = if o.target == "supabase" {
                                                crate::supabase::normalize(&op, value)
                                            } else if o.target == "convex" {
                                                crate::convex::normalize(value)
                                            } else if o.target == "snapback" {
                                                crate::snapback::normalize(&op, value)
                                            } else {
                                                value
                                            };
                                            if valid(&op, &value) {
                                                None
                                            } else {
                                                Some("invalid_response".into())
                                            }
                                        }
                                        _ => Some("invalid_response".into()),
                                    }
                                }
                                Ok(_) => Some(format!("http_{}", code.as_u16())),
                                Err(_) => Some("response_body_error".into()),
                            }
                        }
                        Err(_) => Some("request_error".into()),
                    }
                };
                let finished = Instant::now();
                let success = error.is_none();
                if success {
                    stats.total_success += 1;
                }
                if a.measured {
                    let latency_ns = finished
                        .saturating_duration_since(a.intended)
                        .as_nanos()
                        .max(1) as u64;
                    let t_s = a
                        .intended
                        .saturating_duration_since(measured_start)
                        .as_secs();
                    let slice = stats.slices.entry(t_s).or_insert_with(SliceStats::new);
                    slice.n += 1;
                    slice.latency.record(latency_ns).unwrap();
                    if error.is_some() {
                        slice.errors += 1;
                    }
                    stats.queue.record(queue.as_nanos().max(1) as u64).unwrap();
                    stats.latency.record(latency_ns).unwrap();
                    stats
                        .service
                        .record(finished.duration_since(send).as_nanos().max(1) as u64)
                        .unwrap();
                    if let Some(error) = error {
                        *stats.errors.entry(error).or_default() += 1;
                    } else {
                        stats.success += 1;
                        stats.successful_latency.record(latency_ns).unwrap();
                    }
                }
                // Includes warm-up arrivals that finish in the window; excludes drain.
                if success && finished >= measured_start && finished < end {
                    stats.completed_in_window += 1;
                }
            }
            stats
        }));
    }
    let scheduled = ((options.warmup_ms + options.duration_ms) as u128 * options.rate as u128)
        .div_ceil(1000) as u64;
    let schedule_options = options.clone();
    let scheduler = std::thread::spawn(move || {
        if schedule_options.closed_loop { return 0; }
        let options = schedule_options;
        #[cfg(target_os = "linux")]
        unsafe {
            libc::prctl(libc::PR_SET_TIMERSLACK, 1 as libc::c_ulong, 0, 0, 0);
        }
        let mut measured = 0;
        for seq in 0..scheduled {
            let intended = start
                + Duration::from_nanos((seq as u128 * 1_000_000_000 / options.rate as u128) as u64);
            if intended >= end {
                break;
            }
            let left = intended.saturating_duration_since(Instant::now());
            if left > Duration::from_micros(100) {
                std::thread::sleep(left - Duration::from_micros(100));
            }
            while Instant::now() < intended {
                std::hint::spin_loop();
            }
            let is_measured = intended >= measured_start;
            measured += u64::from(is_measured);
            senders[seq as usize % senders.len()]
                .send(Arrival {
                    intended,
                    measured: is_measured,
                    seq,
                })
                .unwrap();
        }
        measured
    });
    let mut stats = Stats::new();
    for task in tasks {
        stats.merge(task.await?);
    }
    let scheduled_measured = scheduler.join().unwrap();
    let measured = if options.closed_loop { stats.success + stats.errors.values().sum::<u64>() } else { scheduled_measured };
    let cpu_window = cpu_window.await?;
    let elapsed = Instant::now().duration_since(start).as_secs_f64();
    let errors: u64 = stats.errors.values().sum();
    anyhow::ensure!(
        measured == stats.success + errors && measured == stats.latency.len(),
        "lost arrivals"
    );
    let slo = if options.workload == "W4" || options.workload == "W5" {
        100.
    } else {
        50.
    };
    let p99 = stats.latency.value_at_quantile(0.99) as f64 / 1e6;
    let seconds = options.duration_ms as f64 / 1000.;
    println!(
        "{}",
        json!({"format":if options.closed_loop {"sb4-scale-closed-loop-v1"} else {"sb4-scale-open-loop-v1"},"options":&*options,"cpu_window":cpu_window,
        "scheduled":measured,"success":stats.success,"errors":stats.errors,"error_count":errors,
        "sent":stats.sent,"total_success_including_warmup":stats.total_success,
        "achieved_per_s":stats.success as f64/seconds,
        "completed_in_window_per_s":stats.completed_in_window as f64/seconds,
        "elapsed_with_warmup_and_drain_s":elapsed,"slo_ms":slo,
        "slo_pass":p99<=slo && errors as f64/measured as f64<=0.001,
        "latency":hist(&stats.latency),"successful_latency":hist(&stats.successful_latency),"dispatch_lag":hist(&stats.queue),"http_service":hist(&stats.service),
        "slices":stats.slices.iter().map(|(t_s,s)| json!({"t_s":t_s,"n":s.n,"errors":s.errors,
            "p50_ms":s.latency.value_at_quantile(0.5) as f64/1e6,
            "p99_ms":s.latency.value_at_quantile(0.99) as f64/1e6})).collect::<Vec<_>>()})
    );
    Ok(())
}

// CPU ticks include user + system time for the whole process. Self is the
// pooled reqwest client; supplied PIDs identify the server and private PG only.
fn cpu_snapshot(pids: &[u32], tree_root: Option<u32>) -> Value {
    #[cfg(target_os = "linux")]
    {
        // Children CPU includes reaped descendants. Adding it to each live
        // member retains the CPU of private PG workers that exit mid-window.
        // The stat tail starts at field 3 (state).
        fn counters(pid: u32) -> Option<(u32, u64, u64, u64)> {
            let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
            let (_, tail) = stat.rsplit_once(") ")?;
            let f: Vec<_> = tail.split_whitespace().collect();
            let n = |i: usize| f.get(i)?.parse::<u64>().ok();
            Some((n(1)? as u32, n(19)?, n(11)? + n(12)?, n(13)? + n(14)?))
        }
        let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) } as f64;
        let values: Vec<_> = pids.iter().copied().chain(std::iter::once(std::process::id())).map(|pid| {
            let stat = counters(pid);
            json!({"pid":pid,"start_ticks":stat.map(|s|s.1),"cpu_s":stat.map(|s|s.2 as f64/hz)})
        }).collect();
        let tree = tree_root.and_then(|root| {
            let all: BTreeMap<_,_> = std::fs::read_dir("/proc").ok()?.filter_map(|e| {
                let pid = e.ok()?.file_name().to_str()?.parse::<u32>().ok()?;
                Some((pid,counters(pid)?))
            }).collect();
            if !all.contains_key(&root) { return None; }
            let mut members = std::collections::BTreeSet::from([root]);
            loop {
                let old = members.len();
                for (pid, (parent,_,_,_)) in &all {
                    if members.contains(parent) { members.insert(*pid); }
                }
                if members.len() == old { break; }
            }
            let ticks: u64 = members.iter().map(|pid| all[pid].2 + all[pid].3).sum();
            Some(json!({"root_pid":root,"root_start_ticks":all[&root].1,"cpu_s":ticks as f64/hz,"pids":members}))
        });
        json!({"elapsed_unix_s":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64(),"load1":std::fs::read_to_string("/proc/loadavg").ok().and_then(|s|s.split_whitespace().next()?.parse::<f64>().ok()),"processes":values,"tree":tree})
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = (pids,tree_root); Value::Null }
}
