#!/usr/bin/env python3
"""Private PG16/Snapback SIGKILL matrix; raw records live only under /tmp.

Run with a freshly compiled snapback4-core test binary as argv[1]. This never
signals the shared host's databases: every signalled PID/birth is recorded
from the child we launched or our private postmaster's descendant tree.
"""
import json, os, pathlib, shutil, signal, socket, subprocess, sys, tempfile, time

BINARY = str(pathlib.Path(sys.argv[1]).resolve())
ROOT = pathlib.Path(tempfile.mkdtemp(prefix="sb4-g7e-crash-", dir="/tmp"))
DATA = ROOT / "data"
PIDS = {}
MIN_DISK = 25 * 1024**3

def record_tree(root):
    rows = {}
    for entry in pathlib.Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            rows[int(entry.name)] = (int(fields[1]), fields[19], fields[0])
        except (OSError, IndexError, ValueError):
            continue
    owned = {root}
    for _ in range(8):
        owned |= {pid for pid, (parent, _, _) in rows.items() if parent in owned}
    result = {}
    for pid in owned:
        if pid in rows:
            result[pid] = rows[pid][1]
            PIDS[f"{pid}:{rows[pid][1]}"] = {"pid": pid, "birth": rows[pid][1]}
    (ROOT / "pids.json").write_text(json.dumps(list(PIDS.values())))
    return result

def alive(pid, birth):
    try:
        fields = pathlib.Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return fields[19] == birth and fields[0] != "Z"
    except (OSError, IndexError):
        return False

def kill_recorded(pid, birth):
    assert f"{pid}:{birth}" in PIDS
    if alive(pid, birth):
        os.kill(pid, signal.SIGKILL)

def wait_for(predicate, seconds=30):
    until = time.monotonic() + seconds
    while not predicate():
        assert shutil.disk_usage("/home").free >= MIN_DISK, "STOP disk below 25 GiB"
        if time.monotonic() >= until:
            raise AssertionError("private crash rendezvous timed out")
        time.sleep(0.01)

s = socket.socket()
s.bind(("127.0.0.1", 0))
PORT = s.getsockname()[1]
s.close()
URL = f"host={ROOT} port={PORT} user=sb4_g7e_crash dbname=postgres"

def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def sql(statement):
    return subprocess.check_output(["psql", URL, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", statement], text=True).strip()

def start():
    run(["pg_ctl", "-D", str(DATA), "-l", str(ROOT / "server.log"), "-o",
         f"-k {ROOT} -h 127.0.0.1 -p {PORT} -c shared_buffers=32MB -c max_connections=100 -c wal_writer_delay=10s", "-w", "start"], stdout=subprocess.DEVNULL)
    pid = int((DATA / "postmaster.pid").read_text().splitlines()[0])
    record_tree(pid)
    return pid

init = ["initdb", "-D", str(DATA), "-U", "sb4_g7e_crash", "--no-locale", "--encoding=UTF8", "--auth-local=trust", "--auth-host=reject"]
if os.environ.get("SNAPBACK4_PG_SHARE"):
    init += ["-L", os.environ["SNAPBACK4_PG_SHARE"]]
run(init, stdout=(ROOT / "init.log").open("w"))
postmaster = start()
child = None
results = []
helper = "engine::program_batch::overlay_tests::g7e_tests::g7e_crash_child"
try:
    faults = [] if os.environ.get("SNAPBACK4_G7E_LIVE_ONLY") else ([os.environ["SNAPBACK4_G7E_MATRIX_FAULT"]] if "SNAPBACK4_G7E_MATRIX_FAULT" in os.environ else ["snapback", "postgres"])
    for fault in faults:
        for point in ([os.environ["SNAPBACK4_G7E_MATRIX_POINT"]] if "SNAPBACK4_G7E_MATRIX_POINT" in os.environ else ["p1", "tail", "commit", "marker", "certificate"]):
            path = ROOT / f"{fault}-{point}.json"
            env = dict(os.environ, SNAPBACK4_EVAL_POSTGRES=URL,
                       SNAPBACK4_G7E_CRASH_RECORD=str(path), SNAPBACK4_G7E_CRASH_POINT=point)
            log = (ROOT / f"{fault}-{point}.log").open("w")
            child = subprocess.Popen([BINARY, "--exact", helper, "--ignored", "--nocapture"], env=env, stdout=log, stderr=subprocess.STDOUT)
            owned_child = record_tree(child.pid)
            def ready():
                record_tree(child.pid)
                record_tree(postmaster)
                assert child.poll() is None, f"child exited: {path}"
                return path.exists()
            wait_for(ready)
            record = json.loads(path.read_text())
            assert record["pid"] == child.pid
            before = sql(f"SET search_path={record['schema']},pg_catalog; SELECT count(*) FROM _ops WHERE id LIKE 'g7e-%'").splitlines()[-1]
            if fault == "postgres":
                owned_pg = record_tree(postmaster)
                # Kill the postmaster and each recorded child; none can retain
                # shared buffers or flush the uncertified suffix afterwards.
                kill_recorded(postmaster, owned_pg[postmaster])
                for pid, birth in owned_pg.items():
                    kill_recorded(pid, birth)
                wait_for(lambda: not any(alive(pid, birth) for pid, birth in owned_pg.items()))
            kill_recorded(child.pid, owned_child[child.pid])
            child.wait(timeout=10)
            child = None
            log.close()
            if fault == "postgres":
                postmaster = start()
            namespace = record["schema"]
            # All eight acknowledged op keys must survive; the suffix may be
            # present or absent, but the public/log head must remain a prefix.
            values = sql(f"SET search_path={namespace},pg_catalog; SELECT count(*) FILTER (WHERE id IN ({','.join(chr(39)+'g7e-'+str(n)+chr(39) for n in range(8))})),count(*) FROM _ops; SELECT seq,(SELECT max(seq) FROM _commits),(SELECT count(*) FROM _commits) FROM _head WHERE singleton").splitlines()[-2:]
            ack, total = map(int, values[0].split("|"))
            seq, max_seq, count_seq = map(int, values[1].split("|"))
            assert ack == 8, (fault, point, "acknowledged write lost", values)
            assert seq == max_seq == count_seq, (fault, point, "non-prefix history", values)
            assert total in [8, 16], (fault, point, "partial batch", total)
            if fault == "postgres" and point == "marker":
                assert int(before) == 16 and total == 8, "marker boundary must exercise a genuinely lost visible suffix"
            if point == "marker":
                # Remove this fixture's persisted marker hold trigger after the
                # original backend has drained. Production admission correctly
                # refuses foreign interception on managed relations.
                sql(f"SET search_path={namespace},pg_catalog; DROP TRIGGER IF EXISTS e_hold ON _durable; DROP FUNCTION IF EXISTS e_hold()")
            restart_env = dict(os.environ, SNAPBACK4_EVAL_POSTGRES=URL, SNAPBACK4_G7E_RESTART_NAMESPACE=namespace)
            restart_log = (ROOT / f"restart-{fault}-{point}.log").open("w")
            restart = subprocess.Popen([BINARY, "--exact", "engine::program_batch::overlay_tests::g7e_tests::g7e_restart_child_rebuilds_d_before_receipt_or_row_output", "--ignored", "--nocapture"], env=restart_env, stdout=restart_log, stderr=subprocess.STDOUT)
            record_tree(restart.pid)
            assert restart.wait(timeout=30) == 0, "Snapback restart failed to rebuild D"
            restart_log.close()
            results.append({"fault": fault, "point": point, "acknowledged": ack, "receipts_before": int(before), "receipts_after": total, "loss": 0})
            print(json.dumps(results[-1]), flush=True)
    if "SNAPBACK4_G7E_MATRIX_POINT" not in os.environ:
        # Keep the original Snapback process alive across PG loss, then reuse
        # the actually lost numeric revision with a different attempt/payload.
        path = ROOT / "live-reuse.json"
        env = dict(os.environ, SNAPBACK4_EVAL_POSTGRES=URL, SNAPBACK4_G7E_CRASH_RECORD=str(path), SNAPBACK4_G7E_CRASH_POINT="marker", SNAPBACK4_G7E_RESUME_AFTER_PG_CRASH="1")
        log = (ROOT / "live-reuse.log").open("w")
        child = subprocess.Popen([BINARY, "--exact", helper, "--ignored", "--nocapture"], env=env, stdout=log, stderr=subprocess.STDOUT)
        owned_child = record_tree(child.pid)
        def live_ready():
            record_tree(child.pid); record_tree(postmaster)
            assert child.poll() is None, "live reuse child exited"
            return path.exists()
        wait_for(live_ready)
        record = json.loads(path.read_text()); namespace = record["schema"]
        assert sql(f"SET search_path={namespace},pg_catalog; SELECT count(*) FROM _ops").splitlines()[-1] == "16"
        owned_pg = record_tree(postmaster)
        kill_recorded(postmaster, owned_pg[postmaster])
        for pid, birth in owned_pg.items(): kill_recorded(pid, birth)
        wait_for(lambda: not any(alive(pid, birth) for pid, birth in owned_pg.items()))
        postmaster = start()
        assert sql(f"SET search_path={namespace},pg_catalog; SELECT count(*) FROM _ops").splitlines()[-1] == "8", "live case must actually lose the visible suffix"
        sql(f"SET search_path={namespace},pg_catalog; DROP TRIGGER e_hold ON _durable; DROP FUNCTION e_hold()")
        pathlib.Path(str(path) + ".resume").touch()
        def live_resumed():
            record_tree(child.pid); record_tree(postmaster)
            assert child.poll() is None, "live reuse failed"
            return pathlib.Path(str(path) + ".resumed").exists()
        wait_for(live_resumed)
        resumed = json.loads(pathlib.Path(str(path) + ".resumed").read_text())
        assert resumed["revision_reused"] and not resumed["held_reader_released"] and resumed["old_attempt"] != resumed["new_attempt"]
        kill_recorded(child.pid, owned_child[child.pid]); child.wait(timeout=10); child = None; log.close()
        results.append({"fault":"postgres-live","point":"marker-revision-reuse","acknowledged":8,"loss":0,**resumed})
        print(json.dumps(results[-1]), flush=True)

finally:
    if child is not None and child.poll() is None:
        owned = record_tree(child.pid)
        kill_recorded(child.pid, owned[child.pid])
        child.wait(timeout=10)
    if (DATA / "postmaster.pid").exists():
        record_tree(postmaster)
        run(["pg_ctl", "-D", str(DATA), "-m", "fast", "-t", "60", "-w", "stop"], stdout=subprocess.DEVNULL)
    status = subprocess.run(["pg_ctl", "-D", str(DATA), "status"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert status.returncode == 3 and not (DATA / "postmaster.pid").exists()
    left = [p for p in PIDS.values() if alive(p["pid"], p["birth"])]
    (ROOT / "result.json").write_text(json.dumps({"cases": results, "pids_left": left}, indent=2))
    print(json.dumps({"artifact": str(ROOT), "passed": len(results), "pids_left": left}), flush=True)
    assert not left
