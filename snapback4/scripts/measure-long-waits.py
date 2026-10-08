#!/usr/bin/env python3
"""Idle long-wait cost on one host (LLP 3000.036 §6): N held /changes polls.

For each N, starts `snapback4 dev --fresh` with --long-waits N, holds N
`GET /changes?wait=25&heartbeat=1` polls (the published client's form), and
records the server's RSS, thread count and open descriptors, the latency of an
ordinary `POST /q` while they are held, and how long one commit takes to answer
every held poll (the notify_all herd). Prints one JSON line per N.

  SNAPBACK4_BIN=target/release/snapback4 python3 scripts/measure-long-waits.py 256 1024 4096
  MEASURE_BEARER=1 ...   # one guest bearer session instead of the dev persona (serve's path)

Darwin or Linux; needs a NOFILE limit above 3 * N for this client and `lsof`.
"""
import json, os, selectors, socket, statistics, subprocess, sys, tempfile, time

BIN = os.environ.get("SNAPBACK4_BIN", "target/release/snapback4")
SCHEMA = """use identity
use personas alice
table items:
  n: int
  read <- allow
  sync public
query hello():
  return 1
"""


CREDENTIAL = "x-snapback-persona: alice"


def request(address, method, path, body=b"", timeout=10):
    head = f"{method} {path} HTTP/1.1\r\nHost: localhost\r\n{CREDENTIAL}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n"
    for attempt in range(50):
        try:
            sock = socket.create_connection(address, timeout=timeout)
            sock.sendall(head.encode() + body)
            reply = b""
            while chunk := sock.recv(65536):
                reply += chunk
            sock.close()
            return reply
        except (ConnectionResetError, BrokenPipeError):
            time.sleep(0.01 * (attempt + 1))
    raise RuntimeError(f"{method} {path}: connection kept resetting")


def query_latency(address, samples=40):
    times = []
    for _ in range(samples):
        start = time.perf_counter()
        reply = request(address, "POST", "/q/hello", b'{"args":{}}')
        assert b" 200 " in reply.split(b"\r\n", 1)[0], reply[:200]
        times.append((time.perf_counter() - start) * 1000)
    times.sort()
    return {"p50": round(statistics.median(times), 2), "p99": round(times[int(len(times) * 0.99) - 1], 2), "max": round(times[-1], 2)}


def process(pid):
    rss = int(subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True).stdout.strip() or 0)
    if sys.platform == "darwin":
        threads = len(subprocess.run(["ps", "-M", "-p", str(pid)], capture_output=True, text=True).stdout.splitlines()) - 1
    else:
        threads = int(open(f"/proc/{pid}/status").read().split("Threads:")[1].split()[0])
    fds = len(subprocess.run(["lsof", "-n", "-P", "-p", str(pid)], capture_output=True, text=True).stdout.splitlines()) - 1
    return {"rss_mib": round(rss / 1024, 1), "threads": threads, "fds": fds}


def measure(n):
    project = tempfile.mkdtemp(prefix="sb4-long-waits-")
    os.makedirs(os.path.join(project, "snapback"))
    open(os.path.join(project, "snapback", "schema.q"), "w").write(SCHEMA)
    server = subprocess.Popen([os.path.abspath(BIN), "dev", "--fresh", "--no-watch", "--port", "0",
                               "--long-waits", str(n), "--long-waits-per-principal", str(n)],
                              cwd=project, stdout=subprocess.PIPE, stderr=open(os.path.join(project, "stderr.log"), "w"), text=True)
    try:
        url = server.stdout.readline().strip()
        host, port = url.removeprefix("http://").rsplit(":", 1)
        address = (host, int(port))
        time.sleep(0.5)
        global CREDENTIAL
        CREDENTIAL = "x-snapback-persona: alice"
        if os.environ.get("MEASURE_BEARER"):
            token = json.loads(request(address, "POST", "/auth/guest", b"{}").split(b"\r\n\r\n", 1)[1])["session"]["token"]
            CREDENTIAL = f"Authorization: Bearer {token}"
        idle = process(server.pid) | {"q_ms": query_latency(address)}
        head = json.loads(request(address, "GET", "/changes?since=0").split(b"\r\n\r\n", 1)[1])["seq"]
        selector = selectors.DefaultSelector()
        polls = []
        opened = time.perf_counter()
        resets = 0
        for i in range(n):
            for attempt in range(100):
                try:
                    sock = socket.create_connection(address, timeout=10)
                    sock.sendall(f"GET /changes?since={head}&wait=25&heartbeat=1 HTTP/1.1\r\nHost: localhost\r\n{CREDENTIAL}\r\n\r\n".encode())
                    break
                except (ConnectionResetError, BrokenPipeError):
                    # A full listen backlog (128 on Darwin) resets; a real client retries.
                    resets += 1
                    time.sleep(0.005 * (attempt + 1))
            else:
                raise RuntimeError(f"poll {i} never connected")
            sock.setblocking(False)
            selector.register(sock, selectors.EVENT_READ, i)
            polls.append([sock, b"", False])
        # Drain heartbeat bytes until every poll has its chunked header (held).
        def drain(until, stop):
            while time.perf_counter() < until and not stop():
                for key, _ in selector.select(timeout=0.05):
                    poll = polls[key.data]
                    try:
                        data = poll[0].recv(65536)
                    except BlockingIOError:
                        continue
                    if not data:
                        selector.unregister(poll[0]); poll[2] = True
                        continue
                    poll[1] += data
                    if poll[1].endswith(b"\r\n0\r\n\r\n") or b" 503 " in poll[1][:20] or b" 429 " in poll[1][:20]:
                        selector.unregister(poll[0]); poll[2] = True
        drain(time.perf_counter() + 6, lambda: all(p[1] for p in polls))
        held_after = round(time.perf_counter() - opened, 2)
        refused = sum(1 for p in polls if b" 503 " in p[1][:20] or b" 429 " in p[1][:20])
        started = sum(1 for p in polls if p[1].startswith(b"HTTP/1.1 200"))
        held = process(server.pid) | {"q_ms": query_latency(address)}
        # One commit wakes every parked waiter; time until all answered.
        commit = time.perf_counter()
        seeded = request(address, "POST", "/seed", b'[{"table":"items","row":{"id":"01J0000000000000000000WAKE","n":1}}]')
        assert b'"seeded":1' in seeded, seeded[-300:]
        drain(time.perf_counter() + 20, lambda: all(p[2] for p in polls))
        herd = round((time.perf_counter() - commit) * 1000, 1)
        answered = sum(1 for p in polls if p[1].endswith(b"\r\n0\r\n\r\n"))
        after = {"q_ms": query_latency(address)}
        # Every client re-polls at once on its kept-alive connection.
        head = json.loads(request(address, "GET", "/changes?since=0").split(b"\r\n\r\n", 1)[1])["seq"]
        repoll = time.perf_counter()
        if os.environ.get("SAMPLE_OUT"):  # profiling aid: macOS `sample` during the re-poll burst
            subprocess.Popen(["sample", str(server.pid), "3", "-file", os.environ["SAMPLE_OUT"]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for index, p in enumerate(polls):
            if p[1].endswith(b"\r\n0\r\n\r\n"):
                p[1], p[2] = b"", False
                p[0].setblocking(True)
                p[0].sendall(f"GET /changes?since={head}&wait=25&heartbeat=1 HTTP/1.1\r\nHost: localhost\r\n{CREDENTIAL}\r\n\r\n".encode())
                p[0].setblocking(False)
                selector.register(p[0], selectors.EVENT_READ, index)
        drain(time.perf_counter() + 10, lambda: all(p[1] for p in polls))
        repolled = sum(1 for p in polls if p[1].startswith(b"HTTP/1.1 200"))
        repoll_ms = round((time.perf_counter() - repoll) * 1000, 1)
        during = {"q_ms": query_latency(address, 20)}
        for p in polls:
            p[0].close()
        return {"n": n, "credential": CREDENTIAL.split(":")[0], "idle": idle, "held": held, "held_ready_s": held_after, "polls_started": started, "polls_refused": refused, "connect_resets": resets,
                "commit_answers_all_ms": herd, "answered": answered, "after_commit": after,
                "repoll_all_held_ms": repoll_ms, "repolled": repolled, "repolled_q_ms": during["q_ms"],
                "per_wait": {"rss_kib": round((held["rss_mib"] - idle["rss_mib"]) * 1024 / n, 1),
                             "threads": round((held["threads"] - idle["threads"]) / n, 2),
                             "fds": round((held["fds"] - idle["fds"]) / n, 2)}}
    finally:
        server.terminate()
        try:
            server.wait(10)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    for n in [int(a) for a in sys.argv[1:]] or [256, 1024, 4096]:
        print(json.dumps(measure(n)), flush=True)
        time.sleep(1)
