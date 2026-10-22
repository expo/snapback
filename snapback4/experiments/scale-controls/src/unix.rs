//! Experiment-only Unix entrance to S0's userspace delay algorithm.
//! @ref LLP 3000.009.001.002#4-controls — delay only the database path; retain measured prepared-query RTT.
use std::{io::{Read, Write}, net::Shutdown, os::unix::{fs::PermissionsExt, net::{UnixListener, UnixStream}},
          path::Path, sync::mpsc, thread, time::{Duration, Instant}};
use serde_json::json;

pub async fn ping(directory: &str, port: u16, count: usize) -> anyhow::Result<()> {
    let password = std::fs::read_to_string(std::env::var("SCALE_PASSWORD_FILE")?)?;
    let mut config = tokio_postgres::Config::new();
    config.host(directory).port(port).user(&std::env::var("SCALE_DB_USER")?)
        .password(password.trim()).dbname(&std::env::var("SCALE_DATABASE")?)
        .application_name("s1pg_ping");
    let (client, connection) = config.connect(tokio_postgres::NoTls).await?;
    tokio::spawn(async move { let _ = connection.await; });
    let prepared = client.prepare("SELECT 1").await?;
    for _ in 0..100 { client.query_one(&prepared, &[]).await?; }
    let mut histogram=hdrhistogram::Histogram::<u64>::new(3)?;
    for _ in 0..count {
        let at=Instant::now();
        let row=client.query_one(&prepared, &[]).await?;
        anyhow::ensure!(row.get::<_,i32>(0)==1);
        histogram.record(at.elapsed().as_micros().max(1) as u64)?;
    }
    println!("{}",json!({"count":count,"warmup_queries":100,"query":"prepared SELECT 1",
        "socket_dir":directory,"port":port,"p50_ms":histogram.value_at_quantile(0.5) as f64/1000.,
        "p99_ms":histogram.value_at_quantile(0.99) as f64/1000.}));
    Ok(())
}

pub fn serve(directory: &str, upstream: &str, port: u16, delay_us: u64) -> anyhow::Result<()> {
    std::fs::create_dir(directory)?;
    std::fs::set_permissions(directory,std::fs::Permissions::from_mode(0o700))?;
    let listener=UnixListener::bind(Path::new(directory).join(format!(".s.PGSQL.{port}")))?;
    println!("{}",json!({"ready":true,"pid":std::process::id(),"added_rtt_us":delay_us}));
    let delay=Duration::from_nanos(delay_us*500);
    for client in listener.incoming() {
        let Ok(client)=client else {continue};
        let Ok(server)=UnixStream::connect(Path::new(upstream).join(format!(".s.PGSQL.{port}"))) else {continue};
        pump(client.try_clone()?,server.try_clone()?,delay);
        pump(server,client,delay);
    }
    Ok(())
}

fn pump(mut from: UnixStream, mut to: UnixStream, delay: Duration) {
    let (tx,rx)=mpsc::channel::<(Instant,Vec<u8>)>();
    thread::spawn(move || {
        let mut buf=vec![0;64*1024];
        loop {
            match from.read(&mut buf) {
                Ok(0)|Err(_)=>break,
                Ok(n)=>if tx.send((Instant::now()+delay,buf[..n].to_vec())).is_err(){break},
            }
        }
    });
    thread::spawn(move || {
        // Same timerslack, 100 us sleep/spin threshold, FIFO chunks as S0.
        unsafe {libc::prctl(libc::PR_SET_TIMERSLACK,1 as libc::c_ulong,0,0,0)};
        while let Ok((deadline,chunk))=rx.recv() {
            let now=Instant::now();
            if deadline>now {
                let left=deadline-now;
                if left>Duration::from_micros(100){thread::sleep(left-Duration::from_micros(100));}
                while Instant::now()<deadline {std::hint::spin_loop();}
            }
            if to.write_all(&chunk).is_err(){break}
        }
        let _=to.shutdown(Shutdown::Write);
    });
}
