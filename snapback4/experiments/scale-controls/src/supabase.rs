//! Native PostgREST HTTP adapter; uses the unchanged intended-arrival scheduler.
use crate::{Operation, proxy::Proxy};
use anyhow::{Context, Result};
use reqwest::{Client, RequestBuilder};
use serde_json::{Value, json};
use std::{fs, os::unix::fs::PermissionsExt, sync::Arc, time::Duration};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{Mutex, Semaphore},
};

pub fn tokens() -> Result<Vec<String>> {
    let path = std::env::var("SCALE_JWT_TOKENS_FILE").context("set SCALE_JWT_TOKENS_FILE")?;
    anyhow::ensure!(
        fs::metadata(&path)?.permissions().mode() & 0o777 == 0o600,
        "token file must be mode 600"
    );
    let tokens: Vec<String> = serde_json::from_slice(&fs::read(path)?)?;
    anyhow::ensure!(tokens.len() == 256, "need one token per fixture principal");
    Ok(tokens)
}

// @ref LLP 3000.009.001.002#4-controls — native table/RPC API, no extra HTTP application hop
pub fn request(client: &Client, url: &str, op: &Operation, tokens: &[String]) -> RequestBuilder {
    let request = match op.workload.as_str() {
        "W1" => client.get(format!("{url}/messages?id=eq.{}&select=*", op.message)),
        "W2" => client.get(format!(
            "{url}/messages?room=eq.{}&order=at.desc,id.desc&limit=20&select=*",
            op.room
        )),
        "W3" => client.post(format!("{url}/rpc/inbox")).json(&json!({})),
        "W4" | "W5" => client
            .post(format!("{url}/rpc/increment"))
            .json(&json!({"counter_id":op.counter})),
        _ => unreachable!(),
    };
    request.bearer_auth(&tokens[op.principal as usize])
}

pub fn normalize(op: &Operation, value: Value) -> Value {
    if op.workload == "W1" {
        if let Some(rows) = value.as_array()
            && rows.len() == 1
        {
            return json!({"data": rows[0]});
        }
        json!({"data": null})
    } else {
        json!({"data": value})
    }
}

// One leased SSH forward per physical libpq socket, including PostgREST's
// notification listener. A slot is returned only after BOTH directions finish.
// The S0 delay proxy is unchanged and runs on the application core allocation.
pub async fn dispatch(delay: u64) -> Result<()> {
    let ports = std::env::var("SCALE_TUNNEL_PORTS")?;
    let ports: Vec<u16> = ports
        .split(',')
        .skip(1)
        .map(str::parse)
        .collect::<std::result::Result<_, _>>()?;
    anyhow::ensure!(!ports.is_empty(), "no application SSH streams");
    let ports: Vec<u16> = ports
        .into_iter()
        .map(|port| {
            if delay == 0 {
                port
            } else {
                Proxy::start(
                    ([127, 0, 0, 1], port).into(),
                    Duration::from_nanos(delay * 500),
                )
                .port
            }
        })
        .collect();
    let slots = Arc::new(Semaphore::new(ports.len()));
    let available = Arc::new(Mutex::new(ports));
    let listener = TcpListener::bind("127.0.0.1:58081").await?;
    println!(
        "{}",
        json!({"ready":true,"pid":std::process::id(),"delay_us":delay,"listen":"127.0.0.1:58081"})
    );
    loop {
        let (mut client, _) = listener.accept().await?;
        client.set_nodelay(true)?;
        let (slots, available) = (slots.clone(), available.clone());
        tokio::spawn(async move {
            let _permit = slots.acquire_owned().await.unwrap();
            let port = available.lock().await.pop().unwrap();
            if let Ok(mut server) = TcpStream::connect(("127.0.0.1", port)).await {
                let _ = server.set_nodelay(true);
                let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
            }
            available.lock().await.push(port);
        });
    }
}
