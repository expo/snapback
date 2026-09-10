//! Process supervision and the provider-cleanup handshake.
use super::*;
use std::io::Write;

pub(super) fn supervise_journey_runner(
    command: Command,
) -> Result<JourneyRunnerOutput, std::io::Error> {
    supervise(command, None)
}

// The provider stays alive after its receipt until the supervisor drains the
// epoch. On timeout, process death, or spawn failure the same close still runs.
// @ref LLP 1021#3-a-provider-stand-in-and-nothing-else-answers — every exit path closes the epoch before a later journey can bind.
pub(super) fn supervise_bound_journey(
    command: Command,
    owner: &OwnerInfo,
) -> (
    Result<JourneyRunnerOutput, std::io::Error>,
    Result<u64, Refusal>,
) {
    let mut closed = None;
    let output = supervise(
        command,
        Some(&mut || {
            closed = Some(test_effects::close_epoch(owner));
        }),
    );
    let closed = closed.unwrap_or_else(|| test_effects::close_epoch(owner));
    (output, closed)
}

fn supervise(
    mut command: Command,
    mut on_receipt: Option<&mut dyn FnMut()>,
) -> Result<JourneyRunnerOutput, std::io::Error> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().expect("piped journey stdout");
    let stderr = child.stderr.take().expect("piped journey stderr");
    let (send, receive) = mpsc::channel();
    let stdout_thread = thread::spawn(move || {
        let mut reader = BufReader::new(stdout.take((JOURNEY_OUTPUT_LIMIT + 1) as u64));
        let mut total = 0_usize;
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(bytes) => {
                    total = total.saturating_add(bytes);
                    if total > JOURNEY_OUTPUT_LIMIT {
                        let _ = send.send(None);
                        break;
                    }
                    let _ = send.send(Some(line));
                }
                Err(_) => break,
            }
        }
    });
    let stderr_thread = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr
            .take((JOURNEY_OUTPUT_LIMIT + 1) as u64)
            .read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes[..bytes.len().min(JOURNEY_OUTPUT_LIMIT)]).into_owned()
    });

    let mut deadline = Instant::now() + JOURNEY_DEADLINE;
    let mut current = None;
    let mut completed = false;
    let mut lines = Vec::new();
    let mut capped = false;
    let mut timeout_name = None;
    let mut grace_terminated = false;
    let status = loop {
        if let Some(exit) = child.try_wait()? {
            while let Ok(event) = receive.try_recv() {
                match event {
                    Some(line) => lines.push(line),
                    None => capped = true,
                }
            }
            break exit.code();
        }
        let now = Instant::now();
        if now >= deadline {
            grace_terminated = completed;
            terminate_journey_runner(&mut child);
            if !completed {
                timeout_name = Some(current.unwrap_or_else(|| "journey runner".to_owned()));
            }
            break child.wait().ok().and_then(|exit| exit.code());
        }
        let wait = deadline
            .saturating_duration_since(now)
            .min(Duration::from_millis(25));
        match receive.recv_timeout(wait) {
            Ok(Some(line)) => {
                if let Ok(event) = serde_json::from_str::<Json>(&line) {
                    if event.get("runner").and_then(Json::as_str) == Some("start") {
                        current = event
                            .get("name")
                            .and_then(Json::as_str)
                            .map(ToOwned::to_owned);
                        deadline = Instant::now() + JOURNEY_DEADLINE;
                    } else if event.get("verdict").and_then(Json::as_str).is_some() {
                        if event["kind"] == "journey" {
                            if let Some(close) = on_receipt.take() {
                                close();
                                // End stdin after the one acknowledgment. An open
                                // pipe keeps Node alive past grace, hiding its
                                // natural exit (including beforeExit failures).
                                if let Some(mut stdin) = child.stdin.take() {
                                    let _ = stdin.write_all(b"closed\n");
                                }
                            }
                        }
                        completed = true;
                        deadline = Instant::now() + JOURNEY_EXIT_GRACE;
                    }
                }
                lines.push(line);
            }
            Ok(None) => {
                capped = true;
                terminate_journey_runner(&mut child);
                break child.wait().ok().and_then(|exit| exit.code());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
        }
    };
    let _ = stdout_thread.join();
    let stderr = stderr_thread.join().unwrap_or_default();
    while let Ok(event) = receive.try_recv() {
        match event {
            Some(line) => lines.push(line),
            None => capped = true,
        }
    }
    Ok(JourneyRunnerOutput {
        status,
        lines,
        stderr,
        timeout_name,
        capped,
        grace_terminated,
    })
}

fn terminate_journey_runner(child: &mut Child) {
    #[cfg(unix)]
    if unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL) } != 0 {
        let _ = child.kill();
    }
    #[cfg(not(unix))]
    let _ = child.kill();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drained_close_ends_stdin_and_preserves_the_runners_unsuccessful_exit() {
        for (body, status) in [
            ("process.exitCode = 7;", 7),
            (
                "process.once('beforeExit', () => { process.exitCode = 9; });",
                9,
            ),
        ] {
            let mut command = Command::new("node");
            command.args(["--input-type=module", "-e", &format!(r#"
                const closed = new Promise(resolve => {{
                    const done = () => {{ process.stdin.pause(); resolve(); }};
                    process.stdin.once('data', done);
                    process.stdin.once('end', done);
                    process.stdin.resume();
                }});
                {body}
                console.log(JSON.stringify({{name:'target',kind:'journey',verdict:'pass',ms:0,detail:{{}}}}));
                await closed;
            "#)]);
            let mut closed = false;
            let output = supervise(command, Some(&mut || closed = true)).unwrap();
            assert!(closed);
            assert_eq!(output.status, Some(status), "{}", output.stderr);
            assert!(output.failed_exit());
            assert!(!output.grace_terminated);
            assert_eq!(journey_receipts(&output)[0].verdict, "pass");
        }
    }
}
